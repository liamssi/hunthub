<script lang="ts">
	// A program at a glance: who it is, how it pays and runs, what's in scope and
	// whether it changed lately. Clicking opens a quick look; Ctrl/⌘-click or the
	// tab button opens it in a tab.
	import AppWindowIcon from '@lucide/svelte/icons/app-window';
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import LockIcon from '@lucide/svelte/icons/lock';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import StarIcon from '@lucide/svelte/icons/star';
	import type { ProgramSummary } from '@hunthub/shared/programs';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { assetTypeLabel, isNewProgram, isRecentlyChanged, severityLabel } from '$lib/programs';
	import { cn } from '$lib/utils.js';
	import ProgramLogo from './program-logo.svelte';

	let {
		program: p,
		now,
		selected = false,
		onglance,
		onopen
	}: {
		program: ProgramSummary;
		now: number;
		/** Shown in the quick look right now. */
		selected?: boolean;
		onglance: (p: ProgramSummary) => void;
		/** Opens in a tab; `background` keeps the current view. */
		onopen: (p: ProgramSummary, background: boolean) => void;
	} = $props();

	const assets = $derived(Object.entries(p.assetCounts).sort((a, b) => b[1] - a[1] || assetTypeLabel(a[0]).localeCompare(assetTypeLabel(b[0]))));
	const MAX_CHIPS = 6;
	const features = $derived([p.flags.triaged && 'Triaged by HackerOne', p.flags.fastPayments && 'Fast payments', p.flags.openScope && 'Open scope', p.flags.bountySplitting && 'Collaboration'].filter(Boolean) as string[]);
	const updated = $derived(isRecentlyChanged(p, now));
	const fresh = $derived(isNewProgram(p, now));

	// The title's button covers the whole card (so the card is one big target); a middle click opens a tab.
	function auxclick(e: MouseEvent) {
		if (e.button === 1 && !(e.target as HTMLElement).closest('[data-card-action]')) {
			e.preventDefault();
			onopen(p, true);
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<article
	class={cn(
		'group/card relative flex cursor-pointer flex-col rounded-xl border bg-card text-card-foreground shadow-xs transition-[box-shadow,border-color] hover:border-foreground/20 hover:shadow-md',
		selected && 'border-primary ring-2 ring-primary/30'
	)}
	onauxclick={auxclick}
	aria-label={p.name}
>
	<header class="flex items-center gap-3 border-b px-4 py-3">
		<ProgramLogo name={p.name} logo={p.logo} />
		<div class="flex min-w-0 flex-1 flex-col">
			<button type="button" class="truncate text-start font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-xl after:focus-visible:ring-2 after:focus-visible:ring-ring" onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) onopen(p, true); else onglance(p); }} title="Quick look (Ctrl/⌘-click opens a tab)">
				{p.name}
			</button>
			<span class="truncate text-xs text-muted-foreground">{p.handle}</span>
		</div>
		{#if p.mine.bookmarked}<StarIcon class="size-4 shrink-0 fill-current text-muted-foreground" aria-label="Bookmarked on HackerOne" />{/if}
		<div data-card-action class="relative z-10">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} size="icon-sm" variant="ghost" aria-label="Actions for {p.name}"><EllipsisVerticalIcon /></Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Group>
						<DropdownMenu.Item onclick={() => onglance(p)}><FileTextIcon />Quick look</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => onopen(p, false)}><AppWindowIcon />Open in a tab</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => onopen(p, true)}><AppWindowIcon />Open in a background tab</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={() => window.open(p.url, '_blank', 'noopener,noreferrer')}><ExternalLinkIcon />Open on HackerOne</DropdownMenu.Item>
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</header>

	<div class="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
		{#if updated || fresh || !p.public || p.submissionState !== 'open'}
			<div class="flex flex-wrap gap-1.5">
				{#if updated}<Badge class="bg-amber-500/15 text-amber-700 dark:text-amber-300">Updated</Badge>{/if}
				{#if fresh}<Badge class="bg-primary/10 text-primary">New</Badge>{/if}
				{#if !p.public}<Badge variant="secondary" class="gap-1"><LockIcon />Private</Badge>{/if}
				{#if p.submissionState !== 'open'}<Badge variant="outline">Submissions {p.submissionState}</Badge>{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-0.5">
			<span class="text-sm font-semibold">{p.offersBounties ? 'Bounty' : 'Vulnerability disclosure'}</span>
			{#if features.length}<span class="text-xs text-muted-foreground">{features.join(' · ')}</span>{/if}
		</div>

		{#if !p.scopesFetchedAt}
			<span class="text-xs text-muted-foreground">Fetching scope…</span>
		{:else if assets.length}
			<ul class="flex flex-wrap gap-1.5" aria-label="Assets in scope">
				{#each assets.slice(0, MAX_CHIPS) as [type, count] (type)}
					<li class="flex items-center overflow-hidden rounded-md bg-secondary text-xs text-secondary-foreground">
						<span class="px-2 py-0.5">{assetTypeLabel(type)}</span>
						<span class="border-s border-background/60 px-1.5 py-0.5 tabular-nums">{count}</span>
					</li>
				{/each}
				{#if assets.length > MAX_CHIPS}<li class="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground">+{assets.length - MAX_CHIPS} more</li>{/if}
			</ul>
		{:else}
			<span class="text-xs text-muted-foreground">No assets in scope listed.</span>
		{/if}

		{#if p.flags.goldStandard}
			<span class="flex items-center gap-1.5 text-xs font-medium"><BadgeCheckIcon class="size-4 text-primary" aria-hidden="true" />Gold Standard Safe Harbor</span>
		{/if}

		<div class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
			<span class="flex items-center gap-1" title="Assets in scope{p.offersBounties ? ', and how many pay bounties' : ''}">
				<ShieldIcon class="size-3.5" aria-hidden="true" /><span class="font-medium text-foreground tabular-nums">{p.inScope}</span> in scope{#if p.offersBounties && p.bountyAssets !== p.inScope}<span>· {p.bountyAssets} paid</span>{/if}
			</span>
			{#if p.maxSeverity}<span title="Highest severity accepted">up to <span class="font-medium text-foreground">{severityLabel(p.maxSeverity)}</span></span>{/if}
			{#if p.mine.reports}<span class="ms-auto" title="Your reports (valid)">{p.mine.reports} {p.mine.reports === 1 ? 'report' : 'reports'} ({p.mine.validReports} valid)</span>{/if}
		</div>
	</div>
</article>
