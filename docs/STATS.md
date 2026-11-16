# WowCompany v0.3 – statistika po vzoru Warcraft Logs + Details!, preureditev repozitorija (predlog in načrt)

Napisano 15. 11. 2026. Stanje pred tem: `main` = `520726e`, Companion v0.1.6, addon 0.4.0 (glej ADDON.md §1).
Ta dokument je **predlog** – odločitve, ki jih mora potrditi uporabnik, so zbrane v §10.

---

## 0. Povzetek v eni minuti

- **Warcraft Logs (WCL)** = analiza *po* boju na spletu: parsi (percentil proti vsem igralcem istega speca na istem bossu),
  All Stars točke, stran lika po bossih, poročilo runa po zavihkih (Damage, Healing, Deaths, Casts, Buffs …), časovnica.
  WCL podpira tudi Forever, a **WCL in Details! sta samo zgled, kaj hočemo imeti** – §1.3: sistem je v celoti naš,
  **nobenih podatkov ne vlečemo iz njihovih strani, API-jev ali addonov**; uporabimo pa javno znanje, *kako* so stvari naredili
  (dokumentacija, koda na GitHubu), in to po možnosti izboljšamo.
- **Details!** = meter *v igri* med bojem: prikazi (damage, heal, interrupts …), segmenti, razčlenitev po urokih, smrti,
  povzetek dungeona, grafi, vtičniki. **Details! uradno podpira Forever** – na Midnight odjemalcu (brez combat loga za addone)
  bere Blizzardov `C_DamageMeter`. To je ista pot, kot jo že uporablja naš addon, in Details-ova koda nam pokaže,
  kaj ta API vrne (razčlenitev po urokih!) – glej §2.2.
- **Naš adut:** imamo **celoten combat log na disku** (Companion) → lahko naredimo vse, kar zna WCL, in del tega pošljemo nazaj
  v igro (addon), česar ne zna nihče drug. Plus prijatelji/guild kot skupnost, avtomatika in zasebnost.
- **Delitev dela:**
  - **Addon** = "Details-lite" v igri (C_DamageMeter): več prikazov, segmenti, razčlenitev uroka, smrti, povzetek runa +
    rekordi/parsi iz Companiona po `/reload`.
  - **Companion** = analizator (WCL-nivo) iz loga + lokalno poročilo runa + pošiljanje razširjenih podatkov.
  - **Portal** = WCL za našo druščino: "Company Parses", stran lika po bossih, poročilo runa po zavihkih, lestvice, Discord.
- **Repozitorij:** predlagam `web/`, `desktop/`, `addon/`, `crates/`, `docs/` (§8). Najprej preureditev, nato funkcije.

---

## 1. Kaj ponuja Warcraft Logs

> Vir: dokumentacija WCL (rankings & parses, navigacija po logih), Details! integracija z WCL addonom in znanje o strani.
> **Stran lika sama ni bila prebrana** – `fresh.warcraftlogs.com` vrača Cloudflare izziv (403) za curl, WebFetch in headless Chrome.
> Primer: `character/eu/spineshatter/kusheen?zone=1047&boss=50656` = Classic Fresh, **Karazhan** (zone 1047), boss **The Curator**
> (encounter 656, WCL ID 50656). → Uporabnik naj pošlje 2–3 posnetke zaslona (pregled cone, izbran boss, zavihek Gear), da §1.1 potrdiva.

### 1.1 Stran lika (`/character/...`)

| Del | Kaj kaže |
|---|---|
| Glava | ime, razred, guild, strežnik/regija, povezava na armory, izbira **cone** (raid/dungeon), **metrike** (DPS, HPS, …), težavnosti/velikosti, **particije** (faze sezone), speca |
| Povzetek cone | **Best Perf. Avg** (povprečje najboljših parsov po bossih), **Median Perf. Avg**, **All Stars točke** + mesto (regija/strežnik/razred), število ubojev |
| Tabela bossov | boss, najboljši %, najvišji DPS, uboji, najhitrejši uboj, median %, All Stars točke in mesto |
| Izbran boss (`&boss=`) | **seznam vseh ubojev**: datum, percentil, mesto/od koliko, DPS, ilvl (in **ilvl bracket** %), trajanje, povezava na poročilo + graf parsov skozi čas |
| Gear / Talents | oprema in talenti iz zadnjega loga (iz `COMBATANT_INFO`) |
| Recent reports | zadnja poročila, v katerih nastopa |

**Pojmi:**
- **Parse** = en nastop na enem bossu; **ranking** = najboljši parse na bossu. Percentil = delež parsov istega speca/bossa, ki jih je presegel.
- **Barve:** 100 zlata, 99 roza, 95+ oranžna, 75+ vijolična, 50+ modra, 25+ zelena, < 25 siva.
- **Bracket** = ilvl razpon (raid) ali stopnja ključa (M+); percentil tudi znotraj bracketa.
- **All Stars** = točke čez celo cono (vsota po bossih), preračun enkrat na dan.
- **Particija** = obdobje (patch/faza); rankingi se ob novi particiji začnejo znova, stari ostanejo.

### 1.2 Poročilo (report) – kar je za nas najbolj uporabno

- **Fights:** seznam bojev (boss/trash, kill/wipe, trajanje), izbira boja ali "vsi".
- **Zavihki:** Summary (pregled vsakega igralca), **Damage Done**, **Damage Taken**, **Healing**, **Casts**, **Buffs** / **Debuffs**
  (uptime), **Deaths** (zadnji udarci pred smrtjo), Interrupts/Dispels, Resources, Threat, Replay (pozicije na zemljevidu).
