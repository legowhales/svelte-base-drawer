/**
 * Keyboard-aware focus and scroll handling for bottom-sheet drawers with form
 * fields. Port of base-ui v1.7.0 DrawerVirtualKeyboardProvider.
 *
 * Responsibilities:
 * - Expose the software keyboard inset as `--drawer-keyboard-inset` on the
 *   viewport element (via `visualViewport`).
 * - Add "scroll slack" (padding-bottom + scroll-padding-bottom +
 *   overflow-anchor: none) to the scroll container so the focused field can be
 *   scrolled clear of the keyboard.
 * - Smooth-scroll the focused field to the center of the visible area.
 * - Tap-to-focus interception on touch: iOS only opens the software keyboard
 *   when focus happens synchronously inside the touch gesture, so taps on
 *   keyboard inputs are committed on touchend with a synchronous focus (with an
 *   off-screen trick to suppress iOS page scrolling) and a redispatched click.
 */
import { untrack } from 'svelte';
import { Context } from 'runed';
import {
	clamp,
	findScrollableTouchTarget,
	getElementAtPoint,
	getEventTarget,
	getParentNode,
	isHTMLElement
} from './utils.js';

export const DRAWER_KEYBOARD_INSET_VAR = '--drawer-keyboard-inset';

const KEYBOARD_RESIZE_THRESHOLD = 60;
const KEYBOARD_VISIBILITY_MARGIN = 16;
// Extra breathing room (px) added below the focused field, on top of its
// measured keyboard overlap, so the field can be scrolled clear of the keyboard
// instead of ending up flush against it. Only applied when there is overlap.
const KEYBOARD_SCROLL_SLACK = 48;
// Cadence of the settle-watching realign passes after focus moves with the
// keyboard open: long enough for a smooth scroll to show progress between
// passes, short enough to recover quickly from a scroll canceled by WebKit's
// reveal; the pass count covers CSS transitions reacting to the focus change
// (e.g. a 260ms footer resize) with room to spare.
const KEYBOARD_REALIGN_INTERVAL = 150;
const KEYBOARD_REALIGN_MAX_PASSES = 4;
// Frames the alignment waits for the scroll destination to stop moving (layout
// reacting to the focus change, e.g. a footer resizing over a CSS transition)
// before scrolling anyway.
const KEYBOARD_SETTLE_FRAME_LIMIT = 60;
const INPUT_TAP_MOVE_THRESHOLD = 10;
const INPUT_TAP_HIT_SLOP = 16;
const KEYBOARD_INPUT_TYPES = new Set([
	'email',
	'number',
	'password',
	'search',
	'tel',
	'text',
	'url'
]);
const INTERACTIVE_TAP_SELECTOR = 'button,a,input,select,textarea,label,[role="button"]';

// Snapshot of a scroll container's relevant styles taken before keyboard slack
// is applied. The string fields are the exact inline values to restore on
// cleanup; the parsed numbers are the computed baselines slack is added onto.
interface ScrollAdjustment {
	readonly element: HTMLElement;
	readonly overflowAnchor: string;
	readonly paddingBottom: string;
	readonly scrollPaddingBottom: string;
	readonly computedPaddingBottom: number;
	readonly computedScrollPaddingBottom: number;
}

interface KeyboardVisualViewport {
	readonly top: number;
	readonly bottom: number;
}

interface KeyboardTouchTarget {
	readonly focusTarget: HTMLElement;
	readonly clickTarget: HTMLElement;
}

// Returned by the point-based resolver when the lift point lands on another
// interactive/label element. It signals that the tap was intentionally
// rejected, so the caller must NOT fall back to the touchstart target
// (`touchend.target` stays at the touchstart node on mobile) — doing so would
// steal a tap meant for that element.
const KEYBOARD_TAP_BLOCKED = Symbol('KeyboardTapBlocked');

export interface VirtualKeyboardHooks {
	onTouchStart: (event: TouchEvent) => void;
	onTouchMove: (event: TouchEvent) => void;
	onTouchEnd: (event: TouchEvent) => void;
	onTouchCancel: () => void;
}

