<script lang="ts">
	import Markdown from '$lib/components/markdown.svelte';
	// A read-only view of one file: code and text in CodeMirror (line numbers,
	// Ctrl+F search, highlighting loaded for the file's language), Markdown
	// rendered (sanitized), images shown, and clear notices for binary, very
	// large or truncated files.
	import { onMount } from 'svelte';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import type { EditorView } from '@codemirror/view';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { copyText } from '$lib/clipboard';
	import { type FileContent, formatSize, joinPath, readFile } from '$lib/files';
	import { appearance, fontFamily, themeColors } from '$lib/terminal-appearance.svelte';
	import { toast } from 'svelte-sonner';

	let {
		machineId,
		session,
		root,
		path,
		onback,
		onclose
	}: {
		machineId: string;
		session: string;
		root: string;
		path: string;
		/** Esc: back to the terminals (the file stays open as a tab). */
		onback: () => void;
		/** Close this file's tab. */
		onclose: () => void;
	} = $props();

	let file = $state<FileContent | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let editorHost = $state<HTMLDivElement | null>(null);
	let container: HTMLDivElement;

	const isMarkdown = $derived(/\.(md|mdx|markdown)$/i.test(path));
	let markdownView = $state<'preview' | 'source'>('preview');

	async function load() {
		loading = true;
		error = null;
		const at = `${root}\n${path}`;
		const out = await readFile(machineId, session, root, path);
		if (`${root}\n${path}` !== at) return; // Another file was opened meanwhile.
		loading = false;
		if (!out.ok) {
			error = out.message;
			file = null;
			return;
		}
		file = out.value;
	}

	$effect(() => {
		void root;
		void path;
		markdownView = 'preview';
		void load();
	});

	onMount(() => container.focus({ preventScroll: true }));

	// Code and text: a read-only CodeMirror editor in the terminal theme's colors.
	$effect(() => {
		const f = file;
		const host = editorHost;
		if (!f || f.kind !== 'text' || !host) return;
		const colors = themeColors(appearance.theme);
		const font = fontFamily(appearance.font);
		const size = appearance.size;
		let view: EditorView | null = null;
		let disposed = false;
		void (async () => {
			const [state, cmView, language, search, data, { tags }] = await Promise.all([
				import('@codemirror/state'),
				import('@codemirror/view'),
				import('@codemirror/language'),
				import('@codemirror/search'),
				import('@codemirror/language-data'),
				import('@lezer/highlight')
			]);
			if (disposed) return;
			const c = (k: keyof typeof colors, fallback = colors.foreground!) => (colors[k] as string | undefined) ?? fallback;
			const highlight = language.HighlightStyle.define([
				{ tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: c('blue') },
				{ tag: [tags.string, tags.special(tags.string), tags.inserted], color: c('green') },
				{ tag: [tags.number, tags.bool, tags.null, tags.atom], color: c('magenta') },
				{ tag: [tags.comment, tags.meta], color: c('brightBlack'), fontStyle: 'italic' },
				{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: c('cyan') },
				{ tag: [tags.typeName, tags.className, tags.namespace, tags.attributeName], color: c('yellow') },
				{ tag: [tags.regexp, tags.escape], color: c('yellow') },
				{ tag: [tags.tagName, tags.operator], color: c('blue') },
				{ tag: tags.heading, color: c('cyan'), fontWeight: 'bold' },
				{ tag: tags.link, color: c('cyan'), textDecoration: 'underline' },
				{ tag: tags.emphasis, fontStyle: 'italic' },
				{ tag: tags.strong, fontWeight: 'bold' },
				{ tag: [tags.invalid, tags.deleted], color: c('red') }
			]);
			const theme = cmView.EditorView.theme(
				{
					'&': { height: '100%', backgroundColor: c('background'), color: c('foreground') },
					'.cm-scroller': { fontFamily: font, fontSize: `${size}px`, lineHeight: '1.5' },
					'.cm-gutters': { backgroundColor: c('background'), color: c('brightBlack'), border: 'none' },
					'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: `${c('selectionBackground', '#ffffff')}33` },
					'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
						backgroundColor: `${c('selectionBackground', '#3b82f6')} !important`
					},
					'.cm-cursor': { borderLeftColor: c('cursor') },
					'.cm-panels': { backgroundColor: c('black'), color: c('foreground') },
					'.cm-searchMatch': { backgroundColor: `${c('yellow')}55` },
					'.cm-searchMatch-selected': { backgroundColor: `${c('cyan')}88` }
				},
				{ dark: true }
			);
			const lang = new state.Compartment();
			view = new cmView.EditorView({
				parent: host,
				state: state.EditorState.create({
					doc: f.text,
					extensions: [
						state.EditorState.readOnly.of(true),
						cmView.lineNumbers(),
						cmView.highlightActiveLine(),
						cmView.highlightActiveLineGutter(),
						cmView.drawSelection(),
						search.search({ top: true }),
						search.highlightSelectionMatches(),
						cmView.keymap.of(search.searchKeymap),
						language.syntaxHighlighting(highlight),
						theme,
						lang.of([])
					]
				})
			});
			// The language loads on demand from the file name.
			const description = language.LanguageDescription.matchFilename(data.languages, f.name);
			const support = await description?.load().catch(() => null);
			if (support && view && !disposed) view.dispatch({ effects: lang.reconfigure(support) });
		})();
		return () => {
			disposed = true;
			view?.destroy();
		};
	});

	async function copy(what: 'path' | 'contents') {
		const text = what === 'path' ? joinPath(root, path) : file?.kind === 'text' ? file.text : '';
		if (await copyText(text)) toast.success(what === 'path' ? 'Path copied' : 'Contents copied');
	}

	const modified = $derived(file ? new Date(file.mtime).toLocaleString() : '');
