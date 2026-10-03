<script lang="ts">
	// The programs you can hunt on (from your HackerOne account), kept up to date
	// with their scope and policy, and what changed on them.
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import LockIcon from '@lucide/svelte/icons/lock';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TargetIcon from '@lucide/svelte/icons/target';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { PlatformAccountView, ProgramEvent, ProgramSummary } from '@hunthub/shared/programs';
	import ConnectHackeroneDialog from '$lib/components/programs/connect-hackerone-dialog.svelte';
	import ProgramChanges from '$lib/components/programs/program-changes.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { formatRelative } from '$lib/format';
	import { assetTypeLabel } from '$lib/programs';

	let { data } = $props();

	let account = $derived<PlatformAccountView | null>(data.account);
	const programs = $derived<ProgramSummary[]>(data.programs);
	let connectOpen = $state(false);
	let disconnectOpen = $state(false);

	// Re-render relative times every 30s.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	// While a sync runs, follow its progress; reload the programs as it goes and when it ends.
	$effect(() => {
		if (!account?.sync) return;
		let lastScopes = account.sync.scopesDone;
		const t = setInterval(async () => {
			const res = await fetch('/api/platform-accounts').catch(() => null);
			if (!res?.ok) return;
			const { accounts }: { accounts: PlatformAccountView[] } = await res.json();
			const next = accounts.find((a) => a.platform === 'hackerone') ?? null;
			const done = !next?.sync;
			// Programs appear after the list is fetched; scope counts fill in every so often.
			if (done || (next?.sync && next.sync.scopesDone - lastScopes >= 25) || (next?.sync?.phase === 'scopes' && programs.length === 0)) {
				lastScopes = next?.sync?.scopesDone ?? 0;
				await invalidate('app:programs');
			}
			account = next;
		}, 1500);
		return () => clearInterval(t);
	});

	async function refresh() {
		const res = await fetch('/api/platform-accounts/hackerone/sync', { method: 'POST' }).catch(() => null);
		if (!res?.ok) return toast.error("Couldn't start the refresh.");
		account = (await res.json()).account;
	}

	async function disconnect() {
		const res = await fetch('/api/platform-accounts/hackerone', { method: 'DELETE' }).catch(() => null);
		disconnectOpen = false;
		if (!res?.ok) return toast.error("Couldn't disconnect HackerOne.");
		toast.success('HackerOne disconnected');
		await invalidate('app:programs');
	}

	// --- Views: the program list, or recent changes --------------------------------

	type Tab = 'programs' | 'changes';
	const tab = $derived<Tab>(page.url.searchParams.get('tab') === 'changes' ? 'changes' : 'programs');
	function setTab(t: string) {
		if (t !== 'programs' && t !== 'changes') return;
		const url = new URL(page.url);
		if (t === 'changes') url.searchParams.set('tab', 'changes');
		else url.searchParams.delete('tab');
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let changes = $state<ProgramEvent[] | null>(null);
	let moreChanges = $state(true);
	let loadingChanges = $state(false);
	async function loadChanges(more = false) {
		loadingChanges = true;
		const before = more && changes?.length ? `&before=${changes.at(-1)!.id}` : '';
		const res = await fetch(`/api/programs/changes?limit=100${before}`).catch(() => null);
		loadingChanges = false;
		if (!res?.ok) return toast.error("Couldn't load the changes.");
		const { events }: { events: ProgramEvent[] } = await res.json();
		changes = more ? [...(changes ?? []), ...events] : events;
		moreChanges = events.length === 100;
	}
	$effect(() => {
		if (tab === 'changes' && changes === null && !loadingChanges) void loadChanges();
	});

	// --- Search and filters ----------------------------------------------------------

	let query = $state('');
	let rewards = $state<'all' | 'bounty' | 'vdp'>('all');
	let visibility = $state<'any' | 'public' | 'private'>('any');
	let assetType = $state('any');
	let sort = $state<'name' | 'scope' | 'changed' | 'mine'>('name');

	const assetTypes = $derived([...new Set(programs.flatMap((p) => p.assetTypes))].sort((a, b) => assetTypeLabel(a).localeCompare(assetTypeLabel(b))));
	const visibilityLabels = { any: 'Public and private', public: 'Public', private: 'Private' };
	const sortLabels = { name: 'Name', scope: 'Most assets in scope', changed: 'Recently changed', mine: 'My reports' };

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = programs.filter(
			(p) =>
				(!q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q)) &&
				(rewards === 'all' || (rewards === 'bounty') === p.offersBounties) &&
				(visibility === 'any' || (visibility === 'public') === p.public) &&
				(assetType === 'any' || p.assetTypes.includes(assetType))
		);
		const by = {
			name: (a: ProgramSummary, b: ProgramSummary) => a.name.localeCompare(b.name),
			scope: (a: ProgramSummary, b: ProgramSummary) => b.inScope - a.inScope || a.name.localeCompare(b.name),
			changed: (a: ProgramSummary, b: ProgramSummary) => (b.lastChangeAt ?? '').localeCompare(a.lastChangeAt ?? '') || a.name.localeCompare(b.name),
			mine: (a: ProgramSummary, b: ProgramSummary) => b.mine.reports - a.mine.reports || a.name.localeCompare(b.name)
		}[sort];
		return [...list].sort(by);
	});
	const filtering = $derived(query.trim() !== '' || rewards !== 'all' || visibility !== 'any' || assetType !== 'any');
	function clearFilters() {
		query = '';
		rewards = 'all';
		visibility = 'any';
		assetType = 'any';
	}

	// Long lists render a page at a time.
	const PAGE = 100;
	let shown = $state(PAGE);
	$effect(() => {
		void filtered;
		shown = PAGE;
	});

	const syncLabel = $derived.by(() => {
		const s = account?.sync;
		if (!s) return null;
		if (s.phase === 'programs') return 'Fetching your programs…';
		return `Fetching scopes · ${s.scopesDone} of ${s.scopesTotal}`;
	});
	const changedRecently = (p: ProgramSummary) => p.lastChangeAt !== null && now - new Date(p.lastChangeAt).getTime() < 7 * 24 * 3600 * 1000;
