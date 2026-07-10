<script lang="ts">
	import { Dialog } from "bits-ui";
	import { DrawerRootState, type DrawerRootOptions } from "../internal/drawer-state.svelte.js";
	import type { SwipeDirection } from "../internal/utils.js";
	import type { Snippet } from "svelte";

	interface DrawerRootProps {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onOpenChangeComplete?: (open: boolean) => void;
		swipeDirection?: SwipeDirection;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		onOpenChangeComplete,
		swipeDirection = "down",
		children,
	}: DrawerRootProps = $props();

	const drawerState = DrawerRootState.create({
		open: {
			get current() {
				return open;
			},
			set current(v: boolean) {
				open = v;
				onOpenChange?.(v);
			},
		},
		onOpenChange: (o) => {
			open = o;
			onOpenChange?.(o);
		},
		swipeDirection,
	});
</script>

<Dialog.Root bind:open {onOpenChange} {onOpenChangeComplete}>
	{@render children?.()}
</Dialog.Root>
