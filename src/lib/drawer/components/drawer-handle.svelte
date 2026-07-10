<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	interface DrawerHandleProps extends HTMLAttributes<HTMLDivElement> {
		ref?: HTMLElement | null;
	}

	let { ref = $bindable(null), ...restProps }: DrawerHandleProps = $props();
</script>

<div bind:this={ref} data-drawer-handle="" aria-hidden="true" {...restProps}>
	<div data-drawer-handle-hitarea="">
		<!-- visual indicator styled via CSS -->
	</div>
</div>
