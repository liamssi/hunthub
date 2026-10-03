<script lang="ts">
	// The programs you can hunt on (from your HackerOne account), kept up to date
	// with their scope and policy, and what changed on them. A card opens a quick
	// look; programs can be opened in tabs to keep several at hand.
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import LockIcon from '@lucide/svelte/icons/lock';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TargetIcon from '@lucide/svelte/icons/target';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { PlatformAccountView, ProgramEvent, ProgramSummary } from '@hunthub/shared/programs';
	import ConnectHackeroneDialog from '$lib/components/programs/connect-hackerone-dialog.svelte';
	import ProgramCard from '$lib/components/programs/program-card.svelte';
	import ProgramChanges from '$lib/components/programs/program-changes.svelte';
	import ProgramGlance from '$lib/components/programs/program-glance.svelte';
	import ProgramLogo from '$lib/components/programs/program-logo.svelte';
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
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { formatRelative } from '$lib/format';
	import { openTab } from '$lib/program-tabs.svelte';
	import { assetTypeLabel, isNewProgram, isRecentlyChanged, severityLabel, severityRank } from '$lib/programs';
	import { cn } from '$lib/utils.js';

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

	// --- Programs or recent changes ----------------------------------------------

	type Tab = 'programs' | 'changes';
	const tab = $derived<Tab>(page.url.searchParams.get('view') === 'changes' ? 'changes' : 'programs');
	function setTab(t: string) {
		if (t !== 'programs' && t !== 'changes') return;
		const url = new URL(page.url);
		if (t === 'changes') url.searchParams.set('view', 'changes');
		else url.searchParams.delete('view');
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

	// --- Cards or a list, remembered per browser -----------------------------------

	type Layout = 'cards' | 'list';
	const LAYOUT_KEY = 'hunthub.programs.layout';
	let layout = $state<Layout>(
		(() => {
			if (!browser) return 'cards';
			try {
				return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards';
			} catch {
				return 'cards';
			}
		})()
	);
	function setLayout(v: string) {
		if (v !== 'cards' && v !== 'list') return;
		layout = v;
		try {
			localStorage.setItem(LAYOUT_KEY, v);
		} catch {
			// The choice just won't persist.
		}
	}

	// --- Search, filters and sorting ----------------------------------------------

	let query = $state('');
	let rewards = $state<'all' | 'bounty' | 'vdp'>('all');
	let assetType = $state('any');
	let sort = $state<'name' | 'changed' | 'newest' | 'scope' | 'severity' | 'mine'>('name');

	/** Quick filters, combined with AND. */
	const QUICK = {
		updated: { label: 'Updated this week', test: (p: ProgramSummary) => isRecentlyChanged(p, now) },
		new: { label: 'New programs', test: (p: ProgramSummary) => isNewProgram(p, now) },
		private: { label: 'Private', test: (p: ProgramSummary) => !p.public },
		gold: { label: 'Gold Standard', test: (p: ProgramSummary) => p.flags.goldStandard },
		triaged: { label: 'Triaged by HackerOne', test: (p: ProgramSummary) => p.flags.triaged },
		open: { label: 'Taking reports', test: (p: ProgramSummary) => p.submissionState === 'open' },
		bookmarked: { label: 'Bookmarked', test: (p: ProgramSummary) => p.mine.bookmarked },
		hunted: { label: 'Reported before', test: (p: ProgramSummary) => p.mine.reports > 0 }
	} as const;
	type Quick = keyof typeof QUICK;
	let quick = $state<Quick[]>([]);
	const toggleQuick = (q: Quick) => (quick = quick.includes(q) ? quick.filter((x) => x !== q) : [...quick, q]);
	const quickCount = (q: Quick) => programs.filter(QUICK[q].test).length;

	const assetTypes = $derived([...new Set(programs.flatMap((p) => p.assetTypes))].sort((a, b) => assetTypeLabel(a).localeCompare(assetTypeLabel(b))));
	const sortLabels = { name: 'Name', changed: 'Recently changed', newest: 'Newest programs', scope: 'Most assets in scope', severity: 'Highest severity', mine: 'My reports' };

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = programs.filter(
			(p) =>
				(!q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q)) &&
				(rewards === 'all' || (rewards === 'bounty') === p.offersBounties) &&
				(assetType === 'any' || p.assetTypes.includes(assetType)) &&
				quick.every((k) => QUICK[k].test(p))
		);
		const byName = (a: ProgramSummary, b: ProgramSummary) => a.name.localeCompare(b.name);
		const by = {
			name: byName,
			changed: (a: ProgramSummary, b: ProgramSummary) => (b.lastChangeAt ?? '').localeCompare(a.lastChangeAt ?? '') || byName(a, b),
			newest: (a: ProgramSummary, b: ProgramSummary) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? '') || byName(a, b),
			scope: (a: ProgramSummary, b: ProgramSummary) => b.inScope - a.inScope || byName(a, b),
			severity: (a: ProgramSummary, b: ProgramSummary) => severityRank(a.maxSeverity) - severityRank(b.maxSeverity) || b.bountyAssets - a.bountyAssets || byName(a, b),
			mine: (a: ProgramSummary, b: ProgramSummary) => b.mine.reports - a.mine.reports || byName(a, b)
		}[sort];
		return [...list].sort(by);
	});
	const filtering = $derived(query.trim() !== '' || rewards !== 'all' || assetType !== 'any' || quick.length > 0);
	function clearFilters() {
		query = '';
		rewards = 'all';
		assetType = 'any';
		quick = [];
	}

	// Long lists render a page at a time.
	const PAGE = 60;
	let shown = $state(PAGE);
	$effect(() => {
		void filtered;
		shown = PAGE;
	});

	// --- Quick look and tabs --------------------------------------------------------

	let glance = $state<ProgramSummary | null>(null);
	function open(p: ProgramSummary, background = false) {
		openTab({ id: p.id, name: p.name, logo: p.logo });
		if (background) toast.success(`Opened ${p.name} in a tab`);
		else {
			glance = null;
			void goto(`/programs/${p.id}`);
		}
	}

	const syncLabel = $derived.by(() => {
		const s = account?.sync;
		if (!s) return null;
		if (s.phase === 'programs') return 'Fetching your programs…';
		return `Fetching scopes · ${s.scopesDone} of ${s.scopesTotal}`;
	});

	// "/" focuses the search, as on most sites.
	let search = $state<HTMLInputElement | null>(null);
	function keydown(e: KeyboardEvent) {
		if (e.key !== '/' || glance || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
		e.preventDefault();
		search?.focus();
	}
</script>

<svelte:head><title>Programs · HuntHub</title></svelte:head>
<svelte:window onkeydown={keydown} />

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
	<Progress class="h-1" value={account.sync.scopesDone} max={account.sync.scopesTotal} aria-label="Fetching scopes" />
{/if}

{#if account && account.status !== 'ok' && !account.sync}
	<Alert.Root variant="destructive">
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
	<Empty.Root class="mt-4 border">
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
	<!-- Search and filters, in one panel like the platforms' own directories. -->
	<section class="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs" aria-label="Find programs">
		<div class="flex flex-wrap items-center gap-2">
			<InputGroup.Root class="min-w-0 flex-1 basis-64">
				<InputGroup.Input bind:ref={search} bind:value={query} placeholder="Search programs by name or handle" aria-label="Search programs" />
				<InputGroup.Addon><SearchIcon /></InputGroup.Addon>
				{#if query}
					<InputGroup.Addon align="inline-end">
						<InputGroup.Button size="icon-xs" aria-label="Clear search" onclick={() => (query = '')}><XIcon /></InputGroup.Button>
					</InputGroup.Addon>
				{/if}
			</InputGroup.Root>
			<ToggleGroup.Root type="single" variant="outline" bind:value={() => rewards, (v) => v && (rewards = v as typeof rewards)} aria-label="Program type">
				<ToggleGroup.Item value="all">All</ToggleGroup.Item>
				<ToggleGroup.Item value="bounty">Bounty</ToggleGroup.Item>
				<ToggleGroup.Item value="vdp">VDP</ToggleGroup.Item>
			</ToggleGroup.Root>
			<Select.Root type="single" bind:value={assetType}>
				<Select.Trigger class="w-44" aria-label="Asset type">{assetType === 'any' ? 'All asset types' : assetTypeLabel(assetType)}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Item value="any" label="All asset types" />
						{#each assetTypes as t (t)}<Select.Item value={t} label={assetTypeLabel(t)} />{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
			{#each Object.entries(QUICK) as [key, q] (key)}
				{@const n = quickCount(key as Quick)}
				{#if n > 0 || quick.includes(key as Quick)}
					<Toggle
						size="sm"
						variant="outline"
						class="h-7 rounded-full px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
						pressed={quick.includes(key as Quick)}
						onPressedChange={() => toggleQuick(key as Quick)}
					>
						{q.label}<span class="text-muted-foreground tabular-nums">{n}</span>
					</Toggle>
				{/if}
			{/each}
			{#if filtering}<Button size="sm" variant="ghost" class="h-7 text-xs" onclick={clearFilters}>Clear all</Button>{/if}
		</div>
	</section>

	<div class="flex flex-wrap items-center gap-2">
		<ToggleGroup.Root type="single" variant="outline" size="sm" bind:value={() => tab, (v) => setTab(v)} aria-label="View">
			<ToggleGroup.Item value="programs">
				{filtering ? `${filtered.length} of ${programs.length}` : programs.length} programs
			</ToggleGroup.Item>
			<ToggleGroup.Item value="changes"><SparklesIcon />Changes</ToggleGroup.Item>
		</ToggleGroup.Root>
		{#if tab === 'programs'}
			<Select.Root type="single" bind:value={sort}>
				<Select.Trigger size="sm" class="ms-auto w-52" aria-label="Sort by">Sort: {sortLabels[sort]}</Select.Trigger>
				<Select.Content align="end">
					<Select.Group>
						{#each Object.entries(sortLabels) as [value, label] (value)}<Select.Item {value} {label} />{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			<ToggleGroup.Root type="single" variant="outline" size="sm" bind:value={() => layout, (v) => setLayout(v)} aria-label="Layout">
				<ToggleGroup.Item value="cards" aria-label="Cards"><LayoutGridIcon /></ToggleGroup.Item>
				<ToggleGroup.Item value="list" aria-label="List"><ListIcon /></ToggleGroup.Item>
			</ToggleGroup.Root>
		{/if}
	</div>

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
	{:else if programs.length === 0}
		{#if account.sync}
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
				{#each { length: 8 } as _, i (i)}<Skeleton class="h-64 rounded-xl" />{/each}
			</div>
		{:else}
			<p class="py-10 text-center text-sm text-muted-foreground">Your HackerOne account has no programs yet.</p>
		{/if}
	{:else if filtered.length === 0}
		<div class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
			<p>No programs match these filters.</p>
			<Button size="sm" variant="outline" onclick={clearFilters}>Clear filters</Button>
		</div>
	{:else if layout === 'cards'}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{#each filtered.slice(0, shown) as p (p.id)}
				<ProgramCard program={p} {now} selected={glance?.id === p.id} onglance={(x) => (glance = x)} onopen={open} />
			{/each}
		</div>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Program</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head class="text-end">In scope</Table.Head>
						<Table.Head class="hidden md:table-cell">Assets</Table.Head>
						<Table.Head class="hidden lg:table-cell">Up to</Table.Head>
						<Table.Head class="hidden lg:table-cell">Last change</Table.Head>
						<Table.Head class="hidden text-end sm:table-cell">My reports</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered.slice(0, shown) as p (p.id)}
						<Table.Row
							class={cn('cursor-pointer', glance?.id === p.id && 'bg-muted')}
							onclick={(e) => (e.ctrlKey || e.metaKey ? open(p, true) : (glance = p))}
							onauxclick={(e) => e.button === 1 && open(p, true)}
						>
							<Table.Cell class="max-w-80">
								<div class="flex min-w-0 items-center gap-3">
									<ProgramLogo name={p.name} logo={p.logo} class="size-8" />
									<div class="flex min-w-0 flex-col">
										<button type="button" class="flex items-center gap-1.5 text-start font-medium" onclick={(e) => { e.stopPropagation(); glance = p; }}>
											<span class="truncate">{p.name}</span>
											{#if !p.public}<LockIcon class="size-3.5 shrink-0 text-muted-foreground" aria-label="Private program" />{/if}
										</button>
										<span class="truncate text-xs text-muted-foreground">{p.handle}</span>
									</div>
									{#if isRecentlyChanged(p, now)}<Badge class="bg-amber-500/15 text-amber-700 dark:text-amber-300">Updated</Badge>{/if}
								</div>
							</Table.Cell>
							<Table.Cell>{#if p.offersBounties}<Badge>Bounty</Badge>{:else}<Badge variant="secondary">VDP</Badge>{/if}</Table.Cell>
							<Table.Cell class="text-end tabular-nums">{p.scopesFetchedAt ? p.inScope : '…'}</Table.Cell>
							<Table.Cell class="hidden md:table-cell">
								<div class="flex flex-wrap gap-1">
									{#each Object.entries(p.assetCounts).sort((a, b) => b[1] - a[1]).slice(0, 3) as [t, n] (t)}<Badge variant="outline">{assetTypeLabel(t)} {n}</Badge>{/each}
								</div>
							</Table.Cell>
							<Table.Cell class="hidden lg:table-cell">{p.maxSeverity ? severityLabel(p.maxSeverity) : '—'}</Table.Cell>
							<Table.Cell class="hidden text-sm text-muted-foreground lg:table-cell">{p.lastChangeAt ? formatRelative(p.lastChangeAt, now) : '—'}</Table.Cell>
							<Table.Cell class="hidden text-end tabular-nums sm:table-cell">{p.mine.reports || '—'}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
	{#if tab === 'programs' && filtered.length > shown}
		<Button variant="outline" class="self-center" onclick={() => (shown += PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</Button>
	{/if}
{/if}

<ProgramGlance bind:current={glance} list={filtered} onopentab={(p) => open(p)} />

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
