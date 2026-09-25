<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	let email = $state('');
	let password = $state('');
	let errorMessage = $state<string | null>(null);
	let submitting = $state(false);

	// Only allow same-site relative redirects.
	function redirectTarget() {
		const to = page.url.searchParams.get('redirectTo') ?? '/';
		return to.startsWith('/') && !to.startsWith('//') ? to : '/';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		errorMessage = null;
		const { error } = await authClient.signIn.email({ email, password });
		submitting = false;
		if (error) {
			errorMessage = error.message ?? 'Sign in failed';
			return;
		}
		await goto(redirectTarget(), { invalidateAll: true });
	}
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title>Sign in to HuntHub</Card.Title>
			<Card.Description>Accounts are created by an admin.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={submit} class="grid gap-4">
				{#if errorMessage}
					<Alert.Root variant="destructive">
						<Alert.Description>{errorMessage}</Alert.Description>
					</Alert.Root>
				{/if}
				<div class="grid gap-2">
					<Label for="email">Email</Label>
					<Input id="email" type="email" autocomplete="username" required bind:value={email} />
				</div>
				<div class="grid gap-2">
					<Label for="password">Password</Label>
					<Input id="password" type="password" autocomplete="current-password" required bind:value={password} />
				</div>
				<Button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
