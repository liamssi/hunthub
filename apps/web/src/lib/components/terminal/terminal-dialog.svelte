<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from './terminal-view.svelte';
	import { prefs, setPreferences } from '$lib/preferences.svelte';

	/** A pane's live terminal. Watching is read-only; control sends keystrokes. */
	let {
		open = $bindable(false),
		machineId,
		session,
		target,
		title
	}: { open?: boolean; machineId: string; session: string; target: string; title: string } = $props();

	const transports: { value: TerminalTransport; label: string }[] = [
		{ value: 'cli', label: 'Herdr CLI' },
		{ value: 'native', label: 'Native protocol' }
	];

	const savedTransport = (): TerminalTransport => prefs.transport ?? 'native';

	let mode = $state<TerminalMode>('observe');
	let transport = $state<TerminalTransport>('native');
	let takeover = $state(false);
	let attempt = $state(0);
	let termState = $state<TerminalState>({ phase: 'connecting' });

	// Each opening starts by watching, with the viewer's last transport.
	$effect(() => {
		if (open) {
			mode = 'observe';
			takeover = false;
			transport = savedTransport();
		}
	});

	function setTransport(value: string) {
		transport = value === 'cli' ? 'cli' : 'native';
		setPreferences({ transport });
	}

	const reconnect = (next: Partial<{ mode: TerminalMode; takeover: boolean }> = {}) => {
		mode = next.mode ?? mode;
		takeover = next.takeover ?? false;
		attempt++;
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex h-[85vh] max-w-[min(96vw,1400px)] flex-col gap-3 sm:max-w-[min(96vw,1400px)]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{title}
				<Badge variant={mode === 'control' ? 'default' : 'secondary'}>{mode === 'control' ? 'Controlling' : 'Watching'}</Badge>
				{#if termState.phase === 'connecting'}
					<span class="text-sm font-normal text-muted-foreground">Connecting…</span>
				{/if}
			</Dialog.Title>
			<Dialog.Description class="sr-only">Live terminal for pane {target} in session {session}.</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-wrap items-center gap-2">
			{#if mode === 'observe'}
				<Button size="sm" onclick={() => reconnect({ mode: 'control' })}><KeyboardIcon data-icon="inline-start" />Take control</Button>
			{:else}
				<Button size="sm" variant="outline" onclick={() => reconnect({ mode: 'observe' })}><EyeIcon data-icon="inline-start" />Watch only</Button>
			{/if}
			<Select.Root type="single" value={transport} onValueChange={(v) => { setTransport(v); reconnect(); }}>
				<Select.Trigger size="sm" class="w-44" aria-label="Terminal transport">
					{transports.find((t) => t.value === transport)?.label}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each transports as t (t.value)}
							<Select.Item value={t.value} label={t.label} />
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			{#if termState.phase === 'closed'}
				<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={termState.reason}>{termState.reason ?? 'Closed.'}</span>
				{#if mode === 'control' && !takeover}
					<Button size="sm" variant="outline" onclick={() => reconnect({ takeover: true })}>Take over from the other viewer</Button>
				{/if}
				<Button size="sm" variant="outline" onclick={() => reconnect({ takeover })}><RotateCwIcon data-icon="inline-start" />Reconnect</Button>
			{/if}
		</div>

		<div class="min-h-0 flex-1">
			{#if open}
				{#key `${mode}:${transport}:${takeover}:${attempt}`}
					<TerminalView {machineId} {session} {target} {mode} {transport} {takeover} bind:state={termState} />
				{/key}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
