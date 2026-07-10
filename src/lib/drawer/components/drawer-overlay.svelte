<script lang="ts">
	import { Dialog, mergeProps } from "bits-ui";
	import { DrawerContext } from "../internal/drawer-state.svelte.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	interface DrawerOverlayProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		forceMount?: boolean;
		ref?: HTMLElement | null;
	}

	let {
		children,
		forceMount = false,
		ref = $bindable(null),
		...restProps
	}: DrawerOverlayProps = $props();

	const drawer = DrawerContext.get();

	// Track overlay element for swipe progress updates
	$effect(() => {
		if (ref) {
			drawer.overlayElement = ref;
			return () => {
				drawer.overlayElement = null;
			};
		}
	});

	const drawerProps = $derived({
		"data-drawer-overlay": "",
	});
</script>

<Dialog.Overlay {forceMount} bind:ref>
	{#snippet child({ props: dialogProps })}
		<div {...mergeProps(dialogProps, restProps, drawerProps)}>
			{@render children?.()}
		</div>
	{/snippet}
</Dialog.Overlay>
