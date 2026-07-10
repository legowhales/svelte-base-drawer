/**
 * Core swipe gesture engine.
 * Ported from base-ui's useSwipeDismiss.
 *
 * Handles both pointer (desktop) and touch (mobile) events with separate paths.
 * Touch events use native addEventListener with {passive: false} for reliable
 * preventDefault to control scroll behavior.
 */
import { untrack } from "svelte";
import {
	clamp,
	getDisplacement,
	getElementTransform,
	applyDirectionalDamping,
	type SwipeDirection,
} from "./utils.js";

// --- Constants (calibrated from base-ui) ---
const DEFAULT_SWIPE_THRESHOLD = 40;
const REVERSE_CANCEL_THRESHOLD = 10;
const MIN_VELOCITY_DURATION_MS = 50;
const MIN_RELEASE_VELOCITY_DURATION_MS = 16;
const MAX_RELEASE_VELOCITY_AGE_MS = 80;
const SWIPE_ACTIVATION_THRESHOLD = 1;
const IGNORE_SELECTOR = 'button,a,input,select,textarea,label,[role="button"]';

export interface SwipeGestureOptions {
	/** Reactive getter: is the gesture system enabled */
	enabled: () => boolean;
	/** Which directions to allow swiping */
	directions: () => SwipeDirection[];
	/** Reactive getter: the popup element ref */
	popupElement: () => HTMLElement | null;
	/** Pixels of movement before swipe activates */
	swipeThreshold?: number | ((opts: { element: HTMLElement; direction: SwipeDirection }) => number);
	/** CSS var names to update during drag */
	movementCssVars?: { x: string; y: string };
	/** Called when swipe starts (passed the native event) */
	onSwipeStart?: (event: PointerEvent | TouchEvent) => void;
	/** Called on each progress update (0-1) with details */
	onProgress?: (
		progress: number,
		details: { deltaX: number; deltaY: number; direction: SwipeDirection | undefined }
	) => void;
	/** Called when swiping state changes */
	onSwipingChange?: (swiping: boolean) => void;
	/** Called on release, return true to dismiss, false to cancel */
	onRelease?: (info: SwipeReleaseInfo) => boolean | undefined;
	/** Called when swipe should dismiss */
	onDismiss?: (event: PointerEvent | TouchEvent) => void;
	/** Whether to ignore interactive elements on touch (default: true) */
	ignoreSelectorWhenTouch?: boolean;
	/** Whether to track CSS transform drag (default: true) */
	trackDrag?: boolean;
	/** Called to check if swipe can start at position */
	canStart?: (
		position: { x: number; y: number },
		event: PointerEvent | TouchEvent
	) => boolean;
}

export interface SwipeReleaseInfo {
	event: PointerEvent | TouchEvent;
	deltaX: number;
	deltaY: number;
	direction: SwipeDirection | undefined;
	velocityX: number;
	velocityY: number;
	releaseVelocityX: number;
	releaseVelocityY: number;
}

interface DragSample {
	x: number;
	y: number;
	time: number;
}

