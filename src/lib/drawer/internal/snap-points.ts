/**
 * Snap point resolution. Port of base-ui v1.7.0 `useDrawerSnapPoints` helpers.
 *
 * Snap points position the drawer at intermediate heights:
 * - numbers in (0, 1] are fractions of the viewport height
 * - numbers > 1 are pixel values
 * - strings support `px` and `rem` units
 */
import { clamp } from './utils.js';

export type DrawerSnapPoint = number | string;

export interface ResolvedDrawerSnapPoint {
	value: DrawerSnapPoint;
	height: number;
	/** Distance (px) between the fully-open position and this snap point. */
	offset: number;
}

/**
 * Resolves the vertical swipe movement for a snap point, applying square-root
 * damping once the drag overshoots the fully-open edge (`nextOffset < 0`) so
 * the popup resists travelling past it.
 */
export function getSnapPointSwipeMovement(baseOffset: number, movementValue: number): number {
	const nextOffset = baseOffset + movementValue;
	if (nextOffset >= 0) {
		return movementValue;
	}

	return -Math.sqrt(-nextOffset) - baseOffset;
}

export function resolveSnapPointValue(
	snapPoint: DrawerSnapPoint,
	viewportHeight: number,
	rootFontSize: number
): number | null {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
		return null;
	}

	if (typeof snapPoint === 'number') {
		if (!Number.isFinite(snapPoint)) {
			return null;
		}

		if (snapPoint <= 1) {
			return clamp(snapPoint, 0, 1) * viewportHeight;
		}

		return snapPoint;
	}

	const trimmed = snapPoint.trim();

	if (trimmed.endsWith('px')) {
		const value = Number.parseFloat(trimmed);
		return Number.isFinite(value) ? value : null;
	}

	if (trimmed.endsWith('rem')) {
		const value = Number.parseFloat(trimmed);
		return Number.isFinite(value) ? value * rootFontSize : null;
	}

	return null;
}

export function findClosestSnapPoint(
	height: number,
	points: ResolvedDrawerSnapPoint[]
): ResolvedDrawerSnapPoint | null {
	let closest: ResolvedDrawerSnapPoint | null = null;
	let closestDistance = Infinity;

	for (const point of points) {
		const distance = Math.abs(point.height - height);
		if (distance < closestDistance) {
			closestDistance = distance;
			closest = point;
		}
	}

	return closest;
}

export function resolveSnapPoints(
	snapPoints: DrawerSnapPoint[] | undefined,
	viewportHeight: number,
	rootFontSize: number,
	popupHeight: number
): ResolvedDrawerSnapPoint[] {
	if (!snapPoints || snapPoints.length === 0 || viewportHeight <= 0 || popupHeight <= 0) {
		return [];
	}

	const maxHeight = Math.min(popupHeight, viewportHeight);
	if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
		return [];
	}

	const resolved = snapPoints
		.map((value): ResolvedDrawerSnapPoint | null => {
			const resolvedHeight = resolveSnapPointValue(value, viewportHeight, rootFontSize);
			if (resolvedHeight === null || !Number.isFinite(resolvedHeight)) {
				return null;
			}

			const clampedHeight = clamp(resolvedHeight, 0, maxHeight);
			return {
				value,
				height: clampedHeight,
				offset: Math.max(0, popupHeight - clampedHeight)
			};
		})
		.filter((point): point is ResolvedDrawerSnapPoint => Boolean(point));

	if (resolved.length <= 1) {
		return resolved;
	}

	// Deduplicate near-equal heights (±1px), keeping the LAST occurrence.
	const deduped: ResolvedDrawerSnapPoint[] = [];
	const seenHeights: number[] = [];

	for (let index = resolved.length - 1; index >= 0; index -= 1) {
		const point = resolved[index];
		const isDuplicate = seenHeights.some((height) => Math.abs(height - point.height) <= 1);
		if (isDuplicate) {
			continue;
		}

		seenHeights.push(point.height);
		deduped.push(point);
	}

	deduped.reverse();
	return deduped;
}

export function resolveActiveSnapPoint(
	activeSnapPoint: DrawerSnapPoint | null | undefined,
	resolvedSnapPoints: ResolvedDrawerSnapPoint[],
	popupHeight: number,
	viewportHeight: number,
	rootFontSize: number
): ResolvedDrawerSnapPoint | undefined {
	if (activeSnapPoint === undefined) {
		return resolvedSnapPoints[0];
	}

	if (activeSnapPoint === null) {
		return undefined;
	}

	const exactMatch = resolvedSnapPoints.find((point) => Object.is(point.value, activeSnapPoint));
	if (exactMatch) {
		return exactMatch;
	}

	const maxHeight = Math.min(popupHeight, viewportHeight);
	const resolvedHeight = resolveSnapPointValue(activeSnapPoint, viewportHeight, rootFontSize);
	if (resolvedHeight === null || !Number.isFinite(resolvedHeight)) {
		return undefined;
	}

	const clampedHeight = clamp(resolvedHeight, 0, maxHeight);
	return findClosestSnapPoint(clampedHeight, resolvedSnapPoints) ?? undefined;
}
