<script lang="ts">
	import { untrack } from 'svelte';
	import { createSwipeGesture } from '../internal/create-swipe-gesture.svelte.js';
	import { DrawerContext, DRAWER_CSS_VARS } from '../internal/drawer-state.svelte.js';
	import { getDisplacement, getElementTransform, type SwipeDirection } from '../internal/utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	const DEFAULT_SWIPE_OPEN_RATIO = 0.5;
	const MIN_SWIPE_START_DISTANCE = 1;
	const VELOCITY_THRESHOLD = 0.1;
	const FALLBACK_SWIPE_OPEN_THRESHOLD = 40;

	const oppositeSwipeDirection: Record<SwipeDirection, SwipeDirection> = {
		up: 'down',
		down: 'up',
		left: 'right',
		right: 'left'
	};

	interface DrawerSwipeAreaProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		/** Whether the swipe area is disabled. */
		disabled?: boolean;
		/**
		 * The swipe direction that opens the drawer.
		 * Defaults to the opposite of Drawer.Root's swipeDirection.
		 */
		swipeDirection?: SwipeDirection;
		ref?: HTMLElement | null;
	}

	let {
		children,
		disabled = false,
		swipeDirection: swipeDirectionProp,
		ref = $bindable(null),
		...restProps
	}: DrawerSwipeAreaProps = $props();

	const drawer = DrawerContext.get();

	let areaEl = $state<HTMLElement | null>(null);
	let swipeActive = $state(false);

	$effect(() => {
		ref = areaEl;
	});

	const resolvedSwipeDirection: SwipeDirection = $derived(
		swipeDirectionProp ?? oppositeSwipeDirection[drawer.swipeDirection]
	);
	const dismissDirection: SwipeDirection = $derived(oppositeSwipeDirection[resolvedSwipeDirection]);
	// Active while the drawer is closed, or while our own gesture is in flight.
	const enabled = $derived(!disabled && (!drawer.isOpen || swipeActive));

	// --- Interaction state (plain, per-gesture) ---
	let swipeStartEvent: PointerEvent | TouchEvent | null = null;
	let openedBySwipe = false;
	let dragDelta = { x: 0, y: 0 };
	let closedOffset: number | null = null;
	let appliedSwipeStyles = false;
	let popupTransition: string | null = null;
	let releaseDismissTimeout: ReturnType<typeof setTimeout> | undefined;

	function disableDismissForSwipe() {
		clearTimeout(releaseDismissTimeout);
		drawer.outsidePressDisabled = true;
	}

	function enableDismissAfterRelease() {
		// The gesture's own pointer events must not dismiss the drawer they just
		// opened: bits-ui debounces interact-outside (~10ms) and touch taps can
		// produce ghost clicks well after release, so keep outside-press disabled
		// slightly longer than one macrotask.
		clearTimeout(releaseDismissTimeout);
		releaseDismissTimeout = setTimeout(() => {
			drawer.outsidePressDisabled = false;
		}, 300);
	}

	function isHorizontalDismiss() {
		return dismissDirection === 'left' || dismissDirection === 'right';
	}

	function resolvePopupSize(): number | null {
		const popupElement = untrack(() => drawer.popupElement);
		if (!popupElement) return null;

		const size = isHorizontalDismiss() ? popupElement.offsetWidth : popupElement.offsetHeight;
		return size > 0 ? size : null;
	}

	function resolveClosedOffset(): number | null {
		const offset = resolvePopupSize();
		if (offset == null) return null;

		const popupElement = untrack(() => drawer.popupElement);
		if (!popupElement) return offset;

		// If the popup is mid-animation (e.g. re-grabbed while closing), start
		// from its current visual offset instead of the full size.
		const transform = getElementTransform(popupElement);
		const transformOffset = isHorizontalDismiss() ? transform.x : transform.y;
		if (Number.isFinite(transformOffset) && Math.abs(transformOffset) > 0.5) {
			return Math.min(offset, Math.abs(transformOffset));
		}

		return offset;
	}

	function resolveSwipeOpenThreshold(): number {
		const popupSize = resolvePopupSize();
		if (popupSize == null) return FALLBACK_SWIPE_OPEN_THRESHOLD;
		return popupSize * DEFAULT_SWIPE_OPEN_RATIO;
	}

	function applySwipeMovement() {
		if (!swipeActive) return;

		const popupElement = untrack(() => drawer.popupElement);
		if (!popupElement) return;
		if (!untrack(() => drawer.isOpen)) return;

		if (closedOffset == null) {
			closedOffset = resolveClosedOffset();
		}
		if (!closedOffset || !Number.isFinite(closedOffset) || closedOffset <= 0) return;

		const displacement = getDisplacement(resolvedSwipeDirection, dragDelta.x, dragDelta.y);
		const clampedDisplacement = Math.max(0, displacement);
		// Rubber-band once dragged past the fully-open position.
		const dampedDisplacement =
			clampedDisplacement > closedOffset
				? closedOffset + Math.sqrt(clampedDisplacement - closedOffset)
				: clampedDisplacement;
		const remaining = closedOffset - dampedDisplacement;
		const directionSign = dismissDirection === 'left' || dismissDirection === 'up' ? -1 : 1;
		const movement = remaining * directionSign;
		const horizontal = isHorizontalDismiss();
		const movementX = horizontal ? movement : 0;
		const movementY = horizontal ? 0 : movement;
		const openProgress = Math.max(0, Math.min(1, clampedDisplacement / closedOffset));
		const backdropProgress = Math.max(0, Math.min(1, 1 - openProgress));

		popupElement.style.setProperty(DRAWER_CSS_VARS.swipeMovementX, `${movementX}px`);
		popupElement.style.setProperty(DRAWER_CSS_VARS.swipeMovementY, `${movementY}px`);
		popupElement.setAttribute('data-swiping', '');
		if (popupTransition === null) {
			popupTransition = popupElement.style.transition;
		}
		popupElement.style.transition = 'none';

		const backdropElement = untrack(() => drawer.backdropElement);
		if (backdropElement) {
			backdropElement.setAttribute('data-swiping', '');
			backdropElement.style.setProperty(DRAWER_CSS_VARS.swipeProgress, `${backdropProgress}`);
			const frontmostHeight = untrack(() => drawer.frontmostHeight);
			if (openProgress > 0 && frontmostHeight > 0) {
				backdropElement.style.setProperty(DRAWER_CSS_VARS.height, `${frontmostHeight}px`);
			} else {
				backdropElement.style.removeProperty(DRAWER_CSS_VARS.height);
			}
		}

		drawer.provider?.visualStateStore.set({
			swipeProgress: openProgress,
			frontmostHeight: openProgress > 0 ? untrack(() => drawer.frontmostHeight) : 0
		});
		appliedSwipeStyles = true;
	}

	function clearSwipeStyles() {
		const popupElement = untrack(() => drawer.popupElement);
		if (popupElement && appliedSwipeStyles) {
			popupElement.style.removeProperty(DRAWER_CSS_VARS.swipeMovementX);
			popupElement.style.removeProperty(DRAWER_CSS_VARS.swipeMovementY);
			popupElement.removeAttribute('data-swiping');
		}

		if (popupElement && popupTransition !== null) {
			popupElement.style.transition = popupTransition;
			popupTransition = null;
		}

		const backdropElement = untrack(() => drawer.backdropElement);
		if (backdropElement) {
			backdropElement.removeAttribute('data-swiping');
			backdropElement.style.setProperty(DRAWER_CSS_VARS.swipeProgress, '0');
			backdropElement.style.removeProperty(DRAWER_CSS_VARS.height);
		}

		drawer.provider?.visualStateStore.set({ swipeProgress: 0, frontmostHeight: 0 });
		appliedSwipeStyles = false;
	}

	function openDrawer() {
		if (untrack(() => drawer.isOpen)) return;
		openedBySwipe = true;
		drawer.opts.open.current = true;
	}

	function closeDrawer() {
		if (!untrack(() => drawer.isOpen)) return;
		drawer.opts.open.current = false;
	}

	function resetSwipeInteractionState() {
		swipeStartEvent = null;
		openedBySwipe = false;
		closedOffset = null;
		swipeActive = false;
	}

	function finishSwipeInteraction() {
		resetSwipeInteractionState();
		enableDismissAfterRelease();
		dragDelta = { x: 0, y: 0 };
		clearSwipeStyles();
	}

	const swipe = createSwipeGesture({
		enabled: () => enabled,
		directions: () => [resolvedSwipeDirection],
		element: () => areaEl,
		trackDrag: false,
		movementCssVars: {
			x: DRAWER_CSS_VARS.swipeMovementX,
			y: DRAWER_CSS_VARS.swipeMovementY
		},
		onSwipeStart(event) {
			disableDismissForSwipe();
			swipeStartEvent = event;
			openedBySwipe = false;
			swipeActive = true;
			dragDelta = { x: 0, y: 0 };
		},
		onProgress(_progress, details) {
			if (!details || !swipeStartEvent) return;

			dragDelta = { x: details.deltaX, y: details.deltaY };

			if (details.direction !== resolvedSwipeDirection) return;

			const displacement = getDisplacement(resolvedSwipeDirection, details.deltaX, details.deltaY);
			if (displacement < MIN_SWIPE_START_DISTANCE && !openedBySwipe) return;

			if (!openedBySwipe) {
				openDrawer();
			}

			applySwipeMovement();
		},
		onRelease({ direction, deltaX, deltaY, releaseVelocityX, releaseVelocityY }) {
			const displacement = getDisplacement(resolvedSwipeDirection, deltaX, deltaY);
			const releaseVelocity = getDisplacement(
				resolvedSwipeDirection,
				releaseVelocityX,
				releaseVelocityY
			);
			const threshold = resolveSwipeOpenThreshold();
			const hasEnoughDistance = displacement >= threshold;
			const hasEnoughVelocity = releaseVelocity >= VELOCITY_THRESHOLD;
			const shouldOpen =
				direction === resolvedSwipeDirection &&
				(hasEnoughDistance || hasEnoughVelocity) &&
				!disabled;

			if (shouldOpen) {
				openDrawer();
			} else if (openedBySwipe) {
				closeDrawer();
			}

			finishSwipeInteraction();

			// Never dismiss through the engine — open/close is decided above.
			return false;
		},
		onCancel: finishSwipeInteraction
	});

	// Clean up when the area becomes disabled mid-gesture.
	$effect(() => {
		if (!enabled) {
			untrack(() => {
				swipe.reset();
				dragDelta = { x: 0, y: 0 };
				clearSwipeStyles();
				resetSwipeInteractionState();
			});
		}
	});

	// Always restore outside-press dismissal on unmount.
	$effect(() => {
		return () => {
			clearTimeout(releaseDismissTimeout);
			drawer.outsidePressDisabled = false;
		};
	});
