<script lang="ts" module>
	export type RosterKey = 'name' | 'level' | 'talents' | 'ilvl' | 'kills' | 'deaths' | 'seen';
</script>

<script lang="ts">
	// Kompakten pogled seznama: ena vrstica na junaka. Sortira stran (sort.apply pred listanjem).
	import * as Table from '#lib/components/ui/table/index.js';
	import SortHead from '#lib/components/table/SortHead.svelte';
	import type { TableSort } from '#lib/sort.svelte.js';
	import type { RosterEntry } from '#lib/types.js';
	import { ago, classColor, fmt } from '#lib/wow.js';
	import Locked from './Locked.svelte';

	/** allowed(f): ali gledalec vidi polje (člani vse, obiskovalci samo javna) */
	let {
		rows,
		allowed,
		sort,
		onsort
	}: {
		rows: RosterEntry[];
		allowed: (field: string) => boolean;
		sort: TableSort<RosterKey>;
		onsort?: () => void;
	} = $props();
	const head = 'h-[34px] text-[11px] tracking-wider text-muted-foreground uppercase';
</script>

<div class="wow-frame h-full overflow-hidden rounded-lg">
	<Table.Root>
		<Table.Header class="bg-background/40" onclick={() => onsort?.()}>
			<Table.Row class="hover:bg-transparent">
				<SortHead {sort} key="name" first="asc" class="{head} px-3">Hero</SortHead>
				<SortHead {sort} key="level" align="right" class={head}>Lvl</SortHead>
				<SortHead {sort} key="talents" first="asc" class="{head} hidden md:table-cell"
					>Talents</SortHead
				>
				<SortHead {sort} key="ilvl" align="right" class={head}>ilvl</SortHead>
				<SortHead {sort} key="kills" align="right" class="{head} hidden sm:table-cell"
					>Kills</SortHead
				>
				<SortHead {sort} key="deaths" align="right" class="{head} hidden sm:table-cell"
					>Deaths</SortHead
				>
				<SortHead {sort} key="seen" align="right" class="{head} hidden px-3 lg:table-cell"
					>Seen</SortHead
				>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as c (c.slug)}
				{@const s = c.summary}
				{@const color = classColor(s?.classId)}
				<Table.Row class="group relative h-[46px] border-border/40 hover:bg-accent/40">
					<Table.Cell class="px-3 py-1">
						<!-- cela vrstica je klikljiva (povezava čez celico) -->
						<a
							href="/c/{c.slug}"
							class="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 focus-visible:outline-none"
						>
							{#if s?.avatar}
								<img
									src={s.avatar}
									alt=""
									class="size-7 shrink-0 rounded-full border"
									style="border-color: {color}"
									loading="lazy"
								/>
							{:else}
								<span
									class="grid size-7 shrink-0 place-items-center rounded-full border bg-muted text-xs"
									style="border-color: {color}"
								>
									{c.displayName[0]}
								</span>
							{/if}
							<span class="min-w-0">
								<span
									class="block truncate font-medium group-hover:underline"
									style="color: {color}">{c.displayName}</span
								>
								{#if s}
									<span class="block truncate text-[11px] text-muted-foreground"
										>{s.race ?? ''} {s.className ?? ''}</span
									>
								{:else}
									<span class="block text-[11px] text-muted-foreground italic"
										>awaiting Blizzard…</span
									>
								{/if}
							</span>
						</a>
					</Table.Cell>
					<Table.Cell class="text-right font-semibold tabular-nums"
						>{#if !allowed('level')}<Locked compact />{:else}{s?.level ?? '–'}{/if}</Table.Cell
					>
					<Table.Cell class="hidden text-xs text-primary/90 md:table-cell">
						{#if !allowed('talents')}<Locked compact />{:else if s?.talentBuild}{s.talentSpec} ·
							{s.talentBuild}{:else}<span class="text-muted-foreground">–</span>{/if}
					</Table.Cell>
					<Table.Cell class="text-right tabular-nums"
						>{#if !allowed('ilvlEquipped')}<Locked compact />{:else}{s?.ilvlEquipped ??
								'–'}{/if}</Table.Cell
					>
					<Table.Cell class="hidden text-right tabular-nums sm:table-cell"
						>{#if !allowed('kills')}<Locked compact />{:else}{fmt(s?.kills)}{/if}</Table.Cell
					>
					<Table.Cell class="hidden text-right tabular-nums sm:table-cell"
						>{#if !allowed('deaths')}<Locked compact />{:else}{fmt(s?.deaths)}{/if}</Table.Cell
					>
					<Table.Cell class="hidden px-3 text-right text-xs text-muted-foreground lg:table-cell">
						{#if !allowed('lastLogin')}<Locked compact />{:else}{ago(s?.lastLogin)}{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
