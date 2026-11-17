<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { ask } from '#lib/confirm.svelte.js';
	// Office → Website → Events: naši dogodki na koledarju (nov, uredi, briši) + stanje praznikov iz igre.
	// Discord: objava ob shranjevanju in opomnik uro prej (če je kljukica in polje "calendar" za Discord).
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import SimpleSelect from '#lib/components/form/SimpleSelect.svelte';
	import DateTimePicker from '#lib/components/form/DateTimePicker.svelte';
	import { fromParts, partsOf } from '#lib/datetime.svelte.js';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import {
		EVENT_KINDS,
		KIND_EMOJI,
		KIND_LABEL,
		KIND_TONE,
		fmtSpan,
		hourNow
	} from '#lib/calendar.js';
	import { attempt } from '#lib/errors.js';
	import { ago } from '#lib/wow.js';

	let { discordOn }: { discordOn: boolean } = $props();
	const client = useConvexClient();
	const data = useQuery(api.calendar.forAdmin, { from: hourNow() });

	// naslednji večer ob 20:00 v uporabnikovem pasu (danes, če je še pred 19:00)
	function nextEvening() {
		const p = partsOf(Date.now());
		return fromParts(p.y, p.m, p.d + (p.h >= 19 ? 1 : 0), 20, 0);
	}

	type Form = {
		id?: Id<'calendarEvents'>;
		title: string;
		kind: string;
		start: number;
		end: number;
		location: string;
		description: string;
		discord: boolean;
	};
	const blank = (): Form => {
		const s = nextEvening();
		return {
			title: '',
			kind: 'dungeon',
			start: s,
			end: s + 3 * 3600_000,
			location: '',
			description: '',
			discord: true
		};
	};
	let form = $state<Form>(blank());
	let saving = $state(false);

	function edit(e: NonNullable<typeof data.data>['events'][number]) {
		form = {
			id: e.id as Id<'calendarEvents'>,
			title: e.title,
			kind: e.kind,
			start: e.startAt,
			end: e.endAt,
			location: e.location ?? '',
			description: e.description,
			discord: e.discord
		};
		document.getElementById('event-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		const r = await attempt(
			client.mutation(api.calendar.save, {
				...(form.id ? { id: form.id } : {}),
				title: form.title,
				kind: form.kind,
				startAt: form.start,
				endAt: form.end,
				description: form.description,
				...(form.location.trim() ? { location: form.location } : {}),
				discord: form.discord
			})
		);
		saving = false;
		if (!r) return;
		toast.success(
			form.id
				? 'Event updated.'
				: form.discord && discordOn
					? 'On the calendar and shouted in Discord.'
					: 'On the calendar.'
		);
		form = blank();
	}
	async function remove(id: string, title: string) {
		if (
			!(await ask({
				title: `Delete "${title}"?`,
				description: 'Sign-ups go with it.',
				confirm: 'Delete',
				destructive: true
			}))
		)
			return;
		await attempt(
			client.mutation(api.calendar.remove, { id: id as Id<'calendarEvents'> }),
			'Deleted. It never happened.'
		);
		if (form.id === id) form = blank();
	}

	const now = Date.now();
	const upcoming = $derived((data.data?.events ?? []).filter((e) => e.endAt >= now));
	const past = $derived((data.data?.events ?? []).filter((e) => e.endAt < now).reverse());
</script>

