# WowCompany – dokumentacija (kazalo)

| Dokument | Vsebina |
|---|---|
| [PLAN.md](PLAN.md) | portal (SvelteKit + Convex + Vercel): §0 stanje in ukazi, arhitektura, proračun brezplačnih paketov |
| [COMPANION.md](COMPANION.md) | namizna aplikacija (Tauri), combat log dejstva, §14 kontrolni seznam nepreverjenega |
| [ADDON.md](ADDON.md) | addon `WowCompany`: §1 stanje, §4.1 dejstva o Forever API-ju |
| [STATS.md](STATS.md) | v0.3: statistika po vzoru Warcraft Logs + Details!, Company Parses, sezone, preureditev repozitorija |

## ZAČNI TUKAJ – stanje 16. 11. 2026 (dopoldne)

**Narejeno danes (commiti na `main`, še ne nujno pushani – preveri `git status`):**
- **Naslovnica:** hero z ozadjem iz najnovejše uradne novice in 3 naključnimi junaki (Blizzard render `-main-raw.png`
  iz avatarja) + šaljivi komentarji; **novice** (`news` tabela, dnevni cron `wow news` bere `model = {…}` z
  worldofwarcraft.blizzard.com/en-gb/news; Forever/hotfixi vidni, ostalo skrito; patch in sezona objavita sama).
- **Design rules** v `web/src/routes/layout.css`: `.page-title .page-lead .section-title .card-title .section-lead
  .eyebrow .stat-value .stat-label .panel` – nove strani uporabljajo samo te.
- **Admin** (Guild Master's Office): stranski meni po skupinah Community / Website (Who sees what, News, Seasons) /
  Discord (Connection, Posts, Slash commands) / System. **Uporabnik** (/settings): Overview (main + koraki), Heroes,
  Companion & addon, Account.
- **Companion 0.1.12:** samoposodobitev (tauri-plugin-updater, `latest.json` na GitHub Releases, podpis z ključem v
  `~/.tauri/wowcompany-updater.key` – **varnostna kopija!**), samodejna posodobitev addona v mapi igre (opozori, ali
  zadošča /reload ali je treba igro znova zagnati), **poročilo runa** v zavihku Runs.
- **Addon 0.5.4:** ob nalaganju pove, da ga je Companion posodobil. Igra med igranjem ne more brati datotek, zato
  addon sam ne more narediti /reload ob posodobitvi.
- **Replay** (zavihek na strani runa): analizator vzorči x/y partyja vsaki 2 s (`RunSummary.replay`, tabela
  `runReplay`, zastavica `runs.hasReplay`), zemljevid iz poti, bossi, smrti, trak s play/pavza/hitrost, `?t=` sekunde.
  Koordinate: x = sever, y = zahod (preverjeno na Northwatch). Nekateri Forever dungeoni imajo uiMapID 0.

- **Realmi** (`web/src/convex/realms.ts`, `lib/realms.ts`): realm = regija + ruleset (Forever API nima realmov).
  Guild Master ga izbere v *System → Realm*; junaki z drugim rulesetom so zavrnjeni. Menjava: aktivni junaki
  (`active=false`, `archived=<key>`), runi (`runs.archived`, paketno `moveRuns`) in sezone gredo v `archives` za 30 dni,
  začne se nova sezona; vrnitev obnovi. Člani: stran **/archive** (prenos JSON). Cron `realm archive purge` briše.
  CLI: `realms:setRealmCli`. Preizkušeno na dev (tja, nazaj, izbris).
- **Replay za stare rune:** `bun scripts/replay-backfill.ts --prod ../wowlog/WoWCombatLog-*.txt` (poganja uporabnik –
  zapis v prod je za Claude blokiran).

**Izdano:** Companion 0.1.12 (latest.json podpisan, samoposodobitev deluje), nameščen pri uporabniku 16. 11. ob 10:26.

**Naslednji koraki:** preveri pravi dungeon z 0.1.12 (replay, poročilo, samoposodobitev na 0.1.13), Discord objavo,
`/wowco probe`; po želji ročno umerjen zemljevid dungeona (slika + meje iz `C_Map` v addonu).

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
