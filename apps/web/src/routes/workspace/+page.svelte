<script lang="ts">
	// The workspace: several sessions open at once (from any machine), each
	// shown as Herdr's own UI or as the web layout. Recently used sessions stay
	// mounted, so their terminals stay connected and switching is instant.
	// ?open=<machine>:<session> opens or focuses a session; &pane= jumps to a pane.
	import { onMount, untrack } from 'svelte';
	import { mode as colorMode } from 'mode-watcher';
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import FullscreenIcon from '@lucide/svelte/icons/fullscreen';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import MinimizeIcon from '@lucide/svelte/icons/minimize';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import AppearanceDialog from '$lib/components/terminal/appearance-dialog.svelte';
	import SessionLayout from '$lib/components/terminal/session-layout.svelte';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from '$lib/components/terminal/terminal-view.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { startSession } from '$lib/console';
	import { fleet, machineById, needsYouCount, sessionOf, workspaceHref } from '$lib/fleet.svelte';
	import { findPin, togglePin } from '$lib/pins.svelte';
	import { appearance, loadAppearance, themeColors, workspaceVars } from '$lib/terminal-appearance.svelte';
	import { cn } from '$lib/utils.js';

	/** How many sessions stay mounted (connected) at once. */
	const KEEP_MOUNTED = 4;
	const OPEN_KEY = 'hunthub.workspace.open';

	const load = (key: string) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const save = (key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Only a convenience.
		}
	};

	// --- Open sessions -------------------------------------------------------------
	type Ref = { machineId: string; session: string };
	const refKey = (r: Ref) => `${r.machineId}:${r.session}`;
	function parseRef(value: string | null): Ref | null {
		const m = value && /^([0-9a-f-]{36}):(.+)$/.exec(value);
		return m ? { machineId: m[1]!, session: m[2]! } : null;
	}

	// Restored when the page is created (in the browser), before anything reads it.
	function restoreOpen(): Ref[] {
		try {
			const saved = JSON.parse(load(OPEN_KEY) ?? '[]');
			return Array.isArray(saved) ? saved.map((k) => parseRef(String(k))).filter((r): r is Ref => r !== null) : [];
		} catch {
			return [];
		}
	}
	let open = $state<Ref[]>(browser ? restoreOpen() : []);
	const restored = browser;
	$effect(() => {
		const keys = open.map(refKey);
		save(OPEN_KEY, JSON.stringify(keys));
	});

	const requested = $derived(parseRef(page.url.searchParams.get('open')));
	const requestedPane = $derived(page.url.searchParams.get('pane'));
	// The session in the URL joins the open list (after every navigation, the first included).
	afterNavigate(() => {
		const r = parseRef(page.url.searchParams.get('open'));
		if (r && !open.some((o) => refKey(o) === refKey(r))) open = [...open, r];
	});
	const active = $derived(requested ?? open[0] ?? null);
	const activeKey = $derived(active ? refKey(active) : null);

	// Recently shown sessions stay mounted (most recent first).
	let recent = $state<string[]>([]);
	$effect(() => {
		const key = activeKey;
		if (!key) return;
		untrack(() => {
			const next = [key, ...recent.filter((k) => k !== key && open.some((o) => refKey(o) === k))].slice(0, KEEP_MOUNTED);
			if (next.join() !== recent.join()) recent = next;
		});
	});
	const mounted = $derived(open.filter((o) => recent.includes(refKey(o))));

	/** A new object each time the URL asks for a pane, so the session goes there again. */
	const jump = $derived(requestedPane ? { paneId: requestedPane, at: page.url.href } : null);

	function show(r: Ref, paneId?: string | null) {
		void goto(workspaceHref(r.machineId, r.session, paneId), { keepFocus: true, noScroll: true });
	}
	function close(r: Ref) {
		const i = open.findIndex((o) => refKey(o) === refKey(r));
		open = open.filter((_, j) => j !== i);
		recent = recent.filter((k) => k !== refKey(r));
		if (activeKey === refKey(r)) {
			const next = open[i] ?? open[i - 1];
			if (next) show(next);
			else void goto('/workspace', { keepFocus: true, noScroll: true });
		}
	}

	const activeMachine = $derived(active ? machineById(active.machineId) : undefined);
	const activeSession = $derived(active ? sessionOf(active.machineId, active.session) : undefined);
	const needsYou = $derived(open.reduce((n, o) => n + (sessionOf(o.machineId, o.session) ? needsYouCount(sessionOf(o.machineId, o.session)!) : 0), 0));

	// Picker: open any session on any machine.
	let pickerOpen = $state(false);

	// A stopped session can be started and opened in one go (after asking).
	let starting = $state<Record<string, boolean>>({});
	let askStart = $state<{ open: boolean; ref: Ref | null }>({ open: false, ref: null });
	async function startAndOpen(ref: Ref) {
		const key = refKey(ref);
		starting[key] = true;
		show(ref);
		await startSession(ref.machineId, ref.session);
		delete starting[key];
	}
	function openFromPicker(ref: Ref, state: 'running' | 'stopped') {
		pickerOpen = false;
		if (state === 'running') show(ref);
		else askStart = { open: true, ref };
	}
	const allSessions = $derived(
		fleet.machines.flatMap((m) => (fleet.herdr[m.id]?.sessions ?? []).map((s) => ({ machine: m, session: s })))
	);

	// --- Page chrome (from the single-session page) --------------------------------
	// The app sidebar folds away while working here and comes back as it was.
	const sidebar = useSidebar();
	onMount(() => {
		const wasOpen = sidebar.open;
		if (wasOpen) sidebar.setOpen(false);
		return () => {
			if (wasOpen && !sidebar.open) sidebar.setOpen(true);
		};
	});

	// A dark surface; the whole page (app rail, menus) follows while it's open.
	// mode-watcher rewrites the root classes after mounting, so dark is re-applied
	// when removed; leaving restores the user's own mode.
	onMount(() => {
		const html = document.documentElement;
		const keepDark = () => !html.classList.contains('dark') && html.classList.add('dark');
		keepDark();
		const observer = new MutationObserver(keepDark);
		observer.observe(html, { attributes: true, attributeFilter: ['class'] });
		return () => {
			observer.disconnect();
			if (colorMode.current !== 'dark') html.classList.remove('dark');
		};
	});

	// The page takes the terminal theme's colors (menus and dialogs included) while open.
	onMount(() => loadAppearance());
	$effect(() => {
		const html = document.documentElement;
		const vars = workspaceVars(appearance.theme);
		for (const [k, v] of Object.entries(vars)) html.style.setProperty(k, v);
		return () => {
			for (const k of Object.keys(vars)) html.style.removeProperty(k);
		};
	});

	type View = 'herdr' | 'layout';
	let view = $state<View>('layout');
	let transport = $state<TerminalTransport>('cli');
	onMount(() => {
		view = load('hunthub.session.view') === 'herdr' ? 'herdr' : 'layout';
		transport = load('hunthub.terminal.transport') === 'native' ? 'native' : 'cli';
	});

	// Browser full screen for the whole workspace.
	let root = $state<HTMLElement>();
	let fullscreen = $state(false);
	onMount(() => {
		const sync = () => (fullscreen = document.fullscreenElement === root);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});
	const toggleFullscreen = () => (fullscreen ? document.exitFullscreen() : root?.requestFullscreen())?.catch(() => {});

	let appearanceOpen = $state(false);
	let mode = $state<TerminalMode>('control');
	let attempt = $state(0);
	let termState = $state<TerminalState>({ phase: 'connecting' });

	// Alt+Shift+O opens the session picker; Alt+Shift+PageUp/PageDown switch open sessions.
	function onKeydown(e: KeyboardEvent) {
		if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
		const i = open.findIndex((o) => refKey(o) === activeKey);
		if (e.code === 'KeyO') pickerOpen = true;
		else if ((e.code === 'PageDown' || e.code === 'PageUp') && open.length > 1) {
			const next = open[(i + (e.code === 'PageDown' ? 1 : -1) + open.length) % open.length];
			if (next) show(next);
		} else return;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<svelte:window onkeydowncapture={onKeydown} />
<svelte:head>
	<title>{needsYou ? `(${needsYou}) ` : ''}{active ? `${active.session} · ${activeMachine?.name ?? ''} · ` : ''}Workspace · HuntHub</title>
</svelte:head>

{#snippet sessionsHeader()}
	<div class="flex h-10 items-center gap-1 px-2">
		<Sidebar.Trigger />
		<span class="ms-1 me-auto text-xs font-medium text-muted-foreground">Sessions</span>
		<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Explore" title="Explore" href="/explore"><CompassIcon /></Button>
		<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Open a session" title="Open a session (Alt+Shift+O)" onclick={() => (pickerOpen = true)}>
			<PlusIcon />
		</Button>
	</div>
	<ul class="flex flex-col gap-0.5 px-2 pb-2" aria-label="Open sessions">
		{#each open as o (refKey(o))}
			{@const m = machineById(o.machineId)}
			{@const s = sessionOf(o.machineId, o.session)}
			{@const current = refKey(o) === activeKey}
			{@const count = s ? needsYouCount(s) : 0}
			{@const pinned = !!findPin(o.machineId, o.session)}
			<li
				class={cn(
					'group/os flex h-8 min-w-0 items-center rounded-md text-sm transition-colors hover:bg-sidebar-accent',
					current && 'bg-sidebar-accent text-sidebar-accent-foreground'
				)}
			>
				<button
					type="button"
					class="flex h-full min-w-0 flex-1 items-center gap-2 ps-2 text-start outline-none"
					aria-current={current ? 'true' : undefined}
					title="{o.session} on {m?.name ?? 'unknown machine'}"
					onclick={() => show(o)}
				>
					<LayersIcon class={cn('size-4 shrink-0', s?.state === 'running' && m?.connection === 'online' ? 'text-muted-foreground' : 'text-muted-foreground/40')} aria-hidden="true" />
					<span class="flex min-w-0 flex-col leading-tight">
						<span class={cn('truncate', current && 'font-medium')}>{o.session}</span>
						<span class="truncate text-xs text-muted-foreground">{m?.name ?? '…'}</span>
					</span>
					{#if count}<Badge variant="destructive" class="ms-auto h-5 px-1.5 text-xs tabular-nums">{count}</Badge>{/if}
				</button>
				<Button
					size="icon-sm"
					variant="ghost"
					class={cn('size-6 opacity-0 group-hover/os:opacity-100 focus-visible:opacity-100', pinned && 'opacity-100')}
					aria-label={pinned ? `Unpin ${o.session}` : `Pin ${o.session}`}
					title={pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
					onclick={() => togglePin(o.machineId, o.session, null, o.session)}
				>
					{#if pinned}<PinOffIcon />{:else}<PinIcon />{/if}
				</Button>
				<Button
					size="icon-sm"
					variant="ghost"
					class="me-0.5 size-6 opacity-0 group-hover/os:opacity-100 focus-visible:opacity-100"
					aria-label="Close {o.session}"
					title="Close (the session keeps running)"
					onclick={() => close(o)}
				>
					<XIcon />
				</Button>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet controls()}
	{#if mode === 'observe'}
		<Badge variant="secondary" class="gap-1"><EyeIcon />Watching</Badge>
	{/if}
	<ToggleGroup.Root
		type="single"
		size="sm"
		variant="outline"
		bind:value={
			() => view,
			(v) => {
				// Clicking the active option would clear it; one view is always shown.
				if (v !== 'herdr' && v !== 'layout') return;
				view = v;
				save('hunthub.session.view', v);
			}
		}
		aria-label="Session view"
	>
		<ToggleGroup.Item value="layout">Workspace</ToggleGroup.Item>
		<ToggleGroup.Item value="herdr">Herdr UI</ToggleGroup.Item>
	</ToggleGroup.Root>
	<Button size="icon-sm" variant="ghost" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'} onclick={toggleFullscreen}>
		{#if fullscreen}<MinimizeIcon />{:else}<FullscreenIcon />{/if}
	</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="icon-sm" variant="ghost" aria-label="Session options"><EllipsisVerticalIcon /></Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-60">
			<DropdownMenu.Group>
				<DropdownMenu.CheckboxItem bind:checked={() => mode === 'observe', (v) => ((mode = v ? 'observe' : 'control'), attempt++)}>
					Watch only
				</DropdownMenu.CheckboxItem>
			</DropdownMenu.Group>
			<DropdownMenu.Separator />
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading>Pane connection</DropdownMenu.GroupHeading>
				<DropdownMenu.RadioGroup
					bind:value={
						() => transport,
						(v) => {
							transport = v === 'native' ? 'native' : 'cli';
							save('hunthub.terminal.transport', transport);
						}
					}
				>
					<DropdownMenu.RadioItem value="cli">Herdr CLI</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="native">Native protocol</DropdownMenu.RadioItem>
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Group>
			<DropdownMenu.Separator />
			<DropdownMenu.Group>
				<DropdownMenu.Item onSelect={() => (appearanceOpen = true)}><PaletteIcon />Terminal appearance…</DropdownMenu.Item>
				{#if active}
					<DropdownMenu.Item>
						{#snippet child({ props })}<a {...props} href="/machines/{active.machineId}/sessions/{encodeURIComponent(active.session)}">Manage session</a>{/snippet}
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<div bind:this={root} class="relative flex h-svh flex-col bg-background">
	{#if !restored || (!fleet.loaded && active)}
		<div class="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</div>
	{:else if !active}
		<div class="flex size-full items-center justify-center p-6">
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon"><LayersIcon /></Empty.Media>
					<Empty.Title>No sessions open</Empty.Title>
					<Empty.Description>Open a session to work in it here. Several can be open at once.</Empty.Description>
				</Empty.Header>
				<Empty.Content class="flex-row justify-center gap-2">
					<Button onclick={() => (pickerOpen = true)}><PlusIcon data-icon="inline-start" />Open a session</Button>
					<Button variant="outline" href="/explore"><CompassIcon data-icon="inline-start" />Explore</Button>
				</Empty.Content>
			</Empty.Root>
		</div>
	{:else if view === 'herdr'}
		<header class="flex h-10 shrink-0 items-center gap-2 border-b px-2">
			<Sidebar.Trigger />
			<span class="truncate text-sm font-medium">{active.session}</span>
			<span class="truncate text-sm text-muted-foreground">{activeMachine?.name ?? ''}</span>
			{#if termState.phase === 'closed'}
				<span class="min-w-0 truncate text-sm text-muted-foreground" title={termState.reason}>{termState.reason ?? 'Closed.'}</span>
				<Button size="sm" variant="ghost" onclick={() => attempt++}><RotateCwIcon data-icon="inline-start" />Reconnect</Button>
			{:else if termState.phase === 'connecting'}
				<span class="text-sm text-muted-foreground">Connecting…</span>
			{/if}
			<div class="ms-auto flex items-center gap-1">{@render controls()}</div>
		</header>
		<div class="min-h-0 flex-1" style:background-color={themeColors(appearance.theme).background}>
			{#key `${activeKey}:${mode}:${attempt}`}
				<TerminalView machineId={active.machineId} session={active.session} view="session" {mode} transport="cli" bind:state={termState} />
			{/key}
		</div>
	{:else}
		{#each mounted as o (refKey(o))}
			{@const s = sessionOf(o.machineId, o.session)}
			{@const shown = refKey(o) === activeKey}
			<div class={cn('absolute inset-0', !shown && 'invisible')} inert={!shown}>
				{#if s && s.state === 'running'}
					<SessionLayout
						machineId={o.machineId}
						session={s}
						{mode}
						{transport}
						active={shown}
						jump={shown ? jump : null}
						header={sessionsHeader}
						{controls}
					/>
				{:else}
					<div class="dark flex size-full">
						<aside class="w-60 shrink-0 border-e bg-sidebar">{@render sessionsHeader()}</aside>
						<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
							{#if !fleet.loaded}
								<Spinner />
							{:else if starting[refKey(o)]}
								<Spinner />
								<p>Starting {o.session} on {machineById(o.machineId)?.name ?? 'the machine'}…</p>
							{:else if machineById(o.machineId)?.connection !== 'online'}
								<p>{machineById(o.machineId)?.name ?? 'The machine'} is offline; the session shows when it reconnects.</p>
							{:else if !s}
								<p>The session {o.session} no longer exists on {machineById(o.machineId)?.name}.</p>
								<Button size="sm" variant="outline" onclick={() => close(o)}>Close it</Button>
							{:else}
								<p>The session {o.session} is stopped.</p>
								<div class="flex gap-2">
									<Button size="sm" onclick={() => startAndOpen(o)}><PlayIcon data-icon="inline-start" />Start session</Button>
									<Button size="sm" variant="outline" href="/machines/{o.machineId}/sessions/{encodeURIComponent(o.session)}">Manage</Button>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<Command.Dialog bind:open={pickerOpen} title="Open a session" description="Any session on any machine">
	<Command.Input placeholder="Open a session…" />
	<Command.List>
		<Command.Empty>No sessions match.</Command.Empty>
		{#each fleet.machines as m (m.id)}
			{@const sessions = allSessions.filter((x) => x.machine.id === m.id)}
			{#if sessions.length}
				<Command.Group heading={m.name}>
					{#each sessions as { session: s } (s.name)}
						{@const count = needsYouCount(s)}
						{@const reachable = m.connection === 'online' && m.status === 'active'}
						<Command.Item
							value="{s.name} {m.name}"
							disabled={!reachable}
							onSelect={() => openFromPicker({ machineId: m.id, session: s.name }, s.state)}
						>
							<LayersIcon class={s.state === 'running' ? undefined : 'opacity-50'} />
							<span class="min-w-0 flex-1 truncate">{s.name}</span>
							{#if count}<StatusBadge status="blocked" compact />{/if}
							<span class="shrink-0 text-xs text-muted-foreground">
								{#if !reachable}offline{:else if s.state === 'running'}{s.workspaces.length} spaces{:else}stopped · starts when opened{/if}
							</span>
						</Command.Item>
					{/each}
				</Command.Group>
			{/if}
		{/each}
	</Command.List>
</Command.Dialog>

<AppearanceDialog bind:open={appearanceOpen} />

<AlertDialog.Root bind:open={askStart.open}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Start {askStart.ref?.session}?</AlertDialog.Title>
			<AlertDialog.Description>
				The session is stopped on {askStart.ref ? (machineById(askStart.ref.machineId)?.name ?? 'the machine') : ''}. Starting it brings back its
				saved layout; programs that were running in it are not restarted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					const ref = askStart.ref;
					askStart = { open: false, ref: null };
					if (ref) void startAndOpen(ref);
				}}
			>
				Start and open
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