- **Tabele po urokih:** znesek, %, DPS, casts, hits, crit %, avg, min/max, uptime; po ciljih; po igralcih.
- **Časovnica / graf** (DPS skozi boj, smrti, cooldowni), filter po uroku ("+" izvleče urok v vse zavihke), razvrščanje po stolpcih.
- **Speed rankings** (najhitrejši cleari) in rankingi po coni.

### 1.3 Pravilo: WCL in Details! sta zgled, ne vir (uporabnik, 15. 11. 2026)

- **Nobenih podatkov od njih:** portal, Companion in addon ne kličejo WCL API-ja, ne strgajo strani (imajo tudi bot protection),
  ne berejo Details! SavedVariables in se ne priklapljajo v Details! kot plugin. Vse številke izračunamo sami iz combat loga
  (Companion) in iz Blizzardovega `C_DamageMeter` (addon).
- **Znanje da:** kar je javno opisano ali na GitHubu (WCL pravila parsov in All Stars, Details! uporaba `C_DamageMeter`,
  `C_DeathRecap`, `C_CurveUtil` za skrite vrednosti, odprtokodni analizatorji logov, npr. WoWAnalyzer) uporabimo kot vzorec
  in po možnosti izboljšamo. Kode z licenco "All rights reserved" (Details!) ne kopiramo – napišemo svojo.
- **Kje smo lahko boljši od njiju:**
  - Details! na Forever v igri **ne zna** crit %, hits, min/max, casts, uptime, overheal (§2.2) → mi to izračunamo v Companionu
    iz loga in po `/reload` pokažemo v igri (A8). Nihče drug tega ne poveže.
  - WCL za Forever dungeone **nima rankingov** (napoved ob zagonu) → naši Company Parses jih imajo, za našo druščino.
  - Brez ročnega nalaganja: Companion sam zazna run in ga naloži; addon sam vklopi logiranje.
  - Prijatelji/guild na enem mestu: rekordi, Hall of Shame, Discord, humor.
- Edini stik: če kdo od nas **sam** nalaga loge na WCL, mu jih Companion ne sme izbrisati prej (C11) – to je samo sobivanje, ne izmenjava podatkov.

---

## 2. Kaj ponuja Details!

> Vir: izvorna koda `github.com/Tercioo/Details-Damage-Meter` (prebrana 15. 11. 2026, zadnji commit 9. 11. 2026) + CurseForge.
> **Licenca: "All rights reserved"** → kode NE kopiramo, učimo se samo, kako uporablja Blizzardove API-je.

### 2.1 Funkcije (klasičen Details! s combat logom)

| Skupina | Funkcije |
|---|---|
| Prikazi | **Damage:** done, DPS, taken, friendly fire, frags, enemies, void zones, taken by spell, avoidable · **Healing:** done, HPS, overheal, taken, enemy heal, prevented, absorbs, potions · **Resources** · **Misc:** CC breaks, resses, interrupts, dispels, deaths, cooldowns, buff/debuff uptime · custom prikazi (Lua) |
| Segmenti | current, overall, zgodovina bojev, M+ overall/trash |
| Breakdown okno | urokov tabela (amount, DPS, %, casts, hits, crit %, avg, min/max, uptime), cilji, primerjava z drugim igralcem, podrobnosti uroka (normal/crit/glancing …) |
| Smrti | death log (zadnji dogodki pred smrtjo), death recap, "death menu" po smrti |
| Dungeon | **end-of-run okno** (čas, smrti, igralci: dmg/heal/interrupts/dispels, graf), M+ graf škode |
| Vtičniki | **Encounter Details** (sposobnosti bossa, faze, interrupti, dispeli, smrti, graf), **Compare2**, **DataStorage** (guild ranking: najboljši po bossih iz guild runov), **Raid Check** (food/flask), TinyThreat, Vanguard (tanki), Streamer |
| Ostalo | poročanje v chat, zaznamki, skini, WeakAura creator, ilvl/talenti partyja, sinhronizacija med Details uporabniki, Warcraft Logs addon (barva parsa ob imenu) |

### 2.2 Details! na Midnight/Forever (brez combat loga) – **ključno za naš addon**

Details ima za ta odjemalec ločeno pot (`core/parser_nocleu*.lua`, `frames/window_breakdown_midnight/`). Iz kode:

- **Prikazi, ki jih da `C_DamageMeter`:** DamageDone, Dps, DamageTaken, **EnemyDamageTaken** (škoda po nasprotnikih),
  **AvoidableDamageTaken**, HealingDone, Hps, Absorbs, Interrupts, Dispels, Deaths. Vse ostalo (overheal, friendly fire,
  resources, cooldowns, uptime, CC breaks, resses) je označeno **"not supported"**.
- **Segmenti:** `Enum.DamageMeterSessionType` Overall / Current / Expired (+ `sessionID`), `GetCombatSessionFromID`;
  ročni segmenti: `SetSegmentsToManual`, `StartSegment`, `StopSegment`, `ResetAllCombatSessions`, `GetSessionDurationSeconds`.
- **Vir (igralec):** `name, sourceGUID, totalAmount, amountPerSecond, specIconID, classFilename, deathRecapID,
  deathTimeSeconds, sourceCreatureID, classification, isLocalPlayer`.
- **Razčlenitev po urokih** – `GetCombatSessionSourceFromType/ID(session, type, guid)` vrne
  `{ totalAmount, maxAmount, combatSpells[] }`, vsak urok: `spellID, totalAmount, amountPerSecond, overkillAmount, isAvoidable,
  isDeadly, creatureName` (pet) + `combatSpellDetails { unitName, unitClassFilename, isPet, isMob, classification, amount }`.
  → **Odgovor na odprto vprašanje iz ADDON.md §4.1 (A0b): da, vrne uroke**, ne pa hits/crits/max udarca.
