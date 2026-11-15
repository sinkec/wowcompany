# WowCompany – dokumentacija (kazalo)

| Dokument | Vsebina |
|---|---|
| [PLAN.md](PLAN.md) | portal (SvelteKit + Convex + Vercel): §0 stanje in ukazi, arhitektura, proračun brezplačnih paketov |
| [COMPANION.md](COMPANION.md) | namizna aplikacija (Tauri), combat log dejstva, §14 kontrolni seznam nepreverjenega |
| [ADDON.md](ADDON.md) | addon `WowCompany`: §1 stanje, §4.1 dejstva o Forever API-ju |
| [STATS.md](STATS.md) | v0.3: statistika po vzoru Warcraft Logs + Details!, Company Parses, sezone, preureditev repozitorija |

## ZAČNI TUKAJ – stanje 15. 11. 2026 zvečer

**V produkciji in pri uporabniku:**
- Portal (`main` = `531c8ed`): dungeon runi z rolli, razčlenitvijo po bossih (klik ▸ na igralca: graf boja 2 s, uroki,
  buffi/debuffi, oprema), Company Parses (lik → **Logs**, primerjava z najboljšim), **/rankings** (top 10, All-Stars,
  Speed demons), sezone (Office → Settings), Discord objave runov + `/parses` (Office → Visibility → Discord → *Dungeon runs*).
- Companion **v0.1.8** izdan in nameščen pri uporabniku (`~/Applications/WowCompany-Companion.AppImage`, stara 0.1.6 kot `.bak`).
- Addon **0.5.2** v mapi igre (meter *More*, klik na vrstico = uroki, povzetek runa + vprašanje *Send now / Later*, `/wowco report`,
  `/wowco details on|off`, `/wowco ask on|off`). Uporabnik je potrdil, da deluje (15. 11.).
- Predmeti: imena/kakovost iz Blizzard **retail/classic** namespacea (Forever `item/{id}` = 404) – loot ima kakovost brez addona.

**Izdaje:** Companion **0.1.10** (addon 0.5.2 z zavihkom chata "WowCompany"). 0.1.9 (addon 0.5.1) je bila izdana pred zavihkom.
- V igri preveriti: po `/reload` in vklopu logiranja se pojavi zavihek chata **WowCompany** (če ne: `/wowco chat on` in poročati,
  kaj izpiše).
- Da lahko izdaje in `convex run --prod` poganja Claude brez potrditve: dovoljenja v `.claude/settings.json`.

**Naslednji koraki (predlog):**
1. Ko uporabnik odigra dungeon z novo verzijo: preveri run na portalu (rolli, ▸ razčlenitev, parsi), Discord objavo,
   `/wowco probe` v dungeonu (oblika `combatSpells` med bojem – razčlenitev v igri je preverjena samo s smoke testom).
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