</script>

<!--
	An invisible area that listens for swipe gestures to open the drawer
	(e.g. a strip along the screen edge). Touch gestures use the engine
	directly — the area lives outside the drawer viewport.
-->
<div
	bind:this={areaEl}
	role="presentation"
	aria-hidden="true"
	data-drawer-swipe-area=""
	data-open={drawer.isOpen ? '' : undefined}
	data-closed={!drawer.isOpen ? '' : undefined}
	data-swiping={swipe.swiping ? '' : undefined}
	data-swipe-direction={resolvedSwipeDirection}
	data-disabled={disabled ? '' : undefined}
	style:pointer-events={!enabled ? 'none' : undefined}
	style:touch-action={resolvedSwipeDirection === 'left' || resolvedSwipeDirection === 'right'
		? 'pan-y'
		: 'pan-x'}
	onpointerdown={(event) => {
		if (event.pointerType === 'touch') return;
		swipe.pointerHandlers.onpointerdown(event);
		// Prevent native text selection/drag gestures from competing with
		// swipe-open dragging.
		if (event.cancelable) {
			event.preventDefault();
		}
	}}
	onpointermove={(event) => {
		if (event.pointerType === 'touch') return;
		swipe.pointerHandlers.onpointermove(event);
	}}
	onpointerup={(event) => {
		if (event.pointerType === 'touch') return;
		swipe.pointerHandlers.onpointerup(event);
	}}
	onpointercancel={(event) => {
		if (event.pointerType === 'touch') return;
		swipe.pointerHandlers.onpointercancel(event);
	}}
	ontouchstart={swipe.touch.start}
	ontouchmove={swipe.touch.move}
	ontouchend={swipe.touch.end}
	ontouchcancel={swipe.touch.cancel}
	{...restProps}
>
	{@render children?.()}
</div>
