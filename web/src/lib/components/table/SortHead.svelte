<script lang="ts" generics="K extends string">
	// Glava stolpca, ki sortira (shadcn Table.Head + gumb). `first` = smer ob prvem kliku.
	import type { Snippet } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import * as Table from '#lib/components/ui/table/index.js';
	import { cn } from '#lib/utils.js';
	import type { SortDir, TableSort } from '#lib/sort.svelte.js';

	let {
		sort,
		key,
		first = 'desc',
		align = 'left',
		class: cls,
		title,
		children
	}: {
		sort: TableSort<K>;
		key: K;
		first?: SortDir;
		align?: 'left' | 'right' | 'center';
		class?: string;
		title?: string;
		children: Snippet;
	} = $props();
	const active = $derived(sort.key === key);
</script>

<Table.Head
	class={cn(align === 'right' && 'text-right', align === 'center' && 'text-center', cls)}
	aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
>
	<button
		type="button"
		{title}
		class={cn(
			'-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			align === 'right' && 'flex-row-reverse',
			active ? 'text-primary' : ''
		)}
		onclick={() => sort.toggle(key, first)}
	>
		{@render children()}
		{#if active}
			{#if sort.dir === 'asc'}<ArrowUp class="size-3.5" />{:else}<ArrowDown class="size-3.5" />{/if}
		{:else}
			<ChevronsUpDown class="size-3.5 opacity-40" />
		{/if}
	</button>
</Table.Head>