- **Cilji:** prek `EnemyDamageTaken` po `sourceCreatureID` in urokih tega nasprotnika (kdo ga je koliko udaril).
- **Smrti:** `deathRecapID` → `C_DeathRecap` (zadnji udarci pred smrtjo).
- **Skrite vrednosti med bojem:** zneski in imena so med bojem `secret` – Details jih samo **prikaže**
  (`AbbreviateNumbers`, `StatusBar`) in za odstotke uporabi `C_CurveUtil.CreateCurve()` (krivulja 0→total, `Evaluate`),
  ker s skritimi števili ne sme računati. Vsako primerjavo zaščiti z `issecretvalue`.

**Posledica:** v igri lahko naredimo meter z razčlenitvijo po urokih, cilji in smrtmi. **Ne moremo** pa narediti hits/crit %,
min/max, uptime, overheal, castov – to zna samo Companion iz loga, v igro pride po `/reload` (CompanionData.lua).

---

## 3. Kaj že imamo (15. 11. 2026)

| Kje | Že zna | Ne zna še (glede na WCL/Details) |
|---|---|---|
| **Addon 0.4.0** | meter iz `C_DamageMeter` (DamageDone/Dps/Healing/…), okno, minimap, Records (iz Companiona), samodejni /combatlog, izvoz vodje + loot kakovosti | segmenti/zgodovina bojev, razčlenitev po urokih, cilji, smrti, avoidable, povzetek runa, parsi v igri |
| **Companion 0.1.6** | parser (wowlog), detektor runov, segmenti boss/trash, igralci (dmg/heal/overheal/shield/taken/deaths/interrupts/dispels/active/crit %), top 10 urokov (amount/hits/crits), death recap, časovnica, loot, rekordi, live pogled | casts, min/max/avg, uptime buffov/debuffov, cilji, per-segment uroki, resources, COMBATANT_INFO (gear/talenti), parsi, lokalno poročilo po zavihkih |
| **Portal** | Dungeon Runs (seznam + stran runa: igralci, segmenti, smrti, loot, časovnica), Big Numbers (rekordi), stran lika (gear, talenti, progress …) | parsi/percentili, stran lika po bossih (WCL), zavihki Casts/Buffs/Targets, rankingi po coni, speed rankingi, primerjava |

---

## 4. Trije viri podatkov – kaj kateri zmore

| Podatek | Combat log (Companion) | `C_DamageMeter` (addon, v živo) | Blizzard profile API (portal) |
|---|---|---|---|
| Damage/heal/taken po igralcu | ✅ natančno | ✅ (med bojem skrito, prikaz OK) | – |
| Po urokih: znesek | ✅ | ✅ | – |
| Po urokih: casts, hits, crit %, min/max | ✅ | ❌ | – |
| Po ciljih | ✅ | ✅ (EnemyDamageTaken) | – |
| Overheal, absorbs | ✅ / ✅ | ❌ / ✅ | – |
| Avoidable damage | ⚠️ rabi seznam urokov | ✅ (Blizzard ve) | – |
| Smrti + recap | ✅ (z HP) | ✅ (`C_DeathRecap`) | – |
| Buff/debuff uptime, cooldowni | ✅ (`SPELL_AURA_*`) | ❌ | – |
| Resources (mana …) | ✅ (napredni blok + ENERGIZE) | ❌ | – |
| Pozicije X/Y (replay, zemljevid smrti) | ✅ (napredni blok) | ❌ | – |
| Gear/talenti ob pullu | ⚠️ `COMBATANT_INFO` (A10 nepreverjeno) | ✅ inspect | ✅ (zadnje stanje) |
| Spec/vloga | ⚠️ iz talentov | `specIconID` skrit | ✅ talenti → glavno drevo |
| Vodja, loot kakovost, rolli | ❌ / ⚠️ / ❌ | ✅ (že izvažamo) | – |

**Pravilo:** številke za parse/rekorde vedno iz loga (Companion), addon je za "v živo" in za prikaz že izračunanega.

---

## 5. Predlogi po delih

Prioriteta: **P1** = naslednja izdaja, **P2** = potem, **P3** = nekoč. Imena v UI angleško, v WoW tonu (grob, črn humor).
Pri vsem velja zasebnost: **nikoli drugih igralcev razen partyja** (addon `Meter.Visible`, Companion "Stranger").

### 5.1 Addon `WowCompany` – "Details-lite" v igri

| ID | Funkcija | Vir | P |
|---|---|---|---|
| A1 | **Prikazi:** vseh 11 tipov `C_DamageMeter` (dodati EnemyDamageTaken = "Who We Beat Up", AvoidableDamageTaken = "Standing in Fire", Deaths) | DM | P1 |
| A2 | **Segmenti:** Current / Overall / seznam zadnjih bojev (ime glavnega nasprotnika, `(!)` boss, trajanje) | DM sessions | P1 |
| A3 | **Breakdown okno:** klik na igralca → uroki (znesek, DPS, %, pet ime), zavihek Targets | `GetCombatSessionSourceFrom*` | P1 |
| A4 | **Death recap** za party: klik na smrt → zadnji udarci | `deathRecapID` + `C_DeathRecap` | P2 |
| A5 | **Run Summary okno** ob koncu runa (zadnji boss / odhod iz instance): čas, uboji/wipe, smrti, top dmg/heal/interrupt, "MVP" in "Hall of Shame" vrstica, loot | DM Overall + addon run zapis | P1 |
| A6 | **Report to party** (gumb, kratek povzetek v /party, nikoli /say, /guild po izbiri) | DM | P2 |
| A7 | **Parsi in PB v igri:** ob imenu v metru barva zadnjega Company parsa, v Records "your best on this boss", po `/reload` | CompanionData.lua | P2 |
| A8 | **Zadnji run iz Companiona** (natančni podatki: crit %, casts, uptime) v zavihku "Last Run" | CompanionData.lua | P2 |
| A9 | Sobivanje z Details!: če je Details naložen, ponudi skrivanje našega metra (Records/Run Summary ostaneta) | `C_AddOns.IsAddOnLoaded` | P1 |

