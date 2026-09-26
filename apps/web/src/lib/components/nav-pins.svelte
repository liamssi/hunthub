<script lang="ts">
	// Pinned sessions and terminals, with their live status; a click opens them
	// in the workspace (a terminal pin jumps straight to its pane).
	import BotIcon from '@lucide/svelte/icons/bot';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { page } from '$app/state';
	import type { Pin } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import { findPane, fleet, machineById, needsYouCount, sessionOf, workspaceHref } from '$lib/fleet.svelte';
	import { pins, unpin } from '$lib/pins.svelte';
	import { cn } from '$lib/utils.js';

	const sidebar = useSidebar();

	function describe(p: Pin) {
		const machine = machineById(p.machineId);
		const session = sessionOf(p.machineId, p.session);
		const online = machine?.connection === 'online';
		const where = `${p.session} · ${machine?.name ?? 'unknown machine'}`;
		if (!p.paneId) {
			return {
				title: p.session,
				where: machine?.name ?? 'unknown machine',
				gone: !online || !session,
				stopped: session?.state === 'stopped',
				needsYou: session ? needsYouCount(session) : 0,
				agent: null
			};
		}
		const at = findPane(session, p.paneId);
		return {
			title: at?.pane.agent?.name ?? p.label,
			where,
			gone: !online || !at,
			stopped: false,
			needsYou: at?.pane.agent?.status === 'blocked' ? 1 : 0,
			agent: at?.pane.agent ?? null
		};
	}

	const current = (p: Pin) =>
		page.url.pathname === '/workspace' &&
		page.url.searchParams.get('open') === `${p.machineId}:${p.session}` &&
		(page.url.searchParams.get('pane') ?? null) === (p.paneId ?? null);
</script>

{#if pins.list.length}
	<Sidebar.Group>
		<Sidebar.GroupLabel>Pinned</Sidebar.GroupLabel>
		<Sidebar.Menu>
			{#each pins.list as p (p.id)}
				{@const d = describe(p)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						isActive={current(p)}
						tooltipContent={d.gone ? `${d.title} (not available)` : `${d.title} · ${d.where}`}
						onclick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}
					>
						{#snippet child({ props })}
							<a href={workspaceHref(p.machineId, p.session, p.paneId)} {...props} class={cn(props.class as string, d.gone && 'opacity-50')}>
								{#if p.paneId}
									{#if d.agent}<BotIcon />{:else}<SquareTerminalIcon />{/if}
								{:else}
									<LayersIcon />
								{/if}
								<span class="flex min-w-0 flex-col leading-tight">
									<span class="truncate">{d.title}</span>
									<span class="truncate text-xs text-muted-foreground">{d.gone && fleet.loaded ? 'Not available' : d.where}</span>
								</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
					{#if d.agent && d.agent.status !== 'idle' && d.agent.status !== 'unknown'}
						<Sidebar.MenuBadge class="group-hover/menu-item:opacity-0"><StatusBadge status={d.agent.status} compact /></Sidebar.MenuBadge>
					{:else if d.needsYou}
						<Sidebar.MenuBadge class="text-destructive group-hover/menu-item:opacity-0" title="{d.needsYou} need you">{d.needsYou}</Sidebar.MenuBadge>
					{/if}
					<Sidebar.MenuAction showOnHover onclick={() => unpin(p.id)} title="Unpin">
						<PinOffIcon />
						<span class="sr-only">Unpin {d.title}</span>
					</Sidebar.MenuAction>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.Group>
{/if}
