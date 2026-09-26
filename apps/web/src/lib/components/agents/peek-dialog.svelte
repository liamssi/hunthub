<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import type { AgentView } from '@hunthub/shared/machines';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let { agent = $bindable() }: { agent: AgentView | null } = $props();

	// Kept separately so the dialog content doesn't change while it animates closed.
	let shown = $state<AgentView | null>(null);
	let text = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function load(a: AgentView) {
		loading = true;
		error = null;
		const url = `/api/machines/${a.machineId}/sessions/${encodeURIComponent(a.session)}/panes/${encodeURIComponent(a.paneId)}/output?lines=200`;
		const res = await fetch(url).catch(() => null);
		loading = false;
		const body = res ? await res.json().catch(() => ({})) : {};
		if (!res?.ok) {
			error = body.message ?? 'Could not read the output.';
			return;
		}
		text = body.text ?? '';
	}

	$effect(() => {
		if (!agent) return;
		shown = agent;
		text = '';
		void load(agent);
	});
</script>

<Dialog.Root open={agent !== null} onOpenChange={(o) => !o && (agent = null)}>
	<Dialog.Content class="sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>{shown?.name} · recent output</Dialog.Title>
			<Dialog.Description>
				{shown?.machineName} / {shown?.session} / {shown?.workspaceLabel} — read-only; live terminal comes later.
			</Dialog.Description>
		</Dialog.Header>
		{#if error}
			<p class="text-sm text-destructive">{error}</p>
		{:else}
			<pre
				class="max-h-[60vh] overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
				aria-busy={loading}>{loading && !text ? 'Loading…' : text || '(no output)'}</pre>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={loading || !shown} onclick={() => shown && load(shown)}>
				<RefreshCwIcon data-icon="inline-start" />Refresh
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
