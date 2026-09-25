<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import type { JoinTokenCreated } from '@hunthub/shared/machines';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { subscribeLive } from '$lib/live';

	let open = $state(false);
	let name = $state('');
	let tags = $state('');
	let submitting = $state(false);
	let created = $state<JoinTokenCreated | null>(null);
	let joinedMachineId = $state<string | null>(null);
	let copied = $state(false);

	function reset() {
		name = tags = '';
		created = null;
		joinedMachineId = null;
		copied = false;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		const res = await fetch('/api/machines/join-tokens', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name,
				tags: tags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean)
			})
		});
		submitting = false;
		if (!res.ok) return toast.error('Could not create the install command.');
		created = await res.json();
	}

	// Watch for the runner joining with this token.
	$effect(() => {
		if (!created) return;
		const tokenId = created.tokenId;
		return subscribeLive('machines', (message) => {
			if (message.type === 'enroll.completed' && message.tokenId === tokenId) joinedMachineId = message.machineId;
		});
	});

	async function copy() {
		if (!created) return;
		await navigator.clipboard.writeText(created.installCommand);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const expiresAt = $derived(
		created ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(created.expiresAt)) : ''
	);
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && reset()}>
	<Dialog.Trigger>
		{#snippet child({ props })}<Button {...props}><PlusIcon data-icon="inline-start" />Add machine</Button>{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Add machine</Dialog.Title>
			<Dialog.Description>
				{created
					? 'Run this command on the machine, as the user that should run agents.'
					: 'Name the machine, then run the install command it gives you.'}
			</Dialog.Description>
		</Dialog.Header>

		{#if !created}
			<form onsubmit={submit}>
				<Field.Group>
					<Field.Field>
						<Field.Label for="machine-name">Name</Field.Label>
						<Input id="machine-name" placeholder="vps-01" autocomplete="off" required maxlength={100} bind:value={name} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="machine-tags">Tags</Field.Label>
						<Input id="machine-tags" placeholder="vps, eu" autocomplete="off" bind:value={tags} />
						<Field.Description>Optional, comma-separated.</Field.Description>
					</Field.Field>
					<Dialog.Footer>
						<Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Get install command'}</Button>
					</Dialog.Footer>
				</Field.Group>
			</form>
		{:else}
			<div class="flex flex-col gap-4">
				<div class="relative rounded-md border bg-muted p-3 pr-12">
					<code class="block text-xs break-all">{created.installCommand}</code>
					<Button variant="ghost" size="icon-sm" class="absolute top-2 right-2" onclick={copy} aria-label="Copy install command">
						{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Works once, until {expiresAt}. It installs the HuntHub runner as a user service and connects it to this hub.
				</p>
				{#if joinedMachineId}
					<div class="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
						<span class="flex items-center gap-2"><CheckIcon class="text-emerald-600" />Machine connected</span>
						<Button size="sm" href="/machines/{joinedMachineId}" onclick={() => (open = false)}>Open</Button>
					</div>
				{:else}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderIcon class="animate-spin" />Waiting for the machine to connect…
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
