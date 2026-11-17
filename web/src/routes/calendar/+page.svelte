<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import Tip from '#lib/components/wow/Tip.svelte';
	// Koledar: mesec v mreži (pon–ned), ob strani izbrani dogodek ali dan. Naši dogodki (Guild Master,
	// Office → Website → Events) + prazniki iz igre (addon → Companion). Člani se prijavijo.
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Users from '@lucide/svelte/icons/users';
	import Lock from '@lucide/svelte/icons/lock';
	import { api } from '#convex/_generated/api.js';
	import type { CalendarEvent } from '#convex/calendar.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import {
		KIND_DOT,
		KIND_EMOJI,
		KIND_LABEL,
		KIND_TONE,
		fmtDay,
		fmtSpan,
		onDayOf,
		startOfDay,
		whenLabel
	} from '#lib/calendar.js';
	import { errText } from '#lib/errors.js';
	import { MONTH_NAMES, addDays, fromParts, partsOf } from '#lib/datetime.svelte.js';

	const client = useConvexClient();
	const me = useQuery(api.auth.me, {});

	// ---- mesec iz URL (?m=2026-11), privzeto današnji; dnevi v uporabnikovem časovnem pasu
	const pad = (n: number) => String(n).padStart(2, '0');
	const monthOf = (ms: number) => {
		const p = partsOf(ms);
		return `${p.y}-${pad(p.m)}`;
	};
	const current = $derived.by(() => {
		const m = /^(\d{4})-(\d{2})$/.exec(page.url.searchParams.get('m') ?? '');
		if (m) return { y: Number(m[1]), m: Number(m[2]) };
		const p = partsOf(Date.now());
		return { y: p.y, m: p.m };
	});
	const first = $derived(fromParts(current.y, current.m, 1));
	const next = $derived(fromParts(current.y, current.m + 1, 1));
	// mreža od ponedeljka pred 1. do nedelje po zadnjem dnevu
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const gridStart = $derived(addDays(first, -WEEKDAYS.indexOf(partsOf(first).weekday)));
	const weeks = $derived(Math.ceil(Math.round((next - gridStart) / 86_400_000) / 7));
	const days = $derived(Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i)));
	const range = useQuery(api.calendar.range, () => ({
		from: gridStart,
		to: addDays(days.at(-1)!, 1)
	}));
	const events = $derived(range.data?.events ?? []);

	const onDay = (day: number) =>
		events
			.filter((e) => onDayOf(e, day))
			.sort(
				(a, b) =>
					(a.source === 'company' ? 0 : 1) - (b.source === 'company' ? 0 : 1) ||
					a.startAt - b.startAt
			);

	function goMonth(delta: number) {
		const u = new URL(page.url.href);
		u.searchParams.set('m', monthOf(fromParts(current.y, current.m + delta, 15)));
		u.searchParams.delete('event');
		goto(u, { replace: true, reset: false });
	}
	function goToday() {
		const u = new URL(page.url.href);
		u.searchParams.delete('m');
		u.searchParams.delete('event');
		selectedDay = startOfDay(Date.now());
		goto(u, { replace: true, reset: false });
	}

	// ---- izbira: dogodek (?event=) ali dan
	const today = startOfDay(Date.now());
	let selectedDay = $state(startOfDay(Date.now()));
	const eventId = $derived(page.url.searchParams.get('event'));
	const selected = $derived(events.find((e) => e.id === eventId) ?? null);
	// dogodek iz povezave (naslovnica, Discord) v drugem mesecu: preskoči na njegov mesec
	const linked = useQuery(api.calendar.upcoming, () =>
		eventId && range.data && !selected ? { from: today - 40 * 86_400_000, limit: 20 } : 'skip'
	);
	$effect(() => {
		const hit = linked.data?.find((e) => e.id === eventId);
		if (hit && monthOf(hit.startAt) !== monthOf(first)) {
			const u = new URL(page.url.href);
			u.searchParams.set('m', monthOf(hit.startAt));
			goto(u, { replace: true, reset: false });
		}
	});
	function pick(e: CalendarEvent) {
		const u = new URL(page.url.href);
		u.searchParams.set('event', e.id);
		selectedDay = startOfDay(Math.max(e.startAt, gridStart));
		goto(u, { replace: true, reset: false });
	}
	function pickDay(day: number) {
		selectedDay = day;
		if (eventId) {
			const u = new URL(page.url.href);
			u.searchParams.delete('event');
			goto(u, { replace: true, reset: false });
		}
	}
	const dayEvents = $derived(onDay(selectedDay));

	let busy = $state(false);
	async function rsvp(e: CalendarEvent, going: boolean) {
		busy = true;
		try {
			await client.mutation(api.calendar.rsvp, { id: e.id as Id<'calendarEvents'>, going });
			toast.success(going ? "You're in. No backing out now." : 'Out. Coward. (Noted.)');
		} catch (err) {
			toast.error(errText(err));
		}
		busy = false;
	}

	const monthName = $derived(`${MONTH_NAMES[current.m - 1]} ${current.y}`);
	const inMonth = (day: number) => partsOf(day).m === current.m;
