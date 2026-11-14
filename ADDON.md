# WowCompany v0.2 – addon, rekordi, izboljšave (plan)

> Napisano 14. 11. 2026. Nadaljevanje [COMPANION.md](COMPANION.md) (faza 3 = addon) in [PLAN.md](PLAN.md).
> Pravila ostajajo: odgovori v slovenščini, UI v angleščini (WoW slog, črn humor), brezplačni paketi,
> repo je **javen** (brez skrivnosti, logov, tujih imen), Convex koda po `src/convex/_generated/ai/guidelines.md`,
> commit/push samo na zahtevo, nikoli lažnih klikov na uporabnikovem namizju.

## 0. Povzetek

Trije deli, ki si sledijo:

1. **Rekordi iz combat loga** (največji crit, hit, heal, prejet udarec …) – naredi jih že Companion, addon ni potreben.
2. **WoW addon `WowCompany`** (Lua, Interface 16001) z UI-jem: meter v igri, rekordi, loot, samodejni vklop logov,
   in podatki, ki jih combat log nima (vodja partyja, kakovost predmetov, rolli).
3. **Companion in portal** pobereta oboje in objavita; zraven še preostala optimizacija porabe Convexa.

Ključna omejitev (COMPANION.md §2): **addon ne more pošiljati na internet in ne more pisati datotek**. Na disk pride
samo prek SavedVariables, in to šele ob `/reload`, odjavi ali izhodu iz igre. Zato:

| Vir | Kdaj | Za kaj |
|---|---|---|
| Combat log (`/combatlog`) | sproti | run, damage, healing, smrti, **rekordi** |
| Chat log (`/chatlog`) | sproti | loot (brez kakovosti) |
| Addon → SavedVariables | ob `/reload` / odjavi | vodja partyja, kakovost + ID predmetov, rolli, statistika lika, vseživljenjski rekordi |

Companion ostaja edini, ki nalaga na strežnik. Addon je **neobvezen**: brez njega vse deluje kot v v0.1.2.

## 1. Stanje (14. 11. 2026, konec seje)

- Izdano: Companion v0.1.2, `main` = `b0563fd`.
- **Necommitano v delovnem drevesu** (vse preverjeno na dev, nič še na prod):
  - faza O1–O4 + O6 (optimizacija Convexa),
  - faza R1–R5 (rekordi: Rust shema 3, strežnik, portal, Companion Live; verzija aplikacije dvignjena na **0.1.3**, še ni izdana),
  - `addon/WowCompany/` – samotest A0 (sintaksa Lua **ni strojno preverjena**: lokalno ni Lua orodij),
  - dokumenti (COMPANION.md §16, PLAN.md §0, ta datoteka).
- Dev: nasejani 3 runi s shemo 3 (`bun scripts/companion-seed.ts --clean` jih odstrani), poller na pavzi,
  23 neobjavljenih testnih dogodkov (dev nima webhooka).
- **Po pushu na prod:** `bunx convex run --prod poll:watchdog` (zagon verige pollerja), nato oznaka `companion-v0.1.3`.

## 2. Faza O – preostala optimizacija Convexa (majhno, najprej)

Meritve 12.–14. 11. (Usage → Breakdown → Database I/O, prod): `events.recent` 15,8 MB (~23 KB/klic), `players.list` 6,2 MB,
`players.get` 4,1 MB, `runs.get` 3,3 MB, `poll.apply` 3,2 MB, `admin.overview` 1,9 MB. `poll.state` je majhen (~0,7 MB).

- [x] O1 `events.recent` indeks + Map + limit 20
- [x] O2 `poll.apply` piše samo ob spremembi
- [x] O3 `players.get`: zgodovina `take(1000)` → `HISTORY_LIMIT = 300`
- [x] O4 `admin.overview` bere tabelo `guildRosterMeta` (število + `fetchedAt`); `roster.save` velikega dokumenta ne prepiše, če je seznam enak
- [ ] O5 `runs.get`: bere 1 run + 1 `runDetails`; ponovno se izvede ob vsakem zapisu `summaries` (prek `classesFor`) – O2 to že zmanjša.
      Če ostane visok: `classId` shrani v run ob nalaganju in `classesFor` ne bere več `summaries`.
