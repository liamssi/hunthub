<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import type { AgentStatus, AgentView } from '@hunthub/shared/machines';
	import PeekDialog from '$lib/components/agents/peek-dialog.svelte';
	import StatusBadge, { statusLabels } from '$lib/components/agents/status-badge.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { subscribeLive } from '$lib/live';

	let { data } = $props();

	// Start from the loaded data; live updates replace a machine's agents.
	let agents = $derived<AgentView[]>(data.agents);

	const order: Record<AgentStatus, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };
	const sortAgents = (list: AgentView[]) =>
		[...list].sort(
			(a, b) =>
				order[a.status] - order[b.status] ||
				a.machineName.localeCompare(b.machineName) ||
				a.session.localeCompare(b.session) ||
				a.paneId.localeCompare(b.paneId)
		);

	$effect(() =>
		subscribeLive('agents', (message) => {
			if (message.type !== 'machine.herdr') return;
			const fresh = message.herdr.sessions.flatMap((s) => s.workspaces.flatMap((w) => w.agents));
			agents = sortAgents([...agents.filter((a) => a.machineId !== message.machineId), ...fresh]);
		})
	);

	type Filter = 'all' | 'attention' | 'working' | 'quiet';
	const filters: { value: Filter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'attention', label: 'Needs you' },
		{ value: 'working', label: 'Working' },
		{ value: 'quiet', label: 'Idle / done' }
	];
	let filter = $state<Filter>('all');
	let machineFilter = $state('all');

	const machines = $derived([...new Map(agents.map((a) => [a.machineId, a.machineName])).entries()].sort((a, b) => a[1].localeCompare(b[1])));
	const counts = $derived({
		attention: agents.filter((a) => a.status === 'blocked').length,
		working: agents.filter((a) => a.status === 'working').length
	});
	const visible = $derived(
		agents.filter(
			(a) =>
				(machineFilter === 'all' || a.machineId === machineFilter) &&
				(filter === 'all' ||
					(filter === 'attention' && a.status === 'blocked') ||
					(filter === 'working' && a.status === 'working') ||
					(filter === 'quiet' && (a.status === 'idle' || a.status === 'done' || a.status === 'unknown')))
		)
	);
	const machineLabel = $derived(machineFilter === 'all' ? 'All machines' : (machines.find(([id]) => id === machineFilter)?.[1] ?? 'All machines'));

	let peek = $state<AgentView | null>(null);
</script>

<svelte:head><title>Agents · HuntHub</title></svelte:head>

<div>
	<h1 class="text-2xl font-semibold">Agents</h1>
	<p class="text-sm text-muted-foreground">
		{agents.length} {agents.length === 1 ? 'agent' : 'agents'} across your machines
		{#if counts.attention}· <span class="font-medium text-foreground">{counts.attention} need you</span>{/if}
		{#if counts.working}· {counts.working} working{/if}
	</p>
</div>

{#if agents.length === 0}
	<Empty.Root class="mt-6 border">
		<Empty.Header>
			<Empty.Media variant="icon"><BotIcon /></Empty.Media>
			<Empty.Title>No agents running</Empty.Title>
			<Empty.Description>Agents started in Herdr on your machines show up here live.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{:else}
	<div class="mt-6 flex flex-wrap items-center gap-2">
		<div class="flex flex-wrap gap-1" role="group" aria-label="Status filter">
			{#each filters as f (f.value)}
				<Button size="sm" variant={filter === f.value ? 'secondary' : 'ghost'} aria-pressed={filter === f.value} onclick={() => (filter = f.value)}>
					{f.label}
				</Button>
			{/each}
		</div>
		{#if machines.length > 1}
			<Select.Root type="single" bind:value={machineFilter}>
				<Select.Trigger size="sm" class="w-44" aria-label="Machine filter">{machineLabel}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Item value="all" label="All machines" />
						{#each machines as [id, name] (id)}<Select.Item value={id} label={name} />{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		{/if}
	</div>

	<div class="mt-4 rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Status</Table.Head>
					<Table.Head>Agent</Table.Head>
					<Table.Head class="hidden md:table-cell">Where</Table.Head>
					<Table.Head class="hidden lg:table-cell">Folder</Table.Head>
					<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each visible as a (`${a.machineId}/${a.session}/${a.paneId}`)}
					<Table.Row>
						<Table.Cell><StatusBadge status={a.status} /></Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-2">
								<span class="font-medium">{a.name}</span>
								<Badge variant="outline" title="Started outside HuntHub">external</Badge>
							</div>
							<div class="text-xs text-muted-foreground md:hidden">{a.machineName} / {a.session}</div>
						</Table.Cell>
						<Table.Cell class="hidden md:table-cell">
							<a href="/machines/{a.machineId}" class="hover:underline">{a.machineName}</a>
							<span class="text-muted-foreground"> / {a.session} / {a.workspaceLabel}</span>
						</Table.Cell>
						<Table.Cell class="hidden max-w-64 truncate font-mono text-xs text-muted-foreground lg:table-cell" title={a.cwd ?? undefined}>
							{a.cwd ?? '–'}
						</Table.Cell>
						<Table.Cell>
							<Button size="icon-sm" variant="ghost" aria-label="Peek at {a.name}'s output" onclick={() => (peek = a)}><EyeIcon /></Button>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="text-muted-foreground">
							No agents {filter === 'all' ? '' : `with status “${filters.find((f) => f.value === filter)?.label}”`} here.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{/if}

<PeekDialog bind:agent={peek} />
