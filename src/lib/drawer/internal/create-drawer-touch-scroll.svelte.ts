/**
 * Touch scroll handler for the drawer viewport.
 *
 * This is the critical piece for mobile. It intercepts native touch events
 * to decide whether to allow native scrolling (inside scrollable content)
 * or to capture the gesture for the drawer swipe.
 *
 * Ported from base-ui's DrawerViewport touch handling.
 * Uses native addEventListener with {passive: false, capture: true} for
 * reliable preventDefault on iOS Safari.
 */
import { untrack } from "svelte";
import type { SwipeGesture } from "./create-swipe-gesture.svelte.js";
import {
	type SwipeDirection,
	type ScrollAxis,
	findScrollableTarget,
	hasScrollableContentOnAxis,
	isAtSwipeStartEdge,
	canSwipeFromScrollEdgeOnMove,
	isSwipeIgnoredTarget,
	isEventOnRangeInput,
	shouldIgnoreSwipeForTextSelection,
	getElementAtPoint,
	getScrollAxis,
	getCrossScrollAxis,
} from "./utils.js";

interface TouchScrollState {
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	scrollTarget: HTMLElement | null;
	hasCrossAxisScrollableContent: boolean;
	/** null = undecided, true = allow swipe, false = disallow swipe */
	allowSwipe: boolean | null;
	preserveNativeCrossAxisScroll: boolean;
}

export interface DrawerTouchScrollOptions {
	/** The root element (viewport/popup) to listen on */
	rootElement: () => HTMLElement | null;
	/** Whether the drawer is open and mounted */
	active: () => boolean;
	/** The primary swipe direction */
	swipeDirection: () => SwipeDirection;
	/** The swipe gesture instance to forward events to */
	swipeGesture: SwipeGesture;
}

/**
 * Creates the touch scroll interception layer.
 * Returns a cleanup function and event handlers for onTouchStart.
 *
 * Must be called inside a component with $effect for lifecycle.
 */
