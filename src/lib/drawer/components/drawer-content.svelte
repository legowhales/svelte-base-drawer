<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DrawerContentProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		ref?: HTMLElement | null;
	}

	let { children, ref = $bindable(null), ...restProps }: DrawerContentProps = $props();
</script>

<!--
	The scrollable content region of the drawer. Marked with
	data-drawer-content so that:
	- pointer (mouse/pen) swipes never start here → text stays selectable;
	- CSS re-enables touch-action: auto inside it (native scrolling), while the
	  touch interception layer arbitrates scroll vs swipe at the edges.
-->
<div bind:this={ref} data-drawer-content="" {...restProps}>
	{@render children?.()}
</div>
