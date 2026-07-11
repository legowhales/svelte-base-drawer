<script lang="ts">
	import { Dialog, mergeProps } from 'bits-ui';
	import { DrawerContext } from '../internal/drawer-state.svelte.js';
	import { untrack } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DrawerPopupProps extends HTMLAttributes<HTMLDivElement> {
		children?: Snippet;
		forceMount?: boolean;
		/** Set both to false for a non-modal drawer (page stays interactive). */
		trapFocus?: boolean;
		preventScroll?: boolean;
		onCloseAutoFocus?: (e: Event) => void;
		onOpenAutoFocus?: (e: Event) => void;
		onEscapeKeydown?: (e: KeyboardEvent) => void;
		onInteractOutside?: (e: PointerEvent) => void;
		ref?: HTMLElement | null;
	}

	let {
		children,
		forceMount = false,
		trapFocus = true,
		preventScroll = true,
		onCloseAutoFocus,
		onOpenAutoFocus,
		onEscapeKeydown,
		onInteractOutside,
		ref = $bindable(null),
		...restProps
	}: DrawerPopupProps = $props();

	const drawer = DrawerContext.get();

	let popupEl = $state<HTMLElement | null>(null);
	let previouslyFocusedElement: HTMLElement | null = null;

	// Cancel outside-press dismissal while a SwipeArea gesture is in flight.
	const handleInteractOutside = (event: PointerEvent) => {
		if (drawer.outsidePressDisabled) {
			event.preventDefault();
			return;
		}
		onInteractOutside?.(event);
	};

	// bits-ui's default auto-focus calls .focus() without preventScroll, which
	// scrolls any scrollable/overflow-hidden ancestor to reveal the target while
	// the popup is still in its off-screen starting position (jumping portal
	// containers, drawer content scrolled to its end...). Mirror base-ui
	// instead: focus the popup itself on open and restore the previously
	// focused element on close, both with preventScroll.
	const handleOpenAutoFocus = (event: Event) => {
		onOpenAutoFocus?.(event);
		if (event.defaultPrevented) return;
		event.preventDefault();
		const active = popupEl?.ownerDocument.activeElement;
		previouslyFocusedElement = active instanceof HTMLElement ? active : null;
		popupEl?.focus({ preventScroll: true });
	};

	const handleCloseAutoFocus = (event: Event) => {
		onCloseAutoFocus?.(event);
		if (event.defaultPrevented) return;
		event.preventDefault();
		const target = previouslyFocusedElement;
		previouslyFocusedElement = null;
		if (target?.isConnected) {
			target.focus({ preventScroll: true });
		}
	};

	$effect(() => {
		ref = popupEl;
	});

	// Register the popup element and track its height.
	$effect(() => {
		const el = popupEl;
		if (!el) return;
		drawer.popupElement = el;
		const cleanup = drawer.trackPopupHeight(el);
		return () => {
			drawer.popupElement = null;
			cleanup?.();
		};
	});

	// Without a Drawer.Viewport there is no swipe handling nor touch scroll
	// interception. Checked in a microtask so the (parent) viewport has
	// registered by the time we look.
	$effect(() => {
		const el = popupEl;
		if (!el) return;
		let cancelled = false;
		queueMicrotask(() => {
			if (cancelled) return;
			if (!untrack(() => drawer.viewportElement)) {
				console.warn(
					'<Drawer.Popup> expected to be rendered within <Drawer.Viewport>. ' +
						'Omitting the viewport disables drawer swipe handling and touch scroll ' +
						'interception. Wrap <Drawer.Popup> in <Drawer.Viewport>.'
				);
			}
		});
		return () => {
			cancelled = true;
		};
	});

	// State-driven CSS vars live in the TEMPLATE style (like upstream's style
	// prop): bits-ui re-renders rewrite the whole style attribute (e.g. its
	// --bits-dialog-nested-count changes when a nested dialog registers, in a
	// later flush than our effects), which would wipe imperatively-set values.
	// Only per-frame drag styles (transform/transition/movement vars, written
	// by the engine on every move) stay imperative.
	//
	// The height vars are sampled only while this popup is not being swiped:
	// in snap-point mode the measured height tracks the movement var on every
	// frame, and a per-frame style-string change would make Svelte rewrite the
	// style attribute, wiping the engine's inline drag styles mid-swipe.
	let sampledPopupHeight = $state(0);
	let sampledFrontmostHeight = $state(0);
	$effect(() => {
		const popupHeight = drawer.popupHeight;
		const frontmostHeight = drawer.frontmostHeight;
		if (!drawer.isSwiping) {
			sampledPopupHeight = popupHeight;
			sampledFrontmostHeight = frontmostHeight;
		}
	});

	const popupStyle = $derived.by(() => {
		const style: Record<string, string> = {
			'--drawer-swipe-progress': '0',
			'--drawer-swipe-strength':
				drawer.swipeRelease !== null && drawer.swipeRelease > 0 ? `${drawer.swipeRelease}` : '1',
			'--drawer-snap-point-offset':
				drawer.snapPointOffsetValue !== null ? `${drawer.snapPointOffsetValue}px` : '0px',
			'--nested-drawers': `${drawer.nestedOpenDrawerCount}`
		};

		// Freeze the measured height while a nested drawer is present or the
		// drawer is animating out, so CSS can keep sizing stable.
		const frozen = drawer.hasNestedDrawer || (!drawer.isOpen && drawer.mounted);
		if (sampledPopupHeight > 0 && frozen) {
			style['--drawer-height'] = `${sampledPopupHeight}px`;
		}
		if (sampledFrontmostHeight > 0) {
			style['--drawer-frontmost-height'] = `${sampledFrontmostHeight}px`;
		}
		return style;
	});

	// data-swipe-dismiss and the synthetic data-ending-style bridge are managed
	// imperatively by the drawer state (never in this template) so Svelte
	// re-renders don't remove them mid-dismiss.
	const drawerProps = $derived({
		style: popupStyle,
		'data-drawer-popup': '',
		'data-swipe-direction': drawer.swipeDirection,
		'data-swiping': drawer.isSwiping ? '' : undefined,
		'data-expanded': drawer.expanded ? '' : undefined,
		'data-nested': drawer.nested ? '' : undefined,
		'data-nested-drawer-open': drawer.nestedOpenDrawerCount > 0 ? '' : undefined,
		'data-nested-drawer-swiping': drawer.nestedSwiping ? '' : undefined
	});

	const mergedRestProps = $derived(mergeProps(restProps, drawerProps));
</script>

<!--
	Dialog.Content with:
	- preventScroll (default true) → bits-ui locks document scroll (overflow:
	  hidden + scrollbar compensation; on iOS its touchmove guard only blocks
	  documentElement rubber-banding, so it doesn't interfere with the drawer's
	  own touch arbitration). Mirrors base-ui's useScrollLock(open && modal).
	- child snippet → to control the rendered element
-->
<Dialog.Content
	{forceMount}
	onCloseAutoFocus={handleCloseAutoFocus}
	onOpenAutoFocus={handleOpenAutoFocus}
	{onEscapeKeydown}
	onInteractOutside={handleInteractOutside}
	{trapFocus}
	{preventScroll}
>
	{#snippet child({ props: dialogProps })}
		<div bind:this={popupEl} {...mergeProps(dialogProps, mergedRestProps)}>
			{@render children?.()}
		</div>
	{/snippet}
</Dialog.Content>
