<script lang="ts">
	import * as Drawer from '$lib/drawer';
	import '$lib/drawer/drawer.css';

	let open = $state(false);
</script>

<div class="demo">
	<h1>Drawer Demo</h1>

	<Drawer.Root bind:open>
		<Drawer.Trigger class="trigger-btn">Open Drawer</Drawer.Trigger>

		<Drawer.Portal>
			<Drawer.Overlay />
			<Drawer.Content>
				<Drawer.Handle />

				<div class="drawer-body">
					<Drawer.Title class="w-160 mx-auto font-medium">
						<h2>Drawer Title</h2>
					</Drawer.Title>

					<Drawer.Description class="w-160 mx-auto">
						<p>Swipe down to dismiss, or tap the overlay.</p>
					</Drawer.Description>

					<!-- Example scrollable content -->
					<div class="drawer-scroll-area">
						{#each Array(20) as _, i}
							<div class="item">
								<label>
									Item {i + 1}
									<input type="text" placeholder="Type here..." />
								</label>
							</div>
						{/each}
					</div>
				</div>
			</Drawer.Content>
		</Drawer.Portal>
	</Drawer.Root>
</div>

<style>
	.demo {
		padding: 2rem;
		font-family: system-ui, sans-serif;
	}

	:global(.trigger-btn) {
		padding: 12px 24px;
		font-size: 16px;
		border-radius: 8px;
		border: 1px solid var(--color-stone-300);
		background: var(--color-stone-50);
		cursor: pointer;
	}

	.drawer-body {
		padding: 16px 24px 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: calc(96dvh - 40px);
	}

	.drawer-scroll-area {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
	}

	.item {
		padding: 12px 0;
		max-width: 40rem;
		margin: 0 auto;
	}

	.item label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	.item input {
		padding: 8px 12px;
		border: 1px solid var(--color-stone-200);
		border-radius: 6px;
		font-size: 16px; /* prevents iOS zoom */
		outline: none;
		transition: border-color 0.15s ease;
	}
	.item input:focus-visible {
		border-color: var(--color-blue-300);
	}

	.drawer-footer {
		padding-top: 12px;
	}

	.close-btn {
		width: 100%;
		padding: 8px 12px;
		font-size: 16px;
		border-radius: 8px;
		border: none;
		background: var(--color-stone-800);
		color: white;
		cursor: pointer;
	}
</style>
