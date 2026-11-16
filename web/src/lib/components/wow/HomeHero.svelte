<script lang="ts">
	// Hero naslovnice: ozadje = slika najnovejše uradne novice (WoW Forever key art), spredaj
	// junaki druščine v celi postavi (Blizzard render). Brez lastnih slik → nič shranjevanja pri nas.
	import Swords from '@lucide/svelte/icons/swords';
	import Download from '@lucide/svelte/icons/download';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { classColor, renderFromAvatar } from '#lib/wow.js';

	type Hero = { slug: string; name: string; level: number | null; classId: number | null; avatar: string | null };
	let {
		backdrop,
		heroes,
		stats
	}: {
		backdrop: string | null;
		heroes: Hero[];
		stats: { label: string; value: string }[];
	} = $props();

	const shown = $derived(
		heroes
			.map((h) => ({ ...h, render: renderFromAvatar(h.avatar) }))
			.filter((h) => h.render)
			.slice(0, 3)
	);
	let broken = $state<Record<string, boolean>>({});
</script>

<section
	class="rise relative isolate overflow-hidden rounded-2xl border border-primary/30 shadow-2xl shadow-black/50"
	aria-label="Welcome"
>
	<!-- ozadje -->
	<div class="absolute inset-0 -z-10 overflow-hidden">
		{#if backdrop}
			<img src={backdrop} alt="" class="drift size-full object-cover opacity-60" />
		{/if}
		<div
			class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.45_0.09_70/40%),transparent_60%)]"
		></div>
		<div
			class="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/20"
		></div>
		<div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent"></div>
	</div>

	<div class="grid min-h-[26rem] items-end gap-6 p-6 sm:p-10 lg:grid-cols-[1.35fr_1fr]">
		<div class="space-y-5 self-center">
			<p class="eyebrow text-primary/90">WoW Forever · EU · a company of friends</p>
			<h1
				class="font-display text-4xl leading-tight font-bold text-primary drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] xl:text-5xl"
			>
				The Company of Questionable Decisions
			</h1>
			<p class="max-w-xl text-base text-foreground/85 md:text-lg">
				Levels, loot, dungeon logs and spectacular deaths of our heroes – live from the game. Mostly
				the deaths.
			</p>
			<div class="flex flex-wrap gap-2">
				<a
					href="/join"
					class="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
					><UserPlus class="size-4" /> Join the company</a
				>
				<a
					href="/runs"
					class="inline-flex h-11 items-center gap-2 rounded-md border border-primary/50 bg-background/50 px-5 text-sm font-semibold backdrop-blur transition hover:bg-accent/60"
					><Swords class="size-4" /> Dungeon runs</a
				>
				<a
					href="/link"
					class="inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground"
					><Download class="size-4" /> Get the Companion</a
				>
			</div>
			{#if stats.length}
				<dl class="flex flex-wrap gap-x-8 gap-y-3 pt-2">
					{#each stats as s (s.label)}
						<div>
							<dt class="stat-label">{s.label}</dt>
							<dd class="stat-value text-foreground">{s.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</div>

		<!-- junaki -->
		{#if shown.length}
			<div class="relative hidden h-[24rem] items-end justify-center overflow-visible lg:flex" aria-hidden="true">
				{#each shown as h, i (h.slug)}
					{#if !broken[h.slug]}
						<a
							href="/c/{h.slug}"
							tabindex="-1"
							class="group relative -mx-6 h-[24rem] w-44 shrink-0 transition duration-500 hover:z-10 hover:-translate-y-2 {i ===
							0
								? 'z-[5] order-2'
								: i === 1
									? 'order-1 scale-90 opacity-90'
									: 'order-3 scale-90 opacity-90'}"
						>
							<!-- render je širok PNG z veliko praznega prostora: center, porezano na širino lika -->
							<img
								src={h.render}
								alt=""
								class="absolute bottom-0 left-1/2 h-[30rem] max-w-none -translate-x-1/2 translate-y-12 drop-shadow-[0_10px_30px_rgba(0,0,0,0.7)]"
								onerror={() => (broken[h.slug] = true)}
							/>
							<span
								class="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/80 px-3 py-0.5 text-xs font-semibold whitespace-nowrap backdrop-blur"
								style="color: {classColor(h.classId ?? undefined)}"
							>
								{h.name}{#if h.level}<span class="ml-1 text-muted-foreground">{h.level}</span>{/if}
							</span>
						</a>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</section>