- [x] O6 Poller se sam načrtuje: tabela `pollChain` (žeton + `nextAt`), `poll.begin` takoj načrtuje naslednji zagon in vrne vnose,
      `poll.watchdog` (cron 15 min) zažene mrtvo verigo, `admin.updateSettings` / `setPollInterval` jo ustavi ali takoj znova zažene.
      Preizkušeno na dev (zagon, 60 s zanka, nov interval, pavza). **Po deployu na prod:** `bunx convex run --prod poll:watchdog`
      (sicer začne v ≤ 15 min). Interval na prod je še 60 s – 3 min je predlog, odločitev uporabnika.
- [ ] O7 Če `events.recent` po O1 ostane > 5 KB/klic: razdeli `payload` na lahek del za feed in težek del za Discord
- [ ] O8 Teden po objavi ponovno izmeri in vpiši številke sem

Dev higiena: `check:visibility` (8976 preverjanj) in seed samo pred izdajo.

## 3. Faza R – rekordi iz combat loga (brez addona)

**Kaj:** za vsakega igralca v runu največji posamezen dogodek vsake vrste, z urokom, tarčo in časom.

| Rekord | Vir v logu |
|---|---|
| Biggest crit | `SWING_DAMAGE`/`SPELL_DAMAGE`/`RANGE_DAMAGE`/`SPELL_PERIODIC_DAMAGE` s `critical` |
| Biggest hit (non-crit) | isti dogodki brez `critical` |
| Biggest heal / crit heal | `SPELL_HEAL`, `SPELL_PERIODIC_HEAL` (efektivno = amount − overheal) |
| Biggest hit taken | damage, kjer je tarča igralec |
| Overkill of the run | največji `overkill` |

- [x] R1 `wowrun`: `PlayerSummary.records` (`RunRecord {kind, amount, spell, spellId, unit, atMs, pet}`, vrste `crit/hit/critHeal/heal/hitTaken`),
      **shema 3**, test `biggest_hits_become_records`. Opomba: rekord je lahko po zadnji aktivnosti runa (lava) → `atMs > durationMs`.
- [x] R2 Convex: validator `runRecord`, `checkRun` (≤ 5 na igralca, ena na vrsto), nagrada **One-Shot Wonder**.
      Vidnost: **obstoječe polje `runDetails`** (namesto novega `runRecords` – manj stikal, ista zaščita).
- [x] R3 Tabela `heroRecords` (indeksi `by_slug_and_kind`, `by_kind_and_amount`, `by_run`), samo za spremljane junake,
      piše `ingestRun` ob večji številki; `deleteRun` pobriše rekorde tega runa (prejšnji se ne obnovi).
- [x] R4 Portal: zavihek **Big Numbers** (`?tab=numbers`), **Personal Records** na strani junaka (v `runs.forHero`),
      lestvici **Biggest Crit** (Glory) in **Glass Jaw** (Hall of Shame) prek `runs.topRecords`. Preverjeno s posnetki na dev.
- [x] R5 Companion: Live kaže največji crit in najhujši prejeti udarec (preverjeno v `mock.html?tab=live`).
- [ ] R6 Po želji: Discord objava ob novem osebnem rekordu (COMPANION.md C7).

Poraba: `records` doda ~1 KB na run; `heroRecords` ≤ 6 majhnih vrstic na junaka → zanemarljivo.

## 4. Faza A – addon `WowCompany`

### 4.1 Ugotovitve o Forever (A0) – **preberi pred pisanjem addona**

Vir: addoni, ki jih ima uporabnik nameščene (`_forever_/Interface/AddOns/`: ForeverDungeonJournal, Questie, Platynator, Auctionator).

- **Forever teče na retail (Midnight) odjemalcu** – deli retailov `WOW_PROJECT_ID`, prepozna se po Interface 16000–16999
  (Questie `VersionCheck.lua`). Veljajo **skrite vrednosti** (`issecretvalue`, `C_Secrets.HasSecretRestrictions()`).
- **`COMBAT_LOG_EVENT_*` je za addone zaprt** (ForeverDungeonJournal `Systems/RunLog.lua`: *“WoW Forever closes
  COMBAT_LOG_EVENT_* to addons”*; Platynator CLEU registrira samo, če ni omejitev). → **Meter v živo iz combat loga v igri ni mogoč.**
  Combat log na disku (`/combatlog`) ostane edini vir številk – to že bere Companion.
