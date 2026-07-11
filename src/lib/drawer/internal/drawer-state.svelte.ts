/**
 * Drawer state management.
 * Coordinates the swipe gesture engine, the touch scroll interception layer,
 * snap points, nested drawers, the optional provider (indent effect) and
 * virtual keyboard provider, and bits-ui Dialog.
 */
import { Context } from "runed";
import { untrack } from "svelte";
import {
	createSwipeGesture,
	type SwipeGesture,
	type SwipeProgressDetails,
	type SwipeReleaseInfo,
} from "./create-swipe-gesture.svelte.js";
import { createDrawerTouchScroll } from "./create-drawer-touch-scroll.svelte.js";
import {
	DRAWER_KEYBOARD_INSET_VAR,
	type VirtualKeyboardHooks,
} from "./create-virtual-keyboard.svelte.js";
import type { DrawerProviderState } from "./drawer-provider.svelte.js";
import {
	getSnapPointSwipeMovement,
	resolveActiveSnapPoint,
	resolveSnapPoints,
	type DrawerSnapPoint,
	type ResolvedDrawerSnapPoint,
} from "./snap-points.js";
import {
	clamp,
	getElementAtPoint,
	isDrawerContentTarget,
	isSwipeIgnoredTarget,
	shouldIgnoreSwipeForTextSelection,
	type SwipeDirection,
} from "./utils.js";

// CSS custom property names (aligned with base-ui v1.6.0)
export const DRAWER_CSS_VARS = {
	swipeMovementX: "--drawer-swipe-movement-x",
	swipeMovementY: "--drawer-swipe-movement-y",
	swipeProgress: "--drawer-swipe-progress",
	swipeStrength: "--drawer-swipe-strength",
	snapPointOffset: "--drawer-snap-point-offset",
	height: "--drawer-height",
	frontmostHeight: "--drawer-frontmost-height",
	nestedDrawers: "--nested-drawers",
	keyboardInset: DRAWER_KEYBOARD_INSET_VAR,
} as const;

// Swipe physics constants (calibrated from base-ui)
const FAST_SWIPE_VELOCITY = 0.5;
const MIN_SWIPE_RELEASE_VELOCITY = 0.2;
const MAX_SWIPE_RELEASE_VELOCITY = 4;
const MIN_SWIPE_RELEASE_DURATION_MS = 80;
const MAX_SWIPE_RELEASE_DURATION_MS = 360;
const MIN_SWIPE_RELEASE_SCALAR = 0.1;
const MAX_SWIPE_RELEASE_SCALAR = 1;
const MIN_SWIPE_THRESHOLD = 10;
const SNAP_VELOCITY_THRESHOLD = 0.5;
const SNAP_VELOCITY_MULTIPLIER = 300;
const MAX_SNAP_VELOCITY = 4;

// --- CSS property registration (performance optimisation) ---
// Setting inherits: false prevents high-frequency swipe vars from cascading
// into deep subtrees, reducing style recalculation cost.
let cssPropsRegistered = false;

export function registerDrawerCSSProperties() {
	if (cssPropsRegistered) return;
	if (typeof CSS === "undefined" || !("registerProperty" in CSS)) return;
	cssPropsRegistered = true;

	const reg = (name: string, syntax: string, initialValue: string) => {
		try {
			CSS.registerProperty({ name, syntax, inherits: false, initialValue });
		} catch {
			/* already registered */
		}
	};
	reg(DRAWER_CSS_VARS.swipeMovementX, "<length>", "0px");
	reg(DRAWER_CSS_VARS.swipeMovementY, "<length>", "0px");
	reg(DRAWER_CSS_VARS.snapPointOffset, "<length>", "0px");
	reg(DRAWER_CSS_VARS.swipeProgress, "<number>", "0");
	reg(DRAWER_CSS_VARS.swipeStrength, "<number>", "1");
}

function getBaseSwipeThreshold(element: HTMLElement, direction: SwipeDirection): number {
	const size =
		direction === "left" || direction === "right" ? element.offsetWidth : element.offsetHeight;
	return Math.max(size * 0.5, MIN_SWIPE_THRESHOLD);
}

export interface DrawerRootOptions {
	/**
	 * Open state box. The setter is the single notification path: it updates the
	 * bound prop and fires the consumer's onOpenChange exactly once.
	 */
	open: { current: boolean };
	/** Reactive getter for the swipe direction prop. */
	swipeDirection?: () => SwipeDirection;
	/** Reactive getter for the snap points prop. */
	snapPoints?: () => DrawerSnapPoint[] | undefined;
	/** Reactive getter for the snapToSequentialPoints prop. */
	snapToSequentialPoints?: () => boolean;
	/** Active snap point box; the setter notifies onSnapPointChange. */
	snapPoint?: { current: DrawerSnapPoint | null };
	/** The snap point to restore when the drawer opens. */
	defaultSnapPoint?: () => DrawerSnapPoint | null;
	/** The parent drawer state when nested inside another drawer. */
	parent?: DrawerRootState | null;
	/** The provider state when rendered under a Drawer.Provider. */
	provider?: DrawerProviderState | null;
}