</script>

<svelte:head><title>Programs · HuntHub</title></svelte:head>

<div class="flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold">Programs</h1>
		<p class="text-sm text-muted-foreground">Bug bounty programs you can hunt on, with their scope and policy kept up to date.</p>
	</div>
	{#if account}
		<div class="flex items-center gap-2">
			<div class="flex flex-col items-end text-xs leading-tight">
				<span class="font-medium">HackerOne · {account.username}</span>
				<span class="text-muted-foreground">
					{#if account.sync}{syncLabel}{:else if account.lastSyncAt}Updated {formatRelative(account.lastSyncAt, now)}{:else}Not synced yet{/if}
				</span>
			</div>
			<Button size="sm" variant="outline" onclick={refresh} disabled={!!account.sync} title="Fetch your programs and every scope again">
				{#if account.sync}<Spinner data-icon="inline-start" />{:else}<RefreshCwIcon data-icon="inline-start" />{/if}Refresh
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} size="icon-sm" variant="ghost" aria-label="HackerOne account options"><EllipsisIcon /></Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Group>
						<DropdownMenu.Item onclick={() => (connectOpen = true)}>Update API token</DropdownMenu.Item>
						<DropdownMenu.Item variant="destructive" onclick={() => (disconnectOpen = true)}>Disconnect HackerOne</DropdownMenu.Item>
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	{/if}
</div>

{#if account?.sync && account.sync.phase === 'scopes' && account.sync.scopesTotal > 0}
	<Progress class="mt-4 h-1" value={account.sync.scopesDone} max={account.sync.scopesTotal} aria-label="Fetching scopes" />
{/if}

{#if account && account.status !== 'ok' && !account.sync}
	<Alert.Root variant="destructive" class="mt-4">
		<TriangleAlertIcon />
		<Alert.Title>{account.status === 'invalid' ? 'HackerOne no longer accepts your API token' : "The last update didn't finish"}</Alert.Title>
		<Alert.Description>
			<p>{account.lastError ?? 'Something went wrong.'}</p>
			<div class="mt-2 flex gap-2">
				{#if account.status === 'invalid'}
					<Button size="sm" onclick={() => (connectOpen = true)}>Update API token</Button>
				{:else}
					<Button size="sm" variant="outline" onclick={refresh}>Try again</Button>
				{/if}
			</div>
		</Alert.Description>
	</Alert.Root>
{/if}

{#if !account}
	<Empty.Root class="mt-10 border">
		<Empty.Header>
			<Empty.Media variant="icon"><TargetIcon /></Empty.Media>
			<Empty.Title>Connect your HackerOne account</Empty.Title>
			<Empty.Description>
				HuntHub lists the programs you can access, public and private, and keeps their scope and policy up to date, so you can see what changed before you hunt.
			</Empty.Description>
		</Empty.Header>
		<Empty.Content>
			<Button onclick={() => (connectOpen = true)}>Connect HackerOne</Button>
		</Empty.Content>
	</Empty.Root>
{:else}
	<div class="mt-6 flex flex-col gap-4">
		<ToggleGroup.Root type="single" variant="outline" size="sm" class="self-start" bind:value={() => tab, (v) => setTab(v)} aria-label="View">
			<ToggleGroup.Item value="programs">Programs{#if programs.length}<span class="ms-1 text-muted-foreground tabular-nums">{programs.length}</span>{/if}</ToggleGroup.Item>
			<ToggleGroup.Item value="changes">Changes</ToggleGroup.Item>
		</ToggleGroup.Root>

		{#if tab === 'changes'}
			{#if changes === null}
				<div class="flex flex-col gap-2">
					{#each { length: 4 } as _, i (i)}<Skeleton class="h-16 w-full" />{/each}
				</div>
			{:else if changes.length === 0}
				<Empty.Root class="border">
					<Empty.Header>
						<Empty.Media variant="icon"><SparklesIcon /></Empty.Media>
						<Empty.Title>No changes yet</Empty.Title>
						<Empty.Description>
							Changes show up here once a program's scope, policy or rewards differ from the last update. HuntHub checks every hour, and scopes every few hours.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				<ProgramChanges events={changes} showProgram />
				{#if moreChanges}
					<Button variant="outline" class="self-center" disabled={loadingChanges} onclick={() => loadChanges(true)}>
						{#if loadingChanges}<Spinner data-icon="inline-start" />{/if}Show older changes
					</Button>
				{/if}
			{/if}
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				<InputGroup.Root class="w-full sm:w-72">
					<InputGroup.Input bind:value={query} placeholder="Search programs" aria-label="Search programs" />
					<InputGroup.Addon><SearchIcon /></InputGroup.Addon>
				</InputGroup.Root>
				<ToggleGroup.Root type="single" variant="outline" size="sm" bind:value={() => rewards, (v) => v && (rewards = v as typeof rewards)} aria-label="Rewards">
					<ToggleGroup.Item value="all">All</ToggleGroup.Item>
					<ToggleGroup.Item value="bounty">Bounty</ToggleGroup.Item>
					<ToggleGroup.Item value="vdp">VDP</ToggleGroup.Item>
				</ToggleGroup.Root>
				<Select.Root type="single" bind:value={visibility}>
					<Select.Trigger size="sm" class="w-44" aria-label="Visibility">{visibilityLabels[visibility]}</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each Object.entries(visibilityLabels) as [value, label] (value)}<Select.Item {value} {label} />{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				<Select.Root type="single" bind:value={assetType}>
					<Select.Trigger size="sm" class="w-40" aria-label="Asset type">{assetType === 'any' ? 'Any asset type' : assetTypeLabel(assetType)}</Select.Trigger>
					<Select.Content>
						<Select.Group>
							<Select.Item value="any" label="Any asset type" />
							{#each assetTypes as t (t)}<Select.Item value={t} label={assetTypeLabel(t)} />{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				<Select.Root type="single" bind:value={sort}>
					<Select.Trigger size="sm" class="w-48 sm:ms-auto" aria-label="Sort by">Sort: {sortLabels[sort]}</Select.Trigger>
					<Select.Content align="end">
						<Select.Group>
							{#each Object.entries(sortLabels) as [value, label] (value)}<Select.Item {value} {label} />{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>

			{#if programs.length === 0}
				<div class="flex flex-col gap-2">
					{#if account.sync}
						{#each { length: 6 } as _, i (i)}<Skeleton class="h-12 w-full" />{/each}
					{:else}
						<p class="py-10 text-center text-sm text-muted-foreground">Your HackerOne account has no programs yet.</p>
					{/if}
				</div>
			{:else if filtered.length === 0}
				<div class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
					<p>No programs match these filters.</p>
					<Button size="sm" variant="outline" onclick={clearFilters}>Clear filters</Button>
				</div>
			{:else}
				<p class="text-xs text-muted-foreground" aria-live="polite">
					{filtering ? `${filtered.length} of ${programs.length} programs` : `${programs.length} programs`}
				</p>
				<div class="rounded-lg border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Program</Table.Head>
								<Table.Head>Rewards</Table.Head>
								<Table.Head class="text-end">In scope</Table.Head>
								<Table.Head class="hidden md:table-cell">Asset types</Table.Head>
								<Table.Head class="hidden lg:table-cell">Last change</Table.Head>
								<Table.Head class="hidden text-end sm:table-cell">My reports</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each filtered.slice(0, shown) as p (p.id)}
								<Table.Row class="cursor-pointer" onclick={() => goto(`/programs/${p.id}`)}>
									<Table.Cell class="max-w-72">
										<a href="/programs/{p.id}" class="flex min-w-0 flex-col" onclick={(e) => e.stopPropagation()}>
											<span class="flex items-center gap-1.5 font-medium">
												<span class="truncate">{p.name}</span>
												{#if !p.public}<LockIcon class="size-3.5 shrink-0 text-muted-foreground" aria-label="Private program" />{/if}
												{#if changedRecently(p)}<SparklesIcon class="size-3.5 shrink-0 text-primary" aria-label="Changed this week" />{/if}
											</span>
											<span class="truncate text-xs text-muted-foreground">{p.handle}{p.submissionState !== 'open' ? ` · submissions ${p.submissionState}` : ''}</span>
										</a>
									</Table.Cell>
									<Table.Cell>
										{#if p.offersBounties}<Badge>Bounty</Badge>{:else}<Badge variant="secondary">VDP</Badge>{/if}
									</Table.Cell>
									<Table.Cell class="text-end tabular-nums">
										{#if p.scopesFetchedAt}
											{p.inScope}
											{#if p.offersBounties && p.bountyAssets < p.inScope}<span class="block text-xs text-muted-foreground">{p.bountyAssets} paid</span>{/if}
										{:else}<span class="text-muted-foreground">…</span>{/if}
									</Table.Cell>
									<Table.Cell class="hidden md:table-cell">
										<div class="flex flex-wrap gap-1">
											{#each p.assetTypes.slice(0, 3) as t (t)}<Badge variant="outline">{assetTypeLabel(t)}</Badge>{/each}
											{#if p.assetTypes.length > 3}<Badge variant="outline">+{p.assetTypes.length - 3}</Badge>{/if}
										</div>
									</Table.Cell>
									<Table.Cell class="hidden text-sm text-muted-foreground lg:table-cell">{p.lastChangeAt ? formatRelative(p.lastChangeAt, now) : '—'}</Table.Cell>
									<Table.Cell class="hidden text-end tabular-nums sm:table-cell">{p.mine.reports || '—'}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if filtered.length > shown}
					<Button variant="outline" class="self-center" onclick={() => (shown += PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</Button>
				{/if}
			{/if}
		{/if}
	</div>
{/if}

<ConnectHackeroneDialog bind:open={connectOpen} username={account?.username ?? ''} onconnected={(a) => { account = a; void invalidate('app:programs'); }} />

<AlertDialog.Root bind:open={disconnectOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Disconnect HackerOne?</AlertDialog.Title>
			<AlertDialog.Description>
				HuntHub forgets your API token and your programs. Private programs nobody else here can see are deleted, with their recorded changes. You can connect again any time.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action class={buttonVariants({ variant: 'destructive' })} onclick={disconnect}>Disconnect</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
