# svelte-base-drawer

A Svelte 5 port of [Base UI's Drawer](https://base-ui.com/react/components/drawer) (v1.6.0), built on [bits-ui](https://bits-ui.com) Dialog.

A drawer (bottom sheet) with mobile-grade gesture handling: the swipe engine, touch-scroll arbitration and release physics are a faithful port of Base UI's `useSwipeDismiss`, while focus management, portals and accessibility come from bits-ui Dialog.

> Unofficial port — not affiliated with MUI or the Base UI team. MIT licensed, like the original.

## Features

- **Swipe to dismiss** with momentum: velocity-scaled exit transitions, catchable mid-animation, scroll-vs-swipe arbitration inside scrollable content
- **Snap points** — controllable via `bind:snapPoint`, with `snapToSequentialPoints` and `data-expanded`
- **Nested drawers** — stacked-cards styling via `--nested-drawers` and `--drawer-frontmost-height`
- **Swipe to open** from a screen edge (`Drawer.SwipeArea`)
- **Indent effect** — the app surface scales down behind the drawer, iOS style (`Drawer.Provider` + `Drawer.Indent`)
- **Virtual keyboard support** — focused fields stay visible above the software keyboard (`Drawer.VirtualKeyboardProvider`)
- **4 swipe directions** (`down`, `up`, `left`, `right`), unstyled by default, `CloseWatcher` support on Android

## Install

```sh
npm install svelte-base-drawer
```

`bits-ui` is a peer dependency: the drawer wraps its Dialog for focus management, portals and accessibility. If your project doesn't already use it, install it as well:

```sh
npm install bits-ui
```

Requires Svelte 5.

## Usage

```svelte
<script>
	import * as Drawer from 'svelte-base-drawer';
</script>

<Drawer.Root>
	<Drawer.Trigger>Open</Drawer.Trigger>
	<Drawer.Portal>
		<Drawer.Backdrop />
		<Drawer.Viewport>
			<!-- required: hosts all swipe handling -->
			<Drawer.Popup>
				<!-- the panel -->
				<Drawer.Handle />
				<Drawer.Title>Title</Drawer.Title>
				<Drawer.Description>Description</Drawer.Description>
				<Drawer.Content>
					<!-- the scrollable region -->
					Your content here
				</Drawer.Content>
				<Drawer.Close>Close</Drawer.Close>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>
```

The anatomy mirrors Base UI:

| Component                                           | Role                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Drawer.Root`                                       | State container. `bind:open`, `bind:snapPoint`, `snapPoints`, `swipeDirection`        |
| `Drawer.Trigger`                                    | Opens the drawer (bits-ui re-export)                                                  |
| `Drawer.Portal`                                     | Portals the drawer to `document.body` or a custom container (`to={...}`)              |
| `Drawer.Backdrop`                                   | Dimmed overlay behind the drawer                                                      |
| `Drawer.Viewport`                                   | **Required.** Fixed full-screen container hosting all swipe and touch-scroll handling |
| `Drawer.Popup`                                      | The panel itself. `trapFocus={false}` / `preventScroll={false}` for non-modal drawers |
| `Drawer.Handle`                                     | Grab handle                                                                           |
| `Drawer.Content`                                    | The scrollable region (scrolling here doesn't drag the drawer until it hits an edge)  |
| `Drawer.Title` / `.Description` / `.Close`          | bits-ui re-exports                                                                    |
| `Drawer.SwipeArea`                                  | Edge zone that opens the drawer with a swipe                                          |
| `Drawer.Provider` + `.Indent` / `.IndentBackground` | Opt-in iOS-style scale-down of the app surface                                        |
| `Drawer.VirtualKeyboardProvider`                    | Opt-in: keeps focused fields visible above the mobile virtual keyboard                |

Elements marked `data-swipe-ignore` never start a swipe.

## Styling

Components are unstyled. Either import the starter stylesheet:

```js
import 'svelte-base-drawer/drawer.css';
```

…or write your own CSS against the data attributes and the CSS custom properties driven by the engine (registered with `inherits: false` for performance):

| Variable                                        | Meaning                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `--drawer-swipe-movement-x` / `-y`              | Displacement during the drag, in px (on the popup)           |
| `--drawer-swipe-progress`                       | 0–1, how far toward dismiss (on the backdrop)                |
| `--drawer-swipe-strength`                       | 0.1–1, velocity scalar for the dismiss transition duration   |
| `--drawer-snap-point-offset`                    | Offset of the active snap point (on the popup)               |
| `--drawer-height` / `--drawer-frontmost-height` | Measured heights, for nested stacking                        |
| `--nested-drawers`                              | Number of open nested drawers                                |
| `--drawer-keyboard-inset`                       | Software keyboard inset (requires `VirtualKeyboardProvider`) |

Key data attributes: `data-swiping` (during a drag), `data-expanded` (largest snap point), `data-nested` / `data-nested-drawer-open` (stacking), and bits-ui's `data-starting-style` / `data-ending-style` for enter/exit transitions.

A typical popup transform:

```css
.my-popup {
	transform: translateY(
		calc(var(--drawer-snap-point-offset, 0px) + var(--drawer-swipe-movement-y, 0px))
	);
	transition: transform 450ms cubic-bezier(0.32, 0.72, 0, 1);
}
.my-popup[data-swiping] {
	transition-duration: 0ms;
}
.my-popup[data-ending-style] {
	transition-duration: calc(var(--drawer-swipe-strength, 1) * 400ms);
}
.my-popup[data-starting-style],
.my-popup[data-ending-style] {
	transform: translateY(100%);
}
```

See the demos (ports of the Base UI docs examples) in [`src/demos/`](src/demos) — snap points, nested drawers, virtual keyboard, indent effect, mobile navigation, swipe to open, action sheet — each with its full CSS.

## Development

The repo is a SvelteKit app: the library lives in `src/lib`, the documentation/demo site in `src/routes`.

```sh
npm run dev       # docs site with all demos
npm run check     # svelte-check
npm run package   # build the package into dist/ + publint
npm run build     # static build of the docs site
```

## Credits & license

[MIT](LICENSE). Ported from [Base UI](https://github.com/mui/base-ui) (MIT © Material-UI SAS); the demos are adapted from the Base UI documentation. Built on [bits-ui](https://bits-ui.com) by Huntabyte.
