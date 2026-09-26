<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import AppBreadcrumb from '$lib/components/app-breadcrumb.svelte';
	import AppSidebar from '$lib/components/app-sidebar.svelte';

	import { page } from '$app/state';

	let { data, children } = $props();

	// The session workspace uses the whole window and brings its own top bar.
	const immersive = $derived(page.route.id?.endsWith('/sessions/[session]/terminal') ?? false);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher />
<Toaster richColors />

{#if data.user}
	<Sidebar.Provider open={data.sidebarOpen}>
		<AppSidebar user={data.user} />
		<Sidebar.Inset class={immersive ? 'h-svh overflow-hidden' : undefined}>
			{#if immersive}
				{@render children()}
			{:else}
			<header
				class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
			>
				<div class="flex items-center gap-2 px-4">
					<Sidebar.Trigger class="-ms-1" />
					<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
					<AppBreadcrumb />
				</div>
			</header>
			<main class="flex flex-1 flex-col gap-4 p-4 pt-0">
				{@render children()}
			</main>
			{/if}
		</Sidebar.Inset>
	</Sidebar.Provider>
{:else}
	{@render children()}
{/if}
