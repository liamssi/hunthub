<script lang="ts">
	// The session workspace: the whole window, two ways to show the session —
	// Herdr's own UI (as if opened in a terminal on the machine) or the web
	// layout with our own navigation and one terminal per pane.
	import { onMount } from 'svelte';
	import { mode as colorMode } from 'mode-watcher';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import FullscreenIcon from '@lucide/svelte/icons/fullscreen';
	import MinimizeIcon from '@lucide/svelte/icons/minimize';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import type { MachineHerdrView } from '@hunthub/shared/machines';
	import SessionLayout from '$lib/components/terminal/session-layout.svelte';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from '$lib/components/terminal/terminal-view.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { subscribeLive } from '$lib/live';
	import { appearance, loadAppearance, themeColors, workspaceVars } from '$lib/terminal-appearance.svelte';
	import AppearanceDialog from '$lib/components/terminal/appearance-dialog.svelte';
	import PaletteIcon from '@lucide/svelte/icons/palette';

	let { data } = $props();

	let herdr = $derived<MachineHerdrView>(data.herdr);
	$effect(() =>
		subscribeLive(`machine:${data.machine.id}`, (message) => {
			if (message.type === 'machine.herdr' && message.machineId === data.machine.id) herdr = message.herdr;
		})
	);
	const session = $derived(herdr.sessions.find((s) => s.name === data.sessionName));
	const sessionHref = $derived(`/machines/${data.machine.id}/sessions/${encodeURIComponent(data.sessionName)}`);

	// The app sidebar folds away while working here and comes back as it was.
	const sidebar = useSidebar();
	onMount(() => {
		const wasOpen = sidebar.open;
		if (wasOpen) sidebar.setOpen(false);
		return () => {
			if (wasOpen && !sidebar.open) sidebar.setOpen(true);
		};
	});

	// The workspace is a dark surface; the whole page (app rail, menus) follows while it's open.
	// mode-watcher rewrites the root classes after mounting, so dark is re-applied when removed;
	// leaving restores whatever the user's own mode is.
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

	// Per-browser conveniences: the last view and transport.
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
</script>

<svelte:head><title>{data.sessionName} · {data.machine.name} · HuntHub</title></svelte:head>

{#snippet breadcrumb()}
	<Sidebar.Trigger />
	<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
	<nav class="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
		<a href="/machines/{data.machine.id}" class="truncate text-muted-foreground hover:text-foreground">{data.machine.name}</a>
		<span class="text-muted-foreground" aria-hidden="true">/</span>
		<a href={sessionHref} class="truncate font-medium hover:underline">{data.sessionName}</a>
	</nav>
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
				<DropdownMenu.Item>
					{#snippet child({ props })}<a {...props} href={sessionHref}>Manage session</a>{/snippet}
				</DropdownMenu.Item>
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<div bind:this={root} class="flex h-svh flex-col bg-background">
	{#if view === 'layout' && session?.state === 'running'}
		<SessionLayout machineId={data.machine.id} {session} {mode} {transport} header={breadcrumb} {controls} />
	{:else}
		<header class="flex h-10 shrink-0 items-center gap-2 border-b px-2">
			{@render breadcrumb()}
			{#if session && session.state !== 'running'}
				<Badge variant="outline">Stopped</Badge>
			{/if}
			{#if view === 'herdr' && termState.phase === 'closed'}
				<span class="min-w-0 truncate text-sm text-muted-foreground" title={termState.reason}>{termState.reason ?? 'Closed.'}</span>
				<Button size="sm" variant="ghost" onclick={() => attempt++}><RotateCwIcon data-icon="inline-start" />Reconnect</Button>
			{:else if view === 'herdr' && termState.phase === 'connecting'}
				<span class="text-sm text-muted-foreground">Connecting…</span>
			{/if}
			<div class="ms-auto flex items-center gap-1">{@render controls()}</div>
		</header>
		<div class="min-h-0 flex-1">
			{#if view === 'herdr'}
				<div class="size-full" style:background-color={themeColors(appearance.theme).background}>
					{#key `${mode}:${attempt}`}
						<TerminalView machineId={data.machine.id} session={data.sessionName} view="session" {mode} transport="cli" bind:state={termState} />
					{/key}
				</div>
			{:else}
				<p class="p-4 text-sm text-muted-foreground">
					The session isn't running on the machine. <a href={sessionHref} class="underline">Start it from the session page.</a>
				</p>
			{/if}
		</div>
	{/if}
</div>

<AppearanceDialog bind:open={appearanceOpen} />
