/**
 * Touch scroll interception for the drawer viewport.
 * Port of base-ui v1.6.0 DrawerViewport touch handling.
 *
 * The critical piece for mobile: a single capture-phase `touchmove` listener on
 * the document decides between native scrolling and the drawer swipe, and when
 * the swipe wins it claims the gesture (`preventDefault` + `stopPropagation`)
 * and drives the engine natively via `swipeGesture.moveNative` (#4980). Element
 * handlers only cover touchstart/end/cancel.
 */
import { untrack } from 'svelte';
import type { SwipeGesture } from './create-swipe-gesture.svelte.js';
import type { VirtualKeyboardHooks } from './create-virtual-keyboard.svelte.js';
import {
	type SwipeDirection,
	type ScrollAxis,
	findScrollableTouchTarget,
	hasScrollableContentOnAxis,
	isAtSwipeStartEdge,
	canSwipeFromScrollEdgeOnMove,
	isSwipeIgnoredTarget,
	isEventOnRangeInput,
	shouldIgnoreSwipeForTextSelection,
	getElementAtPoint,
	getEventTarget,
	getScrollAxis,
	getCrossScrollAxis
} from './utils.js';

interface TouchScrollState {
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	scrollTarget: HTMLElement | null;
	hasCrossAxisScrollableContent: boolean;
	/** null = undecided, true = swipe claimed, false = native scroll */
	allowSwipe: boolean | null;
	preserveNativeCrossAxisScroll: boolean;
}

export interface DrawerTouchScrollOptions {
	/** The root element (viewport, falling back to popup) */
	rootElement: () => HTMLElement | null;
	/** Whether the drawer is open */
	active: () => boolean;
	/** The primary swipe direction */
	swipeDirection: () => SwipeDirection;
	/** The swipe gesture engine */
	swipeGesture: SwipeGesture;
	/** Virtual keyboard hooks, when a VirtualKeyboardProvider is present */
	virtualKeyboard: () => VirtualKeyboardHooks | null;
}

