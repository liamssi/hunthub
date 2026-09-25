<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PasswordInput from '$lib/components/password-input.svelte';
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
			errorMessage = error.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : (error.message ?? 'Sign in failed');
			return;
		}
		await goto(redirectTarget(), { invalidateAll: true });
	}
</script>

<svelte:head><title>Sign in · HuntHub</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title>Sign in to HuntHub</Card.Title>
			<Card.Description>Accounts are created by an admin.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={submit}>
				<Field.Group>
					{#if errorMessage}
						<Alert.Root variant="destructive">
							<Alert.Description>{errorMessage}</Alert.Description>
						</Alert.Root>
					{/if}
					<Field.Field>
						<Field.Label for="email">Email</Field.Label>
						<Input id="email" type="email" autocomplete="username" spellcheck={false} required bind:value={email} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="password">Password</Field.Label>
						<PasswordInput id="password" autocomplete="current-password" required bind:value={password} />
					</Field.Field>
					<Button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>
</div>
