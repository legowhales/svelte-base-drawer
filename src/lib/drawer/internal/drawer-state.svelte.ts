/**
 * Drawer state management.
 * Coordinates the swipe gesture engine, touch scroll handler,
 * and bits-ui Dialog to create a mobile-friendly drawer.
 */
import { Context } from "runed";
import { untrack } from "svelte";
import { createSwipeGesture, type SwipeGesture } from "./create-swipe-gesture.svelte.js";
import { createDrawerTouchScroll } from "./create-drawer-touch-scroll.svelte.js";
import { type SwipeDirection, clamp } from "./utils.js";

// CSS custom property names
export const DRAWER_CSS_VARS = {
	swipeMovementX: "--drawer-swipe-x",
	swipeMovementY: "--drawer-swipe-y",
	swipeProgress: "--drawer-swipe-progress",
	swipeStrength: "--drawer-swipe-strength",
	height: "--drawer-height",
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

// --- CSS property registration (performance optimisation) ---
// Setting inherits: false prevents high-frequency swipe vars from
// cascading into deep subtrees, reducing style recalculation cost.
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
	reg(DRAWER_CSS_VARS.swipeProgress, "<number>", "0");
	reg(DRAWER_CSS_VARS.swipeStrength, "<number>", "1");
}

export interface DrawerRootOptions {
	open: { current: boolean };
	onOpenChange?: (open: boolean) => void;
	swipeDirection?: SwipeDirection;
	/** Minimum distance (px or fraction of size) to swipe before dismissing */
	dismissThreshold?: number;
}

export const DrawerContext = new Context<DrawerRootState>("Drawer.Root");

export class DrawerRootState {
	// --- Options ---
	readonly opts: DrawerRootOptions;
	readonly swipeDirection: SwipeDirection;

	// --- Elements ---
	popupElement = $state<HTMLElement | null>(null);
	overlayElement = $state<HTMLElement | null>(null);
	viewportElement = $state<HTMLElement | null>(null);

	// --- Swipe state ---
	swipeGesture: SwipeGesture;
	touchScroll: ReturnType<typeof createDrawerTouchScroll>;
	swipeRelease = $state<number | null>(null);
	swipeDismissed = $state(false);
	popupHeight = $state(0);

	constructor(opts: DrawerRootOptions) {
		this.opts = opts;
		this.swipeDirection = opts.swipeDirection ?? "down";

		// Create the swipe gesture engine
		this.swipeGesture = createSwipeGesture({
			enabled: () => this.opts.open.current,
			directions: () => [this.swipeDirection],
			popupElement: () => this.popupElement,
			movementCssVars: {
				x: DRAWER_CSS_VARS.swipeMovementX,
				y: DRAWER_CSS_VARS.swipeMovementY,
			},
			swipeThreshold: ({ element, direction }) => {
				const size =
					direction === "left" || direction === "right"
						? element.offsetWidth
						: element.offsetHeight;
				return Math.max(size * 0.5, MIN_SWIPE_THRESHOLD);
			},
			canStart: (position, event) => {
				const popup = this.popupElement;
				if (!popup) return false;
				const doc = popup.ownerDocument;
				const el = doc.elementFromPoint(position.x, position.y);
				if (!el || !popup.contains(el)) return false;
				return true;
			},
			onSwipeStart: (event) => {
				// Clear text selection on non-touch swipe to prevent interference
				if (event instanceof PointerEvent && event.pointerType !== "touch") {
					const doc = this.popupElement?.ownerDocument;
					const sel = doc?.getSelection();
					if (sel && !sel.isCollapsed) sel.removeAllRanges();
				}
			},
			onProgress: (progress, details) => {
				this.updateOverlayProgress(progress);
				this.setInlineSwipeTransform(details.deltaX, details.deltaY);
			},
			onSwipingChange: (swiping) => {
				this.setOverlaySwiping(swiping);
				if (swiping) {
					this.enableInlineSwipeMode();
				} else {
					this.clearInlineSwipeStyles();
					if (!this.swipeGesture.dismissed) {
						this.updateOverlayProgress(0);
					}
				}
			},
			onRelease: (info) => {
				return this.handleSwipeRelease(info);
			},
			onDismiss: (_event) => {
				this.swipeDismissed = true;
				this.opts.onOpenChange?.(false);
				this.opts.open.current = false;
			},
		});

		// Create the touch scroll handler
		this.touchScroll = createDrawerTouchScroll({
			rootElement: () => this.viewportElement ?? this.popupElement,
			active: () => this.opts.open.current,
			swipeDirection: () => this.swipeDirection,
			swipeGesture: this.swipeGesture,
		});
	}

	static create(opts: DrawerRootOptions) {
		return DrawerContext.set(new DrawerRootState(opts));
	}

	// --- Swipe release logic ---
	private handleSwipeRelease(info: {
		deltaX: number;
		deltaY: number;
		direction: SwipeDirection | undefined;
		velocityX: number;
		velocityY: number;
		releaseVelocityX: number;
		releaseVelocityY: number;
		event: PointerEvent | TouchEvent;
	}): boolean | undefined {
		const { direction, deltaX, deltaY, velocityX, velocityY } = info;

		if (!direction) return false;

		const element = untrack(() => this.popupElement);
		if (!element) return false;

		const size =
			direction === "left" || direction === "right"
				? element.offsetWidth
				: element.offsetHeight;
		if (!Number.isFinite(size) || size <= 0) return false;

		const delta = direction === "left" || direction === "right" ? deltaX : deltaY;
		if (!Number.isFinite(delta)) return false;

		const directionalDelta =
			direction === "left" || direction === "up" ? -delta : delta;
		if (directionalDelta <= 0) return false;

		// Fast swipe = instant dismiss
		const velocity =
			direction === "left" || direction === "right" ? velocityX : velocityY;
		const directionalVelocity =
			direction === "left" || direction === "up" ? -velocity : velocity;
		if (directionalVelocity >= FAST_SWIPE_VELOCITY && directionalDelta > 0) {
			this.computeSwipeRelease(info);
			return true;
		}

		// Threshold-based dismiss
		const threshold = Math.max(size * 0.5, MIN_SWIPE_THRESHOLD);
		if (directionalDelta > threshold) {
			this.computeSwipeRelease(info);
			return true;
		}

		return false;
	}

