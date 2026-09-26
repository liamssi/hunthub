<script lang="ts">
	// A whole session, two ways: Herdr's own UI (as if opened in a terminal on
	// the machine) or a web layout with our own navigation and one terminal per pane.
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import type { MachineHerdrView } from '@hunthub/shared/machines';
	import SessionLayout from '$lib/components/terminal/session-layout.svelte';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from '$lib/components/terminal/terminal-view.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { subscribeLive } from '$lib/live';

	let { data } = $props();

	let herdr = $derived<MachineHerdrView>(data.herdr);
	$effect(() =>
		subscribeLive(`machine:${data.machine.id}`, (message) => {
			if (message.type === 'machine.herdr' && message.machineId === data.machine.id) herdr = message.herdr;
		})
	);
	const session = $derived(herdr.sessions.find((s) => s.name === data.sessionName));

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
	let view = $state<View>('herdr');
	let transport = $state<TerminalTransport>('cli');
	$effect(() => {
		view = load('hunthub.session.view') === 'layout' ? 'layout' : 'herdr';
		transport = load('hunthub.terminal.transport') === 'native' ? 'native' : 'cli';
	});

	let mode = $state<TerminalMode>('control');
	let attempt = $state(0);
	let termState = $state<TerminalState>({ phase: 'connecting' });
	const reconnect = (next: TerminalMode = mode) => {
		mode = next;
		attempt++;
	};
	const transports: { value: TerminalTransport; label: string }[] = [
		{ value: 'cli', label: 'Herdr CLI' },
		{ value: 'native', label: 'Native protocol' }
	];
</script>

<svelte:head><title>{data.sessionName} · {data.machine.name} · HuntHub</title></svelte:head>

<div class="flex h-[calc(100svh-5rem)] flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2">
		<h1 class="text-lg font-semibold">{data.sessionName}</h1>
		<span class="text-sm text-muted-foreground">on {data.machine.name}</span>
		<Badge variant={mode === 'control' ? 'default' : 'secondary'}>{mode === 'control' ? 'Controlling' : 'Watching'}</Badge>
		{#if view === 'herdr'}
			{#if termState.phase === 'connecting'}
				<span class="text-sm text-muted-foreground">Connecting…</span>
			{:else if termState.phase === 'closed'}
				<span class="min-w-0 truncate text-sm text-muted-foreground" title={termState.reason}>{termState.reason ?? 'Closed.'}</span>
				<Button size="sm" variant="outline" onclick={() => reconnect()}><RotateCwIcon data-icon="inline-start" />Reconnect</Button>
			{/if}
		{/if}
		<div class="ms-auto flex flex-wrap items-center gap-2">
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
				<ToggleGroup.Item value="herdr">Herdr UI</ToggleGroup.Item>
				<ToggleGroup.Item value="layout">Web layout</ToggleGroup.Item>
			</ToggleGroup.Root>
			{#if view === 'layout'}
				<Select.Root
					type="single"
					value={transport}
					onValueChange={(v) => {
						transport = v === 'native' ? 'native' : 'cli';
						save('hunthub.terminal.transport', transport);
					}}
				>
					<Select.Trigger size="sm" class="w-40" aria-label="Terminal transport">{transports.find((t) => t.value === transport)?.label}</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each transports as t (t.value)}
								<Select.Item value={t.value} label={t.label} />
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			{/if}
			{#if mode === 'observe'}
				<Button size="sm" onclick={() => reconnect('control')}><KeyboardIcon data-icon="inline-start" />Take control</Button>
			{:else}
				<Button size="sm" variant="outline" onclick={() => reconnect('observe')}><EyeIcon data-icon="inline-start" />Watch only</Button>
			{/if}
			<Button size="sm" variant="outline" href="/machines/{data.machine.id}/sessions/{encodeURIComponent(data.sessionName)}">
				<LayoutListIcon data-icon="inline-start" />Manage
			</Button>
		</div>
	</div>
	<div class="min-h-0 flex-1">
		{#if view === 'herdr'}
			{#key `${mode}:${attempt}`}
				<TerminalView machineId={data.machine.id} session={data.sessionName} view="session" {mode} transport="cli" bind:state={termState} />
			{/key}
		{:else if session?.state === 'running'}
			<SessionLayout machineId={data.machine.id} {session} {mode} {transport} />
		{:else}
			<p class="text-sm text-muted-foreground">The session isn't running on the machine.</p>
		{/if}
	</div>
</div>