Tehnično: vse z `pcall` + `issecretvalue`; odstotki med bojem prek `C_CurveUtil` (kot Details), sicer po boju.
**Najprej razširiti `/wowco probe`** (§9 S1), da preverimo obliko `combatSpells`, `C_DeathRecap` in skrite vrednosti med bojem.

### 5.2 Companion – analizator (WCL-nivo) in lokalno poročilo

| ID | Funkcija | P |
|---|---|---|
| C1 | **Analiza po segmentih:** za vsak boss/trash segment in igralca: uroki (amount, casts, hits, crits, crit %, avg, min, max, overheal, absorbed, pet), cilji (top 10), interrupti (kaj je prekinil), dispeli (kaj) | P1 |
| C2 | **Uptime** pomembnih buffov/debuffov (na sebi in na bossu), cooldowni (cast časi) | P2 |
| C3 | **COMBATANT_INFO:** gear (item ID + ilvl) in talenti ob pullu → spec/vloga, ilvl za bracket (najprej preveriti A10) | P1 |
| C4 | **Parse vrstice:** za vsak boss kill × igralec: DPS/HPS po trajanju boja, ilvl, spec, trajanje → pošlje se s runom | P1 |
| C5 | **Lokalno poročilo runa** v aplikaciji (zavihek Runs → klik): Summary / Damage / Healing / Taken / Deaths / Casts / Buffs, izbira segmenta, razvrščanje | P1 |
| C6 | Izpis v addon (CompanionData.lua): zadnji run (A8), PB po bossu, Company parse (A7) – parse pride s portala (GET po uploadu) | P2 |
| C7 | Primerjava: jaz vs. jaz (najboljši kill istega bossa) in jaz vs. prijatelj istega razreda | P2 |
| C8 | Graf DPS/HPS po segmentu (že imamo `timeline`, dodati per-segment) | P2 |
| C9 | Replay / zemljevid smrti iz X/Y + uiMapID | P3 |
| C10 | Seznam "avoidable" urokov po dungeonu (iz addonovih AvoidableDamageTaken uroki → naučimo se ga sami) | P3 |
| C11 | Nastavitev "Keep logs for N days" (ne briši ob izhodu) – za tiste, ki loge nalagajo še kam drugam; privzeto kot zdaj | P2 |

Shema run summaryja gre na **4** (nazaj združljivo: novi podatki v ločenih neobveznih poljih).

### 5.3 Portal – "Warcraft Logs za našo druščino"

| ID | Funkcija | P |
|---|---|---|
| W1 | **Company Parses** (§6): percentil med parsi članov za isti boss + razred/vloga; barve kot pri WCL (brez njihove blagovne znamke) | P1 |
| W2 | **Stran lika → zavihek "Logs"** (WCL stran lika): izbira dungeona, metrike (DPS/HPS/Taken), tabela bossov (best %, best DPS, kills, fastest, median), Best/Median Perf. Avg | P1 |
| W3 | **Boss drill-down:** vsi uboji (datum, %, rang/od, DPS, ilvl, trajanje, povezava na run) + graf parsov skozi čas | P1 |
| W4 | **Poročilo runa po zavihkih** (razširitev `/runs/[id]`): Summary, Damage, Healing, Taken, Deaths, Casts, Buffs, Targets, izbira segmenta, tabele po urokih | P1 |
| W5 | **Rankings stran** `/rankings`: po dungeonu in bossu top DPS/HPS članov, **speed rankings** (najhitrejši clear po dungeonu) | P2 |
| W6 | **Company All-Stars** po dungeonu (točke kot vsota po bossih, dnevni cron) + lestvica na glavni strani | P2 |
| W7 | Gear/talenti ob ubijanju (iz C3) na drill-downu | P2 |
| W8 | Primerjava dveh junakov / dveh killov | P3 |
| W9 | Discord: povzetek runa s parsi ("Kusheen parsed purple on Curator, the rest of you should uninstall"), `/parses <hero>` | P2 |

---

## 6. Company Parses – percentili brez globalne baze

WCL primerja z vsemi igralci na svetu; mi imamo samo naše člane (tudi zaradi zasebnosti – drugih ne shranjujemo).
Pravila povzamemo po javnem opisu WCL (parse vs ranking, barve, bracketi, All Stars), izboljšano za majhno skupino (prag N, Personal %).

- **Parse** = en boss kill × en spremljan igralec. Metrika: **DPS** (dmg / trajanje boja ENCOUNTER_START→END), **HPS** (efektivno),
  opcijsko **Survival** za tanke (taken/s, nižje = bolje – samo informativno).
- **Skupina za primerjavo:** isti `encounterId` + težavnost + **vloga** (DPS/heal/tank iz talentov; razred kot drugi filter).
- **Percentil** = `100 × (št. parsov z nižjo metriko) / (N − 1)`; pri **N < 5** pokažemo samo "#2 of 4" in % od najboljšega
  (sicer bi bil vsak drugi parse "100").
