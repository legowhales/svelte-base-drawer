import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Static build (all routes prerendered, see src/routes/+layout.ts) so the
		// demos can be shared as plain files (sher.sh, any static host).
		adapter: adapter()
	}
};

export default config;