export const VirtualKeyboardContext = new Context<VirtualKeyboardHooks>(
	'Drawer.VirtualKeyboardProvider'
);

export interface VirtualKeyboardOptions {
	/** Reactive getter: whether the drawer is open */
	open: () => boolean;
	/** Reactive getter: the viewport element (measurement/containment root) */
	rootElement: () => HTMLElement | null;
}

/**
 * Creates the virtual keyboard manager. Must be called during component
 * initialization (it sets up an $effect).
 */
export function createVirtualKeyboard(options: VirtualKeyboardOptions): VirtualKeyboardHooks {
	let pendingKeyboardFocusMoved = false;
	let keyboardTouchStart: { x: number; y: number } | null = null;
	let focusedKeyboardTarget: HTMLElement | null = null;
	let keyboardScrollAdjustment: ScrollAdjustment | null = null;
	let programmaticKeyboardFocus = false;

	let frameId = 0;
	const keyboardFocusFrame = {
		request(callback: FrameRequestCallback) {
			this.cancel();
			frameId = requestAnimationFrame(callback);
		},
		cancel() {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
				frameId = 0;
			}
		}
	};

	let realignTimeoutId: ReturnType<typeof setTimeout> | undefined;
	const keyboardRealignTimeout = {
		start(delay: number, callback: () => void) {
			this.clear();
			realignTimeoutId = setTimeout(callback, delay);
		},
		clear() {
			if (realignTimeoutId !== undefined) {
				clearTimeout(realignTimeoutId);
				realignTimeoutId = undefined;
			}
		}
	};

	function restoreKeyboardScrollAdjustment() {
		const adjustment = keyboardScrollAdjustment;
		if (!adjustment) return;
		adjustment.element.style.overflowAnchor = adjustment.overflowAnchor;
		adjustment.element.style.paddingBottom = adjustment.paddingBottom;
		adjustment.element.style.scrollPaddingBottom = adjustment.scrollPaddingBottom;
		keyboardScrollAdjustment = null;
	}

	function setKeyboardScrollSlack(element: HTMLElement, slack: number) {
		const roundedSlack = Math.max(0, Math.ceil(slack));
		let adjustment = keyboardScrollAdjustment;

		if (adjustment && !adjustment.element.isConnected) {
			restoreKeyboardScrollAdjustment();
			adjustment = null;
		}

		if (roundedSlack === 0) {
			restoreKeyboardScrollAdjustment();
			return;
		}

		if (adjustment && adjustment.element !== element) {
			restoreKeyboardScrollAdjustment();
			adjustment = null;
		}

		if (!adjustment) {
			const styles = getComputedStyle(element);
			adjustment = {
				element,
				overflowAnchor: element.style.overflowAnchor,
				paddingBottom: element.style.paddingBottom,
				scrollPaddingBottom: element.style.scrollPaddingBottom,
				computedPaddingBottom: Number.parseFloat(styles.paddingBottom) || 0,
				computedScrollPaddingBottom: Number.parseFloat(styles.scrollPaddingBottom) || 0
			};
			keyboardScrollAdjustment = adjustment;
		}

		element.style.overflowAnchor = 'none';
		element.style.paddingBottom = `${adjustment.computedPaddingBottom + roundedSlack}px`;
		element.style.scrollPaddingBottom = `${
			adjustment.computedScrollPaddingBottom + KEYBOARD_VISIBILITY_MARGIN
		}px`;
	}

	function animateKeyboardScroll(element: HTMLElement, scrollTop: number) {
		const win = element.ownerDocument.defaultView ?? window;
		const behavior: ScrollBehavior = win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
			? 'auto'
			: 'smooth';

		element.scrollTo({ top: scrollTop, behavior });
	}

	function resetTouchTrackingState() {
		pendingKeyboardFocusMoved = false;
		keyboardTouchStart = null;
	}

	$effect(() => {
		const open = options.open();
		const rootElement = options.rootElement();

		if (!open) {
			focusedKeyboardTarget = null;
			restoreKeyboardScrollAdjustment();
			keyboardFocusFrame.cancel();
			return undefined;
		}

		if (!rootElement) {
			restoreKeyboardScrollAdjustment();
			return undefined;
		}

		const doc = rootElement.ownerDocument;
		const win = doc.defaultView ?? window;
		const visualViewport = win.visualViewport;

		// Alignment scroll bookkeeping: destination stability, whether a scroll
		// was issued, and the last observed progress so delayed passes can
		// distinguish moving from stalled.
		let keyboardScrollElement: HTMLElement | null = null;
		let keyboardScrollDestination = 0;
		let keyboardScrollChecks = 0;
		let keyboardScrollObserved = -1;

		const setDrawerKeyboardInset = (inset: number) => {
			rootElement.style.setProperty(
				DRAWER_KEYBOARD_INSET_VAR,
				`${Math.max(0, Math.ceil(inset))}px`
			);
		};

		const clearFocusedKeyboardTarget = () => {
			focusedKeyboardTarget = null;
			keyboardScrollElement = null;
			setDrawerKeyboardInset(0);
			restoreKeyboardScrollAdjustment();
			keyboardFocusFrame.cancel();
			keyboardRealignTimeout.clear();
		};

		// WebKit's native reveal scroll can move the page even while the scroll
		// lock hides overflow (e.g. when the software keyboard's previous/next
		// field arrows move focus). While the drawer is modal, any window scroll
		// during keyboard interaction is spurious, so pin the page to the position
		// it had when the drawer opened.
		const baseScrollX = win.scrollX;
		const baseScrollY = win.scrollY;

		const restoreWindowScroll = (): boolean => {
			// Upstream also requires the dialog to be modal with no nested drawer
			// open here. bits-ui dialogs are always modal, and a field focused
			// inside a nested drawer is never tracked by this provider (it lives
			// outside `rootElement`), so the tracked-target check covers both.
			if (!focusedKeyboardTarget || getKeyboardVisualViewport(win) == null) {
				return false;
			}

			if (win.scrollX !== baseScrollX || win.scrollY !== baseScrollY) {
				// Force an instant jump: the two-argument form defaults `behavior` to
				// `auto`, which obeys the page's `scroll-behavior`, so a global
				// `scroll-behavior: smooth` would animate the restore. The
				// measurements that follow assume the page is already back at rest,
				// and a smooth restore also re-emits `scroll`, re-entering this
				// handler.
				win.scrollTo({ left: baseScrollX, top: baseScrollY, behavior: 'instant' });
				return true;
			}

			return false;
		};

		// Focus moved by the drawer itself goes through
		// `focusKeyboardInputWithoutPageScroll`, but native focus changes (the iOS
		// keyboard's previous/next field arrows) commit WebKit's reveal scroll
		// before `focusin` reaches us — cancelling it afterwards visibly jitters
		// the sheet. `focusout` on the outgoing field fires before focus lands, so
		// override the incoming field's geometry there and restore it in `focusin`.
		let restorePreemptedFocus: (() => void) | null = null;

		const consumePreemptedFocus = () => {
			restorePreemptedFocus?.();
			restorePreemptedFocus = null;
		};

		const preemptFocusReveal = (target: HTMLElement, keyboardViewport: KeyboardVisualViewport) => {
			consumePreemptedFocus();

			// Native focus carries no preventScroll, so a fake off-screen rect would
			// make WebKit scroll the drawer's own scroll containers thousands of
			// pixels chasing it. Presenting the field as already centered in the
			// visible band above the keyboard instead makes both the in-page reveal
			// and the viewport pan no-ops.
			const rect = target.getBoundingClientRect();

			restorePreemptedFocus = overrideGeometryDuringFocus(
				target,
				(keyboardViewport.top + keyboardViewport.bottom - rect.top - rect.bottom) / 2
			);
		};

		const alignFocusedKeyboardTarget = () => {
			// If focus never lands on a preempted target, the focusout-scheduled
			// alignment still restores it on the next frame before paint.
			consumePreemptedFocus();

			const target = focusedKeyboardTarget;
			// If the focused field is removed from the DOM without firing `focusout`
			// (e.g. conditionally rendered away), any applied scroll slack is restored
			// here on the next focus/viewport event or when the drawer closes.
			if (!target || !rootElement.contains(target)) {
				setDrawerKeyboardInset(0);
				restoreKeyboardScrollAdjustment();
				return;
			}

			// Undo any reveal scroll WebKit applied to the locked page before
			// measuring, so the keyboard inset and alignment are computed against
			// the resting viewport.
			restoreWindowScroll();

			const keyboardViewport = getKeyboardVisualViewport(win);
			if (!keyboardViewport) {
				setDrawerKeyboardInset(0);
				restoreKeyboardScrollAdjustment();
				return;
			}

			setDrawerKeyboardInset(Math.max(0, win.innerHeight - keyboardViewport.bottom));

			const scrollTarget = findKeyboardScrollTarget(target, rootElement);
			if (!scrollTarget) {
				restoreKeyboardScrollAdjustment();
				return;
			}

			const scrollTargetRect = scrollTarget.getBoundingClientRect();
			const clippedBottom = Math.min(scrollTargetRect.bottom, keyboardViewport.bottom);
			const overlap = Math.max(0, scrollTargetRect.bottom - keyboardViewport.bottom);
			setKeyboardScrollSlack(scrollTarget, overlap > 0 ? overlap + KEYBOARD_SCROLL_SLACK : 0);

			const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
			if (maxScrollTop <= 0) return;

			const clippedTop = Math.max(scrollTargetRect.top, keyboardViewport.top);
			const visibleTop = clippedTop + KEYBOARD_VISIBILITY_MARGIN;
			const visibleBottom = clippedBottom - KEYBOARD_VISIBILITY_MARGIN;
			if (visibleBottom <= visibleTop) return;

			const targetRect = target.getBoundingClientRect();
			const nextScrollTop =
				scrollTarget.scrollTop +
				(targetRect.top + targetRect.bottom - visibleTop - visibleBottom) / 2;
			const destination = Math.round(clamp(nextScrollTop, 0, maxScrollTop));

			const settled =
				keyboardScrollElement === scrollTarget &&
				Math.abs(keyboardScrollDestination - destination) <= 1;

			if (!settled) {
				// Commit the scroll only once the destination holds across two
				// consecutive checks. Layout may still be reacting to the focus change
				// (e.g. a footer sized by `:focus-within` resizing over a transition),
				// and scrolling toward a mid-transition destination overshoots, then
				// visibly pulls back once corrected. The destination is
				// scroll-position-invariant, so an in-flight scroll of the container
				// itself never defers the commit.
				const checks = keyboardScrollElement === scrollTarget ? keyboardScrollChecks + 1 : 1;
				keyboardScrollElement = scrollTarget;
				keyboardScrollDestination = destination;
				keyboardScrollChecks = checks;
				keyboardScrollObserved = -1;
				// Re-check next frame; give up and scroll anyway if layout never settles.
				if (checks <= KEYBOARD_SETTLE_FRAME_LIMIT) {
					keyboardFocusFrame.request(alignFocusedKeyboardTarget);
					return;
				}
			} else if (keyboardScrollObserved >= 0) {
				// A scroll toward this destination is already out. Leave it alone
				// while it has arrived or is still progressing — re-issuing restarts
				// the smooth-scroll easing curve, a visible stutter on every realign
				// pass — and re-issue only when it stalled short (WebKit cancels
				// in-flight smooth scrolls when its native reveal for the focus
				// resolves).
				const current = scrollTarget.scrollTop;
				if (Math.abs(current - destination) <= 1) {
					return;
				}
				if (current !== keyboardScrollObserved) {
					keyboardScrollObserved = current;
					return;
				}
			}

			keyboardScrollElement = scrollTarget;
			keyboardScrollDestination = destination;
			keyboardScrollChecks = 0;
			keyboardScrollObserved = scrollTarget.scrollTop;
			animateKeyboardScroll(scrollTarget, destination);
		};

		const scheduleKeyboardFocusAlignment = () => {
			keyboardFocusFrame.request(alignFocusedKeyboardTarget);
		};

		// When focus moves with the keyboard already up, no viewport resize events
		// follow to re-run alignment, and the single frame-scheduled pass is
		// unreliable: WebKit resolves the reveal for the focus asynchronously (a
		// UI-process round trip) and cancels any in-flight scroll the pass started
		// when it lands, and layout reacting to the focus change (e.g. a footer
		// sized by `:focus-within` and the keyboard inset) settles only after its
		// transition, so the pass measures stale geometry. Re-align on an interval
		// until both settle; the alignment's scroll bookkeeping observes before
		// re-issuing, so passes that find the scroll on course are inert.
		const scheduleDelayedKeyboardRealign = () => {
			let remainingPasses = KEYBOARD_REALIGN_MAX_PASSES;
			const realign = () => {
				alignFocusedKeyboardTarget();
				remainingPasses -= 1;
				if (remainingPasses > 0) {
					keyboardRealignTimeout.start(KEYBOARD_REALIGN_INTERVAL, realign);
				}
			};
			keyboardRealignTimeout.start(KEYBOARD_REALIGN_INTERVAL, realign);
		};

		const captureFocusedKeyboardTarget = (eventTarget: EventTarget | null) => {
			// Resolve through the same path as taps so contentEditable hosts (and
			// labelled controls) are normalized identically for both paths.
			const target = resolveKeyboardInputTarget(eventTarget);
			if (!target || !rootElement.contains(target)) {
				return false;
			}

			// A new field starts a fresh alignment; the scroll bookkeeping must not
			// carry over from the previous field's scroll.
			if (focusedKeyboardTarget !== target) {
				keyboardScrollElement = null;
			}
			focusedKeyboardTarget = target;
			return true;
		};

		const handleFocusIn = (event: FocusEvent) => {
			// The programmatic transition is over once focus lands, which happens
			// before `.focus()` returns. Any later `focusout` is the consumer's own —
			// an `onFocus` handler that blurs or moves focus — and must be reconciled
			// rather than suppressed, so stop suppressing here instead of waiting for
			// `.focus()` to return.
			programmaticKeyboardFocus = false;

			consumePreemptedFocus();

			if (!captureFocusedKeyboardTarget(getEventTarget(event))) {
				// Focus landed outside any drawer keyboard input. The `focusout` on
				// the previous field normally clears the tracked target, but the tap
				// path suppresses that `focusout` via `programmaticKeyboardFocus`, so
				// a consumer `onFocus` handler that redirects focus out of the drawer
				// would otherwise leave a stale target holding its inset, slack, and
				// pending realign. Reconcile against the real focus here.
				// A handler that ends focus entirely emits no `focusin` to reconcile
				// from; that case is covered by clearing the suppression flag above so
				// its `focusout` is handled.
				clearFocusedKeyboardTarget();
				return;
			}

			// Covers every way focus can land with the keyboard already up: native
			// moves (the keyboard's previous/next arrows) and the tap path (which
			// suppresses `focusout` handling via the programmatic flag).
			if (getKeyboardVisualViewport(win) != null) {
				scheduleDelayedKeyboardRealign();
			}

			scheduleKeyboardFocusAlignment();
		};

		const handleFocusOut = (event: FocusEvent) => {
			// The blur inside `focusKeyboardInputWithoutPageScroll` is followed
			// synchronously by a re-focus; clearing state here would drop the
			// keyboard inset for a frame.
			if (programmaticKeyboardFocus) {
				return;
			}

			if (captureFocusedKeyboardTarget(event.relatedTarget)) {
				const target = focusedKeyboardTarget;
				const keyboardViewport = getKeyboardVisualViewport(win);
				// The delayed realign passes are scheduled by the `focusin` that
				// follows once focus lands on the captured target.
				if (target && keyboardViewport) {
					preemptFocusReveal(target, keyboardViewport);
				}
				scheduleKeyboardFocusAlignment();
				return;
			}

			clearFocusedKeyboardTarget();
		};

		const handleViewportUpdate = () => {
			if (focusedKeyboardTarget || captureFocusedKeyboardTarget(doc.activeElement)) {
				scheduleKeyboardFocusAlignment();
			}
		};

		const cleanups: Array<() => void> = [];

		if (visualViewport) {
			visualViewport.addEventListener('resize', handleViewportUpdate);
			visualViewport.addEventListener('scroll', handleViewportUpdate);
			cleanups.push(() => {
				visualViewport.removeEventListener('resize', handleViewportUpdate);
				visualViewport.removeEventListener('scroll', handleViewportUpdate);
			});
		}

		const handleWindowScroll = () => {
			if (restoreWindowScroll()) {
				// Recompute the keyboard inset once the page is back at rest;
				// measurements taken mid-reveal (a non-zero visual viewport offset)
				// inflate it and push the popup up.
				scheduleKeyboardFocusAlignment();
			}
		};

		// Once the user puts a finger down they own the scroll position. Stop both
		// the frame settle loop, which can center after changing layout settles,
		// and the delayed passes, which can't distinguish a user scroll from a
		// reveal scroll WebKit canceled. A later focus or viewport change
		// reschedules alignment if it's still needed.
		const cancelKeyboardRealignOnPointerDown = () => {
			keyboardFocusFrame.cancel();
			keyboardRealignTimeout.clear();
			keyboardScrollElement = null;
		};

		doc.addEventListener('focusin', handleFocusIn, true);
		doc.addEventListener('focusout', handleFocusOut, true);
		win.addEventListener('scroll', handleWindowScroll);
		doc.addEventListener('pointerdown', cancelKeyboardRealignOnPointerDown, true);
		cleanups.push(() => {
			doc.removeEventListener('focusin', handleFocusIn, true);
			doc.removeEventListener('focusout', handleFocusOut, true);
			win.removeEventListener('scroll', handleWindowScroll);
			doc.removeEventListener('pointerdown', cancelKeyboardRealignOnPointerDown, true);
		});

		if (captureFocusedKeyboardTarget(doc.activeElement)) {
			scheduleKeyboardFocusAlignment();
		}

		return () => {
			cleanups.forEach((cleanup) => cleanup());
			consumePreemptedFocus();
			clearFocusedKeyboardTarget();
			rootElement.style.removeProperty(DRAWER_KEYBOARD_INSET_VAR);
		};
	});

	// --- Touch hooks, called from the drawer viewport handlers ---

	// The touch-scroll caller only invokes this while the drawer is active (open,
	// no nested drawer) and with a first touch present, so no guards are needed
	// here (parity with upstream, whose viewport caller guards identically).
	function onTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		pendingKeyboardFocusMoved = false;
		keyboardTouchStart = { x: touch.clientX, y: touch.clientY };
	}

	function onTouchMove(event: TouchEvent) {
		const touch = event.touches[0];
		const touchStart = keyboardTouchStart;

		if (!touch || !touchStart || pendingKeyboardFocusMoved) return;

		// Treat the gesture as a scroll/swipe (not a tap-to-focus) once the finger
		// moves past the threshold, so we don't open the keyboard on a drag.
		if (
			Math.abs(touch.clientX - touchStart.x) > INPUT_TAP_MOVE_THRESHOLD ||
			Math.abs(touch.clientY - touchStart.y) > INPUT_TAP_MOVE_THRESHOLD
		) {
			pendingKeyboardFocusMoved = true;
		}
	}

	function onTouchEnd(event: TouchEvent) {
		const rootElement = untrack(options.rootElement);

		if (
			!untrack(options.open) ||
			!rootElement ||
			!keyboardTouchStart ||
			pendingKeyboardFocusMoved
		) {
			resetTouchTrackingState();
			return;
		}

		const touch = event.changedTouches[0] ?? event.touches[0];
		const root = rootElement.getRootNode();
		const nativeEventTarget = getEventTarget(event);
		const pointTarget = touch
			? resolveKeyboardTouchTargetFromPoint(root, touch.clientX, touch.clientY)
			: null;

		// The lift point landed on another interactive/label element; let its
		// native tap through instead of stealing it for the touchstart input.
		if (pointTarget === KEYBOARD_TAP_BLOCKED) {
			resetTouchTrackingState();
			return;
		}

		const keyboardTarget = touch && (pointTarget ?? resolveKeyboardTouchTarget(nativeEventTarget));

		if (
			keyboardTarget &&
			(!rootElement.contains(keyboardTarget.focusTarget) ||
				!rootElement.contains(keyboardTarget.clickTarget))
		) {
			resetTouchTrackingState();
			return;
		}

		if (keyboardTarget) {
			const { clickTarget: keyboardClickTarget, focusTarget: keyboardFocusTarget } = keyboardTarget;
			const win = keyboardFocusTarget.ownerDocument.defaultView ?? window;

			// While pinch-zoomed, keyboard alignment is suspended; let native behavior
			// handle focus and caret placement instead of blurring and re-focusing.
			if (win.visualViewport && win.visualViewport.scale !== 1) {
				resetTouchTrackingState();
				return;
			}

			// Already focused with the keyboard up: let the native tap through so it
			// can reposition the caret, rather than blurring and re-focusing.
			if (
				keyboardFocusTarget.ownerDocument.activeElement === keyboardFocusTarget &&
				(!win.visualViewport || getKeyboardVisualViewport(win) != null)
			) {
				resetTouchTrackingState();
				return;
			}

			// iOS only opens the software keyboard when focus happens synchronously
			// inside the touch gesture. The flag suppresses the `focusout` cleanup
			// the intermediate blur would otherwise trigger, so the keyboard inset
			// isn't dropped for a frame between the blur and the re-focus. It is
			// cleared by the `focusin` that lands, so only that blur is suppressed;
			// the `finally` is the backstop for a target that never takes focus.
			event.preventDefault();
			programmaticKeyboardFocus = true;
			try {
				focusKeyboardInputWithoutPageScroll(keyboardFocusTarget);
			} finally {
				programmaticKeyboardFocus = false;
			}
			// Preventing the touchend default also suppresses the compatibility mouse
			// events, including `click`; redispatch an untrusted replacement on the
			// original tap target so click handlers still run with the tap coordinates.
			dispatchKeyboardClick(keyboardClickTarget, touch);
			resetTouchTrackingState();
			return;
		}

		resetTouchTrackingState();
	}

	return {
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onTouchCancel: resetTouchTrackingState
	};
}

