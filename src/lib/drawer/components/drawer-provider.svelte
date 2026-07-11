<script lang="ts">
	import {
		DrawerProviderContext,
		DrawerProviderState
	} from '../internal/drawer-provider.svelte.js';
	import type { Snippet } from 'svelte';

	interface DrawerProviderProps {
		children?: Snippet;
	}

	let { children }: DrawerProviderProps = $props();

	// Shared context for coordinating global drawer UI (indent/background
	// effects based on whether any drawer under this provider is open).
	DrawerProviderContext.set(new DrawerProviderState());
</script>

{@render children?.()}
