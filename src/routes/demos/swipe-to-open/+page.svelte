<script lang="ts">
	import * as Drawer from '$lib/drawer';
	import '../shared.css';
	import './demo.css';

	let portalContainer = $state<HTMLElement | null>(null);
</script>

<div class="demo-page">
	<a class="demo-back" href="/">← Demos</a>
	<h1>Swipe to open</h1>
	<p>Swipe from the right edge of the frame (or drag it with a mouse) to open the drawer.</p>

	<div class="swipe-root" bind:this={portalContainer}>
		<Drawer.Root swipeDirection="right">
			<Drawer.SwipeArea class="swipe-area">
				<span class="swipe-label">Swipe here</span>
			</Drawer.SwipeArea>
			<div class="swipe-center">
				<p class="swipe-hint">Swipe from the right edge to open the drawer.</p>
			</div>
			{#if portalContainer}
				<Drawer.Portal to={portalContainer}>
					<Drawer.Backdrop class="swipe-backdrop" />
					<Drawer.Viewport class="swipe-viewport">
						<Drawer.Popup class="swipe-popup" trapFocus={false} preventScroll={false}>
							<Drawer.Content class="swipe-content">
								<Drawer.Title class="swipe-title">Library</Drawer.Title>
								<Drawer.Description class="swipe-description">
									Swipe from the edge whenever you want to jump back into your playlists.
								</Drawer.Description>
								<div class="swipe-actions">
									<Drawer.Close class="demo-button">Close</Drawer.Close>
								</div>
							</Drawer.Content>
						</Drawer.Popup>
					</Drawer.Viewport>
				</Drawer.Portal>
			{/if}
		</Drawer.Root>
	</div>
</div>
