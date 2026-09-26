<script lang="ts">
	// A session drawn in the browser (Roamgate style): our own workspace and tab
	// rail, and each tab laid out as Herdr splits it, with one live terminal per
	// pane. Recently visited tabs stay connected so switching is instant.
	// Dividers can be dragged (the new ratio is applied in Herdr); maximizing a
	// pane only changes this view.
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import { untrack } from 'svelte';
	import type { PaneRect, SessionView, SplitView, TabView } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { consoleCall } from '$lib/console';
	import { cn } from '$lib/utils.js';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from './terminal-view.svelte';

	let {
		machineId,
		session,
		mode,
		transport
	}: { machineId: string; session: SessionView; mode: TerminalMode; transport: TerminalTransport } = $props();

	/** How many tabs stay connected in the background. */
	const KEEP_ALIVE = 6;

	const tabs = $derived(session.workspaces.flatMap((w) => w.tabs));
	let selectedTabId = $state<string | null>(null);
	// Keep the selection while the tab exists; otherwise fall back to the first tab.
	const tab = $derived<TabView | undefined>(tabs.find((t) => t.id === selectedTabId) ?? tabs[0]);

	let visited = $state<string[]>([]);
	$effect(() => {
		const id = tab?.id;
		if (!id) return;
		const known = new Set(tabs.map((t) => t.id));
		// Reads its own previous value untracked, or it would re-run itself forever.
		const previous = untrack(() => visited);
		const next = [id, ...previous.filter((v) => v !== id && known.has(v))].slice(0, KEEP_ALIVE);
		if (next.join() !== previous.join()) visited = next;
	});
	// Rendered in a stable order so switching tabs never remounts (reconnects) a terminal.
	const alive = $derived(tabs.filter((t) => visited.includes(t.id)));

	let activePane = $state<Record<string, string>>({});
	let maximized = $state<Record<string, string | null>>({});
	let states = $state<Record<string, TerminalState>>({});
	let attempts = $state<Record<string, number>>({});

	/** Pane rectangles for a tab: Herdr's layout, or a plain vertical stack if it isn't known. */
	function rectsFor(t: TabView): PaneRect[] {
		const layout = t.layout;
		if (layout?.zoomed) {
			const zoomed = layout.focusedPaneId ?? t.panes[0]?.id;
			return zoomed ? [{ paneId: zoomed, x: 0, y: 0, width: 1, height: 1 }] : [];
		}
		const known = new Set(t.panes.map((p) => p.id));
		if (layout && layout.panes.length && layout.panes.every((r) => known.has(r.paneId))) return layout.panes;
		const n = t.panes.length;
		return t.panes.map((p, i) => ({ paneId: p.id, x: 0, y: i / n, width: 1, height: 1 / n }));
	}

	const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
	const folder = (cwd: string | null) => (cwd ? cwd.replace(/\/+$/, '').split('/').pop() || '/' : '');
	const reconnect = (paneId: string) => (attempts[paneId] = (attempts[paneId] ?? 0) + 1);
	const toggleMaximize = (tabId: string, paneId: string) =>
		(maximized[tabId] = maximized[tabId] === paneId ? null : paneId);

	// Divider dragging: a preview line follows the pointer; the ratio is sent on release.
	let drag = $state<{ tabId: string; key: string; split: SplitView; ratio: number } | null>(null);
	const splitKey = (sp: SplitView) => sp.path.map((b) => (b ? 1 : 0)).join('') || 'root';
	const clampRatio = (r: number) => Math.min(0.95, Math.max(0.05, r));

	function ratioAt(e: PointerEvent, area: DOMRect, sp: SplitView) {
		return sp.direction === 'right'
			? clampRatio((e.clientX - area.left - sp.x * area.width) / (sp.width * area.width))
			: clampRatio((e.clientY - area.top - sp.y * area.height) / (sp.height * area.height));
	}

	function setRatio(tabId: string, sp: SplitView, ratio: number) {
		if (Math.abs(ratio - sp.ratio) < 0.005) return;
		void consoleCall(machineId, session.name, 'Resize panes', 'layout.set_split_ratio', { tab_id: tabId, path: sp.path, ratio });
	}

	function startDrag(e: PointerEvent, tabId: string, sp: SplitView) {
		const el = e.currentTarget as HTMLElement;
		const area = el.closest('[data-tab-area]')!.getBoundingClientRect();
		el.setPointerCapture(e.pointerId);
		drag = { tabId, key: splitKey(sp), split: sp, ratio: sp.ratio };
		const move = (ev: PointerEvent) => drag && (drag.ratio = ratioAt(ev, area, sp));
		const end = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', end);
			el.removeEventListener('pointercancel', end);
			if (drag) setRatio(tabId, sp, drag.ratio);
			drag = null;
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}

	function dividerKey(e: KeyboardEvent, tabId: string, sp: SplitView) {
		const back = sp.direction === 'right' ? 'ArrowLeft' : 'ArrowUp';
		const forward = sp.direction === 'right' ? 'ArrowRight' : 'ArrowDown';
		if (e.key !== back && e.key !== forward) return;
		e.preventDefault();
		setRatio(tabId, sp, clampRatio(sp.ratio + (e.key === forward ? 0.05 : -0.05)));
	}

	/** Where a divider sits: on the split's boundary, across its region. */
	function dividerStyle(sp: SplitView, ratio: number) {
		return sp.direction === 'right'
			? `left:${pct(sp.x + sp.width * ratio)};top:${pct(sp.y)};height:${pct(sp.height)}`
			: `top:${pct(sp.y + sp.height * ratio)};left:${pct(sp.x)};width:${pct(sp.width)}`;
	}
