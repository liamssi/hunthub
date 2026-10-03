<script lang="ts">
	// A program card laid out like HackerOne's own: logo and name with a star,
	// what kind of program it is and how it runs, assets in scope by type, safe
	// harbor, what it pays for, and a details button. Clicking anywhere opens a
	// quick look; Ctrl/⌘- or middle-click opens it in a tab.
	import AppWindowIcon from '@lucide/svelte/icons/app-window';
	import BugIcon from '@lucide/svelte/icons/bug';
	import CircleDollarSignIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import LockIcon from '@lucide/svelte/icons/lock';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import StarIcon from '@lucide/svelte/icons/star';
	import { toast } from 'svelte-sonner';
	import type { ProgramSummary } from '@hunthub/shared/programs';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { copyText } from '$lib/clipboard';
	import { toggleBookmark, toggleHidden } from '$lib/program-me.svelte';
	import { assetTypeLabel, isNewProgram, isRecentlyChanged, severityLabel } from '$lib/programs';
	import { cn } from '$lib/utils.js';
	import ProgramLogo from './program-logo.svelte';

	let {
		program: p,
		now,
		selected = false,
		matches = [],
		onglance,
		onopen
	}: {
		program: ProgramSummary;
		now: number;
		/** Shown in the quick look right now. */
		selected?: boolean;
		/** Scope assets that matched the search. */
		matches?: string[];
		onglance: (p: ProgramSummary) => void;
		/** Opens in a tab; `background` keeps the current view. */
		onopen: (p: ProgramSummary, background: boolean) => void;
	} = $props();

	const assets = $derived(Object.entries(p.assetCounts).sort((a, b) => b[1] - a[1] || assetTypeLabel(a[0]).localeCompare(assetTypeLabel(b[0]))));
	const MAX_CHIPS = 6;
	const features = $derived([p.flags.triaged && 'Triaged by HackerOne', p.flags.fastPayments && 'Fast payments', p.flags.openScope && 'Open scope', p.flags.bountySplitting && 'Collaboration'].filter(Boolean) as string[]);
	const updated = $derived(isRecentlyChanged(p, now));
	const fresh = $derived(isNewProgram(p, now));

	function auxclick(e: MouseEvent) {
		if (e.button === 1 && !(e.target as HTMLElement).closest('[data-card-action]')) {
			e.preventDefault();
			onopen(p, true);
		}
	}
	const glanceOrTab = (e: MouseEvent) => (e.ctrlKey || e.metaKey ? onopen(p, true) : onglance(p));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<article
	class={cn(
		'group/card relative flex min-h-[25rem] flex-col rounded-md border bg-card text-card-foreground transition-[box-shadow,border-color]',
		'hover:border-foreground/25 hover:shadow-[0_2px_12px_-4px_rgb(0_0_0/0.18)]',
		selected && 'border-primary ring-2 ring-primary/25',
		p.me.hidden && 'opacity-60'
	)}
	onauxclick={auxclick}
	aria-label={p.name}
