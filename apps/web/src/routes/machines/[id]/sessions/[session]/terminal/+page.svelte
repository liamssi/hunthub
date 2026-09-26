<script lang="ts">
	// The whole session in Herdr's own UI, as if opened in a terminal on the machine.
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import TerminalView, { type TerminalMode, type TerminalState } from '$lib/components/terminal/terminal-view.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { data } = $props();

	let mode = $state<TerminalMode>('control');
	let attempt = $state(0);
	let termState = $state<TerminalState>({ phase: 'connecting' });
	const reconnect = (next: TerminalMode = mode) => {
		mode = next;
		attempt++;
	};
</script>

<svelte:head><title>{data.sessionName} · {data.machine.name} · HuntHub</title></svelte:head>

<div class="flex h-[calc(100svh-5rem)] flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2">
		<h1 class="text-lg font-semibold">{data.sessionName}</h1>
		<span class="text-sm text-muted-foreground">on {data.machine.name}</span>
		<Badge variant={mode === 'control' ? 'default' : 'secondary'}>{mode === 'control' ? 'Controlling' : 'Watching'}</Badge>
		{#if termState.phase === 'connecting'}
			<span class="text-sm text-muted-foreground">Connecting…</span>
		{:else if termState.phase === 'closed'}
			<span class="min-w-0 truncate text-sm text-muted-foreground" title={termState.reason}>{termState.reason ?? 'Closed.'}</span>
		{/if}
		<div class="ms-auto flex gap-2">
			{#if termState.phase === 'closed'}
				<Button size="sm" variant="outline" onclick={() => reconnect()}><RotateCwIcon data-icon="inline-start" />Reconnect</Button>
			{/if}
			{#if mode === 'observe'}
				<Button size="sm" onclick={() => reconnect('control')}><KeyboardIcon data-icon="inline-start" />Take control</Button>
			{:else}
				<Button size="sm" variant="outline" onclick={() => reconnect('observe')}><EyeIcon data-icon="inline-start" />Watch only</Button>
			{/if}
			<Button size="sm" variant="outline" href="/machines/{data.machine.id}/sessions/{encodeURIComponent(data.sessionName)}">
				<LayoutListIcon data-icon="inline-start" />Layout
			</Button>
		</div>
	</div>
	<div class="min-h-0 flex-1">
		{#key `${mode}:${attempt}`}
			<TerminalView machineId={data.machine.id} session={data.sessionName} view="session" {mode} transport="cli" bind:state={termState} />
		{/key}
	</div>
</div>
