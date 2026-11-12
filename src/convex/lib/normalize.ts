// Blizzardovi odgovori -> naš stabilen format (povzetek + podrobnosti).
import type { RawCharacter } from './blizzard.js';

export type TooltipLine = { text: string; color: string | null; right: string | null };
export type Item = {
	slot: string;
	slotType: string;
	itemId: number;
	name: string;
	quality: string;
	ilvl: number;
	icon: string | null;
	tooltip: TooltipLine[];
};
export type Stats = Record<string, number | string>;
export type Profession = { name: string; primary: boolean; skill: number; max: number };
export type StatLine = { category: string; name: string; value: number };
export type Talent = { id: number; name: string; rank: number; maxRank: number | null; icon: string | null; description: string };
export type TalentTree = { id: number; name: string; spent: number; talents: Talent[] };
export type TalentCache = {
	info: Map<number, { maxRank: number; icon: string | null }>;
	specs: { id: number; name: string }[] | null;
};

/** Aktivna skupina talentov iz odgovora /specializations. */
function activeTalentSpecs(raw: RawCharacter): any[] {
	const groups = raw.specializations?.specialization_groups ?? [];
	return (groups.find((g: any) => g.is_active) ?? groups[0])?.specializations ?? [];
}

/** Talenti (id + spell id) za predpomnilnik. */
export function talentRefs(raw: RawCharacter): { talentId: number; spellId: number | null }[] {
	return activeTalentSpecs(raw).flatMap((sp: any) =>
		(sp.talents ?? []).map((t: any) => ({ talentId: num(t.talent?.id), spellId: t.spell_tooltip?.spell?.id ?? null }))
	).filter((t: { talentId: number }) => t.talentId > 0);
}

function talents(raw: RawCharacter, cache: TalentCache): { trees: TalentTree[]; build?: string; spec?: string } {
	const active = activeTalentSpecs(raw);
	if (!raw.specializations) return { trees: [] };
	const byId = new Map(active.map((sp: any) => [num(sp.specialization?.id), sp]));
	// vrstni red iz razreda (vključno z drevesi brez točk); sicer samo drevesa iz profila
	const order = cache.specs ?? active.map((sp: any) => ({ id: num(sp.specialization?.id), name: str(sp.specialization_name) }));
	const trees: TalentTree[] = order.map((o) => {
		const sp: any = byId.get(o.id);
		return {
			id: o.id,
			name: str(sp?.specialization_name) || o.name,
			spent: num(sp?.spent_points),
			talents: (sp?.talents ?? []).map((t: any) => {
				const id = num(t.talent?.id);
				const info = cache.info.get(id);
				return {
					id,
					name: str(t.talent?.name),
					rank: num(t.talent_rank),
					maxRank: info?.maxRank ?? null,
					icon: info?.icon ?? null,
					description: str(t.spell_tooltip?.description)
				};
			})
		};
	});
	const spent = trees.reduce((a, t) => a + t.spent, 0);
	if (!spent) return { trees };
	const top = [...trees].sort((a, b) => b.spent - a.spent)[0];
	return { trees, build: trees.map((t) => t.spent).join('/'), spec: top.name };
}

/** (naš ključ, ime statistike v Blizzard en_GB) */
export const COUNTERS: [string, string][] = [
	['kills', 'Total kills'],
	['killing_blows', 'Total Killing Blows'],
	['deaths', 'Total deaths'],
	['falling_deaths', 'Deaths from falling'],
	['quests', 'Quests completed'],
	['dungeons', 'Total 5-player dungeons entered'],
	['food', 'Food eaten'],
	['drinks', 'Beverages consumed'],
	['hearthed', 'Number of times hearthed'],
	['flight_paths', 'Flight paths taken'],
	['fish', 'Fish caught'],
	['bandages', 'Bandages used'],
	['potions', 'Health potions consumed'],
	['need_rolls', 'Need rolls made on loot'],
	['greed_rolls', 'Greed rolls made on loot'],
	['camped', 'Times camped']
];

const num = (v: any) => (typeof v === 'number' ? v : 0);
const str = (v: any) => (typeof v === 'string' ? v : '');
const optStr = (v: any) => (typeof v === 'string' && v ? v : undefined);
/** statistika je število ali {effective} / {value} */
const stat = (v: any) => (typeof v === 'number' ? v : num(v?.effective ?? v?.value));
const color = (d: any) =>
	d?.color ? '#' + [d.color.r, d.color.g, d.color.b].map((c: number) => num(c).toString(16).padStart(2, '0')).join('') : null;

export function itemIds(raw: RawCharacter): number[] {
	return (raw.equipment?.equipped_items ?? []).map((it: any) => num(it.item?.id)).filter((id: number) => id > 0);
}

