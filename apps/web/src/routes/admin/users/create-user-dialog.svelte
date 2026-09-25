<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { toastAuthError } from '$lib/auth-errors';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PasswordInput from '$lib/components/password-input.svelte';
	import * as Select from '$lib/components/ui/select/index.js';

	let { onCreated }: { onCreated: () => void } = $props();

	const roleOptions = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	] as const;

	let open = $state(false);
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let role = $state<'admin' | 'member'>('member');
	let submitting = $state(false);

	const roleLabel = $derived(roleOptions.find((o) => o.value === role)?.label);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		const { error } = await authClient.admin.createUser({ name, email, password, role });
		submitting = false;
		if (error) return toastAuthError(error, 'Failed to create user');
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
		<form onsubmit={submit}>
			<Field.Group>
				<Field.Field>
					<Field.Label for="new-name">Name</Field.Label>
					<Input id="new-name" autocomplete="off" required bind:value={name} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="new-email">Email</Field.Label>
					<Input id="new-email" type="email" autocomplete="off" spellcheck={false} required bind:value={email} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="new-password">Password</Field.Label>
					<PasswordInput id="new-password" autocomplete="new-password" minlength={12} required bind:value={password} />
					<Field.Description>At least 12 characters.</Field.Description>
				</Field.Field>
				<Field.Field>
					<Field.Label for="new-role">Role</Field.Label>
					<Select.Root type="single" bind:value={role}>
						<Select.Trigger id="new-role" class="w-full">{roleLabel}</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each roleOptions as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Dialog.Footer>
					<Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create user'}</Button>
				</Dialog.Footer>
			</Field.Group>
		</form>
	</Dialog.Content>
</Dialog.Root>
