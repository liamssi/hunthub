<script lang="ts">
	// Connects (or reconnects) the user's HackerOne account with an API token.
	// The hub checks the token with HackerOne before keeping it, encrypted.
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';
	import type { PlatformAccountView } from '@hunthub/shared/programs';
	import PasswordInput from '$lib/components/password-input.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';

	let {
		open = $bindable(false),
		username: current = '',
		onconnected
	}: { open?: boolean; username?: string; onconnected: (account: PlatformAccountView) => void } = $props();

	let username = $state('');
	let token = $state('');
	let submitting = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		username = current;
		token = '';
		problem = null;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		problem = null;
		const res = await fetch('/api/platform-accounts/hackerone', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: username.trim(), token: token.trim() })
		}).catch(() => null);
		submitting = false;
		const body = await res?.json().catch(() => null);
		if (!res?.ok) {
			problem = body?.message ?? "Couldn't connect HackerOne.";
			return;
		}
		token = '';
		open = false;
		toast.success('HackerOne connected; your programs are syncing');
		onconnected(body.account);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{current ? 'Update HackerOne token' : 'Connect HackerOne'}</Dialog.Title>
			<Dialog.Description>
				HuntHub reads the programs your account can access, private ones included. It never submits anything. The token is stored encrypted and only you see these programs.
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={submit}>
			<Field.FieldGroup>
				<Field.Field>
					<Field.FieldLabel for="h1-username">API username</Field.FieldLabel>
					<Input id="h1-username" bind:value={username} autocomplete="off" spellcheck={false} required />
					<Field.FieldDescription>The identifier shown with the token, usually your HackerOne username.</Field.FieldDescription>
				</Field.Field>
				<Field.Field data-invalid={problem ? true : undefined}>
					<Field.FieldLabel for="h1-token">API token</Field.FieldLabel>
					<PasswordInput id="h1-token" bind:value={token} autocomplete="off" required />
					{#if problem}
						<Field.FieldError>{problem}</Field.FieldError>
					{:else}
						<Field.FieldDescription>
							Create one under
							<a class="inline-flex items-center gap-0.5 underline underline-offset-2" href="https://hackerone.com/settings/api_token/edit" target="_blank" rel="noopener noreferrer">
								Settings → API token<ExternalLinkIcon class="size-3" aria-hidden="true" />
							</a>
							on HackerOne.
						</Field.FieldDescription>
					{/if}
				</Field.Field>
			</Field.FieldGroup>
			<Dialog.Footer class="mt-6">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={submitting || !username.trim() || !token.trim()}>
					{#if submitting}<Spinner data-icon="inline-start" />Checking…{:else}Connect{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
