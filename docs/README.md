# WowCompany – dokumentacija (kazalo)

| Dokument | Vsebina |
|---|---|
| [PLAN.md](PLAN.md) | portal (SvelteKit + Convex + Vercel): §0 stanje in ukazi, arhitektura, proračun brezplačnih paketov |
| [COMPANION.md](COMPANION.md) | namizna aplikacija (Tauri), combat log dejstva, §14 kontrolni seznam nepreverjenega |
| [ADDON.md](ADDON.md) | addon `WowCompany`: §1 stanje, §4.1 dejstva o Forever API-ju |
| [STATS.md](STATS.md) | v0.3: statistika po vzoru Warcraft Logs + Details!, Company Parses, sezone, preureditev repozitorija |

## Novo 17. 11. 2026 (zvečer)

- **Meni po kategorijah:** Home (landing: hero, *Coming up* + zadnji runi, novice) · Company ▾ (**/heroes** roster +
  Tavern Gossip, **/leaderboards** lestvice + sestava) · Dungeons ▾ (/runs, /rankings) · **/calendar**.
  Komponente: `lib/components/layout/MainNav.svelte`, `Brand.svelte`.
- **Ime ekipe:** Office → Website → Home page → *Company name* (`siteContent.teamName`, `site.saveTeamName`); glava
  pokaže ime nad "WowCompany", naslov zavihka in Discord noge `brandName()` (`lib/siteContent.ts`).
- **Koledar** (`convex/calendar.ts`, `lib/calendar.ts`, tabela `calendarEvents`): naši dogodki (Office → Website →
  Events: nov/uredi/briši, kljukica *Discord* = objava ob shranjevanju + opomnik uro prej prek scheduler), člani
  "I'm in"/"I'm out" z glavnim junakom; **prazniki iz igre**: addon 0.6.8 `Calendar.lua` bere `C_Calendar`
  (samo HOLIDAY/SYSTEM, nikoli igralčevih/guildovih dogodkov), realm čas → UTC; vrstice `v1|CALWIN|` + `v1|CAL|`;
  Companion 0.1.20 pošlje `POST /companion/calendar` (samo ob spremembi, `calendar-sent.json`). Vidnost: polje
  `calendar` (splet za tujce + Discord; prazniki so vedno javni).
- **Discord:** `/events` (naši + prazniki), `/news`; po deployu v Office → Discord → Slash commands **Register
  commands**. Na prod je `discordFields` shranjen → polje *Calendar* v Discord → Posts vklopi ročno.
- **Grafi = Chart.js** (`lib/chart.ts` barve iz teme, `ChartCanvas.svelte` ovoj): napredek junaka (stopnice +
  preliv), časovnica runa/replay (na sekundo, 30 s povprečje, barve razredov ali stalna paleta, boss boji osenčeni,
  kazalec replaya z zatemnjeno prihodnostjo, vlečenje = premik, legenda = vsote do kazalca, klik skrije junaka).
- **UI = shadcn-svelte povsod** (17. 11. pozno): tabele `Table.*` + sortiranje po stolpcih (`lib/sort.svelte.ts`
  `TableSort`, glava `components/table/SortHead.svelte`); preklopniki `ToggleGroup`/`Toggle` (aktivno = zlato, v
  `ui/toggle-group/toggle-group-item.svelte`; vezava `bind:value={() => x, (v) => …}`, da klik na izbrano ne odznači);
  `Select` prek `components/form/SimpleSelect.svelte`, `Textarea`, `Checkbox`, `Collapsible`, `Slider` (replay);
  potrditve `ask()` (`lib/confirm.svelte.ts`) + `ConfirmHost` v layoutu namesto `confirm()`/`prompt()`.
  Brez Prettierja čez `components/ui` (vendor datoteke).
  Namigi: `components/wow/Tip.svelte` (shadcn Tooltip, Provider v layoutu) namesto `title=`; kartice = shadcn `Card`
  z našim okvirjem (`ui/card/card.svelte` uporablja `.wow-frame`, brez vsiljene postavitve); `wow-frame` kot razred
  ostane samo na semantičnih elementih (povezave-kartice, obrazci, seznami, figure, article). Office: `Alert`.
- **Skupno:** `lib/errors.ts` (`errText`, `attempt`) namesto kopij po straneh; hero stran bere `?tab=`.

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

- **Replay v2:** luknje v logu (hoja brez boja = brez pozicij) premosti pot po "hodnikih" (graf vseh točk partyja,
  Dijkstra, ≤ 12 yd/s), sicer skok. **Zemljevid dungeona:** Guild Master v Replay naloži posnetek igrine karte (M) →
  `dungeonMaps` (Convex storage, WebP ≤ 1600 px) in ga poravna z drsniki; velja po `instanceId`. Ruins of Lordaeron
  že ima karto (16. 11.).

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
