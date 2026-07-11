<script lang="ts">
	import * as Drawer from '$lib';
	import './shared.css';
	import './action-sheet.css';

	const ACTIONS = ['Unfollow', 'Mute', 'Add to Favourites', 'Add to Close Friends', 'Restrict'];

	let open = $state(false);
</script>

<Drawer.Root bind:open>
	<Drawer.Trigger class="demo-button">Open action sheet</Drawer.Trigger>
	<Drawer.Portal>
		<Drawer.Backdrop class="sheet-backdrop" />
		<Drawer.Viewport class="sheet-viewport">
			<Drawer.Popup class="sheet-popup">
				<Drawer.Content class="sheet-surface">
					<Drawer.Title class="sheet-visually-hidden">Profile actions</Drawer.Title>
					<Drawer.Description class="sheet-visually-hidden">
						Choose an action for this user.
					</Drawer.Description>

					<ul class="sheet-actions" aria-label="Profile actions">
						{#each ACTIONS as action, index (action)}
							<li class="sheet-action">
								{#if index === 0}
									<Drawer.Close class="sheet-visually-hidden">Close action sheet</Drawer.Close>
								{/if}
								<button type="button" class="sheet-action-button" onclick={() => (open = false)}>
									{action}
								</button>
							</li>
						{/each}
					</ul>
				</Drawer.Content>
				<div class="sheet-danger-surface">
					<button type="button" class="sheet-danger-button" onclick={() => (open = false)}>
						Block User
					</button>
				</div>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>
