<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import type { Machine } from '@hunthub/shared/machines';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import MachineActions from '$lib/components/machines/machine-actions.svelte';
	import StatsCharts from '$lib/components/machines/stats-charts.svelte';
	import StatusDot from '$lib/components/machines/status-dot.svelte';
	import UsageBar from '$lib/components/machines/usage-bar.svelte';
	import { formatBytes, formatRate, formatRelative } from '$lib/format';
	import { subscribeLive } from '$lib/live';
	import { applyLive, memPercent } from '$lib/machines';

	let { data } = $props();

	// Starts from the loaded data; live updates overwrite it.
	let machine = $derived<Machine>(data.machine);

	$effect(() =>
		subscribeLive(`machine:${data.machine.id}`, (message) => {
			const next = applyLive(machine, message);
			if (next) machine = next;
			else goto('/machines');
		})
	);

	const online = $derived(machine.connection === 'online' && machine.status === 'active');
	const stats = $derived(online ? machine.stats : null);
	const isAdmin = $derived(page.data.user?.role === 'admin');
</script>

<svelte:head><title>{machine.name} · Machines · HuntHub</title></svelte:head>

<div class="flex flex-wrap items-start justify-between gap-4">
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">{machine.name}</h1>
			<StatusDot {machine} />
		</div>
		<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			<span>{machine.host?.hostname ?? 'Not connected yet'}</span>
			{#each machine.tags as tag (tag)}<Badge variant="outline">{tag}</Badge>{/each}
			{#if !online}<span>· last seen {formatRelative(machine.lastSeenAt)}</span>{/if}
		</div>
	</div>
	{#if isAdmin}<MachineActions {machine} />{/if}
</div>

<div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	<Card.Root>
		<Card.Header><Card.Description>CPU</Card.Description><Card.Title class="text-2xl tabular-nums">{stats ? `${Math.round(stats.cpuPct)}%` : '–'}</Card.Title></Card.Header>
		<Card.Content><UsageBar label="{machine.host?.cpuCores ?? '?'} cores" value={stats?.cpuPct ?? null} /></Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header>
			<Card.Description>Memory</Card.Description>
			<Card.Title class="text-2xl tabular-nums">{stats ? formatBytes(stats.mem.used) : '–'}</Card.Title>
		</Card.Header>
		<Card.Content><UsageBar label="of {stats ? formatBytes(stats.mem.total) : '?'}" value={stats ? memPercent(machine) : null} /></Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header><Card.Description>Network</Card.Description></Card.Header>
		<Card.Content class="flex flex-col gap-1 text-sm tabular-nums">
			<span class="flex items-center gap-2"><ArrowDownIcon class="size-4 text-muted-foreground" />{stats ? formatRate(stats.net.rxBps) : '–'}</span>
			<span class="flex items-center gap-2"><ArrowUpIcon class="size-4 text-muted-foreground" />{stats ? formatRate(stats.net.txBps) : '–'}</span>
		</Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header><Card.Description>Disks</Card.Description></Card.Header>
		<Card.Content class="flex flex-col gap-2">
			{#each stats?.disks ?? [] as d (d.mount)}
				<UsageBar label={d.mount} value={d.total ? (d.used / d.total) * 100 : 0} detail="{formatBytes(d.used)} / {formatBytes(d.total)}" />
			{:else}
				<span class="text-sm text-muted-foreground">–</span>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

<StatsCharts machineId={machine.id} initial={data.series} />

<Card.Root class="mt-6">
	<Card.Header><Card.Title>System</Card.Title></Card.Header>
	<Card.Content>
		<dl class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
			{#each [
				['Operating system', machine.host?.os],
				['Kernel', machine.host?.kernel],
				['Architecture', machine.host?.arch],
				['CPU', machine.host ? `${machine.host.cpuModel} (${machine.host.cpuCores} cores)` : null],
				['Memory', machine.host ? formatBytes(machine.host.memTotal) : null],
				['Private IPs', machine.host?.privateIps.join(', ') || null],
				['Public IP', machine.publicIp],
				['Herdr', machine.host?.herdrVersion ?? 'not installed'],
				['Runner', machine.runnerVersion],
				['Added', new Date(machine.createdAt).toLocaleDateString()]
			] as [label, value] (label)}
				<div class="flex min-w-0 justify-between gap-4 border-b py-1.5 sm:block sm:border-0 sm:py-0">
					<dt class="shrink-0 text-muted-foreground">{label}</dt>
					<dd class="min-w-0 truncate text-right sm:text-left" title={value ?? undefined}>{value ?? '–'}</dd>
				</div>
			{/each}
		</dl>
	</Card.Content>
</Card.Root>
