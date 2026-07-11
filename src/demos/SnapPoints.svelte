<script lang="ts">
	import * as Drawer from '$lib';
	import './shared.css';
	import './snap-points.css';

	const TOP_MARGIN_REM = 1;
	const VISIBLE_SNAP_POINTS_REM = [30];

	const snapPoints: Drawer.DrawerSnapPoint[] = [
		...VISIBLE_SNAP_POINTS_REM.map((heightRem) => `${heightRem + TOP_MARGIN_REM}rem`),
		1
	];
</script>

<Drawer.Root {snapPoints}>
	<Drawer.Trigger class="demo-button">Open snap drawer</Drawer.Trigger>
	<Drawer.Portal>
		<Drawer.Backdrop class="snap-backdrop" />
		<Drawer.Viewport class="snap-viewport">
			<Drawer.Popup class="snap-popup">
				<div class="snap-drag-area">
					<div class="snap-handle"></div>
					<Drawer.Title class="snap-title">Snap points</Drawer.Title>
				</div>
				<Drawer.Content class="snap-scroll">
					<div class="snap-content">
						<Drawer.Description class="snap-description">
							Drag the sheet to snap between a compact peek and a near full-height view.
						</Drawer.Description>
						<div class="snap-cards" aria-hidden="true">
							{#each Array(20) as _, index (index)}
								<div class="snap-card"></div>
							{/each}
						</div>
						<div class="snap-actions">
							<Drawer.Close class="demo-button">Close</Drawer.Close>
						</div>
					</div>
				</Drawer.Content>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>
