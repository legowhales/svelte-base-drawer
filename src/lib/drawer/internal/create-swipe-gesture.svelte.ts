/**
 * Core swipe gesture engine.
 * Faithful port of base-ui v1.9.0 `useSwipeDismiss` adapted to Svelte 5.
 *
 * Key behaviors (mirroring upstream):
 * - The swipe starts immediately on pointerdown/touchstart when allowed; when the
 *   gesture begins on a scrollable target it stays "pending" and is re-attempted
 *   on each move with scroll-edge checks. Starting from a scroll edge preserves
 *   the original start position so quick flicks can dismiss.
 * - The current element transform (translate + scale) is snapshotted at swipe
 *   start and composed into the drag transform, so grabbing the popup
 *   mid-animation doesn't make it jump.
 * - A `buttons === 0` pointermove after a primary press is treated as the release
 *   (mirroring touchend): the move flows through the pipeline first so its
 *   displacement and velocity are committed, then the gesture ends (#5057).
 * - A non-primary button pressed mid-drag cancels the swipe.
 * - Inline transition/transform are snapshotted before the drag and restored on
 *   release so the CSS transition takes over (snap back or dismiss).
 */
import { untrack } from 'svelte';
import {
	clamp,
	closest,
	getDisplacement,
	getDragTransform,
	getElementAtPoint,
	getElementTransform,
	getEventTarget,
	getValidTimeStamp,
	findScrollableAncestor,
	findScrollableTouchTarget,
	hasPrimaryMouseButton,
	isHTMLElement,
	safelyChangePointerCapture,
	type ScrollAxis,
	type SwipeDirection
} from './utils.js';

const DEFAULT_SWIPE_THRESHOLD = 40;
const REVERSE_CANCEL_THRESHOLD = 10;
const MIN_VELOCITY_DURATION_MS = 50;
// Under one frame at 240 Hz, so it only damps near-simultaneous samples.
const MIN_RELEASE_VELOCITY_DURATION_MS = 4;
const MAX_RELEASE_VELOCITY_AGE_MS = 80;
const MIN_VELOCITY_SAMPLE_DISTANCE = 1;
const DEFAULT_IGNORE_SELECTOR = 'button,a,input,select,textarea,label,[role="button"]';

export interface SwipeProgressDetails {
	deltaX: number;
	deltaY: number;
	direction: SwipeDirection | undefined;
}

export interface SwipeReleaseInfo {
	event: PointerEvent | TouchEvent;
	direction: SwipeDirection | undefined;
	deltaX: number;
	deltaY: number;
	velocityX: number;
	velocityY: number;
	releaseVelocityX: number;
	releaseVelocityY: number;
}

export interface SwipeGestureOptions {
	/** Reactive getter: is the gesture system enabled */
	enabled: () => boolean;
	/** Reactive getter: which directions can be swiped */
	directions: () => SwipeDirection[];
	/** Reactive getter: the element being swiped (the popup) */
	element: () => HTMLElement | null;
	/** CSS var names updated with the drag delta during a swipe */
	movementCssVars: { x: string; y: string };
	/** Minimum displacement (px) before a release dismisses (default threshold path) */
	swipeThreshold?:
		number | ((details: { element: HTMLElement; direction: SwipeDirection }) => number);
	/**
	 * If provided, swiping only begins once this returns true.
	 * Evaluated on start and on subsequent moves while the pointer is down.
	 */
	canStart?: (
		position: { x: number; y: number },
		details: { nativeEvent: PointerEvent | TouchEvent; direction: SwipeDirection | undefined }
	) => boolean;
	/** If true, swiping won't start when the gesture begins within a scrollable ancestor. */
	ignoreScrollableAncestors?: boolean;
	/** If false, touch interactions can start swiping on interactive elements. */
	ignoreSelectorWhenTouch?: boolean;
	/** Whether to apply drag transform/vars imperatively during a swipe. */
	trackDrag?: boolean;
	onSwipeStart?: (event: PointerEvent | TouchEvent) => void;
	onProgress?: (progress: number, details?: SwipeProgressDetails) => void;
	onCancel?: (event: PointerEvent | TouchEvent) => void;
	onSwipingChange?: (swiping: boolean) => void;
	/** Return true/false to override the default dismissal decision. */
	onRelease?: (details: SwipeReleaseInfo) => boolean | void;
	onDismiss?: (event: PointerEvent | TouchEvent, details: { direction: SwipeDirection }) => void;
}

interface DragSample {
	x: number;
	y: number;
	time: number;
}

