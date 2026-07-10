export type SwipeDirection = "up" | "down" | "left" | "right";
export type ScrollAxis = "horizontal" | "vertical";

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function isVerticalDirection(dir: SwipeDirection): boolean {
	return dir === "up" || dir === "down";
}

export function getScrollAxis(dir: SwipeDirection): ScrollAxis {
	return isVerticalDirection(dir) ? "vertical" : "horizontal";
}

export function getCrossScrollAxis(dir: SwipeDirection): ScrollAxis {
	return isVerticalDirection(dir) ? "horizontal" : "vertical";
}

/**
 * Get the displacement along the swipe direction.
 * Positive = moving toward dismiss.
 */
export function getDisplacement(
	direction: SwipeDirection,
	deltaX: number,
	deltaY: number
): number {
	switch (direction) {
		case "up":
			return -deltaY;
		case "down":
			return deltaY;
		case "left":
			return -deltaX;
		case "right":
			return deltaX;
	}
}

/**
 * Apply square-root damping when swiping against the dismiss direction.
 * e.g. pulling a bottom drawer upward gets rubber-band resistance.
 */
export function applyDirectionalDamping(
	direction: SwipeDirection,
	deltaX: number,
	deltaY: number
): { x: number; y: number } {
	const damp = (v: number) => (v >= 0 ? v ** 0.5 : -(Math.abs(v) ** 0.5));
	switch (direction) {
		case "up":
			return { x: deltaX, y: deltaY > 0 ? damp(deltaY) : deltaY };
		case "down":
			return { x: deltaX, y: deltaY < 0 ? damp(deltaY) : deltaY };
		case "left":
			return { x: deltaX > 0 ? damp(deltaX) : deltaX, y: deltaY };
		case "right":
			return { x: deltaX < 0 ? damp(deltaX) : deltaX, y: deltaY };
	}
}

// --- Scroll detection ---

export function isScrollable(element: HTMLElement, axis: ScrollAxis): boolean {
	const style = getComputedStyle(element);
	if (axis === "vertical") {
		const overflowY = style.overflowY;
		return (
			(overflowY === "auto" || overflowY === "scroll") &&
			element.scrollHeight > element.clientHeight
		);
	}
	const overflowX = style.overflowX;
	return (
		(overflowX === "auto" || overflowX === "scroll") &&
		element.scrollWidth > element.clientWidth
	);
}

export function findScrollableTarget(
	target: EventTarget | null,
	root: HTMLElement,
	axis: ScrollAxis
): HTMLElement | null {
	let node = target instanceof HTMLElement ? target : null;
	while (node && node !== root) {
		if (isScrollable(node, axis)) {
			return node;
		}
		node = node.parentElement;
	}
	return root instanceof HTMLElement && isScrollable(root, axis) ? root : null;
}

export function hasScrollableContentOnAxis(
	scrollTarget: HTMLElement,
	axis: ScrollAxis
): boolean {
	return axis === "vertical"
		? scrollTarget.scrollHeight > scrollTarget.clientHeight
		: scrollTarget.scrollWidth > scrollTarget.clientWidth;
}

export function getScrollMetrics(
	scrollTarget: HTMLElement,
	axis: ScrollAxis
): { offset: number; max: number } {
	if (axis === "vertical") {
		const max = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
		return { offset: scrollTarget.scrollTop, max };
	}
	const max = Math.max(0, scrollTarget.scrollWidth - scrollTarget.clientWidth);
	return { offset: scrollTarget.scrollLeft, max };
}

/**
 * Whether the scroll target is at the edge from which a swipe would dismiss.
 * e.g. for direction="down", we dismiss when scrollTop === 0 (top edge).
 */
export function isAtSwipeStartEdge(
	scrollTarget: HTMLElement,
	axis: ScrollAxis,
	direction: SwipeDirection
): boolean {
	const { offset, max } = getScrollMetrics(scrollTarget, axis);
	const fromStart = shouldDismissFromStartEdge(direction, axis);
	if (fromStart === null) return false;
	return fromStart ? offset <= 0 : offset >= max;
}

export function canSwipeFromScrollEdgeOnMove(
	scrollTarget: HTMLElement,
	axis: ScrollAxis,
	direction: SwipeDirection,
	delta: number
): boolean {
	const { offset, max } = getScrollMetrics(scrollTarget, axis);
	const fromStart = shouldDismissFromStartEdge(direction, axis);
	if (fromStart === null) return false;

	const movingTowardDismiss = fromStart ? delta > 0 : delta < 0;
	if (!movingTowardDismiss) return false;

	return fromStart ? offset <= 0 : offset >= max;
}

function shouldDismissFromStartEdge(
	direction: SwipeDirection,
	axis: ScrollAxis
): boolean | null {
	if (axis === "vertical") {
		if (direction === "down") return true;
		if (direction === "up") return false;
		return null;
	}
	if (direction === "right") return true;
	if (direction === "left") return false;
	return null;
}

// --- DOM helpers ---

export function getElementAtPoint(
	doc: Document,
	x: number,
	y: number
): Element | null {
	return doc.elementFromPoint(x, y);
}

export function getElementTransform(element: HTMLElement): {
	x: number;
	y: number;
	scale: number;
} {
	const style = getComputedStyle(element);
	const transform = style.transform;
	let translateX = 0;
	let translateY = 0;
	let scale = 1;

	if (transform && transform !== "none") {
		const matrix = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
		if (matrix) {
			const values = matrix[1].split(", ").map(parseFloat);
			if (values.length === 6) {
				translateX = values[4];
				translateY = values[5];
				scale = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
			} else if (values.length === 16) {
				translateX = values[12];
				translateY = values[13];
				scale = values[0];
			}
		}
	}

	return { x: translateX, y: translateY, scale };
}

// --- Input/text detection ---

const SWIPE_IGNORE_SELECTOR =
	'[data-drawer-no-swipe], [data-drawer-no-swipe] *';

export function isSwipeIgnoredTarget(target: Element | null): boolean {
	return Boolean(target?.closest(SWIPE_IGNORE_SELECTOR));
}

export function isRangeInput(target: EventTarget | null): target is HTMLInputElement {
	return target instanceof HTMLInputElement && target.type === "range";
}

export function isTextSelectionControl(
	target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement {
	if (!(target instanceof Element)) return false;
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

export function shouldIgnoreSwipeForTextSelection(
	doc: Document,
	rootElement: HTMLElement
): boolean {
	const activeEl = doc.activeElement;
	if (activeEl && rootElement.contains(activeEl) && isTextSelectionControl(activeEl)) {
		const { selectionStart, selectionEnd } = activeEl;
		if (selectionStart != null && selectionEnd != null && selectionStart < selectionEnd) {
			return true;
		}
	}

	const selection = doc.getSelection?.();
	if (!selection || selection.isCollapsed) return false;

	return (
		selection.containsNode(rootElement, true) ||
		rootElement.contains(selection.anchorNode as Node) ||
		rootElement.contains(selection.focusNode as Node)
	);
}

export function isEventOnRangeInput(event: TouchEvent): boolean {
	const path = event.composedPath();
	if (path) return path.some((t) => isRangeInput(t));
	return isRangeInput(event.target);
}
