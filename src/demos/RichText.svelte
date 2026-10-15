<script lang="ts">
	import * as Drawer from '$lib';
	import type { Editor, JSONContent } from '@tiptap/core';
	import './shared.css';
	import './rich-text.css';

	type EditorModule = typeof import('./rich-text-editor.js');

	let editorModule = $state.raw<EditorModule | null>(null);
	let editor = $state.raw<Editor | null>(null);
	// Survives close/reopen; reset restores the initial note.
	let savedContent: JSONContent | null = null;

	let contentEl = $state<HTMLElement | null>(null);
	let debugEl = $state<HTMLElement | null>(null);
	let showDebug = $state(false);

	// Tiptap is loaded on first open so it doesn't weigh on the rest of the page.
	function mountEditor(element: HTMLElement) {
		let instance: Editor | null = null;
		let cancelled = false;

		import('./rich-text-editor.js').then((module) => {
			if (cancelled) return;
			editorModule = module;
			instance = module.createRichTextEditor({
				element,
				content: savedContent ?? module.createInitialContent(),
				onUpdate: (next) => (savedContent = next)
			});
			editor = instance;
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			editor = null;
		};
	}

	function addImage() {
		if (editor && editorModule) editorModule.insertImageAfterCurrentBlock(editor);
	}

	function resetNote() {
		if (!editor || !editorModule) return;
		savedContent = null;
		editor.commands.setContent(editorModule.createInitialContent());
		contentEl?.scrollTo({ top: 0 });
	}

	// Toolbar buttons must not steal focus from the editor (the keyboard would close).
	function keepEditorFocus(event: MouseEvent) {
		event.preventDefault();
	}

	function describeElement(element: Element | null): string {
		if (!element || element === document.body) return 'body';
		if (element.classList.contains('rt-prosemirror')) return 'editor';
		return element.tagName.toLowerCase();
	}

	function getCaretTop(): string {
		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0) return '–';
		const rects = selection.getRangeAt(0).getClientRects();
		const rect = rects[rects.length - 1];
		return rect ? `${Math.round(rect.top)}` : '–';
	}

	// Live metrics for on-device testing (keyboard inset, scroll slack, caret).
	$effect(() => {
		const scroller = contentEl;
		const output = debugEl;
		if (!showDebug || !scroller || !output) return;

		let frame = requestAnimationFrame(function update() {
			const viewport = scroller.closest('[data-drawer-viewport]');
			const inset = viewport
				? getComputedStyle(viewport).getPropertyValue('--drawer-keyboard-inset').trim()
				: '';
			const visualViewport = window.visualViewport;
			const maxScroll = scroller.scrollHeight - scroller.clientHeight;
			output.textContent = [
				`scroll ${Math.round(scroller.scrollTop)}/${maxScroll} · view ${scroller.clientHeight} · pad ${scroller.style.paddingBottom || '–'}`,
				`kb inset ${inset || '0px'} · vv ${Math.round(visualViewport?.height ?? 0)}+${Math.round(visualViewport?.offsetTop ?? 0)} / ${window.innerHeight}`,
				`focus ${describeElement(document.activeElement)} · caret top ${getCaretTop()} · win y ${Math.round(window.scrollY)}`
			].join('\n');
			frame = requestAnimationFrame(update);
		});

		return () => cancelAnimationFrame(frame);
	});
</script>

<Drawer.Root swipeDirection="right">
	<Drawer.Trigger class="demo-button">Open note editor</Drawer.Trigger>
	<Drawer.VirtualKeyboardProvider>
		<Drawer.Portal>
			<Drawer.Backdrop class="rt-backdrop" />
			<Drawer.Viewport class="rt-viewport">
				<Drawer.Popup class="rt-popup">
					<div class="rt-header">
						<div class="rt-header-row">
							<Drawer.Close class="demo-button">Close</Drawer.Close>
							<Drawer.Title class="rt-title">Note</Drawer.Title>
							<button
								type="button"
								class="demo-button rt-debug-toggle"
								aria-pressed={showDebug}
								onmousedown={keepEditorFocus}
								onclick={() => (showDebug = !showDebug)}
							>
								Debug
							</button>
						</div>
						{#if showDebug}
							<pre class="rt-debug" bind:this={debugEl}></pre>
						{/if}
					</div>

					<Drawer.Content class="rt-scroll" bind:ref={contentEl}>
						<div class="rt-editor" {@attach mountEditor}></div>
					</Drawer.Content>

					<!-- Floats above the software keyboard via --drawer-keyboard-inset. -->
					<div class="rt-toolbar">
						<button
							type="button"
							class="demo-button"
							onmousedown={keepEditorFocus}
							onclick={addImage}
							disabled={!editor}
						>
							+ Image
						</button>
						<button
							type="button"
							class="demo-button"
							onmousedown={keepEditorFocus}
							onclick={resetNote}
							disabled={!editor}
						>
							Reset
						</button>
					</div>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.VirtualKeyboardProvider>
</Drawer.Root>