- Kar addoni v Forever dokazano uporabljajo: `PARTY_KILL` / `UNIT_DIED` (GUID-i), `CHAT_MSG_LOOT`, `CHAT_MSG_COMBAT_HOSTILE_DEATH`,
  `CHAT_MSG_COMBAT_XP_GAIN`, `ENCOUNTER_END`, `BOSS_KILL`, `GROUP_ROSTER_UPDATE`, `PLAYER_REGEN_*`, `GetInstanceInfo`, `GetServerTime`,
  `GetLootRollItemInfo`, `C_Timer.After`, `BackdropTemplate`, `LibDBIcon`. Vsako vrednost preveri z `issecretvalue`.
- V nobenem addonu ni: `LoggingCombat`, `LoggingChat`, `UnitIsGroupLeader`, `C_DamageMeter` → **neznano**, to pove samotest.

**Samotest je napisan:** `addon/WowCompany/` (`WowCompany.toc`, `Selftest.lua`). Uporabnik: skopira mapo v
`_forever_/Interface/AddOns/`, v igri `/wowco selftest`, udari nekaj mobov, pobere loot, `/reload`. Poročilo je v
`_forever_/WTF/Account/<RAČUN>/SavedVariables/WowCompany.lua` (`WowCompanyDB.selftest`) – Claude ga prebere z diska.

**Rezultat samotesta (14. 11. 2026, odjemalec 1.60.1 build 70938, Interface 16001, zunaj instance, brez partyja):**

- [x] A0.1 **CLEU zaprt – potrjeno:** dogodek se da registrirati, a ne pride nobeden (0), `CombatLogGetCurrentEventInfo` in
      `CombatLogAddFilter` ne obstajata. `UNIT_COMBAT` pride (22 dogodkov), a je **znesek skrit** (`<secret>`); vrsta (`WOUND`) in šola sta vidni.
      `C_Secrets.HasSecretRestrictions()` = true.
- [x] A0.2 `LoggingCombat()` in `LoggingChat()` obstajata, poizvedba deluje (obe sta vrnili `false`).
      **Še ne preverjeno:** ali ju addon sme *vklopiti* (`LoggingCombat(true)`) – naslednji preizkus.
- [x] A0.3 `UnitFullName("player")` vrne ime **in priimek** (dva niza) → slug. `UnitIsGroupLeader`, `GetNumGroupMembers`,
      `UnitGUID` (`Player-6948-…`), `GetInstanceInfo`, `GetServerTime` delujejo. V partyju še ni preverjeno.
- [ ] A0.4 `CHAT_MSG_LOOT`: dogodek obstaja, a vzorec je prazen (0) – loot je bil verjetno pobran pred zagonom samotesta ali je bil
      samo denar. **Ponoviti.** `GetLootRollItemInfo`, `C_LootHistory`, `START_LOOT_ROLL` obstajajo.
- [x] A0.5 `C_DamageMeter` **obstaja** (tabela) in dogodek `DAMAGE_METER_COMBAT_SESSION_UPDATED` se da registrirati → možna pot do
      metra v igri. Raziskati funkcije (`for k in pairs(C_DamageMeter)`) in ali so vrednosti skrite (skrite se da *prikazati* v UI, ne pa računati).
- [x] A0.6 SavedVariables: `_forever_/WTF/Account/<RAČUN>/SavedVariables/WowCompany.lua`, navadna Lua tabela, zapisana ob `/reload`.
- Ostalo: `GetItemInfo` **ne obstaja** (uporabi `C_Item.GetItemInfo`); dogodek `CHAT_MSG_COMBAT_HOSTILE_DEATH` ne obstaja;
  statistika lika je berljiva zunaj boja (`GetCritChance` 2,12 %, `UnitAttackPower`, `UnitArmor`, `GetAverageItemLevel`);
  `BackdropTemplateMixin`, `Minimap`, `C_Timer`, `C_AddOns`, `C_ChatInfo.SendAddonMessage` obstajajo.
- Nov addon igra prepozna šele ob **ponovnem zagonu** (ne ob `/reload`).

**Naslednji preizkus (A0b), preden se piše UI:** `LoggingCombat(true)` iz addona, izpis funkcij `C_DamageMeter` in vzorec
njihovih vrednosti po boju, `CHAT_MSG_LOOT` z registracijo že ob nalaganju, `UnitIsGroupLeader` v partyju.

