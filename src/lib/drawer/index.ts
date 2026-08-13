/**
 * Drawer component for Svelte 5.
 *
 * Built on top of bits-ui Dialog for accessibility (focus trap, escape,
 * click outside, ARIA) and adds mobile-grade swipe gesture handling
 * ported from base-ui v1.7.0.
 *
 * Anatomy (aligned with base-ui):
 * ```svelte
 * <script>
 *   import * as Drawer from 'svelte-base-drawer';
 *   let open = $state(false);
 * </script>
 *
 * <Drawer.Root bind:open>
 *   <Drawer.Trigger>Open</Drawer.Trigger>
 *   <Drawer.VirtualKeyboardProvider> <!-- optional: keyboard-aware forms -->
 *     <Drawer.Portal>
 *       <Drawer.Backdrop />
 *       <Drawer.Viewport>            <!-- required: hosts swipe handling -->
 *         <Drawer.Popup>             <!-- the drawer panel -->
 *           <Drawer.Handle />
 *           <Drawer.Title>Title</Drawer.Title>
 *           <Drawer.Description>Description</Drawer.Description>
 *           <Drawer.Content>         <!-- the scrollable region -->
 *             <p>Your content here</p>
 *           </Drawer.Content>
 *           <Drawer.Close>Close</Drawer.Close>
 *         </Drawer.Popup>
 *       </Drawer.Viewport>
 *     </Drawer.Portal>
 *   </Drawer.VirtualKeyboardProvider>
 * </Drawer.Root>
 * ```
 *
 * Elements marked with `data-swipe-ignore` never start a swipe.
 */
import { Dialog } from 'bits-ui';

// Drawer-specific components
export { default as Root } from './components/drawer-root.svelte';
export { default as Backdrop } from './components/drawer-backdrop.svelte';
export { default as Viewport } from './components/drawer-viewport.svelte';
export { default as Popup } from './components/drawer-popup.svelte';
export { default as Content } from './components/drawer-content.svelte';
export { default as Handle } from './components/drawer-handle.svelte';
export { default as VirtualKeyboardProvider } from './components/drawer-virtual-keyboard-provider.svelte';
export { default as SwipeArea } from './components/drawer-swipe-area.svelte';
export { default as Provider } from './components/drawer-provider.svelte';
export { default as Indent } from './components/drawer-indent.svelte';
export { default as IndentBackground } from './components/drawer-indent-background.svelte';

// Re-export bits-ui Dialog parts that need no drawer-specific behavior.
const { Portal, Trigger, Close, Title, Description } = Dialog;
export { Portal, Trigger, Close, Title, Description };

// Export CSS var names for custom styling
export { DRAWER_CSS_VARS } from './internal/drawer-state.svelte.js';

// Export types
export type { SwipeDirection } from './internal/utils.js';
export type { DrawerSnapPoint } from './internal/snap-points.js';
