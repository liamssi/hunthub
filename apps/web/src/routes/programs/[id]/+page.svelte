<script lang="ts">
	// A program opened in a tab: everything about it, with its section in the URL.
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ProgramDetail } from '@hunthub/shared/programs';
	import ProgramView, { type ProgramSection } from '$lib/components/programs/program-view.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { openTab } from '$lib/program-tabs.svelte';

	let { data } = $props();
	const p = $derived<ProgramDetail>(data.program);

	// Visiting a program (a link, a reload) keeps it in a tab. Only the program is tracked,
	// not the tab list (closing this tab must not reopen it).
	$effect(() => {
		const tab = { id: p.id, name: p.name, logo: p.logo };
		untrack(() => openTab(tab));
	});

	const section = $derived<ProgramSection>((['scope', 'policy', 'changes'] as const).find((t) => t === page.url.searchParams.get('tab')) ?? 'scope');
	function setSection(t: ProgramSection) {
		const url = new URL(page.url);
		if (t === 'scope') url.searchParams.delete('tab');
		else url.searchParams.set('tab', t);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head><title>{p.name} · Programs · HuntHub</title></svelte:head>

<ProgramView program={p} bind:section={() => section, setSection}>
	{#snippet actions()}
		<Button variant="outline" href={p.url} target="_blank" rel="noopener noreferrer">Open on HackerOne<ExternalLinkIcon data-icon="inline-end" /></Button>
	{/snippet}
</ProgramView>
