<script lang="ts" module>
	export type ChartSeries = {
		key: string;
		label: string;
		/** CSS color, e.g. var(--series-1). */
		color: string;
		/** Optional key of a peak value drawn as a light band above the line. */
		maxKey?: string;
	};
	export type ChartPoint = { t: number } & Record<string, number | null>;
</script>

<script lang="ts">
	let {
		title,
		points,
		series,
		formatValue,
		yMax,
		stepMs,
		height = 160
	}: {
		title: string;
		points: ChartPoint[];
		series: ChartSeries[];
		formatValue: (v: number) => string;
		/** Fixed top of the y axis (e.g. 100 for %); otherwise fits the data. */
		yMax?: number;
		/** Expected spacing between points; larger gaps break the line. */
		stepMs: number;
		height?: number;
	} = $props();

	const pad = { top: 8, right: 8, bottom: 20, left: 56 };
	let width = $state(0);
	let hover = $state<number | null>(null);

	const plotW = $derived(Math.max(0, width - pad.left - pad.right));
	const plotH = $derived(height - pad.top - pad.bottom);

	const t0 = $derived(points[0]?.t ?? 0);
	const t1 = $derived(points.at(-1)?.t ?? 1);
	const top = $derived.by(() => {
		if (yMax !== undefined) return yMax;
		let m = 0;
		for (const p of points) for (const s of series) m = Math.max(m, p[s.maxKey ?? s.key] ?? 0, p[s.key] ?? 0);
		return m > 0 ? m * 1.1 : 1;
	});

	const x = (t: number) => pad.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
	const y = (v: number) => pad.top + plotH - (Math.min(v, top) / top) * plotH;

	/** Splits points into runs without gaps, so missing data isn't drawn as a line. */
	function runs(key: string): ChartPoint[][] {
		const out: ChartPoint[][] = [];
		let run: ChartPoint[] = [];
		let prev: ChartPoint | null = null;
		for (const p of points) {
			if (p[key] === null || p[key] === undefined) continue;
			if (prev && p.t - prev.t > stepMs * 2.5) {
				out.push(run);
				run = [];
			}
			run.push(p);
			prev = p;
		}
		if (run.length) out.push(run);
		return out;
	}

	function linePath(run: ChartPoint[], key: string) {
		return run.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]!).toFixed(1)}`).join('');
	}

	function bandPath(run: ChartPoint[], lowKey: string, highKey: string) {
		const upper = run.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[highKey] ?? p[lowKey]!).toFixed(1)}`);
		const lower = [...run].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p[lowKey]!).toFixed(1)}`);
		return upper.join('') + lower.join('') + 'Z';
	}

	const yTicks = $derived([0, top / 2, top]);
	const timeFmt = $derived(
		new Intl.DateTimeFormat(undefined, t1 - t0 > 2 * 86_400_000 ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' })
	);
	const tooltipFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const xTicks = $derived(points.length > 1 ? [t0, t0 + (t1 - t0) / 2, t1] : []);

	function onPointerMove(event: PointerEvent) {
		if (points.length === 0) return;
		const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
		const px = event.clientX - rect.left;
		let best = 0;
		let bestDist = Infinity;
		points.forEach((p, i) => {
			const d = Math.abs(x(p.t) - px);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		});
		hover = best;
	}

	const hovered = $derived(hover === null ? null : points[hover]);
</script>

<figure class="flex flex-col gap-2">
	<figcaption class="flex flex-wrap items-center justify-between gap-2 text-sm">
		<span class="font-medium">{title}</span>
		{#if series.length > 1}
			<span class="flex gap-3 text-xs text-muted-foreground">
				{#each series as s (s.key)}
					<span class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded-full" style:background={s.color}></span>{s.label}</span>
				{/each}
			</span>
		{/if}
	</figcaption>

	<div class="relative" bind:clientWidth={width}>
		{#if points.length === 0}
			<div class="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground" style:height="{height}px">
				No data for this range yet
			</div>
		{:else if width > 0}
			<svg
				{width}
				{height}
				role="img"
				aria-label="{title} over time"
				class="touch-none overflow-visible"
				onpointermove={onPointerMove}
				onpointerleave={() => (hover = null)}
			>
				{#each yTicks as tick (tick)}
					<line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} class="stroke-border" stroke-width="1" />
					<text x={pad.left - 8} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[10px] tabular-nums">
						{formatValue(tick)}
					</text>
				{/each}
				{#each xTicks as tick, i (i)}
					<text
						x={x(tick)}
						y={height - 4}
						text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
						class="fill-muted-foreground text-[10px]">{timeFmt.format(tick)}</text
					>
				{/each}

				{#each series as s (s.key)}
					{#each runs(s.key) as run, i (i)}
						{#if s.maxKey}
							<path d={bandPath(run, s.key, s.maxKey)} fill={s.color} fill-opacity="0.15" />
						{/if}
						<path d={linePath(run, s.key)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
					{/each}
				{/each}

				{#if hovered}
					<line x1={x(hovered.t)} x2={x(hovered.t)} y1={pad.top} y2={pad.top + plotH} class="stroke-muted-foreground/50" stroke-width="1" />
					{#each series as s (s.key)}
						{#if hovered[s.key] !== null}
							<circle cx={x(hovered.t)} cy={y(hovered[s.key]!)} r="4" fill={s.color} class="stroke-card" stroke-width="2" />
						{/if}
					{/each}
				{/if}
			</svg>

			{#if hovered}
				<div
					class="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
					style:left="{Math.min(Math.max(x(hovered.t) - 70, 0), width - 150)}px"
				>
					<div class="mb-1 text-muted-foreground">{tooltipFmt.format(hovered.t)}</div>
					{#each series as s (s.key)}
						<div class="flex items-center gap-2 tabular-nums">
							<span class="size-2 rounded-full" style:background={s.color}></span>
							<span class="text-muted-foreground">{s.label}</span>
							<span class="ml-auto font-medium">{hovered[s.key] === null ? '–' : formatValue(hovered[s.key]!)}</span>
						</div>
						{#if s.maxKey && hovered[s.maxKey] !== null}
							<div class="flex gap-2 pl-4 text-muted-foreground tabular-nums">
								<span>peak</span><span class="ml-auto">{formatValue(hovered[s.maxKey]!)}</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Text alternative for screen readers. -->
	<table class="sr-only">
		<caption>{title}</caption>
		<thead><tr><th>Time</th>{#each series as s (s.key)}<th>{s.label}</th>{/each}</tr></thead>
		<tbody>
			{#each points as p (p.t)}
				<tr><td>{tooltipFmt.format(p.t)}</td>{#each series as s (s.key)}<td>{p[s.key] === null ? '–' : formatValue(p[s.key]!)}</td>{/each}</tr>
			{/each}
		</tbody>
	</table>
</figure>
