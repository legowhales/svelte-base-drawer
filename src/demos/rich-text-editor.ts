/**
 * Tiptap setup for the rich-text demo. Loaded with a dynamic import so the
 * editor only ships with this demo, not with the rest of the docs page.
 *
 * The image node mirrors a common real-world setup: an atom block node
 * rendered by a node view whose frame is `contenteditable="false"`, with a
 * delete button inside the editor DOM that removes the node on click (Tiptap's
 * NodeView `deleteNode()`).
 */
import { Editor, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const TRASH_ICON =
	'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

let imageCount = 0;

/** A generated placeholder picture (SVG data URI), so the demo needs no assets. */
export function createImageAttrs(width = 1200, height = 800) {
	imageCount += 1;
	const hue = (imageCount * 67) % 360;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 70% 38%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="white" font-family="system-ui, sans-serif" font-size="${Math.round(height / 7)}" font-weight="700" text-anchor="middle" dominant-baseline="central">Image ${imageCount}</text></svg>`;
	return {
		src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
		alt: `Image ${imageCount}`,
		width,
		height
	};
}

const Media = Node.create({
	name: 'media',
	group: 'block',
	atom: true,
	draggable: true,
	selectable: true,

	addAttributes() {
		return {
			src: { default: null },
			alt: { default: '' },
			width: { default: null },
			height: { default: null }
		};
	},

	parseHTML() {
		return [{ tag: 'figure[data-media] img' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['figure', { 'data-media': '' }, ['img', mergeAttributes(HTMLAttributes)]];
	},

	addNodeView() {
		return ({ node, getPos, editor }) => {
			const dom = document.createElement('div');
			dom.className = 'rt-media';
			dom.setAttribute('data-drag-handle', '');

			const frame = document.createElement('div');
			frame.className = 'rt-media-frame';
			frame.contentEditable = 'false';

			const image = document.createElement('img');
			image.className = 'rt-media-image';
			image.src = node.attrs.src;
			image.alt = node.attrs.alt;
			image.draggable = false;
			if (node.attrs.width && node.attrs.height) {
				image.width = node.attrs.width;
				image.height = node.attrs.height;
			}

			const deleteButton = document.createElement('button');
			deleteButton.type = 'button';
			deleteButton.className = 'rt-media-delete';
			deleteButton.title = 'Delete image';
			deleteButton.setAttribute('aria-label', 'Delete image');
			deleteButton.innerHTML = TRASH_ICON;
			deleteButton.addEventListener('click', () => {
				const from = getPos();
				if (typeof from !== 'number') return;
				editor.commands.deleteRange({ from, to: from + node.nodeSize });
			});

			frame.append(image, deleteButton);
			dom.append(frame);

			return {
				dom,
				// Like Tiptap's NodeView: ProseMirror ignores events from controls inside
				// the node view (the delete button), so its click isn't turned into a
				// node selection.
				stopEvent: (event) => {
					const target = event.target;
					return (
						target instanceof Element &&
						target.closest('button') !== null &&
						!event.type.startsWith('drag') &&
						event.type !== 'drop'
					);
				},
				ignoreMutation: () => true,
				selectNode: () => dom.classList.add('is-selected'),
				deselectNode: () => dom.classList.remove('is-selected')
			};
		};
	}
});

function paragraph(text: string): JSONContent {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function media(width?: number, height?: number): JSONContent {
	return { type: 'media', attrs: createImageAttrs(width, height) };
}

export function createInitialContent(): JSONContent {
	imageCount = 0;
	return {
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Field notes' }] },
			paragraph(
				'Tap anywhere in this text to place the caret: the keyboard opens and the line you tapped stays visible above it.'
			),
			media(1200, 800),
			paragraph(
				'The morning started foggy along the ridge. By nine the wind had picked up and the trail markers were barely visible, so we kept to the old fence line until the clearing.'
			),
			paragraph(
				'Delete an image with its trash button while the keyboard is open, then keep typing: the content below should move up and stay reachable above the keyboard.'
			),
			media(1200, 1500),
			{
				type: 'bulletList',
				content: [
					{ type: 'listItem', content: [paragraph('Check the water filter before leaving.')] },
					{ type: 'listItem', content: [paragraph('Two spare batteries for the headlamp.')] },
					{ type: 'listItem', content: [paragraph('Map, compass, and the printed itinerary.')] }
				]
			},
			paragraph(
				'Lunch by the lake. The water was colder than expected, and the light on the far shore kept changing as the clouds moved through.'
			),
			media(1200, 675),
			paragraph(
				'On the way back we took the lower path through the birch wood. It is longer, but sheltered, and the footing is better after rain.'
			),
			paragraph(
				'Last line of the note. Tap here with the keyboard closed: the caret should land where you tapped, not at the start of the document.'
			)
		]
	};
}

export function createRichTextEditor(options: {
	element: HTMLElement;
	content: JSONContent;
	onUpdate: (content: JSONContent) => void;
}): Editor {
	return new Editor({
		element: options.element,
		extensions: [StarterKit, Media],
		content: options.content,
		editorProps: {
			attributes: { class: 'rt-prosemirror', 'aria-label': 'Note' }
		},
		onUpdate: ({ editor }) => options.onUpdate(editor.getJSON())
	});
}

/** Inserts a new image after the block holding the selection (or at the end). */
export function insertImageAfterCurrentBlock(editor: Editor) {
	const { $from } = editor.state.selection;
	const position = $from.depth > 0 ? $from.after(1) : editor.state.doc.content.size;
	editor
		.chain()
		.focus(undefined, { scrollIntoView: false })
		.insertContentAt(position, [media(1200, 800), { type: 'paragraph' }])
		.setTextSelection(position + 2)
		.run();
}