export const DrawerContext = new Context<DrawerRootState>("Drawer.Root");

export class DrawerRootState {
	// --- Options ---
	readonly opts: DrawerRootOptions;
	readonly parent: DrawerRootState | null;
	readonly provider: DrawerProviderState | null;

	get swipeDirection(): SwipeDirection {
		return this.opts.swipeDirection?.() ?? "down";
	}

	// --- Elements ---
	popupElement = $state<HTMLElement | null>(null);
	backdropElement = $state<HTMLElement | null>(null);
	viewportElement = $state<HTMLElement | null>(null);

	/** Hooks provided by an ancestor Drawer.VirtualKeyboardProvider, if any. */
	virtualKeyboard: VirtualKeyboardHooks | null = null;

	/**
	 * While a Drawer.SwipeArea gesture is in flight, outside presses must not
	 * dismiss the drawer (the pointer is outside the popup by construction).
	 * The popup's onInteractOutside handler consults this flag.
	 */
	outsidePressDisabled = false;

	// --- Swipe state ---
	swipeGesture: SwipeGesture;
	touchScroll: ReturnType<typeof createDrawerTouchScroll>;
	swipeRelease = $state<number | null>(null);
	swipeDismissed = $state(false);

	// --- Measurements ---
	popupHeight = $state(0);
	viewportHeight = $state(0);
	rootFontSize = $state(16);

	// --- Nested drawers ---
	/** Whether a nested drawer is present (open or animating out). */
	hasNestedDrawer = $state(false);
	/** Number of open nested drawers. */
	nestedOpenDrawerCount = $state(0);
	/** Whether a nested drawer is currently being swiped. */
	nestedSwiping = $state(false);
	/** Height of the frontmost open drawer in this drawer's stack. */
	frontmostHeight = $state(0);
	private nestedFrontmostActive = false;
	private nestedSwipeActive = false;

	private revertFrame = 0;
	private pendingSwipeCloseSnapPoint: DrawerSnapPoint | null | undefined = undefined;

	// --- Snap points (derived) ---

	get snapPoints(): DrawerSnapPoint[] | undefined {
		return this.opts.snapPoints?.();
	}

	get hasSnapPoints(): boolean {
		const snapPoints = this.snapPoints;
		return Boolean(snapPoints && snapPoints.length > 0);
	}

	get snapToSequentialPoints(): boolean {
		return this.opts.snapToSequentialPoints?.() ?? false;
	}

	get activeSnapPoint(): DrawerSnapPoint | null {
		return this.opts.snapPoint?.current ?? null;
	}

	setActiveSnapPoint(next: DrawerSnapPoint | null) {
		if (this.opts.snapPoint) {
			this.opts.snapPoint.current = next;
		}
	}

	readonly resolvedSnapPoints: ResolvedDrawerSnapPoint[] = $derived.by(() =>
		resolveSnapPoints(this.snapPoints, this.viewportHeight, this.rootFontSize, this.popupHeight)
	);

	readonly activeSnapPointOffset: number | null = $derived.by(() => {
		const resolved = resolveActiveSnapPoint(
			this.hasSnapPoints ? this.activeSnapPoint : undefined,
			this.resolvedSnapPoints,
			this.popupHeight,
			this.viewportHeight,
			this.rootFontSize
		);
		return resolved?.offset ?? null;
	});

	/** Distance between the two lowest snap point offsets (progress reference). */
	readonly snapPointRange: { minOffset: number; range: number } | null = $derived.by(() => {
		const snapPoints = this.snapPoints;
		if (!snapPoints || snapPoints.length < 2) return null;

		const direction = this.swipeDirection;
		if (direction !== "down" && direction !== "up") return null;

		const resolved = this.resolvedSnapPoints;
		if (resolved.length < 2) return null;

		const offsets = resolved
			.map((point) => point.offset)
			.filter((offset) => Number.isFinite(offset))
			.sort((a, b) => a - b);
		if (offsets.length < 2) return null;

		const minOffset = offsets[0];
		const nextOffset = offsets[1];
		const maxOffset = offsets[offsets.length - 1];
		let range = nextOffset - minOffset;
		if (!Number.isFinite(range) || range <= 0) {
			const fallbackRange = maxOffset - minOffset;
			if (!Number.isFinite(fallbackRange) || fallbackRange <= 0) return null;
			range = fallbackRange;
		}

		return { minOffset, range };
	});

	readonly snapPointProgress: number | null = $derived.by(() => {
		const range = this.snapPointRange;
		const offset = this.activeSnapPointOffset;
		if (!range || offset === null) return null;
		return clamp((offset - range.minOffset) / range.range, 0, 1);
	});

	/** Signed value for the --drawer-snap-point-offset CSS var (null → 0px). */
	readonly snapPointOffsetValue: number | null = $derived.by(() => {
		const direction = this.swipeDirection;
		if (!this.hasSnapPoints || (direction !== "down" && direction !== "up")) return null;
		const offset = this.activeSnapPointOffset;
		if (offset === null) return null;
		return direction === "up" ? -offset : offset;
	});

