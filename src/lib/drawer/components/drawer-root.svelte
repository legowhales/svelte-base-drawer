<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { untrack } from 'svelte';
	import { DrawerContext, DrawerRootState } from '../internal/drawer-state.svelte.js';
	import { DrawerProviderContext } from '../internal/drawer-provider.svelte.js';
	import type { DrawerSnapPoint } from '../internal/snap-points.js';
	import type { SwipeDirection } from '../internal/utils.js';
	import type { Snippet } from 'svelte';

	interface DrawerRootProps {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onOpenChangeComplete?: (open: boolean) => void;
		swipeDirection?: SwipeDirection;
		/**
		 * Snap points used to position the drawer. Numbers in (0, 1] are viewport
		 * height fractions, numbers > 1 are pixels; strings support px/rem.
		 */
		snapPoints?: DrawerSnapPoint[];
		/** The currently active snap point (bindable). */
		snapPoint?: DrawerSnapPoint | null;
		/** The snap point used when the drawer opens (defaults to snapPoints[0]). */
		defaultSnapPoint?: DrawerSnapPoint | null;
		onSnapPointChange?: (snapPoint: DrawerSnapPoint | null) => void;
		/** Disables velocity-based snap skipping. */
		snapToSequentialPoints?: boolean;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		onOpenChangeComplete,
		swipeDirection = 'down',
		snapPoints,
		snapPoint = $bindable(undefined),
		defaultSnapPoint,
		onSnapPointChange,
		snapToSequentialPoints = false,
		children
	}: DrawerRootProps = $props();

	const drawerId = $props.id();

	const resolvedDefaultSnapPoint = $derived(
		defaultSnapPoint !== undefined ? defaultSnapPoint : (snapPoints?.[0] ?? null)
	);
	// Intentional initial-only read: seed the uncontrolled snap point.
	if (snapPoint === undefined) {
		snapPoint = untrack(() => resolvedDefaultSnapPoint);
	}

	// Read surrounding contexts BEFORE registering our own DrawerContext:
	// a drawer rendered inside another drawer's popup picks up its parent here.
	const parentState = DrawerContext.getOr(null);
	const providerState = DrawerProviderContext.getOr(null);

	// The box setter is the single internal close path (swipe dismiss,
	// CloseWatcher): it updates the bound prop and notifies once. Closes
	// initiated by bits-ui (escape, outside press, Drawer.Close) notify through
	// the onOpenChange prop passed to Dialog.Root below.
	const state = DrawerRootState.create({
		open: {
			get current() {
				return open;
			},
			set current(v: boolean) {
				if (open === v) return;
				open = v;
				onOpenChange?.(v);
			}
		},
		swipeDirection: () => swipeDirection,
		snapPoints: () => snapPoints,
		snapToSequentialPoints: () => snapToSequentialPoints,
		snapPoint: {
			get current() {
				return snapPoint ?? null;
			},
			set current(v: DrawerSnapPoint | null) {
				if (snapPoint === v) return;
				snapPoint = v;
				onSnapPointChange?.(v);
			}
		},
		defaultSnapPoint: () => resolvedDefaultSnapPoint,
		parent: parentState,
		provider: providerState
	});

	// Restore the default snap point when the drawer closes (any close path),
	// so the next opening starts from the default. Mirrors upstream's
	// handleOpenChange reset-on-close.
	$effect(() => {
		if (!open) {
			untrack(() => {
				if (snapPoints && snapPoints.length > 0) {
					state.setActiveSnapPoint(resolvedDefaultSnapPoint);
				}
			});
		}
	});

	// --- Provider registration (indent effect) ---
	$effect(() => {
		providerState?.setDrawerOpen(drawerId, open);
	});
	$effect(() => {
		return () => providerState?.removeDrawer(drawerId);
	});

	// --- Nested drawer notifications to the parent ---
	// The notify calls are untracked: they read AND write parent state, and a
	// tracked read of a signal they also mutate would self-invalidate the
	// effect (infinite loop).
	$effect(() => {
		if (!parentState) return;
		if (open) {
			untrack(() => parentState.onNestedOpenChange(true));
			return () => parentState.onNestedOpenChange(false);
		}
	});
	$effect(() => {
		if (!parentState) return;
		if (state.mounted) {
			untrack(() => parentState.onNestedDrawerPresenceChange(true));
			return () => parentState.onNestedDrawerPresenceChange(false);
		}
	});
	$effect(() => {
		if (!parentState || !open) return;
		const height = state.frontmostHeight;
		untrack(() => parentState.onNestedFrontmostHeightChange(height));
		return () => parentState.onNestedFrontmostHeightChange(0);
	});

	// --- Android back gesture (CloseWatcher, Chromium-only) ---
	// Kept Android-only to avoid interfering with Escape/nesting semantics on
	// desktop; only the topmost drawer of a stack listens.
	$effect(() => {
		if (!open || state.nestedOpenDrawerCount > 0) return;
		if (typeof navigator === 'undefined' || !/android/i.test(navigator.userAgent)) return;

		const CloseWatcherCtor = (
			window as Window & { CloseWatcher?: new () => EventTarget & { destroy(): void } }
		).CloseWatcher;
		if (!CloseWatcherCtor) return;

		const watcher = new CloseWatcherCtor();
		const handleClose = () => {
			untrack(() => {
				state.opts.open.current = false;
			});
		};
		watcher.addEventListener('close', handleClose);
		return () => {
			watcher.removeEventListener('close', handleClose);
			watcher.destroy();
		};
	});
</script>

<Dialog.Root bind:open {onOpenChange} {onOpenChangeComplete}>
	{@render children?.()}
</Dialog.Root>
