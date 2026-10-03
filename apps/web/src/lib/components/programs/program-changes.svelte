<script lang="ts">
	// Recorded changes on programs, newest first: scope assets added, removed or
	// changed, policy edits (as a line diff), rewards and submission changes.
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import type { ChangedAsset, FieldChange, ProgramEvent } from '@hunthub/shared/programs';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { formatRelative } from '$lib/format';
	import { compactDiff, lineDiff } from '$lib/line-diff';
	import { assetTypeLabel, changeLines, describeEvent, isOpportunity } from '$lib/programs';
	import { cn } from '$lib/utils.js';

	let { events, showProgram = false }: { events: ProgramEvent[]; showProgram?: boolean } = $props();

	const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

	// Grouped by day, so a sync's changes read together.
	const days = $derived.by(() => {
		const groups: { label: string; events: ProgramEvent[] }[] = [];
		for (const e of events) {
			const label = day.format(new Date(e.at));
			if (groups.at(-1)?.label === label) groups.at(-1)!.events.push(e);
			else groups.push({ label, events: [e] });
		}
		return groups;
	});

	const asset = (e: ProgramEvent) => (e.kind.startsWith('scope_') ? (e.detail as ChangedAsset) : null);
	const fieldChanges = (e: ProgramEvent) =>
		e.kind === 'scope_changed' ? changeLines((e.detail as { changes: Record<string, FieldChange> }).changes) : e.kind === 'details_changed' ? changeLines(e.detail as Record<string, FieldChange>) : [];
</script>

<div class="flex flex-col gap-6">
	{#each days as group (group.label)}
		<section class="flex flex-col gap-2">
			<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</h3>
			<ul class="flex flex-col divide-y rounded-lg border">
				{#each group.events as e (e.id)}
					{@const a = asset(e)}
					{@const lines = fieldChanges(e)}
					<li class="flex flex-col gap-1.5 px-4 py-3 text-sm">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							{#if isOpportunity(e)}<SparklesIcon class="size-3.5 text-primary" aria-label="New opportunity" />{/if}
							<span class="font-medium">{describeEvent(e)}</span>
							{#if showProgram}
								<span class="text-muted-foreground">in</span>
								<a class="font-medium underline-offset-2 hover:underline" href="/programs/{e.programId}">{e.programName}</a>
							{/if}
							<time class="ms-auto text-xs text-muted-foreground" datetime={e.at} title={exact.format(new Date(e.at))}>{formatRelative(e.at)}</time>
						</div>
						{#if a}
							<div class="flex min-w-0 items-center gap-2">
								<Badge variant="outline" class="shrink-0">{assetTypeLabel(a.assetType)}</Badge>
								<code class={cn('truncate font-mono text-xs', e.kind === 'scope_removed' && 'text-muted-foreground line-through')}>{a.identifier}</code>
							</div>
						{/if}
						{#if lines.length}
							<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
								{#each lines.filter((l) => !l.long) as l (l.field)}
									<dt class="text-muted-foreground">{l.field}</dt>
									<dd><span class="text-muted-foreground line-through">{l.before}</span> → <span>{l.after}</span></dd>
								{/each}
							</dl>
						{/if}
						{#if e.kind === 'policy_changed' || lines.some((l) => l.long)}
							{@const text = e.kind === 'policy_changed' ? (e.detail as FieldChange<string>) : ((e.detail as { changes: Record<string, FieldChange<string>> }).changes.instruction ?? { before: '', after: '' })}
							<Collapsible.Root>
								<Collapsible.Trigger class="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
									<ChevronDownIcon class="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
									{e.kind === 'policy_changed' ? 'What changed in the policy' : 'What changed in the instructions'}
								</Collapsible.Trigger>
								<Collapsible.Content>
									<pre class="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{#each compactDiff(lineDiff(text.before ?? '', text.after ?? '')) as line, i (i)}{#if line.kind === 'gap'}<span class="block text-muted-foreground italic">⋯ {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}</span>{:else}<span class={cn('block', line.kind === 'added' && 'bg-primary/10 text-foreground', line.kind === 'removed' && 'bg-destructive/10 text-muted-foreground line-through')}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text || ' '}</span>{/if}{/each}</pre>
								</Collapsible.Content>
							</Collapsible.Root>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
