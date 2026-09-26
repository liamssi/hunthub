<script lang="ts">
	// A pane's recent output, shown above its live terminal so the prompt (or an
	// agent's input box) stays visible while you read back. Read-only; it
	// refreshes while you're at its end and closes when you scroll past it.
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import { onMount, untrack } from 'svelte';
	import ArrowDownToLineIcon from '@lucide/svelte/icons/arrow-down-to-line';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils.js';
	import type { SearchAddon } from '@xterm/addon-search';
	import { Input } from '$lib/components/ui/input/index.js';
	import { copyText, openWebLink } from '$lib/clipboard';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cachedHistory, fetchHistory } from '$lib/pane-history';
	import { toast } from 'svelte-sonner';
	import { appearance, fontFamily, themeColors } from '$lib/terminal-appearance.svelte';

	let {
		machineId,
		session,
		paneId,
		search: searchOnOpen = false,
		cols,
		onclose
	}: {
		machineId: string;
		session: string;
		paneId: string;
		search?: boolean;
		/** The live terminal's width: lines were drawn at it, so the history matches it (or they'd rewrap). */
		cols?: number;
		onclose: () => void;
	} = $props();
	let fitToPane: (() => void) | null = null;
	$effect(() => {
		void cols;
		fitToPane?.();
	});

	/** Newer output exists that couldn't be added in place (a program redrew its screen). */
	let stale = $state(false);
	let redraw: (() => void) | null = null;


	// Search through the history (Ctrl+F in the panel, or opened with Alt+Shift+F).
	let searchOpen = $state(false);
	let query = $state('');
	let results = $state<{ index: number; count: number } | null>(null);
	let searchInput = $state<HTMLInputElement | null>(null);
	let searcher: SearchAddon | null = null;
	const searchOptions = {
		caseSensitive: false,
		decorations: { matchOverviewRuler: '#ebcb8b', activeMatchColorOverviewRuler: '#88c0d0', matchBackground: '#ebcb8b55', activeMatchBackground: '#88c0d0aa' }
	};
	function find(direction: 'next' | 'previous') {
		if (!searcher || !query) return;
		if (direction === 'next') searcher.findNext(query, searchOptions);
		else searcher.findPrevious(query, searchOptions);
	}
	function openSearch() {
		searchOpen = true;
		queueMicrotask(() => searchInput?.focus());
	}
	function closeSearch() {
		searchOpen = false;
		query = '';
		results = null;
		searcher?.clearDecorations();
		root.focus();
	}

	/** Scrollback kept in the panel (the runner keeps up to 10,000 lines per pane). */
	const LINES = 10_000;
	const REFRESH_MS = 3000;

	let container: HTMLDivElement;
	let root: HTMLDivElement;
	let loading = $state(true);

	onMount(() => {
		let term: Terminal | null = null;
		let disposed = false;
		let timer: ReturnType<typeof setInterval> | undefined;
		let observer: ResizeObserver | undefined;
		let lastText = '';

		const atEnd = () => !term || term.buffer.active.viewportY >= term.buffer.active.baseY;

		/**
		 * Shows history. The first time it's drawn in full; after that new output is
		 * only added in place (no redraw, so no flicker). When a program redrew its
		 * screen instead, a Refresh button offers the full redraw.
		 */
		let latest = '';
		function draw(text: string) {
			if (!term) return;
			lastText = text;
			stale = false;
			term.reset();
			term.write(text, () => term?.scrollToBottom());
		}
		redraw = () => draw(latest);
		function show(historyText: string, first: boolean) {
			if (!term) return;
			const text = historyText;
			latest = text;
			if (first) return draw(text);
			if (text === lastText) return;
			if (text.startsWith(lastText)) {
				const follow = atEnd();
				term.write(text.slice(lastText.length), () => follow && term?.scrollToBottom());
				lastText = text;
			} else stale = true;
		}

		async function load(first: boolean) {
			const history = await fetchHistory(machineId, session, paneId);
			if (disposed || !term) return;
			loading = false;
			if (!history) {
				if (first && !lastText) {
					toast.error("Couldn't load this pane's history");
					onclose();
				}
				return;
			}
			show(history.text, first);
		}

		void (async () => {
			const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit'),
				import('@xterm/addon-search'),
				import('@xterm/addon-web-links')
			]);
			if (disposed) return;
			term = new Terminal({
				disableStdin: true,
				cursorBlink: false,
				cursorInactiveStyle: 'none',
				fontFamily: fontFamily(appearance.font),
				fontSize: appearance.size,
				lineHeight: 1.1,
				scrollback: LINES + 500,
				theme: { ...themeColors(appearance.theme), cursor: 'transparent' },
				allowProposedApi: true,
				linkHandler: { activate: (_event, uri) => openWebLink(uri), allowNonHttpProtocols: false }
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.loadAddon(new WebLinksAddon((_event, uri) => openWebLink(uri)));
			searcher = new SearchAddon();
			term.loadAddon(searcher);
			searcher.onDidChangeResults((r) => (results = r.resultCount ? { index: r.resultIndex, count: r.resultCount } : { index: -1, count: 0 }));
			const t = term;
			t.attachCustomKeyEventHandler((e) => {
				if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true;
				const key = e.key.toLowerCase();
				if (key === 'c' && t.hasSelection()) {
					void copyText(t.getSelection());
					return false;
				}
				if (key === 'f') {
					e.preventDefault();
					openSearch();
					return false;
				}
				return true;
			});
			term.open(container);
			// Fitting leaves room for a scrollbar the live terminal doesn't have (it keeps no
			// scrollback), so the width follows the live terminal; the scrollbar overlays the edge.
			const t2 = term;
			fitToPane = () => {
				const d = fit.proposeDimensions();
				const width = untrack(() => cols) ?? d?.cols;
				if (d && width && (t2.cols !== width || t2.rows !== d.rows)) t2.resize(width, d.rows);
			};
			fitToPane();
			// Scrolling down past the end returns to the live terminal.
			term.attachCustomWheelEventHandler((e) => {
				if (e.deltaY > 0 && atEnd()) onclose();
				return true;
			});
			observer = new ResizeObserver(() => fitToPane?.());
			observer.observe(container);
			if (searchOnOpen) openSearch();
			else root.focus();
			// The cached copy shows at once (it was fetched in the background); then it's refreshed.
			const cached = cachedHistory(machineId, session, paneId);
			if (cached) {
				loading = false;
				show(cached.text, true);
			}
			await load(!cached);
			timer = setInterval(() => void load(false), REFRESH_MS);
		})();

		return () => {
			disposed = true;
			clearInterval(timer);
			observer?.disconnect();
			fitToPane = null;
			term?.dispose();
		};
	});
