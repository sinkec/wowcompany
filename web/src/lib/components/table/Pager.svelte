<script lang="ts">
	// Oštevilčene strani (shadcn Pagination) + izbira števila na stran. `page` je od 1 naprej.
	import * as Pagination from '#lib/components/ui/pagination/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	let {
		count,
		perPage = $bindable(),
		page = $bindable(),
		sizes = [5, 10, 20],
		label = 'per page'
	}: {
		count: number;
		perPage: number;
		page: number;
		sizes?: number[];
		label?: string;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="How many {label}"
			bind:value={
				() => String(perPage),
				(v) => {
					if (!v) return;
					perPage = Number(v);
					page = 1;
				}
			}
		>
			{#each sizes as n (n)}<ToggleGroup.Item value={String(n)}>{n}</ToggleGroup.Item>{/each}
		</ToggleGroup.Root>
		<span>{label}</span>
	</div>
	{#if count > perPage}
		<Pagination.Root {count} {perPage} bind:page class="mx-0 w-auto">
			{#snippet children({ pages, currentPage })}
				<Pagination.Content>
					<Pagination.Item><Pagination.Previous /></Pagination.Item>
					{#each pages as p (p.key)}
						{#if p.type === 'ellipsis'}
							<Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
						{:else}
							<Pagination.Item>
								<Pagination.Link page={p} isActive={currentPage === p.value}
									>{p.value}</Pagination.Link
								>
							</Pagination.Item>
						{/if}
					{/each}
					<Pagination.Item><Pagination.Next /></Pagination.Item>
				</Pagination.Content>
			{/snippet}
		</Pagination.Root>
	{/if}
</div>