	/** Whether the active snap point is the full-height (value 1) snap point. */
	get expanded(): boolean {
		return this.hasSnapPoints && this.activeSnapPoint === 1;
	}

	constructor(opts: DrawerRootOptions) {
		this.opts = opts;
		this.parent = opts.parent ?? null;
		this.provider = opts.provider ?? null;

		this.swipeGesture = createSwipeGesture({
			enabled: () => this.opts.open.current && this.nestedOpenDrawerCount === 0,
			directions: () => {
				const direction = this.swipeDirection;
				if (this.hasSnapPoints && (direction === "down" || direction === "up")) {
					return direction === "down" ? ["down", "up"] : ["up", "down"];
				}
				return [direction];
			},
			element: () => this.popupElement,
			ignoreSelectorWhenTouch: false,
			ignoreScrollableAncestors: true,
			movementCssVars: {
				x: DRAWER_CSS_VARS.swipeMovementX,
				y: DRAWER_CSS_VARS.swipeMovementY,
			},
			swipeThreshold: ({ element, direction }) => getBaseSwipeThreshold(element, direction),
			canStart: (position, details) => {
				const popup = untrack(() => this.popupElement);
				if (!popup) return false;

				const doc = popup.ownerDocument;
				const elementAtPoint = getElementAtPoint(doc, position.x, position.y);
				if (!elementAtPoint || !popup.contains(elementAtPoint)) return false;

				const nativeEvent = details.nativeEvent;
				const touchLike =
					"touches" in nativeEvent ||
					("pointerType" in nativeEvent && nativeEvent.pointerType === "touch");
				if (touchLike && shouldIgnoreSwipeForTextSelection(doc, popup)) return false;

				if (nativeEvent.type === "touchstart" && isSwipeIgnoredTarget(elementAtPoint)) {
					return false;
				}

				return true;
			},
			onSwipeStart: (event) => {
				// Clear a text selection within the popup on non-touch swipes so it
				// doesn't interfere with the drag.
				if (
					"touches" in event ||
					("pointerType" in event && event.pointerType === "touch")
				) {
					return;
				}

				const popup = untrack(() => this.popupElement);
				if (!popup) return;

				const selection = popup.ownerDocument.getSelection?.();
				if (!selection || selection.isCollapsed) return;

				const anchorElement =
					selection.anchorNode instanceof Element
						? selection.anchorNode
						: selection.anchorNode?.parentElement;
				const focusElement =
					selection.focusNode instanceof Element
						? selection.focusNode
						: selection.focusNode?.parentElement;

				if (
					!(anchorElement && popup.contains(anchorElement)) &&
					!(focusElement && popup.contains(focusElement))
				) {
					return;
				}

				selection.removeAllRanges();
			},
			onSwipingChange: (swiping) => {
				this.setBackdropSwipingAttribute(swiping);

				if (!swiping && !this.parent) {
					this.finishNestedSwipe();
				}
			},
			onProgress: (progress, details) => {
				this.handleSwipeProgress(progress, details);
			},
			onRelease: (info) => this.handleSwipeRelease(info),
			onDismiss: (event) => this.handleSwipeDismiss(event),
		});

		this.touchScroll = createDrawerTouchScroll({
			rootElement: () => this.viewportElement ?? this.popupElement,
			active: () => this.opts.open.current && this.nestedOpenDrawerCount === 0,
			swipeDirection: () => this.swipeDirection,
			swipeGesture: this.swipeGesture,
			virtualKeyboard: () => this.virtualKeyboard,
		});
	}

	static create(opts: DrawerRootOptions) {
		return DrawerContext.set(new DrawerRootState(opts));
	}

	// --- Viewport handlers ---

	/**
	 * Handlers to spread on the viewport element. Pointer handlers drive desktop
	 * swipes (touch pointers are ignored — touch goes through the native
	 * capture-phase pipeline); touch handlers manage scroll interception state.
	 */
	createViewportHandlers() {
		const pointer = this.swipeGesture.pointerHandlers;

		return {
			onpointerdown: (event: PointerEvent) => {
				this.touchScroll.notePointerDown(event);

				if (!untrack(() => this.opts.open.current) || untrack(() => this.nestedOpenDrawerCount) > 0) {
					return;
				}

				const currentTarget = event.currentTarget;
				const doc =
					currentTarget instanceof HTMLElement ? currentTarget.ownerDocument : document;
				const elementAtPoint = getElementAtPoint(doc, event.clientX, event.clientY);
				// Pointer (mouse/pen) swipes never start from the scrollable content
				// region, so text can still be selected there with a mouse.
				if (isSwipeIgnoredTarget(elementAtPoint) || isDrawerContentTarget(elementAtPoint)) {
					return;
				}

				if (event.pointerType === "touch") return;
				pointer.onpointerdown(event);
			},
			onpointermove: (event: PointerEvent) => {
				if (event.pointerType === "touch") return;
				pointer.onpointermove(event);
			},
			onpointerup: (event: PointerEvent) => {
				this.touchScroll.notePointerSettled(event);
				if (event.pointerType === "touch") return;
				pointer.onpointerup(event);
			},
			onpointercancel: (event: PointerEvent) => {
				this.touchScroll.notePointerSettled(event);
				if (event.pointerType === "touch") return;
				pointer.onpointercancel(event);
			},
			...this.touchScroll.handlers,
		};
	}

