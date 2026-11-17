<script lang="ts">
	// Datum + ura (shadcn Popover + Calendar, ura iz Selecta po 15 min) v uporabnikovem časovnem pasu in
	// obliki (Settings → Account → Time & date). `value` = trenutek v ms.
	import { CalendarDate } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Clock from '@lucide/svelte/icons/clock';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { formatHm } from '#convex/lib/timePrefs.js';
	import { fmtDay, fromParts, partsOf, timePrefs } from '#lib/datetime.svelte.js';
	import { cn } from '#lib/utils.js';

	let { value = $bindable(), label }: { value: number; label: string } = $props();

	let open = $state(false);
	const p = $derived(partsOf(value));
	const minutes = $derived(p.h * 60 + p.min);

	// datum iz koledarja: ura ostane ista
	const date = $derived(new CalendarDate(p.y, p.m, p.d));
	function setDate(d: CalendarDate | undefined) {
		if (!d) return;
		value = fromParts(d.year, d.month, d.day, p.h, p.min);
		open = false;
	}
	// ura: koraki po 15 min (+ trenutna, če ni na koraku)
	const times = $derived.by(() => {
		const set = new Set(Array.from({ length: 96 }, (_, i) => i * 15));
		set.add(minutes);
		return [...set]
			.sort((a, b) => a - b)
			.map((m) => ({
				value: String(m),
				label: formatHm(Math.floor(m / 60), m % 60, timePrefs.hour12)
			}));
	});
	function setTime(v: string) {
		const m = Number(v);
		value = fromParts(p.y, p.m, p.d, Math.floor(m / 60), m % 60);
	}
</script>

<div class="flex gap-2" role="group" aria-label={label}>
	<Popover.Root bind:open>
		<Popover.Trigger
			class={cn(buttonVariants({ variant: 'outline' }), 'min-w-0 flex-1 justify-start font-normal')}
			aria-label="{label}: date"
		>
			<CalendarIcon class="size-4 text-muted-foreground" />
			<span class="truncate">{fmtDay(value)}</span>
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="start">
			<Calendar
				type="single"
				value={date}
				onValueChange={(d) => setDate(d as CalendarDate | undefined)}
				weekStartsOn={1}
				locale="en-GB"
				captionLayout="dropdown"
				initialFocus
			/>
		</Popover.Content>
	</Popover.Root>
	<Select.Root type="single" value={String(minutes)} onValueChange={setTime}>
		<Select.Trigger class="w-28 shrink-0" aria-label="{label}: time">
			<Clock class="size-4 text-muted-foreground" />
			<span>{formatHm(p.h, p.min, timePrefs.hour12)}</span>
		</Select.Trigger>
		<Select.Content class="max-h-64">
			{#each times as t (t.value)}
				<Select.Item value={t.value} label={t.label}>{t.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>
