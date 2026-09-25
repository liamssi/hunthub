<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { toastAuthError } from '$lib/auth-errors';
	import { describeUserAgent } from '$lib/user-agent';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import PasswordInput from '$lib/components/password-input.svelte';
	import type { AccountSession } from './+page.server';

	let { data } = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let saving = $state(false);
	let revokingId = $state<string | null>(null);

	const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
		saving = false;
		if (error) return toastAuthError(error, 'Failed to change password');
		toast.success('Password changed; other sessions were signed out');
		currentPassword = newPassword = '';
		// Changing the password replaces the current session; reload everything.
		await invalidateAll();
	}

	async function revoke(s: AccountSession) {
		revokingId = s.id;
		const { error } = await authClient.revokeSession({ token: s.token });
		revokingId = null;
		if (error) return toastAuthError(error, 'Failed to revoke session');
		toast.success('Session signed out');
		await invalidate('app:sessions');
	}

	async function revokeOthers() {
		const { error } = await authClient.revokeOtherSessions();
		if (error) return toastAuthError(error, 'Failed to revoke sessions');
		toast.success('Signed out of other sessions');
		await invalidate('app:sessions');
	}
</script>

<svelte:head><title>Account · HuntHub</title></svelte:head>

<h1 class="text-2xl font-semibold">Account</h1>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<Card.Root>
		<Card.Header>
			<Card.Title>Change password</Card.Title>
			<Card.Description>Other sessions are signed out when you change it.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={changePassword}>
				<!-- Tells password managers which account this form is for. -->
				<input type="text" name="username" autocomplete="username" value={data.user?.email} hidden readonly />
				<Field.Group>
					<Field.Field>
						<Field.Label for="current-password">Current password</Field.Label>
						<PasswordInput id="current-password" autocomplete="current-password" required bind:value={currentPassword} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="new-password">New password</Field.Label>
						<PasswordInput id="new-password" autocomplete="new-password" minlength={12} required bind:value={newPassword} />
						<Field.Description>At least 12 characters.</Field.Description>
					</Field.Field>
					<Button type="submit" disabled={saving} class="justify-self-start">{saving ? 'Saving…' : 'Change password'}</Button>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Sessions</Card.Title>
			<Card.Description>Where you're signed in.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#each data.sessions as s (s.id)}
				<div class="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3 text-sm">
					<div class="min-w-0">
						<div class="truncate font-medium" title={s.userAgent ?? undefined}>{describeUserAgent(s.userAgent)}</div>
						<div class="truncate text-muted-foreground">
							{s.ipAddress || 'Unknown IP'} · signed in {formatDate.format(new Date(s.createdAt))}
						</div>
					</div>
					{#if s.id === data.session?.id}
						<Badge variant="secondary" class="shrink-0">This session</Badge>
					{:else}
						<Button variant="outline" size="sm" class="shrink-0" disabled={revokingId === s.id} onclick={() => revoke(s)}>
							{revokingId === s.id ? 'Revoking…' : 'Revoke'}
						</Button>
					{/if}
				</div>
			{/each}
			{#if data.sessions.length > 1}
				<Button variant="outline" class="justify-self-start" onclick={revokeOthers}>Sign out of all other sessions</Button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