	// --- Swipe progress ---

	private handleSwipeProgress(progress: number, details?: SwipeProgressDetails) {
		this.updateNestedSwipeActive(details);

		const hasSnapPoints = this.hasSnapPoints;
		const direction = untrack(() => this.swipeDirection);

		// Snap point mode (down): the popup is positioned entirely via CSS
		// (snap offset + movement var); override the engine's inline transform
		// and apply overshoot damping past the fully-open edge.
		if (
			this.swipeGesture.swiping &&
			direction === "down" &&
			hasSnapPoints &&
			details &&
			Number.isFinite(details.deltaY)
		) {
			const popup = untrack(() => this.popupElement);
			if (popup) {
				popup.style.removeProperty("transform");
				popup.style.setProperty(
					DRAWER_CSS_VARS.swipeMovementY,
					`${getSnapPointSwipeMovement(untrack(() => this.activeSnapPointOffset) ?? 0, details.deltaY)}px`
				);
			}
		}

		const currentDirection = details?.direction ?? this.swipeGesture.swipeDirection;
		const isDismissSwipe = currentDirection === undefined || currentDirection === direction;
		const isVerticalSwipe = direction === "down" || direction === "up";
		const shouldTrackProgress =
			(hasSnapPoints && isVerticalSwipe) ||
			!hasSnapPoints ||
			direction === "left" ||
			direction === "right" ||
			isDismissSwipe;

		// With snap points, express the progress relative to the range between
		// the two lowest snap positions so the backdrop fade tracks snapping.
		let resolvedProgress = progress;
		const snapPointRange = untrack(() => this.snapPointRange);
		const popupHeight = untrack(() => this.popupHeight);
		if (snapPointRange && popupHeight > 0) {
			if (details && Number.isFinite(details.deltaY)) {
				const baseOffset = untrack(() => this.activeSnapPointOffset) ?? snapPointRange.minOffset;
				const nextOffset = clamp(baseOffset + details.deltaY, 0, popupHeight);
				resolvedProgress = clamp(
					(nextOffset - snapPointRange.minOffset) / snapPointRange.range,
					0,
					1
				);
			} else if (untrack(() => this.snapPointProgress) !== null) {
				resolvedProgress = untrack(() => this.snapPointProgress)!;
			} else if (currentDirection === "down" || currentDirection === "up") {
				const displacement = progress * popupHeight;
				const baseOffset = untrack(() => this.activeSnapPointOffset) ?? snapPointRange.minOffset;
				const nextOffset =
					currentDirection === "down" ? baseOffset + displacement : baseOffset - displacement;
				resolvedProgress = clamp(
					(nextOffset - snapPointRange.minOffset) / snapPointRange.range,
					0,
					1
				);
			}
		}

		this.applySwipeProgress(resolvedProgress, shouldTrackProgress, true);
	}

	applySwipeProgress(resolvedProgress: number, shouldTrackProgress: boolean, notifyParent = false) {
		const open = untrack(() => this.opts.open.current);
		const nested = this.parent !== null;
		const isActive = open && !nested && shouldTrackProgress;
		const swipeProgress = isActive ? resolvedProgress : 0;
		const nestedSwipeProgress = open && shouldTrackProgress ? resolvedProgress : 0;
		const frontmostHeight = untrack(() => this.frontmostHeight);

		if (notifyParent && this.parent) {
			this.parent.onNestedSwipeProgressChange(nestedSwipeProgress);
			if (nestedSwipeProgress <= 0) {
				this.finishNestedSwipe();
			}
		}

		this.provider?.visualStateStore.set({
			swipeProgress,
			frontmostHeight: swipeProgress > 0 ? frontmostHeight : 0,
		});

		const backdrop = untrack(() => this.backdropElement);
		if (!backdrop) return;

		if (!isActive || swipeProgress <= 0) {
			backdrop.style.setProperty(DRAWER_CSS_VARS.swipeProgress, "0");
			backdrop.style.removeProperty(DRAWER_CSS_VARS.height);
			return;
		}

		backdrop.style.setProperty(DRAWER_CSS_VARS.swipeProgress, `${swipeProgress}`);
		if (frontmostHeight > 0) {
			backdrop.style.setProperty(DRAWER_CSS_VARS.height, `${frontmostHeight}px`);
		} else {
			backdrop.style.removeProperty(DRAWER_CSS_VARS.height);
		}
	}

	// --- Nested drawer coordination (called by child drawers) ---