</script>

<!-- A focusable region; Esc goes back to the terminals (unless a search box inside is handling Esc). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={container}
	tabindex="-1"
	role="region"
	aria-label="File {path}"
	class="flex size-full min-h-0 flex-col overflow-hidden rounded-lg border shadow-lg outline-none"
	style:background-color={themeColors(appearance.theme).background}
	onkeydown={(e) => {
		if (e.key === 'Escape' && !e.defaultPrevented) {
			e.preventDefault();
			onback();
		}
	}}
>
	<div class="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar ps-3 pe-1.5 text-sm">
		<FileCodeIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="min-w-0 truncate font-mono text-xs" title={joinPath(root, path)}>
			{#each path.split('/') as part, i (i)}
				{#if i > 0}<span class="text-muted-foreground"> / </span>{/if}<span class={i === path.split('/').length - 1 ? 'font-medium' : 'text-muted-foreground'}>{part}</span>
			{/each}
		</span>
		{#if file}
			<span class="shrink-0 text-xs text-muted-foreground" title="Modified {modified}">{formatSize(file.size)}</span>
		{/if}
		<span class="ms-auto flex shrink-0 items-center gap-0.5">
			{#if isMarkdown && file?.kind === 'text'}
				<ToggleGroup.Root
					type="single"
					size="sm"
					variant="outline"
					class="me-1"
					bind:value={
						() => markdownView,
						(v) => {
							if (v === 'preview' || v === 'source') markdownView = v;
						}
					}
					aria-label="Markdown view"
				>
					<ToggleGroup.Item value="preview" class="h-7 px-2 text-xs">Preview</ToggleGroup.Item>
					<ToggleGroup.Item value="source" class="h-7 px-2 text-xs">Source</ToggleGroup.Item>
				</ToggleGroup.Root>
			{/if}
			<Button size="icon-sm" variant="ghost" aria-label="Copy path" title="Copy path" onclick={() => copy('path')}><CopyIcon /></Button>
			{#if file?.kind === 'text'}
				<Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onclick={() => copy('contents')}>Copy contents</Button>
			{/if}
			<Button size="icon-sm" variant="ghost" aria-label="Reload" title="Reload" onclick={load}><RefreshCwIcon /></Button>
			<Button size="icon-sm" variant="ghost" aria-label="Close file" title="Close tab" onclick={onclose}><XIcon /></Button>
		</span>
	</div>

	{#if file?.kind === 'text' && file.truncated}
		<p class="shrink-0 border-b bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
			Showing the first {formatSize(file.text.length)} of {formatSize(file.size)}; the file is too large to show in full.
		</p>
	{/if}

	<div class="relative min-h-0 flex-1">
		{#if loading && !file}
			<div class="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</div>
		{:else if error}
			<div class="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
				<p class="text-muted-foreground">{error}</p>
				<Button size="sm" variant="outline" onclick={load}><RefreshCwIcon data-icon="inline-start" />Try again</Button>
			</div>
		{:else if file?.kind === 'text'}
			{#if isMarkdown && markdownView === 'preview'}
				<Markdown source={file.text} class="size-full overflow-auto px-8 py-6" />
			{:else}
				<div bind:this={editorHost} class="size-full"></div>
			{/if}
		{:else if file?.kind === 'image'}
			{#if file.tooLarge || !file.data}
				<p class="flex size-full items-center justify-center p-6 text-sm text-muted-foreground">This image is too large to preview ({formatSize(file.size)}).</p>
			{:else}
				<div class="flex size-full items-center justify-center overflow-auto p-6">
					<img src="data:{file.mime};base64,{file.data}" alt={file.name} class="max-h-full max-w-full rounded border object-contain" />
				</div>
			{/if}
		{:else if file?.kind === 'binary'}
			<p class="flex size-full items-center justify-center p-6 text-sm text-muted-foreground">
				This is a binary file ({formatSize(file.size)}); it can't be shown as text.
			</p>
		{/if}
	</div>
</div>
