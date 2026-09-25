<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	let { user }: { user: NonNullable<App.Locals['user']> } = $props();

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto('/login');
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="sm">{user.name}</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-56">
		<DropdownMenu.Label>
			<div class="text-sm font-medium">{user.name}</div>
			<div class="text-xs font-normal text-muted-foreground">{user.email}</div>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => goto('/account')}>Account</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={signOut}>Sign out</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
