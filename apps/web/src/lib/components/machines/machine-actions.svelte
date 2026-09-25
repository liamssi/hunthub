<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import { toast } from 'svelte-sonner';
	import type { Machine } from '@hunthub/shared/machines';
	import { goto } from '$app/navigation';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { machine }: { machine: Machine } = $props();

	let editOpen = $state(false);
	let name = $state('');
	let tags = $state('');
	let confirm = $state<'disable' | 'remove' | null>(null);
	let confirmShown = $state<'disable' | 'remove'>('disable');
	let busy = $state(false);

	$effect(() => {
		if (confirm) confirmShown = confirm;
	});

	async function call(path: string, init: RequestInit = {}) {
		busy = true;
		const res = await fetch(`/api/machines/${machine.id}${path}`, {
			headers: { 'content-type': 'application/json' },
			...init
		});
		busy = false;
		const body = await res.json().catch(() => ({}));
		if (!res.ok) toast.error(body.message ?? 'Action failed');
		return res.ok;
	}

	function openEdit() {
		name = machine.name;
		tags = machine.tags.join(', ');
		editOpen = true;
	}

	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		const ok = await call('', {
			method: 'PATCH',
			body: JSON.stringify({
				name,
				tags: tags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean)
			})
		});
		if (ok) {
			editOpen = false;
			toast.success('Machine updated');
		}
	}

	async function enable() {
		if (await call('/enable', { method: 'POST' })) toast.success(`${machine.name} enabled`);
	}

	async function rotate() {
		if (await call('/rotate-credential', { method: 'POST' })) toast.success('Credential rotated');
	}

	async function confirmAction() {
		const action = confirm;
		confirm = null;
		if (action === 'disable') {
			if (await call('/disable', { method: 'POST' })) toast.success(`${machine.name} disabled`);
		} else if (action === 'remove') {
			if (await call('', { method: 'DELETE' })) {
				toast.success(`${machine.name} removed`, {
					description: 'On the machine, run: hunthub-runner uninstall',
					duration: 15_000
				});
				await goto('/machines');
			}
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger disabled={busy}>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="icon" aria-label="Machine actions"><EllipsisIcon /></Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Group>
			<DropdownMenu.Item onSelect={openEdit}>Rename or tag</DropdownMenu.Item>
			<DropdownMenu.Item disabled={machine.connection !== 'online'} onSelect={rotate}>Rotate credential</DropdownMenu.Item>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		<DropdownMenu.Group>
			{#if machine.status === 'disabled'}
				<DropdownMenu.Item onSelect={enable}>Enable</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item onSelect={() => (confirm = 'disable')}>Disable</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item variant="destructive" onSelect={() => (confirm = 'remove')}>Remove</DropdownMenu.Item>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename or tag</Dialog.Title>
			<Dialog.Description>Changes only how the machine appears in HuntHub.</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={saveEdit}>
			<Field.Group>
				<Field.Field>
					<Field.Label for="edit-name">Name</Field.Label>
					<Input id="edit-name" autocomplete="off" required maxlength={100} bind:value={name} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="edit-tags">Tags</Field.Label>
					<Input id="edit-tags" autocomplete="off" bind:value={tags} />
					<Field.Description>Comma-separated.</Field.Description>
				</Field.Field>
				<Dialog.Footer><Button type="submit" disabled={busy}>Save</Button></Dialog.Footer>
			</Field.Group>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={confirm !== null} onOpenChange={(o) => !o && (confirm = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			{#if confirmShown === 'disable'}
				<AlertDialog.Title>Disable {machine.name}?</AlertDialog.Title>
				<AlertDialog.Description>
					The runner is disconnected and can't reconnect until you enable the machine again. Anything running on
					the machine keeps running.
				</AlertDialog.Description>
			{:else}
				<AlertDialog.Title>Remove {machine.name}?</AlertDialog.Title>
				<AlertDialog.Description>
					Its credential is revoked and its stats history is deleted. Anything running on the machine keeps running.
					To add it again later, use a new install command.
				</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={confirmShown === 'remove' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
				onclick={confirmAction}>{confirmShown === 'disable' ? 'Disable' : 'Remove'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
