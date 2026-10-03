<script lang="ts">
	// One program: its scope (in scope first), its policy, and what changed on it.
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LockIcon from '@lucide/svelte/icons/lock';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ProgramDetail, ProgramScopeView } from '@hunthub/shared/programs';
	import Markdown from '$lib/components/markdown.svelte';
	import ProgramChanges from '$lib/components/programs/program-changes.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { formatRelative } from '$lib/format';
	import { assetTypeLabel } from '$lib/programs';

	let { data } = $props();
	const p = $derived<ProgramDetail>(data.program);

	type Tab = 'scope' | 'policy' | 'changes';
	const tab = $derived<Tab>((['scope', 'policy', 'changes'] as const).find((t) => t === page.url.searchParams.get('tab')) ?? 'scope');
	function setTab(t: string) {
		if (t !== 'scope' && t !== 'policy' && t !== 'changes') return;
		const url = new URL(page.url);
		if (t === 'scope') url.searchParams.delete('tab');
		else url.searchParams.set('tab', t);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let query = $state('');
	const matches = (s: ProgramScopeView) => {
		const q = query.trim().toLowerCase();
		return !q || s.identifier.toLowerCase().includes(q) || s.instruction.toLowerCase().includes(q) || assetTypeLabel(s.assetType).toLowerCase().includes(q);
	};
	const inScope = $derived(p.scopes.filter((s) => s.eligibleForSubmission && matches(s)));
	const outOfScope = $derived(p.scopes.filter((s) => !s.eligibleForSubmission && matches(s)));

	const severityVariant = (s: string | null) => (s === 'critical' ? 'destructive' : s === 'high' ? 'default' : 'secondary') as 'destructive' | 'default' | 'secondary';
</script>

<svelte:head><title>{p.name} · Programs · HuntHub</title></svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex flex-col gap-3">
		<a href="/programs" class="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
			<ArrowLeftIcon class="size-4" aria-hidden="true" />Programs
		</a>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<h1 class="flex items-center gap-2 text-2xl font-semibold">
					<span class="truncate">{p.name}</span>
					{#if !p.public}<LockIcon class="size-5 shrink-0 text-muted-foreground" aria-label="Private program" />{/if}
				</h1>
				<div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
					<span>{p.handle}</span>
					<span aria-hidden="true">·</span>
					{#if p.offersBounties}<Badge>Bounty</Badge>{:else}<Badge variant="secondary">VDP</Badge>{/if}
					<Badge variant="outline">{p.public ? 'Public' : 'Private'}</Badge>
					{#if p.submissionState !== 'open'}<Badge variant="outline">Submissions {p.submissionState}</Badge>{/if}
				</div>
			</div>
			<Button variant="outline" href={p.url} target="_blank" rel="noopener noreferrer">
				Open on HackerOne<ExternalLinkIcon data-icon="inline-end" />
			</Button>
		</div>
		<dl class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
			<div>
				<dt class="text-muted-foreground">In scope</dt>
				<dd class="font-medium tabular-nums">{p.inScope} {p.inScope === 1 ? 'asset' : 'assets'}{p.offersBounties ? ` · ${p.bountyAssets} paid` : ''}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">My reports</dt>
				<dd class="font-medium tabular-nums">{p.mine.reports} ({p.mine.validReports} valid)</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Scope checked</dt>
				<dd class="font-medium">{p.scopesFetchedAt ? formatRelative(p.scopesFetchedAt) : 'not yet'}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Last change</dt>
				<dd class="font-medium">{p.lastChangeAt ? formatRelative(p.lastChangeAt) : 'none recorded'}</dd>
			</div>
		</dl>
	</div>

	<ToggleGroup.Root type="single" variant="outline" size="sm" class="self-start" bind:value={() => tab, (v) => setTab(v)} aria-label="Section">
		<ToggleGroup.Item value="scope">Scope</ToggleGroup.Item>
		<ToggleGroup.Item value="policy">Policy</ToggleGroup.Item>
		<ToggleGroup.Item value="changes">Changes{#if p.events.length}<span class="ms-1 text-muted-foreground tabular-nums">{p.events.length}</span>{/if}</ToggleGroup.Item>
	</ToggleGroup.Root>

	{#if tab === 'scope'}
		{#if p.scopes.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">{p.scopesFetchedAt ? 'This program lists no assets.' : "This program's scope hasn't been fetched yet."}</p>
		{:else}
			{#if p.scopes.length > 8}
				<InputGroup.Root class="w-full sm:w-80">
					<InputGroup.Input bind:value={query} placeholder="Filter assets" aria-label="Filter assets" />
					<InputGroup.Addon><SearchIcon /></InputGroup.Addon>
				</InputGroup.Root>
			{/if}
			{#snippet assets(title: string, list: ProgramScopeView[], muted: boolean)}
				<section class="flex flex-col gap-2">
					<h2 class="text-sm font-medium">{title} <span class="text-muted-foreground tabular-nums">{list.length}</span></h2>
					{#if list.length}
						<div class="rounded-lg border">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Asset</Table.Head>
										<Table.Head>Type</Table.Head>
										{#if !muted}
											<Table.Head>Bounty</Table.Head>
											<Table.Head>Max severity</Table.Head>
										{/if}
										<Table.Head class="hidden md:table-cell">Instructions</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each list as s (s.assetType + s.identifier)}
										<Table.Row class={muted ? 'text-muted-foreground' : ''}>
											<Table.Cell class="max-w-80"><code class="font-mono text-xs break-all whitespace-normal">{s.identifier}</code></Table.Cell>
											<Table.Cell><Badge variant="outline">{assetTypeLabel(s.assetType)}</Badge></Table.Cell>
											{#if !muted}
												<Table.Cell>{s.eligibleForBounty ? 'Yes' : 'No'}</Table.Cell>
												<Table.Cell>{#if s.maxSeverity}<Badge variant={severityVariant(s.maxSeverity)}>{s.maxSeverity}</Badge>{:else}—{/if}</Table.Cell>
											{/if}
											<Table.Cell class="hidden max-w-md align-top text-xs whitespace-normal md:table-cell">{#if s.instruction}<Markdown source={s.instruction} class="instructions" />{:else}—{/if}</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">None{query ? ' match the filter' : ''}.</p>
					{/if}
				</section>
			{/snippet}
			{@render assets('In scope', inScope, false)}
			{#if outOfScope.length || query}{@render assets('Out of scope', outOfScope, true)}{/if}
		{/if}
	{:else if tab === 'policy'}
		{#if p.policy.trim()}
			<div class="rounded-lg border px-6 py-5"><Markdown source={p.policy} /></div>
		{:else}
			<p class="py-8 text-center text-sm text-muted-foreground">This program has no policy text.</p>
		{/if}
	{:else if p.events.length === 0}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Title>No changes recorded yet</Empty.Title>
				<Empty.Description>When this program's scope, policy or rewards change, HuntHub notes what changed here.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<ProgramChanges events={p.events} />
	{/if}
</div>

<style>
	/* Scope instructions: compact Markdown inside a table cell. */
	:global(.markdown.instructions) {
		font-size: inherit;
		line-height: 1.5;
	}
	:global(.markdown.instructions :where(p, ul, ol)) {
		margin: 0.3em 0;
	}
</style>
