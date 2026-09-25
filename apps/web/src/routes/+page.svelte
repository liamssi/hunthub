<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';

	let { data } = $props();
</script>

<h1 class="text-2xl font-semibold">Welcome, {data.user?.name}</h1>

<Card.Root class="mt-6 max-w-sm">
	<Card.Header>
		<Card.Title>System status</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-1 text-sm">
		<div>API: {data.api}</div>
		<div>Database: {data.health?.db ?? 'unknown'}</div>
	</Card.Content>
</Card.Root>
