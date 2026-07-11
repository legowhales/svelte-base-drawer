<script lang="ts">
	import * as Drawer from '$lib/drawer';
	import '../shared.css';
	import './demo.css';
</script>

<div class="demo-page">
	<a class="demo-back" href="/">← Demos</a>
	<h1>Nested drawers</h1>
	<p>Nested drawers stack with a scale effect while staying independently focus managed.</p>

	<Drawer.Root>
		<Drawer.Trigger class="demo-button">Open drawer stack</Drawer.Trigger>
		<Drawer.Portal>
			<Drawer.Backdrop class="nested-backdrop" />
			<Drawer.Viewport class="nested-viewport">
				<Drawer.Popup class="nested-popup">
					<div class="nested-handle"></div>
					<Drawer.Content class="nested-content">
						<Drawer.Title class="nested-title">Account</Drawer.Title>
						<Drawer.Description class="nested-description">
							Nested drawers can be styled to stack, while each drawer remains independently
							focus managed.
						</Drawer.Description>

						<div class="nested-actions">
							<div class="nested-actions-left">
								<Drawer.Root>
									<Drawer.Trigger class="demo-button">Security settings</Drawer.Trigger>
									<Drawer.Portal>
										<Drawer.Viewport class="nested-viewport">
											<Drawer.Popup class="nested-popup">
												<div class="nested-handle"></div>
												<Drawer.Content class="nested-content">
													<Drawer.Title class="nested-title">Security</Drawer.Title>
													<Drawer.Description class="nested-description">
														Review sign-in activity and update your security preferences.
													</Drawer.Description>

													<ul class="nested-list">
														<li>Passkeys enabled</li>
														<li>2FA via authenticator app</li>
														<li>3 signed-in devices</li>
													</ul>

													<div class="nested-actions">
														<div class="nested-actions-left">
															<Drawer.Root>
																<Drawer.Trigger class="demo-button">
																	Advanced options
																</Drawer.Trigger>
																<Drawer.Portal>
																	<Drawer.Viewport class="nested-viewport">
																		<Drawer.Popup class="nested-popup">
																			<div class="nested-handle"></div>
																			<Drawer.Content class="nested-content">
																				<Drawer.Title class="nested-title">
																					Advanced
																				</Drawer.Title>
																				<Drawer.Description class="nested-description">
																					This drawer is taller to demonstrate
																					variable-height stacking.
																				</Drawer.Description>

																				<div class="nested-field">
																					<label class="nested-label" for="device-name">
																						Device name
																					</label>
																					<input
																						id="device-name"
																						class="nested-input"
																						value="Personal laptop"
																					/>
																				</div>

																				<div class="nested-field">
																					<label class="nested-label" for="notes">Notes</label>
																					<textarea id="notes" class="nested-textarea" rows="3"
																						>Rotate recovery codes and revoke older sessions.</textarea
																					>
																				</div>

																				<div class="nested-actions">
																					<Drawer.Close class="demo-button">Done</Drawer.Close>
																				</div>
																			</Drawer.Content>
																		</Drawer.Popup>
																	</Drawer.Viewport>
																</Drawer.Portal>
															</Drawer.Root>
														</div>

														<Drawer.Close class="demo-button">Close</Drawer.Close>
													</div>
												</Drawer.Content>
											</Drawer.Popup>
										</Drawer.Viewport>
									</Drawer.Portal>
								</Drawer.Root>
							</div>

							<Drawer.Close class="demo-button">Close</Drawer.Close>
						</div>
					</Drawer.Content>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
</div>
