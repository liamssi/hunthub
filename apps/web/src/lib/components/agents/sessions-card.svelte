<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { validateSessionName } from '@hunthub/shared/console';
	import FormDialog from '$lib/components/console/form-dialog.svelte';
	import { startSession } from '$lib/console';
	import { workspaceHref } from '$lib/fleet.svelte';
	import { toast } from 'svelte-sonner';
	import type { AgentView, Machine, MachineHerdrView } from '@hunthub/shared/machines';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import PeekDialog from './peek-dialog.svelte';
	import StatusBadge from './status-badge.svelte';

	let { machine, herdr }: { machine: Machine; herdr: MachineHerdrView } = $props();

	let peek = $state<AgentView | null>(null);
	let newSessionOpen = $state(false);

	async function createSession(values: Record<string, string>) {
		const invalid = validateSessionName(values.name ?? '');
		if (invalid) {
			toast.error(invalid);
			return false;
		}
		return startSession(machine.id, values.name!);
	}
	const online = $derived(machine.connection === 'online' && machine.status === 'active');
</script>

<Card.Root class="mt-6">
	<Card.Header class="flex flex-row items-start justify-between gap-2">
		<div>
			<Card.Title>Herdr sessions</Card.Title>
			<Card.Description>Sessions and agents on this machine, as Herdr reports them.</Card.Description>
		</div>
		{#if online && herdr.supported && machine.host?.herdrVersion}
			<Button size="sm" variant="outline" onclick={() => (newSessionOpen = true)}><PlusIcon data-icon="inline-start" />New session</Button>
		{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if !online}
			<p class="text-sm text-muted-foreground">The machine is offline; sessions show when it reconnects.</p>
		{:else if !herdr.supported}
			<p class="text-sm text-muted-foreground">
				This machine's runner doesn't report Herdr yet. Update it by running the install command again without a token.
			</p>
		{:else if herdr.sessions.length === 0}
			<p class="text-sm text-muted-foreground">
				{machine.host?.herdrVersion ? 'No Herdr sessions on this machine yet.' : "Herdr isn't installed on this machine."}
			</p>
		{:else}
			{#each herdr.sessions as session (session.name)}
				<section class="flex flex-col gap-2 rounded-lg border p-3">
					<header class="flex flex-wrap items-center gap-2">
						<h3 class="font-medium"><a href="/machines/{machine.id}/sessions/{encodeURIComponent(session.name)}" class="hover:underline">{session.name}</a></h3>
						<Badge variant={session.state === 'running' ? 'secondary' : 'outline'}>
							{session.state === 'running' ? 'Running' : 'Stopped'}
						</Badge>
						{#if session.state === 'running'}
							<span class="text-xs text-muted-foreground">
								{session.workspaces.length}
								{session.workspaces.length === 1 ? 'workspace' : 'workspaces'}
							</span>
							<Button size="sm" class="ms-auto" href={workspaceHref(machine.id, session.name)}>Open</Button>
						{/if}
					</header>
					{#each session.workspaces as ws (ws.id)}
						<div class="flex flex-col gap-1 border-l-2 pl-3">
							<div class="text-sm font-medium">
								{ws.label}
								<span class="font-normal text-muted-foreground">· {ws.paneCount} {ws.paneCount === 1 ? 'pane' : 'panes'}</span>
							</div>
							{#each ws.agents as agent (agent.paneId)}
								<div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
									<StatusBadge status={agent.status} />
									<span class="font-medium">{agent.name}</span>
									<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={agent.cwd ?? undefined}>
										{agent.cwd ?? ''}
									</span>
									{#if agent.run}
										<Badge variant="secondary" title="{agent.run.adopted ? 'Adopted' : 'Started'} in HuntHub {new Date(agent.run.at).toLocaleString()}">
											{agent.run.adopted ? 'adopted' : 'started'} by {agent.run.by ?? 'someone'}
										</Badge>
									{:else}
										<Badge variant="outline" title="Started outside HuntHub (by hand, Hermes, …)">external</Badge>
									{/if}
									<Button size="icon-sm" variant="ghost" aria-label="Peek at {agent.name}'s output" onclick={() => (peek = agent)}>
										<EyeIcon />
									</Button>
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">No agents</p>
							{/each}
						</div>
					{/each}
				</section>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>

<PeekDialog bind:agent={peek} />
<FormDialog
	bind:open={newSessionOpen}
	title="New session"
	description="Starts a new Herdr session on this machine."
	fields={[{ name: 'name', label: 'Name', placeholder: 'acme-recon', required: true, description: "Letters, numbers, '.', '_' and '-'." }]}
	submitLabel="Start session"
	onSubmit={createSession}
/>