</script>

<div class="flex size-full min-h-0">
	<nav class="flex w-56 shrink-0 flex-col overflow-y-auto border-e bg-sidebar p-2 text-sm text-sidebar-foreground" aria-label="Workspaces and tabs">
		{#each session.workspaces as ws (ws.id)}
			<div class="flex flex-col gap-0.5 pb-3">
				<div class="flex min-w-0 items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground">
					<span class="truncate" title={ws.label}>{ws.label}</span>
					{#if ws.agents.length}<StatusBadge status={ws.status} compact />{/if}
				</div>
				{#each ws.tabs as t (t.id)}
					{@const agent = t.panes.find((p) => p.agent)?.agent}
					<button
						type="button"
						class={cn(
							'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-start hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
							t.id === tab?.id && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
						)}
						aria-current={t.id === tab?.id ? 'true' : undefined}
						onclick={() => (selectedTabId = t.id)}
					>
						<span class="truncate">{agent ? agent.name : `Tab ${t.label}`}</span>
						<span class="ms-auto flex shrink-0 items-center gap-1.5">
							{#if t.panes.length > 1}<span class="text-xs text-muted-foreground" title="{t.panes.length} panes">{t.panes.length}</span>{/if}
							{#if agent}<StatusBadge status={agent.status} compact />{/if}
						</span>
					</button>
				{/each}
			</div>
		{:else}
			<p class="px-2 text-muted-foreground">No workspaces.</p>
		{/each}
	</nav>

	<div class="relative min-h-0 min-w-0 flex-1 bg-muted/40">
		{#each alive as t (t.id)}
			{@const current = t.id === tab?.id}
			{@const max = maximized[t.id] ?? null}
			{@const paneById = new Map(t.panes.map((p) => [p.id, p]))}
			<div class={cn('absolute inset-1', !current && 'invisible')} inert={!current} data-tab-area>
				{#each rectsFor(t) as r (r.paneId)}
					{@const pane = paneById.get(r.paneId)}
					{@const st = states[r.paneId]}
					{@const shown = max ? (max === r.paneId ? { x: 0, y: 0, width: 1, height: 1 } : null) : r}
					{@const active = activePane[t.id] === r.paneId}
					<!-- The wrapper only records which pane has the keyboard; the terminal handles keys. -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class={cn('absolute p-[3px]', !shown && 'invisible')}
						style:left={pct((shown ?? r).x)}
						style:top={pct((shown ?? r).y)}
						style:width={pct((shown ?? r).width)}
						style:height={pct((shown ?? r).height)}
						inert={!shown}
						onpointerdown={() => (activePane[t.id] = r.paneId)}
						onfocusin={() => (activePane[t.id] = r.paneId)}
					>
						<div
							class={cn(
								'flex size-full min-h-0 flex-col overflow-hidden rounded-md border bg-background',
								active && 'ring-2 ring-ring/60'
							)}
						>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="flex h-7 shrink-0 items-center gap-2 border-b ps-2 pe-0.5 text-xs" ondblclick={() => toggleMaximize(t.id, r.paneId)}>
								{#if pane?.agent}
									<StatusBadge status={pane.agent.status} compact />
									<span class="truncate font-medium">{pane.agent.name}</span>
								{:else}
									<span class="font-medium">Shell</span>
								{/if}
								<span class="min-w-0 truncate font-mono text-muted-foreground" title={pane?.cwd ?? undefined}>{folder(pane?.cwd ?? null)}</span>
								<span class="ms-auto flex shrink-0 items-center gap-1">
									{#if st?.phase === 'closed'}
										<span class="max-w-64 truncate text-muted-foreground" title={st.reason}>{st.reason ?? 'Closed.'}</span>
										<Button size="icon-sm" variant="ghost" aria-label="Reconnect" onclick={() => reconnect(r.paneId)}><RotateCwIcon /></Button>
									{:else if st?.phase === 'connecting'}
										<span class="text-muted-foreground">Connecting…</span>
									{/if}
									{#if rectsFor(t).length > 1}
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label={max === r.paneId ? 'Restore layout' : 'Maximize pane'}
											title={max === r.paneId ? 'Restore layout (double-click the header)' : 'Maximize (double-click the header)'}
											onclick={() => toggleMaximize(t.id, r.paneId)}
										>
											{#if max === r.paneId}<Minimize2Icon />{:else}<Maximize2Icon />{/if}
										</Button>
									{/if}
								</span>
							</div>
							<div class="min-h-0 flex-1">
								{#key `${r.paneId}:${mode}:${transport}:${attempts[r.paneId] ?? 0}`}
									<TerminalView {machineId} session={session.name} target={r.paneId} {mode} {transport} onstatechange={(s) => (states[r.paneId] = s)} />
								{/key}
							</div>
						</div>
					</div>
				{/each}

				{#if !max && !t.layout?.zoomed}
					{#each t.layout?.splits ?? [] as sp (splitKey(sp))}
						{@const dragging = drag?.tabId === t.id && drag.key === splitKey(sp)}
						<!-- A focusable separator with a value is the ARIA window-splitter pattern (arrow keys resize). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<div
							role="separator"
							tabindex="0"
							aria-orientation={sp.direction === 'right' ? 'vertical' : 'horizontal'}
							aria-valuemin={5}
							aria-valuemax={95}
							aria-valuenow={Math.round((dragging ? drag!.ratio : sp.ratio) * 100)}
							aria-label="Resize panes"
							class={cn(
								'group absolute z-10 flex items-center justify-center outline-none',
								sp.direction === 'right' ? 'w-2 -translate-x-1/2 cursor-col-resize' : 'h-2 -translate-y-1/2 cursor-row-resize'
							)}
							style={dividerStyle(sp, dragging ? drag!.ratio : sp.ratio)}
							onpointerdown={(e) => startDrag(e, t.id, sp)}
							onkeydown={(e) => dividerKey(e, t.id, sp)}
						>
							<span
								class={cn(
									'rounded-full bg-primary/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
									sp.direction === 'right' ? 'h-full w-0.5' : 'h-0.5 w-full',
									dragging && 'opacity-100'
								)}
							></span>
						</div>
					{/each}
				{/if}
			</div>
		{:else}
			<p class="p-4 text-sm text-muted-foreground">No tabs in this session yet.</p>
		{/each}
	</div>
</div>
