<script lang="ts">
	import * as Drawer from '$lib';
	import './shared.css';
	import './virtual-keyboard.css';

	const fields = [
		['Name', 'Ada Lovelace'],
		['Phone', '+1 (555) 123-4567'],
		['Street address', '12 Computing Way'],
		['Apartment', 'Unit 4B'],
		['City', 'San Francisco'],
		['Postal code', '94107'],
		['Delivery window', 'After 6 PM'],
		['Backup contact', 'Grace Hopper']
	];
</script>

<Drawer.Root>
	<Drawer.Trigger class="demo-button">Open keyboard-aware drawer</Drawer.Trigger>
	<Drawer.VirtualKeyboardProvider>
		<Drawer.Portal>
			<Drawer.Backdrop class="vk-backdrop" />
			<Drawer.Viewport class="vk-viewport">
				<Drawer.Popup class="vk-popup">
					<div class="vk-header">
						<div class="vk-handle"></div>
						<div class="vk-header-actions">
							<Drawer.Close class="demo-button vk-header-button">Cancel</Drawer.Close>
							<Drawer.Title class="vk-title">Delivery details</Drawer.Title>
							<Drawer.Close class="demo-button vk-header-button">Save</Drawer.Close>
						</div>
					</div>

					<Drawer.Content class="vk-scroll">
						<div class="vk-form">
							{#each fields as [label, placeholder] (label)}
								<label class="vk-field">
									<span class="vk-field-label">{label}</span>
									<input class="vk-input" {placeholder} type="text" />
								</label>
							{/each}

							<label class="vk-field">
								<span class="vk-field-label">Instructions</span>
								<textarea
									class="vk-textarea"
									placeholder="Gate code, drop-off spot, or anything else the driver should know"
								></textarea>
							</label>
						</div>
					</Drawer.Content>

					<div class="vk-footer-slot">
						<div class="vk-sticky-footer">
							<label class="vk-composer">
								<span class="vk-field-label">Delivery note</span>
								<input
									class="vk-composer-input"
									placeholder="Add a note for the driver"
									type="text"
								/>
							</label>
						</div>
					</div>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.VirtualKeyboardProvider>
</Drawer.Root>