<div class="max-w-3xl space-y-4">
	<form id="event-form" class="panel space-y-3" onsubmit={save}>
		<div class="flex items-center justify-between gap-2">
			<h3 class="card-title">{form.id ? 'Edit event' : 'New event'}</h3>
			{#if form.id}<Button variant="ghost" size="sm" onclick={() => (form = blank())}>Cancel</Button
				>{/if}
		</div>
		<div class="grid gap-3 sm:grid-cols-[1fr_11rem]">
			<label class="space-y-1 text-sm">
				<span class="text-muted-foreground">Title</span>
				<Input
					bind:value={form.title}
					maxlength={80}
					placeholder="Deadmines, no tank, pray"
					required
				/>
			</label>
			<div class="space-y-1 text-sm">
				<span class="text-muted-foreground">Type</span>
				<SimpleSelect
					bind:value={form.kind}
					label="Type"
					options={EVENT_KINDS.map((k) => ({
						value: k,
						label: `${KIND_EMOJI[k]} ${KIND_LABEL[k]}`
					}))}
				/>
			</div>
		</div>
		<div class="grid gap-3 md:grid-cols-2">
			<div class="space-y-1 text-sm">
				<span class="text-muted-foreground">Starts</span>
				<!-- premik začetka premakne tudi konec (ista dolžina) -->
				<DateTimePicker
					label="Starts"
					bind:value={
						() => form.start,
						(v) => {
							form.end += v - form.start;
							form.start = v;
						}
					}
				/>
			</div>
			<div class="space-y-1 text-sm">
				<span class="text-muted-foreground">Ends</span>
				<DateTimePicker label="Ends" bind:value={form.end} />
			</div>
			<label class="space-y-1 text-sm md:col-span-2">
				<span class="text-muted-foreground">Where (optional)</span>
				<Input bind:value={form.location} maxlength={60} placeholder="Westfall, meet at the inn" />
			</label>
		</div>
		<label class="block space-y-1 text-sm">
			<span class="text-muted-foreground">Details (optional)</span>
			<Textarea
				bind:value={form.description}
				maxlength={600}
				rows={3}
				placeholder="Bring potions. Bring a healer. Bring dignity, optionally."
			/>
		</label>
		<label class="flex items-start gap-2 text-sm">
			<Checkbox bind:checked={form.discord} class="mt-0.5" />
			<span>
				Announce in Discord now, remind one hour before
				{#if !discordOn}
					<span class="block text-xs text-amber-300">
						Calendar is switched off for Discord (Discord → Posts → “Company events on the
						calendar”).
					</span>
				{/if}
			</span>
		</label>
		<div class="flex justify-end">
			<Button type="submit" disabled={saving} class="gap-1.5">
				{#if !form.id}<Plus class="size-4" />{/if}{form.id ? 'Save changes' : 'Add to calendar'}
			</Button>
		</div>
	</form>

	<Card.Root class="space-y-3 p-5">
		<div class="flex items-end justify-between gap-2">
			<h3 class="card-title">Coming up</h3>
			<a href="/calendar" class="text-sm text-primary hover:underline">Open the calendar →</a>
		</div>
		{#if !upcoming.length}
			<p class="text-sm text-muted-foreground italic">
				Nothing planned. The company is getting restless.
			</p>
		{/if}
		<ul class="divide-y divide-border/50">
			{#each upcoming as e (e.id)}
				<li class="flex flex-wrap items-center gap-3 py-2">
					<span class="rounded-full border px-2 py-0.5 text-xs {KIND_TONE[e.kind]}"
						>{KIND_EMOJI[e.kind]} {KIND_LABEL[e.kind]}</span
					>
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium">{e.title}</p>
						<p class="text-xs text-muted-foreground">
							{fmtSpan(e)}
							{#if e.announcedAt}· posted {ago(e.announcedAt)}{/if}
							{#if e.remindedAt}· reminded{/if}
						</p>
					</div>
					<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"
						><Users class="size-3.5" />{e.going.length}</span
					>
					{#if e.discord}<Badge variant="secondary">Discord</Badge>{/if}
					<Button variant="ghost" size="icon" aria-label="Edit {e.title}" onclick={() => edit(e)}
						><Pencil class="size-4" /></Button
					>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Delete {e.title}"
						onclick={() => remove(e.id, e.title)}><Trash class="size-4" /></Button
					>
				</li>
			{/each}
		</ul>
		{#if past.length}
			<Collapsible.Root class="text-sm">
				<Collapsible.Trigger
					class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground [&[data-state=open]>svg]:rotate-90"
					><ChevronRight class="size-4 transition-transform" /> Last 30 days ({past.length})</Collapsible.Trigger
				>
				<Collapsible.Content>
					<ul class="mt-2 space-y-1">
						{#each past as e (e.id)}
							<li class="flex items-center gap-2 text-muted-foreground">
								<span class="flex-1 truncate"
									>{KIND_EMOJI[e.kind]} {e.title} · {fmtSpan(e)} · {e.going.length} went</span
								>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Delete {e.title}"
									onclick={() => remove(e.id, e.title)}><Trash class="size-4" /></Button
								>
							</li>
						{/each}
					</ul>
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
	</Card.Root>

	<Card.Root class="space-y-1 p-5 text-sm">
		<h3 class="card-title">In-game holidays</h3>
		<p class="text-muted-foreground">
			{#if data.data?.gameCount}
				{data.data.gameCount} upcoming from the game's calendar, last read {ago(
					data.data.gameUpdatedAt ?? 0
				)}.
			{:else}
				None yet. The addon (0.6.8+) reads the in-game calendar when someone logs in; the Companion
				sends it here after the next logout or <code>/reload</code>.
			{/if}
		</p>
	</Card.Root>
</div>
