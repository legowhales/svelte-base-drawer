export type SwipeDirection = 'up' | 'down' | 'left' | 'right';
export type ScrollAxis = 'horizontal' | 'vertical';

/**
 * Elements marked with this attribute (or inside one) never start a drawer swipe.
 * Mirrors base-ui's `data-base-ui-swipe-ignore`.
 */
export const SWIPE_IGNORE_SELECTOR = '[data-swipe-ignore]';

/** Attribute rendered by Drawer.Content — marks the scrollable content region. */
export const DRAWER_CONTENT_ATTRIBUTE = 'data-drawer-content';
const DRAWER_CONTENT_SELECTOR = `[${DRAWER_CONTENT_ATTRIBUTE}]`;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function isVerticalDirection(dir: SwipeDirection): boolean {
	return dir === 'up' || dir === 'down';
}

export function getScrollAxis(dir: SwipeDirection): ScrollAxis {
	return isVerticalDirection(dir) ? 'vertical' : 'horizontal';
}

export function getCrossScrollAxis(dir: SwipeDirection): ScrollAxis {
	return isVerticalDirection(dir) ? 'horizontal' : 'vertical';
}

/**
 * Get the displacement along the swipe direction.
 * Positive = moving toward dismiss.
 */
export function getDisplacement(direction: SwipeDirection, deltaX: number, deltaY: number): number {
	switch (direction) {
		case 'up':
			return -deltaY;
		case 'down':
			return deltaY;
		case 'left':
			return -deltaX;
		case 'right':
			return deltaX;
	}
}

// --- Timing / pointer helpers ---

export function getValidTimeStamp(timeStamp: number): number | null {
	return Number.isFinite(timeStamp) && timeStamp > 0 ? timeStamp : null;
}

export function getDragTransform(offset: { x: number; y: number }, scale: number): string {
	return `translate3d(${offset.x}px,${offset.y}px,0) scale(${scale})`;
}

/** Whether the primary (left) mouse button is among the pressed buttons. */
export function hasPrimaryMouseButton(buttons: number): boolean {
	return buttons % 2 === 1;
}

/**
 * set/releasePointerCapture that swallows NotFoundError (pointer already
 * released, e.g. after the OS interrupted the gesture).
 */
export function safelyChangePointerCapture(
	element: HTMLElement,
	pointerId: number,
	method: 'setPointerCapture' | 'releasePointerCapture'
) {
	const pointerCaptureMethod = element[method];
	if (typeof pointerCaptureMethod !== 'function') {
		return;
	}

	try {
		pointerCaptureMethod.call(element, pointerId);
	} catch (error) {
		if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError') {
			return;
		}
		throw error;
	}
}

// --- DOM helpers ---

export function isHTMLElement(node: unknown): node is HTMLElement {
	return node instanceof HTMLElement;
}

/**
 * Shadow-DOM-aware parent traversal (slots and shadow hosts included),
 * mirroring floating-ui's getParentNode.
 */
export function getParentNode(node: Node): Node | null {
	if (node.nodeName === 'HTML') {
		return null;
	}

	const result =
		// Step into the light DOM when the node is slotted.
		(node as HTMLElement).assignedSlot ||
		node.parentNode ||
		// Step out of shadow roots.
		((node as unknown as ShadowRoot).host ?? null);

	// Never land on a ShadowRoot itself — resolve to its host element so
	// traversal loops (which check for HTMLElement) keep walking.
	return typeof ShadowRoot !== 'undefined' && result instanceof ShadowRoot ? result.host : result;
}

function isLastTraversableNode(node: Node): boolean {
	return ['html', 'body', '#document'].includes(node.nodeName.toLowerCase());
}

/** The real event target, resolved through shadow boundaries. */
export function getEventTarget(event: Event): EventTarget | null {
	const path = event.composedPath?.();
	return path?.[0] ?? event.target;
}

