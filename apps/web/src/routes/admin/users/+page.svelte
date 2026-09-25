<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import CreateUserDialog from './create-user-dialog.svelte';
	import ResetPasswordDialog from './reset-password-dialog.svelte';

	type User = { id: string; name: string; email: string; role?: string | null; banned?: boolean | null; createdAt: Date };

	let users = $state<User[]>([]);
	let loading = $state(true);
	let resetFor = $state<User | null>(null);

	const currentUserId = $derived(page.data.user?.id);

	async function load() {
		const { data, error } = await authClient.admin.listUsers({
			query: { limit: 500, sortBy: 'createdAt', sortDirection: 'asc' }
		});
		loading = false;
		if (error) return toast.error(error.message ?? 'Failed to load users');
		users = data.users as User[];
	}

	async function run(action: Promise<{ error: { message?: string } | null }>, success: string) {
		const { error } = await action;
		if (error) return toast.error(error.message ?? 'Action failed');
		toast.success(success);
		await load();
	}

	const setRole = (u: User, role: 'admin' | 'member') =>
		run(authClient.admin.setRole({ userId: u.id, role }), `${u.name} is now ${role}`);
	const disable = (u: User) => run(authClient.admin.banUser({ userId: u.id }), `${u.name} disabled`);
	const enable = (u: User) => run(authClient.admin.unbanUser({ userId: u.id }), `${u.name} enabled`);
	const revokeSessions = (u: User) =>
		run(authClient.admin.revokeUserSessions({ userId: u.id }), `Signed ${u.name} out everywhere`);

	onMount(load);
</script>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold">Users</h1>
	<CreateUserDialog onCreated={load} />
</div>

<div class="mt-6 rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Email</Table.Head>
				<Table.Head>Role</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head class="w-12"></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if loading}
				<Table.Row><Table.Cell colspan={5} class="text-muted-foreground">Loading…</Table.Cell></Table.Row>
			{/if}
			{#each users as u (u.id)}
				{@const isSelf = u.id === currentUserId}
				<Table.Row>
					<Table.Cell class="font-medium">{u.name}{isSelf ? ' (you)' : ''}</Table.Cell>
					<Table.Cell>{u.email}</Table.Cell>
					<Table.Cell>
						<Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role ?? 'member'}</Badge>
					</Table.Cell>
					<Table.Cell>
						{#if u.banned}<Badge variant="destructive">Disabled</Badge>{:else}<Badge variant="outline">Active</Badge>{/if}
					</Table.Cell>
					<Table.Cell>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="sm" aria-label="Actions for {u.name}">…</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								{#if u.role === 'admin'}
									<DropdownMenu.Item disabled={isSelf} onSelect={() => setRole(u, 'member')}>Make member</DropdownMenu.Item>
								{:else}
									<DropdownMenu.Item onSelect={() => setRole(u, 'admin')}>Make admin</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item onSelect={() => (resetFor = u)}>Reset password</DropdownMenu.Item>
								<DropdownMenu.Item disabled={isSelf} onSelect={() => revokeSessions(u)}>Sign out everywhere</DropdownMenu.Item>
								<DropdownMenu.Separator />
								{#if u.banned}
									<DropdownMenu.Item onSelect={() => enable(u)}>Enable</DropdownMenu.Item>
								{:else}
									<DropdownMenu.Item variant="destructive" disabled={isSelf} onSelect={() => disable(u)}>Disable</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

<ResetPasswordDialog bind:user={resetFor} />