export function normalize(
	slug: string,
	raw: RawCharacter,
	icons: Map<number, string | null>,
	talentCache: TalentCache = { info: new Map(), specs: null }
) {
	const p = raw.profile;
	const media = (key: string) => optStr((raw.media?.assets ?? []).find((a: any) => a.key === key)?.value);

	const allStats: StatLine[] = [];
	const walk = (cats: any[], prefix: string) => {
		for (const c of cats ?? []) {
			const cat = prefix ? `${prefix} › ${str(c.name)}` : str(c.name);
			for (const s of c.statistics ?? []) allStats.push({ category: cat, name: str(s.name), value: num(s.quantity) });
			walk(c.sub_categories, cat);
		}
	};
	walk(raw.achievementStats?.categories, '');
	const counters: Record<string, number> = {};
	for (const [key, name] of COUNTERS) counters[key] = allStats.find((l) => l.name === name)?.value ?? 0;

	const st = raw.statistics;
	const stats: Stats | null = st
		? {
				health: stat(st.health),
				power: stat(st.power),
				powerType: str(st.power_type?.name),
				strength: stat(st.strength),
				agility: stat(st.agility),
				stamina: stat(st.stamina),
				intellect: stat(st.intellect),
				spirit: stat(st.spirit),
				armor: stat(st.armor),
				defense: stat(st.defense),
				dodge: stat(st.dodge),
				parry: stat(st.parry),
				block: stat(st.block),
				meleeCrit: stat(st.melee_crit),
				rangedCrit: stat(st.ranged_crit),
				spellCrit: stat(st.spell_crit),
				attackPower: stat(st.attack_power),
				rangedAttackPower: stat(st.ranged_attack_power),
				spellPower: stat(st.spell_power),
				spellHealing: stat(st.spell_healing),
				manaRegen: stat(st.mana_regen),
				mainHandDps: stat(st.main_hand_dps),
				resistFire: stat(st.fire_resistance),
				resistFrost: stat(st.frost_resistance),
				resistShadow: stat(st.shadow_resistance),
				resistNature: stat(st.nature_resistance),
				resistArcane: stat(st.arcane_resistance)
			}
		: null;

	const professions: Profession[] = [];
	for (const [group, primary] of [
		['primaries', true],
		['secondaries', false]
	] as const) {
		for (const x of raw.professions?.[group] ?? []) {
			const tier = (x.tiers ?? []).at(-1);
			professions.push({
				name: str(x.profession?.name),
				primary,
				skill: num(tier?.skill_points ?? x.skill_points),
				max: num(tier?.max_skill_points ?? x.max_skill_points)
			});
		}
	}

	const equipment: Item[] = (raw.equipment?.equipped_items ?? []).map((it: any) => item(it, icons));

	const tal = talents(raw, talentCache);

	const summary = {
		slug,
		name: str(p.name),
		surname: str(p.surname),
		level: num(p.level),
		experience: num(p.experience),
		classId: num(p.character_class?.id),
		className: str(p.character_class?.name),
		race: str(p.race?.name),
		faction: str(p.faction?.name),
		gender: str(p.gender?.name),
		guild: optStr(p.guild?.name),
		ruleset: optStr(p.ruleset?.name),
		ilvlEquipped: num(p.equipped_item_level),
		ilvlAverage: num(p.average_item_level),
		achievementPoints: num(p.achievement_points),
		avatar: media('avatar'),
		lastLogin: typeof p.last_login_timestamp === 'number' ? p.last_login_timestamp : undefined,
		kills: counters.kills,
		deaths: counters.deaths,
		quests: counters.quests,
		honorableKills: num(raw.pvp?.honorable_kills),
		counters,
		...(tal.build ? { talentBuild: tal.build, talentSpec: tal.spec } : {})
	};
	const details = { render: media('main-raw'), equipment, stats, professions, counters, allStats, talents: tal.trees };
	return { summary, details };
}

function item(it: any, icons: Map<number, string | null>): Item {
	const id = num(it.item?.id);
	const tooltip: TooltipLine[] = [];
	const line = (text: string, c: string | null = null, right: string | null = null) => {
		if (text) tooltip.push({ text, color: c, right });
	};
	line(str(it.name));
	line(str(it.level?.display_string), '#ffd100');
	line(str(it.binding?.name));
	line(str(it.inventory_type?.name), null, it.is_subclass_hidden ? null : (optStr(it.item_subclass?.name) ?? null));
	if (it.weapon) {
		line(str(it.weapon.damage?.display_string), null, optStr(it.weapon.attack_speed?.display_string) ?? null);
		line(str(it.weapon.dps?.display_string));
	}
	line(str(it.armor?.display?.display_string), color(it.armor?.display));
	for (const s of it.stats ?? []) line(str(s.display?.display_string), color(s.display));
	for (const e of it.enchantments ?? []) line(str(e.display_string), '#1eff00');
	for (const s of it.spells ?? []) line(str(s.description), '#1eff00');
	line(str(it.durability?.display_string));
	line(str(it.requirements?.level?.display_string));
	if (it.description) line(`"${it.description}"`, '#ffd100');

	return {
		slot: str(it.slot?.name),
		slotType: str(it.slot?.type),
		itemId: id,
		name: str(it.name),
		quality: str(it.quality?.type),
		ilvl: num(it.level?.value),
		icon: icons.get(id) ?? null,
		tooltip
	};
}