</script>

<!-- A focusable region; Esc returns to the live terminal. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	tabindex="0"
	role="region"
	aria-label="History of pane {paneId}"
	class="flex size-full flex-col border-b shadow-lg outline-none"
	style:background-color={themeColors(appearance.theme).background}
	onkeydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			openSearch();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (searchOpen) closeSearch();
			else onclose();
		}
	}}
>
	<div class="flex h-6 shrink-0 items-center gap-1.5 border-b border-border/60 ps-2.5 pe-1 text-xs text-muted-foreground">
		<HistoryIcon class="size-3.5" aria-hidden="true" />
		<span>{loading ? 'Loading history…' : 'History'}</span>
		<span class="hidden sm:inline">· scroll to the end or press Esc to return</span>
		{#if stale}
			<Button size="sm" variant="ghost" class="ms-auto h-5 px-1.5 text-xs text-foreground" onclick={() => redraw?.()} title="Show the newest output">
				<RefreshCwIcon data-icon="inline-start" />Refresh
			</Button>
		{/if}
		<Button size="sm" variant="ghost" class={cn('h-5 px-1.5 text-xs', !stale && 'ms-auto')} onclick={openSearch} aria-label="Search history" title="Search (Ctrl+F)">
			<SearchIcon data-icon="inline-start" />Search
		</Button>
		<Button size="sm" variant="ghost" class="h-5 px-1.5 text-xs" onclick={onclose}>
			<ArrowDownToLineIcon data-icon="inline-start" />Back to live
		</Button>
	</div>
	{#if searchOpen}
		<div class="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
			<Input
				bind:ref={searchInput}
				bind:value={query}
				class="h-6 flex-1 text-xs"
				placeholder="Find in history"
				aria-label="Find in history"
				oninput={() => find('next')}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						find(e.shiftKey ? 'previous' : 'next');
					}
				}}
			/>
			<span class="w-16 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
				{#if query && results}{results.count ? `${results.index + 1} of ${results.count}` : 'No matches'}{/if}
			</span>
			<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Previous match" title="Previous (Shift+Enter)" onclick={() => find('previous')}><ChevronUpIcon /></Button>
			<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Next match" title="Next (Enter)" onclick={() => find('next')}><ChevronDownIcon /></Button>
		</div>
	{/if}
	<div bind:this={container} class="min-h-0 flex-1 overflow-hidden ps-1.5 pt-1 pb-1.5"></div>
</div>
