<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import { authClient } from '$lib/auth-client';
	import { toastAuthError } from '$lib/auth-errors';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import CreateUserDialog from './create-user-dialog.svelte';
	import ResetPasswordDialog from './reset-password-dialog.svelte';
	import type { AdminUser } from './+page.server';

	let { data } = $props();

	let pendingId = $state<string | null>(null);
	let resetFor = $state<AdminUser | null>(null);

	type Confirmable = { user: AdminUser; kind: 'disable' | 'make-admin' };
	let confirming = $state<Confirmable | null>(null);
	// Kept separately so the dialog text doesn't change while it animates closed.
	let confirmShown = $state<Confirmable | null>(null);
	$effect(() => {
		if (confirming) confirmShown = confirming;
	});

	const currentUserId = $derived(data.user?.id);

	async function run(user: AdminUser, action: () => Promise<{ error: { message?: string; code?: string } | null }>, success: string) {
		pendingId = user.id;
		const { error } = await action();
		pendingId = null;
		if (error) return toastAuthError(error, 'Action failed');
		toast.success(success);
		await invalidate('app:users');
	}

	const makeMember = (u: AdminUser) =>
		run(u, () => authClient.admin.setRole({ userId: u.id, role: 'member' }), `${u.name} is now a member`);
	const enable = (u: AdminUser) => run(u, () => authClient.admin.unbanUser({ userId: u.id }), `${u.name} enabled`);
	const revokeSessions = (u: AdminUser) =>
		run(u, () => authClient.admin.revokeUserSessions({ userId: u.id }), `Signed ${u.name} out everywhere`);

	async function confirmAction() {
		if (!confirming) return;
		const { user, kind } = confirming;
		confirming = null;
		if (kind === 'disable') {
			await run(user, () => authClient.admin.banUser({ userId: user.id }), `${user.name} disabled`);
		} else {
			await run(user, () => authClient.admin.setRole({ userId: user.id, role: 'admin' }), `${user.name} is now an admin`);
		}
	}
</script>

<svelte:head><title>Users · HuntHub</title></svelte:head>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold">Users</h1>
	<CreateUserDialog onCreated={() => invalidate('app:users')} />
</div>

<div class="mt-6 rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head class="hidden sm:table-cell">Email</Table.Head>
				<Table.Head>Role</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.users as u (u.id)}
				{@const isSelf = u.id === currentUserId}
				<Table.Row>
					<Table.Cell class="font-medium">
						{u.name}{isSelf ? ' (you)' : ''}
						<div class="text-xs font-normal text-muted-foreground sm:hidden">{u.email}</div>
					</Table.Cell>
					<Table.Cell class="hidden sm:table-cell">{u.email}</Table.Cell>
					<Table.Cell>
						<Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role ?? 'member'}</Badge>
					</Table.Cell>
					<Table.Cell>
						{#if u.banned}<Badge variant="destructive">Disabled</Badge>{:else}<Badge variant="outline">Active</Badge>{/if}
					</Table.Cell>
					<Table.Cell>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger disabled={pendingId === u.id}>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="icon-sm" aria-label="Actions for {u.name}">
										<EllipsisIcon />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Group>
									{#if u.role === 'admin'}
										<DropdownMenu.Item disabled={isSelf} onSelect={() => makeMember(u)}>Make member</DropdownMenu.Item>
									{:else}
										<DropdownMenu.Item onSelect={() => (confirming = { user: u, kind: 'make-admin' })}>Make admin</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Item onSelect={() => (resetFor = u)}>Reset password</DropdownMenu.Item>
									<DropdownMenu.Item disabled={isSelf} onSelect={() => revokeSessions(u)}>Sign out everywhere</DropdownMenu.Item>
								</DropdownMenu.Group>
								<DropdownMenu.Separator />
								<DropdownMenu.Group>
									{#if u.banned}
										<DropdownMenu.Item onSelect={() => enable(u)}>Enable</DropdownMenu.Item>
									{:else}
										<DropdownMenu.Item variant="destructive" disabled={isSelf} onSelect={() => (confirming = { user: u, kind: 'disable' })}>
											Disable
										</DropdownMenu.Item>
									{/if}
								</DropdownMenu.Group>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row><Table.Cell colspan={5} class="text-muted-foreground">No users yet.</Table.Cell></Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

<ResetPasswordDialog bind:user={resetFor} />

<AlertDialog.Root open={confirming !== null} onOpenChange={(open) => !open && (confirming = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			{#if confirmShown?.kind === 'disable'}
				<AlertDialog.Title>Disable {confirmShown.user.name}?</AlertDialog.Title>
				<AlertDialog.Description>They are signed out everywhere and can't sign in until an admin enables them again.</AlertDialog.Description>
			{:else}
				<AlertDialog.Title>Make {confirmShown?.user.name} an admin?</AlertDialog.Title>
				<AlertDialog.Description>Admins can create and disable users, reset passwords and change roles.</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={confirmShown?.kind === 'disable' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
				onclick={confirmAction}>{confirmShown?.kind === 'disable' ? 'Disable' : 'Make admin'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
