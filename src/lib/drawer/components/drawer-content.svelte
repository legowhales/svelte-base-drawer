<script lang="ts">
	import { Dialog, mergeProps } from "bits-ui";
	import { DrawerContext, DRAWER_CSS_VARS, registerDrawerCSSProperties } from "../internal/drawer-state.svelte.js";
	import { untrack } from "svelte";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	interface DrawerContentProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		forceMount?: boolean;
		onCloseAutoFocus?: (e: Event) => void;
		onOpenAutoFocus?: (e: Event) => void;
		onEscapeKeydown?: (e: KeyboardEvent) => void;
		onInteractOutside?: (e: PointerEvent) => void;
		ref?: HTMLElement | null;
	}

	let {
		children,
		forceMount = false,
		onCloseAutoFocus,
		onOpenAutoFocus,
		onEscapeKeydown,
		onInteractOutside,
		ref = $bindable(null),
		...restProps
	}: DrawerContentProps = $props();

	const drawer = DrawerContext.get();

	// Internal ref for our rendered div
	let contentEl = $state<HTMLElement | null>(null);

	// Sync internal ref → bindable ref + drawer state
	$effect(() => {
		ref = contentEl;
	});

	// Track popup element for gesture calculations
	$effect(() => {
		const el = contentEl;
		if (el) {
			drawer.popupElement = el;
			registerDrawerCSSProperties();
			const cleanup = drawer.trackPopupHeight(el);
			return () => {
				drawer.popupElement = null;
				cleanup?.();
			};
		}
	});

	// Set up native touchmove listener for scroll interception
	$effect(() => {
		const root = drawer.viewportElement ?? drawer.popupElement;
		if (!root) return;
		return drawer.touchScroll.setupNativeTouchMoveListener(root);
	});

	// Reset swipe state when drawer opens
	$effect(() => {
		const isOpen = drawer.opts.open.current;
		if (isOpen) {
			untrack(() => {
				drawer.swipeGesture.reset();
				drawer.swipeRelease = null;
				drawer.swipeDismissed = false;
				// Clear velocity scalar so non-swipe closes use default duration
				drawer.popupElement?.style.removeProperty(DRAWER_CSS_VARS.swipeStrength);
			});
		}
	});

	// Build the gesture-specific props to merge onto the content div.
	// Must use mergeProps (not spread) because both handler sets export onpointerdown.
	const gestureProps = $derived.by(() => {
		const isSwiping = drawer.swipeGesture.swiping;
		const isSwipeDismiss = drawer.swipeDismissed;
		return mergeProps(
			{
				"data-drawer-content": "",
				"data-swiping": isSwiping ? "" : undefined,
				"data-swipe-direction": drawer.swipeDirection,
				"data-swipe-dismiss": isSwipeDismiss ? "" : undefined,
			},
			drawer.swipeGesture.pointerHandlers,
			drawer.touchScroll.handlers,
		);
	});

	const mergedRestProps = $derived(mergeProps(restProps, gestureProps));
</script>

<!--
	Dialog.Content with:
	- preventScroll={false} → we handle scroll ourselves via touch interception
	- child snippet → to control the rendered element and inject gesture handlers
-->
<Dialog.Content
	{forceMount}
	{onCloseAutoFocus}
	{onOpenAutoFocus}
	{onEscapeKeydown}
	{onInteractOutside}
	preventScroll={false}
	trapFocus={true}
>
	{#snippet child({ props: dialogProps })}
		<div bind:this={contentEl} {...mergeProps(dialogProps, mergedRestProps)}>
			{@render children?.()}
		</div>
	{/snippet}
</Dialog.Content>