// --- Helpers ---

function isKeyboardInputElement(element: HTMLElement): boolean {
	if (element.isContentEditable) {
		return true;
	}

	if (
		element instanceof HTMLTextAreaElement ||
		(element instanceof HTMLInputElement && KEYBOARD_INPUT_TYPES.has(element.type))
	) {
		// Disabled controls can't focus or open the keyboard, so tap-to-focus must
		// skip them — otherwise the dispatched click fires handlers a native tap on
		// a disabled control never would.
		return !element.matches(':disabled');
	}

	return false;
}

function resolveKeyboardInputTarget(target: EventTarget | null): HTMLElement | null {
	if (!isHTMLElement(target)) return null;

	if (isKeyboardInputElement(target)) {
		return target.isContentEditable ? getContentEditableHost(target) : target;
	}

	const label = target.closest('label');
	const control = label?.control ?? null;

	return isHTMLElement(control) && isKeyboardInputElement(control) ? control : null;
}

function resolveKeyboardTouchTarget(target: EventTarget | null): KeyboardTouchTarget | null {
	if (!isHTMLElement(target)) return null;

	const focusTarget = resolveKeyboardInputTarget(target);
	if (!focusTarget) return null;

	return {
		focusTarget,
		clickTarget: target
	};
}

// Inherited-editable descendants (no `contenteditable` attribute of their own)
// are not focusable, so focusing them is a no-op; resolve taps on them to the
// editing host.
function getContentEditableHost(element: HTMLElement): HTMLElement {
	let host = element;
	while (host.parentElement?.isContentEditable) {
		host = host.parentElement;
	}
	return host;
}

