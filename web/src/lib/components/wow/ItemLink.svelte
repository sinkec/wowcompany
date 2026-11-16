<script lang="ts">
	// Predmet iz loota/rollov kot v igri: [ime] v barvi kakovosti, ob hoverju isti tooltip kot oprema
	// junaka (ItemTooltip). Podatki pridejo iz igre (addon 0.6.2+ → Companion), ker spletni API
	// predmetov WoW Forever nima.
	import * as HoverCard from '#lib/components/ui/hover-card/index.js';
	import ItemTooltip from './ItemTooltip.svelte';
	import type { TooltipLine } from '#lib/types.js';

	type Detail = {
		itemId: number;
		ilvl: number | null;
		reqLevel: number | null;
		slot: string | null;
		kind: string | null;
		subkind: string | null;
		sell: number | null;
		bind: string | null;
		lines: string[];
	};
	let {
		name,
		color,
		detail = null
	}: { name: string; color: string; detail?: Detail | null } = $props();

	const GREEN = '#1eff00';
	const lines = $derived.by(() => {
		const out: TooltipLine[] = [];
		const add = (text: string, color: string | null = null, right: string | null = null) =>
			out.push({ text, color, right });
		add(name);
		if (!detail) {
			add('No details yet – they come with the next drop looted with the addon 0.6.2+.', '#9d9d9d');
			return out;
		}
		if (detail.ilvl) add(`Item Level ${detail.ilvl}`, '#ffd100');
		if (detail.bind) add(detail.bind);
		if (detail.slot || detail.subkind) add(detail.slot ?? '', null, detail.subkind);
		for (const l of detail.lines) {
			// binding in slot sta že zgoraj
			if (l === detail.bind || (detail.slot && l.startsWith(detail.slot))) continue;
			add(l, /^\+|^Equip:|^Use:|^Chance on hit:/.test(l) ? GREEN : null);
		}
		if (detail.reqLevel && detail.reqLevel > 1)
			add(`Requires Level ${detail.reqLevel}`);
		if (detail.sell) {
			const c = detail.sell;
			const parts = [
				[Math.floor(c / 10000), 'g'],
				[Math.floor(c / 100) % 100, 's'],
				[c % 100, 'c']
			]
				.filter(([n]) => n)
				.map(([n, u]) => `${n}${u}`);
			add(`Sell Price: ${parts.join(' ')}`);
		}
		return out;
	});
</script>

<HoverCard.Root openDelay={60} closeDelay={40}>
	<HoverCard.Trigger class="cursor-default" style="color: {color}">[{name}]</HoverCard.Trigger>
	<HoverCard.Content side="right" class="wow-tooltip w-72 p-3 text-sm">
		<ItemTooltip {lines} {color} />
	</HoverCard.Content>
</HoverCard.Root>
