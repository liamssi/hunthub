<script lang="ts">
	// A pane's recent output, shown above its live terminal so the prompt (or an
	// agent's input box) stays visible while you read back. Read-only; it
	// refreshes while you're at its end and closes when you scroll past it.
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import { onMount } from 'svelte';
	import ArrowDownToLineIcon from '@lucide/svelte/icons/arrow-down-to-line';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import { Button } from '$lib/components/ui/button/index.js';
	import { consoleRequest } from '$lib/console';
	import { appearance, fontFamily, themeColors } from '$lib/terminal-appearance.svelte';

	let { machineId, session, paneId, onclose }: { machineId: string; session: string; paneId: string; onclose: () => void } = $props();

	/** How much history to load. */
	const LINES = 5000;
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

		async function load(first: boolean) {
			const out = await consoleRequest(machineId, session, 'Load history', 'pane.read', {
				pane_id: paneId,
				source: 'recent_unwrapped',
				format: 'ansi',
				lines: LINES
			});
			if (disposed || !term) return;
			loading = false;
			if (!out.ok) return first ? onclose() : undefined;
			const text = (out.result as { read?: { text?: string } } | null)?.read?.text ?? '';
			// Only redraw on change, and never while you're reading further up.
			if (text === lastText || (!first && !atEnd())) return;
			lastText = text;
			term.reset();
			term.write(text.replace(/\r?\n/g, '\r\n'), () => term?.scrollToBottom());
		}

		void (async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
			if (disposed) return;
			term = new Terminal({
				disableStdin: true,
				cursorBlink: false,
				cursorInactiveStyle: 'none',
				fontFamily: fontFamily(appearance.font),
				fontSize: appearance.size,
				lineHeight: 1.1,
				scrollback: LINES + 500,
				theme: { ...themeColors(appearance.theme), cursor: 'transparent' }
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.open(container);
			fit.fit();
			// Scrolling down past the end returns to the live terminal.
			term.attachCustomWheelEventHandler((e) => {
				if (e.deltaY > 0 && atEnd()) onclose();
				return true;
			});
			observer = new ResizeObserver(() => fit.fit());
			observer.observe(container);
			root.focus();
			await load(true);
			timer = setInterval(() => void load(false), REFRESH_MS);
		})();

		return () => {
			disposed = true;
			clearInterval(timer);
			observer?.disconnect();
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
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}}
>
	<div class="flex h-6 shrink-0 items-center gap-1.5 border-b border-border/60 ps-2.5 pe-1 text-xs text-muted-foreground">
		<HistoryIcon class="size-3.5" aria-hidden="true" />
		<span>{loading ? 'Loading history…' : 'History'}</span>
		<span class="hidden sm:inline">· scroll to the end or press Esc to return</span>
		<Button size="sm" variant="ghost" class="ms-auto h-5 px-1.5 text-xs" onclick={onclose}>
			<ArrowDownToLineIcon data-icon="inline-start" />Back to live
		</Button>
	</div>
	<div bind:this={container} class="min-h-0 flex-1 ps-1.5 pt-1"></div>
</div>