export function createSwipeGesture(options: SwipeGestureOptions) {
	const {
		movementCssVars,
		swipeThreshold: swipeThresholdProp = DEFAULT_SWIPE_THRESHOLD,
		ignoreSelectorWhenTouch = true,
		trackDrag = true,
	} = options;

	// --- Reactive state ---
	let swiping = $state(false);
	let currentDirection = $state<SwipeDirection | undefined>(undefined);
	let dragDismissed = $state(false);

	// --- Plain (non-reactive) tracking state ---
	let dragStartPos = { x: 0, y: 0 };
	let dragOffset = { x: 0, y: 0 };
	let lastMovePos: { x: number; y: number } | null = null;
	let initialTransform = { x: 0, y: 0, scale: 1 };
	let intendedDirection: SwipeDirection | undefined = undefined;
	let maxSwipeDisplacement = 0;
	let cancelledSwipe = false;
	let swipeCancelBaseline = { x: 0, y: 0 };
	let isFirstPointerMove = false;
	let pendingSwipe = false;
	let pendingSwipeStartPos: { x: number; y: number } | null = null;
	let swipeFromScrollable = false;
	let sawPrimaryButtonsOnMove = false;
	let elementSize = { width: 0, height: 0 };
	let swipeProgressValue = 0;
	let swipeThreshold = typeof swipeThresholdProp === "number" ? swipeThresholdProp : DEFAULT_SWIPE_THRESHOLD;
	let swipeStartTime: number | null = null;
	let lastDragSample: DragSample | null = null;
	let lastDragVelocity = { x: 0, y: 0 };
	let lastProgressDetails: { deltaX: number; deltaY: number; direction: SwipeDirection | undefined } | null = null;
	let isSwipingInternal = false;
	let lockedAxis: "horizontal" | "vertical" | null = null;

	// Release velocity tracking
	let releaseVelocitySamples: DragSample[] = [];

	function getDirections(): SwipeDirection[] {
		return untrack(options.directions);
	}

	function getPopupElement(): HTMLElement | null {
		return untrack(options.popupElement);
	}

	function setSwiping(next: boolean) {
		if (isSwipingInternal === next) return;
		isSwipingInternal = next;
		swiping = next;
		options.onSwipingChange?.(next);
	}

	function resolveSwipeThreshold(direction: SwipeDirection | undefined) {
		if (!direction) return;
		if (typeof swipeThresholdProp !== "function") {
			swipeThreshold = typeof swipeThresholdProp === "number" ? swipeThresholdProp : DEFAULT_SWIPE_THRESHOLD;
			return;
		}
		const element = getPopupElement();
		if (!element) return;
		swipeThreshold = Math.max(0, swipeThresholdProp({ element, direction }));
	}

	function updateSwipeProgress(
		progress: number,
		details?: { deltaX: number; deltaY: number; direction: SwipeDirection | undefined }
	) {
		const next = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
		const progressChanged = next !== swipeProgressValue;
		let detailsChanged = false;

		if (details) {
			const last = lastProgressDetails;
			detailsChanged =
				!last ||
				last.deltaX !== details.deltaX ||
				last.deltaY !== details.deltaY ||
				last.direction !== details.direction;
		}

		if (!progressChanged && !detailsChanged) return;

		swipeProgressValue = next;
		if (details) {
			lastProgressDetails = details;
		} else if (progressChanged) {
			lastProgressDetails = null;
		}
		options.onProgress?.(next, details ?? { deltaX: dragOffset.x, deltaY: dragOffset.y, direction: currentDirection });
	}

	function recordDragSample(offset: { x: number; y: number }, timeStamp: number | null) {
		if (timeStamp === null) return;

		const last = lastDragSample;
		if (last && timeStamp > last.time) {
			const durationMs = Math.max(timeStamp - last.time, MIN_RELEASE_VELOCITY_DURATION_MS);
			lastDragVelocity = {
				x: (offset.x - last.x) / durationMs,
				y: (offset.y - last.y) / durationMs,
			};
		}

		lastDragSample = { x: offset.x, y: offset.y, time: timeStamp };

		// Track release velocity samples (keep recent ones)
		releaseVelocitySamples.push({ x: offset.x, y: offset.y, time: timeStamp });
		// Prune old samples
		while (
			releaseVelocitySamples.length > 2 &&
			timeStamp - releaseVelocitySamples[0].time > MAX_RELEASE_VELOCITY_AGE_MS
		) {
			releaseVelocitySamples.shift();
		}
	}

	function computeReleaseVelocity(): { x: number; y: number } {
		if (releaseVelocitySamples.length < 2) {
			return lastDragVelocity;
		}
		const first = releaseVelocitySamples[0];
		const last = releaseVelocitySamples[releaseVelocitySamples.length - 1];
		const dt = Math.max(last.time - first.time, MIN_RELEASE_VELOCITY_DURATION_MS);
		return {
			x: (last.x - first.x) / dt,
			y: (last.y - first.y) / dt,
		};
	}

	function resolveDirection(dx: number, dy: number): SwipeDirection | undefined {
		const dirs = getDirections();
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		if (dirs.length === 1) return dirs[0];

		const hasH = dirs.includes("left") || dirs.includes("right");
		const hasV = dirs.includes("up") || dirs.includes("down");

		if (hasH && hasV) {
			// Lock to axis with more movement
			if (absDx > absDy) {
				return dx < 0 ? "left" : "right";
			}
			return dy < 0 ? "up" : "down";
		}

		if (hasH) return dx < 0 ? "left" : "right";
		if (hasV) return dy < 0 ? "up" : "down";
		return undefined;
	}

	function updateDragCssVars(offset: { x: number; y: number }) {
		if (!movementCssVars || !trackDrag) return;
		const element = getPopupElement();
		if (!element) return;
		element.style.setProperty(movementCssVars.x, `${offset.x}px`);
		element.style.setProperty(movementCssVars.y, `${offset.y}px`);
	}

	function clearDragCssVars() {
		if (!movementCssVars) return;
		const element = getPopupElement();
		if (!element) return;
		element.style.setProperty(movementCssVars.x, "0px");
		element.style.setProperty(movementCssVars.y, "0px");
	}

	// --- Start swipe ---
	function handleSwipeStart(clientX: number, clientY: number, event: PointerEvent | TouchEvent) {
		if (!untrack(options.enabled)) return false;

		const element = getPopupElement();
		if (!element) return false;

		if (
			options.canStart &&
			!options.canStart({ x: clientX, y: clientY }, event)
		) {
			return false;
		}

		const transform = getElementTransform(element);
		initialTransform = transform;
		dragStartPos = { x: clientX, y: clientY };
		dragOffset = { x: 0, y: 0 };
		lastMovePos = null;
		intendedDirection = undefined;
		maxSwipeDisplacement = 0;
		cancelledSwipe = false;
		swipeCancelBaseline = { x: 0, y: 0 };
		isFirstPointerMove = true;
		pendingSwipe = true;
		pendingSwipeStartPos = { x: clientX, y: clientY };
		swipeFromScrollable = false;
		sawPrimaryButtonsOnMove = false;
		swipeProgressValue = 0;
		swipeStartTime = null;
		lastDragSample = null;
		lastDragVelocity = { x: 0, y: 0 };
		releaseVelocitySamples = [];
		lockedAxis = null;
		dragDismissed = false;

		elementSize = {
			width: element.offsetWidth,
			height: element.offsetHeight,
		};

		options.onSwipeStart?.(event);
		return true;
	}

	// --- Move swipe ---
	function handleSwipeMove(clientX: number, clientY: number, timeStamp: number) {
		if (!pendingSwipe && !isSwipingInternal) return;

		// Compensate for iOS delay between pointerdown and first pointermove
		if (isFirstPointerMove) {
			isFirstPointerMove = false;
			dragStartPos = { x: clientX, y: clientY };
		}

		const dx = clientX - dragStartPos.x;
		const dy = clientY - dragStartPos.y;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		// Direction locking on first significant movement
		if (!lockedAxis) {
			const dirs = getDirections();
			const hasH = dirs.includes("left") || dirs.includes("right");
			const hasV = dirs.includes("up") || dirs.includes("down");

			if (hasH && hasV) {
				if (absDx > 6 || absDy > 6) {
					lockedAxis = absDx > absDy ? "horizontal" : "vertical";
				}
			} else if (hasH) {
				lockedAxis = "horizontal";
			} else {
				lockedAxis = "vertical";
			}
		}

		// Resolve direction
		const direction = resolveDirection(dx, dy);
		if (direction && intendedDirection === undefined) {
			intendedDirection = direction;
			resolveSwipeThreshold(direction);
		}

		// Check if we've passed the threshold to start swiping
		if (pendingSwipe && !isSwipingInternal) {
			const threshold = SWIPE_ACTIVATION_THRESHOLD;
			const axisDelta = lockedAxis === "horizontal" ? absDx : absDy;
			if (axisDelta < threshold) return;

			// Activate swiping
			pendingSwipe = false;
			swipeStartTime = timeStamp;
			setSwiping(true);
		}

		if (!isSwipingInternal) return;

		// Constrain movement based on locked axis
		let constrainedDx = lockedAxis === "vertical" ? 0 : dx;
		let constrainedDy = lockedAxis === "horizontal" ? 0 : dy;

		// Rubber-band damping when swiping against the dismiss direction
		if (intendedDirection) {
			const damped = applyDirectionalDamping(intendedDirection, constrainedDx, constrainedDy);
			constrainedDx = damped.x;
			constrainedDy = damped.y;
		}

		// Check for reverse cancel
		if (direction && intendedDirection) {
			const displacement = getDisplacement(intendedDirection, constrainedDx, constrainedDy);
			maxSwipeDisplacement = Math.max(maxSwipeDisplacement, displacement);

			if (!cancelledSwipe && displacement < maxSwipeDisplacement - REVERSE_CANCEL_THRESHOLD) {
				cancelledSwipe = true;
				swipeCancelBaseline = { x: constrainedDx, y: constrainedDy };
			}

			if (cancelledSwipe) {
				const recoveryDisplacement = getDisplacement(
					intendedDirection,
					constrainedDx - swipeCancelBaseline.x,
					constrainedDy - swipeCancelBaseline.y
				);
				if (recoveryDisplacement > REVERSE_CANCEL_THRESHOLD) {
					cancelledSwipe = false;
					maxSwipeDisplacement = displacement;
				}
			}
		}

		dragOffset = { x: constrainedDx, y: constrainedDy };
		recordDragSample(dragOffset, timeStamp);

		// Update CSS vars
		updateDragCssVars(dragOffset);

		// Update current direction
		currentDirection = direction;

		// Calculate progress
		const element = getPopupElement();
		if (element && direction) {
			const size =
				direction === "left" || direction === "right"
					? element.offsetWidth
					: element.offsetHeight;
			if (size > 0) {
				const displacement = getDisplacement(direction, constrainedDx, constrainedDy);
				const progress = clamp(displacement / size, 0, 1);
				updateSwipeProgress(progress, {
					deltaX: constrainedDx,
					deltaY: constrainedDy,
					direction,
				});
			}
		}

		lastMovePos = { x: clientX, y: clientY };
	}

	// --- End swipe ---
	function handleSwipeEnd(event: PointerEvent | TouchEvent, timeStamp: number) {
		if (!isSwipingInternal && !pendingSwipe) return;

		pendingSwipe = false;
		pendingSwipeStartPos = null;

		if (!isSwipingInternal) {
			reset();
			return;
		}

		const direction = currentDirection;
		const releaseVelocity = computeReleaseVelocity();

		const releaseInfo: SwipeReleaseInfo = {
			event,
			deltaX: dragOffset.x,
			deltaY: dragOffset.y,
			direction,
			velocityX: lastDragVelocity.x,
			velocityY: lastDragVelocity.y,
			releaseVelocityX: releaseVelocity.x,
			releaseVelocityY: releaseVelocity.y,
		};

		const shouldDismiss = options.onRelease?.(releaseInfo);

		if (shouldDismiss === true) {
			dragDismissed = true;
			options.onDismiss?.(event);
		} else {
			// Animate back
			clearDragCssVars();
			updateSwipeProgress(0);
		}

		setSwiping(false);
		currentDirection = undefined;
	}

	// --- Reset ---
	function reset() {
		pendingSwipe = false;
		pendingSwipeStartPos = null;
		setSwiping(false);
		currentDirection = undefined;
		dragOffset = { x: 0, y: 0 };
		lastMovePos = null;
		dragDismissed = false;
		swipeProgressValue = 0;
		lastProgressDetails = null;
		clearDragCssVars();
	}

	// --- Pointer event handlers (desktop) ---
	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === "touch") return; // handled by touch events
		if (event.button !== 0) return;

		handleSwipeStart(event.clientX, event.clientY, event);

		if (pendingSwipe) {
			const popup = getPopupElement();
			if (popup) {
				try { popup.setPointerCapture(event.pointerId); }
				catch { /* ignore */ }
			}
		}
	}

	function onPointerMove(event: PointerEvent) {
		if (event.pointerType === "touch") return;
		if (!pendingSwipe && !isSwipingInternal) return;

		// Check button is still pressed
		if (event.buttons === 0) {
			handleSwipeEnd(event, event.timeStamp);
			return;
		}

		handleSwipeMove(event.clientX, event.clientY, event.timeStamp);
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerType === "touch") return;
		const popup = getPopupElement();
		if (popup) {
			try { popup.releasePointerCapture(event.pointerId); }
			catch { /* ignore */ }
		}
		handleSwipeEnd(event, event.timeStamp);
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerType === "touch") return;
		const popup = getPopupElement();
		if (popup) {
			try { popup.releasePointerCapture(event.pointerId); }
			catch { /* ignore */ }
		}
		reset();
	}

	// --- Touch event handlers (mobile) ---
	// These are designed to be called from the drawer's touch scroll handler,
	// which decides whether to forward events or let native scroll happen.

	function onTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch) return;
		handleSwipeStart(touch.clientX, touch.clientY, event);
	}

	function onTouchMove(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch) return;
		handleSwipeMove(touch.clientX, touch.clientY, event.timeStamp);
	}

	function onTouchEnd(event: TouchEvent) {
		handleSwipeEnd(event, event.timeStamp);
	}

	function onTouchCancel(_event: TouchEvent) {
		reset();
	}

	return {
		get swiping() { return swiping; },
		get direction() { return currentDirection; },
		get dismissed() { return dragDismissed; },
		get progress() { return swipeProgressValue; },
		get deltaX() { return dragOffset.x; },
		get deltaY() { return dragOffset.y; },
		reset,
		// Pointer handlers (spread on the element for desktop)
		pointerHandlers: {
			onpointerdown: onPointerDown,
			onpointermove: onPointerMove,
			onpointerup: onPointerUp,
			onpointercancel: onPointerCancel,
		},
		// Touch handlers (called selectively by the touch scroll manager)
		touch: {
			start: onTouchStart,
			move: onTouchMove,
			end: onTouchEnd,
			cancel: onTouchCancel,
		},
	};
}

export type SwipeGesture = ReturnType<typeof createSwipeGesture>;
