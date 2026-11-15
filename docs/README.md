# WowCompany – dokumentacija (kazalo)

| Dokument | Vsebina |
|---|---|
| [PLAN.md](PLAN.md) | portal (SvelteKit + Convex + Vercel): §0 stanje in ukazi, arhitektura, proračun brezplačnih paketov |
| [COMPANION.md](COMPANION.md) | namizna aplikacija (Tauri), combat log dejstva, §14 kontrolni seznam nepreverjenega |
| [ADDON.md](ADDON.md) | addon `WowCompany`: §1 stanje, §4.1 dejstva o Forever API-ju |
| [STATS.md](STATS.md) | v0.3: statistika po vzoru Warcraft Logs + Details!, Company Parses, sezone, preureditev repozitorija |

## ZAČNI TUKAJ – stanje 16. 11. 2026 ponoči

**V produkciji in pri uporabniku:**
- Portal (`main` = zadnji commit, Vercel + Convex prod): dungeon runi z rolli in kakovostjo lootu (Blizzard retail/classic
  namespace – Forever `item/{id}` = 404), razčlenitev po bossih (klik ▸: graf 2 s, uroki, buffi/debuffi, oprema, kategorije
  *My actions* / *What happened to me?* kot v igrinem Combat Log Config), zavihek **Combat Log** za cel run, *coin & glory*
  (XP, zlato, reputacija, veščine, neuspeli casti), nagrade za neuspele caste, Company Parses (lik → **Logs**), **/rankings**
  (top 10, All-Stars, Speed demons, Best value, Keyboard Hall of Shame), sezone, Discord objave runov + `/parses`
  (Office → Visibility → Discord → *Dungeon runs*; po deployu *Register commands*).
- Companion **v0.1.11** izdan in nameščen (`~/Applications/WowCompany-Companion.AppImage`; `0.1.6.AppImage.bak` lahko gre).
- Addon **0.5.3** v mapi igre: lasten zavihek chata **WowCompany** (loot, rolli, sistem, party, XP, denar, reputacija, veščine –
  preverjeno, da ga Forever dovoli), meter *More*, klik na vrstico = uroki, povzetek runa + *Send now / Later*,
  `/wowco report|details|ask|chat`.
- Filtri v igrinem *Combat Log Config* vplivajo samo na prikaz v chatu, ne na datoteko combat loga (preverjeno).
- Chat log pa zapiše samo, kar prikaže kakšno okno chata → zato zavihek WowCompany.

**Naslednji koraki (predlog):**
1. Ko uporabnik odigra dungeon z 0.1.11: preveri run na portalu (*coin & glory*, nagrade, ▸ kategorije, Combat Log, rolli,
   parsi, Rankings), Discord objavo, `/wowco probe` v dungeonu (oblika `combatSpells` med bojem – razčlenitev v igri je preverjena samo s smoke testom).
2. Prijatelji (Chugga Zugga, Zadn Cajt …) naj posodobijo Companion – njihovi stari runi nimajo razčlenitve.
3. Odprto iz načrta: **replay** (zemljevid pozicij/smrti iz X/Y v logu, C9), **poročilo runa v Companionu** (C5),
   po potrebi loot/rolli/časovnica iz `runDetails` v ločene dokumente (PLAN.md §8a, samo če DB I/O raste).

**Kje je kaj:** [STATS.md](STATS.md) §9.1 (kaj je narejeno), [ADDON.md](ADDON.md) §1 (addon), [COMPANION.md](COMPANION.md)
§14/§14a (preverjanja, omejitve, brisanje logov), [PLAN.md](PLAN.md) §0 (ukazi) in §8a (DB I/O).

**Uporabne orodja:** `wowrun <log> --chat <WoWChatLog.txt>` (analiza loga), `web/scripts/companion-upload.ts <run.json>`
(nalaganje na dev), `bun run check:all`. Vzorci logov v `wowlog/` (gitignore). Aplikacijo ustavi po PID-u procesa
`wowcompany-companion` (ne `pkill -f`, ujame lastno lupino).

## Struktura repozitorija

```
web/       portal: SvelteKit + Convex (web/src/convex), Vercel gradi iz korena prek vercel.json
desktop/   Companion: Tauri 2 (desktop/src = Svelte UI, desktop/src-tauri = Rust)
crates/    wowlog (parser combat loga), wowrun (detektor runov + analiza) – Rust workspace v korenu
addon/     WowCompany/ (kopira se v _forever_/Interface/AddOns), tests/smoke.lua
docs/      ta dokumentacija
wowlog/    vzorci combat logov (gitignore – vsebujejo imena igralcev)
```

Poti `src/…` v dokumentih se nanašajo na `web/src/…`.
