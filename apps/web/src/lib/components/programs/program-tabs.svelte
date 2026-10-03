<script lang="ts">
	// Tabs inside the Programs page: all programs, then each program opened in a
	// tab. Middle-click closes a tab; tabs can be dragged into another order.
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import { closeAllTabs, closeOtherTabs, closeTab, moveTab, programTabs } from '$lib/program-tabs.svelte';
	import { cn } from '$lib/utils.js';
	import ProgramLogo from './program-logo.svelte';

	const activeId = $derived(page.route.id === '/programs/[id]' ? Number(page.params.id) : null);

	function close(id: number) {
		const next = closeTab(id);
		if (activeId === id) void goto(next ? `/programs/${next.id}` : '/programs');
	}

	let dragging = $state<number | null>(null);
	let dropAt = $state<number | null>(null);

	let strip = $state<HTMLElement | null>(null);
	// The active tab scrolls into view (e.g. opened from a card while the strip is scrolled).
	$effect(() => {
		const id = activeId;
		if (id === null || !strip) return;
		queueMicrotask(() => strip?.querySelector(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
	});
</script>

<nav bind:this={strip} class="-mx-4 flex items-end gap-0.5 overflow-x-auto border-b px-4" aria-label="Program tabs">
	<a
		href="/programs"
		class={cn(
			'flex h-9 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-sm transition-colors',
			activeId === null ? 'border-border bg-background font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
		)}
		aria-current={activeId === null ? 'page' : undefined}
	>
		<LayoutGridIcon class="size-4" aria-hidden="true" />All programs
	</a>
	{#each programTabs.tabs as tab, i (tab.id)}
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<div
						{...props}
						data-tab={tab.id}
						role="presentation"
						draggable="true"
						ondragstart={(e) => {
							dragging = tab.id;
							e.dataTransfer?.setData('text/plain', String(tab.id));
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
						}}
						ondragover={(e) => {
							if (dragging === null) return;
							e.preventDefault();
							const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
							dropAt = e.clientX < r.left + r.width / 2 ? i : i + 1;
						}}
						ondrop={(e) => {
							e.preventDefault();
							if (dragging !== null && dropAt !== null) {
								const from = programTabs.tabs.findIndex((t) => t.id === dragging);
								moveTab(dragging, dropAt > from ? dropAt - 1 : dropAt);
							}
							dragging = dropAt = null;
						}}
						ondragend={() => (dragging = dropAt = null)}
						onauxclick={(e) => {
							if (e.button === 1) {
								e.preventDefault();
								close(tab.id);
							}
						}}
						class={cn(
							'group/tab relative flex h-9 max-w-56 min-w-0 shrink-0 items-center rounded-t-md border border-b-0 text-sm transition-colors',
							activeId === tab.id ? 'border-border bg-background text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
							dragging === tab.id && 'opacity-50',
							dropAt === i && dragging !== null && 'before:absolute before:inset-y-1 before:-left-0.5 before:w-0.5 before:bg-primary',
							dropAt === i + 1 && dragging !== null && i === programTabs.tabs.length - 1 && 'after:absolute after:inset-y-1 after:-right-0.5 after:w-0.5 after:bg-primary'
						)}
					>
						<a href="/programs/{tab.id}" class="flex min-w-0 items-center gap-2 py-1 ps-2.5 pe-1" aria-current={activeId === tab.id ? 'page' : undefined} title={tab.name}>
							<ProgramLogo name={tab.name} logo={tab.logo} class="size-5 rounded text-[9px]" />
							<span class={cn('truncate', activeId === tab.id && 'font-medium')}>{tab.name}</span>
						</a>
						<button
							type="button"
							class={cn('me-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100', activeId === tab.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100')}
							aria-label="Close {tab.name}"
							title="Close (middle-click)"
							onclick={() => close(tab.id)}
						>
							<XIcon class="size-3.5" />
						</button>
					</div>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Content>
				<ContextMenu.Group>
					<ContextMenu.Item onclick={() => close(tab.id)}>Close tab</ContextMenu.Item>
					<ContextMenu.Item
						disabled={programTabs.tabs.length < 2}
						onclick={() => {
							closeOtherTabs(tab.id);
							if (activeId !== null && activeId !== tab.id) void goto(`/programs/${tab.id}`);
						}}>Close other tabs</ContextMenu.Item
					>
					<ContextMenu.Item
						onclick={() => {
							closeAllTabs();
							if (activeId !== null) void goto('/programs');
						}}>Close all tabs</ContextMenu.Item
					>
				</ContextMenu.Group>
			</ContextMenu.Content>
		</ContextMenu.Root>
	{/each}
</nav>
