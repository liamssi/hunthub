<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let { user = $bindable() }: { user: { id: string; name: string } | null } = $props();

	let password = $state('');
	let submitting = $state(false);

	function close() {
		user = null;
		password = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!user) return;
		submitting = true;
		const { error } = await authClient.admin.setUserPassword({ userId: user.id, newPassword: password });
		submitting = false;
		if (error) return toast.error(error.message ?? 'Failed to reset password');
		toast.success(`Password reset for ${user.name}`);
		close();
	}
</script>

<Dialog.Root open={user !== null} onOpenChange={(o) => !o && close()}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Reset password</Dialog.Title>
			<Dialog.Description>Set a new password for {user?.name}.</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={submit} class="grid gap-4">
			<div class="grid gap-2">
				<Label for="reset-password">New password</Label>
				<Input id="reset-password" type="password" autocomplete="new-password" minlength={8} required bind:value={password} />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Set password'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
