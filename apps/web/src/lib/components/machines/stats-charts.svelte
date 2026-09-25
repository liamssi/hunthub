<script lang="ts">
	import type { StatsRange, StatsSeries } from '@hunthub/shared/machines';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatBytes, formatRate } from '$lib/format';
	import TimeChart, { type ChartPoint } from './time-chart.svelte';

	let { machineId, initial }: { machineId: string; initial: StatsSeries | null } = $props();

	const ranges: { value: StatsRange; label: string; stepMs: number }[] = [
		{ value: '1h', label: '1h', stepMs: 60_000 },
		{ value: '24h', label: '24h', stepMs: 5 * 60_000 },
		{ value: '7d', label: '7d', stepMs: 30 * 60_000 },
		{ value: '30d', label: '30d', stepMs: 2 * 3_600_000 },
		{ value: '1y', label: '1y', stepMs: 86_400_000 }
	];

	let range = $state<StatsRange>('1h');
	let series = $derived<StatsSeries | null>(initial);
	let loading = $state(false);

	async function load(r: StatsRange) {
		loading = true;
		const res = await fetch(`/api/machines/${machineId}/stats?range=${r}`);
		loading = false;
		if (res.ok && r === range) series = await res.json();
	}

	function select(r: StatsRange) {
		range = r;
		void load(r);
	}

	// Minute data only changes once a minute.
	$effect(() => {
		const r = range;
		const t = setInterval(() => load(r), 60_000);
		return () => clearInterval(t);
	});

	const stepMs = $derived(ranges.find((r) => r.value === range)!.stepMs);
	const points = $derived<ChartPoint[]>(
		(series?.points ?? []).map((p) => ({
			t: new Date(p.t).getTime(),
			cpu: p.cpuAvg,
			cpuMax: p.cpuMax,
			mem: p.memAvg,
			memMax: p.memMax,
			rx: p.rxBps,
			tx: p.txBps
		}))
	);
	const memTotal = $derived(Math.max(0, ...(series?.points ?? []).map((p) => p.memTotal)));
</script>

<Card.Root class="mt-6">
	<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
		<div>
			<Card.Title>History</Card.Title>
			<Card.Description>Averages, with peaks shown as the lighter band.</Card.Description>
		</div>
		<div class="flex gap-1" role="group" aria-label="Time range">
			{#each ranges as r (r.value)}
				<Button
					size="sm"
					variant={range === r.value ? 'secondary' : 'ghost'}
					aria-pressed={range === r.value}
					disabled={loading && range === r.value}
					onclick={() => select(r.value)}>{r.label}</Button
				>
			{/each}
		</div>
	</Card.Header>
	<Card.Content class="grid gap-8 lg:grid-cols-3">
		<TimeChart
			title="CPU"
			{points}
			{stepMs}
			yMax={100}
			formatValue={(v) => `${Math.round(v)}%`}
			series={[{ key: 'cpu', label: 'CPU', color: 'var(--series-1)', maxKey: 'cpuMax' }]}
		/>
		<TimeChart
			title="Memory"
			{points}
			{stepMs}
			yMax={memTotal || undefined}
			formatValue={(v) => formatBytes(v, 0)}
			series={[{ key: 'mem', label: 'Memory', color: 'var(--series-1)', maxKey: 'memMax' }]}
		/>
		<TimeChart
			title="Network"
			{points}
			{stepMs}
			formatValue={(v) => formatRate(v)}
			series={[
				{ key: 'rx', label: 'Download', color: 'var(--series-1)' },
				{ key: 'tx', label: 'Upload', color: 'var(--series-2)' }
			]}
		/>
	</Card.Content>
</Card.Root>
