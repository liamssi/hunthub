<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import BotIcon from '@lucide/svelte/icons/bot';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import HouseIcon from '@lucide/svelte/icons/house';
	import ServerIcon from '@lucide/svelte/icons/server';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UsersIcon from '@lucide/svelte/icons/users';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import NavMain, { type NavSection } from './nav-main.svelte';
	import NavUser from './nav-user.svelte';

	let {
		user,
		ref = $bindable(null),
		collapsible = 'icon',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & { user: NonNullable<App.Locals['user']> } = $props();

	const sections = $derived<NavSection[]>([
		{
			label: 'Platform',
			items: [
				{ title: 'Home', url: '/', icon: HouseIcon },
				{ title: 'Machines', url: '/machines', icon: ServerIcon },
				{ title: 'Agents', url: '/agents', icon: BotIcon }
			]
		},
		...(user.role === 'admin'
			? [
					{
						label: 'Admin',
						items: [
							{ title: 'Users', url: '/admin/users', icon: UsersIcon },
							{ title: 'Settings', url: '/admin/settings', icon: SettingsIcon }
						]
					}
				]
			: [])
	]);
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" tooltipContent="HuntHub">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<CrosshairIcon class="size-4" />
							</div>
							<div class="grid flex-1 text-start text-sm leading-tight">
								<span class="truncate font-semibold">HuntHub</span>
								<span class="truncate text-xs text-muted-foreground">Bug bounty hunts</span>
							</div>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain {sections} />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
