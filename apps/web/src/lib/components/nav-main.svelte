<script lang="ts" module>
	import type { Component } from 'svelte';

	export type NavItem = { title: string; url: string; icon: Component };
	export type NavSection = { label: string; items: NavItem[] };
</script>

<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';

	let { sections }: { sections: NavSection[] } = $props();

	const sidebar = useSidebar();

	function isActive(url: string) {
		return url === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(url);
	}
</script>

{#each sections as section (section.label)}
	<Sidebar.Group>
		<Sidebar.GroupLabel>{section.label}</Sidebar.GroupLabel>
		<Sidebar.Menu>
			{#each section.items as item (item.url)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						isActive={isActive(item.url)}
						tooltipContent={item.title}
						onclick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}
					>
						{#snippet child({ props })}
							<a
								href={item.url}
								aria-current={isActive(item.url) ? 'page' : undefined}
								{...props}
							>
								<item.icon />
								<span>{item.title}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.Group>
{/each}