	/** Child → parent: the nested drawer's swipe progress (fades the parent popup). */
	onNestedSwipeProgressChange(progress: number) {
		const popup = untrack(() => this.popupElement);
		popup?.style.setProperty(
			DRAWER_CSS_VARS.swipeProgress,
			progress > 0 ? `${progress}` : "0"
		);
		this.parent?.onNestedSwipeProgressChange(progress);
	}

	/**
	 * Child → parent: frontmost popup height for scaling effects.
	 * Propagation up the chain happens reactively: updating `frontmostHeight`
	 * re-runs this drawer's own notify effect in its root component.
	 */
	onNestedFrontmostHeightChange(height: number) {
		if (height > 0) {
			this.nestedFrontmostActive = true;
			this.frontmostHeight = height;
			return;
		}

		this.nestedFrontmostActive = false;
		const ownHeight = untrack(() => this.popupHeight);
		if (ownHeight > 0) {
			this.frontmostHeight = ownHeight;
		}
	}

	/** Child → parent: a nested drawer is being swiped. */
	onNestedSwipingChange(swiping: boolean) {
		this.nestedSwiping = swiping;
		this.parent?.onNestedSwipingChange(swiping);
	}

	/** Child → parent: a nested drawer is present (open or animating out). */
	onNestedDrawerPresenceChange(present: boolean) {
		this.hasNestedDrawer = present;
	}

	/** Child → parent: a nested drawer opened or closed. */
	onNestedOpenChange(open: boolean) {
		// untrack the read: this is called from child effects, and a tracked
		// read-then-write of the same signal would self-invalidate them.
		const current = untrack(() => this.nestedOpenDrawerCount);
		this.nestedOpenDrawerCount = Math.max(0, current + (open ? 1 : -1));
		// The count is recursive (grandchildren included), like upstream's
		// nestedOpenDialogCount — the whole ancestor chain steps back.
		this.parent?.onNestedOpenChange(open);
	}

	private updateNestedSwipeActive(details?: SwipeProgressDetails) {
		if (this.nestedSwipeActive || !details || !this.parent) return;

		const direction = details.direction ?? untrack(() => this.swipeDirection);
		const delta = direction === "left" || direction === "right" ? details.deltaX : details.deltaY;
		if (!Number.isFinite(delta) || Math.abs(delta) < MIN_SWIPE_THRESHOLD) return;

		this.nestedSwipeActive = true;
		this.parent.onNestedSwipingChange(true);
	}

	private finishNestedSwipe() {
		if (!this.nestedSwipeActive) return;
		this.nestedSwipeActive = false;
		this.parent?.onNestedSwipingChange(false);
	}

	// --- Swipe release ---

	private handleSwipeRelease(info: SwipeReleaseInfo): boolean | undefined {
		if (this.hasSnapPoints) {
			return this.handleSnapPointsRelease(info);
		}

		const { direction, deltaX, deltaY, velocityX, velocityY } = info;

		if (!direction) {
			this.clearSwipeRelease();
			return undefined;
		}

		const element = untrack(() => this.popupElement);
		if (!element) {
			this.clearSwipeRelease();
			return undefined;
		}

		const baseThreshold = getBaseSwipeThreshold(element, direction);
		const delta = direction === "left" || direction === "right" ? deltaX : deltaY;
		if (!Number.isFinite(delta)) {
			this.clearSwipeRelease();
			return undefined;
		}

		const directionalDelta = direction === "left" || direction === "up" ? -delta : delta;
		if (directionalDelta <= 0) {
			this.clearSwipeRelease();
			return false;
		}

		// Fast swipe → dismiss regardless of distance.
		const velocity = direction === "left" || direction === "right" ? velocityX : velocityY;
		const directionalVelocity = direction === "left" || direction === "up" ? -velocity : velocity;
		if (directionalVelocity >= FAST_SWIPE_VELOCITY && directionalDelta > 0) {
			this.startSwipeRelease(direction, info, 0);
			return true;
		}

		const shouldClose = directionalDelta > baseThreshold;
		if (shouldClose) {
			this.startSwipeRelease(direction, info, 0);
		} else {
			this.clearSwipeRelease();
		}
		return shouldClose;
	}

