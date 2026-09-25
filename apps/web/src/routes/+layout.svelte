<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import UserMenu from '$lib/components/user-menu.svelte';

	let { data, children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /><title>HuntHub</title></svelte:head>
<ModeWatcher />
<Toaster richColors />

{#if data.user}
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
			<a href="/" class="font-semibold">HuntHub</a>
			<nav class="flex gap-4 text-sm text-muted-foreground">
				{#if data.user.role === 'admin'}
					<a href="/admin/users" class="hover:text-foreground">Users</a>
				{/if}
			</nav>
			<div class="ml-auto"><UserMenu user={data.user} /></div>
		</div>
	</header>
	<main class="mx-auto max-w-6xl px-4 py-8">
		{@render children()}
	</main>
{:else}
	{@render children()}
{/if}
