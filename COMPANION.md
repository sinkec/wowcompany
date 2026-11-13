# WowCompany Companion – načrt (desktop aplikacija + dungeon analitika)

> Samostojen dokument: vsebuje vse, kar je potrebno za nadaljevanje dela brez prejšnjega pogovora.
> Povezan z [PLAN.md](PLAN.md) (portal: SvelteKit + Convex + Vercel, že v produkciji).
> Datum: 13. 11. 2026 · Stanje: **C1–C4 končane** (parser, detektor+analizator, Convex API + /link, Tauri aplikacija za Linux), naslednja C5 (portal Dungeon Runs).

---

## 0. Povzetek v eni minuti

- **Kaj:** namizna aplikacija **WowCompany Companion** (Tauri 2: Rust + Svelte) za **Windows in Linux (Steam Proton / Lutris)**.
- Bere datoteko, ki jo igra zapiše sama (`WoWCombatLog*.txt`, po želji `WoWChatLog.txt`), **na računalniku** zazna dungeon run,
  izračuna analitiko (DPS/HPS, smrti, prekinitve, časovnica, bossi …) in jo **ob koncu runa samodejno objavi** na Convex.
- **Prijava:** z Google računom prek brskalnika (portal preveri, da je uporabnik **član** WowCompany) → aplikacija dobi svoj preklicni žeton.
- **Portal:** nova rubrika **Dungeon Runs** (seznam runov + podrobna analiza), po želji objava povzetka v Discord.
- **Brezplačno:** ostane v Convex Free in Vercel Hobby (izračun v razdelku 10). Namestitvene datoteke na GitHub Releases.
- **Ne:** branje pomnilnika igre, avtomatizacija, karkoli proti Blizzardovim pravilom. Samo datoteke, ki jih igra zapiše za to namenjeno.

---

## 1. Cilji in obseg

| Prioriteta | Funkcija |
|---|---|
| MVP | Zaznava dungeon runa (vstop/izstop, party, začetek, trajanje) |
| MVP | Meter na računalniku med igro (DPS/HPS po igralcu) v oknu aplikacije |
| MVP | Analiza runa: damage/healing po igralcu in uroku, smrti (+ zadnji udarci), časovnica 10 s, segmenti (bossi/trash) |
| MVP | Samodejna objava ob koncu runa + čakalna vrsta in ponovni poskus, če ni interneta |
| MVP | Portal: Dungeon Runs (seznam + podrobnosti), vidnost javno/zasebno |
| Faza 2 | Loot zgodovina partyja (iz `/chatlog`), Discord objava runa, šaljive nagrade |
| Faza 2 | Živo pošiljanje vsakih 10 s (opcijsko stikalo) + živi pogled na portalu |
| Faza 3 | Mini WoW addon: samodejni `/combatlog` v instancah, in-game meter, natančnejši loot (need/greed rolli) |
| Faza 3 | Primerjave runov, osebni rekordi, trendi |

---

## 2. Kaj igra dovoli (omejitve, ki določajo arhitekturo)

| | Omrežje | Bojni podatki | Loot / chat |
|---|---|---|---|
| **WoW addon** | ❌ addoni ne morejo pošiljati na internet | ✅ v živo v igri | ✅ v živo (CHAT_MSG_LOOT, rolli) |
| **Zunanja aplikacija** | ✅ | ✅ prek `WoWCombatLog*.txt` (enako kot Warcraft Logs uploader) | ✅ prek `WoWChatLog.txt` (`/chatlog`) – **preveriti v Forever** |

- Addon podatke lahko zapiše samo v **SavedVariables** (na disk šele ob `/reload` ali odjavi) → za sprotni prenos ni uporaben.
- Combat log ne vsebuje loota → loot iz chat loga (faza 2) ali addona (faza 3).
- Combat logging je treba vklopiti z `/combatlog` (vsako sejo) – addon ga lahko vklopi samodejno ob vstopu v instanco (`LoggingCombat(true)`, kot "AutoCombatLogger"). **Preveriti v Forever.**
- **ToS:** branje lastnih log datotek je dovoljeno (Warcraft Logs, Details!). Ne beremo pomnilnika, ne vplivamo na igro.

---

## 3. Preverjena dejstva o combat logu WoW Forever (vzorec 13. 11. 2026)

Vzorec: `wowlog/WoWCombatLog-111326_173926.txt` (2,1 MB, 9.726 vrstic, 15 min v Tirisfal Glades, **brez partyja in dungeona**). Mapa `wowlog/` je v `.gitignore` (vsebuje imena igralcev).

- Prva vrstica: `COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,0,BUILD_VERSION,1.60.1,PROJECT_ID,18`
  → **sodoben format (v22)**, enak kot Classic Era / Anniversary; addon Interface verzija **16001**.
- Ime datoteke: `WoWCombatLog-MMDDYY_HHMMSS.txt` (nova datoteka ob vsakem `/combatlog`).
- Vrstica: `MM/DD/YYYY HH:MM:SS.ffff␠␠EVENT,polja…` (dva presledka, nato CSV z narekovaji).
- **Napredni parametri so prisotni** pri damage/heal/cast dogodkih kljub `ADVANCED_LOG_ENABLED,0`:
  infoGUID, ownerGUID, trenutni/max HP, AP, SP, armor, absorb, power, pozicija X/Y, uiMapID, facing, (level/ilvl).
- Prisotni dogodki: `SPELL_DAMAGE`, `SPELL_PERIODIC_DAMAGE`, `RANGE_DAMAGE`, `SWING_DAMAGE`, `SWING_DAMAGE_LANDED`,
  `SPELL_HEAL`, `SPELL_PERIODIC_HEAL`, `SPELL_MISSED`, `SWING_MISSED`, `UNIT_DIED`, `PARTY_KILL`, `SPELL_AURA_*` (+ `_DOSE`, `_REFRESH`),
  `SPELL_CAST_START/SUCCESS`, `SPELL_ENERGIZE`, `SPELL_PERIODIC_ENERGIZE`, `SPELL_SUMMON`, `SPELL_RESURRECT`,
  `ENVIRONMENTAL_DAMAGE`, `ZONE_CHANGE`, `MAP_CHANGE`.
