<script lang="ts">
	// Starts an agent in a session: which one, where (a new tab in a space, or a
	// split beside the current pane), and optionally a first prompt, sent once
	// the agent is ready. Only agents installed on the machine are offered.
	import { AGENT_KINDS, validateAgentName } from '@hunthub/shared/console';
	import type { SessionView } from '@hunthub/shared/machines';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { installedAgentKinds, launchAgent } from '$lib/console';
	import { prefs, setPreferences } from '$lib/preferences.svelte';

	let {
		open = $bindable(false),
		machineId,
		session,
		spaceId,
		paneId,
		onstarted
	}: {
		open?: boolean;
		machineId: string;
		session: SessionView;
		/** The space a new tab goes to unless another is chosen. */
		spaceId: string | null;
		/** The pane a split goes beside (none: only a new tab). */
		paneId: string | null;
		/** The agent's pane exists (to go to it). */
		onstarted?: (paneId: string) => void;
	} = $props();

	type Where = 'tab' | 'right' | 'down';

	let installed = $state<string[] | null | 'loading'>('loading');
	let kind = $state('');
	let name = $state('');
	let where = $state<Where>('tab');
	let space = $state('');
	let cwd = $state('');
	let prompt = $state('');
	let nameError = $state<string | null>(null);

	const label = (k: string) => AGENT_KINDS.find((a) => a.kind === k)?.label ?? k;
	const available = $derived(Array.isArray(installed) ? AGENT_KINDS.filter((k) => installed!.includes(k.kind)) : [...AGENT_KINDS]);

	// Fresh choices each time it opens (only then: live session updates must not
	// reset what's being typed); the agent last used is remembered.
	$effect(() => {
		if (open) untrack(reset);
	});
	function reset() {
		name = '';
		prompt = '';
		cwd = '';
		nameError = null;
		where = 'tab';
		space = spaceId ?? session.workspaces[0]?.id ?? '';
		installed = 'loading';
		void installedAgentKinds(machineId, session.name).then((kinds) => {
			installed = kinds;
			const last = prefs.agentKind ?? '';
			const choices = kinds ?? AGENT_KINDS.map((k) => k.kind);
			kind = choices.includes(last) ? last : (choices[0] ?? '');
		});
	}

	function submit(event?: Event) {
		event?.preventDefault();
		if (!kind) return;
		const chosenName = name.trim();
		nameError = chosenName ? validateAgentName(chosenName) : null;
		if (nameError) return;
		setPreferences({ agentKind: kind });
		const request = {
			kind,
			...(chosenName && { name: chosenName }),
			...(where === 'tab' ? { placement: 'tab' as const, workspaceId: space } : { placement: 'split' as const, paneId: paneId!, direction: where }),
			...(cwd.trim() && { cwd: cwd.trim() }),
			...(prompt.trim() && { prompt: prompt.trim() })
		};
		open = false;
		void start(request, label(kind), !!request.prompt);
	}

	async function start(request: Parameters<typeof launchAgent>[2], what: string, withPrompt: boolean) {
		const id = toast.loading(`Starting ${what}…`, { description: withPrompt ? 'It gets your prompt once it’s ready.' : undefined });
		const began = Date.now();
		const out = await launchAgent(machineId, session.name, request);
		if (!out.ok) {
			toast.error(`${what} didn't start`, { id, description: out.message });
			return;
		}
		const r = out.result as { pane_id: string; name: string; prompted: boolean; prompt_error?: string };
		const go = { label: 'Go to agent', onClick: () => onstarted?.(r.pane_id) };
		if (withPrompt && !r.prompted) {
			toast.warning(`${r.name} started; the prompt wasn't sent`, { id, description: r.prompt_error, action: go, duration: 15_000 });
		} else {
			toast.success(withPrompt ? `${r.name} started and got your prompt` : `${r.name} started`, { id, action: go });
		}
		// Go there right away unless it took long enough that you've moved on.
		if (Date.now() - began < 8000) onstarted?.(r.pane_id);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>New agent</Dialog.Title>
			<Dialog.Description>Starts an agent in {session.name}, as if you typed its command in a new shell there.</Dialog.Description>
		</Dialog.Header>

		<form id="new-agent-form" onsubmit={submit}>
			<Field.FieldGroup>
				<div class="grid gap-4 sm:grid-cols-2">
					<Field.Field>
						<Field.FieldLabel for="agent-kind">Agent</Field.FieldLabel>
						<Select.Root type="single" bind:value={kind} disabled={installed === 'loading'}>
							<Select.Trigger id="agent-kind" class="w-full">
								{#if installed === 'loading'}
									<span class="flex items-center gap-2 text-muted-foreground"><Spinner />Checking the machine…</span>
								{:else}
									{kind ? label(kind) : 'None installed'}
								{/if}
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each available as k (k.kind)}
										<Select.Item value={k.kind} label={k.label}>{k.label}</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
						{#if installed === null}
							<Field.FieldDescription>Couldn't check which agents are installed; all are listed.</Field.FieldDescription>
						{:else if Array.isArray(installed) && !installed.length}
							<Field.FieldDescription>No supported agent is installed on this machine.</Field.FieldDescription>
						{/if}
					</Field.Field>
					<Field.Field data-invalid={nameError ? true : undefined}>
						<Field.FieldLabel for="agent-name">Name</Field.FieldLabel>
						<Input id="agent-name" bind:value={name} placeholder="Automatic" autocomplete="off" spellcheck={false} aria-invalid={nameError ? true : undefined} />
						{#if nameError}<Field.FieldError>{nameError}</Field.FieldError>{/if}
					</Field.Field>
				</div>

				<Field.Field>
					<Field.FieldLabel id="agent-where-label">Where</Field.FieldLabel>
					<ToggleGroup.Root
						type="single"
						variant="outline"
						value={where}
						onValueChange={(v) => v && (where = v as Where)}
						aria-labelledby="agent-where-label"
						class="w-full"
					>
						<ToggleGroup.Item value="tab" class="flex-1">New tab</ToggleGroup.Item>
						<ToggleGroup.Item value="right" class="flex-1" disabled={!paneId}>Split right</ToggleGroup.Item>
						<ToggleGroup.Item value="down" class="flex-1" disabled={!paneId}>Split down</ToggleGroup.Item>
					</ToggleGroup.Root>
				</Field.Field>

				<div class="grid gap-4 sm:grid-cols-2">
					{#if where === 'tab'}
						<Field.Field>
							<Field.FieldLabel for="agent-space">Space</Field.FieldLabel>
							<Select.Root type="single" bind:value={space}>
								<Select.Trigger id="agent-space" class="w-full">{session.workspaces.find((w) => w.id === space)?.label ?? 'Choose a space'}</Select.Trigger>
								<Select.Content>
									<Select.Group>
										{#each session.workspaces as w (w.id)}
											<Select.Item value={w.id} label={w.label}>{w.label}</Select.Item>
										{/each}
									</Select.Group>
								</Select.Content>
							</Select.Root>
						</Field.Field>
					{/if}
					<Field.Field class={where === 'tab' ? '' : 'sm:col-span-2'}>
						<Field.FieldLabel for="agent-cwd">Folder</Field.FieldLabel>
						<Input id="agent-cwd" bind:value={cwd} placeholder={where === 'tab' ? "The space's folder" : "The pane's folder"} autocomplete="off" spellcheck={false} />
					</Field.Field>
				</div>

				<Field.Field>
					<Field.FieldLabel for="agent-prompt">First prompt</Field.FieldLabel>
					<Textarea
						id="agent-prompt"
						bind:value={prompt}
						rows={4}
						placeholder="Optional"
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
						}}
					/>
					<Field.FieldDescription>
						Sent once the agent is ready. If it asks something first (like whether to trust the folder), answer it in its pane and send the prompt from
						there.
					</Field.FieldDescription>
				</Field.Field>
			</Field.FieldGroup>
		</form>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" form="new-agent-form" disabled={!kind || installed === 'loading' || (where === 'tab' && !space)}>Start agent</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
