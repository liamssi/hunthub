<script lang="ts">
	// A session drawn in the browser (Roamgate style): our own workspace and tab
	// navigation, and the selected tab laid out as Herdr splits it, with one live
	// terminal per pane. Click a pane to type into it.
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import type { PaneRect, SessionView, TabView } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from './terminal-view.svelte';

	let {
		machineId,
		session,
		mode,
		transport
	}: { machineId: string; session: SessionView; mode: TerminalMode; transport: TerminalTransport } = $props();

	const tabs = $derived(session.workspaces.flatMap((w) => w.tabs));
	let selectedTabId = $state<string | null>(null);
	// Keep the selection while the tab exists; otherwise fall back to the first tab.
	const tab = $derived<TabView | undefined>(tabs.find((t) => t.id === selectedTabId) ?? tabs[0]);

	let activePaneId = $state<string | null>(null);
	let states = $state<Record<string, TerminalState>>({});
	let attempts = $state<Record<string, number>>({});

	/** Pane rectangles for the tab: Herdr's layout, or a plain vertical stack if it isn't known. */
	const rects = $derived.by((): PaneRect[] => {
		if (!tab) return [];
		const layout = tab.layout;
		if (layout?.zoomed) {
			const zoomed = layout.focusedPaneId ?? tab.panes[0]?.id;
			return zoomed ? [{ paneId: zoomed, x: 0, y: 0, width: 1, height: 1 }] : [];
		}
		const known = new Set(tab.panes.map((p) => p.id));
		if (layout && layout.panes.length && layout.panes.every((r) => known.has(r.paneId))) return layout.panes;
		const n = tab.panes.length;
		return tab.panes.map((p, i) => ({ paneId: p.id, x: 0, y: i / n, width: 1, height: 1 / n }));
	});

	const paneById = $derived(new Map(tab?.panes.map((p) => [p.id, p]) ?? []));
	const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
	const reconnect = (paneId: string) => (attempts[paneId] = (attempts[paneId] ?? 0) + 1);
</script>

<div class="flex size-full min-h-0 gap-2">
	<nav class="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto rounded-md border p-2 text-sm" aria-label="Workspaces and tabs">
		{#each session.workspaces as ws (ws.id)}
			<div class="flex flex-col gap-1">
				<div class="flex min-w-0 items-center gap-1.5 px-1">
					<span class="truncate font-medium" title={ws.label}>{ws.label}</span>
					{#if ws.agents.length}<StatusBadge status={ws.status} />{/if}
				</div>
				{#each ws.tabs as t (t.id)}
					{@const agent = t.panes.find((p) => p.agent)?.agent}
					<button
						type="button"
						class={cn(
							'flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-muted',
							t.id === tab?.id && 'bg-muted font-medium'
						)}
						aria-current={t.id === tab?.id ? 'page' : undefined}
						onclick={() => (selectedTabId = t.id)}
					>
						<span class="truncate">Tab {t.label}</span>
						<span class="ms-auto text-xs text-muted-foreground">{t.panes.length}</span>
						{#if agent}<StatusBadge status={agent.status} />{/if}
					</button>
				{/each}
			</div>
		{:else}
			<p class="px-1 text-muted-foreground">No workspaces.</p>
		{/each}
	</nav>

	<div class="relative min-h-0 min-w-0 flex-1">
		{#if tab}
			{#each rects as r (r.paneId)}
				{@const pane = paneById.get(r.paneId)}
				{@const st = states[r.paneId]}
				<!-- The wrapper only moves keyboard focus; the terminal inside handles keys. -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="absolute flex flex-col p-0.5"
					style:left={pct(r.x)}
					style:top={pct(r.y)}
					style:width={pct(r.width)}
					style:height={pct(r.height)}
					onpointerdown={() => (activePaneId = r.paneId)}
				>
					<div
						class={cn(
							'flex size-full min-h-0 flex-col overflow-hidden rounded-md border',
							activePaneId === r.paneId && mode === 'control' && 'border-primary'
						)}
					>
						<div class="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs">
							<span class="font-mono text-muted-foreground">{r.paneId}</span>
							{#if pane?.agent}
								<StatusBadge status={pane.agent.status} />
								<span class="truncate font-medium">{pane.agent.name}</span>
							{/if}
							{#if st?.phase === 'closed'}
								<span class="min-w-0 flex-1 truncate text-end text-muted-foreground" title={st.reason}>{st.reason ?? 'Closed.'}</span>
								<Button size="icon-sm" variant="ghost" aria-label="Reconnect {r.paneId}" onclick={() => reconnect(r.paneId)}><RotateCwIcon /></Button>
							{:else if st?.phase === 'connecting'}
								<span class="ms-auto text-muted-foreground">Connecting…</span>
							{/if}
						</div>
						<div class="min-h-0 flex-1">
							{#key `${r.paneId}:${mode}:${transport}:${attempts[r.paneId] ?? 0}`}
								<TerminalView {machineId} session={session.name} target={r.paneId} {mode} {transport} onstatechange={(s) => (states[r.paneId] = s)} />
							{/key}
						</div>
					</div>
				</div>
			{/each}
		{:else}
			<p class="p-4 text-sm text-muted-foreground">Nothing to show yet.</p>
		{/if}
	</div>
</div>
