<script lang="ts">
	// Novice: uradne WoW Forever novice (dnevno) + novice druščine (patch, sezona, Guild Master).
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { ago } from '#lib/wow.js';

	type News = {
		id: string;
		source: 'blizzard' | 'company';
		title: string;
		summary: string;
		url: string | null;
		image: string | null;
		publishedAt: number;
	};
	let { news }: { news: News[] } = $props();

	const lead = $derived(news.find((n) => n.image) ?? news[0]);
	const rest = $derived(news.filter((n) => n !== lead).slice(0, 5));
	const external = (u: string | null) => !!u && /^https:/.test(u);
</script>

{#snippet tag(n: News)}
	{#if n.source === 'company'}
		<span class="eyebrow inline-flex items-center gap-1 text-primary"
			><Megaphone class="size-3" /> Company</span
		>
	{:else}
		<span class="eyebrow">WoW Forever</span>
	{/if}
	<span class="text-xs text-muted-foreground">· {ago(n.publishedAt)}</span>
{/snippet}

{#if lead}
	<section class="space-y-3" aria-labelledby="news-title">
		<div class="flex items-end justify-between gap-2">
			<div>
				<h2 id="news-title" class="section-title">News from Azeroth</h2>
				<p class="section-lead">Straight from Blizzard, plus whatever the company did this time.</p>
			</div>
			<a
				href="https://worldofwarcraft.blizzard.com/en-gb/news"
				target="_blank"
				rel="noopener noreferrer"
				class="hidden text-sm text-primary hover:underline sm:inline">All official news →</a
			>
		</div>
		<div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
			<a
				href={lead.url ?? '#'}
				target={external(lead.url) ? '_blank' : undefined}
				rel={external(lead.url) ? 'noopener noreferrer' : undefined}
				class="group wow-frame relative isolate flex min-h-72 flex-col justify-end overflow-hidden rounded-xl p-5"
			>
				{#if lead.image}
					<img
						src={lead.image}
						alt=""
						loading="lazy"
						class="absolute inset-0 -z-10 size-full object-cover opacity-70 transition duration-700 group-hover:scale-105 group-hover:opacity-90"
					/>
				{/if}
				<div
					class="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/70 to-transparent"
				></div>
				<div class="flex items-center gap-2">{@render tag(lead)}</div>
				<h3 class="mt-1 font-display text-xl font-bold text-foreground group-hover:text-primary md:text-2xl">
					{lead.title}
					{#if external(lead.url)}<ExternalLink class="ml-1 inline size-4 opacity-60" />{/if}
				</h3>
				{#if lead.summary}<p class="mt-1 line-clamp-2 text-sm text-foreground/80">{lead.summary}</p>{/if}
			</a>
			<ul class="wow-frame divide-y divide-border/40 rounded-xl">
				{#each rest as n (n.id)}
					<li>
						<a
							href={n.url ?? '#'}
							target={external(n.url) ? '_blank' : undefined}
							rel={external(n.url) ? 'noopener noreferrer' : undefined}
							class="group flex gap-3 p-3 transition-colors hover:bg-accent/30"
						>
							{#if n.image}
								<img
									src={n.image}
									alt=""
									loading="lazy"
									class="h-14 w-24 shrink-0 rounded-md border border-border/50 object-cover"
								/>
							{:else}
								<div
									class="grid h-14 w-24 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10"
								>
									<Megaphone class="size-5 text-primary" />
								</div>
							{/if}
							<div class="min-w-0">
								<div class="flex items-center gap-2">{@render tag(n)}</div>
								<div class="line-clamp-2 text-sm font-medium group-hover:text-primary">{n.title}</div>
							</div>
						</a>
					</li>
				{:else}
					<li class="p-4 text-sm text-muted-foreground italic">Quiet week in Azeroth.</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
