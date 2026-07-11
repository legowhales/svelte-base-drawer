<script lang="ts">
	import * as Drawer from '$lib';
	import './shared.css';
	import './basic.css';
</script>

<Drawer.Root>
	<Drawer.Trigger class="demo-button">Open basic drawer</Drawer.Trigger>

	<Drawer.VirtualKeyboardProvider>
		<Drawer.Portal>
			<Drawer.Backdrop class="basic-backdrop" />
			<Drawer.Viewport class="basic-viewport">
				<Drawer.Popup class="basic-popup">
					<div class="basic-handle"></div>
					<Drawer.Title class="basic-title">Weekly digest</Drawer.Title>
					<Drawer.Description class="basic-description">
						Everything that shipped this week, in one place.
					</Drawer.Description>

					<Drawer.Content class="basic-scroll">
						<div class="basic-body">
							<label class="basic-field">
								<span class="basic-label">Email address</span>
								<input class="basic-input" type="email" placeholder="you@example.com" />
								<span class="basic-hint">Get the digest in your inbox every Friday.</span>
							</label>

							<h3 class="basic-heading">Faster search</h3>
							<p>
								Search results now stream in as you type, and the index updates in the background
								instead of blocking the first keystroke. Median time to first result dropped from
								480 ms to 90 ms on large workspaces.
							</p>
							<p>
								Filters also stick between sessions, so a search scoped to one project stays scoped
								the next time you open the palette.
							</p>

							<h3 class="basic-heading">Offline mode</h3>
							<p>
								Documents you have opened recently are now available without a connection. Edits
								made offline merge automatically when you come back online, and conflicts surface as
								suggestions instead of silent overwrites.
							</p>
							<p>
								Sync status lives in the corner of every document, so you always know whether a
								change has left your device.
							</p>

							<h3 class="basic-heading">Smaller details</h3>
							<p>
								Keyboard shortcuts are now remappable, image pasting preserves alt text, archived
								items no longer appear in mention suggestions, and the export dialog remembers your
								last format.
							</p>
							<p>
								As always, the full changelog lives in the release notes. This digest only covers
								what changes your day-to-day.
							</p>

							<label class="basic-field">
								<span class="basic-label">What should we build next?</span>
								<input class="basic-input" type="text" placeholder="One sentence is plenty" />
							</label>

							<div class="basic-actions">
								<Drawer.Close class="demo-button">Close</Drawer.Close>
							</div>
						</div>
					</Drawer.Content>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.VirtualKeyboardProvider>
</Drawer.Root>
