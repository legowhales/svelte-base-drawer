<script lang="ts">
	import '../demos/shared.css';
	import Basic from '../demos/Basic.svelte';
	import SnapPoints from '../demos/SnapPoints.svelte';
	import Nested from '../demos/Nested.svelte';
	import VirtualKeyboard from '../demos/VirtualKeyboard.svelte';
	import Indent from '../demos/Indent.svelte';
	import MobileNav from '../demos/MobileNav.svelte';
	import SwipeToOpen from '../demos/SwipeToOpen.svelte';
	import ActionSheet from '../demos/ActionSheet.svelte';

	const installCode = 'npm install svelte-base-drawer';

	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
	async function copyInstallCode() {
		let ok = false;
		try {
			await navigator.clipboard.writeText(installCode);
			ok = true;
		} catch {
			// Clipboard API unavailable (permissions/insecure context): fall back
			// to a transient textarea + execCommand.
			const textarea = document.createElement('textarea');
			textarea.value = installCode;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			try {
				ok = document.execCommand('copy');
			} finally {
				textarea.remove();
			}
		}
		if (ok) {
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 1500);
		}
	}

	const usageCode = `<script>
  import * as Drawer from 'svelte-base-drawer';
<\/script>

<Drawer.Root>
  <Drawer.Trigger>Open<\/Drawer.Trigger>
  <Drawer.Portal>
    <Drawer.Backdrop />
    <Drawer.Viewport>          <!-- required: hosts all swipe handling -->
      <Drawer.Popup>           <!-- the panel -->
        <Drawer.Handle />
        <Drawer.Title>Title<\/Drawer.Title>
        <Drawer.Description>Description<\/Drawer.Description>
        <Drawer.Content>       <!-- the scrollable region -->
          Your content here
        <\/Drawer.Content>
        <Drawer.Close>Close<\/Drawer.Close>
      <\/Drawer.Popup>
    <\/Drawer.Viewport>
  <\/Drawer.Portal>
<\/Drawer.Root>`;

	const demos = [
		{
			id: 'basic',
			title: 'Basic drawer',
			description: 'Swipe down to dismiss, or tap the backdrop. Catch it mid-animation.',
			component: Basic
		},
		{
			id: 'snap-points',
			title: 'Snap points',
			description: 'Drag the sheet to snap between a compact peek and a near full-height view.',
			component: SnapPoints
		},
		{
			id: 'nested',
			title: 'Nested drawers',
			description:
				'Nested drawers stack with a scale effect while staying independently focus managed.',
			component: Nested
		},
		{
			id: 'virtual-keyboard',
			title: 'Virtual keyboard aware',
			description: 'On mobile, focused fields stay visible above the software keyboard.',
			component: VirtualKeyboard
		},
		{
			id: 'indent',
			title: 'Indent effect',
			description: 'The app surface scales down behind the drawer, iOS style.',
			component: Indent
		},
		{
			id: 'mobile-nav',
			title: 'Mobile navigation',
			description: 'A tall menu scrolled within the viewport. Flick down from the top to dismiss.',
			component: MobileNav
		},
		{
			id: 'swipe-to-open',
			title: 'Swipe to open',
			description:
				'Swipe from the right edge of the frame (or drag it with a mouse) to open the drawer.',
			component: SwipeToOpen
		},
		{
			id: 'action-sheet',
			title: 'Action sheet',
			description: 'An uncontained drawer with a separate destructive action, iOS style.',
			component: ActionSheet
		}
	];

	const cssVars = [
		['--drawer-swipe-movement-x / -y', 'displacement during the drag, in px (on the popup)'],
		['--drawer-swipe-progress', '0–1, how far toward dismiss (on the backdrop)'],
		['--drawer-swipe-strength', '0.1–1, velocity scalar for the dismiss transition duration'],
		['--drawer-snap-point-offset', 'offset of the active snap point (on the popup)'],
		['--drawer-keyboard-inset', 'software keyboard inset (requires VirtualKeyboardProvider)'],
		['--nested-drawers', 'number of open nested drawers (for stacking effects)']
	];

	const dataAttrs = [
		['[data-swiping]', 'present while the user is dragging'],
		['[data-expanded]', 'present when snapped to the largest snap point'],
		['[data-nested] / [data-nested-drawer-open]', 'nesting state, for stacked-cards styling'],
		['[data-starting-style] / [data-ending-style]', 'enter/exit transition hooks (from bits-ui)'],
		['[data-swipe-ignore]', 'opt-out: no swipe ever starts on this element']
	];
