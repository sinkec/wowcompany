<script lang="ts">
	// Settings → Account → Time & date: časovni pas, 12h/24h, oblika datuma. Shrani se takoj (profil),
	// velja za vse datume na strani (lib/datetime.svelte.ts) in za izbiro časa dogodkov.
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '#convex/_generated/api.js';
	import { DATE_FORMATS, formatYmd, type DateFormat } from '#convex/lib/timePrefs.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import SimpleSelect from '#lib/components/form/SimpleSelect.svelte';
	import { attempt } from '#lib/errors.js';
	import {
		browserTimeZone,
		fmtWhen,
		partsOf,
		setTimePrefs,
		timePrefs
	} from '#lib/datetime.svelte.js';

	const client = useConvexClient();
	const browser = browserTimeZone();
	const zones = (() => {
		try {
			return Intl.supportedValuesOf('timeZone');
		} catch {
			return [browser];
		}
	})();
	const zoneOptions = [
		{ value: '', label: `Automatic – this device (${browser.replace(/_/g, ' ')})` },
		...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))
	];
	// primer datuma v vsaki obliki: današnji dan
	const today = partsOf(Date.now());

	async function save(patch: Partial<typeof timePrefs>, what: string) {
		const next = { ...timePrefs, ...patch };
		const before = { ...timePrefs };
		setTimePrefs(next); // takoj na strani, strežnik potrdi
		const ok = await attempt(
			client.mutation(api.profile.setTimePrefs, {
				timeZone: next.timeZone,
				hour12: next.hour12,
				dateFormat: next.dateFormat
			})
		);
		if (ok === undefined) setTimePrefs(before);
		else toast.success(what);
	}
</script>

<Card.Root class="space-y-4 p-5">
	<div>
		<h2 class="section-title">Time & date</h2>
		<p class="text-sm text-muted-foreground">
			How every date and time on the site is shown – runs, the calendar, event times you pick. Right
			now: <b class="text-foreground">{fmtWhen(Date.now())}</b>
		</p>
	</div>
	<div class="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
		<span class="text-sm font-medium">Time zone</span>
		<SimpleSelect
			label="Time zone"
			class="w-full max-w-md"
			options={zoneOptions}
			bind:value={
				() => timePrefs.timeZone ?? '',
				(v) =>
					save({ timeZone: v || null }, `Time zone: ${v ? v.replace(/_/g, ' ') : 'automatic'}.`)
			}
		/>

		<span class="text-sm font-medium">Clock</span>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="Clock"
			bind:value={
				() => (timePrefs.hour12 ? '12' : '24'),
				(v) => v && save({ hour12: v === '12' }, v === '12' ? '12-hour clock.' : '24-hour clock.')
			}
		>
			<ToggleGroup.Item value="24">24h · 20:00</ToggleGroup.Item>
			<ToggleGroup.Item value="12">12h · 8:00 PM</ToggleGroup.Item>
		</ToggleGroup.Root>

		<span class="text-sm font-medium">Date format</span>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			class="flex-wrap"
			aria-label="Date format"
			bind:value={
				() => timePrefs.dateFormat,
				(v) => v && save({ dateFormat: v as DateFormat }, `Dates as ${v}.`)
			}
		>
			{#each DATE_FORMATS as f (f)}
				<ToggleGroup.Item value={f} aria-label={f}
					>{formatYmd(today.y, today.m, today.d, f)}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</div>
</Card.Root>