	private handleSnapPointsRelease(info: SwipeReleaseInfo): boolean | undefined {
		const direction = untrack(() => this.swipeDirection);
		if (direction !== "down" && direction !== "up") {
			this.clearSwipeRelease();
			return undefined;
		}

		const popupHeight = untrack(() => this.popupHeight);
		const resolvedSnapPoints = untrack(() => this.resolvedSnapPoints);
		if (!popupHeight || resolvedSnapPoints.length === 0) {
			this.clearSwipeRelease();
			return undefined;
		}

		const dragDelta = direction === "down" ? info.deltaY : -info.deltaY;
		if (!Number.isFinite(dragDelta)) {
			this.clearSwipeRelease();
			return undefined;
		}

		const dragDirection = Math.sign(dragDelta);
		const releaseDirectionalVelocity =
			direction === "down" ? info.releaseVelocityY : -info.releaseVelocityY;
		const fallbackDirectionalVelocity = direction === "down" ? info.velocityY : -info.velocityY;
		let resolvedDirectionalVelocity = Number.isFinite(releaseDirectionalVelocity)
			? releaseDirectionalVelocity
			: fallbackDirectionalVelocity;
		if (
			dragDirection !== 0 &&
			Math.abs(dragDelta) >= MIN_SWIPE_THRESHOLD &&
			Number.isFinite(resolvedDirectionalVelocity)
		) {
			const velocityDirection = Math.sign(resolvedDirectionalVelocity);
			if (velocityDirection !== 0 && velocityDirection !== dragDirection) {
				// Ignore touch reversals that would otherwise flip the snap decision.
				resolvedDirectionalVelocity = fallbackDirectionalVelocity;
			}
		}

		const currentOffset = untrack(() => this.activeSnapPointOffset) ?? 0;
		const dragTargetOffset = clamp(currentOffset + dragDelta, 0, popupHeight);
		const velocityOffset =
			Number.isFinite(resolvedDirectionalVelocity) &&
			Math.abs(resolvedDirectionalVelocity) >= SNAP_VELOCITY_THRESHOLD
				? clamp(resolvedDirectionalVelocity, -MAX_SNAP_VELOCITY, MAX_SNAP_VELOCITY) *
					SNAP_VELOCITY_MULTIPLIER
				: 0;
		const snapToSequentialPoints = untrack(() => this.snapToSequentialPoints);
		const targetOffset = snapToSequentialPoints
			? dragTargetOffset
			: clamp(dragTargetOffset + velocityOffset, 0, popupHeight);

		const closeFromSnapPoints = () => {
			// Capture the base offset before clearing the snap point so the release
			// scalar accounts for the distance already travelled.
			this.pendingSwipeCloseSnapPoint = untrack(() => this.activeSnapPoint);
			const snapBaseOffset = currentOffset;
			this.setActiveSnapPoint(null);
			this.startSwipeRelease(direction, info, snapBaseOffset);
			return true;
		};

		if (snapToSequentialPoints) {
			const orderedSnapPoints = [...resolvedSnapPoints].sort(
				(first, second) => first.offset - second.offset
			);
			if (orderedSnapPoints.length === 0) {
				this.clearSwipeRelease();
				return false;
			}

			let currentIndex = 0;
			let closestDistance = Math.abs(currentOffset - orderedSnapPoints[0].offset);
			for (let index = 1; index < orderedSnapPoints.length; index += 1) {
				const distance = Math.abs(currentOffset - orderedSnapPoints[index].offset);
				if (distance < closestDistance) {
					closestDistance = distance;
					currentIndex = index;
				}
			}

			let targetSnapPoint = orderedSnapPoints[0];
			closestDistance = Math.abs(targetOffset - targetSnapPoint.offset);
			for (const snapPoint of orderedSnapPoints) {
				const distance = Math.abs(targetOffset - snapPoint.offset);
				if (distance < closestDistance) {
					closestDistance = distance;
					targetSnapPoint = snapPoint;
				}
			}

			const velocityDirection = Math.sign(resolvedDirectionalVelocity);
			const shouldAdvance =
				dragDirection !== 0 &&
				velocityDirection !== 0 &&
				velocityDirection === dragDirection &&
				Math.abs(resolvedDirectionalVelocity) >= SNAP_VELOCITY_THRESHOLD;
			let effectiveTargetOffset = targetOffset;

			if (shouldAdvance) {
				const adjacentIndex = clamp(currentIndex + dragDirection, 0, orderedSnapPoints.length - 1);
				if (adjacentIndex !== currentIndex) {
					const adjacentPoint = orderedSnapPoints[adjacentIndex];
					const shouldForceAdjacent =
						dragDirection > 0
							? targetOffset < adjacentPoint.offset
							: targetOffset > adjacentPoint.offset;
					if (shouldForceAdjacent) {
						targetSnapPoint = adjacentPoint;
						effectiveTargetOffset = adjacentPoint.offset;
					}
				} else if (dragDirection > 0) {
					return closeFromSnapPoints();
				}
			}

			const closeOffset = popupHeight;
			const closeDistance = Math.abs(effectiveTargetOffset - closeOffset);
			const snapDistance = Math.abs(effectiveTargetOffset - targetSnapPoint.offset);
			if (closeDistance < snapDistance) {
				return closeFromSnapPoints();
			}

			this.setActiveSnapPoint(targetSnapPoint.value);
			this.clearSwipeRelease();
			return false;
		}

		if (resolvedDirectionalVelocity >= FAST_SWIPE_VELOCITY && dragDelta > 0) {
			return closeFromSnapPoints();
		}

		let closestSnapPoint = resolvedSnapPoints[0];
		let closestDistance = Math.abs(targetOffset - closestSnapPoint.offset);
		for (const snapPoint of resolvedSnapPoints) {
			const distance = Math.abs(targetOffset - snapPoint.offset);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestSnapPoint = snapPoint;
			}
		}

		const closeOffset = popupHeight;
		const closeDistance = Math.abs(targetOffset - closeOffset);
		if (closeDistance < closestDistance) {
			return closeFromSnapPoints();
		}