- **Personal %** = metrika / osebni najboljši na tem bossu (koristno, ko je članov malo).
- **Best/Median Perf. Avg** = povprečje (najboljših / medianih) percentilov čez bosse dungeona.
- **All-Stars:** za vsak boss `točke = 120 × metrika / najboljša metrika` (najboljši dobi 120), vsota po dungeonu; preračun z dnevnim cronom.
- **Sezone (particije)** – potrjeno z uporabnikom 15. 11. 2026:
  - Blizzard API za Forever **nima endpointa za faze/sezone** (preverjeno 15. 11. 2026: `pvp-season`, `mythic-keystone/season`
    → 404; journal endpointi vrnejo prazen indeks). **Ima pa verzijo igre:** `static-forever-eu` se razreši v
    `static-1.60.1_70399-forever-eu` (patch 1.60.1, build 70399). Isto verzijo nosi glava combat loga (`BUILD_VERSION`) in addon (`GetBuildInfo`).
  - Tabela `seasons` (`number, name, startedAt, patch`); vsak parse dobi `season` ob vnosu (po `startedAt`). Začetek: Season 1.
  - Poller enkrat na dan prebere verzijo static namespacea; ob spremembi **major.minor** (npr. 1.60 → 1.61) admin v Guild Master's
    Office dobi obvestilo *"Patch 1.61 is here – start Season 2?"* z enim klikom (popravki 1.60.1 → 1.60.2 se ignorirajo).
    Samodejno ne začnemo, ker patch ≠ nujno nova vsebina – odloči admin. Ročni gumb "Start new season" je vedno na voljo.
  - Prikaz (kot pri WCL): na zavihku Logs in na `/rankings` zavihki **Season 2 (1.61) · Season 1 (1.60) · All**, privzeto trenutna;
    "All" = najboljši parsi čez vse sezone. Rekordi (Big Numbers) ostanejo vseživljenjski, z oznako sezone.
- Barve: 100 zlata, 99 roza, 95 oranžna, 75 vijolična, 50 modra, 25 zelena, sicer siva.

---

## 7. Podatkovni model in proračun (Convex Free)

**Novo:**
- `parses` (majhna vrstica, ~200 B): `runId, slug, encounterId, difficultyId, role, classId, metric (dps/hps), value, durationMs,
  ilvl, startedAt, partition` + indeksi `by_encounter_and_role_and_value`, `by_slug_and_encounter`.
  ~90 runov/mesec × ~4 bossi × 5 = **~1.800 vrstic/mesec ≈ 0,4 MB** – zanemarljivo.
- `rankings` (en dokument na encounter + vloga, preračuna cron): urejen seznam (slug, value, percentil) → stran lika in
  rankingi berejo **majhne dokumente**, ne vseh parsov.
- **Podrobna analiza (C1/C2)** po segmentih: ocena 5 igralcev × 10 segmentov × (25 urokov + 10 ciljev + 15 aur) ≈ **150–250 KB JSON**
  na run. Dve možnosti (odločiti v S3 po meritvi na pravem logu):
  1. `runSegments` – en dokument na segment (~20 KB), stran runa bere samo izbranega → DB I/O ostane majhen;
  2. stisnjen JSON v **Convex file storage**, brskalnik ga prenese neposredno (ne šteje v DB I/O) – **pred izbiro preveriti trenutne
     Free limite file storage/bandwidth** v Convex dokumentaciji.
- Shranjevanje: ob 90 runih/mesec × 250 KB ≈ 23 MB/mesec → 0,5 GB za ~1,5 leta; cron po 6 mesecih skrči na povzetek (že v COMPANION.md §10).

**Branje:** stran lika (W2) prebere `parses` za enega junaka (~100 vrstic × 200 B = 20 KB) → 1.000 ogledov ≈ 20 MB DB I/O. OK.

---

## 8. Preureditev repozitorija

### 8.1 Zakaj

Zdaj je v korenu pomešano: portal (`src/`, `static/`, `tests/`, `svelte/vite/tsconfig`, `components.json`, `convex.json`,
`vercel.json`, `package.json`), Companion (`desktop/`, `crates/`, `Cargo.toml`), addon (`addon/`), skripte za vse skupaj in
6 md dokumentov. Občutek je pravilen.

### 8.2 Predlagana struktura (varianta B – priporočam)

```
WowCompany/
├─ web/                     # portal: SvelteKit + Convex (Vercel gradi iz korena prek vercel.json)
│  ├─ src/{routes,lib,convex}/
│  ├─ static/  tests/  scripts/   # env-push, discord-register, check-visibility, companion-e2e/seed
│  ├─ package.json  bun.lock  svelte.config.js  vite.config.ts  tsconfig.json  components.json
│  └─ convex.json  .env (lokalno, gitignore)
├─ desktop/                 # Companion (Tauri) – ostane, kjer je
├─ crates/                  # wowlog, wowrun (Rust knjižnice za desktop) – ostane
├─ addon/
│  ├─ WowCompany/           # mapa mora imeti ime addona (tako se kopira v igro)
│  └─ tests/smoke.lua  .luacheckrc
├─ docs/
│  ├─ README.md             # kazalo: kje je kaj, "ZAČNI TUKAJ"
│  ├─ PLAN.md (portal)  COMPANION.md  ADDON.md  STATS.md (ta dokument)
├─ .github/workflows/       # companion-release.yml (poti ostanejo)
├─ Cargo.toml  Cargo.lock  rustfmt.toml   # Rust workspace (crates + desktop/src-tauri)
├─ package.json             # samo bližnjice: dev, check, test → `bun --cwd web …`, check:addon
├─ vercel.json  README.md  CLAUDE.md  AGENTS.md
└─ wowlog/                  # vzorci logov (gitignore)
```

