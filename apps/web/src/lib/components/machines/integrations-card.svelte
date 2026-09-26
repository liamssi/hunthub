<script lang="ts">
	// Herdr's agent integrations on a machine: status hooks Herdr adds to an
	// agent's own settings, so it knows exactly when the agent works, waits for
	// you or finishes (without them it reads the agent's screen). Installing or
	// removing one changes that agent's settings on the machine, so it's confirmed.
	import { AGENT_KINDS } from '@hunthub/shared/console';
	import type { Machine } from '@hunthub/shared/machines';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '$lib/components/console/confirm-dialog.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as Table from '$lib/components/ui/table/index.js';

	let { machine, online }: { machine: Machine; online: boolean } = $props();

	type Integration = { target: string; label: string; command: string; available: boolean; state: 'not_installed' | 'current' | 'outdated' };

	let list = $state<Integration[] | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state<string | null>(null);
	/** Agents that aren't on the machine are listed only on request. */
	let showAll = $state(false);
	const shown = $derived(list ? (showAll ? list : list.filter((i) => i.available || i.state !== 'not_installed')) : []);
	const hidden = $derived((list?.length ?? 0) - shown.length);
	let confirm = $state<{ open: boolean; item: Integration | null; action: 'install' | 'uninstall' }>({ open: false, item: null, action: 'install' });

	async function load() {
		problem = null;
		try {
			const res = await fetch(`/api/machines/${machine.id}/integrations`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				problem = body.message ?? "Couldn't read the integrations.";
				list = [];
				return;
			}
			// Agents that are installed first, then by name (HuntHub's names where it has them).
			list = (body.integrations as Integration[])
				.map((i) => ({ ...i, label: AGENT_KINDS.find((k) => k.kind === i.target)?.label ?? i.label }))
				.sort((a, b) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label));
		} catch {
			problem = 'Could not reach HuntHub.';
			list = [];
		}
	}

	// Loaded when the machine comes online (the machine object itself changes with every stats sample).
	$effect(() => {
		if (online) untrack(() => void load());
		else {
			list = [];
			problem = 'The machine is offline.';
		}
	});

	async function run(item: Integration, action: 'install' | 'uninstall') {
		busy = item.target;
		const res = await fetch(`/api/machines/${machine.id}/integrations/${item.target}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action })
		}).catch(() => null);
		const body = res ? await res.json().catch(() => ({})) : {};
		busy = null;
		if (!res?.ok) {
			toast.error(`${item.label}: ${action === 'install' ? 'install' : 'removal'} failed`, { description: body.message ?? 'Could not reach HuntHub.' });
			return;
		}
		const messages = (body.result?.details?.messages as string[] | undefined) ?? [];
		toast.success(action === 'install' ? `${item.label} integration installed` : `${item.label} integration removed`, {
			description: messages.join(' ') || undefined
		});
		await load();
	}

	const stateBadge = (i: Integration) =>
		i.state === 'current'
			? { label: 'Installed', variant: 'secondary' as const }
			: i.state === 'outdated'
				? { label: 'Outdated', variant: 'outline' as const }
				: { label: 'Not installed', variant: 'outline' as const };
</script>

<Card.Root class="mt-6">
	<Card.Header>
		<Card.Title>Agent integrations</Card.Title>
		<Card.Description>
			Herdr's status hooks in each agent's settings on {machine.name}. With them, Herdr knows exactly when an agent works, waits for you or
			finishes; without them it reads the agent's screen.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if list === null}
			<div class="flex flex-col gap-2">
				{#each [0, 1, 2] as i (i)}<Skeleton class="h-8 w-full" />{/each}
			</div>
		{:else if problem}
			<p class="text-sm text-muted-foreground">{problem}</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Agent</Table.Head>
						<Table.Head>Integration</Table.Head>
						<Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shown as i (i.target)}
						{@const badge = stateBadge(i)}
						<Table.Row class={i.available ? '' : 'text-muted-foreground'}>
							<Table.Cell>
								<span class="font-medium">{i.label}</span>
								{#if !i.available}<span class="ms-2 text-xs">not on this machine</span>{/if}
							</Table.Cell>
							<Table.Cell><Badge variant={badge.variant}>{badge.label}</Badge></Table.Cell>
							<Table.Cell class="text-right">
								{#if busy === i.target}
									<Spinner class="ms-auto" />
								{:else if i.state === 'not_installed'}
									<Button size="sm" variant="outline" disabled={!i.available || !!busy} onclick={() => (confirm = { open: true, item: i, action: 'install' })}>
										Install
									</Button>
								{:else}
									<div class="flex justify-end gap-2">
										{#if i.state === 'outdated'}
											<Button size="sm" variant="outline" disabled={!!busy} onclick={() => (confirm = { open: true, item: i, action: 'install' })}>Update</Button>
										{/if}
										<Button size="sm" variant="ghost" disabled={!!busy} onclick={() => (confirm = { open: true, item: i, action: 'uninstall' })}>Remove</Button>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			{#if hidden > 0 || showAll}
				<Button size="sm" variant="ghost" class="mt-2 text-muted-foreground" onclick={() => (showAll = !showAll)}>
					{showAll ? 'Hide agents not on this machine' : `Show ${hidden} more (not on this machine)`}
				</Button>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={confirm.open}
	title={confirm.action === 'install' ? `Install the ${confirm.item?.label ?? ''} integration?` : `Remove the ${confirm.item?.label ?? ''} integration?`}
	description={confirm.action === 'install'
		? `Herdr adds its status hooks to ${confirm.item?.label ?? 'the agent'}'s settings for the user the runner works as on ${machine.name}. Agents started afterwards report their status to Herdr exactly.`
		: `Herdr removes its hooks from ${confirm.item?.label ?? 'the agent'}'s settings on ${machine.name}; it goes back to reading the agent's screen.`}
	confirmLabel={confirm.action === 'install' ? 'Install' : 'Remove'}
	onConfirm={() => confirm.item && run(confirm.item, confirm.action)}
/>