- Imena igralcev: `Ime-Priimek-PvP-EU` → neposredno se ujema s portalskim `slug` (`ime-priimek`).
- GUID: `Player-<server>-<hex>`, `Creature-0-…-<npcId>-…`.
- Zastavice (unit flags): `0x511` = jaz, `0x518` = zunanji igralec. Party/raid zastavice (`0x512`/`0x514`) v vzorcu **ni** (ni bilo skupine).
- **Postavitev polj (preverjeno s parserjem, vseh 9.726 vrstic brez napake):**
  - Osnova vsake enotske vrstice: `source GUID, "ime", flags, raidFlags, dest GUID, "ime", flags, raidFlags` (+ urok `id, "ime", šola` pri `SPELL_*`/`RANGE_*`).
  - **Napredni blok = 19 polj:** infoGUID, ownerGUID, curHP, maxHP, AP, SP, armor, absorb, **?, ?** (vedno 0), powerType, curPower, maxPower, powerCost, X, Y, uiMapID, facing, level
    (pri igralcih verjetno ilvl). Kateri enoti pripada, pove `infoGUID`: pri `SPELL_DAMAGE`/`RANGE`/`PERIODIC` in `SWING_DAMAGE_LANDED` je to **cilj**, pri `SWING_DAMAGE`/`SPELL_HEAL`/`CAST_SUCCESS` **izvor**.
  - Damage suffix: `amount, baseAmount, overkill(-1 = ni), school, resisted, blocked, absorbed, crit, glancing, crushing` + pri urokih `ST`/`AOE`.
    `baseAmount` = pred zmanjšanjem (oklep, crit). Za DPS štejemo `amount`.
  - Heal: `amount, baseAmount, overheal, absorbed, crit`. Energize: `amount, over, powerType, maxPower`. Miss: `tip, offHand[, amount][, ST]`.
  - `ENVIRONMENTAL_DAMAGE`: napredni blok, nato tip (`Falling`, `Fire`, `Lava` …), nato damage suffix.
  - `SWING_DAMAGE_LANDED` je **dodatna** kopija swinga z vidika cilja (35 vs 62 v vzorcu – ni 1:1) → v DPS se ne šteje.
  - Zastavica `0x1118` = ljubljenček tujega igralca (pet + outsider); `0x1111`/`0x1112` bi bil moj/party pet.
- **Daljši pravi log (13. 11. 2026, 106 min, 46.356 vrstic, brez dungeona) – preverjeno s parserjem, 0 slabih vrstic:**
  - `/console advancedCombatLogging 1` → glava `ADVANCED_LOG_ENABLED,1`; `/reload` **ne** ustvari nove datoteke (v isto datoteko se zapiše nova glava `COMBAT_LOG_VERSION`).
  - `ZONE_CHANGE` v odprtem svetu nosi ID kontinenta (`0` Eastern Kingdoms, `1` Kalimdor) + ime cone; vsak prehod cone ga zapiše.
  - `SPELL_ABSORBED`: 19 polj (melee) / 22 polj (z napadalnim urokom) – ustreza parserju.
  - `SPELL_AURA_BROKEN_SPELL`: šola drugega uroka je **decimalna** (`64`), ne hex – parser popravljen.
  - Prisotni še: `DAMAGE_SHIELD` (z `AOE`), `SPELL_CAST_FAILED` (z razlogom), `SPELL_DRAIN`, `SPELL_CREATE`, `SPELL_EXTRA_ATTACKS`.
- **Mapa Logs na Linuxu (preverjeno):** Battle.net kot non-Steam igra v Steamu (Proton):
  `~/.steam/debian-installation/steamapps/compatdata/<id>/pfx/drive_c/Program Files (x86)/World of Warcraft/_forever_/Logs`
  (`~/.steam/root` je povezava nanjo). Flavor mapa za Forever je **`_forever_`**.
- **Še ni preverjeno** (potreben vzorec iz dungeona s partyjem):
  `ENCOUNTER_START/END` (boss segmenti), `ZONE_CHANGE` ob vstopu v instanco (instance ID/tip), party zastavice,
  `COMBATANT_INFO` (oprema/talenti ob pullu – zahteva `/console advancedCombatLogging 1`), `SPELL_ABSORBED`, `SPELL_INTERRUPT`, `SPELL_DISPEL`.

### 3.1 Javni viri (iskanje 13. 11. 2026)
- **Javnega vzorca Forever dungeon loga ni.** Orodja za Forever (npr. `mdn87/wow-forever-helper`) navajajo "verified so far: synthetic logs only"
  in da ni potrjeno, ali Forever v dungeonih zapiše `ENCOUNTER_START/END`. Prav tako poročajo, da je treba logiranje ponovno vklopiti po vsaki prijavi/reloadu.
- `ENCOUNTER_START` (splošno WoW): `encounterID, "name", difficultyID, groupSize` (dungeon = groupSize 5); `ENCOUNTER_END` doda `success`.
  Encounter ID je **DungeonEncounterID** (ne Encounter Journal ID).
- **Seznam Forever dungeonov z ID-ji** (vir: addon `postblink/KwikTip`, `Forever/DungeonData.lua`; avtor sam navaja, da je del
  "pending validation" → **NEPREVERJENO**, potrditi z našim vzorcem). Format: instanceID · encounterID ime.