</script>

<svelte:head>
	<title>svelte-base-drawer — Base UI's Drawer, ported to Svelte 5</title>
	<meta
		name="description"
		content="Drawer component for Svelte 5 — a port of Base UI's Drawer built on bits-ui Dialog. Swipe to dismiss, snap points, nested drawers, swipe to open, virtual keyboard support."
	/>
</svelte:head>

<div class="demo-page doc-page">
	<div class="doc-inner">
		<header class="doc-header">
			<div class="doc-header-row">
				<h1>svelte-base-drawer</h1>
				<a
					class="doc-github"
					href="https://github.com/legowhales/svelte-base-drawer"
					target="_blank"
					rel="noreferrer"
					aria-label="View the project on GitHub"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 32 32"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M16,2.345c7.735,0,14,6.265,14,14-.002,6.015-3.839,11.359-9.537,13.282-.7,.14-.963-.298-.963-.665,0-.473,.018-1.978,.018-3.85,0-1.312-.437-2.152-.945-2.59,3.115-.35,6.388-1.54,6.388-6.912,0-1.54-.543-2.783-1.435-3.762,.14-.35,.63-1.785-.14-3.71,0,0-1.173-.385-3.85,1.435-1.12-.315-2.31-.472-3.5-.472s-2.38,.157-3.5,.472c-2.677-1.802-3.85-1.435-3.85-1.435-.77,1.925-.28,3.36-.14,3.71-.892,.98-1.435,2.24-1.435,3.762,0,5.355,3.255,6.563,6.37,6.913-.403,.35-.77,.963-.893,1.872-.805,.368-2.818,.963-4.077-1.155-.263-.42-1.05-1.452-2.152-1.435-1.173,.018-.472,.665,.017,.927,.595,.332,1.277,1.575,1.435,1.978,.28,.787,1.19,2.293,4.707,1.645,0,1.173,.018,2.275,.018,2.607,0,.368-.263,.787-.963,.665-5.719-1.904-9.576-7.255-9.573-13.283,0-7.735,6.265-14,14-14Z"
						></path>
					</svg>
				</a>
			</div>
			<p class="doc-tagline">
				A Svelte 5 port of <a href="https://base-ui.com/react/components/drawer">Base UI's Drawer</a
				>
				(v1.7.0), built on <a href="https://bits-ui.com">bits-ui</a> Dialog. Swipe to dismiss with momentum,
				snap points, nested drawers, swipe to open, virtual keyboard support. Unstyled — you own the CSS.
				MIT licensed, not affiliated with MUI.
			</p>
			<nav class="doc-toc" aria-label="On this page">
				<a href="#install">Install</a>
				<a href="#usage">Usage</a>
				{#each demos as demo (demo.id)}
					<a href="#{demo.id}">{demo.title}</a>
				{/each}
				<a href="#styling">Styling</a>
			</nav>
		</header>

		<section id="install" class="doc-section">
			<h2>Install</h2>
			<div class="doc-install">
				<pre class="doc-code"><code>{installCode}</code></pre>
				<button type="button" class="doc-copy" onclick={copyInstallCode}>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
			<p class="doc-install-note">
				<code>bits-ui</code> is a peer dependency: the drawer wraps its Dialog for focus management, portals
				and accessibility. If your project doesn't already use it, install it as well:
				<code>npm install bits-ui</code>.
			</p>
		</section>

		<section id="usage" class="doc-section">
			<h2>Usage</h2>
			<p>
				The anatomy mirrors Base UI. <code>Drawer.Viewport</code> is required — it hosts all swipe
				and touch-scroll handling. Components ship unstyled: import
				<code>svelte-base-drawer/drawer.css</code> as a starter stylesheet, or style the data attributes
				yourself (each demo below has its own CSS).
			</p>
			<pre class="doc-code"><code>{usageCode}</code></pre>
		</section>

		{#each demos as demo (demo.id)}
			<section id={demo.id} class="doc-section">
				<h2>{demo.title}</h2>
				<p>{demo.description}</p>
				<demo.component />
			</section>
		{/each}

		<section id="styling" class="doc-section">
			<h2>Styling</h2>
			<p>
				The engine drives CSS custom properties (registered with <code>inherits: false</code>) and
				data attributes; your stylesheet decides what they do.
			</p>
			<h3>CSS variables</h3>
			<ul class="doc-ref">
				{#each cssVars as [name, doc] (name)}
					<li><code>{name}</code> — {doc}</li>
				{/each}
			</ul>
			<h3>Data attributes</h3>
			<ul class="doc-ref">
				{#each dataAttrs as [name, doc] (name)}
					<li><code>{name}</code> — {doc}</li>
				{/each}
			</ul>
		</section>

		<footer class="doc-footer">
			<p>
				MIT © Jérémy Le Mardelé. Ported from
				<a href="https://github.com/mui/base-ui">Base UI</a> (MIT © Material-UI SAS) — demos adapted from
				the Base UI documentation.
			</p>
		</footer>
	</div>
</div>

<style>
	.doc-inner {
		max-width: 44rem;
		margin: 0 auto;
	}

	.doc-header h1 {
		font-size: 1.5rem;
	}

	.doc-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	/* Same height/radius as the demo triggers (.demo-button), square,
	   transparent at rest; hover uses the triggers' default background. */
	.doc-github {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 7px;
		background-color: transparent;
		color: inherit;
	}

	@media (hover: hover) {
		.doc-github:hover {
			background-color: var(--color-stone-200);
		}
		@media (prefers-color-scheme: dark) {
			.doc-github:hover {
				background-color: --alpha(var(--color-stone-700) / 70%);
			}
		}
	}

	.doc-github:focus-visible {
		outline: 2px solid oklch(14.5% 0 0deg);
		outline-offset: -1px;
	}
	@media (prefers-color-scheme: dark) {
		.doc-github:focus-visible {
			outline-color: white;
		}
	}

	.doc-tagline {
		max-width: 40rem;
	}

	.doc-page :global(a) {
		color: inherit;
	}

	.doc-toc {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		margin: 1rem 0 0;
		font-size: 0.8125rem;
	}
	.doc-toc a {
		color: oklch(43.9% 0 0deg);
		text-decoration: none;
	}
	.doc-toc a:hover {
		text-decoration: underline;
	}
	@media (prefers-color-scheme: dark) {
		.doc-toc a {
			color: oklch(70.8% 0 0deg);
		}
	}

	.doc-section {
		margin-top: 3rem;
	}
	.doc-section h2 {
		font-size: 1.125rem;
		margin: 0 0 0.25rem;
	}
	.doc-section h3 {
		font-size: 0.9375rem;
		margin: 1.5rem 0 0.5rem;
	}
	.doc-section > p {
		margin: 0 0 1.25rem;
		font-size: 0.875rem;
		color: oklch(43.9% 0 0deg);
	}
	@media (prefers-color-scheme: dark) {
		.doc-section > p {
			color: oklch(70.8% 0 0deg);
		}
	}

	.doc-code {
		margin: 0;
		padding: 1rem;
		overflow-x: auto;
		font-size: 0.8125rem;
		line-height: 1.5;
		background: --alpha(var(--color-stone-200) / 60%);
		border: 1px solid var(--color-stone-300);
		border-radius: 4px;
	}
	@media (prefers-color-scheme: dark) {
		.doc-code {
			background: var(--color-stone-900);
			border-color: var(--color-stone-800);
		}
	}

	.doc-install {
		position: relative;
	}
	/* Reserve room for the absolutely-positioned copy button. */
	.doc-install .doc-code {
		padding-right: 5rem;
	}
	.doc-install-note {
		margin-top: 1rem;
	}

	.doc-copy {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		padding: 0.25rem 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		color: inherit;
		background: white;
		border: 1px solid var(--color-stone-300);
		border-radius: 4px;
		cursor: pointer;
	}
	.doc-copy:hover {
		border-color: var(--color-stone-400);
	}
	@media (prefers-color-scheme: dark) {
		.doc-copy {
			background: var(--color-stone-800);
			border-color: var(--color-stone-700);
		}
		.doc-copy:hover {
			border-color: var(--color-stone-600);
		}
	}

	code {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	}

	.doc-ref {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
		display: grid;
		gap: 0.375rem;
	}
	.doc-ref code {
		font-size: 0.8125rem;
	}

	.doc-footer {
		margin-top: 4rem;
		padding-top: 1.5rem;
		border-top: 1px solid oklch(92.2% 0 0deg);
		font-size: 0.8125rem;
		color: oklch(43.9% 0 0deg);
	}
	@media (prefers-color-scheme: dark) {
		.doc-footer {
			border-top-color: oklch(26.9% 0 0deg);
			color: oklch(70.8% 0 0deg);
		}
	}
</style>
