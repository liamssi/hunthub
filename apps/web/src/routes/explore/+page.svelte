<script lang="ts">
	// Everything across machines on one page: sessions, agents, terminals and
	// machines, with grouping, filters and search. Rows open in the workspace
	// (agents and terminals jump to their pane) and can be pinned to the sidebar.
	import BotIcon from '@lucide/svelte/icons/bot';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ServerIcon from '@lucide/svelte/icons/server';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { validateSessionName } from '@hunthub/shared/console';
	import type { AgentStatus, Machine, PaneView, SessionView, TabView, WorkspaceView } from '@hunthub/shared/machines';
	import StatusBadge, { statusLabels } from '$lib/components/agents/status-badge.svelte';
	import ConfirmDialog from '$lib/components/console/confirm-dialog.svelte';
	import FormDialog from '$lib/components/console/form-dialog.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { startSession, stopSession } from '$lib/console';
	import { fleet, needsYouCount, sessionAgents, workspaceHref } from '$lib/fleet.svelte';
	import { findPin, togglePin } from '$lib/pins.svelte';
	import { cn } from '$lib/utils.js';
	import { toast } from 'svelte-sonner';

	// --- View settings, kept in the URL so a view can be bookmarked or shared ----
	type Show = 'sessions' | 'agents' | 'terminals' | 'machines';
	type Group = 'machine' | 'session' | 'status' | 'none';
	const SHOWS: Show[] = ['sessions', 'agents', 'terminals', 'machines'];
	const GROUPS: Group[] = ['machine', 'session', 'status', 'none'];
	const param = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
		const v = page.url.searchParams.get(name) as T | null;
		return v && allowed.includes(v) ? v : fallback;
	};
	const show = $derived(param('show', SHOWS, 'sessions'));
	const group = $derived(param('group', GROUPS, 'machine'));
	const machineFilter = $derived(page.url.searchParams.get('machine') ?? 'all');
	const statusFilter = $derived(param('status', ['all', 'blocked', 'working', 'done', 'idle'] as const, 'all'));
	const onlineOnly = $derived(page.url.searchParams.get('online') === '1');
	/** Cards by default, like the machines page; ?layout=list for rows. */
	const layout = $derived(page.url.searchParams.get('layout') === 'list' ? 'list' : 'cards');
	let query = $state(page.url.searchParams.get('q') ?? '');

	function setParam(name: string, value: string | null) {
		const url = new URL(page.url);
		if (value === null || value === '') url.searchParams.delete(name);
		else url.searchParams.set(name, value);
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const q = query;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			if ((page.url.searchParams.get('q') ?? '') !== q) setParam('q', q || null);
		}, 250);
	});

	// --- Rows ------------------------------------------------------------------
	type Common = { key: string; machine: Machine; search: string };
	type SessionRow = Common & { kind: 'session'; session: SessionView; status: StatusGroup };
	type PaneRow = Common & { kind: 'pane'; session: SessionView; space: WorkspaceView; tab: TabView; pane: PaneView; status: StatusGroup };
	type MachineRow = Common & { kind: 'machine'; sessions: number; agents: number };
	type Row = SessionRow | PaneRow | MachineRow;
	type StatusGroup = AgentStatus | 'shell' | 'stopped';

	const online = (m: Machine) => m.connection === 'online' && m.status === 'active';
	const folder = (cwd: string | null) => (cwd ? cwd.replace(/\/+$/, '').split('/').pop() || '/' : '');

	/** A session's overall status: whoever needs you first. */
	function sessionStatus(s: SessionView): StatusGroup {
		if (s.state === 'stopped') return 'stopped';
		const statuses = new Set(sessionAgents(s).map((a) => a.status));
		for (const st of ['blocked', 'working', 'done'] as const) if (statuses.has(st)) return st;
		return 'idle';
	}

	const rows = $derived.by((): Row[] => {
		const out: Row[] = [];
		const machines = [...fleet.machines].sort((a, b) => Number(online(b)) - Number(online(a)) || a.name.localeCompare(b.name));
		for (const m of machines) {
			if (machineFilter !== 'all' && m.id !== machineFilter) continue;
			if (onlineOnly && !online(m)) continue;
			const sessions = fleet.herdr[m.id]?.sessions ?? [];
			if (show === 'machines') {
				out.push({
					kind: 'machine',
					key: m.id,
					machine: m,
					sessions: sessions.length,
					agents: sessions.reduce((n, s) => n + sessionAgents(s).length, 0),
					search: `${m.name} ${m.host?.hostname ?? ''} ${m.tags.join(' ')}`
				});
				continue;
			}
			for (const s of sessions) {
				if (show === 'sessions') {
					out.push({
						kind: 'session',
						key: `${m.id}:${s.name}`,
						machine: m,
						session: s,
						status: sessionStatus(s),
						search: `${s.name} ${m.name} ${s.workspaces.map((w) => `${w.label} ${w.agents.map((a) => a.name).join(' ')}`).join(' ')}`
					});
					continue;
				}
				for (const space of s.workspaces) {
					for (const tab of space.tabs) {
						for (const pane of tab.panes) {
							if (show === 'agents' && !pane.agent) continue;
							out.push({
								kind: 'pane',
								key: `${m.id}:${s.name}:${pane.id}`,
								machine: m,
								session: s,
								space,
								tab,
								pane,
								status: pane.agent?.status ?? 'shell',
								search: `${pane.agent?.name ?? 'shell'} ${pane.cwd ?? ''} ${space.label} ${s.name} ${m.name}`
							});
						}
					}
				}
			}
		}
		const needle = query.trim().toLowerCase();
		return out.filter(
			(r) =>
				(!needle || r.search.toLowerCase().includes(needle)) &&
				(statusFilter === 'all' || (r.kind !== 'machine' && r.status === statusFilter))
		);
	});

	// --- Groups ------------------------------------------------------------------
	const STATUS_ORDER: StatusGroup[] = ['blocked', 'working', 'done', 'idle', 'unknown', 'shell', 'stopped'];
	const statusTitle = (s: StatusGroup) => (s === 'shell' ? 'Shells' : s === 'stopped' ? 'Stopped' : statusLabels[s]);
	type Grouped = { key: string; label: string; machine?: Machine; status?: StatusGroup; rows: Row[] };

	const groups = $derived.by((): Grouped[] => {
		const g = show === 'machines' ? 'none' : group;
		if (g === 'none') return [{ key: 'all', label: '', rows }];
		const map = new Map<string, Grouped>();
		for (const r of rows) {
			let key: string;
			let entry: Omit<Grouped, 'rows'>;
			if (g === 'machine') {
				key = r.machine.id;
				entry = { key, label: r.machine.name, machine: r.machine };
			} else if (g === 'session') {
				const name = r.kind === 'machine' ? '' : r.session.name;
				key = `${r.machine.id}:${name}`;
				entry = { key, label: `${name} · ${r.machine.name}`, machine: r.machine };
			} else {
				const st = r.kind === 'machine' ? 'idle' : r.status;
				key = st;
				entry = { key, label: statusTitle(st), status: st };
			}
			if (!map.has(key)) map.set(key, { ...entry, rows: [] });
			map.get(key)!.rows.push(r);
		}
		const list = [...map.values()];
		if (g === 'status') list.sort((a, b) => STATUS_ORDER.indexOf(a.status!) - STATUS_ORDER.indexOf(b.status!));
		return list;
	});

	let collapsed = $state<Record<string, boolean>>({});

	// --- Summary -------------------------------------------------------------------
	const totals = $derived.by(() => {
		const sessions = Object.values(fleet.herdr).flatMap((h) => h.sessions);
		const agents = sessions.flatMap(sessionAgents);
		return {
			machinesOnline: fleet.machines.filter(online).length,
			machines: fleet.machines.length,
			sessions: sessions.length,
			agents: agents.length,
			needsYou: agents.filter((a) => a.status === 'blocked').length
		};
	});

	// --- Actions ---------------------------------------------------------------------
	let newSession = $state<{ open: boolean; machine: Machine | null }>({ open: false, machine: null });
	let confirmStop = $state<{ open: boolean; machine: Machine | null; session: string }>({ open: false, machine: null, session: '' });
	// A stopped session starts and then opens in the workspace.
	let startingKeys = $state<Record<string, boolean>>({});
	async function startAndOpen(machine: Machine, name: string, key: string) {
		startingKeys[key] = true;
		const ok = await startSession(machine.id, name);
		delete startingKeys[key];
		if (ok) void goto(workspaceHref(machine.id, name));
	}

	async function createSession(values: Record<string, string>) {
		const machine = newSession.machine;
		if (!machine) return false;
		const invalid = validateSessionName(values.name ?? '');
		if (invalid) {
			toast.error(invalid);
			return false;
		}
		const ok = await startSession(machine.id, values.name!);
		if (ok) void goto(workspaceHref(machine.id, values.name!));
		return ok;
	}

	const showLabels: Record<Show, string> = { sessions: 'Sessions', agents: 'Agents', terminals: 'Terminals', machines: 'Machines' };
	const groupLabels: Record<Group, string> = { machine: 'Machine', session: 'Session', status: 'Status', none: 'None' };
	const statusOptions = [
		['all', 'Any status'],
		['blocked', 'Needs you'],
		['working', 'Working'],
		['done', 'Done'],
		['idle', 'Idle']
	] as const;
