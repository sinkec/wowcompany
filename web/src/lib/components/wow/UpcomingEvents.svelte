<script lang="ts">
	// Naslednji dogodki (naslovnica): naši + prazniki iz igre, z datumom v "listku" in kdo pride.
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Users from '@lucide/svelte/icons/users';
	import type { CalendarEvent } from '#convex/calendar.js';
	import { KIND_EMOJI, KIND_LABEL, KIND_TONE, fmtSpan, whenLabel } from '#lib/calendar.js';

	let { events, loading = false }: { events: CalendarEvent[]; loading?: boolean } = $props();
	const month = new Intl.DateTimeFormat('en-GB', { month: 'short' });
</script>

<section class="space-y-3" aria-labelledby="upcoming-title">
	<div class="flex items-end justify-between gap-2">
		<div>
			<h2 id="upcoming-title" class="section-title">Coming up</h2>
			<p class="section-lead">Our plans and whatever Azeroth is celebrating.</p>
		</div>
		<a href="/calendar" class="shrink-0 text-sm text-primary hover:underline">Calendar →</a>
	</div>
	{#if loading}
		<div class="space-y-2">
			{#each [1, 2, 3] as i (i)}<div class="h-16 animate-pulse rounded-lg bg-muted"></div>{/each}
		</div>
	{:else if !events.length}
		<div class="wow-frame flex flex-col items-center gap-2 rounded-lg p-8 text-center">
			<CalendarDays class="size-8 text-primary/70" />
			<p class="text-sm text-muted-foreground">
				Nothing planned. The Guild Master is "thinking about it". In-game holidays show up once
				someone logs in with the Companion running.
			</p>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each events as e (e.id)}
				<li>
					<a
						href="/calendar?event={e.id}"
						class="wow-frame group flex items-center gap-3 rounded-lg p-2.5 pr-3 transition hover:border-primary/70"
					>
						<div
							class="grid w-12 shrink-0 place-items-center rounded-md border py-1 text-center leading-none {KIND_TONE[
								e.kind
							] ?? ''}"
						>
							<span class="text-[0.65rem] font-semibold tracking-wider uppercase"
								>{month.format(e.startAt)}</span
							>
							<span class="font-display text-xl font-bold">{new Date(e.startAt).getDate()}</span>
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate font-semibold group-hover:text-primary">
								<span aria-hidden="true">{KIND_EMOJI[e.kind]}</span>
								{e.title}
							</p>
							<p class="truncate text-xs text-muted-foreground">
								{fmtSpan(e)} · {e.source === 'game' ? 'in the game' : KIND_LABEL[e.kind]}
							</p>
						</div>
						<div class="shrink-0 text-right text-xs">
							<p class="font-medium text-primary">{whenLabel(e)}</p>
							{#if e.going.length}
								<p class="mt-0.5 inline-flex items-center gap-1 text-muted-foreground">
									<Users class="size-3" />{e.going.length}
								</p>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
