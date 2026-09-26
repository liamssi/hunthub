<script lang="ts">
	// A session as a web workspace, laid out like Herdr's own UI: a sidebar with
	// the session's spaces (workspaces) and agents, a tab bar for the selected
	// space, and its panes framed the way Herdr splits them, each a live
	// terminal. Recently visited tabs stay connected so switching is instant.
	// Dividers can be dragged (the ratio is applied in Herdr); maximizing a pane
	// only changes this view.
	import type { Snippet } from 'svelte';
	import { tick, untrack } from 'svelte';
	import BotIcon from '@lucide/svelte/icons/bot';
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import type { AgentStatus, AgentView, PaneRect, SessionView, SplitView, TabView, WorkspaceView } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { consoleCall } from '$lib/console';
	import { cn } from '$lib/utils.js';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from './terminal-view.svelte';

	let {
		machineId,
		session,
		mode,
		transport,
		header,
		controls
	}: {
		machineId: string;
		session: SessionView;
		mode: TerminalMode;
		transport: TerminalTransport;
		/** Top of the sidebar (session name, navigation). */
		header?: Snippet;
		/** Right end of the tab bar (view switch, menus). */
		controls?: Snippet;
	} = $props();

	/** How many tabs stay connected in the background. */
	const KEEP_ALIVE = 6;
	const call = (label: string, method: string, params: Record<string, unknown>) =>
		consoleCall(machineId, session.name, label, method, params);

	// --- Selection: a space, and a remembered tab per space ---------------------
	let selectedSpaceId = $state<string | null>(null);
	let tabBySpace = $state<Record<string, string>>({});
	const space = $derived<WorkspaceView | undefined>(
		session.workspaces.find((w) => w.id === selectedSpaceId) ?? session.workspaces[0]
	);
	const tab = $derived<TabView | undefined>(space?.tabs.find((t) => t.id === tabBySpace[space.id]) ?? space?.tabs[0]);
	const tabs = $derived(session.workspaces.flatMap((w) => w.tabs));

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
	// Rendered in a stable order so switching never remounts (reconnects) a terminal.
	const alive = $derived(tabs.filter((t) => visited.includes(t.id)));

	// --- Sidebar ----------------------------------------------------------------
	const SIDEBAR_KEY = 'hunthub.workspace.sidebar';
	let sidebarOpen = $state(true);
	$effect(() => {
		try {
			sidebarOpen = localStorage.getItem(SIDEBAR_KEY) !== 'closed';
		} catch {
			// Only a convenience.
		}
	});
	function setSidebar(open: boolean) {
		sidebarOpen = open;
		try {
			localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
		} catch {
			// Only a convenience.
		}
	}

	/** Agents that need attention first. */
	const order: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
	const agents = $derived(
		session.workspaces.flatMap((w) => w.agents).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
	);

	// --- Panes ------------------------------------------------------------------
	let activePane = $state<Record<string, string>>({});
	let maximized = $state<Record<string, string | null>>({});
	let states = $state<Record<string, TerminalState>>({});
	let attempts = $state<Record<string, number>>({});
	/** Per pane: watch instead of control, or take control over from its current controller. */
	let paneMode = $state<Record<string, 'watch' | 'takeover'>>({});

	/** Herdr allows one controller per pane (CLI transport); this is how it refuses a second. */
	const isLocked = (st: TerminalState | undefined) => st?.phase === 'closed' && /already has an attached client/.test(st.reason ?? '');
	const setPaneMode = (paneId: string, m: 'watch' | 'takeover' | null) => {
		if (m) paneMode[paneId] = m;
		else delete paneMode[paneId];
		reconnect(paneId);
	};

	function selectTab(spaceId: string, tabId: string) {
		selectedSpaceId = spaceId;
		tabBySpace[spaceId] = tabId;
	}

	async function focusPane(tabId: string, paneId: string) {
		activePane[tabId] = paneId;
		await tick();
		document.querySelector<HTMLTextAreaElement>(`[data-pane="${CSS.escape(paneId)}"] textarea`)?.focus();
	}

	function jumpToAgent(agent: AgentView) {
		const w = session.workspaces.find((x) => x.id === agent.workspaceId);
		const t = w?.tabs.find((x) => x.panes.some((p) => p.id === agent.paneId));
		if (!w || !t) return;
		selectTab(w.id, t.id);
		if (maximized[t.id] && maximized[t.id] !== agent.paneId) maximized[t.id] = null;
		void focusPane(t.id, agent.paneId);
	}

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

	const tabAgent = (t: TabView) => t.panes.find((p) => p.agent)?.agent ?? null;
	const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
	const folder = (cwd: string | null) => (cwd ? cwd.replace(/\/+$/, '').split('/').pop() || '/' : '');
	const reconnect = (paneId: string) => (attempts[paneId] = (attempts[paneId] ?? 0) + 1);
	const toggleMaximize = (tabId: string, paneId: string) =>
		(maximized[tabId] = maximized[tabId] === paneId ? null : paneId);

	// --- Dividers: a preview line follows the pointer; the ratio is sent on release.
	let drag = $state<{ tabId: string; key: string; ratio: number } | null>(null);
	const splitKey = (sp: SplitView) => sp.path.map((b) => (b ? 1 : 0)).join('') || 'root';
	const clampRatio = (r: number) => Math.min(0.95, Math.max(0.05, r));

	function ratioAt(e: PointerEvent, area: DOMRect, sp: SplitView) {
		return sp.direction === 'right'
			? clampRatio((e.clientX - area.left - sp.x * area.width) / (sp.width * area.width))
			: clampRatio((e.clientY - area.top - sp.y * area.height) / (sp.height * area.height));
	}

	function setRatio(tabId: string, sp: SplitView, ratio: number) {
		if (Math.abs(ratio - sp.ratio) < 0.005) return;
		void call('Resize panes', 'layout.set_split_ratio', { tab_id: tabId, path: sp.path, ratio });
	}

	function startDrag(e: PointerEvent, tabId: string, sp: SplitView) {
		const el = e.currentTarget as HTMLElement;
		const area = el.closest('[data-tab-area]')!.getBoundingClientRect();
		el.setPointerCapture(e.pointerId);
		drag = { tabId, key: splitKey(sp), ratio: sp.ratio };
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

	/** A divider sits in the gap on the split's boundary, across its region. */
	function dividerStyle(sp: SplitView, ratio: number) {
		return sp.direction === 'right'
			? `left:${pct(sp.x + sp.width * ratio)};top:${pct(sp.y)};height:${pct(sp.height)}`
			: `top:${pct(sp.y + sp.height * ratio)};left:${pct(sp.x)};width:${pct(sp.width)}`;
	}
</script>

<!-- The workspace is always dark, like the terminals it holds. -->
<div class="dark flex size-full min-h-0 bg-background text-foreground">
	{#if sidebarOpen}
		<aside class="flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground">
			{#if header}
				<div class="flex h-10 shrink-0 items-center gap-2 border-b px-2">{@render header()}</div>
			{/if}

			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<section class="flex flex-col gap-0.5 p-2" aria-labelledby="spaces-heading">
					<div class="flex h-7 items-center justify-between px-2">
						<h2 id="spaces-heading" class="text-xs font-medium text-muted-foreground">Spaces</h2>
						<Button
							size="icon-sm"
							variant="ghost"
							class="size-6"
							aria-label="New space"
							title="New space"
							onclick={() => call('New space', 'workspace.create', {})}
						>
							<PlusIcon />
						</Button>
					</div>
					{#each session.workspaces as w (w.id)}
						{@const current = w.id === space?.id}
						<button
							type="button"
							class={cn(
								'group flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
								current && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
							)}
							aria-current={current ? 'true' : undefined}
							onclick={() => (selectedSpaceId = w.id)}
						>
							{#if w.worktree}
								<GitBranchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{:else}
								<FolderIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{/if}
							<span class="truncate" title={w.worktree ? `${w.label} · ${w.worktree.checkoutPath}` : w.label}>{w.label}</span>
							<span class="ms-auto flex shrink-0 items-center gap-1.5">
								{#if w.agents.length}<StatusBadge status={w.status} compact />{/if}
							</span>
						</button>
					{:else}
						<p class="px-2 py-1 text-sm text-muted-foreground">No spaces yet.</p>
					{/each}
				</section>

				<section class="flex flex-col gap-0.5 border-t p-2" aria-labelledby="agents-heading">
					<div class="flex h-7 items-center px-2">
						<h2 id="agents-heading" class="text-xs font-medium text-muted-foreground">Agents</h2>
						{#if agents.length}<span class="ms-auto text-xs text-muted-foreground tabular-nums">{agents.length}</span>{/if}
					</div>
					{#each agents as a (a.paneId)}
						<button
							type="button"
							class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							onclick={() => jumpToAgent(a)}
							title="Go to {a.name}"
						>
							<StatusBadge status={a.status} compact />
							<span class="flex min-w-0 flex-col">
								<span class="truncate font-medium">{a.name}</span>
								<span class="truncate text-xs text-muted-foreground">{a.workspaceLabel}</span>
							</span>
						</button>
					{:else}
						<p class="px-2 py-1 text-sm text-muted-foreground">No agents running.</p>
					{/each}
				</section>
			</div>

			<div class="flex shrink-0 justify-end border-t p-1.5">
				<Button size="icon-sm" variant="ghost" aria-label="Hide sidebar" title="Hide sidebar" onclick={() => setSidebar(false)}>
					<PanelLeftCloseIcon />
				</Button>
			</div>
		</aside>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex h-10 shrink-0 items-stretch gap-1 border-b bg-sidebar px-1.5">
			{#if !sidebarOpen}
				<div class="flex items-center gap-1">
					<Button size="icon-sm" variant="ghost" aria-label="Show sidebar" title="Show sidebar" onclick={() => setSidebar(true)}>
						<PanelLeftOpenIcon />
					</Button>
					<span class="max-w-40 truncate px-1 text-sm font-medium" title={space?.label}>{space?.label}</span>
				</div>
			{/if}
			<div class="flex min-w-0 items-stretch overflow-x-auto" role="tablist" aria-label="Tabs in {space?.label ?? 'space'}">
				{#each space?.tabs ?? [] as t (t.id)}
					{@const current = t.id === tab?.id}
					{@const agent = tabAgent(t)}
					<button
						type="button"
						role="tab"
						aria-selected={current}
						class={cn(
							'relative flex shrink-0 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
							current && 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-sidebar-primary'
						)}
						onclick={() => space && selectTab(space.id, t.id)}
					>
						{#if agent}
							<BotIcon class="size-4" aria-hidden="true" />
						{:else if t.panes.length > 1}
							<Columns2Icon class="size-4" aria-hidden="true" />
						{:else}
							<SquareTerminalIcon class="size-4" aria-hidden="true" />
						{/if}
						<span class="max-w-40 truncate" title={t.panes.length > 1 ? `${t.panes.length} panes` : undefined}>{agent ? agent.name : `Tab ${t.label}`}</span>
						{#if agent}<StatusBadge status={agent.status} compact />{/if}
					</button>
				{/each}
				{#if space}
					<div class="flex items-center">
						<Button size="icon-sm" variant="ghost" aria-label="New tab" title="New tab" onclick={() => call('New tab', 'tab.create', { workspace_id: space.id })}>
							<PlusIcon />
						</Button>
					</div>
				{/if}
			</div>
			{#if controls}
				<div class="ms-auto flex shrink-0 items-center gap-1">{@render controls()}</div>
			{/if}
		</div>

		<div class="relative min-h-0 flex-1 bg-sidebar">
			{#each alive as t (t.id)}
				{@const current = t.id === tab?.id}
				{@const max = maximized[t.id] ?? null}
				{@const rects = rectsFor(t)}
				{@const paneById = new Map(t.panes.map((p) => [p.id, p]))}
				<div class={cn('absolute inset-1.5', !current && 'invisible')} inert={!current} data-tab-area>
					{#each rects as r (r.paneId)}
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
							data-pane={r.paneId}
							onpointerdown={() => (activePane[t.id] = r.paneId)}
							onfocusin={() => (activePane[t.id] = r.paneId)}
						>
							<div
								class={cn(
									'group flex size-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm transition-colors',
									active ? 'border-sidebar-primary/80' : 'hover:border-foreground/20'
								)}
							>
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="flex h-7 shrink-0 items-center gap-2 border-b border-border/60 ps-2.5 pe-1 text-xs"
									ondblclick={() => rects.length > 1 && toggleMaximize(t.id, r.paneId)}
								>
									{#if pane?.agent}
										<BotIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
										<span class="truncate font-medium">{pane.agent.name}</span>
										<StatusBadge status={pane.agent.status} compact />
									{:else}
										<SquareTerminalIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
										<span class="font-medium">Shell</span>
									{/if}
									<span class="min-w-0 truncate font-mono text-muted-foreground" title={pane?.cwd ?? undefined}>{folder(pane?.cwd ?? null)}</span>
									<span class="ms-auto flex shrink-0 items-center gap-0.5">
										{#if paneMode[r.paneId] === 'watch' && mode === 'control'}
											<span class="flex items-center gap-1 text-muted-foreground"><EyeIcon class="size-3.5" aria-hidden="true" />Watching</span>
											<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'takeover')}>Take control</Button>
										{/if}
										{#if isLocked(st)}
											<span class="text-muted-foreground">Someone else is controlling this pane</span>
											<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'watch')}><EyeIcon data-icon="inline-start" />Watch</Button>
											<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'takeover')}><KeyboardIcon data-icon="inline-start" />Take over</Button>
										{:else if st?.phase === 'closed'}
											<span class="max-w-64 truncate text-muted-foreground" title={st.reason}>{st.reason ?? 'Closed.'}</span>
											<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Reconnect" title="Reconnect" onclick={() => reconnect(r.paneId)}>
												<RotateCwIcon />
											</Button>
										{:else if st?.phase === 'connecting'}
											<span class="text-muted-foreground">Connecting…</span>
										{/if}
										{#if rects.length > 1}
											<Button
												size="icon-sm"
												variant="ghost"
												class={cn('size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100', (active || max === r.paneId) && 'opacity-100')}
												aria-label={max === r.paneId ? 'Restore layout' : 'Maximize pane'}
												title={max === r.paneId ? 'Restore layout (double-click the title)' : 'Maximize (double-click the title)'}
												onclick={() => toggleMaximize(t.id, r.paneId)}
											>
												{#if max === r.paneId}<Minimize2Icon />{:else}<Maximize2Icon />{/if}
											</Button>
										{/if}
									</span>
								</div>
								<div class="min-h-0 flex-1">
									{#key `${r.paneId}:${mode}:${transport}:${attempts[r.paneId] ?? 0}`}
										<TerminalView
											{machineId}
											session={session.name}
											target={r.paneId}
											mode={paneMode[r.paneId] === 'watch' ? 'observe' : mode}
											takeover={paneMode[r.paneId] === 'takeover'}
											{transport}
											onstatechange={(s) => {
												states[r.paneId] = s;
												// A takeover happens once; later reconnects ask normally again.
												if (s.phase === 'live' && paneMode[r.paneId] === 'takeover') delete paneMode[r.paneId];
											}}
										/>
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
									'group/divider absolute z-10 flex items-center justify-center outline-none',
									sp.direction === 'right' ? 'w-2 -translate-x-1/2 cursor-col-resize py-2' : 'h-2 -translate-y-1/2 cursor-row-resize px-2'
								)}
								style={dividerStyle(sp, dragging ? drag!.ratio : sp.ratio)}
								onpointerdown={(e) => startDrag(e, t.id, sp)}
								onkeydown={(e) => dividerKey(e, t.id, sp)}
							>
								<span
									class={cn(
										'rounded-full bg-sidebar-primary opacity-0 transition-opacity group-hover/divider:opacity-80 group-focus-visible/divider:opacity-100',
										sp.direction === 'right' ? 'h-full w-0.5' : 'h-0.5 w-full',
										dragging && 'opacity-100'
									)}
								></span>
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<p class="p-4 text-sm text-muted-foreground">This space has no tabs yet.</p>
			{/each}
		</div>
	</div>
</div>
