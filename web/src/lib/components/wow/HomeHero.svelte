<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	// Hero naslovnice: ozadje = slika najnovejše uradne novice, spredaj trije naključni junaki v celi
	// postavi (Blizzard render) s sijem v barvi razreda in stripovskimi oblački: tri različne šale ali
	// pogovor treh, oblački se prikazujejo po vrsti, kot bi se pogovarjali. Šale in povezave na skupnost
	// ureja Guild Master (Office → Website → Home page).
	import { onDestroy } from 'svelte';
	import Swords from '@lucide/svelte/icons/swords';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Download from '@lucide/svelte/icons/download';
	import SocialLinks from './SocialLinks.svelte';
	import { classColor, renderFromAvatar } from '#lib/wow.js';
	import { fillLine } from '#convex/lib/siteContent.js';

	type Hero = {
		slug: string;
		name: string;
		level: number | null;
		classId: number | null;
		avatar: string | null;
	};
	let {
		backdrop,
		heroes,
		stats,
		quips,
		convos,
		socials
	}: {
		backdrop: string | null;
		heroes: Hero[];
		stats: { label: string; value: string }[];
		quips: string[];
		convos: string[][];
		socials: { kind: string; url: string; label?: string }[];
	} = $props();

	const shuffle = <T,>(xs: T[]) => {
		const a = [...xs];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	// ---- junaki: trije naključni ob obisku (ne ob vsakem osveževanju rosterja)
	let picked = $state<(Hero & { render: string })[]>([]);
	$effect(() => {
		if (picked.length) return;
		const pool = heroes
			.map((h) => ({ ...h, render: renderFromAvatar(h.avatar) }))
			.filter((h): h is Hero & { render: string } => !!h.render);
		if (pool.length) picked = shuffle(pool).slice(0, 3);
	});
	let broken = $state<Record<string, boolean>>({});
	const shown = $derived(picked.filter((h) => !broken[h.slug]));

	// ---- pogovor: vrstni red govorcev in vrstice; oblački se pojavijo eden za drugim, potem nov krog
	let order = $state<number[]>([]); // indeksi v `shown` v vrstnem redu govorjenja
	let lines = $state<string[]>([]);
	let visible = $state(0); // koliko oblačkov je že vidnih
	let timers: ReturnType<typeof setTimeout>[] = [];
	const first = (name: string) => name.split(/\s+/)[0];

	function script() {
		const n = shown.length;
		if (!n) return;
		order = shuffle([...Array(n).keys()]);
		const names = order.map((i) => first(shown[i].name));
		const useConvo = convos.length > 0 && n === 3 && (quips.length < n || Math.random() < 0.5);
		const raw = useConvo
			? convos[Math.floor(Math.random() * convos.length)]
			: shuffle(quips).slice(0, n);
		lines = raw.map((l, k) => fillLine(l, k, names));
		visible = 0;
		const reduce =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const step = reduce ? 0 : 2200;
		lines.forEach((_, k) => timers.push(setTimeout(() => (visible = k + 1), 600 + k * step)));
		timers.push(setTimeout(() => (visible = 0), 600 + lines.length * step + 6500));
		timers.push(setTimeout(script, 600 + lines.length * step + 7300));
	}
	let started = false;
	$effect(() => {
		if (started || !shown.length || (!quips.length && !convos.length)) return;
		started = true;
		script();
	});
	onDestroy(() => timers.forEach(clearTimeout));

	/** Kateri oblaček pripada junaku na mestu `pos` (in ali je že viden). */
	const bubbleFor = (pos: number) => {
		const k = order.indexOf(pos);
		return k >= 0 && k < visible ? lines[k] : null;
	};
	// postavitev: prvi (glavni) v sredino, ostala dva levo in desno
	const slot = (i: number) =>
		i === 0 ? 'order-2 z-[3]' : i === 1 ? 'order-1 z-[2]' : 'order-3 z-[2]';
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
		<div
			class="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent"
		></div>
	</div>

	<div class="grid items-center gap-4 px-6 pt-5 sm:px-10 lg:grid-cols-[1.15fr_1fr]">
		<div class="space-y-3 pb-5 sm:pb-6">
			<p class="eyebrow text-primary/90">WoW Forever · EU · a company of friends</p>
			<h1
				class="font-display text-3xl leading-tight font-bold text-primary drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] xl:text-[2.35rem]"
			>
				The Company of Questionable Decisions
			</h1>
			<p class="max-w-lg text-[0.95rem] text-foreground/85">
				Levels, loot, dungeon logs and spectacular deaths of our heroes – live from the game. Mostly
				the deaths.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<Button
					href="/join"
					size="lg"
					class="h-11 gap-2 px-4 font-semibold shadow-lg shadow-primary/20"
					><UserPlus class="size-4" /> Join the company</Button
				>
				<Button
					href="/runs"
					variant="outline"
					size="lg"
					class="h-11 gap-2 border-primary/50 bg-background/50 px-4 font-semibold backdrop-blur"
					><Swords class="size-4" /> Dungeon runs</Button
				>
				<Button href="/link" variant="ghost" size="lg" class="h-11 gap-2 text-muted-foreground"
					><Download class="size-4" /> Companion</Button
				>
				{#if socials.length}
					<span class="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true"></span>
					<SocialLinks {socials} />
				{/if}
			</div>
			{#if stats.length}
				<dl class="flex flex-wrap gap-x-6 gap-y-1">
					{#each stats as s (s.label)}
						<div>
							<dt class="stat-label">{s.label}</dt>
							<dd class="stat-value text-xl text-foreground">{s.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</div>

		<!-- junaki -->
		{#if shown.length}
			<div class="relative hidden h-[19rem] items-end justify-center self-end lg:flex">
				{#each shown as h, i (h.slug)}
					{@const c = classColor(h.classId ?? undefined)}
					{@const said = bubbleFor(i)}
					<a
						href="/c/{h.slug}"
						class="group relative mx-0.5 h-full w-40 shrink-0 {slot(i)} hover:z-10"
						aria-label={h.name}
					>
						<!-- sij iz sredine lika v barvi razreda -->
						<div
							class="glow pointer-events-none absolute top-[13.3rem] left-1/2 h-[17rem] w-[13.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
							style="background: radial-gradient(closest-side, {c} 0%, {c}cc 40%, {c}55 70%, transparent 100%)"
						></div>
						<!-- render: širok PNG, lik v sredini (x 42–62 %, y 34–81 %); 31rem slika = lik ~14.5rem, glava ~6rem pod vrhom (prostor za oblaček) -->
						<img
							src={h.render}
							alt=""
							class="pointer-events-none absolute bottom-0 left-1/2 h-[31rem] max-w-none -translate-x-1/2 translate-y-[7.5rem] drop-shadow-[0_10px_30px_rgba(0,0,0,0.7)] transition-transform duration-500 group-hover:translate-y-[7.1rem]"
							onerror={() => (broken[h.slug] = true)}
						/>
						<span
							class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/80 px-3 py-0.5 text-xs font-semibold whitespace-nowrap backdrop-blur transition group-hover:border-primary/70"
							style="color: {c}"
						>
							{h.name}{#if h.level}<span class="ml-1 text-muted-foreground">{h.level}</span>{/if}
						</span>
						<!-- stripovski oblaček nad glavo -->
						{#if said}
							<div
								class="bubble pointer-events-none absolute left-1/2 z-20 w-max max-w-[9.5rem] {i ===
								0
									? 'top-0'
									: 'top-[0.9rem]'} -translate-x-1/2 rounded-[1.1rem] border-2 border-[#1a1208] bg-[#fff8e6] px-2.5 py-1.5 text-center text-[0.75rem] leading-snug font-semibold text-[#1a1208] shadow-[3px_3px_0_#1a1208]"
								role="status"
							>
								{said}
								<span
									class="absolute -bottom-[9px] left-1/2 size-4 -translate-x-1/2 rotate-45 border-r-2 border-b-2 border-[#1a1208] bg-[#fff8e6]"
								></span>
							</div>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</section>

<style>
	.bubble {
		animation: pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) both;
		transform-origin: 50% 100%;
	}
	@keyframes pop {
		/* Tailwind -translate-x-1/2 je lastnost `translate`, ne `transform` – tu samo skala */
		from {
			opacity: 0;
			transform: scale(0.6) translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.glow {
		animation: breathe 4s ease-in-out infinite alternate;
	}
	@keyframes breathe {
		to {
			transform: scale(1.12);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bubble,
		.glow {
			animation: none;
		}
	}
</style>