function resolveKeyboardTouchTargetFromPoint(
	root: Node,
	clientX: number,
	clientY: number
): KeyboardTouchTarget | typeof KEYBOARD_TAP_BLOCKED | null {
	const exactTarget = getElementAtPoint(root, clientX, clientY);
	if (isHTMLElement(exactTarget)) {
		const exactKeyboardTarget = resolveKeyboardInputTarget(exactTarget);
		if (exactKeyboardTarget) {
			return {
				focusTarget: exactKeyboardTarget,
				clickTarget: exactTarget
			};
		}
	}

	// Probing nearby points compensates for iOS retargeting taps while the page
	// reacts to the keyboard, but it must not steal a tap that lands on another
	// interactive element — that would suppress its click and focus a neighboring
	// field instead. Returning the blocked sentinel (rather than null) stops the
	// caller from falling back to the touchstart target.
	if (exactTarget?.closest(INTERACTIVE_TAP_SELECTOR) != null) {
		return KEYBOARD_TAP_BLOCKED;
	}

	for (const [offsetX, offsetY] of [
		[0, INPUT_TAP_HIT_SLOP],
		[0, -INPUT_TAP_HIT_SLOP],
		[INPUT_TAP_HIT_SLOP, 0],
		[-INPUT_TAP_HIT_SLOP, 0]
	]) {
		const keyboardTarget = resolveKeyboardInputTarget(
			getElementAtPoint(root, clientX + offsetX, clientY + offsetY)
		);

		if (keyboardTarget) {
			return {
				focusTarget: keyboardTarget,
				clickTarget: keyboardTarget
			};
		}
	}

	return null;
}