### 4.1a Popravljen načrt addona (ker CLEU ni na voljo)

Addon **ne računa** damage-a. Številke pridejo iz Companiona, ki bere combat log na disku:

| Smer | Kanal | Kdaj |
|---|---|---|
| Addon → Companion | SavedVariables (`WowCompanyDB.export`) | ob `/reload` / odjavi |
| **Companion → addon** | Companion zapiše `Interface/AddOns/WowCompany/CompanionData.lua` (kot TSM-ova namizna aplikacija) | addon ga naloži ob `/reload` / prijavi |

Addon torej **prikazuje** (po `/reload`): povzetek zadnjega runa (meter, smrti, nagrade), osebne rekorde, lestvice portala
(Biggest Crit, Hall of Shame), stanje povezave. **Zbira** (kar combat log nima): vodjo partyja, loot s kakovostjo in ID-jem, rolle,
uboje (PARTY_KILL/UNIT_DIED), statistiko lika. **Naredi**: samodejni `/combatlog` + `/chatlog` v dungeonu (če A0.2), opomnik za `/reload` po runu.
Meter v živo med bojem samo, če A0.5 pokaže uporaben `C_DamageMeter`.

Vzori: ForeverDungeonJournal (`Systems/RunLog.lua` – zaznava runa brez CLEU), `postblink/KwikTip`.

### 4.2 Zgradba

```
addon/WowCompany/
  WowCompany.toc        ## Interface: 16001, SavedVariables: WowCompanyDB, SavedVariablesPerCharacter: WowCompanyCharDB
  Core.lua              dogodki, stanje, slash ukazi (/wowco, /wowco selftest, /wowco reset)
  Logging.lua           samodejni LoggingCombat/LoggingChat ob vstopu v dungeon, izklop po izhodu
  CompanionData.lua     piše Companion (zadnji run, rekordi, lestvice) – addon samo bere
  Summary.lua           prikaz zadnjega runa in rekordov iz CompanionData (brez CLEU, glej 4.1a)
  Loot.lua              loot s kakovostjo + ID, rolli need/greed
  Run.lua               vodja partyja, sestava, začetek/konec, instanca
  Export.lua            vrstice za Companion v WowCompanyDB.export
  UI/Main.lua, UI/Minimap.lua, UI/Theme.lua
```

Brez zunanjih knjižnic (Ace3 ni potreben) – manj tveganja z licencami in verzijami.

### 4.3 UI (enak občutek kot Companion)

Okno z zavihki **Live · Records · Loot · Logging**, temno ozadje + zlata obroba kot `wow-frame`, premično, velikost in položaj
shranjena. Minimap gumb in `/wowco`.

- **Live:** dungeon, trajanje, bossi, vrstice igralcev (damage, DPS, healing, smrti) s črtami v barvi razreda; preklop boj/run.
- **Records:** največji crit / hit / heal / prejet udarec z urokom, tarčo in datumom; ob novem rekordu obvestilo na zaslonu
  (npr. *“New personal best: 1,204 Fireball crit. The rat never stood a chance.”*).
- **Loot:** kdo je kaj dobil, barva po kakovosti, rolli.
- **Logging:** stanje combat/chat loga, stikalo *Auto-log in dungeons*, opomnik »/reload to send extras to the portal«.

### 4.4 Izvoz za Companion

`WowCompanyDB.export` = seznam **nizov v našem vrstičnem formatu**, da Rust ne potrebuje pravega Lua razčlenjevalnika
(dovolj je branje Lua nizov z ubežnimi znaki):

```
v1|RUN|<instanceId>|<instanceUid ali 0>|<startEpochS>|<endEpochS>|<leaderName>
v1|LOOT|<epochS>|<looter>|<itemId>|<quality>|<count>|<itemName>
v1|ROLL|<epochS>|<itemId>|<player>|<need|greed|pass>|<roll>|<won 0/1>
v1|REC|<charName>|<kind>|<amount>|<spellId>|<spellName>|<target>|<epochS>
v1|CHAR|<charName>|<level>|<critPct>|<ap>|<sp>|<armor>|…
```

