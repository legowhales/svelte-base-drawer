/**
 * Drawer component for Svelte 5.
 *
 * Built on top of bits-ui Dialog for accessibility (focus trap, escape,
 * click outside, ARIA) and adds mobile-grade swipe gesture handling
 * ported from base-ui.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import * as Drawer from '$lib/drawer';
 *   let open = $state(false);
 * </script>
 *
 * <Drawer.Root bind:open>
 *   <Drawer.Trigger>Open</Drawer.Trigger>
 *   <Drawer.Portal>
 *     <Drawer.Overlay class="drawer-overlay" />
 *     <Drawer.Content class="drawer-content">
 *       <Drawer.Handle />
 *       <Drawer.Title>Title</Drawer.Title>
 *       <Drawer.Description>Description</Drawer.Description>
 *       <p>Your content here</p>
 *       <Drawer.Close>Close</Drawer.Close>
 *     </Drawer.Content>
 *   </Drawer.Portal>
 * </Drawer.Root>
 * ```
 */
import { Dialog } from "bits-ui";

// Drawer-specific components
export { default as Root } from "./components/drawer-root.svelte";
export { default as Content } from "./components/drawer-content.svelte";
export { default as Overlay } from "./components/drawer-overlay.svelte";
export { default as Handle } from "./components/drawer-handle.svelte";

// Re-export bits-ui Dialog parts that need no drawer-specific behavior.
// These are re-exported so users can do `import * as Drawer from '$lib/drawer'`
// and use Drawer.Portal, Drawer.Trigger, etc.
const { Portal, Trigger, Close, Title, Description } = Dialog;
export { Portal, Trigger, Close, Title, Description };

// Export CSS var names for custom styling
export { DRAWER_CSS_VARS } from "./internal/drawer-state.svelte.js";

// Export types
export type { SwipeDirection } from "./internal/utils.js";