function dispatchKeyboardClick(target: HTMLElement, touch: Pick<Touch, 'clientX' | 'clientY'>) {
	const win = target.ownerDocument.defaultView ?? window;
	const ClickEvent = win.PointerEvent ?? win.MouseEvent;

	target.dispatchEvent(
		new ClickEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: touch.clientX,
			clientY: touch.clientY,
			detail: 1,
			view: win
		})
	);
}

function focusKeyboardInputWithoutPageScroll(target: HTMLElement) {
	const wasFocused = target.ownerDocument.activeElement === target;
	// iOS Safari can still scroll the page for transformed sheets even with
	// preventScroll. Move the input off-screen only for the synchronous focus
	// call; `preventScroll` suppresses the in-page ancestor scrolling that would
	// otherwise chase the fake rect.
	const restoreStyles = overrideGeometryDuringFocus(target, -2000);
	try {
		if (wasFocused) {
			target.blur();
		}
		target.focus({ preventScroll: true });
	} finally {
		restoreStyles();
	}
}

// Overrides the painted geometry WebKit samples when an element gains focus.
// The rect is hidden (opacity) rather than detached so layout is unaffected;
// the caller must restore synchronously before the next paint.
function overrideGeometryDuringFocus(target: HTMLElement, translateY: number): () => void {
	const previousOpacity = target.style.opacity;
	const previousTransform = target.style.transform;
	const previousTransition = target.style.transition;

	target.style.transition = 'none';
	target.style.opacity = '0';
	target.style.transform = `translateY(${translateY}px)`;

	return () => {
		target.style.opacity = previousOpacity;
		target.style.transform = previousTransform;
		target.style.transition = previousTransition;
	};
}

function findKeyboardScrollTarget(target: HTMLElement, root: HTMLElement): HTMLElement | null {
	// Start at the parent: scrolling the focused field's own content (an
	// overflowing textarea is scrollable itself) can never move its box out from
	// under the keyboard. Prefer an already-scrollable ancestor, then fall back
	// to one that only becomes scrollable once keyboard slack is added.
	const scrollStart = getParentNode(target);
	return (
		findScrollableTouchTarget(scrollStart, root, 'vertical') ??
		findScrollableTouchTarget(scrollStart, root, 'vertical', true)
	);
}

function getKeyboardVisualViewport(win: Window): KeyboardVisualViewport | null {
	const visualViewport = win.visualViewport;

	if (!visualViewport || visualViewport.scale !== 1) {
		return null;
	}

	const reducedHeight = win.innerHeight - visualViewport.height;
	// Treat small viewport changes as browser chrome movement, not the keyboard.
	if (reducedHeight <= KEYBOARD_RESIZE_THRESHOLD) {
		return null;
	}

	const top = Math.max(0, visualViewport.offsetTop);
	return {
		top,
		bottom: Math.min(win.innerHeight, top + visualViewport.height)
	};
}
