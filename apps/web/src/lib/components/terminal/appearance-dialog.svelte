<script lang="ts">
	// Terminal font, size and colors. Every open terminal updates as you choose.
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';
	import {
		FONT_SIZES,
		appearance,
		clampSize,
		fontFamily,
		loadAppearance,
		resetAppearance,
		saveAppearance,
		terminalFonts,
		terminalThemes,
		type TerminalFontId,
		type TerminalThemeId
	} from '$lib/terminal-appearance.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	$effect(() => {
		if (open) loadAppearance();
	});

	const setFont = (id: string) => {
		if (!terminalFonts.some((f) => f.id === id)) return;
		appearance.font = id as TerminalFontId;
		saveAppearance();
	};
	const setSize = (n: number) => {
		appearance.size = clampSize(n);
		saveAppearance();
	};
	const setTheme = (id: TerminalThemeId) => {
		appearance.theme = id;
		saveAppearance();
	};
	const swatches = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Terminal appearance</Dialog.Title>
			<Dialog.Description>Applies to every terminal in this browser, as you choose.</Dialog.Description>
		</Dialog.Header>

		<Field.FieldGroup>
			<div class="grid gap-4 sm:grid-cols-[1fr_auto]">
				<Field.Field>
					<Field.FieldLabel for="terminal-font">Font</Field.FieldLabel>
					<Select.Root type="single" value={appearance.font} onValueChange={setFont}>
						<Select.Trigger id="terminal-font" class="w-full" style="font-family: {fontFamily(appearance.font)}">
							{terminalFonts.find((f) => f.id === appearance.font)?.label}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each terminalFonts as f (f.id)}
									<Select.Item value={f.id} label={f.label}><span style="font-family: {f.family}">{f.label}</span></Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.FieldLabel>Size</Field.FieldLabel>
					<div class="flex items-center gap-1">
						<Button size="icon" variant="outline" aria-label="Smaller" disabled={appearance.size <= FONT_SIZES.min} onclick={() => setSize(appearance.size - 1)}>
							<MinusIcon />
						</Button>
						<span class="w-12 text-center text-sm tabular-nums" aria-live="polite">{appearance.size} px</span>
						<Button size="icon" variant="outline" aria-label="Larger" disabled={appearance.size >= FONT_SIZES.max} onclick={() => setSize(appearance.size + 1)}>
							<PlusIcon />
						</Button>
					</div>
				</Field.Field>
			</div>

			<Field.FieldSet>
				<Field.FieldLegend variant="label">Colors</Field.FieldLegend>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Color theme">
					{#each terminalThemes as t (t.id)}
						{@const selected = appearance.theme === t.id}
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							class={cn(
								'flex flex-col gap-2 rounded-lg border p-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
								selected ? 'border-foreground/60' : 'hover:border-foreground/30'
							)}
							style="background-color: {t.colors.background}; color: {t.colors.foreground}"
							onclick={() => setTheme(t.id)}
						>
							<span class="flex items-center justify-between gap-2 text-xs font-medium" style="font-family: {fontFamily(appearance.font)}">
								{t.label}
								{#if selected}<CheckIcon class="size-3.5" aria-hidden="true" />{/if}
							</span>
							<span class="flex gap-1" aria-hidden="true">
								{#each swatches as c (c)}
									<span class="size-3 rounded-full" style="background-color: {t.colors[c]}"></span>
								{/each}
							</span>
						</button>
					{/each}
				</div>
			</Field.FieldSet>
		</Field.FieldGroup>

		<Dialog.Footer>
			<Button variant="ghost" onclick={resetAppearance}>Reset to defaults</Button>
			<Dialog.Close>
				{#snippet child({ props })}<Button {...props}>Done</Button>{/snippet}
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
