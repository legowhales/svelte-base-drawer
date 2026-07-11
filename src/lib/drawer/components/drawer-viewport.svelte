<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { untrack } from 'svelte';
	import { DrawerContext, registerDrawerCSSProperties } from '../internal/drawer-state.svelte.js';
	import { VirtualKeyboardContext } from '../internal/create-virtual-keyboard.svelte.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DrawerViewportProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		ref?: HTMLElement | null;
	}

	let { children, ref = $bindable(null), ...restProps }: DrawerViewportProps = $props();

	const drawer = DrawerContext.get();
	const virtualKeyboard = VirtualKeyboardContext.getOr(null);

	let viewportEl = $state<HTMLElement | null>(null);

	$effect(() => {
		ref = viewportEl;
	});

	// Register the viewport (gesture root, keyboard inset host) with the drawer.
	$effect(() => {
		const el = viewportEl;
		if (!el) return;
		registerDrawerCSSProperties();
		drawer.viewportElement = el;
		drawer.virtualKeyboard = virtualKeyboard;
		return () => {
			drawer.viewportElement = null;
			drawer.virtualKeyboard = null;
		};
	});

	// Capture-phase native touchmove listener: decides scroll vs swipe and
	// drives the gesture engine natively.
	$effect(() => {
		const root = viewportEl ?? drawer.popupElement;
		if (!root) return;
		return drawer.touchScroll.setupNativeTouchMoveListener(root);
	});

	// Reset swipe state whenever the drawer opens.
	$effect(() => {
		if (drawer.isOpen) {
			untrack(() => drawer.resetAfterOpen());
		}
	});

	// A nested drawer resets its parent's swipe progress when it closes or
	// unmounts (upstream DrawerViewport parity). Without this, a swipe dismiss
	// leaves the parent popup's --drawer-swipe-progress at ~1 and the parent
	// never returns to its stacked position on the next open.
	$effect(() => {
		const parent = drawer.parent;
		if (!parent) return;
		if (!drawer.isOpen) {
			untrack(() => parent.onNestedSwipeProgressChange(0));
		}
		return () => {
			untrack(() => parent.onNestedSwipeProgressChange(0));
		};
	});

	// Snap point resolution needs the viewport height (and root font size).
	$effect(() => {
		const el = viewportEl;
		if (!el) return;
		return drawer.trackViewportSize(el);
	});

	// Keep the backdrop fade in sync when the snap point changes without a
	// swipe (e.g. programmatically).
	$effect(() => {
		const range = drawer.snapPointRange;
		const progress = drawer.snapPointProgress;
		const open = drawer.isOpen;
		if (!range || drawer.isSwiping) return;

		const resolvedProgress = !open || drawer.nested ? 0 : (progress ?? 0);
		untrack(() => drawer.applySwipeProgress(resolvedProgress, true, false));
	});

	// Gesture handlers are stable functions reading live state internally.
	const gestureHandlers = drawer.createViewportHandlers();

	const viewportProps = $derived(
		mergeProps(
			restProps,
			{
				role: 'presentation',
				'data-drawer-viewport': '',
				'data-open': drawer.isOpen ? '' : undefined,
				'data-closed': !drawer.isOpen ? '' : undefined,
				// Explicit `auto` while open: bits-ui's modal scroll lock sets
				// pointer-events: none on <body>, which the viewport would inherit —
				// wheel/touch scrolling of viewport-level scrollers (mobile-nav
				// pattern) would only work over the popup. Upstream never disables
				// body pointer events, so its open viewport is a hit target too.
				style: drawer.isOpen ? 'pointer-events: auto' : 'pointer-events: none'
			},
			gestureHandlers
		)
	);
</script>

<!--
	A positioning container for the drawer popup, and the host of all swipe
	gesture handling. Rendered while the drawer is open or animating out.
-->
{#if drawer.mounted}
	<div bind:this={viewportEl} {...viewportProps}>
		{@render children?.()}
	</div>
{/if}
