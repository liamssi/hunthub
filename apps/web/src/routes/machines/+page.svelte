<script lang="ts">
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import ServerIcon from '@lucide/svelte/icons/server';
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button/index.js';
	import MachineCard from '$lib/components/machines/machine-card.svelte';
	import type { Machine } from '@hunthub/shared/machines';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import AddMachineDialog from '$lib/components/machines/add-machine-dialog.svelte';
	import StatusDot from '$lib/components/machines/status-dot.svelte';
	import UsageBar from '$lib/components/machines/usage-bar.svelte';
	import { formatBytes, formatRelative } from '$lib/format';
	import { subscribeLive } from '$lib/live';
	import { applyLive, diskPercent, memPercent } from '$lib/machines';

	let { data } = $props();

	// Starts from the loaded data; live updates overwrite it.
	let machines = $derived<Machine[]>(data.machines);

	$effect(() =>
		subscribeLive('machines', (message) => {
			if (message.type === 'machine.updated' && !machines.some((m) => m.id === message.machine.id)) {
				machines = [message.machine, ...machines];
				return;
			}
			machines = machines.map((m) => applyLive(m, message)).filter((m): m is Machine => m !== null);
		})
	);

	// Re-render relative times every 30s.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	const isAdmin = $derived(page.data.user?.role === 'admin');

	// Card view is the default; the choice is remembered per browser.
	type View = 'cards' | 'list';
	const VIEW_KEY = 'hunthub.machines.view';
	function savedView(): View {
		if (!browser) return 'cards';
		try {
			return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
		} catch {
			return 'cards';
		}
	}
	let view = $state<View>(savedView());
	function setView(v: View) {
		view = v;
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			// Storage may be unavailable (private mode); the choice just won't persist.
		}
	}
</script>

<svelte:head><title>Machines · HuntHub</title></svelte:head>

<div class="flex items-center justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold">Machines</h1>
		<p class="text-sm text-muted-foreground">Computers running a HuntHub runner.</p>
	</div>
	<div class="flex items-center gap-2">
		{#if machines.length > 0}
			<div class="flex rounded-md border p-0.5" role="group" aria-label="View">
				<Button size="icon-sm" variant={view === 'cards' ? 'secondary' : 'ghost'} aria-pressed={view === 'cards'} aria-label="Card view" onclick={() => setView('cards')}><LayoutGridIcon /></Button>
				<Button size="icon-sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} aria-label="List view" onclick={() => setView('list')}><ListIcon /></Button>
			</div>
		{/if}
		{#if isAdmin}<AddMachineDialog />{/if}
	</div>
</div>

{#if machines.length === 0}
	<Empty.Root class="mt-6 border">
		<Empty.Header>
			<Empty.Media variant="icon"><ServerIcon /></Empty.Media>
			<Empty.Title>No machines yet</Empty.Title>
			<Empty.Description>
				{isAdmin ? 'Add a machine and run the install command on it.' : 'An admin can add machines.'}
			</Empty.Description>
		</Empty.Header>
		{#if isAdmin}<Empty.Content><AddMachineDialog /></Empty.Content>{/if}
	</Empty.Root>
{:else if view === 'cards'}
	<div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each machines as m (m.id)}<MachineCard machine={m} {now} />{/each}
	</div>
{:else}
	<div class="mt-6 rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Machine</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="hidden md:table-cell">CPU</Table.Head>
					<Table.Head class="hidden md:table-cell">Memory</Table.Head>
					<Table.Head class="hidden lg:table-cell">Disk</Table.Head>
					<Table.Head class="hidden sm:table-cell">Last seen</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each machines as m (m.id)}
					{@const online = m.connection === 'online' && m.status === 'active'}
					<Table.Row>
						<Table.Cell>
							<a href="/machines/{m.id}" class="font-medium hover:underline">{m.name}</a>
							<div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
								<span>{m.host?.hostname ?? '—'}</span>
								{#each m.tags as tag (tag)}<Badge variant="outline" class="px-1.5 py-0 text-[10px]">{tag}</Badge>{/each}
							</div>
						</Table.Cell>
						<Table.Cell><StatusDot machine={m} /></Table.Cell>
						<Table.Cell class="hidden md:table-cell">
							<UsageBar label="CPU" value={online ? (m.stats?.cpuPct ?? null) : null} />
						</Table.Cell>
						<Table.Cell class="hidden md:table-cell">
							<UsageBar
								label="RAM"
								value={online ? memPercent(m) : null}
								detail={m.stats ? `${formatBytes(m.stats.mem.used)} / ${formatBytes(m.stats.mem.total)}` : undefined}
							/>
						</Table.Cell>
						<Table.Cell class="hidden lg:table-cell">
							<UsageBar label="Disk" value={online ? diskPercent(m) : null} />
						</Table.Cell>
						<Table.Cell class="hidden text-sm text-muted-foreground sm:table-cell">
							{online ? 'now' : formatRelative(m.lastSeenAt, now)}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{/if}