export function createDrawerTouchScroll(options: DrawerTouchScrollOptions) {
	let ignoreTouchSwipe = false;
	let touchState: TouchScrollState | null = null;
	let lastPointerType: string = "";
	let ignoreNextTouchStartFromPen = false;

	function resetTrackingState() {
		ignoreTouchSwipe = false;
		touchState = null;
		lastPointerType = "";
		ignoreNextTouchStartFromPen = false;
	}

	/**
	 * Native touchmove handler.
	 * Registered via addEventListener with {passive: false, capture: true}
	 * so we can reliably call preventDefault to block window scrolling.
	 */
	function handleNativeTouchMove(event: TouchEvent) {
		if (ignoreTouchSwipe) return;

		const ts = touchState;
		const touch = event.touches[0];
		if (!touch || !ts) return;

		const direction = untrack(options.swipeDirection);
		const scrollAxis = getScrollAxis(direction);
		const isVertical = scrollAxis === "vertical";

		const drawerAxisDelta = isVertical
			? touch.clientY - ts.lastY
			: touch.clientX - ts.lastX;

		// Preserve native range input interaction
		if (isEventOnRangeInput(event)) {
			ts.allowSwipe = false;
			updateTouchPosition(ts, touch);
			return;
		}

		// Don't block pinch zoom (2+ fingers)
		if (event.touches.length >= 2) {
			updateTouchPosition(ts, touch);
			return;
		}

		const root = untrack(options.rootElement);
		if (!root) return;
		const doc = root.ownerDocument;
		const active = untrack(options.active);

		// Allow touch move if there's text selection or drawer isn't active
		if (shouldIgnoreSwipeForTextSelection(doc, root) || !active) {
			updateTouchPosition(ts, touch);
			return;
		}

		// Preserve native cross-axis scroll (e.g. horizontal scroll in a bottom drawer)
		if (preserveNativeCrossAxisScrollOnMove(ts, touch, isVertical)) {
			updateTouchPosition(ts, touch);
			return;
		}

		const scrollTarget = ts.scrollTarget;

		// No scroll target or body/html → always prevent default (block window scroll)
		if (!scrollTarget || scrollTarget === doc.documentElement || scrollTarget === doc.body) {
			if (event.cancelable) {
				event.preventDefault();
			}
			updateTouchPosition(ts, touch);
			return;
		}

		// If scroll target doesn't have scrollable content on the drawer axis,
		// prevent window from scrolling
		if (!hasScrollableContentOnAxis(scrollTarget, scrollAxis)) {
			if (event.cancelable) {
				event.preventDefault();
			}
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

			if (ts.allowSwipe === null) {
				// Haven't decided yet
				if (!event.cancelable) {
					ts.allowSwipe = false;
				} else if (canSwipeFromEdge) {
					ts.allowSwipe = true;
					event.preventDefault();
				} else {
					ts.allowSwipe = false;
				}
			} else if (ts.allowSwipe && event.cancelable) {
				event.preventDefault();
			}
		}

		updateTouchPosition(ts, touch);
	}

	// --- Event handlers to spread on the viewport element ---

	function handlePointerDown(event: PointerEvent) {
		lastPointerType = event.pointerType;
		ignoreNextTouchStartFromPen = event.pointerType === "pen";
	}

	function handleTouchStart(event: TouchEvent) {
		// Pen-initiated touch: skip our custom handling
		if (lastPointerType === "pen" && ignoreNextTouchStartFromPen) {
			ignoreNextTouchStartFromPen = false;
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		const active = untrack(options.active);
		if (!active) {
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		const touch = event.touches[0];
		if (!touch) return;

		// Check for range input
		if (isEventOnRangeInput(event)) {
			ignoreTouchSwipe = false;
			touchState = null;
			return;
		}

		const root = untrack(options.rootElement);
		if (!root) return;
		const doc = root.ownerDocument;

		const elementAtPoint = getElementAtPoint(doc, touch.clientX, touch.clientY);

		// Check if target has data-drawer-no-swipe
		ignoreTouchSwipe = isSwipeIgnoredTarget(elementAtPoint);
		if (ignoreTouchSwipe) {
			touchState = null;
			return;
		}

		// Check if touch is inside the root element
		const eventTarget = event.target;
		if (eventTarget instanceof Element && !root.contains(eventTarget)) {
			ignoreTouchSwipe = true;
			touchState = null;
			return;
		}

		const direction = untrack(options.swipeDirection);
		const scrollAxis = getScrollAxis(direction);
		const crossAxis = getCrossScrollAxis(direction);

		// Find nearest scrollable ancestor on both axes
		const target = eventTarget instanceof Element ? eventTarget : null;
		let scrollTarget: HTMLElement | null = null;
		let hasCrossAxisScrollableContent = false;
		if (target) {
			scrollTarget = findScrollableTarget(target, root, scrollAxis);
			hasCrossAxisScrollableContent =
				findScrollableTarget(target, root, crossAxis) !== null;
		}

		// Determine initial allowSwipe state
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
			preserveNativeCrossAxisScroll: false,
		};

		// Forward to swipe gesture
		options.swipeGesture.touch.start(event);
	}

	function handleTouchMove(event: TouchEvent) {
		if (ignoreTouchSwipe) return;
		if (isEventOnRangeInput(event)) return;

		const ts = touchState;
		if (!ts) return;

		// If we decided to preserve cross-axis scroll, don't forward
		if (ts.preserveNativeCrossAxisScroll) return;

		// If we decided swipe is not allowed, don't forward
		if (ts.allowSwipe === false) return;

		// If there's a scroll target but we haven't decided yet, don't forward
		if (ts.scrollTarget !== null && ts.allowSwipe === null) return;

		// Forward to swipe gesture
		options.swipeGesture.touch.move(event);
	}

	function handleTouchEnd(event: TouchEvent) {
		resetTrackingState();
		options.swipeGesture.touch.end(event);
	}

	function handleTouchCancel(event: TouchEvent) {
		resetTrackingState();
		options.swipeGesture.touch.cancel(event);
	}

	/**
	 * Set up the native touchmove listener.
	 * Must be called inside an $effect to get cleanup.
	 */
	function setupNativeTouchMoveListener(root: HTMLElement) {
		const doc = root.ownerDocument;
		doc.addEventListener("touchmove", handleNativeTouchMove, {
			passive: false,
			capture: true,
		});
		return () => {
			doc.removeEventListener("touchmove", handleNativeTouchMove, {
				capture: true,
			} as EventListenerOptions);
		};
	}

	return {
		/** Spread these on the viewport element */
		handlers: {
			onpointerdown: handlePointerDown,
			ontouchstart: handleTouchStart,
			ontouchmove: handleTouchMove,
			ontouchend: handleTouchEnd,
			ontouchcancel: handleTouchCancel,
		},
		/** Call inside $effect — returns cleanup fn */
		setupNativeTouchMoveListener,
		/** Reset all tracking state */
		reset: resetTrackingState,
	};
}

// --- Helper functions ---

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

	const drawerDelta = isVerticalAxis
		? touch.clientY - ts.startY
		: touch.clientX - ts.startX;
	const crossDelta = isVerticalAxis
		? touch.clientX - ts.startX
		: touch.clientY - ts.startY;
	const absDraer = Math.abs(drawerDelta);
	const absCross = Math.abs(crossDelta);

	if (absCross < 6 || absCross <= absDraer + 2) return false;

	ts.preserveNativeCrossAxisScroll = true;
	return true;
}
