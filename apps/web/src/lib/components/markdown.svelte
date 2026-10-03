<script lang="ts">
	// Markdown rendered with marked and sanitized with DOMPurify (links open in a
	// new tab), styled for reading without a typography plugin.
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { cn } from '$lib/utils.js';

	let { source, class: className }: { source: string; class?: string } = $props();

	let html = $state<string | null>(null);

	$effect(() => {
		const text = source;
		html = null;
		void (async () => {
			const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
			DOMPurify.addHook('afterSanitizeAttributes', (node) => {
				if (node.tagName === 'A') {
					node.setAttribute('target', '_blank');
					node.setAttribute('rel', 'noopener noreferrer');
				}
			});
			const out = DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string);
			DOMPurify.removeHook('afterSanitizeAttributes');
			if (source === text) html = out;
		})();
	});
</script>

<div class={cn('markdown', className)}>
	{#if html !== null}{@html html}{:else}<Spinner />{/if}
</div>

<style>
	/* Readable Markdown without a typography plugin. */
	.markdown :global(> :first-child) {
		margin-top: 0;
	}
	.markdown {
		line-height: 1.7;
		font-size: 0.925rem;
	}
	.markdown :global(:where(h1, h2, h3, h4)) {
		font-weight: 600;
		line-height: 1.3;
		margin: 1.4em 0 0.6em;
	}
	.markdown :global(h1) {
		font-size: 1.6em;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.3em;
	}
	.markdown :global(h2) {
		font-size: 1.3em;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.25em;
	}
	.markdown :global(h3) {
		font-size: 1.1em;
	}
	.markdown :global(:where(p, ul, ol, pre, blockquote, table)) {
		margin: 0.8em 0;
	}
	.markdown :global(:where(ul, ol)) {
		padding-inline-start: 1.5em;
	}
	.markdown :global(ul) {
		list-style: disc;
	}
	.markdown :global(ol) {
		list-style: decimal;
	}
	.markdown :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.markdown :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.875em;
		background: var(--muted);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.markdown :global(pre) {
		background: var(--muted);
		padding: 0.9em 1em;
		border-radius: 6px;
		overflow: auto;
	}
	.markdown :global(pre code) {
		background: none;
		padding: 0;
	}
	.markdown :global(blockquote) {
		border-inline-start: 3px solid var(--border);
		padding-inline-start: 1em;
		color: var(--muted-foreground);
	}
	.markdown :global(table) {
		border-collapse: collapse;
	}
	.markdown :global(:where(th, td)) {
		border: 1px solid var(--border);
		padding: 0.35em 0.7em;
	}
	.markdown :global(img) {
		max-width: 100%;
	}
	.markdown :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.5em 0;
	}
</style>
