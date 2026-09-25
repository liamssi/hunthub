<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';

	const titles: Record<number, string> = {
		403: 'Not allowed',
		404: 'Page not found',
		503: 'Temporarily unavailable'
	};
	const title = $derived(titles[page.status] ?? 'Something went wrong');
</script>

<svelte:head><title>{title} · HuntHub</title></svelte:head>

<div class="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
	<p class="text-sm text-muted-foreground">Error {page.status}</p>
	<h1 class="text-2xl font-semibold">{title}</h1>
	{#if page.error?.message}
		<p class="max-w-md text-muted-foreground">{page.error.message}</p>
	{/if}
	<Button href="/" variant="outline" class="mt-2">Go home</Button>
</div>
