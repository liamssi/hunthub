<script lang="ts">
	// The inbox entry in the sidebar: how many agents need you now, plus
	// unread events; opens the inbox panel.
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { attention, openInbox, unreadCount } from '$lib/attention.svelte';
	import { fleet } from '$lib/fleet.svelte';

	const needing = $derived(
		Object.values(fleet.herdr).reduce((n, h) => n + h.sessions.reduce((m, s) => m + s.workspaces.reduce((k, w) => k + w.agents.filter((a) => a.status === 'blocked').length, 0), 0), 0)
	);
	const unread = $derived(unreadCount());
</script>

<Sidebar.Group class="pb-0">
	<Sidebar.Menu>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton tooltipContent={needing ? `Inbox: ${needing} need you` : 'Inbox'} isActive={attention.open} onclick={openInbox}>
				<InboxIcon />
				<span>Inbox</span>
			</Sidebar.MenuButton>
			{#if needing}
				<Sidebar.MenuBadge class="bg-destructive text-white" title="{needing} need you">{needing}</Sidebar.MenuBadge>
			{:else if unread}
				<Sidebar.MenuBadge title="{unread} new">{unread}</Sidebar.MenuBadge>
			{/if}
		</Sidebar.MenuItem>
	</Sidebar.Menu>
</Sidebar.Group>