| Dungeon | instanceID | Bossi (encounterID ime) |
|---|---|---|
| The Hall of Thanes *(novo v Forever)* | 3065 | 3493 Faldrim Anvilmar · 3495 Infurnus · 3494 Plunder · 3496 Durgen Dirgehammer |
| Ragefire Chasm | 389 | 2732 Oggleflint · 2733 Taragaman the Hungerer · 2734 Jergosh the Invoker · 2735 Bazzalan |
| Stormwind Stockade | 34 | 2756 Targorr the Dread · 2757 Kam Deepfury · 2758 Hamhock · 2759 Dextren Ward · 2760 Bazil Thredd |
| Ruins of Lordaeron *(novo)* | 2999 | 3353 Witherfang · 3357 The Abandoned · 3411 Viktor the Vile · 3412 Bjork · 3354 Rath'mael |
| Excavation Site: Wetlands *(novo)* | 2998 | 3480 Saltspine · 3481 Shadetooth · 3644 Highland Horror · 3482 Relic Guardian |
| City of Dalaran *(novo)* | 2959 | 3311 Atrexis the Grave Knight · 3310 Lyn the Ignored · 3298 Arcane Anomaly · 3299 Fel Ancient · 3300 Mana Devourer · 3302 Unstable Sentinel · 3303 Shade of the Archmage |
| Deadmines | 36 | 2741 Rhahk'Zor · 2742 Sneed · 3676 Miner Johnson · 2743 Gilnid · 2745 Mr. Smite · 2744 Captain Greenskin · 2747 Edwin VanCleef · 2746 Cookie |
| Wailing Caverns | 43 | 585 Lady Anacondra · 586 Lord Cobrahn · 587 Kresh · 588 Lord Pythas · 589 Skum · 590 Lord Serpentis · 591 Verdan the Everliving · 592 Mutanus the Devourer |
| Shadowfang Keep | 33 | 2748 Rethilgore · 2749 Razorclaw the Butcher · 2750 Baron Silverlaine · 2751 Commander Springvale · 2752 Odo the Blindwatcher · 2753 Fenrus the Devourer · 2754 Wolf Master Nandos · 2755 Archmage Arugal |
| Blackfathom Deeps | 48 | 2916 Ghamoo-ra · 2915 Lady Sarevess · 2913 Lorgus Jett · 2912 Old Serra'kis · 2911 Twilight Lord Kelris · 2910 Aku'mai |
| Gnomeregan | 90 | 2768 Grubbis · 2769 Viscous Fallout · 2770 Electrocutioner 6000 · 2771 Crowd Pummeler 9-60 · 2772 Mekgineer Thermaplugg |
| Razorfen Kraul | 47 | 2773 Roogug · 2774 Aggem Thorncurse · 2775 Death Speaker Jargba · 2776 Overlord Ramtusk · 2777 Agathelos the Raging · 2778 Charlga Razorflank |
| Uldaman | 70 | 547 Revelosh · 548 The Lost Dwarves · 549 Ironaya · 1887 Obsidian Sentinel · 551 Ancient Stone Keeper · 552 Galgann Firehammer · 553 Grimlok · 554 Archaedas |
| Razorfen Downs | 129 | 2780 Tuten'kash · 2781 Plaguemaw the Rotting · 2782 Mordresh Fire Eye · 2783 Ragglesnout · 2784 Glutton · 2785 Amnennar the Coldbringer |
| Scarlet Monastery | 189 | 444 Interrogator Vishas · 2779 Bloodmage Thalnos · 446 Houndmaster Loksey · 447 Arcanist Doan · 448 Herod · 449 High Inquisitor Fairbanks · 450 High Inquisitor Whitemane |
| Zul'Farrak | 209 | 593–600 (Velratha, Gahz'rilla, Antu'sul, Theka, Zum'rah, Nekrum, Sezz'ziz, Ukorz Sandscalp) |
| Maraudon | 349 | 422–429 (Noxxion … Princess Theradras) |
| Sunken Temple | 109 | 3582–3589 (Atal'alarion … Avatar of Hakkar) |
| Blackrock Depths | 230 | 227–244, 2789, 2790 (… Emperor Dagran Thaurissan) |
| Dire Maul | 429 | 343–368, 2792–2794 (… King Gordok) |
| Scholomance | 289 | 2801–2813 (… Darkmaster Gandling) |
| Stratholme | 329 | 472–484, 2798–2800 (… Baron Rivendare) |

Opombe vira: Scarlet Monastery (189) in Dire Maul (429) si delita karto med krili; Stratholme ne loči strani.
Naš solo vzorec že vsebuje statistiko "Bazzalan kills (Ragefire Chasm)" → RFC obstaja v Forever.

**Posledica za načrt:** parser začnemo na solo vzorcu + **sintetičnih** testnih vrsticah (`ENCOUNTER_START/END`, party zastavice);
detektor runa se opira na `ZONE_CHANGE` z instanceID iz tabele, `ENCOUNTER_*` (če obstajajo) in rezervo "smrt znanega boss NPC-ja".
Pravi dungeon vzorec ostaja potreben za potrditev pred izdajo.

---

## 4. Arhitektura (popravljena glede na prvotno idejo)

```
WoW (Windows ali Proton/Lutris)
 ├─ /combatlog → Logs/WoWCombatLog-*.txt ───────┐
 ├─ /chatlog   → Logs/WoWChatLog.txt  (faza 2) ─┤  datoteke
 └─ [faza 3] mini addon: samodejni /combatlog ──┘
                                                ▼
WowCompany Companion (Tauri 2 · Rust jedro + Svelte UI · Windows + Linux)
 • iskanje mape Logs (Windows pot, Steam compatdata, Lutris, ročno)
 • sledenje datoteki (tail) → parser → detektor runa → agregator
 • okno: živi meter na računalniku, seznam runov, stanje uploadov
 • lokalna čakalna vrsta (SQLite) + ponovni poskus
 • prijava: brskalnik (Google na portalu) → žeton naprave v OS keyringu
                                                ▼  HTTPS, Bearer žeton naprave
Convex HTTP akcije (neposredno, mimo Vercela)
 • POST /companion/link/*   – povezava naprave
 • POST /companion/runs     – objava končanega runa (MVP)
 • POST /companion/live     – sprotni paketi vsakih 10 s (faza 2)
                                                ▼
Convex tabele: runs, runPlayers, devices, deviceLinks …  → žive naročnine
                                                ▼
Portal (SvelteKit na Vercelu): /runs, /runs/[id]  ·  Discord objava runa (faza 2)
```

### Spremembe glede na prvotno idejo (in zakaj)

1. **Objava ob koncu runa kot osnova, živo pošiljanje kot opcija (faza 2).**
   Tvoja zadnja zahteva ("ko se dungeon zaključi, aplikacija avtomatsko objavi") je zanesljivejša in cenejša:
   en zahtevek na run namesto ~180 na 30 minut, deluje tudi ob prekinitvah interneta (čakalna vrsta), analiza je narejena
   na celotnih podatkih. Živi meter ima igralec **v oknu aplikacije** že v MVP; živi pogled na portalu pride kot stikalo v fazi 2.
2. **Google prijava prek brskalnika namesto znotraj aplikacije.**
   Aplikacija odpre portal v privzetem brskalniku (tam si že prijavljen z Googlom), portal preveri **članstvo** in napravo
   poveže. Enako delajo VS Code, Spotify, GitHub CLI. Prednosti: brez novega Google OAuth clienta, brez gesel v aplikaciji,
   člansko preverjanje na strežniku, žeton naprave je preklicen v portalu ("My devices").
3. **Analiza se računa na računalniku, na strežnik gre kompakten povzetek** (~50–300 KB na run namesto 5–20 MB surovega loga).
   Edino tako ostanemo v brezplačnem paketu (0,5 GB baze, 1 GB DB I/O).
4. **Loot iz `/chatlog` namesto addona** (faza 2). Chat log zapiše "X receives loot: [item]" sproti, addon ni potreben.
   Addon ostane za samodejni `/combatlog`, in-game meter in need/greed rolle (faza 3).
5. **En run, več snemalcev.** Če ima aplikacijo več članov istega partyja, strežnik prepozna isti run
   (instanca + čas začetka ± 2 min + vsaj 2 skupna člana) in ga **združi** (ohrani najpopolnejšo analizo, zabeleži vse snemalce).
   Ni podvojenih runov in ni potrebe po "izbiri glavnega snemalca" na odjemalcu.
6. **Samo party.** Aplikacija pošlje samo podatke igralcev z party/raid/mine zastavicami (ostali igralci v bližini nikoli ne zapustijo računalnika).

---

## 5. Desktop aplikacija – zgradba

### 5.1 Tehnologija (preverjeno 13. 11. 2026)
- **Tauri 2** (stabilno, `@tauri-apps/cli` 2.12.x) – **ne** Tauri 3 alfa.
- Rust 1.99 (nameščen), Bun (nameščen) za frontend.
- UI: **Svelte 5 + Vite + Tailwind v4 + shadcn-svelte**, ista WoW tema kot portal (barve, Cinzel, `wow-frame`).
- Rust crate-i (preveriti verzije ob začetku): `tauri` 2, `tokio`, `reqwest` (rustls), `serde`/`serde_json`,
  `notify` (stabilna 8.x – **ne** 9 rc), `rusqlite` (bundled), `keyring` 4 (fallback: datoteka s pravicami 0600),
  `directories`, `chrono`, `thiserror`/`anyhow`, `tracing`.
- Tauri vtičniki: `updater`, `opener` (odpiranje brskalnika), `single-instance`, `autostart` (opcijsko), `notification`.
- **Linux build odvisnosti (enkrat, potrebuje sudo):**
  `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev build-essential libssl-dev`
  (na sistemu je `libgtk-3-dev` že nameščen, WebKitGTK 4.1 manjka).

### 5.2 Rust moduli
| Modul | Naloga |
|---|---|
| `wowlog` (ločen crate, brez Tauri) | Parser vrstice → `Event` (tip, čas, izvor/cilj GUID+ime+zastavice, urok, količine, napredni parametri). Robusten na neznane dogodke. **Enotski testi na vzorcu.** |
| `locate` | Iskanje mape `Logs`: Windows (`C:\Program Files (x86)\World of Warcraft\_<flavor>_\Logs`, registri), Linux (`~/.steam/steam/steamapps/compatdata/*/pfx/drive_c/...`, `~/Games/*` (Lutris), ročna izbira). Prikaže najdene kandidate. |
| `tail` | Spremljanje najnovejše `WoWCombatLog-*.txt` (notify + branje od zadnjega offseta, menjava datoteke, delne vrstice). |
| `run_detector` | Stanje: zunaj → v instanci → run → konec. Začetek: `ZONE_CHANGE` v dungeon (+ prvi boj partyja). Konec: izhod iz instance, ali 10 min brez boja, ali ročni gumb. Party = enote z mine/party zastavicami. |
| `analyzer` | Agregati na igralca/urok/segment, časovnica 10 s, smrti (zadnjih 10 dogodkov pred `UNIT_DIED`), prekinitve, dispeli, uptime aur, overheal, avoidable damage (okolje). |
| `uploader` | SQLite čakalna vrsta, `POST /companion/runs` z gzip JSON, eksponentni ponovni poskus, idempotentni `runKey`. |
| `auth` | Povezava naprave (razdelek 7), shranjevanje žetona v keyring. |
| `ipc` | Tauri ukazi/dogodki za UI (stanje, živi meter, seznam runov). |

### 5.3 Zasloni (Svelte, angleščina, WoW ton)
1. **Welcome / Link account** – "Sign in with Google" (odpre brskalnik), prikaz kode, stanje.
2. **Setup** – izbira mape Logs (samodejno najdena + ročno), navodilo za `/combatlog` in `advancedCombatLogging`.
3. **Live** – trenutni run: trajanje, DPS/HPS meter (barve razredov), smrti, segment.
4. **Runs** – lokalni seznam (stanje objave: čaka / objavljeno / napaka), gumb "Open on portal".
5. **Settings** – mapa, samodejni zagon, živo pošiljanje (faza 2), odjava naprave, verzija + posodobitve.
6. Ikona v sistemski vrstici (tray): stanje (spi / snema / objavlja).

---

### 5.4 Izvedba (C4, 13. 11. 2026)
- `desktop/` – Svelte 5 + Vite 8 + Tailwind 4 (brez SvelteKita), `desktop/src-tauri/` – Tauri 2.12 (član Cargo workspace), lib `companion_lib`.
- Moduli: `settings.rs` (nastavitve JSON + žeton v datoteki **0600** – keyring kasneje), `locate.rs` (Steam/Proton vse knjižnice iz
  `libraryfolders.vdf`, Flatpak/Snap Steam, Lutris `~/Games`, Bottles, `~/.wine`; Windows diski C–Z; `_forever_` ima prednost),
  `tail.rs` (polling 0,5 s, delne vrstice, menjava/skrajšanje datoteke, ob zagonu ignorira loge starejše od 12 h, dokler se ne spremenijo),
  `queue.rs` (SQLite `runs.sqlite`: pending/uploaded/failed, backoff 30 s → 1 h), `api.rs` (ureq 3 + rustls; 401/403 → ponovna povezava,
  429/5xx/omrežje → ponovni poskus, drugi 4xx → "Rejected"), `engine.rs` (niti watcher/uploader/linker + `Pipeline`), `commands.rs`, `lib.rs` (tray, single-instance).
- **Strežnik:** privzeto prod `https://laudable-crane-432.eu-west-1.convex.site`; povozi `WOWCOMPANY_API` (env ob zagonu ali buildu) ali Settings → Advanced.
- **Čas:** `utc_offset_ms` iz lokalne časovne cone (chrono) ob zagonu cevovoda.
- **Ponoven zagon:** log se prebere od začetka (run v teku se obnovi), že znani runi se po `runKey` ne podvojijo.
- **Razvoj:** `cd desktop && bun install && bunx tauri dev`; build `bunx tauri build --debug --no-bundle`.
  UI brez Tauri: `bun run dev` → `http://localhost:1420/mock.html?tab=live|runs|settings&linked=0&pending=1` (mockIPC, `src/mock.ts`).
- **Testi:** `cargo test -p wowcompany-companion` (11) + E2E proti dev:
  `WOWCOMPANY_API=<dev>.convex.site cargo test -p wowcompany-companion --test api_dev -- --ignored`.
- **Preizkus prave aplikacije (dev):** samodejno najdena mapa Logs, branje pravega loga (46k vrstic), povezava naprave
  (koda → odobritev → žeton 0600 → glavni zasloni), sintetični run → zaznan → zaprt zaradi neaktivnosti → naložen na dev.

---

## 6. Zaznavanje runa in analitika

### 6.1 Run
- **Začetek:** vstop v instanco tipa dungeon (`ZONE_CHANGE`/`MAP_CHANGE`; seznam Forever dungeonov po imenu/ID – iz vzorca dungeona) in prvi boj z vsaj 2 člana partyja.
- **Konec:** izstop iz instance **ali** 10 min neaktivnosti **ali** ročno. Če je log zaprt med runom → run se zaključi ob zadnjem dogodku.
- **runKey:** `hash(zoneId, zaokrožen začetek, urejen seznam GUID-ov partyja)` → idempotenca in združevanje.
- **Segmenti:** boss (`ENCOUNTER_START/END`, če obstaja; sicer smrt znanega boss NPC-ja) in trash med njimi.

### 6.1a Izvedba v `crates/wowrun` (C2, preverjeno samo na sintetičnih logih)
- **Začetek runa** = prvi boj skupine (damage/miss med group enoto in ne-group enoto) po `ZONE_CHANGE` v dungeon iz tabele 3.1.
  Rezervi za vstop: `MAP_CHANGE` z imenom dungeona, `ENCOUNTER_START` z instanceID.
- **Corpse run:** izhod (`ZONE_CHANGE` drugam) run samo "parkira"; povratek v isti dungeon v **15 min** (`rejoin_grace_ms`) ga nadaljuje.
- **Reset instance:** uid kopije instance iz GUID-a sovražnih NPC-jev (`Creature-0-server-instance-<uid>-npc-spawn`, peti/guardiani
  izključeni). Če je po povratku uid drugačen → stari run `instanceReset`, začne se nov.
- **Konec:** `leftInstance` (grace potekel), `newInstance`, `instanceReset`, `inactivity` (10 min brez boja; konec = zadnja aktivnost),
  `endOfLog`, `manual`; `inProgress` = živi posnetek (`Detector::snapshot()` za meter v aplikaciji). `Detector::tick(now)` zapre run brez novih vrstic.
- **Solo farmanje se zavrže:** run z manj kot `min_players` = 2 igralcema skupine se ne pošlje.
- **runKey** (FNV-1a 64, hex): `instanceID | uid | lokalni dan` → enak za vse snemalce istega runa (strežnik združi); brez uid:
  `instanceID | začetek/5 min | GUID-i skupine`.
- **Peti:** lastnik iz `SPELL_SUMMON` ali `ownerGUID` v naprednem bloku; damage peta šteje lastniku (`SpellStat.pet = true`).
- **Swingi:** `SWING_DAMAGE_LANDED` se šteje samo, če v 500 ms pred njim ni enakega `SWING_DAMAGE` (izvor+cilj+znesek).
- **Zasebnost:** v povzetku samo igralci skupine; tuji igralci kot `"Stranger"` / `"Stranger's pet"` (ubijalec, recap).
- **Čas:** `startedAt`/`endedAt` = UTC ms (lokalni čas loga − `utc_offset_ms`, ki ga poda aplikacija); odmiki v runu relativni na začetek.
- **Shema za upload** (`schema: 1`, camelCase JSON) = `crates/wowrun/src/summary.rs` → osnova za Convex validator v C3.
  Sintetični run s 5 segmenti ≈ 2–6 KB (pod oceno 50–300 KB iz razdelka 10).

### 6.2 Analiza (kaj se pošlje)
- Na igralca: damage done/taken, healing done (+ overheal), DPS/HPS (aktivni čas), smrti, prekinitve, dispeli, top 10 urokov, crit %.
- Časovnica: 10-s kanglice (damage, healing, damage taken) na igralca.
- Smrti: čas, ubijalec, zadnjih 10 dogodkov (dmg/heal, HP).
- Segmenti: trajanje, wipe/kill, DPS v segmentu.
- Party: člani (slug, razred, level, ilvl iz naprednih parametrov), snemalec, verzija aplikacije.
- **Šaljive nagrade** (izračun na strežniku): *Floor Inspector* (največ smrti), *Pyromaniac* (največ okoljske škode), *Overhealer Supreme*, *Pacifist* (najmanj damage), *Speedrunner*…

---

## 7. Prijava naprave (Google prek brskalnika)

1. Aplikacija: `POST /companion/link/start` → `{ linkId, code: "RAVEN-4821", expiresAt }` (velja 10 min).
2. Aplikacija odpre `https://wowcompany.vercel.app/link?code=RAVEN-4821` v brskalniku.
3. Portal: uporabnik je prijavljen z Googlom (sicer najprej prijava). Strežnik preveri, da je **član ali admin**. Pokaže
   "Link *ime naprave* to your account?" → **Approve**.
4. Aplikacija pollа `POST /companion/link/poll {linkId}` → ob odobritvi dobi **žeton naprave** (32 B naključno, enkrat).
   V bazi je shranjen samo **SHA-256** žetona.
5. Vsak upload: `Authorization: Bearer <žeton>` → strežnik preveri hash, napravo in članstvo uporabnika.
6. Portal: **My devices** (seznam, zadnja uporaba, prekliči). Admin lahko prekliče vse naprave uporabnika.

Varnost: rate limit na `link/start` in `poll`, koda je kratkotrajna, žeton nikoli v URL-ju, brez Google skrivnosti v aplikaciji.

---

## 8. Convex (backend) – razširitve

### 8.1 Tabele
| Tabela | Polja (osnutek) |
|---|---|
| `devices` | `userId`, `name`, `tokenHash`, `createdAt`, `lastSeenAt`, `revokedAt?`, `appVersion` |
| `deviceLinks` | `code`, `status` (pending/approved/expired), `deviceName`, `userId?`, `tokenHash?`, `expiresAt` |
| `runs` | `runKey`, `zone`, `zoneId`, `startedAt`, `durationMs`, `result`, `party[] {slug, name, classId, level}`, `playerIds[]`, `recordedBy[]`, `summary` (totali, nagrade), `createdAt` |
| `runPlayers` | `runId`, `slug`, `playerId?`, agregati, top uroki, časovnica (kompaktni nizi), smrti |
| `runSegments` | `runId`, `name`, `kind` (boss/trash), `start`, `end`, `result`, DPS po igralcu |
| `runLoot` (faza 2) | `runId`, `slug`, `itemName`, `quality`, `at` |

Omejitve Convexa: dokument ≤ 1 MiB, polja ≤ 1024, globina ≤ 16, array ≤ 8192 → časovnica kot števila v nizih/arrayih po igralcu; velik run razdeljen na `runPlayers`.

### 8.2 HTTP endpointi (Convex HTTP akcije)
- `POST /companion/link/start`, `POST /companion/link/poll`
- `POST /companion/runs` (gzip JSON, max ~2 MB) → validacija (verzija sheme, velikost, samo party), združevanje po `runKey`, zapis.
- `POST /companion/live` (faza 2)
- Vse s CORS izključenim (ni brskalniški API), rate limit po napravi.

### 8.2a Izvedba (C3, 13. 11. 2026 – deployano na **dev**, prod ob naslednjem pushu)
- Datoteke: `src/convex/companion.ts` (mutacije/poizvedbe), `companionHttp.ts` (HTTP), `lib/companion.ts` (čiste funkcije: `checkRun`,
  `runScore`, `computeAwards`, kode), `lib/companionSchema.ts` (validatorji = `summary.rs`, `SCHEMA_VERSION = 1`), stran `src/routes/link/+page.svelte`.
- **Tabele (sprememba glede na 8.1):** namesto `runPlayers` + `runSegments` je **en `runDetails` dokument na run** (players, segments, deaths,
  timeline; 5–100 KB, meja 1 MiB) + `runParticipants` (slug → run, indeks `by_slug_and_started_at` za zavihek Runs na strani junaka).
  `runs` je majhen (seznam): zone, čas, rezultat, party (slug, ime, playerId, dmg/heal/deaths), `recordedBy[]`, `awards[]`, `score`.
- **Povezava:** `POST /companion/link/start {deviceName, appVersion?}` → `{code "MURLOC-4821", pollToken, linkUrl, expiresAt}` (10 min);
  `POST /companion/link/poll {pollToken}` → `pending | approved {token "wcc_…", deviceId} | claimed | denied | expired | unknown`.
  Žeton se vrne **samo enkrat**; v bazi sta samo SHA-256 žetona in poll skrivnosti. Odobritev na `/link?code=…` (samo član/admin), tam tudi **My devices** + Revoke.
- **Upload:** `POST /companion/runs`, `Authorization: Bearer wcc_…`, telo = RunSummary (navaden JSON, **brez gzip**, max 2 MB).
  Odgovori: 201 nov run, 200 obstoječ (`recorderAdded`, `replaced`), 400 (shema/validator/`checkRun` z razlogom), 401 neznan žeton,
  403 preklicana naprava / ni več član, 429 + `Retry-After`. En upload = 1 HTTP akcija + 1 mutacija.
- **Združevanje:** po `runKey`; snemalec se doda po napravi (idempotentno); če ima nov posnetek višji `runScore`
  (trajanje + 10 min na ubitega bossa + segmenti), zamenja podrobnosti in party.
- **Nagrade (strežnik):** Main Character, Floor Inspector, Pyromaniac, Bullet Sponge, Overhealer Supreme, Shut Up Button, Pacifist.
- **Rate limit** (`@convex-dev/rate-limiter` 0.4.3): link/start 30/h za vse, poll 40/min na povezavo, upload 30/h (burst 10) na napravo.
- **Cron:** `companion link cleanup` dnevno ob 4:30 (zahteve starejše od 1 dneva).
- **CLI (interno):** `companion:approveLinkAs`, `companion:deleteRun`, `companion:deleteDevice`.
- **Testi:** `bun test` (`tests/companion.test.ts`, 21 testov) + `bun run check:companion` = E2E na dev (26 preverjanj, za sabo pobriše).
- **Še ni:** poizvedbe za portal (`/runs`) in vidnost (8.3) → C5; Discord objava → C7.

### 8.3 Vidnost
- Nova polja vidnosti: `runs` (seznam runov), `runDetails` (meter/analiza), `runDeaths`. Ločeno za **Website** in **Discord** kot obstoječa stikala.
- Obiskovalec: privzeto vidi samo seznam (dungeon, trajanje, party) – številke za člane.

---

## 9. Portal – rubrika "Dungeon Runs"
- `/runs`: seznam (dungeon, datum, trajanje, party z barvami razredov, rezultat, "recorded by"), filter po junaku/dungeonu.
- `/runs/[id]`: meter (damage/healing/taken), časovnica (graf, en niz na graf), smrti z zadnjimi udarci, segmenti (bossi), nagrade, loot (faza 2).
- Stran junaka: zavihek **Runs** (njegovi runi, osebni rekordi).
- Discord (faza 2): objava ob novem runu ("Deadmines cleared in 34:12. Grobos died 7 times. Floor Inspector award goes to…").
- Admin → Portal Room: sekcija **Companion** (navodila za namestitev, povezava za prenos, seznam naprav).

---

## 10. Brezplačni paketi – izračun

Predpostavka: 10 aktivnih igralcev, ~90 dungeon runov na mesec (≈3 na dan), party 5, aplikacija pri 2–3 članih.

| Convex Free | MVP (objava ob koncu) | + živo pošiljanje (faza 2, en snemalec na party) |
|---|---|---|
| 1 M klicev funkcij | ~90 × 3 snemalci × ~3 klici ≈ **1 k** + ogledi | + ~90 × 180 paketov × 2 ≈ **32 k** |
| 0,5 GB baze | ~90 × 200 KB ≈ **18 MB/mesec** | enako (paketi se po koncu zbrišejo) |
| 1 GB DB I/O | ogled runa ~200 KB → 1000 ogledov ≈ 200 MB | živi pogled bere majhen dokument s seštevki |
| 20 GB-ur | zanemarljivo | zanemarljivo |

Obstoječi portal porabi ~100 k klicev in ~150–200 MB DB I/O na mesec → **skupaj daleč pod limiti**.
**Vercel:** aplikacija pošilja neposredno v Convex (`*.convex.site`), Vercel servira samo strani → brez vpliva.
**Distribucija:** GitHub Releases (brezplačno). **CI:** GitHub Actions (zaseben repo: 2.000 min/mesec; Windows minute štejejo 2×) – build samo ob oznaki verzije.

Če bi baza rasla: starejše runove (npr. > 6 mesecev) skrčimo na povzetek (cron).

---

## 11. Distribucija, posodobitve, podpisovanje
- Build: GitHub Actions matrika (`windows-latest` → `.msi`/NSIS `.exe`; `ubuntu-22.04` → `.AppImage` + `.deb`).
- Posodobitve: Tauri updater (podpisani paketi z ključem updaterja; `latest.json` na GitHub Releases).
- **Windows SmartScreen:** brez plačljivega code-signing certifikata Windows ob prvem zagonu opozori ("unknown publisher") → "More info → Run anyway". Za prijatelje sprejemljivo; certifikat ni v brezplačnem paketu.
- Linux/Proton: AppImage teče izven Wine (native), bere datoteke iz Wine prefiksa.

---

## 12. Struktura repozitorija (monorepo)

```
WowCompany/
├─ src/                       # portal (obstoječe)
│  └─ convex/                 # + companion.ts, runs.ts, http.ts (nove poti)
├─ desktop/                   # NOVO: Tauri aplikacija
│  ├─ src/                    # Svelte UI
│  ├─ src-tauri/              # Rust (Tauri app)
│  │  └─ src/{main,auth,locate,tail,run_detector,analyzer,uploader,ipc}.rs
│  └─ package.json
├─ crates/wowlog/             # NOVO: parser combat loga (+ testi na vzorcih)
├─ wowlog/                    # vzorci logov (gitignore!)
└─ COMPANION.md               # ta dokument
```

---

## 13. Faze dela

### Faza C0 – Priprava
- [x] Vzorec combat loga (solo, Tirisfal) – format v22 preverjen
- [x] Interface verzija addona: 16001
- [ ] Vzorec **iz dungeona s partyjem** (z `/console advancedCombatLogging 1`) → `wowlog/`
- [ ] Vzorec `/chatlog` med dungeonom (loot vrstice) → `wowlog/`
- [ ] Pot do mape `Logs` na Linuxu (Proton) in na Windows (če kdo igra na Windows)
- [ ] Linux build odvisnosti (`sudo apt install …`, razdelek 5.1)

### Faza C1 – Parser (`crates/wowlog`) ✅ (13. 11. 2026)
- [x] Parser vrstic + tipi dogodkov, napredni parametri (brez zunanjih odvisnosti, Rust 2024)
- [x] Testi: enotski + sintetični dungeon `tests/fixtures/synthetic_rfc.txt` (izmišljena imena) + pravi vzorec (preskoči se, če ga ni)
- [x] CLI `wowlog-dump <datoteka> [--group] [--deaths N]` (dogodki, cone, encounterji, damage/heal po igralcu, smrti) – vzorec v ~10 ms

### Faza C2 – Detektor runa + analizator ✅ na sintetičnih podatkih (13. 11. 2026)
- [x] Party iz zastavic, vstop/izstop instance, corpse run, reset, segmenti (boss/trash), runKey (`crates/wowrun`, razdelek 6.1a)
- [x] Agregati, top uroki, 10-s časovnica, smrti z recapom, prekinitve, dispeli, shieldi, okoljska škoda
- [x] CLI `wowrun <log> [--compact] [--utc-offset-min N] [--min-players N]` → JSON runov
- [ ] Potrditev na **pravem dungeon vzorcu** (ZONE_CHANGE ob vstopu, ENCOUNTER_*, party zastavice, swing pravilo, `level` polje)
- [ ] Nagrade (*Floor Inspector* …) – po načrtu na strežniku (C3)

### Faza C3 – Convex ✅ na dev (13. 11. 2026, razdelek 8.2a)
- [x] Tabele, prijava naprave (`/companion/link/*`), portal stran `/link`, My devices + Revoke
- [x] `POST /companion/runs` (validacija, združevanje, nagrade, rate limit), E2E na dev
- [x] Deploy na prod (13. 11. 2026, commit 6fe6c1f; smoke test: 401 brez žetona, /link 200)
- [ ] E2E povezave z resnično Google prijavo (§14 D1)
- [ ] Vidnost runov → C5

### Faza C4 – Tauri aplikacija (MVP) ✅ Linux (13. 11. 2026, razdelek 5.4)
- [x] Skelet Tauri 2 + Svelte 5 + Tailwind v4 + WoW tema (`desktop/`)
- [x] Link account, iskanje mape Logs, Live meter, Runs, Settings, tray (zapiranje okna = v tray), single instance
- [x] Uploader s čakalno vrsto (SQLite) in backoffom; preizkušeno proti dev (Rust E2E + prava aplikacija)
- [ ] Windows build in preizkus (C6)

### Faza C5 – Portal Dungeon Runs
- [ ] `/runs`, `/runs/[id]`, zavihek Runs na strani junaka, vidnost Website/Discord

### Faza C6 – Distribucija
- [ ] GitHub Actions build (Windows + Linux), Releases, updater, navodila v Portal Room

### Faza C7 – Faza 2
- [ ] Loot iz `/chatlog`, Discord objava runa, živo pošiljanje (stikalo) + živi pogled

### Faza C8 – Faza 3
- [ ] Mini addon (Interface 16001): samodejni `/combatlog`, in-game meter, need/greed rolli

---

## 14. Kontrolni seznam za 100 % delovanje (kaj je še NEPREVERJENO)

Vse do zdaj je testirano samo na **solo vzorcu** (Tirisfal) in **sintetičnih** logih. Pred izdajo mora biti vsaka točka ✅.
Ko je točka potrjena, jo odkljukaj in popravi kodo/razdelek 3.

**A. Pravi dungeon log s partyjem** (`/console advancedCombatLogging 1`, `/combatlog`, `/chatlog`; najbolje 2 člana snemata isti run)
- [ ] A1 `ZONE_CHANGE` ob vstopu v dungeon: instanceID se ujema s tabelo 3.1? (sicer rezerva `MAP_CHANGE` ime) – `dungeons.rs`
- [ ] A2 Ali se `ZONE_CHANGE` zapiše tudi ob izhodu / ob releasu na graveyard (corpse run logika, grace 15 min)?
- [ ] A3 `ENCOUNTER_START/END` obstajata? Format (`instanceID` na koncu START, `fightTime` na koncu END)? encounterID-ji iz tabele 3.1 pravilni?
- [ ] A4 Party zastavice `0x512` (party) / `0x514` (raid) pri soigralcih; `0x511` samo jaz
- [ ] A5 Peti partyja: zastavice (`0x1112`?), GUID oblika (`Pet-…`/`Creature-…`), ali `ownerGUID` v naprednem bloku
- [ ] A6 Uid kopije instance v GUID-u NPC-jev (5. del) – enak za vse člane in drugačen po resetu?
- [ ] A7 `runKey` pri dveh snemalcih istega runa enak (obe datoteki skozi `wowrun`)
- [ ] A8 Swing pravilo: `SWING_DAMAGE` vs `SWING_DAMAGE_LANDED` – vsota za igralca primerjana z in-game metrom (Details!, če obstaja)
- [ ] A9 Polje `level` v naprednem bloku: level ali ilvl? (primerjaj s portalom)
- [ ] A10 `COMBATANT_INFO` (oprema/talenti ob pullu) – format
- [ ] A11 `SPELL_INTERRUPT`, `SPELL_DISPEL` – postavitev polj (zdaj po retail). ✅ `SPELL_ABSORBED`, `SPELL_AURA_BROKEN_SPELL`, `DAMAGE_SHIELD`, `SPELL_CAST_FAILED` potrjeni na pravem logu
- [ ] A12 DPS/HPS iz `wowrun` ≈ in-game meter (±5 %)
- [ ] A13 Smrt: `UNIT_DIED` za igralca + recap smiseln; Feign Death/Soulstone/rezi
- [ ] A14 Ali se logiranje po prijavi izklopi? (`/reload` ✅ ostane v isti datoteki z novo glavo.) Nova datoteka sredi runa → tail preklopi (✅ testirano sintetično)
- [ ] A15 Časovni žig: lokalni čas PC-ja (preveri UTC offset, poletni čas)
- [ ] A16 Scarlet Monastery / Dire Maul / Stratholme / BRD – več kril na enem instanceID: en run ali več?

**B. Chat log (faza 2)**
- [ ] B1 `/chatlog` v Forever zapisuje loot sproti (`WoWChatLog.txt`), format vrstic

**C. Okolje / distribucija**
- [x] C1 Pot do mape `Logs` v Proton prefiksu (Steam) – ✅ najdena samodejno (razdelek 3). Lutris/Bottles/Windows: le predvideno
- [ ] C2 Tauri build: ✅ Linux debug (WebKitGTK 2.52); Windows + release paketi (AppImage/deb/NSIS) → C6
- [ ] C3 Branje loga, medtem ko ga igra piše (Windows file locking, Wine)
- [ ] C4 Keyring (Secret Service / Windows Credential Manager) – **zdaj datoteka 0600** (`device-token` v config mapi); `keyring` 4 ima nov API
- [ ] C6 Tray ikona v GNOME (potrebuje razširitev AppIndicator) in KDE – ni vizualno preverjeno; zapiranje okna skrije v tray
- [ ] C7 UI v pravi aplikaciji: Live meter med pravim dungeonom, gumbi End run / Retry / Browse… / Save (preverjeni samo v mock pogledu)
- [ ] C8 Dev `SITE_URL` = `http://localhost:5173` → povezava iz aplikacije proti dev odpre lokalni portal (mora teči `bun run dev`)
- [ ] C5 Addon: sme klicati `LoggingCombat(true)` (Interface 16001)?

**D. Strežnik / portal (C3+)**
- [ ] D1 Povezava naprave od začetka do konca z **resnično Google prijavo** na `/link` (dev E2E je odobritev simuliral z interno mutacijo) in na prod
- [ ] D1a Stran `/link` vizualno (prijavljen član, nečlan, potekla koda, My devices) – do zdaj preverjen le izris za neprijavljenega
- [x] D1b `SITE_URL`: prod = `https://wowcompany.vercel.app` ✅; dev = `http://localhost:5173` (glej C8)
- [ ] D1c Upload s slabim žetonom IN napačnim telesom vrne 400 (validator argumentov teče pred preverjanjem žetona) – razmisli o preverjanju žetona v HTTP plasti pred mutacijo
- [ ] D2 Upload **pravega** runa (dev E2E je uporabil sintetičnega): velikost, validacija, združevanje dveh snemalcev z dveh PC-jev
- [ ] D2a Ali je gzip potreben (pravi run > ~300 KB?) – strežnik ga zdaj ne podpira
- [ ] D3 Poraba Convex po 1 tednu (klici, DB I/O, prostor) vs ocena v razdelku 10
- [ ] D4 Vidnost (Website/Discord) za obiskovalca vs člana

**Ostalo odprto:** ime/ikona aplikacije – predlog **"WowCompany Companion"**, ikona = `static/icon-512.png`.

---

## 15. Pravila za nadaljevanje (za Claude)
- Odgovori uporabniku v **slovenščini**; vse besedilo aplikacije in portala v **angleščini**, WoW ton, umazan/črn humor.
- Pred uporabo knjižnice preveri trenutno uradno dokumentacijo/verzijo; Convex koda po `src/convex/_generated/ai/guidelines.md`.
- Nič surovih logov ali tujih igralcev na strežnik. Vzorci logov ostanejo v `wowlog/` (gitignore).
- Brezplačni paketi so trda omejitev – vsaka nova funkcija z oceno porabe.
- Pred commitom preveri, da ni skrivnosti (`.env` vrednosti) v diffu.

---

## 16. Kako nadaljevati po čiščenju spomina (handoff)

**Stanje 13. 11. 2026 (konec C1):** Cargo workspace v korenu (`Cargo.toml`, `rustfmt.toml` max_width 120, `/target/` v `.gitignore`),
crate `crates/wowlog` je končan in testiran. Portal (PLAN.md) je nespremenjen (svelte-check 0 napak, 53 testov OK).

**Struktura `crates/wowlog`:**
- `fields.rs` – razbijanje CSV (narekovaji, `()`/`[]` skupine), pretvorbe polj, `is_guid`.
- `time.rs` – `MM/DD/YYYY HH:MM:SS.ffff` → naivne ms od 1970 (lokalni čas igre, brez cone).
- `unit.rs` – `Unit` (`is_group()` = mine/party/raid, `is_pet`, `npc_id()`, `player_slug()` = portalski slug), `Spell`, `Advanced`, `flags`.
- `event.rs` – `parse_line(&str) -> Result<Record, ParseError>`; `Record { timestamp, event, source, dest, kind: Kind }`;
  `Kind` = Damage/Missed/Heal/Absorbed/Energize/Aura/Cast/Interrupt/Dispel/Summon/Resurrect/Instakill/ExtraAttacks/Died/PartyKill/
  ZoneChange/MapChange/EncounterStart/EncounterEnd/CombatantInfo (surovo)/CombatLogVersion/Other (neznano – nič se ne izgubi).
- `reader.rs` – `wowlog::open(path)` iterator (lossy UTF-8, prazne vrstice preskoči, slabe vrstice kot `Err(BadLine)`).

**Ukazi:**
```bash
cargo test                                   # vsi testi parserja
cargo clippy --all-targets && cargo fmt      # lint + format
cargo run --release --bin wowlog-dump -- wowlog/WoWCombatLog-*.txt [--group]
```

**Pasti:** vzorec `/wowlog/` v `.gitignore` mora biti **zasidran na koren** (brez `/` je ignoriral tudi `crates/wowlog/`).
V testih/fixturih samo izmišljena imena in GUID-i (pravi vzorec vsebuje imena tujih igralcev).

**Crate `crates/wowrun` (C2, končano na sintetičnih podatkih):** odvisen od `wowlog`, `serde`, `serde_json`.
- `dungeons.rs` – tabela 3.1 (instanceID → ime, encounterji, število bossov; NEPREVERJENO).
- `analyzer.rs` – `Config` (privzetki: 2 igralca, 10 min neaktivnost, 15 min grace, 10-s kanglice, recap 10, top 10 urokov), `RunAcc` (en run).
- `detector.rs` – `Detector::{push, tick, finish, end_manual, snapshot}`, `run_key()`.
- `summary.rs` – shema JSON, ki gre na strežnik (`schema: 1`).
- Testi: `tests/common/mod.rs` = generator sintetičnih logov (pravi format vrstic, izmišljena imena) → `tests/runs.rs` (13 scenarijev:
  poln RFC run s corpse runom, wipe+kill, pet, dedupe swingov, solo, neaktivnost, reset, nov dungeon, snapshot, tick, runKey dveh snemalcev,
  fixture iz `wowlog`, pravi solo vzorec → 0 runov).
- Ukaz: `cargo run --bin wowrun -- <log> [--compact]`.

**C3 (Convex) in C4 (Tauri aplikacija) sta končana** – podrobnosti v razdelkih 8.2a in 5.4.
Ukazi: `cargo test`, `bun test tests/`, `bun run check:companion` (E2E HTTP na dev), Rust E2E (`--test api_dev -- --ignored`, razdelek 5.4).

**Naslednji korak – faza C5 (portal Dungeon Runs), predlog:**
1. Poizvedbe `runs.list` (paginirano po `by_started_at`, desc), `runs.get` (run + `runDetails`), `runs.forHero` (`runParticipants.by_slug_and_started_at`).
2. Vidnost (razdelek 8.3): nova polja `runs`, `runDetails`, `runDeaths` v Website/Discord stikalih; obiskovalec vidi samo seznam.
3. Strani `/runs` in `/runs/[id]` (meter, časovnica – en niz na graf, smrti z recapom, segmenti, nagrade) + zavihek Runs na strani junaka.
   `url` v odgovoru uploada že kaže na `/runs/<id>`.
4. Admin → Portal Room: sekcija Companion (navodila, povezava za prenos – C6, seznam naprav vseh članov).

**Kaj potrebujemo od uporabnika (še odprto):**
- Pravi log iz dungeona s partyjem (`/console advancedCombatLogging 1`, `/combatlog`, `/chatlog`) → `wowlog/`.
- `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev build-essential libssl-dev` (pred fazo C4).
- Pot do mape `Logs` v Proton prefiksu (za `locate` modul).

**Stvari, ki ostajajo iz portala (ne pozabi):**
- Dev Convex baza ima 20 testnih junakov (člani guilda) – po želji odstrani (dev admin → Heroes).
- Dev poller je ustavljen (da ni dvojnih Discord objav) – za razvoj portala ga vklopi v dev adminu → Settings.
- Google aplikacija še v *Testing* – uporabnik jo bo objavil (brez logotipa).