		this.setActiveSnapPoint(closestSnapPoint.value);
		this.clearSwipeRelease();
		return false;
	}

	/**
	 * Start ending transition styles early and synchronously to prevent a period
	 * where the popup appears stuck on release before the closing animation
	 * actually starts.
	 */
	private startSwipeRelease(
		direction: SwipeDirection,
		info: SwipeReleaseInfo,
		snapBaseOffset: number
	) {
		const popup = untrack(() => this.popupElement);
		if (!popup) return;

		this.finishNestedSwipe();
		this.setSwipeDismissedAttributes(true);
		popup.style.removeProperty("transition");
		popup.setAttribute("data-ending-style", "");

		const scalar = this.resolveSwipeReleaseScalar(direction, info, snapBaseOffset);
		this.swipeRelease = scalar;

		// Velocity-scaled close: expose the strength scalar so CSS can shorten the
		// dismiss transition. Set on both popup and backdrop — the vars are
		// registered with inherits: false, so each element needs its own value.
		const strength = scalar ?? 1;
		popup.style.setProperty(DRAWER_CSS_VARS.swipeStrength, `${strength}`);
		untrack(() => this.backdropElement)?.style.setProperty(
			DRAWER_CSS_VARS.swipeStrength,
			`${strength}`
		);
	}

	/**
	 * Compute the release duration scalar (0.1–1) from the release velocity so
	 * the close animation speed matches the user's gesture.
	 */
	private resolveSwipeReleaseScalar(
		direction: SwipeDirection,
		info: SwipeReleaseInfo,
		snapBaseOffset: number
	): number | null {
		const element = untrack(() => this.popupElement);
		if (!element) return null;

		const size =
			direction === "left" || direction === "right" ? element.offsetWidth : element.offsetHeight;
		if (!Number.isFinite(size) || size <= 0) return null;

		const axisDelta = direction === "left" || direction === "right" ? info.deltaX : info.deltaY;
		let baseOffset = 0;
		if (direction === "down") {
			baseOffset = snapBaseOffset;
		} else if (direction === "up") {
			baseOffset = -snapBaseOffset;
		}

		const translation = baseOffset + axisDelta;
		const translationAlongDirection =
			direction === "left" || direction === "up" ? -translation : translation;
		const remainingDistance = Math.max(0, size - translationAlongDirection);
		if (!Number.isFinite(remainingDistance) || remainingDistance <= 0) return null;

		const axisVelocity =
			direction === "left" || direction === "right"
				? info.releaseVelocityX
				: info.releaseVelocityY;
		const fallbackVelocity =
			direction === "left" || direction === "right" ? info.velocityX : info.velocityY;
		const resolvedVelocity =
			Math.abs(axisVelocity) > 0 && Number.isFinite(axisVelocity)
				? axisVelocity
				: fallbackVelocity;
		const directionalVelocity =
			direction === "left" || direction === "up" ? -resolvedVelocity : resolvedVelocity;
		if (!Number.isFinite(directionalVelocity) || directionalVelocity <= MIN_SWIPE_RELEASE_VELOCITY) {
			return null;
		}

		const clampedVelocity = clamp(
			directionalVelocity,
			MIN_SWIPE_RELEASE_VELOCITY,
			MAX_SWIPE_RELEASE_VELOCITY
		);
		const durationMs = clamp(
			remainingDistance / clampedVelocity,
			MIN_SWIPE_RELEASE_DURATION_MS,
			MAX_SWIPE_RELEASE_DURATION_MS
		);
		if (!Number.isFinite(durationMs)) return null;

		const normalizedDuration =
			(durationMs - MIN_SWIPE_RELEASE_DURATION_MS) /
			(MAX_SWIPE_RELEASE_DURATION_MS - MIN_SWIPE_RELEASE_DURATION_MS);
		const durationScalar = clamp(
			MIN_SWIPE_RELEASE_SCALAR +
				normalizedDuration * (MAX_SWIPE_RELEASE_SCALAR - MIN_SWIPE_RELEASE_SCALAR),
			MIN_SWIPE_RELEASE_SCALAR,
			MAX_SWIPE_RELEASE_SCALAR
		);
		if (!Number.isFinite(durationScalar) || durationScalar <= 0) return null;

		return durationScalar;
	}

	clearSwipeRelease() {
		this.setSwipeDismissedAttributes(false);

		const popup = untrack(() => this.popupElement);
		// Strip the synthetic ending-style bridge (set in startSwipeRelease) when
		// the close was cancelled or the drawer reopens.
		if (popup && untrack(() => this.opts.open.current)) {
			popup.removeAttribute("data-ending-style");
		}
		popup?.style.removeProperty(DRAWER_CSS_VARS.swipeStrength);
		untrack(() => this.backdropElement)?.style.removeProperty(DRAWER_CSS_VARS.swipeStrength);

		this.swipeRelease = null;
	}

	private handleSwipeDismiss(_event: PointerEvent | TouchEvent) {
		// Reset the swipe fade; the ending styles take over from here.
		this.provider?.visualStateStore.set({ swipeProgress: 0, frontmostHeight: 0 });
		const backdrop = untrack(() => this.backdropElement);
		if (backdrop) {
			backdrop.style.setProperty(DRAWER_CSS_VARS.swipeProgress, "0");
			backdrop.style.removeProperty(DRAWER_CSS_VARS.height);
		}

		this.swipeDismissed = true;
		this.opts.open.current = false;

		// In controlled usage the consumer may reject the close (keep `open`
		// true). Check on the next frame and revert the dismiss visuals if so.
		if (typeof requestAnimationFrame === "function") {
			this.cancelRevertFrame();
			this.revertFrame = requestAnimationFrame(() => {
				this.revertFrame = 0;
				if (untrack(() => this.opts.open.current)) {
					const pendingSnapPoint = this.pendingSwipeCloseSnapPoint;
					if (pendingSnapPoint !== undefined) {
						this.setActiveSnapPoint(pendingSnapPoint);
					}
					this.pendingSwipeCloseSnapPoint = undefined;
					this.swipeDismissed = false;
					this.swipeGesture.reset();
					this.clearSwipeRelease();
				} else {
					this.pendingSwipeCloseSnapPoint = undefined;
				}
			});
		}
	}

	private cancelRevertFrame() {
		if (this.revertFrame !== 0) {
			cancelAnimationFrame(this.revertFrame);
			this.revertFrame = 0;
		}
	}

	/**
	 * Reset all swipe state; called by the viewport when the drawer opens.
	 * Idempotent and prop-write free — the snap point reset happens in the root
	 * when the drawer CLOSES (mirroring upstream), so a spurious re-run of the
	 * caller effect can't clobber a snap point chosen by the user.
	 */
	resetAfterOpen() {
		this.cancelRevertFrame();
		this.pendingSwipeCloseSnapPoint = undefined;
		this.swipeGesture.reset();
		this.clearSwipeRelease();
		this.swipeDismissed = false;
		this.touchScroll.reset();

		const backdrop = untrack(() => this.backdropElement);
		if (backdrop) {
			backdrop.style.setProperty(DRAWER_CSS_VARS.swipeProgress, "0");
			backdrop.style.removeProperty(DRAWER_CSS_VARS.height);
		}
	}

	// --- Backdrop updates ---

	private setBackdropSwipingAttribute(swiping: boolean) {
		const backdrop = untrack(() => this.backdropElement);
		if (!backdrop) return;
		if (swiping) {
			backdrop.setAttribute("data-swiping", "");
		} else {
			backdrop.removeAttribute("data-swiping");
		}
	}

	private setSwipeDismissedAttributes(dismissed: boolean) {
		const popup = untrack(() => this.popupElement);
		const backdrop = untrack(() => this.backdropElement);
		if (dismissed) {
			popup?.setAttribute("data-swipe-dismiss", "");
			backdrop?.setAttribute("data-swipe-dismiss", "");
		} else {
			popup?.removeAttribute("data-swipe-dismiss");
			backdrop?.removeAttribute("data-swipe-dismiss");
		}
	}

	// --- Measurements ---

	private setPopupHeight(height: number) {
		this.popupHeight = height;
		if (!this.nestedFrontmostActive && height > 0) {
			this.frontmostHeight = height;
		}
	}

	trackPopupHeight(element: HTMLElement) {
		const measure = () => {
			const offsetHeight = element.offsetHeight;
			const lastHeight = untrack(() => this.popupHeight);
			const frontmost = untrack(() => this.frontmostHeight);

			// Only skip while the element is still actually stretched beyond its
			// last measured height (a nested drawer can stretch the parent).
			if (lastHeight > 0 && frontmost > lastHeight && offsetHeight > lastHeight) {
				return;
			}

			// Keep the height frozen while a nested drawer is present.
			if (lastHeight > 0 && untrack(() => this.hasNestedDrawer)) {
				this.setPopupHeight(lastHeight);
				return;
			}

			if (offsetHeight === lastHeight) return;
			this.setPopupHeight(offsetHeight);
		};

		measure();

		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
			this.setPopupHeight(0);
		};
	}

	trackViewportSize(element: HTMLElement) {
		const doc = element.ownerDocument;
		const measure = () => {
			this.viewportHeight = element.offsetHeight;
			const fontSize = Number.parseFloat(getComputedStyle(doc.documentElement).fontSize);
			if (Number.isFinite(fontSize)) {
				this.rootFontSize = fontSize;
			}
		};

		measure();

		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}

	// --- Public getters for template bindings ---

	get isOpen() {
		return this.opts.open.current;
	}

	/** Whether the drawer should be in the DOM (open, or animating out). */
	get mounted() {
		return this.opts.open.current || this.popupElement !== null;
	}

	get isSwiping() {
		return this.swipeGesture.swiping;
	}

	/** Whether this drawer is nested inside another drawer. */
	get nested() {
		return this.parent !== null;
	}
}
