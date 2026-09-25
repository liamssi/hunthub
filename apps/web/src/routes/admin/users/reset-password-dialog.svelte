<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { toastAuthError } from '$lib/auth-errors';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import PasswordInput from '$lib/components/password-input.svelte';

	let { user = $bindable() }: { user: { id: string; name: string } | null } = $props();

	// Kept separately so the dialog text doesn't change while it animates closed.
	let target = $state<{ id: string; name: string } | null>(null);
	$effect(() => {
		if (user) target = user;
	});

	let password = $state('');
	let submitting = $state(false);

	function close() {
		user = null;
		password = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!target) return;
		submitting = true;
		const { error } = await authClient.admin.setUserPassword({ userId: target.id, newPassword: password });
		submitting = false;
		if (error) return toastAuthError(error, 'Failed to reset password');
		toast.success(`Password reset for ${target.name}; they were signed out everywhere`);
		close();
	}
</script>

<Dialog.Root open={user !== null} onOpenChange={(o) => !o && close()}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Reset password</Dialog.Title>
			<Dialog.Description>Set a new password for {target?.name}. They will be signed out everywhere.</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={submit}>
			<Field.Group>
				<Field.Field>
					<Field.Label for="reset-password">New password</Field.Label>
					<PasswordInput id="reset-password" autocomplete="new-password" minlength={12} required bind:value={password} />
					<Field.Description>At least 12 characters.</Field.Description>
				</Field.Field>
				<Dialog.Footer>
					<Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Set password'}</Button>
				</Dialog.Footer>
			</Field.Group>
		</form>
	</Dialog.Content>
</Dialog.Root>
