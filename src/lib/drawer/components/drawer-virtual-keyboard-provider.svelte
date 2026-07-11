<script lang="ts">
	import { DrawerContext } from '../internal/drawer-state.svelte.js';
	import {
		createVirtualKeyboard,
		VirtualKeyboardContext
	} from '../internal/create-virtual-keyboard.svelte.js';
	import type { Snippet } from 'svelte';

	interface DrawerVirtualKeyboardProviderProps {
		children?: Snippet;
	}

	let { children }: DrawerVirtualKeyboardProviderProps = $props();

	const drawer = DrawerContext.get();

	// Keyboard-aware focus and scroll handling for drawers with form fields.
	// The hooks are consumed by Drawer.Viewport, which feeds it the touch
	// lifecycle so taps can be told apart from drags.
	const hooks = createVirtualKeyboard({
		open: () => drawer.isOpen,
		rootElement: () => drawer.viewportElement
	});

	VirtualKeyboardContext.set(hooks);
</script>

{@render children?.()}
