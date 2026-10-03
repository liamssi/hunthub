<script lang="ts">
	// A quick look at a program over the list: its scope, policy and changes
	// without leaving the page. ← and → step through the programs in the list;
	// "Open in tab" keeps it at hand.
	import AppWindowIcon from '@lucide/svelte/icons/app-window';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import type { ProgramDetail, ProgramSummary } from '@hunthub/shared/programs';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { cachedProgramDetail, programDetail } from '$lib/program-details';
	import ProgramView, { type ProgramSection } from './program-view.svelte';

	let {
		current = $bindable(null),
		list,
		onopentab
	}: {
		/** The program shown; null closes the quick look. */
		current?: ProgramSummary | null;
		/** The programs ← and → step through (the filtered list). */
		list: ProgramSummary[];
		onopentab: (p: ProgramSummary) => void;
	} = $props();

	let detail = $state<ProgramDetail | null>(null);
	let failed = $state(false);
	let section = $state<ProgramSection>('scope');
	let body = $state<HTMLDivElement | null>(null);

	const index = $derived(current ? list.findIndex((p) => p.id === current!.id) : -1);

	$effect(() => {
		const p = current;
		if (!p) return;
		failed = false;
		detail = cachedProgramDetail(p.id);
		body?.scrollTo({ top: 0 });
		void programDetail(p.id).then((d) => {
			if (current?.id !== p.id) return;
			detail = d;
			failed = d === null;
		});
		// The neighbours load in the background, so stepping is instant.
		const i = list.findIndex((x) => x.id === p.id);
		for (const n of [list[i + 1], list[i - 1]]) if (n) void programDetail(n.id);
	});

	function step(by: number) {
		const next = list[index + by];
		if (next) current = next;
	}

	function keydown(e: KeyboardEvent) {
		if (!current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
		if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
		if (e.key === 'ArrowRight' || e.key === 'j') {
			e.preventDefault();
			step(1);
		} else if (e.key === 'ArrowLeft' || e.key === 'k') {
			e.preventDefault();
			step(-1);
		} else if (e.key === 'o' || e.key === 'Enter') {
			e.preventDefault();
			onopentab(current);
		}
	}
</script>

<svelte:window onkeydown={keydown} />

<Dialog.Root open={current !== null} onOpenChange={(open) => !open && (current = null)}>
	<Dialog.Content showCloseButton={false} class="flex h-[min(88vh,60rem)] flex-col gap-0 p-0 sm:max-w-5xl">
		{#if current}
			<div class="flex shrink-0 items-center gap-1 border-b px-3 py-2">
				<Button size="icon-sm" variant="ghost" aria-label="Previous program" title="Previous (←)" disabled={index <= 0} onclick={() => step(-1)}><ChevronLeftIcon /></Button>
				<Button size="icon-sm" variant="ghost" aria-label="Next program" title="Next (→)" disabled={index < 0 || index >= list.length - 1} onclick={() => step(1)}><ChevronRightIcon /></Button>
				<span class="ms-1 text-xs text-muted-foreground tabular-nums">{index >= 0 ? `${index + 1} of ${list.length}` : ''}</span>
				<Dialog.Title class="sr-only">{current.name}</Dialog.Title>
				<Dialog.Description class="sr-only">Quick look at {current.name}: scope, policy and changes.</Dialog.Description>
				<div class="ms-auto flex items-center gap-1">
					<Button size="sm" variant="ghost" href={current.url} target="_blank" rel="noopener noreferrer">
						HackerOne<ExternalLinkIcon data-icon="inline-end" />
					</Button>
					<Button size="sm" variant="outline" onclick={() => current && onopentab(current)} title="Open in a tab (O)">
						<AppWindowIcon data-icon="inline-start" />Open in tab
					</Button>
					<Dialog.Close>
						{#snippet child({ props })}
							<Button {...props} size="icon-sm" variant="ghost" aria-label="Close" title="Close (Esc)"><XIcon /></Button>
						{/snippet}
					</Dialog.Close>
				</div>
			</div>
			<div bind:this={body} class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				{#if detail && detail.id === current.id}
					<ProgramView program={detail} bind:section compact />
				{:else if failed}
					<p class="py-16 text-center text-sm text-muted-foreground">Couldn't load this program.</p>
				{:else}
					<div class="flex flex-col gap-4">
						<div class="flex items-center gap-4"><Skeleton class="size-12 rounded-lg" /><div class="flex flex-col gap-2"><Skeleton class="h-6 w-48" /><Skeleton class="h-4 w-72" /></div></div>
						<div class="grid grid-cols-4 gap-3">{#each { length: 4 } as _, i (i)}<Skeleton class="h-14" />{/each}</div>
						<Skeleton class="h-64 w-full" />
					</div>
				{/if}
			</div>
			<div class="hidden shrink-0 items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground sm:flex">
				<span class="flex items-center gap-1"><Kbd>←</Kbd><Kbd>→</Kbd> previous / next</span>
				<span class="flex items-center gap-1"><Kbd>O</Kbd> open in tab</span>
				<span class="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
