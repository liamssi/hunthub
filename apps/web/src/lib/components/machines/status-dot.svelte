<script lang="ts">
	import type { Machine } from '@hunthub/shared/machines';

	let { machine }: { machine: Pick<Machine, 'status' | 'connection'> } = $props();

	const state = $derived(machine.status === 'disabled' ? 'disabled' : machine.connection);
	const label = $derived({ online: 'Online', offline: 'Offline', disabled: 'Disabled' }[state]);
</script>

<span class="inline-flex items-center gap-1.5 text-sm" title={label}>
	<span
		class={[
			'size-2 shrink-0 rounded-full',
			state === 'online' && 'bg-emerald-500',
			state === 'offline' && 'bg-muted-foreground/40',
			state === 'disabled' && 'bg-destructive'
		]}
	></span>
	<span class="sr-only sm:not-sr-only">{label}</span>
</span>
