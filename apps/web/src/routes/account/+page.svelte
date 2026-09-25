<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	type Session = { id: string; token: string; createdAt: Date; ipAddress?: string | null; userAgent?: string | null };

	let currentPassword = $state('');
	let newPassword = $state('');
	let saving = $state(false);
	let sessions = $state<Session[]>([]);

	const currentSessionId = $derived(page.data.session?.id);

	async function loadSessions() {
		const { data, error } = await authClient.listSessions();
		if (error) return toast.error(error.message ?? 'Failed to load sessions');
		sessions = data as Session[];
	}

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
		saving = false;
		if (error) return toast.error(error.message ?? 'Failed to change password');
		toast.success('Password changed; other sessions were signed out');
		currentPassword = newPassword = '';
		await loadSessions();
	}

	async function revoke(s: Session) {
		const { error } = await authClient.revokeSession({ token: s.token });
		if (error) return toast.error(error.message ?? 'Failed to revoke session');
		await loadSessions();
	}

	async function revokeOthers() {
		const { error } = await authClient.revokeOtherSessions();
		if (error) return toast.error(error.message ?? 'Failed to revoke sessions');
		toast.success('Signed out of other sessions');
		await loadSessions();
	}

	onMount(loadSessions);
</script>

<h1 class="text-2xl font-semibold">Account</h1>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<Card.Root>
		<Card.Header>
			<Card.Title>Change password</Card.Title>
			<Card.Description>Other sessions are signed out when you change it.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={changePassword} class="grid gap-4">
				<div class="grid gap-2">
					<Label for="current-password">Current password</Label>
					<Input id="current-password" type="password" autocomplete="current-password" required bind:value={currentPassword} />
				</div>
				<div class="grid gap-2">
					<Label for="new-password">New password</Label>
					<Input id="new-password" type="password" autocomplete="new-password" minlength={8} required bind:value={newPassword} />
				</div>
				<Button type="submit" disabled={saving} class="justify-self-start">{saving ? 'Saving…' : 'Change password'}</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Sessions</Card.Title>
			<Card.Description>Where you're signed in.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#each sessions as s (s.id)}
				<div class="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3 text-sm">
					<div class="min-w-0">
						<div class="truncate">{s.userAgent ?? 'Unknown device'}</div>
						<div class="truncate text-muted-foreground">
							{s.ipAddress ?? 'unknown IP'} · since {new Date(s.createdAt).toLocaleString()}
						</div>
					</div>
					{#if s.id === currentSessionId}
						<Badge variant="secondary" class="shrink-0">This session</Badge>
					{:else}
						<Button variant="outline" size="sm" class="shrink-0" onclick={() => revoke(s)}>Revoke</Button>
					{/if}
				</div>
			{/each}
			{#if sessions.length > 1}
				<Button variant="outline" class="justify-self-start" onclick={revokeOthers}>Sign out of all other sessions</Button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
