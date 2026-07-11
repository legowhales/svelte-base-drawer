<script lang="ts">
	import { DrawerProviderContext } from '../internal/drawer-provider.svelte.js';
	import { DRAWER_CSS_VARS } from '../internal/drawer-state.svelte.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DrawerIndentProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		ref?: HTMLElement | null;
	}

	let { children, ref = $bindable(null), ...restProps }: DrawerIndentProps = $props();

	const provider = DrawerProviderContext.getOr(null);

	let indentEl = $state<HTMLElement | null>(null);

	$effect(() => {
		ref = indentEl;
	});

	// High-frequency swipe visuals (progress + frontmost height) are synced
	// imperatively from the provider's store — no re-renders per frame.
	$effect(() => {
		const el = indentEl;
		const store = provider?.visualStateStore;
		if (!el || !store) return;

		const sync = () => {
			const { swipeProgress, frontmostHeight } = store.getSnapshot();
			el.style.setProperty(
				DRAWER_CSS_VARS.swipeProgress,
				swipeProgress > 0 ? `${swipeProgress}` : '0'
			);
			if (frontmostHeight > 0) {
				el.style.setProperty(DRAWER_CSS_VARS.height, `${frontmostHeight}px`);
			} else {
				el.style.removeProperty(DRAWER_CSS_VARS.height);
			}
		};

		sync();
		const unsubscribe = store.subscribe(sync);
		return () => {
			unsubscribe();
			el.style.setProperty(DRAWER_CSS_VARS.swipeProgress, '0');
			el.style.removeProperty(DRAWER_CSS_VARS.height);
		};
	});

	const active = $derived(provider?.active ?? false);
</script>

<!--
	A wrapper intended to contain the app's main UI. Gets data-active while any
	drawer within the nearest Drawer.Provider is open, so CSS can scale it down
	behind the drawer (iOS-style indent effect).
-->
<div
	bind:this={indentEl}
	data-drawer-indent=""
	data-active={active ? '' : undefined}
	data-inactive={!active ? '' : undefined}
	{...restProps}
>
	{@render children?.()}
</div>
