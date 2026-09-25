<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { page } from '$app/state';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import UserMenu from '$lib/components/user-menu.svelte';

	let { data, children } = $props();

	const navLinks = $derived(data.user?.role === 'admin' ? [{ href: '/admin/users', label: 'Users' }] : []);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher />
<Toaster richColors />

{#if data.user}
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
			<a href="/" class="font-semibold">HuntHub</a>
			<nav class="flex gap-4 text-sm">
				{#each navLinks as link (link.href)}
					{@const current = page.url.pathname.startsWith(link.href)}
					<a
						href={link.href}
						aria-current={current ? 'page' : undefined}
						class={current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}>{link.label}</a
					>
				{/each}
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
