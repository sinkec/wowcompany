// Oblikovanje runov za portal – EDINO mesto, ki odloča, kaj vidi obiskovalec (testi: tests/runs-view.test.ts).
//   runs        → seznam (dungeon, čas, trajanje, party, kdo je objavil, rezultat)
//   runDetails  → številke: meter, uroki, segmenti, časovnica, nagrade
//   runDeaths   → smrti (števci in recapi)
//   classId     → barve razredov (obstoječe polje)
import type { Award, LootDrop, PlayerSummary } from './companionSchema.js';

export type Allowed = (field: string) => boolean;

type PartyMember = {
	slug: string;
	name: string;
	playerId?: string;
	damage: number;
	healing: number;
	deaths: number;
};
type Recorder = { userId: string; deviceId: string; slug: string | null; at: number };

export type RunDocLike = {
	_id: string;
	zone: { instanceId: number; name: string; difficultyId: number; instanceUid: number | null };
	startedAt: number;
	endedAt: number;
	durationMs: number;
	endReason: string;
	result: { bossesKilled: number; bossesTotal: number | null; wipes: number; cleared: boolean };
	party: PartyMember[];
	recordedBy: Recorder[];
	awards: Award[];
	lootCount?: number;
};

export type DetailsLike = {
	players: PlayerSummary[];
	segments: {
		kind: 'boss' | 'trash';
		name: string;
		encounterId: number | null;
		startMs: number;
		endMs: number;
		result: 'kill' | 'wipe' | 'none';
		players: { slug: string; damage: number; healing: number; damageTaken: number }[];
	}[];
	deaths: {
		slug: string;
		atMs: number;
		killer: string | null;
		killingBlow: string | null;
		recap: {
			atMs: number;
			source: string | null;
			spell: string | null;
			amount: number;
			overkill: number;
			hp: number | null;
			maxHp: number | null;
		}[];
	}[];
	timeline: {
		bucketMs: number;
		players: { slug: string; damage: number[]; healing: number[]; taken: number[] }[];
	};
	loot?: LootDrop[];
};

/** Ime iz partyja za slug (snemalec je vedno v partyju; rezerva = slug). */
const nameIn = (party: PartyMember[], slug: string | null) =>
	slug ? (party.find((p) => p.slug === slug)?.name ?? slug) : 'Someone';

export function runListItem(run: RunDocLike, classOf: Map<string, number>, allowed: Allowed) {
	const nums = allowed('runDetails');
	const deaths = allowed('runDeaths');
	const recorders = [...new Map(run.recordedBy.map((r) => [r.slug ?? r.deviceId, r])).values()];
	return {
		id: run._id,
		zone: run.zone.name,
		instanceId: run.zone.instanceId,
		startedAt: run.startedAt,
		durationMs: run.durationMs,
		endReason: run.endReason,
		result: run.result,
		party: run.party.map((p) => ({
			slug: p.slug,
			name: p.name,
			tracked: !!p.playerId,
			classId: allowed('classId') ? (classOf.get(p.slug) ?? null) : null,
			damage: nums ? p.damage : null,
			healing: nums ? p.healing : null,
			deaths: deaths ? p.deaths : null
		})),
		recordedBy: recorders.map((r) => ({ slug: r.slug, name: nameIn(run.party, r.slug), at: r.at })),
		/** Combat log ne pove, kdo je vodja skupine (pride z addonom / chat logom – COMPANION.md §14). */
		leader: null as string | null,
		totalDeaths: deaths ? run.party.reduce((n, p) => n + p.deaths, 0) : null,
		/** null = skrito (runLoot); 0 = ni podatka ali nič pobranega */
		lootCount: allowed('runLoot') ? (run.lootCount ?? 0) : null,
		awards: nums ? run.awards : null
	};
}

export function runDetail(
	run: RunDocLike,
	details: DetailsLike | null,
	classOf: Map<string, number>,
	allowed: Allowed
) {
	const base = runListItem(run, classOf, allowed);
	const nums = allowed('runDetails') && !!details;
	const deaths = allowed('runDeaths') && !!details;
	return {
		...base,
		access: {
			details: allowed('runDetails'),
			deaths: allowed('runDeaths'),
			loot: allowed('runLoot')
		},
		endedAt: run.endedAt,
		// guid ne gre v brskalnik (ni potreben)
		players: nums
			? details!.players.map(({ guid: _g, ...p }) => ({
					...p,
					deaths: deaths ? p.deaths : null,
					classId: base.party.find((m) => m.slug === p.slug)?.classId ?? null
				}))
			: null,
		segments: nums ? details!.segments : null,
		timeline: nums ? details!.timeline : null,
		deaths: deaths ? details!.deaths : null,
		loot: allowed('runLoot') && details ? (details.loot ?? []) : null
	};
}

export type RunListItem = ReturnType<typeof runListItem>;
export type RunDetailView = ReturnType<typeof runDetail>;