export function createDrawerTouchScroll(options: DrawerTouchScrollOptions) {
	let ignoreTouchSwipe = false;
	let touchState: TouchScrollState | null = null;
	let lastPointerType = '';
	let ignoreNextTouchStartFromPen = false;

	function getRoot(): HTMLElement | null {
		return untrack(options.rootElement);
	}

	function isActive(): boolean {
		return untrack(options.active);
	}

	function getDirection(): SwipeDirection {
		return untrack(options.swipeDirection);
	}

	function getVirtualKeyboard(): VirtualKeyboardHooks | null {
		return untrack(options.virtualKeyboard);
	}

	function resetTrackingState() {
		ignoreTouchSwipe = false;
		touchState = null;
		lastPointerType = '';
		ignoreNextTouchStartFromPen = false;
	}

	/**
	 * Capture-phase native touchmove handler (registered with {passive: false}).
	 * Decides scroll vs swipe, and when the swipe wins, claims the gesture and
	 * feeds the engine directly.
	 */
	function handleNativeTouchMove(event: TouchEvent) {
		// The virtual keyboard provider observes the move to tell a tap apart from
		// a drag. It must run even when the swipe claims the event below with
		// stopPropagation(), which would otherwise hide the move from it.
		getVirtualKeyboard()?.onTouchMove(event);

		if (ignoreTouchSwipe) return;

		const ts = touchState;
		const touch = event.touches[0];
		if (!touch || !ts) return;

		const direction = getDirection();
		const scrollAxis = getScrollAxis(direction);
		const isVertical = scrollAxis === 'vertical';

		const drawerAxisDelta = isVertical ? touch.clientY - ts.lastY : touch.clientX - ts.lastX;

		// Preserve native range interaction by never locking touchmove for range inputs.
		if (isEventOnRangeInput(event)) {
			ts.allowSwipe = false;
			updateTouchPosition(ts, touch);
			return;
		}

		// Avoid blocking pinch zoom or text selection adjustments on iOS Safari.
		if (event.touches.length >= 2) {
			updateTouchPosition(ts, touch);
			return;
		}

		const root = getRoot();
		if (!root) return;
		const doc = root.ownerDocument;

		// Allow the native move when text is selected or the drawer isn't active.
		if (shouldIgnoreSwipeForTextSelection(doc, root) || !isActive()) {
			updateTouchPosition(ts, touch);
			return;
		}

		// Preserve native cross-axis scroll (e.g. a horizontal carousel in a bottom drawer).
		if (preserveNativeCrossAxisScrollOnMove(ts, touch, isVertical)) {
			updateTouchPosition(ts, touch);
			return;
		}

		const scrollTarget = ts.scrollTarget;

		// No scroll target (or body/html) → the swipe owns the gesture: block window
		// scrolling and drive the engine natively, before any other handler sees it.
		if (!scrollTarget || scrollTarget === doc.documentElement || scrollTarget === doc.body) {
			if (event.cancelable) {
				event.preventDefault();
			}
			event.stopPropagation();
			options.swipeGesture.moveNative(event, root);
			updateTouchPosition(ts, touch);
			return;
		}

		// The scroll container doesn't overflow on the drawer axis → just prevent
		// the window from scrolling.
		if (!hasScrollableContentOnAxis(scrollTarget, scrollAxis)) {
			if (event.cancelable) {
				event.preventDefault();
			}
			event.stopPropagation();
			updateTouchPosition(ts, touch);
			return;
		}

		// The scroll target is scrollable — decide: swipe or native scroll?
		if (drawerAxisDelta !== 0) {
			const canSwipeFromEdge = canSwipeFromScrollEdgeOnMove(
				scrollTarget,
				scrollAxis,
				direction,
				drawerAxisDelta
			);

			if (!ts.allowSwipe) {
				if (!event.cancelable) {
					ts.allowSwipe = false;
				} else if (canSwipeFromEdge) {
					ts.allowSwipe = true;
					event.preventDefault();
				} else {
					ts.allowSwipe = false;
				}
			} else if (event.cancelable) {
				event.preventDefault();
			}
		}

		if (ts.allowSwipe === true) {
			event.stopPropagation();
			options.swipeGesture.moveNative(event, root);
		}

		updateTouchPosition(ts, touch);
	}

	// --- Element-level handlers (attach on the viewport) ---

	/** Track the pointer type so pen-initiated touch sequences can be skipped. */
	function notePointerDown(event: PointerEvent) {
		lastPointerType = event.pointerType;
		ignoreNextTouchStartFromPen = event.pointerType === 'pen';
	}

	function notePointerSettled(event: PointerEvent) {
		if (lastPointerType === event.pointerType) {
			lastPointerType = '';
		}
	}

	function handleTouchStart(event: TouchEvent) {
		const startedFromPen = lastPointerType === 'pen' && ignoreNextTouchStartFromPen;
		if (startedFromPen) {
			ignoreNextTouchStartFromPen = false;
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		if (!isActive()) {
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		const touch = event.touches[0];
		if (!touch) return;

		if (isEventOnRangeInput(event)) {
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		const root = getRoot();
		if (!root) return;
		const doc = root.ownerDocument;

		const elementAtPoint = getElementAtPoint(doc, touch.clientX, touch.clientY);
		const eventTarget = getEventTarget(event);
		const target = eventTarget instanceof Element ? eventTarget : null;
		if (target && !root.contains(target)) {
			ignoreTouchSwipe = true;
			touchState = null;
			return;
		}

		getVirtualKeyboard()?.onTouchStart(event);

		ignoreTouchSwipe = isSwipeIgnoredTarget(elementAtPoint);
		if (ignoreTouchSwipe) {
			touchState = null;
			return;
		}

		const direction = getDirection();
		const scrollAxis = getScrollAxis(direction);
		const crossAxis = getCrossScrollAxis(direction);

		let scrollTarget: HTMLElement | null = null;
		let hasCrossAxisScrollableContent = false;
		if (target) {
			scrollTarget = findScrollableTouchTarget(target, root, scrollAxis);
			hasCrossAxisScrollableContent = findScrollableTouchTarget(target, root, crossAxis) !== null;
		}

		let allowSwipe: boolean | null = null;
		if (scrollTarget) {
			const canSwipeFromEdge = isAtSwipeStartEdge(scrollTarget, scrollAxis, direction);
			allowSwipe = canSwipeFromEdge ? null : false;
		}

		touchState = {
			startX: touch.clientX,
			startY: touch.clientY,
			lastX: touch.clientX,
			lastY: touch.clientY,
			scrollTarget,
			hasCrossAxisScrollableContent,
			allowSwipe,
			preserveNativeCrossAxisScroll: false
		};

		options.swipeGesture.touch.start(event);
	}

	function handleTouchEnd(event: TouchEvent) {
		getVirtualKeyboard()?.onTouchEnd(event);
		resetTrackingState();
		options.swipeGesture.touch.end(event);
	}

	function handleTouchCancel(event: TouchEvent) {
		getVirtualKeyboard()?.onTouchCancel();
		resetTrackingState();
		options.swipeGesture.touch.cancel(event);
	}

	/**
	 * Set up the capture-phase native touchmove listener.
	 * Call inside an $effect — returns the cleanup function.
	 */
	function setupNativeTouchMoveListener(root: HTMLElement) {
		const doc = root.ownerDocument;
		doc.addEventListener('touchmove', handleNativeTouchMove, {
			passive: false,
			capture: true
		});
		return () => {
			doc.removeEventListener('touchmove', handleNativeTouchMove, {
				capture: true
			} as EventListenerOptions);
		};
	}

	return {
		notePointerDown,
		notePointerSettled,
		handlers: {
			ontouchstart: handleTouchStart,
			ontouchend: handleTouchEnd,
			ontouchcancel: handleTouchCancel
		},
		setupNativeTouchMoveListener,
		reset: resetTrackingState
	};
}

// --- Helpers ---

function updateTouchPosition(ts: TouchScrollState, touch: Touch) {
	ts.lastX = touch.clientX;
	ts.lastY = touch.clientY;
}

function preserveNativeCrossAxisScrollOnMove(
	ts: TouchScrollState,
	touch: Touch,
	isVerticalAxis: boolean
): boolean {
	if (ts.preserveNativeCrossAxisScroll) return true;

	if (ts.allowSwipe === true || !ts.hasCrossAxisScrollableContent) return false;

	const drawerAxisGestureDelta = isVerticalAxis
		? touch.clientY - ts.startY
		: touch.clientX - ts.startX;
	const crossAxisGestureDelta = isVerticalAxis
		? touch.clientX - ts.startX
		: touch.clientY - ts.startY;
	const absDrawerDelta = Math.abs(drawerAxisGestureDelta);
	const absCrossDelta = Math.abs(crossAxisGestureDelta);

	if (absCrossDelta < 6 || absCrossDelta <= absDrawerDelta + 2) return false;

	ts.preserveNativeCrossAxisScroll = true;
	return true;
}
