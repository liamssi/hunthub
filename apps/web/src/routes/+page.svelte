<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	let { data } = $props();
</script>

<svelte:head><title>Home · HuntHub</title></svelte:head>

<h1 class="text-2xl font-semibold">Welcome, {data.user?.name}</h1>

<Card.Root class="mt-6 max-w-sm">
	<Card.Header>
		<Card.Title>System status</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-2 text-sm">
		{#each [['API', data.api], ['Database', data.db]] as [label, status] (label)}
			<div class="flex items-center justify-between">
				<span>{label}</span>
				<Badge variant={status === 'ok' ? 'secondary' : 'destructive'}>{status}</Badge>
			</div>
		{/each}
	</Card.Content>
</Card.Root>
