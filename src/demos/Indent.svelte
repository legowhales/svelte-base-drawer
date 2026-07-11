<script lang="ts">
	import * as Drawer from '$lib';
	import './shared.css';
	import './indent.css';

	let portalContainer = $state<HTMLElement | null>(null);
</script>

<Drawer.Provider>
	<div class="indent-root" bind:this={portalContainer}>
		<Drawer.IndentBackground class="indent-bg" />
		<Drawer.Indent class="indent-surface">
			<div class="indent-center">
				<Drawer.Root>
					<Drawer.Trigger class="demo-button">Open drawer</Drawer.Trigger>
					{#if portalContainer}
						<Drawer.Portal to={portalContainer}>
							<Drawer.Backdrop class="indent-backdrop" />
							<Drawer.Viewport class="indent-viewport">
								<Drawer.Popup class="indent-popup" trapFocus={false} preventScroll={false}>
									<div class="indent-handle"></div>
									<Drawer.Content class="indent-content">
										<Drawer.Title class="indent-title">Notifications</Drawer.Title>
										<Drawer.Description class="indent-description">
											You are all caught up. Good job!
										</Drawer.Description>
										<div class="indent-actions">
											<Drawer.Close class="demo-button">Close</Drawer.Close>
										</div>
									</Drawer.Content>
								</Drawer.Popup>
							</Drawer.Viewport>
						</Drawer.Portal>
					{/if}
				</Drawer.Root>
			</div>
		</Drawer.Indent>
	</div>
</Drawer.Provider>
