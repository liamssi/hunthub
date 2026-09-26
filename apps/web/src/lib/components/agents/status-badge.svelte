<script lang="ts" module>
	import type { AgentStatus } from '@hunthub/shared/machines';

	export const statusLabels: Record<AgentStatus, string> = {
		blocked: 'Needs you',
		working: 'Working',
		done: 'Done',
		idle: 'Idle',
		unknown: 'Unknown'
	};
</script>

<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge/index.js';

	/** `compact` shows only the icon (the label stays available as a tooltip and to screen readers). */
	let { status, compact = false }: { status: AgentStatus; compact?: boolean } = $props();

	const icons = {
		blocked: CircleAlertIcon,
		working: LoaderCircleIcon,
		done: CircleCheckIcon,
		idle: CircleDashedIcon,
		unknown: CircleHelpIcon
	};
	const Icon = $derived(icons[status]);
</script>

<!-- Status is shown with an icon and a label, never color alone. -->
{#if compact}
	<span class="inline-flex shrink-0" title={statusLabels[status]}>
		<Icon
			aria-hidden="true"
			class={[
				'size-3.5',
				status === 'blocked' && 'text-destructive',
				status === 'working' && 'animate-spin text-sky-600 dark:text-sky-400',
				status === 'done' && 'text-emerald-600 dark:text-emerald-400',
				(status === 'idle' || status === 'unknown') && 'text-muted-foreground'
			]}
		/>
		<span class="sr-only">{statusLabels[status]}</span>
	</span>
{:else}
<Badge variant={status === 'blocked' ? 'destructive' : 'outline'} class="gap-1">
	<Icon
		class={[
			status === 'working' && 'animate-spin text-sky-600 dark:text-sky-400',
			status === 'done' && 'text-emerald-600 dark:text-emerald-400',
			(status === 'idle' || status === 'unknown') && 'text-muted-foreground'
		]}
	/>
	{statusLabels[status]}
</Badge>
{/if}