export function createSwipeGesture(options: SwipeGestureOptions) {
	const {
		movementCssVars,
		swipeThreshold: swipeThresholdProp,
		ignoreSelectorWhenTouch = true,
		ignoreScrollableAncestors = false,
		trackDrag = true
	} = options;

	const swipeThresholdDefault = Math.max(
		0,
		typeof swipeThresholdProp === 'number' ? swipeThresholdProp : DEFAULT_SWIPE_THRESHOLD
	);

	// --- Reactive state ---
	let swiping = $state(false);
	let currentSwipeDirection = $state<SwipeDirection | undefined>(undefined);
	let dragDismissed = $state(false);

	// --- Plain tracking state (imperative, never triggers renders) ---
	let dragStartPos = { x: 0, y: 0 };
	// Absolute transform-space offset: starts at the element's initial transform.
	let dragOffset = { x: 0, y: 0 };
	let lastMovePos: { x: number; y: number } | null = null;
	let initialTransform = { x: 0, y: 0, scale: 1 };
	let intendedSwipeDirection: SwipeDirection | undefined = undefined;
	let maxSwipeDisplacement = 0;
	let cancelledSwipe = false;
	// Client-coordinate baseline, re-anchored whenever the movement reverses.
	let swipeCancelBaseline = { x: 0, y: 0 };
	let isFirstPointerMove = false;
	let pendingSwipe = false;
	let pendingSwipeStartPos: { x: number; y: number } | null = null;
	let swipeFromScrollable = false;
	let sawPrimaryButtonsOnMove = false;
	let elementSize = { width: 0, height: 0 };
	let swipeProgress = 0;
	let swipeThreshold = swipeThresholdDefault;
	let swipeThresholdFunction:
		| ((details: { element: HTMLElement; direction: SwipeDirection }) => number)
		| null = null;
	let swipeStartTime: number | null = null;
	let lastDragSample: DragSample | null = null;
	let hasStationarySample = false;
	let lastDragVelocity = { x: 0, y: 0 };
	let lastProgressDetails: SwipeProgressDetails | null = null;
	let isSwipingInternal = false;
	let dragStyleSnapshot: [string, string] | null = null;

	function getElement(): HTMLElement | null {
		return untrack(options.element);
	}

	function isEnabled(): boolean {
		return untrack(options.enabled);
	}

	// Direction booleans, resolved per call since `directions` is reactive.
	// Consumers only pass directions on a single axis.
	function getDirectionState() {
		const directions = untrack(options.directions);
		const allowLeft = directions.includes('left');
		const allowRight = directions.includes('right');
		const allowUp = directions.includes('up');
		const allowDown = directions.includes('down');
		const hasHorizontal = allowLeft || allowRight;
		const hasVertical = allowUp || allowDown;
		const scrollAxis: ScrollAxis = hasHorizontal ? 'horizontal' : 'vertical';
		return {
			directions,
			allowLeft,
			allowRight,
			allowUp,
			allowDown,
			hasHorizontal,
			hasVertical,
			scrollAxis,
			primaryDirection: directions.length === 1 ? directions[0] : undefined
		};
	}

	function setSwiping(next: boolean) {
		if (isSwipingInternal === next) return;
		isSwipingInternal = next;
		swiping = next;
		options.onSwipingChange?.(next);
	}

	function resolveSwipeThreshold(direction: SwipeDirection | undefined) {
		if (!direction) return;

		const element = getElement();
		const thresholdFunction = swipeThresholdFunction;
		if (!element || !thresholdFunction) return;

		swipeThreshold = Math.max(0, thresholdFunction({ element, direction }));
	}

	function updateSwipeProgress(progress: number, details?: SwipeProgressDetails) {
		const nextProgress = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
		const progressChanged = nextProgress !== swipeProgress;
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

		swipeProgress = nextProgress;
		if (details) {
			lastProgressDetails = details;
		} else if (progressChanged) {
			lastProgressDetails = null;
		}
		options.onProgress?.(nextProgress, details);
	}

	/**
	 * Imperatively sync the element's inline drag styles.
	 * While swiping: snapshot the existing inline transition/transform once,
	 * force `transition: none` and apply the composed drag transform.
	 * On release: restore the snapshot so the CSS transition takes over.
	 * CSS movement vars always reflect the drag delta (offset − initial transform).
	 */
	function syncDragStyles(nextSwiping: boolean) {
		const element = getElement();
		if (!trackDrag || !element) {
			if (!nextSwiping) {
				dragStyleSnapshot = null;
			}
			return;
		}

		const style = element.style;
		if (nextSwiping) {
			if (!dragStyleSnapshot) {
				dragStyleSnapshot = [style.transition, style.transform];
			}
			style.transition = 'none';
		} else if (dragStyleSnapshot) {
			[style.transition, style.transform] = dragStyleSnapshot;
			dragStyleSnapshot = null;
		}

		const deltaX = dragOffset.x - initialTransform.x;
		const deltaY = dragOffset.y - initialTransform.y;

		if (nextSwiping) {
			style.transform = getDragTransform(dragOffset, initialTransform.scale);
		}

		style.setProperty(movementCssVars.x, `${deltaX}px`);
		style.setProperty(movementCssVars.y, `${deltaY}px`);
	}

	function recordDragSample(offset: { x: number; y: number }, timeStamp: number | null) {
		if (timeStamp === null) return;

		const last = lastDragSample;
		if (last && timeStamp > last.time) {
			// Some Android devices emit one effectively stationary move immediately before release.
			// Keep the last moving sample and its timestamp. Repeated stationary moves still clear
			// the velocity, and a release after a hold still expires the last moving sample.
			const stationary =
				Math.abs(offset.x - last.x) < MIN_VELOCITY_SAMPLE_DISTANCE &&
				Math.abs(offset.y - last.y) < MIN_VELOCITY_SAMPLE_DISTANCE;
			const skipSample = stationary && !hasStationarySample;
			hasStationarySample = stationary;
			if (skipSample) {
				return;
			}

			const durationMs = Math.max(timeStamp - last.time, MIN_RELEASE_VELOCITY_DURATION_MS);
			lastDragVelocity = {
				x: (offset.x - last.x) / durationMs,
				y: (offset.y - last.y) / durationMs
			};
		}

		lastDragSample = { x: offset.x, y: offset.y, time: timeStamp };
	}

	function reset() {
		setSwiping(false);
		currentSwipeDirection = undefined;
		dragDismissed = false;
		updateSwipeProgress(0);

		swipeThreshold = swipeThresholdDefault;
		swipeThresholdFunction = null;
		dragStartPos = { x: 0, y: 0 };
		dragOffset = { x: 0, y: 0 };
		initialTransform = { x: 0, y: 0, scale: 1 };
		intendedSwipeDirection = undefined;
		maxSwipeDisplacement = 0;
		cancelledSwipe = false;
		swipeCancelBaseline = { x: 0, y: 0 };
		isFirstPointerMove = false;
		lastMovePos = null;
		pendingSwipe = false;
		pendingSwipeStartPos = null;
		swipeFromScrollable = false;
		sawPrimaryButtonsOnMove = false;
		elementSize = { width: 0, height: 0 };
		swipeStartTime = null;
		lastDragSample = null;
		hasStationarySample = false;
		lastDragVelocity = { x: 0, y: 0 };
		lastProgressDetails = null;
		syncDragStyles(false);
	}

	// --- Event plumbing ---

	function isTouchLikeEvent(event: PointerEvent | TouchEvent): boolean {
		if ('touches' in event) return true;
		return event.pointerType === 'touch';
	}

	function getPrimaryPointerPosition(
		event: PointerEvent | TouchEvent
	): { x: number; y: number } | null {
		if ('touches' in event) {
			const touch = event.touches[0];
			return touch ? { x: touch.clientX, y: touch.clientY } : null;
		}
		return { x: event.clientX, y: event.clientY };
	}

	function getTargetAtPoint(position: { x: number; y: number }, event: Event): Element | null {
		const root = getElement()?.getRootNode();
		const elementAtPoint = getElementAtPoint(root, position.x, position.y);
		const target = elementAtPoint ?? getEventTarget(event);
		// No HTMLElement narrowing here (upstream only type-casts): an SVG icon
		// inside a <button> must still match the interactive-elements ignore
		// selector, otherwise a pointer swipe starts from it and its pointer
		// capture swallows the button's click.
		return target instanceof Element ? target : null;
	}

	function findGestureScrollableTouchTarget(
		target: EventTarget | null,
		root: HTMLElement
	): HTMLElement | null {
		// The swiped element is positioned relative to the viewport, so the page scroller must not
		// gate the gesture (a reset like `html, body { height: 100%; overflow: auto }` makes `body`
		// a real scroll container). The drawer viewport's native touchmove handler already ignores it.
		const scrollTarget = findScrollableTouchTarget(target, root, getDirectionState().scrollAxis);
		const doc = scrollTarget?.ownerDocument;
		return scrollTarget === doc?.body || scrollTarget === doc?.documentElement
			? null
			: scrollTarget;
	}

	// --- Start ---

	function startSwipeAtPosition(
		event: PointerEvent | TouchEvent,
		position: { x: number; y: number },
		startOptions?: {
			ignoreScrollableTarget?: boolean;
			ignoreScrollableAncestors?: boolean;
		}
	): boolean {
		swipeFromScrollable = false;
		const touchLike = isTouchLikeEvent(event);
		const target = getTargetAtPoint(position, event);
		const { scrollAxis, primaryDirection } = getDirectionState();

		const element = getElement();
		const doc = element?.ownerDocument ?? document;
		const body = doc.body;

		const scrollableTarget =
			touchLike && body ? findGestureScrollableTouchTarget(target, body) : null;
		const ignoreScrollableTarget = startOptions?.ignoreScrollableTarget ?? false;
		if (scrollableTarget && !ignoreScrollableTarget) {
			return false;
		}
		swipeFromScrollable = Boolean(scrollableTarget && ignoreScrollableTarget);

		const isInteractiveElement = closest(target, DEFAULT_IGNORE_SELECTOR);
		if (isInteractiveElement && (!touchLike || ignoreSelectorWhenTouch)) {
			return false;
		}

		if (ignoreScrollableAncestors && element && target) {
			const ignoreAncestors = startOptions?.ignoreScrollableAncestors ?? false;
			if (!ignoreAncestors && findScrollableAncestor(target, element, scrollAxis) != null) {
				return false;
			}
		}

		cancelledSwipe = false;
		intendedSwipeDirection = undefined;
		maxSwipeDisplacement = 0;

		dragStartPos = position;
		swipeStartTime = getValidTimeStamp(event.timeStamp);
		lastDragSample = null;
		hasStationarySample = false;
		lastDragVelocity = { x: 0, y: 0 };
		swipeCancelBaseline = position;
		lastMovePos = position;
		swipeThreshold = swipeThresholdDefault;
		swipeThresholdFunction = typeof swipeThresholdProp === 'function' ? swipeThresholdProp : null;

		if (element) {
			elementSize = { width: element.offsetWidth, height: element.offsetHeight };
			resolveSwipeThreshold(primaryDirection);
			const transform = getElementTransform(element);

			initialTransform = transform;
			dragOffset = { x: transform.x, y: transform.y };
			recordDragSample({ x: transform.x, y: transform.y }, swipeStartTime);

			if (!('touches' in event)) {
				safelyChangePointerCapture(element, event.pointerId, 'setPointerCapture');
			}
		}

		options.onSwipeStart?.(event);

		setSwiping(true);
		isFirstPointerMove = true;
		updateSwipeProgress(0);
		syncDragStyles(true);

		return true;
	}

	function clearPendingSwipeStartState() {
		pendingSwipe = false;
		pendingSwipeStartPos = null;
	}

	function resetPendingSwipeState() {
		clearPendingSwipeStartState();
		swipeFromScrollable = false;
		lastMovePos = null;
	}

	function cancelSwipeInteraction(event: PointerEvent) {
		resetPendingSwipeState();

		if (!isSwipingInternal) return;

		setSwiping(false);

		dragOffset = { x: initialTransform.x, y: initialTransform.y };
		currentSwipeDirection = undefined;
		sawPrimaryButtonsOnMove = false;
		syncDragStyles(false);

		const element = getElement();
		if (element) {
			safelyChangePointerCapture(element, event.pointerId, 'releasePointerCapture');
		}

		updateSwipeProgress(0, { deltaX: 0, deltaY: 0, direction: undefined });

		options.onCancel?.(event);
	}

	function applyDirectionalDamping(deltaX: number, deltaY: number) {
		const { allowLeft, allowRight, allowUp, allowDown, hasHorizontal, hasVertical } =
			getDirectionState();
		const exponent = (value: number) => (value >= 0 ? value ** 0.5 : -(Math.abs(value) ** 0.5));
		const dampAxis = (delta: number, allowNegative: boolean, allowPositive: boolean) => {
			if (!allowNegative && delta < 0) return exponent(delta);
			if (!allowPositive && delta > 0) return exponent(delta);
			return delta;
		};

		const newDeltaX = hasHorizontal ? dampAxis(deltaX, allowLeft, allowRight) : exponent(deltaX);
		const newDeltaY = hasVertical ? dampAxis(deltaY, allowUp, allowDown) : exponent(deltaY);

		return { x: newDeltaX, y: newDeltaY };
	}

	function canSwipeFromScrollEdgeOnPendingMove(
		scrollTarget: HTMLElement,
		deltaX: number,
		deltaY: number
	): boolean | null {
		const { allowLeft, allowRight, allowUp, allowDown, hasHorizontal, hasVertical } =
			getDirectionState();
		// Swiping toward the axis start edge (down/right) is allowed when scrolled to the start;
		// toward the end edge (up/left) when scrolled to the end.
		const canSwipeOnAxis = (
			delta: number,
			scrollOffset: number,
			maxScrollOffset: number,
			allowTowardStart: boolean,
			allowTowardEnd: boolean
		) =>
			(delta > 0 && scrollOffset <= 0 && allowTowardStart) ||
			(delta < 0 && scrollOffset >= Math.max(0, maxScrollOffset) && allowTowardEnd);

		if (hasVertical && deltaY !== 0) {
			return canSwipeOnAxis(
				deltaY,
				scrollTarget.scrollTop,
				scrollTarget.scrollHeight - scrollTarget.clientHeight,
				allowDown,
				allowUp
			);
		}

		if (hasHorizontal && deltaX !== 0) {
			return canSwipeOnAxis(
				deltaX,
				scrollTarget.scrollLeft,
				scrollTarget.scrollWidth - scrollTarget.clientWidth,
				allowRight,
				allowLeft
			);
		}

		return null;
	}

	function handleStart(event: PointerEvent | TouchEvent) {
		if (!isEnabled()) return;
		if (event.defaultPrevented) return;
		if (!('touches' in event) && event.button !== 0) return;

		const startPos = getPrimaryPointerPosition(event);
		if (!startPos) return;

		pendingSwipe = true;
		pendingSwipeStartPos = startPos;
		swipeFromScrollable = false;
		sawPrimaryButtonsOnMove = !('touches' in event);

		const { primaryDirection } = getDirectionState();
		const allowedToStart = options.canStart
			? options.canStart(startPos, { nativeEvent: event, direction: primaryDirection })
			: true;
		if (!allowedToStart) return;

		if (startSwipeAtPosition(event, startPos)) {
			clearPendingSwipeStartState();
		}
	}

	// --- Move ---

	function handleMoveCore(
		event: PointerEvent | TouchEvent,
		position: { x: number; y: number },
		movement: { x: number; y: number },
		boundaryOverride?: HTMLElement
	) {
		if (!isEnabled() || !isSwipingInternal) return;

		const target = getEventTarget(event);
		if (isTouchLikeEvent(event) && !swipeFromScrollable) {
			// If the finger travels over a scrollable region mid-gesture (and the
			// gesture didn't start from a scroll edge), don't drag the element.
			const boundaryElement =
				boundaryOverride ?? (isHTMLElement(event.currentTarget) ? event.currentTarget : null);
			if (boundaryElement && findGestureScrollableTouchTarget(target, boundaryElement)) {
				return;
			}
		}

		if (!('touches' in event)) {
			// Prevent text selection on Safari during the drag.
			event.preventDefault();
		}

		if (isFirstPointerMove) {
			isFirstPointerMove = false;
			// Reset the drag origin to the first move's position to absorb the gap between the press and
			// the first move event — notably on iOS touch, where the first `touchmove` arrives already
			// offset from the `touchstart` — which would otherwise make the dragged element jump. This
			// only matters when an element follows the pointer; when `trackDrag` is false (e.g. the
			// swipe-area, which only opens the drawer) keep the original press position so a quick flick
			// still registers: on a low-refresh-rate display the whole travel can land in this single
			// first move, and discarding it would drop the gesture.
			if (trackDrag) {
				dragStartPos = position;
				const moveTime = getValidTimeStamp(event.timeStamp);
				if (moveTime !== null) {
					swipeStartTime = moveTime;
				}
				lastDragSample = null;
				hasStationarySample = false;
			}
		}

		const clientX = position.x;
		const clientY = position.y;
		const movementX = movement.x;
		const movementY = movement.y;

		// Re-anchor the cancel baseline whenever the movement reverses.
		if (
			(movementY < 0 && clientY > swipeCancelBaseline.y) ||
			(movementY > 0 && clientY < swipeCancelBaseline.y)
		) {
			swipeCancelBaseline = { x: swipeCancelBaseline.x, y: clientY };
		}
		if (
			(movementX < 0 && clientX > swipeCancelBaseline.x) ||
			(movementX > 0 && clientX < swipeCancelBaseline.x)
		) {
			swipeCancelBaseline = { x: clientX, y: swipeCancelBaseline.y };
		}

		const deltaX = clientX - dragStartPos.x;
		const deltaY = clientY - dragStartPos.y;
		const cancelDeltaX = clientX - swipeCancelBaseline.x;
		const cancelDeltaY = clientY - swipeCancelBaseline.y;

		const dirState = getDirectionState();
		const { allowLeft, allowRight, allowUp, allowDown, hasHorizontal, hasVertical } = dirState;

		let candidate: SwipeDirection | undefined;
		if (!intendedSwipeDirection) {
			if (Math.abs(deltaX) >= Math.abs(deltaY)) {
				candidate = deltaX > 0 ? 'right' : 'left';
			} else {
				candidate = deltaY > 0 ? 'down' : 'up';
			}

			if (candidate) {
				const isAllowed =
					(candidate === 'left' && allowLeft) ||
					(candidate === 'right' && allowRight) ||
					(candidate === 'up' && allowUp) ||
					(candidate === 'down' && allowDown);
				if (isAllowed) {
					intendedSwipeDirection = candidate;
					maxSwipeDisplacement = getDisplacement(candidate, deltaX, deltaY);
					currentSwipeDirection = candidate;
					resolveSwipeThreshold(candidate);
				}
			}
		} else {
			const direction = intendedSwipeDirection;
			const currentDisplacement = getDisplacement(direction, cancelDeltaX, cancelDeltaY);
			if (currentDisplacement > swipeThreshold) {
				cancelledSwipe = false;
				currentSwipeDirection = direction;
			} else if (
				!(allowLeft && allowRight) &&
				!(allowUp && allowDown) &&
				maxSwipeDisplacement - currentDisplacement >= REVERSE_CANCEL_THRESHOLD
			) {
				// Mark that a change-of-mind has occurred.
				cancelledSwipe = true;
			}
		}

		const dampedDelta = applyDirectionalDamping(deltaX, deltaY);
		let newOffsetX = initialTransform.x;
		let newOffsetY = initialTransform.y;

		if (hasHorizontal) {
			newOffsetX += dampedDelta.x;
		}
		if (hasVertical) {
			newOffsetY += dampedDelta.y;
		}

		// Only rewrite drag styles when the drag offset actually changed. `syncDragStyles` writes the
		// raw (undamped) frozen transform and movement vars, relying on the consumer's `onProgress`
		// to overwrite them with damped styles — but `updateSwipeProgress` dedupes unchanged
		// deltas and skips `onProgress`. A move that doesn't change the offset (e.g. the cursor
		// pinned at a screen edge during an off-screen drag, jittering only on the ignored axis)
		// would otherwise reinstate the raw styles with no correction, jumping the element to the
		// undamped position.
		const previousOffset = dragOffset;
		const offsetChanged = newOffsetX !== previousOffset.x || newOffsetY !== previousOffset.y;

		dragOffset = { x: newOffsetX, y: newOffsetY };
		if (offsetChanged) {
			syncDragStyles(true);
		}
		recordDragSample({ x: newOffsetX, y: newOffsetY }, getValidTimeStamp(event.timeStamp));

		const dragDeltaX = newOffsetX - initialTransform.x;
		const dragDeltaY = newOffsetY - initialTransform.y;
		const details: SwipeProgressDetails = {
			deltaX: dragDeltaX,
			deltaY: dragDeltaY,
			direction: intendedSwipeDirection
		};

		const progressDirection = dirState.primaryDirection ?? intendedSwipeDirection;
		if (!progressDirection) {
			updateSwipeProgress(0, details);
			return;
		}

		const size =
			progressDirection === 'left' || progressDirection === 'right'
				? elementSize.width
				: elementSize.height;
		const scale = initialTransform.scale || 1;
		if (size <= 0 || scale <= 0) {
			updateSwipeProgress(0, details);
			return;
		}

		const progressDisplacement = getDisplacement(progressDirection, dragDeltaX, dragDeltaY);
		if (progressDisplacement <= 0) {
			updateSwipeProgress(0, details);
			return;
		}

		updateSwipeProgress(progressDisplacement / (size * scale), details);
	}

	function handleMove(event: PointerEvent | TouchEvent, boundaryOverride?: HTMLElement) {
		const currentPos = getPrimaryPointerPosition(event);
		if (!currentPos) return;

		let endAfterMove = false;

		if (!('touches' in event)) {
			const hasPrimaryButton = hasPrimaryMouseButton(event.buttons);
			if (hasPrimaryButton) {
				sawPrimaryButtonsOnMove = true;
			}

			// Cancel the swipe if a non-primary button takes over the interaction
			// (e.g. a right-click interrupts dragging).
			if (event.buttons !== 0 && !hasPrimaryButton) {
				cancelSwipeInteraction(event);
				return;
			}

			// A `buttons: 0` pointermove means the primary button was already released,
			// so the gesture is over even if no pointerup reached us. On fast trackpad
			// flicks this trailing move is dispatched just before pointerup; treat it as
			// the release (mirroring touchend) instead of cancelling and snapping back.
			if (event.buttons === 0 && sawPrimaryButtonsOnMove) {
				if (!isSwipingInternal) {
					// The gesture never activated — discard it.
					handleEnd(event);
					return;
				}
				// This release move can itself carry the threshold-crossing displacement
				// (and the peak release velocity), so let it flow through handleMoveCore
				// below, then commit the release afterwards.
				endAfterMove = true;
			}
		}

		if (!isSwipingInternal && pendingSwipe) {
			if (!isTouchLikeEvent(event) && event.defaultPrevented) {
				resetPendingSwipeState();
				return;
			}

			const { primaryDirection } = getDirectionState();
			const allowedToStart = options.canStart
				? options.canStart(currentPos, { nativeEvent: event, direction: primaryDirection })
				: true;

			if (allowedToStart) {
				const pendingStartPos = pendingSwipeStartPos;
				let ignoreScrollableOnStart = false;
				if (isTouchLikeEvent(event)) {
					const element = getElement();
					if (pendingStartPos && element) {
						const target = getTargetAtPoint(currentPos, event);
						const body = element.ownerDocument.body;
						const scrollTarget = body ? findGestureScrollableTouchTarget(target, body) : null;

						if (
							scrollTarget &&
							(element.contains(scrollTarget) || scrollTarget.contains(element))
						) {
							const deltaX = currentPos.x - pendingStartPos.x;
							const deltaY = currentPos.y - pendingStartPos.y;
							const canSwipeFromEdge = canSwipeFromScrollEdgeOnPendingMove(
								scrollTarget,
								deltaX,
								deltaY
							);

							if (canSwipeFromEdge === false) {
								return;
							}
							if (canSwipeFromEdge === true) {
								ignoreScrollableOnStart = true;
							}
						}
					}
				}

				const started = startSwipeAtPosition(event, currentPos, {
					ignoreScrollableTarget: ignoreScrollableOnStart,
					ignoreScrollableAncestors: ignoreScrollableOnStart
				});
				if (started) {
					if (pendingStartPos && ignoreScrollableOnStart) {
						// Preserve displacement between touchstart and the move that activates
						// swipe from a scroll edge so quick flicks can dismiss.
						clearPendingSwipeStartState();
						dragStartPos = pendingStartPos;
						swipeCancelBaseline = pendingStartPos;
						lastMovePos = pendingStartPos;
						isFirstPointerMove = false;
					} else {
						clearPendingSwipeStartState();
						swipeFromScrollable = false;
					}
				}
			}
		}

		const previousPos = lastMovePos;
		const movement =
			previousPos === null
				? { x: 0, y: 0 }
				: { x: currentPos.x - previousPos.x, y: currentPos.y - previousPos.y };

		lastMovePos = currentPos;
		handleMoveCore(event, currentPos, movement, boundaryOverride);

		if (endAfterMove && !('touches' in event)) {
			handleEnd(event);
		}
	}

	// --- End ---

	function handleEnd(event: PointerEvent | TouchEvent) {
		if (!isEnabled()) return;

		const resolvedDragOffset = dragOffset;
		const releaseDeltaX = resolvedDragOffset.x - initialTransform.x;
		const releaseDeltaY = resolvedDragOffset.y - initialTransform.y;
		const progressDetails: SwipeProgressDetails = {
			deltaX: releaseDeltaX,
			deltaY: releaseDeltaY,
			direction: intendedSwipeDirection
		};

		if (!isSwipingInternal) {
			resetPendingSwipeState();
			updateSwipeProgress(0, progressDetails);
			return;
		}

		setSwiping(false);
		resetPendingSwipeState();
		sawPrimaryButtonsOnMove = false;

		const element = getElement();
		if (element && !('touches' in event)) {
			safelyChangePointerCapture(element, event.pointerId, 'releasePointerCapture');
		}

		const deltaX = releaseDeltaX;
		const deltaY = releaseDeltaY;
		const startTime = swipeStartTime;
		const endTime = getValidTimeStamp(event.timeStamp);
		const durationMs =
			startTime !== null && endTime !== null && endTime > startTime ? endTime - startTime : 0;
		const velocityDurationMs = durationMs > 0 ? Math.max(durationMs, MIN_VELOCITY_DURATION_MS) : 0;
		const velocityX = velocityDurationMs > 0 ? deltaX / velocityDurationMs : 0;
		const velocityY = velocityDurationMs > 0 ? deltaY / velocityDurationMs : 0;

		let releaseVelocityX = lastDragVelocity.x;
		let releaseVelocityY = lastDragVelocity.y;
		const lastSample = lastDragSample;
		if (lastSample && endTime !== null && endTime >= lastSample.time) {
			const ageMs = endTime - lastSample.time;
			if (ageMs <= MAX_RELEASE_VELOCITY_AGE_MS) {
				const sampleDurationMs = Math.max(ageMs, MIN_RELEASE_VELOCITY_DURATION_MS);
				const deltaFromLastSampleX = resolvedDragOffset.x - lastSample.x;
				const deltaFromLastSampleY = resolvedDragOffset.y - lastSample.y;
				const sampleVelocityX = deltaFromLastSampleX / sampleDurationMs;
				const sampleVelocityY = deltaFromLastSampleY / sampleDurationMs;
				if (Math.abs(deltaFromLastSampleX) >= MIN_VELOCITY_SAMPLE_DISTANCE) {
					releaseVelocityX = sampleVelocityX;
				}
				if (Math.abs(deltaFromLastSampleY) >= MIN_VELOCITY_SAMPLE_DISTANCE) {
					releaseVelocityY = sampleVelocityY;
				}
			} else {
				releaseVelocityX = 0;
				releaseVelocityY = 0;
			}
		}

		const releaseDecision = options.onRelease?.({
			event,
			direction: intendedSwipeDirection,
			deltaX,
			deltaY,
			velocityX,
			velocityY,
			releaseVelocityX,
			releaseVelocityY
		});
		const hasReleaseDecision = typeof releaseDecision === 'boolean';

		if (cancelledSwipe && !hasReleaseDecision) {
			dragOffset = { x: initialTransform.x, y: initialTransform.y };
			currentSwipeDirection = undefined;
			syncDragStyles(false);
			updateSwipeProgress(0, progressDetails);
			return;
		}

		let shouldClose = false;
		let dismissDirection: SwipeDirection | undefined;

		if (hasReleaseDecision) {
			shouldClose = releaseDecision;
			dismissDirection = intendedSwipeDirection ?? getDirectionState().primaryDirection;
		} else {
			for (const direction of getDirectionState().directions) {
				if (getDisplacement(direction, deltaX, deltaY) > swipeThreshold) {
					shouldClose = true;
					dismissDirection = direction;
					break;
				}
			}
		}

		if (shouldClose && dismissDirection) {
			currentSwipeDirection = dismissDirection;
			dragDismissed = true;
			syncDragStyles(false);
			options.onDismiss?.(event, { direction: dismissDirection });
		} else {
			dragOffset = { x: initialTransform.x, y: initialTransform.y };
			currentSwipeDirection = undefined;
			syncDragStyles(false);
			updateSwipeProgress(0, progressDetails);
		}
	}

	/**
	 * Feeds a native touchmove into the swipe pipeline. Used by the drawer's
	 * capture-phase touch handler, which claims the gesture with
	 * `stopPropagation()` and drives the drag natively.
	 */
	function moveNative(nativeEvent: TouchEvent, currentTarget: HTMLElement) {
		handleMove(nativeEvent, currentTarget);
	}

	return {
		get swiping() {
			return swiping;
		},
		get swipeDirection() {
			return currentSwipeDirection;
		},
		get dismissed() {
			return dragDismissed;
		},
		reset,
		moveNative,
		// Pointer handlers — attach on the viewport, gated to non-touch pointers.
		pointerHandlers: {
			onpointerdown: handleStart as (event: PointerEvent) => void,
			onpointermove: handleMove as (event: PointerEvent) => void,
			onpointerup: handleEnd as (event: PointerEvent) => void,
			onpointercancel: handleEnd as (event: PointerEvent) => void
		},
		// Touch handlers — called selectively by the drawer's touch scroll manager.
		touch: {
			start: handleStart as (event: TouchEvent) => void,
			move: handleMove as (event: TouchEvent) => void,
			end: handleEnd as (event: TouchEvent) => void,
			cancel: handleEnd as (event: TouchEvent) => void
		}
	};
}

export type SwipeGesture = ReturnType<typeof createSwipeGesture>;
