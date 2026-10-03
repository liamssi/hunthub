<script lang="ts" module>
	export type ProgramSection = 'scope' | 'policy' | 'changes';
</script>

<script lang="ts">
	// A program in full: who runs it and how, its scope (in scope first), its
	// policy and what changed on it. Shown in a tab and in the quick look.
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import LockIcon from '@lucide/svelte/icons/lock';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { Snippet } from 'svelte';
	import type { ProgramDetail, ProgramScopeView } from '@hunthub/shared/programs';
	import Markdown from '$lib/components/markdown.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { formatRelative } from '$lib/format';
	import { assetTypeLabel, isNewProgram, isRecentlyChanged, severityLabel } from '$lib/programs';
	import { cn } from '$lib/utils.js';
	import ProgramChanges from './program-changes.svelte';
	import ProgramLogo from './program-logo.svelte';

	let {
		program: p,
		section = $bindable('scope'),
		actions,
		compact = false
	}: { program: ProgramDetail; section?: ProgramSection; actions?: Snippet; compact?: boolean } = $props();

	const now = Date.now();
	let query = $state('');
	const matches = (s: ProgramScopeView) => {
		const q = query.trim().toLowerCase();
		return !q || s.identifier.toLowerCase().includes(q) || s.instruction.toLowerCase().includes(q) || assetTypeLabel(s.assetType).toLowerCase().includes(q);
	};
	const inScope = $derived(p.scopes.filter((s) => s.eligibleForSubmission && matches(s)));
	const outOfScope = $derived(p.scopes.filter((s) => !s.eligibleForSubmission && matches(s)));
	const features = $derived([p.flags.triaged && 'Triaged by HackerOne', p.flags.fastPayments && 'Fast payments', p.flags.openScope && 'Open scope', p.flags.bountySplitting && 'Collaboration'].filter(Boolean) as string[]);
	const launched = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	const severityVariant = (s: string | null) => (s === 'critical' ? 'destructive' : s === 'high' ? 'default' : 'secondary') as 'destructive' | 'default' | 'secondary';
</script>

<div class="flex flex-col gap-5">
	<div class="flex flex-wrap items-start gap-4">
		<ProgramLogo name={p.name} logo={p.logo} class={compact ? 'size-12' : 'size-14'} />
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<h1 class={cn('flex items-center gap-2 font-semibold', compact ? 'text-xl' : 'text-2xl')}>
				<span class="truncate">{p.name}</span>
				{#if !p.public}<LockIcon class="size-4 shrink-0 text-muted-foreground" aria-label="Private program" />{/if}
			</h1>
			<div class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
				<span>{p.handle}</span>
				<span aria-hidden="true">·</span>
				{#if p.offersBounties}<Badge>Bounty</Badge>{:else}<Badge variant="secondary">VDP</Badge>{/if}
				<Badge variant="outline">{p.public ? 'Public' : 'Private'}</Badge>
				{#if isRecentlyChanged(p, now)}<Badge class="bg-amber-500/15 text-amber-700 dark:text-amber-300">Updated</Badge>{/if}
				{#if isNewProgram(p, now)}<Badge class="bg-primary/10 text-primary">New</Badge>{/if}
				{#if p.submissionState !== 'open'}<Badge variant="outline">Submissions {p.submissionState}</Badge>{/if}
				{#if p.flags.goldStandard}<span class="flex items-center gap-1 text-xs font-medium text-foreground"><BadgeCheckIcon class="size-4 text-primary" aria-hidden="true" />Gold Standard Safe Harbor</span>{/if}
			</div>
			{#if features.length}<p class="text-xs text-muted-foreground">{features.join(' · ')}</p>{/if}
		</div>
		{#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
	</div>

	<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#snippet stat(label: string, value: string, hint?: string)}
			<div class="rounded-lg border px-3 py-2" title={hint}>
				<dt class="text-xs text-muted-foreground">{label}</dt>
				<dd class="mt-0.5 truncate text-sm font-medium">{value}</dd>
			</div>
		{/snippet}
		{@render stat('In scope', `${p.inScope} ${p.inScope === 1 ? 'asset' : 'assets'}${p.offersBounties ? ` · ${p.bountyAssets} paid` : ''}`)}
		{@render stat('Up to', p.maxSeverity ? severityLabel(p.maxSeverity) : '—', 'Highest severity accepted')}
		{@render stat('My reports', `${p.mine.reports} (${p.mine.validReports} valid)${p.mine.bountyEarned ? ` · ${p.mine.bountyEarned} ${p.currency?.toUpperCase() ?? ''}` : ''}`)}
		{@render stat('Last change', p.lastChangeAt ? formatRelative(p.lastChangeAt) : 'none recorded', p.launchedAt ? `Taking reports since ${launched.format(new Date(p.launchedAt))}; scope checked ${p.scopesFetchedAt ? formatRelative(p.scopesFetchedAt) : 'not yet'}` : undefined)}
	</dl>

	<div class="flex flex-wrap items-center gap-2">
		<ToggleGroup.Root type="single" variant="outline" size="sm" bind:value={() => section, (v) => v && (section = v as ProgramSection)} aria-label="Section">
			<ToggleGroup.Item value="scope">Scope<span class="ms-1 text-muted-foreground tabular-nums">{p.scopes.length}</span></ToggleGroup.Item>
			<ToggleGroup.Item value="policy">Policy</ToggleGroup.Item>
			<ToggleGroup.Item value="changes">Changes{#if p.events.length}<span class="ms-1 text-muted-foreground tabular-nums">{p.events.length}</span>{/if}</ToggleGroup.Item>
		</ToggleGroup.Root>
		{#if section === 'scope' && p.scopes.length > 8}
			<InputGroup.Root class="w-full sm:ms-auto sm:w-72">
				<InputGroup.Input bind:value={query} placeholder="Filter assets" aria-label="Filter assets" />
				<InputGroup.Addon><SearchIcon /></InputGroup.Addon>
			</InputGroup.Root>
		{/if}
	</div>

	{#if section === 'scope'}
		{#if p.scopes.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">{p.scopesFetchedAt ? 'This program lists no assets.' : "This program's scope hasn't been fetched yet; it will be shortly."}</p>
		{:else}
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
										<Table.Head class={compact ? 'hidden lg:table-cell' : 'hidden md:table-cell'}>Instructions</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each list as s (s.assetType + s.identifier)}
										<Table.Row class={muted ? 'text-muted-foreground' : ''}>
											<Table.Cell class="max-w-80 align-top"><code class="font-mono text-xs break-all whitespace-normal">{s.identifier}</code></Table.Cell>
											<Table.Cell class="align-top"><Badge variant="outline">{assetTypeLabel(s.assetType)}</Badge></Table.Cell>
											{#if !muted}
												<Table.Cell class="align-top">{s.eligibleForBounty ? 'Yes' : 'No'}</Table.Cell>
												<Table.Cell class="align-top">{#if s.maxSeverity}<Badge variant={severityVariant(s.maxSeverity)}>{s.maxSeverity}</Badge>{:else}—{/if}</Table.Cell>
											{/if}
											<Table.Cell class={cn('max-w-md align-top text-xs whitespace-normal', compact ? 'hidden lg:table-cell' : 'hidden md:table-cell')}>
												{#if s.instruction}<Markdown source={s.instruction} class="instructions" />{:else}—{/if}
											</Table.Cell>
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
	{:else if section === 'policy'}
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
