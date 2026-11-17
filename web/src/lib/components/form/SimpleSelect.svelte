<script lang="ts">
	// shadcn Select za preprost seznam možnosti (vrednost + napis), z bind:value.
	import * as Select from '#lib/components/ui/select/index.js';

	let {
		value = $bindable(),
		options,
		placeholder = 'Pick one',
		class: cls = 'w-full',
		label
	}: {
		value: string;
		options: readonly { value: string; label: string }[];
		placeholder?: string;
		class?: string;
		/** dostopno ime (če ni vidnega <label>) */
		label?: string;
	} = $props();
	const current = $derived(options.find((o) => o.value === value)?.label);
</script>

<Select.Root type="single" bind:value>
	<Select.Trigger class={cls} aria-label={label}>
		<span class={current ? '' : 'text-muted-foreground'}>{current ?? placeholder}</span>
	</Select.Trigger>
	<Select.Content>
		{#each options as o (o.value)}
			<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