export function getElementAtPoint(
	doc: Document | null | undefined,
	x: number,
	y: number
): Element | null {
	return typeof doc?.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
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

	if (transform && transform !== 'none') {
		const matrix = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
		if (matrix) {
			const values = matrix[1].split(', ').map(parseFloat);
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

// --- Scroll detection ---

export function isScrollable(
	element: HTMLElement,
	axis: ScrollAxis,
	// When true, a container that overflows only once extra space is added (e.g. drawer
	// keyboard scroll slack) still counts, as long as it has layout size on the axis.
	allowOverflowIntent = false
): boolean {
	const style = getComputedStyle(element);

	if (axis === 'vertical') {
		const overflowY = style.overflowY;
		if (overflowY !== 'auto' && overflowY !== 'scroll') {
			return false;
		}
		return allowOverflowIntent
			? element.clientHeight > 0
			: element.scrollHeight > element.clientHeight;
	}

	const overflowX = style.overflowX;
	if (overflowX !== 'auto' && overflowX !== 'scroll') {
		return false;
	}
	return allowOverflowIntent ? element.clientWidth > 0 : element.scrollWidth > element.clientWidth;
}

/**
 * Nearest scrollable ancestor of `target` on `axis`, bounded by `root`
 * (root itself is checked last). Traverses shadow boundaries.
 */
export function findScrollableTouchTarget(
	target: EventTarget | null,
	root: HTMLElement,
	axis: ScrollAxis = 'vertical',
	allowOverflowIntent = false
): HTMLElement | null {
	let node: Node | null = isHTMLElement(target) ? target : null;
	while (node && isHTMLElement(node) && node !== root && !isLastTraversableNode(node)) {
		if (isScrollable(node, axis, allowOverflowIntent)) {
			return node;
		}
		node = getParentNode(node);
	}

	return isScrollable(root, axis, allowOverflowIntent) ? root : null;
}

export function hasScrollableAncestor(
	target: Element,
	root: HTMLElement,
	axes: ScrollAxis[]
): boolean {
	let node: Node | null = target;
	while (node && isHTMLElement(node) && node !== root && !isLastTraversableNode(node)) {
		for (const axis of axes) {
			if (isScrollable(node, axis)) {
				return true;
			}
		}
		node = getParentNode(node);
	}
	return false;
}

export function hasScrollableContentOnAxis(scrollTarget: HTMLElement, axis: ScrollAxis): boolean {
	return axis === 'vertical'
		? scrollTarget.scrollHeight > scrollTarget.clientHeight
		: scrollTarget.scrollWidth > scrollTarget.clientWidth;
}

export function getScrollMetrics(
	scrollTarget: HTMLElement,
	axis: ScrollAxis
): { offset: number; max: number } {
	if (axis === 'vertical') {
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

function shouldDismissFromStartEdge(direction: SwipeDirection, axis: ScrollAxis): boolean | null {
	if (axis === 'vertical') {
		if (direction === 'down') return true;
		if (direction === 'up') return false;
		return null;
	}
	if (direction === 'right') return true;
	if (direction === 'left') return false;
	return null;
}

// --- Target classification ---

export function isSwipeIgnoredTarget(target: Element | null): boolean {
	return Boolean(target?.closest(SWIPE_IGNORE_SELECTOR));
}

export function isDrawerContentTarget(target: Element | null): boolean {
	return Boolean(target?.closest(DRAWER_CONTENT_SELECTOR));
}

export function isRangeInput(target: EventTarget | null): target is HTMLInputElement {
	return target instanceof HTMLInputElement && target.type === 'range';
}

export function isTextSelectionControl(
	target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement {
	if (!(target instanceof Element)) return false;
	return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

function hasExpandedSelectionWithinTarget(selection: Selection, target: Element): boolean {
	const anchorElement =
		selection.anchorNode instanceof Element
			? selection.anchorNode
			: selection.anchorNode?.parentElement;
	const focusElement =
		selection.focusNode instanceof Element
			? selection.focusNode
			: selection.focusNode?.parentElement;

	return (
		selection.containsNode(target, true) ||
		(anchorElement != null && target.contains(anchorElement)) ||
		(focusElement != null && target.contains(focusElement))
	);
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

	return hasExpandedSelectionWithinTarget(selection, rootElement);
}

export function isEventOnRangeInput(event: TouchEvent): boolean {
	const path = event.composedPath();
	if (path) return path.some((t) => isRangeInput(t));
	return isRangeInput(event.target);
}