Varianta A (`apps/web`, `apps/desktop`, `packages/…` z bun workspaces) je bolj "korporativna", a zahteva premik `desktop/`
(poti v `include_str!`, CI, Tauri) in nima koristi, ker si web in desktop ne delita JS kode. **Zato B.**

### 8.3 Izvedeno (S0, 15. 11. 2026)

- `git mv` portala v `web/` (`src static tests scripts package.json bun.lock vite/tsconfig/prettier/components/convex.json .npmrc .prettierignore`),
  `addon/smoke.lua` → `addon/tests/smoke.lua`, dokumenti v `docs/` (**imena ostanejo** PLAN/COMPANION/ADDON/STATS.md, da sklici
  v kodi `COMPANION.md §…` ostanejo veljavni; §14 ostane v COMPANION.md) + `docs/README.md` kazalo.
- **Vercel Root Directory ostane koren** (ni treba nič v dashboardu): `vercel.json` naredi `cd web`, `convex deploy` + build,
  nato premakne `web/.vercel/output` → `.vercel/output` (Build Output API; symlinki so relativni – preverjeno lokalno).
  `installCommand` namesti Bun, če ga okolje ne zazna (v korenu ni več `bun.lock`).
- Korenski `package.json` = samo bližnjice (`dev`, `convex`, `check`, `test`, `build`, `check:addon`, `check:rust`,
  `check:desktop`, `check:all`, `desktop`). `web/.gitignore` (Prettier v `web/` bere ta ignore).
- Lokalno premaknjeno (ni v gitu): `.env`, `.env.local`, `node_modules`, `.svelte-kit` → `web/`.
- `CLAUDE.md`/`AGENTS.md`: pot do `web/src/convex/_generated/ai/guidelines.md` + razdelek o strukturi.
- `desktop/`, `crates/`, `addon/WowCompany/`, CI za Companion: **nespremenjeno** (`include_str!` poti veljajo).

**Preverjeno pred pushom:** svelte-check 0 napak, 97 testov, `vite build`, `convex dev --once` (dev), `cargo test`,
`check:addon` (luac + smoke + luacheck 0/0), desktop svelte-check 0 napak; Prettier 147 starih opozoril (prej 155, shadcn komponente).

---

## 9. Faze in vrstni red

| Faza | Vsebina | Vrata |
|---|---|---|
| **S0** | Preureditev repozitorija (§8) – brez sprememb funkcij | vsi checki zeleni, Vercel deploy OK |
| **S1** | **Preverjanja v igri** (rabi uporabnika): party dungeon z `/combatlog` + razširjen `/wowco probe` (oblika `combatSpells`, skrite vrednosti med bojem, `C_DeathRecap`, `DAMAGE_METER_COMBAT_SESSION_UPDATED`) → odkljukati COMPANION.md §14 (ENCOUNTER_*, party zastavice, COMBATANT_INFO A10, instance uid) | vzorec loga + SavedVariables prebrana |
| **S2** | Addon 0.5: A1, A2, A3, A5, A9 | smoke testi + preizkus v igri |
| **S3** | Companion: C1, C3, C4 (shema 4), C5 lokalno poročilo; izmeriti velikost na pravem logu → izbira §7 (segmenti vs file storage) | `cargo test` na pravem logu, E2E na dev |
| **S4** | Portal: `parses` + W4 (poročilo po zavihkih), W2/W3 (Logs zavihek) | check:visibility, ogled na dev |
| **S5** | Company Parses W1 + `rankings` cron, W5, W9 Discord | izmerjen DB I/O |
| **S6** | Companion → addon: C6, A7, A8, A4, A6 | preizkus v igri |
| **S7** | P2/P3 ostanki: C2 uptime, C7/W8 primerjave, C8 grafi, W6 All-Stars, W7, C9 replay, C11 | – |

Izdaje: S0 brez izdaje · S2+S3 → **Companion v0.2.0** (z addonom 0.5) · S4+S5 portal · S6 → v0.2.x.

---

### 9.1 Stanje izvedbe (15. 11. 2026)

- ✅ **S0** preureditev repozitorija.
- ✅ **S1 (delno)** pravi WC run s partyjem: potrjeni ENCOUNTER_*, zastavice, COMBATANT_INFO (oprema + ilvl), `level` = ilvl,
  vodja iz addona, loot povezave. Odprto: `/wowco probe` (oblika `combatSpells`, skrite vrednosti med bojem, `C_DeathRecap`).
- ✅ **Rolli** (need/greed iz chat loga) – Companion + portal (zavihek Loot).
- ✅ **S3 (C1, C3, C4)** shema 4: po bossu in igralcu uroki (casts, hits, crit, min/max, overheal), heali, casti, tarče,
  ilvl, aktivnost, interrupti/dispeli/smrti; casti in oprema igralca. WC run: 117 KB.
- ✅ **S4/S5 (W1, W2, W3, W4)** tabela `parses` (vpis ob uploadu, samo spremljani junaki), `seasons` + dnevni cron verzije
  (`seasons.checkPatch`, `settings.gamePatch`), Office → *Parse seasons*, stran lika → zavihek **Logs**
  (Best/Median Perf. Avg, po bossu best %, median %, uboji, najhitrejši, seznam ubojev z rangom), stran runa → Bosses:
  klik na igralca odpre razčlenitev.
- ✅ **W5** `/rankings` (povezava v glavi): po dungeonu in bossu top 10 DPS/HPS (en vnos na junaka) + *Speed demons* (najhitrejši
  cleari v sezoni). Pozor: Convex ne dovoli ne-ASCII ključev v objektih (cirilični slugi) → vračamo sezname, ne `Record<slug,…>`.