Addon hrani zadnjih ~200 vrstic `RUN/LOOT/ROLL` (krožno), `REC` in `CHAR` samo trenutno stanje. Čas: `GetServerTime()` –
Companion ga poravna z lokalnim časom combat loga (zamik izračuna iz prvega skupnega dogodka; **preveriti**).

## 5. Faza C – Companion (v0.2.0)

- [ ] C1 `locate.rs`: iz mape `Logs` najdi `../WTF/Account/*/SavedVariables/WowCompany.lua`
- [ ] C2 `crates/wowlog/src/addon.rs`: branje `export` vrstic (nizi, `v1|…`), testi s sintetično datoteko
- [ ] C3 `wowrun`: združi po času/instanci v run – `leader`, loot dobi `itemId` + `quality`, `rolls[]`; **shema 3**
      (isti dvig kot R1). Addon podatki pridejo pozno (ob `/reload`): če je run že naložen, pošlji **dopolnitev**
      (`POST /companion/runs/patch` z `runKey`; strežnik sprejme samo polja addona od naprave, ki je run naložila).
- [ ] C4 Gumb **Install addon** v Settings: skopira priložen addon v `_forever_/Interface/AddOns/WowCompany/`,
      pokaže nameščeno in priloženo verzijo. Addon je v paketu aplikacije (`tauri.conf.json` → `resources`).
- [ ] C5 Zavihek **Records** (iz combat loga + addona), Live kaže rekorde runa
- [ ] C6 Guide: nov korak »Install the addon (optional)« in stanje »Addon: installed vX / data seen HH:MM«
- [ ] C7 Brisanje logov ob izhodu se SavedVariables **ne dotika**
- [ ] C8 Tauri updater (odprto iz COMPANION.md C6): podpisni ključ v GitHub secrets, `latest.json`, preverjanje ob zagonu

## 6. Faza P – portal

- [ ] P1 Run: vodja partyja namesto *Unknown* (rešuje §14 A17), loot v barvi kakovosti z ikono (`itemIcons` predpomnilnik že obstaja),
      rolli (»won with a 98, the bastard«), zavihek **Big Numbers**
- [ ] P2 Junak: **Personal Records**, statistika lika iz addona (crit %, AP/SP) – polje vidnosti `runRecords`
- [ ] P3 Glavna stran: lestvica **Biggest Crit**; `/runs`: filter po dungeonu in junaku
- [ ] P4 `/link` in Guide: opis addona + kaj pošilja (zasebnost: samo podatki partyja in lastnega lika)
- [ ] P5 `check:visibility` razširi na `runRecords`; `scripts/companion-seed.ts` shema 3

## 7. Vrstni red in izdaje

1. **O3–O6** → commit, push (portal).
2. **R1–R5** → Companion v0.1.3 + portal (rekordi delujejo brez addona).
3. **A0 samotest** (napisan) → uporabnik ga namesti, zažene `/wowco selftest` + `/reload`; Claude prebere SavedVariables. Od rezultata je odvisen obseg faze A.
4. **A (addon) + C1–C7 + P1–P5** → Companion v0.2.0.
5. **C8 updater**, O8 ponovna meritev.

Vsak korak: `cargo test`, `cargo clippy --all-targets`, `bun test tests/`, `bun run check`, `bun run check:companion` (dev).
Addon: `luac -p` na vseh `.lua` (sintaksa) – delovanja v igri lokalno ni mogoče preveriti, zato **vsak addon korak potrdi uporabnik v igri**.

## 8. Tveganja

- **CLEU je v Forever zaprt za addone** (4.1) → addon ne more biti merilnik; številke prikaže šele po `/reload` iz Companionovih podatkov.
- **Lua ni strojno preverjena** (ni lokalnega `luac`) – prva napaka se pokaže šele v igri; namesti `lua5.1` ali `luacheck`, če je mogoče.
- **Zamuda addon podatkov:** pridejo šele ob `/reload` ali odjavi → run je na portalu najprej brez vodje/kakovosti, dopolni se pozneje.
- **Ujemanje časa** addon (strežniški čas) ↔ combat log (lokalni čas) – preveriti na pravem runu.
- **Zasebnost:** SavedVariables vsebuje samo, kar addon sam zapiše; nikoli vsebine chata.
- **Pravila igre:** addon samo bere dogodke in kaže UI (kot merilniki damage-a); nič avtomatizacije igranja.
