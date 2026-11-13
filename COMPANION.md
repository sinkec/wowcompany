# WowCompany Companion – načrt (desktop aplikacija + dungeon analitika)

> Samostojen dokument: vsebuje vse, kar je potrebno za nadaljevanje dela brez prejšnjega pogovora.
> Povezan z [PLAN.md](PLAN.md) (portal: SvelteKit + Convex + Vercel, že v produkciji).
> Datum: 13. 11. 2026 · Stanje: **načrt potrjen, koda še ni napisana**.

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

## 6. Zaznavanje runa in analitika

### 6.1 Run
- **Začetek:** vstop v instanco tipa dungeon (`ZONE_CHANGE`/`MAP_CHANGE`; seznam Forever dungeonov po imenu/ID – iz vzorca dungeona) in prvi boj z vsaj 2 člana partyja.
- **Konec:** izstop iz instance **ali** 10 min neaktivnosti **ali** ročno. Če je log zaprt med runom → run se zaključi ob zadnjem dogodku.
- **runKey:** `hash(zoneId, zaokrožen začetek, urejen seznam GUID-ov partyja)` → idempotenca in združevanje.
- **Segmenti:** boss (`ENCOUNTER_START/END`, če obstaja; sicer smrt znanega boss NPC-ja) in trash med njimi.

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

### Faza C1 – Parser (`crates/wowlog`)
- [ ] Parser vrstic + tipi dogodkov, napredni parametri
- [ ] Testi na `wowlog/` vzorcih (število dogodkov, damage vsote, smrti)
- [ ] CLI `wowlog-dump` za razvoj (povzetek datoteke)

### Faza C2 – Detektor runa + analizator
- [ ] Party iz zastavic, vstop/izstop instance, segmenti
- [ ] Agregati, časovnica, smrti, nagrade (vhod: vzorec dungeona)

### Faza C3 – Convex
- [ ] Tabele, prijava naprave (`/companion/link/*`), portal stran `/link`, My devices
- [ ] `POST /companion/runs` (validacija, združevanje, vidnost)

### Faza C4 – Tauri aplikacija (MVP)
- [ ] Skelet Tauri 2 + Svelte + WoW tema
- [ ] Link account, Setup (iskanje mape), Live meter, Runs, Settings, tray
- [ ] Uploader s čakalno vrsto

### Faza C5 – Portal Dungeon Runs
- [ ] `/runs`, `/runs/[id]`, zavihek Runs na strani junaka, vidnost Website/Discord

### Faza C6 – Distribucija
- [ ] GitHub Actions build (Windows + Linux), Releases, updater, navodila v Portal Room

### Faza C7 – Faza 2
- [ ] Loot iz `/chatlog`, Discord objava runa, živo pošiljanje (stikalo) + živi pogled

### Faza C8 – Faza 3
- [ ] Mini addon (Interface 16001): samodejni `/combatlog`, in-game meter, need/greed rolli

---

## 14. Odprta vprašanja
- Ali Forever zapiše `ENCOUNTER_START/END`? (vzorec dungeona)
- Kako se v logu pokaže vstop v dungeon (ime/ID instance)? Seznam Forever dungeonov.
- Ali `/chatlog` v Forever zapisuje loot sproti?
- Ali addon v Forever sme klicati `LoggingCombat(true)`?
- Ime izvršljive datoteke / ikona: predlog **"WowCompany Companion"**, ikona = `static/icon-512.png`.

---

## 15. Pravila za nadaljevanje (za Claude)
- Odgovori uporabniku v **slovenščini**; vse besedilo aplikacije in portala v **angleščini**, WoW ton, umazan/črn humor.
- Pred uporabo knjižnice preveri trenutno uradno dokumentacijo/verzijo; Convex koda po `src/convex/_generated/ai/guidelines.md`.
- Nič surovih logov ali tujih igralcev na strežnik. Vzorci logov ostanejo v `wowlog/` (gitignore).
- Brezplačni paketi so trda omejitev – vsaka nova funkcija z oceno porabe.
- Pred commitom preveri, da ni skrivnosti (`.env` vrednosti) v diffu.

---

## 16. Kako nadaljevati po čiščenju spomina (handoff)

**Stanje 13. 11. 2026:** načrt potrjen (Tauri 2 + Svelte, Windows + Linux, objava ob koncu runa, prijava prek portala).
Koda za Companion še **ne obstaja**. Portal (PLAN.md) je v produkciji in nespremenjen.

**Prvi koraki (faza C1 – parser), v tem vrstnem redu:**
1. Preberi ta dokument (razdelki 3, 3.1, 5, 6) in `PLAN.md` razdelek 0.
2. Preveri trenutne verzije: `cargo search tauri`, `bun pm view @tauri-apps/cli version`, `cargo search notify` (uporabi stabilne, ne alfa/rc).
3. Ustvari Cargo workspace v korenu (`Cargo.toml` z `members = ["crates/wowlog"]`, kasneje `desktop/src-tauri`).
   Pazi: koren je tudi Bun/SvelteKit projekt – `target/` dodaj v `.gitignore`.
4. `crates/wowlog`: tip `Event` + parser vrstice (`MM/DD/YYYY HH:MM:SS.ffff␠␠EVENT,csv…`, narekovaji, `nil`, hex zastavice),
   podpora za vse dogodke iz razdelka 3, neznani dogodki → `Event::Other`.
5. Testi: na `wowlog/WoWCombatLog-111326_173926.txt` (lokalno, ni v gitu – test naj se preskoči, če datoteke ni) +
   **sintetične** vrstice v `crates/wowlog/tests/fixtures/` (brez pravih imen): `ENCOUNTER_START/END`, party zastavice (`0x512`, `0x514`), `ZONE_CHANGE` v instanco 389 (Ragefire Chasm).
6. CLI `wowlog-dump <datoteka>`: število dogodkov po tipu, damage/heal po igralcu, smrti → ročna primerjava z vzorcem.

**Kaj potrebujemo od uporabnika (še odprto):**
- Pravi log iz dungeona s partyjem (`/console advancedCombatLogging 1`, `/combatlog`, `/chatlog`) → `wowlog/`.
- `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev build-essential libssl-dev` (pred fazo C4).
- Pot do mape `Logs` v Proton prefiksu (za `locate` modul).

**Stvari, ki ostajajo iz portala (ne pozabi):**
- Dev Convex baza ima 20 testnih junakov (člani guilda) – po želji odstrani (dev admin → Heroes).
- Dev poller je ustavljen (da ni dvojnih Discord objav) – za razvoj portala ga vklopi v dev adminu → Settings.
- Google aplikacija še v *Testing* – uporabnik jo bo objavil (brez logotipa).
