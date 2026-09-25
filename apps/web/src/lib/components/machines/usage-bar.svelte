<script lang="ts">
	import { Progress } from '$lib/components/ui/progress/index.js';

	let { label, value, detail }: { label: string; value: number | null; detail?: string } = $props();
</script>

<div class="flex min-w-24 flex-col gap-1" title={detail}>
	<div class="flex justify-between text-xs text-muted-foreground">
		<span>{label}</span>
		<span class="tabular-nums">{value === null ? '–' : `${Math.round(value)}%`}</span>
	</div>
	<Progress value={value ?? 0} max={100} class="h-1.5" aria-label="{label} usage" />
</div>
