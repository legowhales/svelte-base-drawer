/**
 * Global drawer coordination. Port of base-ui v1.7.0 DrawerProvider.
 *
 * Tracks whether ANY drawer under the provider is open (`active`, consumed by
 * Drawer.Indent / Drawer.IndentBackground) and exposes an imperative
 * visual-state store (swipe progress + frontmost popup height) so the indent
 * effect can track the swipe at high frequency without re-renders.
 */
import { Context } from 'runed';

export interface DrawerVisualState {
	swipeProgress: number;
	frontmostHeight: number;
}

export interface DrawerVisualStateStore {
	getSnapshot: () => DrawerVisualState;
	set: (next: Partial<DrawerVisualState>) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createVisualStateStore(): DrawerVisualStateStore {
	let state: DrawerVisualState = {
		swipeProgress: 0,
		frontmostHeight: 0
	};
	const listeners = new Set<() => void>();

	return {
		getSnapshot: () => state,
		set(next) {
			let nextSwipeProgress = state.swipeProgress;
			if (next.swipeProgress !== undefined) {
				nextSwipeProgress = Number.isFinite(next.swipeProgress) ? next.swipeProgress : 0;
			}

			let nextFrontmostHeight = state.frontmostHeight;
			if (next.frontmostHeight !== undefined) {
				nextFrontmostHeight = Number.isFinite(next.frontmostHeight) ? next.frontmostHeight : 0;
			}

			if (
				nextSwipeProgress === state.swipeProgress &&
				nextFrontmostHeight === state.frontmostHeight
			) {
				return;
			}

			state = {
				swipeProgress: nextSwipeProgress,
				frontmostHeight: nextFrontmostHeight
			};

			listeners.forEach((listener) => {
				listener();
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

export class DrawerProviderState {
	/** Whether any drawer registered with this provider is open. */
	active = $state(false);
	readonly visualStateStore = createVisualStateStore();

	private openById = new Map<string, boolean>();

	setDrawerOpen(drawerId: string, open: boolean) {
		if (this.openById.get(drawerId) === open) return;
		this.openById.set(drawerId, open);
		this.recompute();
	}

	removeDrawer(drawerId: string) {
		if (!this.openById.has(drawerId)) return;
		this.openById.delete(drawerId);
		this.recompute();
	}

	private recompute() {
		let active = false;
		for (const open of this.openById.values()) {
			if (open) {
				active = true;
				break;
			}
		}
		this.active = active;
	}
}

export const DrawerProviderContext = new Context<DrawerProviderState>('Drawer.Provider');
