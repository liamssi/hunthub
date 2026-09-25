<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { toastAuthError } from '$lib/auth-errors';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { data } = $props();

	// Edited in seconds / days; the API stores milliseconds.
	// Form fields start from the loaded settings and are then edited locally.
	let heartbeat = $derived(data.connection.heartbeatIntervalMs / 1000);
	let offlineAfter = $derived(data.connection.offlineAfterMs / 1000);
	let statsInterval = $derived(data.connection.statsIntervalMs / 1000);
	let minuteDays = $derived(data.retention.minuteRetentionDays);
	let hourDays = $derived<number | null>(data.retention.hourRetentionDays);
	let keepHoursForever = $derived(data.retention.hourRetentionDays === null);

	let saving = $state<'connection' | 'retention' | null>(null);

	async function put(path: string, body: unknown, what: 'connection' | 'retention') {
		saving = what;
		const res = await fetch(`/api/settings/machines/${path}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		saving = null;
		const json = await res.json().catch(() => ({}));
		if (!res.ok) return toastAuthError(json, 'Could not save settings');
		toast.success('Settings saved');
		await invalidateAll();
	}

	const saveConnection = (e: SubmitEvent) => {
		e.preventDefault();
		void put(
			'connection',
			{
				heartbeatIntervalMs: Math.round(heartbeat * 1000),
				offlineAfterMs: Math.round(offlineAfter * 1000),
				statsIntervalMs: Math.round(statsInterval * 1000)
			},
			'connection'
		);
	};

	const saveRetention = (e: SubmitEvent) => {
		e.preventDefault();
		void put(
			'retention',
			{ minuteRetentionDays: minuteDays, hourRetentionDays: keepHoursForever ? null : hourDays },
			'retention'
		);
	};

	const offlineTooShort = $derived(offlineAfter < heartbeat * 3);
</script>

<svelte:head><title>Settings · HuntHub</title></svelte:head>

<h1 class="text-2xl font-semibold">Settings</h1>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<Card.Root>
		<Card.Header>
			<Card.Title>Machine connections</Card.Title>
			<Card.Description>How often runners report in. Changes apply to connected machines immediately.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={saveConnection}>
				<Field.Group>
					<Field.Field>
						<Field.Label for="heartbeat">Heartbeat interval (seconds)</Field.Label>
						<Input id="heartbeat" type="number" min="0.5" max="60" step="0.5" required bind:value={heartbeat} />
					</Field.Field>
					<Field.Field data-invalid={offlineTooShort || undefined}>
						<Field.Label for="offline-after">Offline after (seconds without contact)</Field.Label>
						<Input
							id="offline-after"
							type="number"
							min="1"
							max="600"
							step="1"
							required
							aria-invalid={offlineTooShort || undefined}
							bind:value={offlineAfter}
						/>
						<Field.Description>
							{offlineTooShort ? 'Must be at least 3 heartbeats.' : 'Lower values detect outages faster but can flag brief network blips.'}
						</Field.Description>
					</Field.Field>
					<Field.Field>
						<Field.Label for="stats-interval">Stats interval (seconds)</Field.Label>
						<Input id="stats-interval" type="number" min="1" max="60" step="1" required bind:value={statsInterval} />
					</Field.Field>
					<Button type="submit" class="justify-self-start" disabled={saving === 'connection' || offlineTooShort}>
						{saving === 'connection' ? 'Saving…' : 'Save'}
					</Button>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Stats history</Card.Title>
			<Card.Description>How long machine resource history is kept.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={saveRetention}>
				<Field.Group>
					<Field.Field>
						<Field.Label for="minute-days">1-minute detail (days)</Field.Label>
						<Input id="minute-days" type="number" min="1" max="365" step="1" required bind:value={minuteDays} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="hour-days">Hourly history (days)</Field.Label>
						<Input
							id="hour-days"
							type="number"
							min="1"
							max="36500"
							step="1"
							disabled={keepHoursForever}
							required={!keepHoursForever}
							bind:value={hourDays}
						/>
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={keepHoursForever} class="size-4" />
							Keep forever
						</label>
					</Field.Field>
					<Button type="submit" class="justify-self-start" disabled={saving === 'retention'}>
						{saving === 'retention' ? 'Saving…' : 'Save'}
					</Button>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>
</div>
