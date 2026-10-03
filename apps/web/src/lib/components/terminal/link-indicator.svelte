<script lang="ts">
	// How good the link to HuntHub is (round trip of the live channel), and what
	// terminals do about it. Quiet while the link is good; says so when it's slow.
	import SignalHighIcon from '@lucide/svelte/icons/signal-high';
	import SignalLowIcon from '@lucide/svelte/icons/signal-low';
	import SignalMediumIcon from '@lucide/svelte/icons/signal-medium';
	import SignalZeroIcon from '@lucide/svelte/icons/signal-zero';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { framesPerSecond, link } from '$lib/link-quality.svelte';
	import { cn } from '$lib/utils.js';

	const label = $derived(
		{ unknown: 'Measuring the connection…', good: 'Good connection', fair: 'Slower connection', poor: 'Slow connection', offline: 'Reconnecting…' }[link.level]
	);
	const detail = $derived.by(() => {
		if (link.level === 'offline') return 'Lost the connection to HuntHub; trying again.';
		if (link.rtt === null) return 'Round trip not measured yet.';
		const fps = framesPerSecond(link.level);
		return fps < 30 ? `${link.rtt} ms round trip. Terminals update ${fps} times a second (30 on a good connection); typing still goes first.` : `${link.rtt} ms round trip.`;
	});
	const Icon = $derived({ unknown: SignalHighIcon, good: SignalHighIcon, fair: SignalMediumIcon, poor: SignalLowIcon, offline: SignalZeroIcon }[link.level]);
	const slow = $derived(link.level === 'poor' || link.level === 'offline');
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<span
				{...props}
				role="status"
				aria-label="{label}. {detail}"
				class={cn(
					'flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground',
					link.level === 'unknown' && 'opacity-50',
					slow && 'text-destructive'
				)}
			>
				<Icon class="size-4" aria-hidden="true" />
				{#if link.level === 'poor' || link.level === 'fair'}<span class="hidden tabular-nums sm:inline">{link.rtt} ms</span>{/if}
				{#if link.level === 'offline'}<span class="hidden sm:inline">Offline</span>{/if}
			</span>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="bottom" class="max-w-64">
		<p class="font-medium">{label}</p>
		<p class="text-xs opacity-80">{detail}</p>
	</Tooltip.Content>
</Tooltip.Root>
