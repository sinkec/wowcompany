<script lang="ts">
	// Kompakten pogled seznama: ena vrstica na junaka (za 20+ junakov).
	import type { RosterEntry } from '#lib/types.js';
	import { ago, classColor, fmt } from '#lib/wow.js';
	import Locked from './Locked.svelte';

	/** allowed(f): ali gledalec vidi polje (člani vse, obiskovalci samo javna) */
	let { rows, allowed }: { rows: RosterEntry[]; allowed: (field: string) => boolean } = $props();
</script>

<div class="wow-frame overflow-hidden rounded-lg">
	<table class="w-full text-sm">
		<thead class="bg-background/40 text-left text-[11px] tracking-wider text-muted-foreground uppercase">
			<tr>
				<th class="px-3 py-2 font-medium">Hero</th>
				<th class="px-2 py-2 text-right font-medium">Lvl</th>
				<th class="hidden px-2 py-2 font-medium md:table-cell">Talents</th>
				<th class="px-2 py-2 text-right font-medium">ilvl</th>
				<th class="hidden px-2 py-2 text-right font-medium sm:table-cell">Kills</th>
				<th class="hidden px-2 py-2 text-right font-medium sm:table-cell">Deaths</th>
				<th class="hidden px-3 py-2 text-right font-medium lg:table-cell">Seen</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as c (c.slug)}
				{@const s = c.summary}
				{@const color = classColor(s?.classId)}
				<tr class="group relative border-t border-border/40 transition-colors hover:bg-accent/40">
					<td class="px-3 py-1.5">
						<!-- cela vrstica je klikljiva (povezava čez celico) -->
						<a href="/c/{c.slug}" class="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 focus-visible:outline-none">
							{#if s?.avatar}
								<img src={s.avatar} alt="" class="size-7 shrink-0 rounded-full border" style="border-color: {color}" loading="lazy" />
							{:else}
								<span class="grid size-7 shrink-0 place-items-center rounded-full border bg-muted text-xs" style="border-color: {color}">
									{c.displayName[0]}
								</span>
							{/if}
							<span class="min-w-0">
								<span class="block truncate font-medium group-hover:underline" style="color: {color}">{c.displayName}</span>
								{#if s}
									<span class="block truncate text-[11px] text-muted-foreground">{s.race ?? ''} {s.className ?? ''}</span>
								{:else}
									<span class="block text-[11px] text-muted-foreground italic">awaiting Blizzard…</span>
								{/if}
							</span>
						</a>
					</td>
					<td class="px-2 py-1.5 text-right font-semibold tabular-nums">{#if !allowed('level')}<Locked compact />{:else}{s?.level ?? '–'}{/if}</td>
					<td class="hidden px-2 py-1.5 text-xs text-primary/90 md:table-cell">
						{#if !allowed('talents')}<Locked compact />{:else if s?.talentBuild}{s.talentSpec} · {s.talentBuild}{:else}<span class="text-muted-foreground">–</span>{/if}
					</td>
					<td class="px-2 py-1.5 text-right tabular-nums">{#if !allowed('ilvlEquipped')}<Locked compact />{:else}{s?.ilvlEquipped ?? '–'}{/if}</td>
					<td class="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{#if !allowed('kills')}<Locked compact />{:else}{fmt(s?.kills)}{/if}</td>
					<td class="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{#if !allowed('deaths')}<Locked compact />{:else}{fmt(s?.deaths)}{/if}</td>
					<td class="hidden px-3 py-1.5 text-right text-xs text-muted-foreground lg:table-cell">
						{#if !allowed('lastLogin')}<Locked compact />{:else}{ago(s?.lastLogin)}{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
