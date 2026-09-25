<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import type { Machine } from '@hunthub/shared/machines';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatBytes, formatRate, formatRelative } from '$lib/format';
	import { diskPercent, memPercent } from '$lib/machines';
	import StatusDot from './status-dot.svelte';
	import UsageBar from './usage-bar.svelte';

	let { machine, now }: { machine: Machine; now: number } = $props();

	const online = $derived(machine.connection === 'online' && machine.status === 'active');
	const stats = $derived(online ? machine.stats : null);
</script>

<a href="/machines/{machine.id}" class="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
	<Card.Root class="h-full transition-colors hover:bg-accent/40">
		<Card.Header>
			<Card.Title class="flex items-center justify-between gap-2">
				<span class="truncate">{machine.name}</span>
				<StatusDot {machine} />
			</Card.Title>
			<Card.Description class="truncate">
				{machine.host ? `${machine.host.hostname} · ${machine.host.os}` : 'Not connected yet'}
			</Card.Description>
			{#if machine.tags.length}
				<div class="flex flex-wrap gap-1 pt-1">
					{#each machine.tags as tag (tag)}<Badge variant="outline">{tag}</Badge>{/each}
				</div>
			{/if}
		</Card.Header>
		<Card.Content class="flex flex-col gap-3">
			<UsageBar label="CPU" value={stats?.cpuPct ?? null} />
			<UsageBar
				label="Memory"
				value={stats ? memPercent(machine) : null}
				detail={stats ? `${formatBytes(stats.mem.used)} / ${formatBytes(stats.mem.total)}` : undefined}
			/>
			<UsageBar label="Disk" value={stats ? diskPercent(machine) : null} />
		</Card.Content>
		<Card.Footer class="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
			{#if stats}
				<span class="flex items-center gap-1"><ArrowDownIcon class="size-3" />{formatRate(stats.net.rxBps)}</span>
				<span class="flex items-center gap-1"><ArrowUpIcon class="size-3" />{formatRate(stats.net.txBps)}</span>
			{:else}
				<span>Last seen {formatRelative(machine.lastSeenAt, now)}</span>
			{/if}
		</Card.Footer>
	</Card.Root>
</a>
