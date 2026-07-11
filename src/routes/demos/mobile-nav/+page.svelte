<script lang="ts">
	import * as Drawer from '$lib/drawer';
	import '../shared.css';
	import './demo.css';

	const ITEMS = [
		{ href: '#overview', label: 'Overview' },
		{ href: '#components', label: 'Components' },
		{ href: '#utilities', label: 'Utilities' },
		{ href: '#releases', label: 'Releases' },
	];

	const LONG_LIST = [
		'Accordion',
		'Alert Dialog',
		'Autocomplete',
		'Avatar',
		'Button',
		'Checkbox',
		'Checkbox Group',
		'Collapsible',
		'Combobox',
		'Context Menu',
		'Dialog',
		'Drawer',
		'Field',
		'Fieldset',
		'Form',
		'Input',
		'Menu',
		'Menubar',
		'Meter',
		'Navigation Menu',
		'Number Field',
		'OTP Field',
		'Popover',
		'Preview Card',
		'Progress',
		'Radio',
		'Scroll Area',
		'Select',
		'Separator',
		'Slider',
		'Switch',
		'Tabs',
		'Toast',
		'Toggle',
		'Toggle Group',
		'Toolbar',
		'Tooltip',
	];
</script>

<div class="demo-page">
	<a class="demo-back" href="/">← Demos</a>
	<h1>Mobile navigation</h1>
	<p>A tall menu scrolled within the viewport. Flick down from the top to dismiss.</p>

	<Drawer.Root>
		<Drawer.Trigger class="demo-button">Open mobile menu</Drawer.Trigger>
		<Drawer.Portal>
			<Drawer.Backdrop class="nav-backdrop" />
			<Drawer.Viewport class="nav-viewport">
				<div class="nav-scroller">
					<div class="nav-scroll-content">
						<Drawer.Popup class="nav-popup">
							<nav aria-label="Navigation" class="nav-panel">
								<div class="nav-header">
									<div aria-hidden="true" class="nav-header-spacer"></div>
									<div class="nav-handle"></div>
									<Drawer.Close aria-label="Close menu" class="nav-close">
										<svg
											width="16"
											height="16"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											stroke-linecap="square"
											stroke-linejoin="round"
											style="display: block"
										>
											<path d="m2.5 2.5 11 11m-11 0 11-11" />
										</svg>
									</Drawer.Close>
								</div>

								<Drawer.Content class="nav-content">
									<Drawer.Title class="nav-title">Menu</Drawer.Title>
									<Drawer.Description class="nav-description">
										Scroll the long list. Flick down from the top to dismiss.
									</Drawer.Description>

									<ul class="nav-list">
										{#each ITEMS as item (item.label)}
											<li class="nav-item">
												<a class="nav-link" href={item.href}>{item.label}</a>
											</li>
										{/each}
									</ul>

									<ul class="nav-long-list" aria-label="Component links">
										{#each LONG_LIST as label (label)}
											<li class="nav-item">
												<a class="nav-link" href="#{label.toLowerCase().replace(/ /g, '-')}">
													{label}
												</a>
											</li>
										{/each}
									</ul>
								</Drawer.Content>
							</nav>
						</Drawer.Popup>
					</div>
				</div>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
</div>