- ✅ **W9 Discord:** objava runa 5 min po prvem uploadu (`discord.postRun`, enkrat – `runs.discordPostedAt`): bossi/čas,
  party z DPS/HPS in povprečnim Company Parse (barvni emoji), *Parse of the run*, nagrade, smrti, kocke; ukaz **`/parses <junak>`**
  (po dungeonu best % po bossih). Vidnost kot vedno v Discordu: polja `runs`/`runDetails`/`runDeaths`/`runLoot` v Office →
  Visibility (Discord stolpec, privzeto izklopljena!). Po deployu: **Register commands** v Portal Room (nov ukaz).
- ✅ **W7** oprema ob zadnjem boss pullu (COMBATANT_INFO: ID + ilvl) na strani runa (Bosses → igralec), ikone iz Blizzard
  media v cache `itemIcons` (akcija po uploadu). Imen ni: Forever `data/wow/item/{id}` vrača 404, iskalni indeks nima večine predmetov.
- ✅ **Predmeti brez addona (15. 11. 2026):** Forever `item/{id}` vrača 404, **retail `static-eu` in `static-classic-eu` pa
  klasične predmete poznata** (6449 Glowing Lizardscale Cloak RARE). Po uploadu `companion.enrichItems`: oprema po ID-ju →
  ime + kakovost (retail → classic → Forever iskalnik), loot in rolli po imenu iz chat loga → ID + kakovost (retail/Forever
  iskanje, natančno ime; naključna pripona → osnova). Pravi WC: **223/226 loot s kakovostjo brez addona** (addon prej 70).
  Ostanejo samo-Forever predmeti (Slither Cord) → addon. Cache `itemInfo` (neuspeh se ponovi po 7 dneh). Za stare rune:
  `bunx convex run [--prod] companion:enrichAllRuns '{}'`.
- ✅ **W6** Company All-Stars na `/rankings` (po bossu 120 × najboljši/najboljši v skupini, boljša od DPS/Healer table, vsota po dungeonu).
- ✅ **C2** uptime po boss boju: buffi na igralcu in debuffi, ki jih igralec (ali pet) drži na vsaj enem nasprotniku
  (odprti intervali se zaključijo ob koncu segmenta; smrt nasprotnika zapre njegove debuffe). Strani runa → Bosses → igralec.
  Pravi WC: Thorns 100 %, Serpent Sting 99 % na Pythasu; run 124 KB.
- ⏳ Naprej: S2 addon 0.5 v igri, izdaja Companion v0.1.7 (shema 4 + rolli + omejitve). Na prod enkrat:
  `bunx convex run --prod seasons:checkPatch` in `bunx convex run --prod companion:backfillParses '{}'` (iz `web/`).

- ✅ **DB I/O** (PLAN.md §8a): `parsePools`, `clears`, `runBossDetails`, Logs samo ob odprtju, oprema ob kliku.
- ✅ **C8** graf boja po bossu (2 s), **C7/W8** primerjava z najboljšim v Logs, **C11** *Keep logs for N days*.
- ✅ Predmeti iz retail/classic namespacea (`companion.enrichItems`), združevanje istega runa z drugim ključem (`cb4fe24`).
- ✅ Izdaje: Companion 0.1.7, **0.1.8** (nameščena pri uporabniku); 0.1.9 commitana, oznako pushne uporabnik.
- ✅ **Kategorije kot Combat Log Config (16. 11. 2026):** *My actions* (Melee, Ranged, Spells, Periodic, Auras, Spell Casting
  z razlogi neuspehov, Miscellaneous) in *What happened to me?* (prejeto po kategorijah, izognjeni napadi po vrsti, prejeti heali,
  okolje, smrti) – po bossu (Bosses → ▸) in za cel run (zavihek **Combat Log**, prej Spells). Filtri v igrinem *Combat Log Config*
  vplivajo samo na prikaz v chatu, **ne** na datoteko (preverjeno na logu po spremembi filtrov). Kategorije se seštejejo v
  škodo/prejeto škodo (test). Neuspeli casti so v logu samo za snemalca.
- ✅ **Neuspeli casti (16. 11. 2026):** `SPELL_CAST_FAILED` je v logu samo za lastnika → gredo k snemalčevim pridobitvam
  (`RunProgress.castFails`, razvrščeni s `wowrun::summary::fail_kind`: spam, targeting, range, resources, interrupted, control,
  other). Run stran: vrstica v *coin & glory* + nagrade (`castFailAwards`, prag po vrsti, največ 2 na junaka): Keyboard Diarrhea,
  Shadowboxer, Running on Fumes, Long-Distance Relationship, Commitment Issues, Hostage Situation. `/rankings`: *Keyboard Hall of
  Shame* (button mashing na uro). Pravi WC: 454 neuspehov, 191 mashing, 97 v prazno, 80 prekinjenih, 56 brez mane.
- ⏳ Ostane: **C9 replay**, **C5 poročilo v Companionu**, preverjanje razčlenitve v igri (`/wowco probe`).

## 10. Odločitve za uporabnika

1. ~~Struktura repozitorija~~ → izvedeno (S0, §8.3), Vercel ostane na korenu prek `vercel.json`.
2. ~~Meter v addonu~~ → naš "Details-lite" (A1–A3, A5) + A9 sobivanje (odločil uporabnik: "ti uredi vse").
3. ~~Parsi~~ → samo med člani; tanki: Survival samo informativno, brez barve parsa.
4. ~~Particije~~ → odločeno: sezone po patchu, admin potrdi (§6).
5. **Posnetki WCL strani** (samo kot zgled za UI, ker je stran za bot protection) – lik, izbran boss, poročilo dungeona
   (zavihki Damage/Casts/Buffs/Deaths). Iz njih naredim lastne zaslone, ne kopij.

---