>
	<header class="flex h-16 items-center gap-3 border-b px-5">
		<ProgramLogo name={p.name} logo={p.logo} class="size-10 rounded-full" />
		<button
			type="button"
			class="min-w-0 flex-1 truncate text-start text-[0.95rem] font-medium after:absolute after:inset-0 after:rounded-md focus-visible:outline-none after:focus-visible:ring-2 after:focus-visible:ring-ring"
			onclick={(e) => { e.stopPropagation(); glanceOrTab(e); }}
			title="{p.name} · quick look (Ctrl/⌘-click opens a tab)"
		>
			{p.name}
		</button>
		<div data-card-action class="relative z-10 -me-2 flex items-center">
			<Button size="icon-sm" variant="ghost" aria-label={p.me.bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={p.me.bookmarked} title={p.me.bookmarked ? 'Bookmarked' : 'Bookmark'} onclick={() => toggleBookmark(p)}>
				<StarIcon class={cn(p.me.bookmarked && 'fill-amber-400 text-amber-500')} />
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} size="icon-sm" variant="ghost" aria-label="Actions for {p.name}"><EllipsisVerticalIcon /></Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-56">
					<DropdownMenu.Group>
						<DropdownMenu.Item onclick={() => onglance(p)}><FileTextIcon />Quick look</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => onopen(p, false)}><AppWindowIcon />Open in a tab</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => onopen(p, true)}><AppWindowIcon />Open in a background tab</DropdownMenu.Item>
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
					<DropdownMenu.Group>
						<DropdownMenu.Item onclick={() => toggleBookmark(p)}><StarIcon />{p.me.bookmarked ? 'Remove bookmark' : 'Bookmark'}</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => toggleHidden(p)}>
							{#if p.me.hidden}<EyeIcon />Show again{:else}<EyeOffIcon />Hide (not interested){/if}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={async () => (await copyText(p.handle)) && toast.success('Handle copied')}><CopyIcon />Copy handle</DropdownMenu.Item>
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => window.open(p.url, '_blank', 'noopener,noreferrer')}><ExternalLinkIcon />Open on HackerOne</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</header>

	<div class="flex flex-1 flex-col px-5 pt-4 pb-5">
		<div class="flex min-h-6 flex-wrap items-center gap-1.5">
			{#if p.me.unseen > 0}
				<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">{p.me.unseen} new {p.me.unseen === 1 ? 'change' : 'changes'}</span>
			{:else if updated}
				<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">Updated</span>
			{/if}
			{#if fresh}<span class="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">New</span>{/if}
			{#if !p.public}<span class="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium"><LockIcon class="size-3" aria-hidden="true" />Private</span>{/if}
			{#if p.submissionState !== 'open'}<span class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">Submissions {p.submissionState}</span>{/if}
			{#if p.me.hidden}<span class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">Hidden</span>{/if}
		</div>

		<div class="mt-2.5">
			<p class="text-[0.95rem] font-semibold">{p.offersBounties ? 'Bounty' : 'Vulnerability disclosure'}</p>
			{#if features.length}
				<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
					{#each features as f, i (f)}<span class="underline decoration-muted-foreground/40 underline-offset-2">{f}</span>{i < features.length - 1 ? ', ' : ''}{/each}
				</p>
			{/if}
		</div>

		{#if !p.scopesFetchedAt}
			<p class="mt-3 text-xs text-muted-foreground">Fetching scope…</p>
		{:else if assets.length}
			<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Assets in scope">
				{#each assets.slice(0, MAX_CHIPS) as [type, count] (type)}
					<li class="flex items-center rounded-full bg-primary/10 text-xs">
						<span class="py-0.5 ps-2.5 pe-1.5">{assetTypeLabel(type)}</span>
						<span class="border-s border-primary/25 py-0.5 ps-1.5 pe-2.5 tabular-nums">{count}</span>
					</li>
				{/each}
				{#if assets.length > MAX_CHIPS}<li class="rounded-full px-1.5 py-0.5 text-xs text-muted-foreground">+{assets.length - MAX_CHIPS}</li>{/if}
			</ul>
		{:else}
			<p class="mt-3 text-xs text-muted-foreground">No assets in scope listed.</p>
		{/if}

		{#if matches.length}
			<p class="mt-2 truncate text-xs" title={matches.join('\n')}>
				<span class="text-muted-foreground">Matches</span> <code class="font-mono">{matches[0]}</code>{#if matches.length > 1}<span class="text-muted-foreground"> +{matches.length - 1}</span>{/if}
			</p>
		{/if}

		{#if p.me.tags.length}
			<div class="mt-2.5 flex flex-wrap gap-1">
				{#each p.me.tags as t (t)}<span class="rounded border px-1.5 py-px text-[0.7rem] text-muted-foreground">#{t}</span>{/each}
			</div>
		{/if}

		<div class="mt-auto flex flex-col gap-3 pt-4">
			{#if p.flags.goldStandard}
				<span class="flex items-center gap-1.5 text-sm"><ShieldCheckIcon class="size-4 text-pink-500" aria-hidden="true" />Gold Standard</span>
			{/if}
			<p class={cn('text-lg font-semibold', p.offersBounties ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')} title="Highest severity accepted in scope">
				{#if p.maxSeverity}Up to {severityLabel(p.maxSeverity)}{:else if p.scopesFetchedAt}—{:else}&nbsp;{/if}
			</p>
			<div class="flex items-center gap-4 text-sm text-muted-foreground">
				<span class="flex items-center gap-1.5" title="Assets in scope"><ShieldIcon class="size-4" aria-hidden="true" /><span class="text-foreground tabular-nums">{p.inScope}</span></span>
				{#if p.offersBounties}<span class="flex items-center gap-1.5" title="Assets eligible for bounties"><CircleDollarSignIcon class="size-4" aria-hidden="true" /><span class="text-foreground tabular-nums">{p.bountyAssets}</span></span>{/if}
				<span class="flex items-center gap-1.5" title="Your reports ({p.mine.validReports} valid)"><BugIcon class="size-4" aria-hidden="true" /><span class="text-foreground tabular-nums">{p.mine.reports}</span></span>
				{#if p.me.hasNote}<span class="flex items-center" title="You have notes on it"><NotebookPenIcon class="size-4" aria-label="Has notes" /></span>{/if}
			</div>
			<div data-card-action class="relative z-10">
				<Button variant="outline" class="w-full border-primary text-primary hover:bg-primary/5 hover:text-primary" onclick={(e: MouseEvent) => glanceOrTab(e)}>See details</Button>
			</div>
		</div>
	</div>
</article>
