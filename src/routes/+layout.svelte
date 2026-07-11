<script lang="ts">
	import './layout.css';
	import { assets } from '$app/paths';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href="{assets}/favicon.svg" /></svelte:head>
{@render children()}