## 11. Tveganja

- `C_DamageMeter` na Forever se lahko razlikuje od retaila (Details cilja na oba) → S1 probe pred S2.
- Skrite vrednosti med bojem: meter mora delovati brez računanja (samo prikaz), odstotki prek `C_CurveUtil`.
- Videz: zasloni so navdihnjeni po WCL/Details!, a naš lasten dizajn (WoW slog portala) – brez njihovih imen, logotipov, grafike.
- Pravi party log še ni bil viden – detektor in segmenti so preverjeni samo na sintetiki (COMPANION.md §14). S3 brez S1 nima smisla.
- Majhna populacija → percentili nestabilni; zato prag N ≥ 5 in Personal %.
- Velikost podrobne analize na Convex Free → meritev v S3, preden izberemo shranjevanje.
- Licenca Details! ("All rights reserved") – samo ideje in javni Blizzard API, nobene kopirane kode/grafike. Barve parsov so
  splošna konvencija, imena/logotipa WCL ne uporabljamo.

---

## Viri (15. 11. 2026)

- Details! izvorna koda: https://github.com/Tercioo/Details-Damage-Meter (`core/parser_nocleu.lua`, `frames/window_breakdown_midnight/breakdown_dataprovider.lua`, `boot.lua`, `plugins/`)
- Details! na CurseForge: https://www.curseforge.com/wow/addons/details (podpira Forever)
- WCL napoved Forever (logi za dungeone, brez rankingov za dungeone): https://x.com/WarcraftLogs/status/2117767961482318221
- WoWAnalyzer (odprtokodna analiza logov, za vzorce analize): https://github.com/WoWAnalyzer/WoWAnalyzer
- WCL Rankings and Parses: https://articles.classic.warcraftlogs.com/help/rankings-and-parses (vsebina iz iskanja; stran za Cloudflare)
- WCL How to Navigate Through Logs: https://www.archon.gg/classic-fresh/articles/help/how-to-navigate-through-logs
- Karazhan zone 1047: https://fresh.warcraftlogs.com/zone/rankings/1047
- Strani za Forever loge: https://undying.app/logs (pregled), https://forever.wowcoach.gg/ (death review, recapi), foreverlogs.gg

## 11. Details! na WoW Forever – kaj sem se naučil (16. 11. 2026, verzija 20261109)
Licenca "All rights reserved": samo branje in učenje, nobene kopirane kode; naš addon ga nikoli ne bere.
- Forever naloži `Details_Camelot.toc` → `core/parser_nocleu.lua` (brez combat loga). Details! večinoma **preobleče
  igrin vgrajeni meter** (overlay/swap) in prikaže njegove številke: `totalAmount`, `amountPerSecond`, `durationSeconds`.
- Sam izračuna samo: **"my spells"** (vrstica na urok lokalnega igralca, pet/guardian z imenom bitja) in **napoje +
  healthstone** (zdravljenje iz urokov z ID-ji napojev/healthstonov, samo po boju – med bojem je vse secret).
- Dejstva o igrinem API-ju: vir v seji ima tudi `specIconID, deathRecapID, deathTimeSeconds, sourceCreatureID,
  classification`; `GetSessionDurationSeconds(0)` = Overall, `(1)` = Current; secret preveri z `issecretvalue`.
- Katalog statistik Details! (klasični, s combat logom): Damage (done, DPS, taken, friendly fire, frags, enemies,
  auras & voidzones, by spell), Heal (done, HPS, overheal, taken, enemy heal, prevented, absorbed, potions),
  Energy (mana, rage, energy, runic, resources, alternate), Misc (CC breaks, ress, interrupts, dispels, deaths,
  defensive cooldowns, buff uptime, debuff uptime). Čas: "effective" (čas boja skupine) ali "active" (čas igralca).

### Primerjava z nami (Companion bere cel combat log → zmore več kot Details! na Forever)
| Statistika | Mi | Opomba |
|---|---|---|
| DPS/HPS runa | škoda / **celoten čas runa** (hoja, AFK, tek do trupla) | Details: effective/active čas → naš run DPS je prenizek |
| DPS bossa (Parses) | škoda / trajanje boja | enako kot igrin meter ✓ |
| Friendly fire, CC breaks, enemy heal, potions/healthstone, energija po vrsti | ✗ | manjka |
| Damage by spell (vsa skupina) | ✗ na portalu | podatki že so (uroki po igralcu) |
| Overheal, absorbs, interrupts, dispels, deaths, ress, buff/debuff uptime, frags, enemies | ✓ | |

### 11.1 Narejeno (16. 11. 2026, Companion 0.1.15, addon 0.6.2)
- **DPS/HPS** delita s **časom boja skupine** (`RunSummary.combatMs`: škoda med partyjem in sovražniki, vrzeli ≤ 3,5 s –
  kot Details! "effective time"); prej cel run. Bossi (Parses) nespremenjeni.
- Novo na igralca: `potions`, `potionHealing` (ime vsebuje Potion/Healthstone), `friendlyFire`, `ccBreaks`
  (SPELL_AURA_BROKEN(_SPELL), vir = kdo je prekinil), `power` po vrsti; na run: `enemyHeals` (top 5 mobov).
- **Predmeti:** addon prebere `C_Item.GetItemInfo` + `C_TooltipInfo.GetItemByID` → `v1|ITEM|…` → Companion `items`
  → tabela `itemDetails` → tooltip na portalu (skupni `ItemTooltip.svelte` z opremo junaka) in v poročilu Companiona.
- Portal: Big Numbers (Potion addict, Friendly fire, Sheep breaker, Mana sponge, Damage by spell, Mobs that healed),
  glava runa "… actually fighting".
