<script lang="ts" module>
	export type FormField = { name: string; label: string; placeholder?: string; description?: string; required?: boolean; value?: string };
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	/** A small dialog with a few text fields; `onSubmit` returns true to close. */
	let {
		open = $bindable(false),
		title,
		description,
		fields,
		submitLabel,
		onSubmit
	}: {
		open?: boolean;
		title: string;
		description?: string;
		fields: FormField[];
		submitLabel: string;
		onSubmit: (values: Record<string, string>) => Promise<boolean>;
	} = $props();

	let values = $state<Record<string, string>>({});
	let busy = $state(false);

	$effect(() => {
		if (open) values = Object.fromEntries(fields.map((f) => [f.name, f.value ?? '']));
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		const done = await onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
		busy = false;
		if (done) open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
		</Dialog.Header>
		<form onsubmit={submit}>
			<Field.Group>
				{#each fields as f (f.name)}
					<Field.Field>
						<Field.Label for="form-{f.name}">{f.label}</Field.Label>
						<Input id="form-{f.name}" placeholder={f.placeholder} required={f.required} autocomplete="off" spellcheck={false} bind:value={values[f.name]} />
						{#if f.description}<Field.Description>{f.description}</Field.Description>{/if}
					</Field.Field>
				{/each}
				<Dialog.Footer>
					<Button type="submit" disabled={busy}>{busy ? 'Working…' : submitLabel}</Button>
				</Dialog.Footer>
			</Field.Group>
		</form>
	</Dialog.Content>
</Dialog.Root>
