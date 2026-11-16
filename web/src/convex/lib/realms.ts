// Realmi: WoW Forever v Blizzard API-ju nima seznama realmov – lik je naslovljen samo z imenom v
// regiji (profile-forever-eu), razlikuje ga še ruleset (PvP / Normal). "Realm" druščine = regija +
// ruleset. Čista logika – testi v tests/realms.test.ts.

export const REGIONS = ['eu', 'us'] as const;
export const RULESETS = ['PvP', 'Normal'] as const;
/** Koliko dni ostane arhiv starega realma (berljiv, obnovljiv), preden se izbriše. */
export const ARCHIVE_DAYS = 30;
export const DAY = 86_400_000;

export type Realm = { region: string; ruleset: string };

export const realmKey = (r: Realm) => `${r.region.toLowerCase()}-${r.ruleset.toLowerCase()}`;
export const realmLabel = (r: Realm) => `${r.region.toUpperCase()} · ${r.ruleset}`;

/** Ruleset lika (Blizzard: "PvP", "Normal", včasih "PvE") ustreza realmu druščine? */
export function rulesetMatches(heroRuleset: string | null | undefined, realm: Realm | undefined) {
	if (!realm || !heroRuleset) return true;
	const norm = (s: string) => (/^(normal|pve)$/i.test(s) ? 'normal' : s.toLowerCase());
	return norm(heroRuleset) === norm(realm.ruleset);
}

export const validRealm = (r: Realm) =>
	(REGIONS as readonly string[]).includes(r.region) &&
	(RULESETS as readonly string[]).includes(r.ruleset);

/** Dni do izbrisa arhiva (zaokroženo navzgor, ≥ 0). */
export const daysLeft = (deleteAt: number, now: number) =>
	Math.max(0, Math.ceil((deleteAt - now) / DAY));
