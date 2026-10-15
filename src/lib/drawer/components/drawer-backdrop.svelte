<script lang="ts">
	import { Dialog, mergeProps } from 'bits-ui';
	import { DrawerContext } from '../internal/drawer-state.svelte.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DrawerBackdropProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		forceMount?: boolean;
		/** Render the backdrop even when the drawer is nested in another drawer. */
		forceRender?: boolean;
		ref?: HTMLElement | null;
	}

	let {
		children,
		forceMount = false,
		forceRender = false,
		ref = $bindable(null),
		...restProps
	}: DrawerBackdropProps = $props();

	const drawer = DrawerContext.get();

	// Register the backdrop for swipe progress / dismiss attribute updates.
	$effect(() => {
		if (ref) {
			drawer.backdropElement = ref;
			return () => {
				drawer.backdropElement = null;
			};
		}
	});

	// Closed (exit animation, or forceMount), the backdrop no longer takes the
	// pointer, like upstream's `pointerEvents: !open ? 'none'` (DrawerBackdrop).
	// `inert` rather than a style: bits-ui sets `pointer-events: auto` inline, and
	// a template style would rewrite the attribute on close, wiping the swipe
	// vars the engine writes imperatively (`--drawer-swipe-strength`, progress).
	const drawerProps = $derived({
		'data-drawer-backdrop': '',
		inert: !drawer.isOpen || undefined
	});
</script>

<!-- Nested drawers reuse the root drawer's backdrop (the parent popup dims
     itself via --drawer-swipe-progress instead). -->
{#if forceRender || !drawer.nested}
	<Dialog.Overlay {forceMount} bind:ref>
		{#snippet child({ props: dialogProps })}
			<div {...mergeProps(dialogProps, restProps, drawerProps)}>
				{@render children?.()}
			</div>
		{/snippet}
	</Dialog.Overlay>
{/if}