	/**
	 * Compute the release animation strength (duration scalar).
	 * This produces a natural-feeling close animation proportional to velocity.
	 */
	private computeSwipeRelease(info: {
		deltaX: number;
		deltaY: number;
		direction: SwipeDirection | undefined;
		releaseVelocityX: number;
		releaseVelocityY: number;
		velocityX: number;
		velocityY: number;
	}) {
		const { direction } = info;
		if (!direction) return;

		const element = untrack(() => this.popupElement);
		if (!element) return;

		const size =
			direction === "left" || direction === "right"
				? element.offsetWidth
				: element.offsetHeight;
		if (!Number.isFinite(size) || size <= 0) return;

		const axisDelta =
			direction === "left" || direction === "right" ? info.deltaX : info.deltaY;
		const translation =
			direction === "left" || direction === "up" ? -axisDelta : axisDelta;
		const remainingDistance = Math.max(0, size - translation);
		if (remainingDistance <= 0) {
			this.swipeRelease = null;
			return;
		}

		const axisReleaseVel =
			direction === "left" || direction === "right"
				? info.releaseVelocityX
				: info.releaseVelocityY;
		const fallbackVel =
			direction === "left" || direction === "right"
				? info.velocityX
				: info.velocityY;
		const resolvedVel =
			Math.abs(axisReleaseVel) > 0 && Number.isFinite(axisReleaseVel)
				? axisReleaseVel
				: fallbackVel;
		const directionalVel =
			direction === "left" || direction === "up" ? -resolvedVel : resolvedVel;

		if (!Number.isFinite(directionalVel) || directionalVel <= MIN_SWIPE_RELEASE_VELOCITY) {
			this.swipeRelease = null;
			return;
		}

		const clampedVel = clamp(directionalVel, MIN_SWIPE_RELEASE_VELOCITY, MAX_SWIPE_RELEASE_VELOCITY);
		const durationMs = clamp(
			remainingDistance / clampedVel,
			MIN_SWIPE_RELEASE_DURATION_MS,
			MAX_SWIPE_RELEASE_DURATION_MS
		);
		if (!Number.isFinite(durationMs)) {
			this.swipeRelease = null;
			return;
		}

		const normalizedDuration =
			(durationMs - MIN_SWIPE_RELEASE_DURATION_MS) /
			(MAX_SWIPE_RELEASE_DURATION_MS - MIN_SWIPE_RELEASE_DURATION_MS);
		const scalar = clamp(
			MIN_SWIPE_RELEASE_SCALAR +
				normalizedDuration * (MAX_SWIPE_RELEASE_SCALAR - MIN_SWIPE_RELEASE_SCALAR),
			MIN_SWIPE_RELEASE_SCALAR,
			MAX_SWIPE_RELEASE_SCALAR
		);

		if (Number.isFinite(scalar) && scalar > 0) {
			this.swipeRelease = scalar;
			// Set CSS var so the dismiss transition can use velocity-scaled duration
			const popup = untrack(() => this.popupElement);
			popup?.style.setProperty(DRAWER_CSS_VARS.swipeStrength, `${scalar}`);
		} else {
			this.swipeRelease = null;
		}
	}

	// --- Overlay updates ---

	private updateOverlayProgress(progress: number) {
		const overlay = untrack(() => this.overlayElement);
		if (!overlay) return;
		overlay.style.setProperty(DRAWER_CSS_VARS.swipeProgress, `${progress}`);
	}

	private setOverlaySwiping(swiping: boolean) {
		const overlay = untrack(() => this.overlayElement);
		if (!overlay) return;
		if (swiping) {
			overlay.setAttribute("data-swiping", "");
		} else {
			overlay.removeAttribute("data-swiping");
		}
	}

	// --- Inline transform during swiping ---
	// Matches base-ui: set inline transform + transition:none during drag,
	// remove on release so CSS transition takes over for snap-back/dismiss.

	private enableInlineSwipeMode() {
		const popup = untrack(() => this.popupElement);
		if (!popup) return;
		popup.style.setProperty("transition", "none");
	}

	private setInlineSwipeTransform(deltaX: number, deltaY: number) {
		const popup = untrack(() => this.popupElement);
		if (!popup) return;
		const dir = this.swipeDirection;
		if (dir === "up" || dir === "down") {
			popup.style.setProperty("transform", `translateY(${deltaY}px)`);
		} else {
			popup.style.setProperty("transform", `translateX(${deltaX}px)`);
		}
	}

	private clearInlineSwipeStyles() {
		const popup = untrack(() => this.popupElement);
		if (!popup) return;
		popup.style.removeProperty("transition");
		popup.style.removeProperty("transform");
	}

	// --- Popup height tracking ---

	trackPopupHeight(element: HTMLElement) {
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			this.popupHeight = element.offsetHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	}

	// --- Public getters for template bindings ---

	get isOpen() {
		return this.opts.open.current;
	}

	get isSwiping() {
		return this.swipeGesture.swiping;
	}
}
