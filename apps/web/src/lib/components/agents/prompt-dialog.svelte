<script lang="ts" module>
	/** Unsent prompts per agent pane, kept while the page is open. */
	const drafts = new Map<string, string>();
</script>

<script lang="ts">
	// Gives an agent a prompt. Herdr pastes it and presses Enter, and refuses
	// while the agent is asking something or isn't ready; then it can still be
	// typed into the pane as is. "Insert" types it without pressing Enter.
	import type { AgentView } from '@hunthub/shared/machines';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { promptAgent, typeIntoPane } from '$lib/console';

	let { open = $bindable(false), agent }: { open?: boolean; agent: AgentView | null } = $props();

	const key = $derived(agent ? `${agent.machineId}\t${agent.session}\t${agent.paneId}` : '');
	let text = $state('');
	let busy = $state(false);
	/** Herdr refused to prompt; the reason, with the option to type it in anyway. */
	let refused = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			text = drafts.get(key) ?? '';
			refused = null;
		});
	});
	$effect(() => {
		if (open && key) drafts.set(key, text);
	});

	function done(message: string) {
		drafts.delete(key);
		text = '';
		open = false;
		toast.success(message);
	}

	async function send() {
		if (!agent || !text.trim() || busy) return;
		busy = true;
		refused = null;
		const out = await promptAgent(agent.machineId, agent.session, agent.paneId, text.trim());
		busy = false;
		if (out.ok) return done(`Sent to ${agent.name}`);
		if (out.code === 'agent_blocked') refused = `${agent.name} is asking something (see its pane). Answer that first, or type this in anyway.`;
		else if (out.code === 'agent_not_ready') refused = `${agent.name} can't take a prompt right now: it's still starting, or it isn't what's running in its pane.`;
		else toast.error(`Couldn't send to ${agent.name}`, { description: out.message });
	}

	async function type(enter: boolean) {
		if (!agent || !text || busy) return;
		busy = true;
		const out = await typeIntoPane(agent.machineId, agent.session, agent.paneId, text, enter);
		busy = false;
		if (out.ok) done(enter ? `Typed into ${agent.name}` : `Inserted into ${agent.name}`);
		else toast.error(`Couldn't type into ${agent.name}`, { description: out.message });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				Prompt {agent?.name ?? 'agent'}
				{#if agent}<StatusBadge status={agent.status} />{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if agent}{agent.workspaceLabel} · {agent.session}{/if}
			</Dialog.Description>
		</Dialog.Header>

		<Textarea
			bind:value={text}
			rows={7}
			placeholder="What should it do?"
			aria-label="Prompt"
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					void send();
				}
			}}
		/>

		{#if refused}
			<Alert.Root>
				<Alert.Title>Not sent</Alert.Title>
				<Alert.Description>
					<p>{refused}</p>
					<Button size="sm" variant="outline" class="mt-2" disabled={busy} onclick={() => type(true)}>Type it into the pane anyway</Button>
				</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer class="items-center sm:justify-between">
			<span class="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter sends</span>
			<div class="flex gap-2">
				<Button variant="outline" disabled={!text || busy} onclick={() => type(false)} title="Type it into the agent's input without sending">Insert</Button>
				<Button disabled={!text.trim() || busy} onclick={send}>
					{#if busy}<Spinner data-icon="inline-start" />{/if}Send
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
