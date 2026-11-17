<script lang="ts">
	// Naslednji dogodki (naslovnica): ena vrstica na dogodek – datum, naslov, čas, kdo pride.
	// Klik odpre dogodek v koledarju.
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Users from '@lucide/svelte/icons/users';
	import type { CalendarEvent } from '#convex/calendar.js';
	import { KIND_EMOJI, KIND_TONE, fmtSpan, whenLabel } from '#lib/calendar.js';

	let { events, loading = false }: { events: CalendarEvent[]; loading?: boolean } = $props();
	const month = new Intl.DateTimeFormat('en-GB', { month: 'short' });
</script>

{#if loading}
	<div class="space-y-2 p-3">
		{#each [1, 2, 3, 4] as i (i)}<div class="h-11 animate-pulse rounded-md bg-muted"></div>{/each}
	</div>
{:else if !events.length}
	<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
		<CalendarDays class="size-8 text-primary/70" />
		<p class="text-sm text-muted-foreground">
			Nothing planned. The Guild Master is "thinking about it". In-game holidays show up once
			someone logs in with the Companion running.
		</p>
	</div>
{:else}
	<ul class="divide-y divide-border/40">
		{#each events as e (e.id)}
			<li>
				<a
					href="/calendar?event={e.id}"
					class="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/40"
				>
					<div
						class="grid w-10 shrink-0 place-items-center rounded-md border py-0.5 leading-none {KIND_TONE[
							e.kind
						] ?? ''}"
					>
						<span class="text-[0.6rem] font-semibold tracking-wider uppercase"
							>{month.format(e.startAt)}</span
						>
						<span class="font-display text-base font-bold">{new Date(e.startAt).getDate()}</span>
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold group-hover:text-primary">
							<span aria-hidden="true">{KIND_EMOJI[e.kind]}</span>
							{e.title}
						</p>
						<p class="truncate text-xs text-muted-foreground">
							{fmtSpan(e)}{e.source === 'game' ? ' · in the game' : ''}
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