</script>

<svelte:head><title>{totals.needsYou ? `(${totals.needsYou}) ` : ''}Explore · HuntHub</title></svelte:head>

{#snippet pinButton(machineId: string, session: string, paneId: string | null, label: string)}
	{@const pinned = !!findPin(machineId, session, paneId)}
	<Button
		size="icon-sm"
		variant="ghost"
		class={cn('opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100', pinned && 'opacity-100')}
		aria-pressed={pinned}
		aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
		title={pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
		onclick={() => togglePin(machineId, session, paneId, label)}
	>
		{#if pinned}<PinOffIcon />{:else}<PinIcon />{/if}
	</Button>
{/snippet}

{#snippet sessionMenu(r: SessionRow, running: boolean)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="icon-sm" variant="ghost" aria-label="{r.session.name} actions"><EllipsisIcon /></Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Group>
				<DropdownMenu.Item>
					{#snippet child({ props })}<a {...props} href="/machines/{r.machine.id}/sessions/{encodeURIComponent(r.session.name)}">Manage session</a>{/snippet}
				</DropdownMenu.Item>
				{#if running && online(r.machine)}
					<DropdownMenu.Item variant="destructive" onSelect={() => (confirmStop = { open: true, machine: r.machine, session: r.session.name })}>
						Stop session
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

{#snippet sessionOpen(r: SessionRow, running: boolean)}
	{#if running}
		<Button size="sm" href={workspaceHref(r.machine.id, r.session.name)}>Open</Button>
	{:else if online(r.machine)}
		<Button size="sm" variant="outline" disabled={!!startingKeys[r.key]} onclick={() => startAndOpen(r.machine, r.session.name, r.key)}>
			{#if startingKeys[r.key]}<Spinner data-icon="inline-start" />Starting…{:else}<PlayIcon data-icon="inline-start" />Start & open{/if}
		</Button>
	{:else}
		<span class="text-xs text-muted-foreground">Machine offline</span>
	{/if}
{/snippet}

{#snippet statusChips(agents: ReturnType<typeof sessionAgents>)}
	{#each (['blocked', 'working', 'done'] as const).filter((st) => agents.some((a) => a.status === st)) as st (st)}
		<Badge variant={st === 'blocked' ? 'destructive' : 'outline'} class="gap-1" title={statusLabels[st]}>
			<StatusBadge status={st} compact />{agents.filter((a) => a.status === st).length}
		</Badge>
	{/each}
{/snippet}

{#snippet item(r: Row, card: boolean)}
	{#if r.kind === 'session'}
		{@const running = r.session.state === 'running'}
		{@const agents = sessionAgents(r.session)}
		{#if card}
			<div class="flex min-w-0 items-start gap-2">
				<LayersIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div class="flex min-w-0 flex-1 flex-col">
					<a href={running ? workspaceHref(r.machine.id, r.session.name) : undefined} class={cn('truncate font-medium', running && 'hover:underline')}>{r.session.name}</a>
					{#if group !== 'machine'}<span class="truncate text-xs text-muted-foreground">{r.machine.name}</span>{/if}
				</div>
				{@render pinButton(r.machine.id, r.session.name, null, r.session.name)}
				{@render sessionMenu(r, running)}
			</div>
			<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
				{#if running}
					<span>{r.session.workspaces.length} spaces · {agents.length} agents</span>
					{@render statusChips(agents)}
				{:else}
					<Badge variant="outline">Stopped</Badge>
				{/if}
			</div>
			<div class="mt-auto flex justify-end">{@render sessionOpen(r, running)}</div>
		{:else}
			<LayersIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<div class="flex min-w-0 flex-1 flex-col">
				<a href={running ? workspaceHref(r.machine.id, r.session.name) : undefined} class={cn('truncate font-medium', running && 'hover:underline')}>{r.session.name}</a>
				<span class="truncate text-xs text-muted-foreground">
					{#if group !== 'machine'}{r.machine.name} · {/if}{r.session.workspaces.length} spaces · {agents.length} agents
				</span>
			</div>
			<div class="hidden shrink-0 items-center gap-1 sm:flex">{@render statusChips(agents)}</div>
			{#if !running}<Badge variant="outline">Stopped</Badge>{/if}
			{@render pinButton(r.machine.id, r.session.name, null, r.session.name)}
			{@render sessionOpen(r, running)}
			{@render sessionMenu(r, running)}
		{/if}
	{:else if r.kind === 'pane'}
		{@const agent = r.pane.agent}
		{@const href = workspaceHref(r.machine.id, r.session.name, r.pane.id)}
		{@const where = [r.space.label, `Tab ${r.tab.label}`, group !== 'session' ? r.session.name : null, group !== 'machine' && group !== 'session' ? r.machine.name : null].filter(Boolean).join(' · ')}
		{#if card}
			<div class="flex min-w-0 items-start gap-2">
				{#if agent}<BotIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{:else}<SquareTerminalIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{/if}
				<div class="flex min-w-0 flex-1 flex-col">
					<a {href} class="flex min-w-0 items-center gap-2 font-medium hover:underline">
						<span class="truncate">{agent ? agent.name : 'Shell'}</span>
					</a>
					<span class="truncate text-xs text-muted-foreground">{where}</span>
				</div>
				{@render pinButton(r.machine.id, r.session.name, r.pane.id, agent?.name ?? `Shell · ${folder(r.pane.cwd)}`)}
			</div>
			<div class="flex min-w-0 items-center gap-2 text-xs">
				{#if agent}<StatusBadge status={agent.status} />{/if}
				<span class="min-w-0 truncate font-mono text-muted-foreground" title={r.pane.cwd ?? undefined}>{folder(r.pane.cwd)}</span>
			</div>
			<div class="mt-auto flex justify-end"><Button size="sm" variant="outline" {href}>Open</Button></div>
		{:else}
			{#if agent}<BotIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{:else}<SquareTerminalIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{/if}
			<div class="flex min-w-0 flex-1 flex-col">
				<a {href} class="flex min-w-0 items-center gap-2 font-medium hover:underline">
					<span class="truncate">{agent ? agent.name : 'Shell'}</span>
					{#if agent}<StatusBadge status={agent.status} compact />{/if}
				</a>
				<span class="truncate text-xs text-muted-foreground">{where}</span>
			</div>
			<span class="hidden max-w-56 shrink-0 truncate font-mono text-xs text-muted-foreground md:inline" title={r.pane.cwd ?? undefined}>{folder(r.pane.cwd)}</span>
			{@render pinButton(r.machine.id, r.session.name, r.pane.id, agent?.name ?? `Shell · ${folder(r.pane.cwd)}`)}
			<Button size="sm" variant="outline" {href}>Open</Button>
		{/if}
	{:else}
		{@const state = online(r.machine) ? 'Online' : r.machine.status === 'active' ? 'Offline' : 'Disabled'}
		{#if card}
			<div class="flex min-w-0 items-start gap-2">
				<span class={cn('mt-1.5 size-2 shrink-0 rounded-full', online(r.machine) ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-hidden="true"></span>
				<div class="flex min-w-0 flex-1 flex-col">
					<a href="/machines/{r.machine.id}" class="truncate font-medium hover:underline">{r.machine.name}</a>
					<span class="truncate text-xs text-muted-foreground">{state}{#if r.machine.host} · {r.machine.host.os}{/if}</span>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-2 text-xs">
				<span class="text-muted-foreground">Sessions <span class="font-medium text-foreground tabular-nums">{r.sessions}</span></span>
				<span class="text-muted-foreground">Agents <span class="font-medium text-foreground tabular-nums">{r.agents}</span></span>
				{#if r.machine.stats}
					<span class="text-muted-foreground">CPU <span class="font-medium text-foreground tabular-nums">{Math.round(r.machine.stats.cpuPct)}%</span></span>
					<span class="text-muted-foreground">
						Memory <span class="font-medium text-foreground tabular-nums">{Math.round((r.machine.stats.mem.used / Math.max(1, r.machine.stats.mem.total)) * 100)}%</span>
					</span>
				{/if}
			</div>
			<div class="mt-auto flex justify-end gap-1">
				<Button size="sm" variant="ghost" href="/machines/{r.machine.id}">Details</Button>
				<Button size="sm" variant="outline" href="/explore?machine={r.machine.id}">Sessions</Button>
			</div>
		{:else}
			<span class={cn('size-2 shrink-0 rounded-full', online(r.machine) ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-hidden="true"></span>
			<div class="flex min-w-0 flex-1 flex-col">
				<a href="/machines/{r.machine.id}" class="truncate font-medium hover:underline">{r.machine.name}</a>
				<span class="truncate text-xs text-muted-foreground">{state}{#if r.machine.host} · {r.machine.host.os}{/if}</span>
			</div>
			<span class="shrink-0 text-xs text-muted-foreground tabular-nums">{r.sessions} sessions · {r.agents} agents</span>
			<Button size="sm" variant="outline" href="/explore?machine={r.machine.id}">Sessions</Button>
			<Button size="sm" variant="ghost" href="/machines/{r.machine.id}">Details</Button>
		{/if}
	{/if}
{/snippet}

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="flex flex-col gap-1">
			<h1 class="text-2xl font-semibold">Explore</h1>
			<p class="text-sm text-muted-foreground">
				{totals.machinesOnline} of {totals.machines} machines online · {totals.sessions} sessions · {totals.agents} agents
				{#if totals.needsYou}· <span class="font-medium text-destructive">{totals.needsYou} need you</span>{/if}
			</p>
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<div class="relative w-full sm:w-72">
			<SearchIcon class="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
			<Input bind:value={query} class="ps-8" placeholder="Search names, folders, machines" aria-label="Search" />
		</div>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="Show"
			bind:value={() => show, (v) => v && setParam('show', v === 'sessions' ? null : v)}
		>
			{#each SHOWS as s (s)}
				<ToggleGroup.Item value={s}>{showLabels[s]}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
		{#if show !== 'machines'}
			<Select.Root type="single" value={group} onValueChange={(v) => setParam('group', v === 'machine' ? null : v)}>
				<Select.Trigger size="sm" class="w-40" aria-label="Group by">Group: {groupLabels[group]}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each GROUPS as g (g)}<Select.Item value={g} label={groupLabels[g]} />{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" value={statusFilter} onValueChange={(v) => setParam('status', v === 'all' ? null : v)}>
				<Select.Trigger size="sm" class="w-36" aria-label="Status">{statusOptions.find(([v]) => v === statusFilter)?.[1]}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each statusOptions as [value, label] (value)}<Select.Item {value} {label} />{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		{/if}
		<Select.Root type="single" value={machineFilter} onValueChange={(v) => setParam('machine', v === 'all' ? null : v)}>
			<Select.Trigger size="sm" class="w-44" aria-label="Machine">
				{machineFilter === 'all' ? 'All machines' : (fleet.machines.find((m) => m.id === machineFilter)?.name ?? 'Machine')}
			</Select.Trigger>
			<Select.Content>
				<Select.Group>
					<Select.Item value="all" label="All machines" />
					{#each fleet.machines as m (m.id)}<Select.Item value={m.id} label={m.name} />{/each}
				</Select.Group>
			</Select.Content>
		</Select.Root>
		<Button size="sm" variant={onlineOnly ? 'secondary' : 'outline'} aria-pressed={onlineOnly} onclick={() => setParam('online', onlineOnly ? null : '1')}>
			Online only
		</Button>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			class="ms-auto"
			aria-label="Layout"
			bind:value={() => layout, (v) => v && setParam('layout', v === 'cards' ? null : v)}
		>
			<ToggleGroup.Item value="cards" aria-label="Cards" title="Cards"><LayoutGridIcon /></ToggleGroup.Item>
			<ToggleGroup.Item value="list" aria-label="List" title="List"><ListIcon /></ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>

	{#if !fleet.loaded}
		<div class="flex flex-col gap-2">
			{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-12 w-full" />{/each}
		</div>
	{:else if fleet.error}
		<p class="text-sm text-destructive">{fleet.error}</p>
	{:else if !fleet.machines.length}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media variant="icon"><ServerIcon /></Empty.Media>
				<Empty.Title>No machines yet</Empty.Title>
				<Empty.Description>Add a machine and its sessions, agents and terminals show up here.</Empty.Description>
			</Empty.Header>
			<Empty.Content><Button href="/machines"><PlusIcon data-icon="inline-start" />Add a machine</Button></Empty.Content>
		</Empty.Root>
	{:else if !rows.length && !(show === 'sessions' && group === 'machine')}
		<p class="rounded-lg border p-6 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each groups as g (g.key)}
				<section class="overflow-hidden rounded-lg border" aria-label={g.label || showLabels[show]}>
					{#if g.label}
						<div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-2 text-start text-sm font-medium"
								aria-expanded={!collapsed[g.key]}
								onclick={() => (collapsed[g.key] = !collapsed[g.key])}
							>
								<ChevronRightIcon class={cn('size-4 shrink-0 text-muted-foreground transition-transform', !collapsed[g.key] && 'rotate-90')} />
								{#if g.machine && group === 'machine'}
									<span class={cn('size-2 shrink-0 rounded-full', online(g.machine) ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-hidden="true"></span>
									<span class="truncate">{g.label}</span>
									<span class="text-xs font-normal text-muted-foreground">{online(g.machine) ? '' : 'offline'}</span>
								{:else if g.status && g.status !== 'shell' && g.status !== 'stopped'}
									<StatusBadge status={g.status} compact />
									<span class="truncate">{g.label}</span>
								{:else}
									<span class="truncate">{g.label}</span>
								{/if}
								<span class="text-xs font-normal text-muted-foreground tabular-nums">{g.rows.length}</span>
							</button>
							{#if g.machine && group === 'machine'}
								<Button size="sm" variant="ghost" href="/machines/{g.machine.id}">Details</Button>
								{#if show === 'sessions' && online(g.machine)}
									<Button size="sm" variant="ghost" onclick={() => (newSession = { open: true, machine: g.machine! })}>
										<PlusIcon data-icon="inline-start" />New session
									</Button>
								{/if}
							{/if}
						</div>
					{/if}
					{#if !collapsed[g.key]}
						{#if !g.rows.length}
							<p class="px-3 py-3 text-sm text-muted-foreground">
								{g.machine && !online(g.machine) ? 'Offline; its sessions show when it reconnects.' : 'No sessions.'}
							</p>
						{:else if layout === 'cards'}
							<div class="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
								{#each g.rows as r (r.key)}
									<article class="group/row flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-colors hover:border-foreground/20">
										{@render item(r, true)}
									</article>
								{/each}
							</div>
						{:else}
							<ul class="divide-y">
								{#each g.rows as r (r.key)}
									<li class="group/row flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-muted/30">{@render item(r, false)}</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

<FormDialog
	bind:open={newSession.open}
	title="New session on {newSession.machine?.name ?? ''}"
	description="Starts a Herdr session on the machine and opens it."
	fields={[{ name: 'name', label: 'Name', placeholder: 'acme-recon', required: true }]}
	submitLabel="Start"
	onSubmit={createSession}
/>
<ConfirmDialog
	bind:open={confirmStop.open}
	title="Stop session {confirmStop.session}?"
	description="Everything running in it (shells, agents) is stopped. Its layout is kept and it can be started again."
	confirmLabel="Stop session"
	onConfirm={() => confirmStop.machine && stopSession(confirmStop.machine.id, confirmStop.session)}
/>
