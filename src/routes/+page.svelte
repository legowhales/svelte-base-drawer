<script lang="ts">
	import * as Drawer from '$lib/drawer';
	import './demos/shared.css';

	let open = $state(false);

	const demos = [
		{ href: '/demos/snap-points', label: 'Snap points' },
		{ href: '/demos/nested', label: 'Nested drawers' },
		{ href: '/demos/virtual-keyboard', label: 'Virtual keyboard aware' },
		{ href: '/demos/indent', label: 'Indent effect' },
		{ href: '/demos/mobile-nav', label: 'Mobile navigation' },
		{ href: '/demos/swipe-to-open', label: 'Swipe to open' },
		{ href: '/demos/action-sheet', label: 'Action sheet' },
	];
</script>

<div class="demo-page">
	<h1>Drawer — Svelte port of base-ui v1.6.0</h1>
	<p>Built on bits-ui Dialog, with base-ui's swipe engine and mobile behaviors.</p>

	<Drawer.Root bind:open>
		<Drawer.Trigger class="demo-button">Open basic drawer</Drawer.Trigger>

		<Drawer.VirtualKeyboardProvider>
			<Drawer.Portal>
				<Drawer.Backdrop class="basic-backdrop" />
				<Drawer.Viewport class="basic-viewport">
					<Drawer.Popup class="basic-popup">
						<Drawer.Handle />

						<header class="basic-header">
							<Drawer.Title class="basic-title">Drawer Title</Drawer.Title>
							<Drawer.Description class="basic-description">
								Swipe down to dismiss, or tap the backdrop.
							</Drawer.Description>
						</header>

						<Drawer.Content class="basic-body">
							{#each Array(20) as _, i (i)}
								<div class="basic-item">
									<label>
										Item {i + 1}
										<input type="text" placeholder="Type here..." />
									</label>
								</div>
							{/each}
						</Drawer.Content>
					</Drawer.Popup>
				</Drawer.Viewport>
			</Drawer.Portal>
		</Drawer.VirtualKeyboardProvider>
	</Drawer.Root>

	<h2>Demos (ports of the base-ui docs examples)</h2>
	<ul class="demo-list">
		{#each demos as demo (demo.href)}
			<li><a href={demo.href}>{demo.label}</a></li>
		{/each}
	</ul>
</div>

<style>
	h2 {
		margin-top: 2.5rem;
		font-size: 1rem;
	}

	.demo-list {
		display: grid;
		gap: 0.5rem;
		padding-left: 1.25rem;
		font-size: 0.9375rem;
	}

	/* --- Basic drawer (class-based port of the lib's starter CSS) --- */

	:global(.basic-backdrop) {
		position: fixed;
		inset: 0;
		z-index: 50;
		min-height: 100dvh;
		background-color: rgb(0 0 0 / 0.35);
		user-select: none;
		-webkit-user-select: none;
		opacity: calc(1 - var(--drawer-swipe-progress, 0));
		transition: opacity 450ms cubic-bezier(0.32, 0.72, 0, 1);
	}
	@supports (-webkit-touch-callout: none) {
		:global(.basic-backdrop) {
			position: absolute;
		}
	}
	:global(.basic-backdrop[data-swiping]) {
		transition-duration: 0ms;
	}
	:global(.basic-backdrop[data-starting-style]) {
		opacity: 0;
	}
	:global(.basic-backdrop[data-ending-style]) {
		opacity: 0;
		pointer-events: none;
		transition-duration: calc(var(--drawer-swipe-strength, 1) * 400ms);
	}

	:global(.basic-viewport) {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		touch-action: none;
	}

	:global(.basic-popup) {
		--bleed: 3rem;
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		background: white;
		outline: none;
		touch-action: none;
		will-change: transform;
		max-height: calc(96% + var(--bleed));
		margin-bottom: calc(-1 * var(--bleed));
		padding-bottom: calc(var(--bleed) + env(safe-area-inset-bottom, 0px));
		border-radius: 12px 12px 0 0;
		transform: translateY(
			calc(var(--drawer-snap-point-offset, 0px) + var(--drawer-swipe-movement-y, 0px))
		);
		transition: transform 450ms cubic-bezier(0.32, 0.72, 0, 1);
	}
	@supports (-webkit-touch-callout: none) {
		:global(.basic-popup) {
			--bleed: 0px;
			border-radius: 10px;
		}
	}
	@media (prefers-color-scheme: dark) {
		:global(.basic-popup) {
			background: #1a1a1a;
			color: #e5e5e5;
		}
	}
	:global(.basic-popup[data-swiping]) {
		transition-duration: 0ms;
		user-select: none !important;
		-webkit-user-select: none !important;
	}
	:global(.basic-popup[data-ending-style]) {
		transition-duration: calc(var(--drawer-swipe-strength, 1) * 400ms);
	}
	:global(.basic-popup[data-starting-style]),
	:global(.basic-popup[data-ending-style]) {
		transform: translateY(calc(100% - var(--bleed) + 2px));
	}

	:global([data-drawer-handle]) {
		display: flex;
		justify-content: center;
		padding: 12px 0 8px;
		flex-shrink: 0;
		cursor: grab;
		touch-action: none;
	}
	:global([data-drawer-handle]:active) {
		cursor: grabbing;
	}
	:global([data-drawer-handle-hitarea]) {
		width: 36px;
		height: 5px;
		border-radius: 9999px;
		background: rgb(0 0 0 / 0.2);
	}
	@media (prefers-color-scheme: dark) {
		:global([data-drawer-handle-hitarea]) {
			background: rgb(255 255 255 / 0.3);
		}
	}

	.basic-header {
		flex-shrink: 0;
		padding: 0 24px 12px;
		max-width: 40rem;
		margin: 0 auto;
		width: 100%;
	}
	:global(.basic-title) {
		margin: 0;
		font-size: 1.125rem;
	}
	:global(.basic-description) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: oklch(43.9% 0 0deg);
	}
	@media (prefers-color-scheme: dark) {
		:global(.basic-description) {
			color: oklch(70.8% 0 0deg);
		}
	}

	:global(.basic-body) {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		touch-action: auto;
		padding: 0 24px 24px;
	}

	.basic-item {
		padding: 12px 0;
		max-width: 40rem;
		margin: 0 auto;
	}
	.basic-item label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}
	.basic-item input {
		padding: 8px 12px;
		border: 1px solid oklch(87% 0 0deg);
		border-radius: 6px;
		font-size: 16px; /* prevents iOS zoom */
		outline: none;
		background: transparent;
		color: inherit;
		transition: border-color 0.15s ease;
	}
	.basic-item input:focus-visible {
		border-color: oklch(62.3% 0.214 259.815deg);
	}
</style>
