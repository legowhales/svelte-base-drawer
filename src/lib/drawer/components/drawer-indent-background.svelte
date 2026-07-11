<script lang="ts">
	import { DrawerProviderContext } from "../internal/drawer-provider.svelte.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	interface DrawerIndentBackgroundProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		ref?: HTMLElement | null;
	}

	let { children, ref = $bindable(null), ...restProps }: DrawerIndentBackgroundProps = $props();

	const provider = DrawerProviderContext.getOr(null);
	const active = $derived(provider?.active ?? false);
</script>

<!--
	A background layer placed before Drawer.Indent, styleable based on whether
	any drawer is open (fills the area revealed by the indent scale-down).
-->
<div
	bind:this={ref}
	data-drawer-indent-background=""
	data-active={active ? "" : undefined}
	data-inactive={!active ? "" : undefined}
	{...restProps}
>
	{@render children?.()}
</div>