</script>

<svelte:head><title>Calendar — WowCompany</title></svelte:head>

<div class="space-y-6">
	<PageHeader
		title="Calendar"
		icon={CalendarDays}
		lead="Our dungeon nights, raids and tavern evenings, plus everything the game celebrates. Sign up, show up, die gloriously."
	>
		{#snippet actions()}
			<Button variant="outline" size="icon" aria-label="Previous month" onclick={() => goMonth(-1)}
				><ChevronLeft class="size-4" /></Button
			>
			<span class="min-w-36 text-center font-display text-lg font-semibold">{monthName}</span>
			<Button variant="outline" size="icon" aria-label="Next month" onclick={() => goMonth(1)}
				><ChevronRight class="size-4" /></Button
			>
			<Button variant="ghost" onclick={goToday}>Today</Button>
		{/snippet}
	</PageHeader>

	{#if range.data?.hidden}
		<p class="flex items-center gap-2 text-sm text-muted-foreground">
			<Lock class="size-4" /> Our own events are members-only. You see the in-game holidays.
		</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
		<!-- mesec -->
		<Card.Root class="overflow-hidden">
			<div class="grid grid-cols-7 border-b border-border/60 bg-muted/30">
				{#each WEEKDAYS as w (w)}
					<div class="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">{w}</div>
				{/each}
			</div>
			<div class="grid grid-cols-7">
				{#each days as day (day)}
					{@const list = onDay(day)}
					{@const isSel = day === selectedDay}
					<div
						class="group relative min-h-20 border-r border-b border-border/40 p-1 text-left transition-colors sm:min-h-28 {inMonth(
							day
						)
							? ''
							: 'bg-muted/20 text-muted-foreground/60'} {isSel
							? 'bg-accent/40'
							: 'hover:bg-accent/20'}"
					>
						<button
							class="absolute inset-0"
							aria-label="Show {fmtDay(day)}"
							onclick={() => pickDay(day)}
						></button>
						<span
							class="relative inline-grid size-6 place-items-center rounded-full text-xs tabular-nums {day ===
							today
								? 'bg-primary font-bold text-primary-foreground'
								: ''}">{partsOf(day).d}</span
						>
						<div class="relative mt-0.5 space-y-0.5">
							{#each list.slice(0, 3) as e (e.id)}
								<Tip as="div" text={e.title} class="w-full">
									<button
										class="flex w-full items-center gap-1 truncate rounded border px-1 py-px text-left text-[0.68rem] leading-tight {KIND_TONE[
											e.kind
										]} {e.id === eventId ? 'ring-1 ring-primary' : ''}"
										aria-label={e.title}
										onclick={() => pick(e)}
									>
										<span class="hidden sm:inline" aria-hidden="true">{KIND_EMOJI[e.kind]}</span>
										<span class="truncate">{e.title}</span>
									</button>
								</Tip>
							{/each}
							{#if list.length > 3}
								<span class="block px-1 text-[0.65rem] text-muted-foreground"
									>+{list.length - 3} more</span
								>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</Card.Root>

		<!-- izbrano -->
		<aside class="space-y-4">
			{#if selected}
				{@const e = selected}
				<article class="panel space-y-3">
					<div class="flex items-start justify-between gap-2">
						<span class="rounded-full border px-2 py-0.5 text-xs font-medium {KIND_TONE[e.kind]}">
							{KIND_EMOJI[e.kind]}
							{KIND_LABEL[e.kind]}
						</span>
						<span class="text-xs font-medium text-primary">{whenLabel(e)}</span>
					</div>
					<h2 class="card-title text-xl">{e.title}</h2>
					<p class="text-sm text-muted-foreground">{fmtSpan(e)}</p>
					{#if e.location}
						<p class="flex items-center gap-1.5 text-sm">
							<MapPin class="size-4 text-primary" />{e.location}
						</p>
					{/if}
					{#if e.description}
						<p class="text-sm whitespace-pre-line">{e.description}</p>
					{/if}
					{#if e.source === 'company'}
						<div class="space-y-2 border-t border-border/60 pt-3">
							<p class="flex items-center gap-1.5 text-sm font-semibold">
								<Users class="size-4 text-primary" /> Going ({e.going.length})
							</p>
							{#if e.going.length}
								<ul class="flex flex-wrap gap-1.5">
									{#each e.going as g (g.name)}
										<li>
											{#if g.slug}
												<a
													href="/c/{g.slug}"
													class="rounded-full bg-muted px-2 py-0.5 text-xs hover:text-primary"
													>{g.name}</a
												>
											{:else}
												<span class="rounded-full bg-muted px-2 py-0.5 text-xs">{g.name}</span>
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="text-xs text-muted-foreground italic">Nobody yet. Be the brave one.</p>
							{/if}
							{#if range.data?.canRsvp && e.endAt > Date.now()}
								<Button
									class="w-full"
									variant={e.imGoing ? 'outline' : 'default'}
									disabled={busy}
									onclick={() => rsvp(e, !e.imGoing)}
								>
									{e.imGoing ? "I'm out" : "I'm in"}
								</Button>
							{:else if !range.data?.canRsvp && !me.data}
								<p class="text-xs text-muted-foreground">
									Members sign up here. <a href="/join" class="text-primary hover:underline"
										>Join the company</a
									>.
								</p>
							{/if}
							{#if me.data?.role === 'admin'}
								<a href="/admin?edit={e.id}#events" class="block text-xs text-primary hover:underline"
									>Edit in the Office →</a
								>
							{/if}
						</div>
					{:else}
						<p class="border-t border-border/60 pt-3 text-xs text-muted-foreground">
							From the in-game calendar, read by the addon of whoever logged in last.
						</p>
					{/if}
				</article>
			{:else}
				<Card.Root class="space-y-3 p-5">
					<h2 class="card-title">{fmtDay(selectedDay)}</h2>
					{#if dayEvents.length}
						<ul class="space-y-2">
							{#each dayEvents as e (e.id)}
								<li>
									<button
										class="flex w-full items-start gap-2 rounded-md p-1.5 text-left hover:bg-accent/40"
										onclick={() => pick(e)}
									>
										<span class="mt-1.5 size-2 shrink-0 rounded-full {KIND_DOT[e.kind]}"></span>
										<span class="min-w-0">
											<span class="block truncate text-sm font-medium">{e.title}</span>
											<span class="block text-xs text-muted-foreground">{fmtSpan(e)}</span>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-muted-foreground italic">Nothing that day. Go farm something.</p>
					{/if}
				</Card.Root>
			{/if}

			<Card.Root class="space-y-2 p-5 text-xs text-muted-foreground">
				<p class="font-semibold text-foreground">Legend</p>
				<ul class="grid grid-cols-2 gap-1.5">
					{#each ['dungeon', 'raid', 'pvp', 'leveling', 'social', 'holiday'] as k (k)}
						<li class="flex items-center gap-1.5">
							<span class="size-2 rounded-full {KIND_DOT[k]}"></span>{KIND_LABEL[k]}
						</li>
					{/each}
				</ul>
			</Card.Root>
		</aside>
	</div>
</div>
