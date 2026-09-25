<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let { onCreated }: { onCreated: () => void } = $props();

	let open = $state(false);
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let role = $state<'admin' | 'member'>('member');
	let submitting = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		const { error } = await authClient.admin.createUser({ name, email, password, role });
		submitting = false;
		if (error) return toast.error(error.message ?? 'Failed to create user');
		toast.success(`Created ${email}`);
		open = false;
		name = email = password = '';
		role = 'member';
		onCreated();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}<Button {...props}>New user</Button>{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>New user</Dialog.Title>
			<Dialog.Description>Share the password with them; they can change it from their account page.</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={submit} class="grid gap-4">
			<div class="grid gap-2">
				<Label for="new-name">Name</Label>
				<Input id="new-name" required bind:value={name} />
			</div>
			<div class="grid gap-2">
				<Label for="new-email">Email</Label>
				<Input id="new-email" type="email" required bind:value={email} />
			</div>
			<div class="grid gap-2">
				<Label for="new-password">Password</Label>
				<Input id="new-password" type="password" autocomplete="new-password" minlength={8} required bind:value={password} />
			</div>
			<div class="grid gap-2">
				<Label>Role</Label>
				<Select.Root type="single" bind:value={role}>
					<Select.Trigger class="w-full">{role}</Select.Trigger>
					<Select.Content>
						<Select.Item value="member" label="member" />
						<Select.Item value="admin" label="admin" />
					</Select.Content>
				</Select.Root>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create user'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
