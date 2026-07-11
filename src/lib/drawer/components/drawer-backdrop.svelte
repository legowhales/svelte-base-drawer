<script lang="ts">
	import { Dialog, mergeProps } from "bits-ui";
	import { DrawerContext } from "../internal/drawer-state.svelte.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

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

	const drawerProps = $derived({
		"data-drawer-backdrop": "",
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
