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

## 1. Stanje (14. 11. 2026, pozno zvečer) – ZAČNI TUKAJ

- **Vse commitano in na produkciji:** `main` = `8de0008`, izdan Companion **v0.1.6** (addon 0.4.0 je vgrajen vanj), navodila na
  portalu (`GetApp.svelte` na `/link`) so prepisana okoli addona. Addon 0.4.0 je v uporabnikovi mapi igre.
- Povezava addon ↔ Companion v obe smeri (spodaj):
- **Addon → Companion** (`addon/WowCompany/Export.lua` → `desktop/src-tauri/src/addon.rs`): addon v `WowCompanyDB.export` piše vrstice
  `v1|META|…`, `v1|RUN|instanceId|start|end|zone|leader`, `v1|CHAR|…`; na disk pridejo ob `/reload` / odjavi. Companion vsakih 5 s
  pogleda `WTF/Account/*/SavedVariables/WowCompany.lua`, ob spremembi doda **vodjo partyja** novim runom in za nazaj (48 h) že
  shranjenim/naloženim runom (`Queue::update_json` → ponovno nalaganje; strežnik vodjo doda tudi enakemu posnetku).
  Ujemanje po času (±10 min) in dungeonu. `RunSummary.leader` (neobvezno, brez dviga sheme), `runs.leader` na strežniku.
  **V igri s pravim partyjem še ni preverjeno** (vodja, `/reload` po runu).
- **Companion → addon:** Companion piše `Interface/AddOns/WowCompany/CompanionData.lua` (osebni rekordi), addon jih kaže na zavihku
  **Records** po `/reload`. Preverjeno na pravih datotekah (Lua prebere datoteko, ki jo zapiše aplikacija).
- Companion Guide kaže stanje addona (nameščen, verzija, zadnji podatki, dodani vodje).
- **Companion v0.1.6 + addon 0.4.0:**
  - **Install addon:** addon je vgrajen v aplikacijo (`include_str!` v `addon.rs`, seznam `BUNDLED` – ob novi datoteki addona jo
    dodaj tja in v `.toc`; test to preverja). Gumb v zavihku How to log (namesti / posodobi, `CompanionData.lua` ohrani).
  - **Loot:** addon ob `CHAT_MSG_LOOT` med runom zapiše `v1|LOOT|epoch|itemId|quality|count|name` (brez imena igralca);
    Companion z `enrich_loot` po imenu predmeta in času (±5 min) dopolni `itemId` in `quality` lootu iz chat loga; strežnik pri
    enakem posnetku zamenja samo loot, če prinese več podatkov. **Oblika CHAT_MSG_LOOT v Forever ni preverjena** (če sporočilo
    nima povezave `|Hitem:`, addon vrstice preskoči in ostane vse kot prej).
  - **Minimap gumb** (`Minimap.lua`): levi klik okno, desni klik logiranje, vlečenje okoli minimape, `/wowco minimap`.
- **Preverjeno v pravem dungeonu (15. 11. 2026, WC s partyjem 5, addon 0.4.0):** vodja partyja ✅ (Companion ga je sam dodal
  že naloženemu runu po `/reload`); `CHAT_MSG_LOOT` **ima povezave `|Hitem:`** ✅ (itemId + kakovost). Napake, popravljene v **0.4.1**:
  roll sporočila se začnejo s povezavo `[Loot]` (`[Loot]: X has selected Greed for: [item]`) in so se zapisala kot loot z imenom
  "Loot" → zdaj se upošteva samo sporočilo, kjer je prva povezava predmet; meja 200 vrstic lootu je bila dosežena → 1000;
  instanceId se shrani ob vstopu (prej ob izvozu, zunaj = ID kontinenta).
- **Rolli need/greed so v chat logu** kot navaden tekst (`Loot: X has selected Greed for: Item`, `Loot: X passed on: Item`,
  `Loot: Greed Roll - 97 for Item by X`, `Loot: X won: Item`, `You won:` / `You have selected …`) → bere jih lahko Companion iz
  `WoWChatLog.txt`, addon ni potreben (naslednji korak).
- ✅ **Rolli (15. 11. 2026):** `wowlog::parse_roll_line` (vseh 338 `Loot:` vrstic pravega loga), `RunSummary.rolls` (samo člani partyja, tujci se ne shranijo), strežnik `runDetails.rolls` (+ `checkRun`), portal: zavihek Loot → *Need, greed & broken friendships* (kocke po igralcih, kdo je kaj vrgel, zmagovalec). `wowrun <log> --chat <WoWChatLog.txt>` za preizkus; `web/scripts/companion-upload.ts` naloži run na dev.
- ✅ **Addon 0.5.0 (15. 11. 2026, samo smoke test, v igri še ne):** gumb **More** v metru kroži med Kicks, Dispels,
  Shields (absorbs), Fire (izogibna škoda), Beat up (škoda po nasprotnikih – samo mobi, nikoli igralci), Deaths;
  **klik na vrstico** = uroki igralca (`GetCombatSessionSourceFrom*` → `combatSpells`, imena iz `C_Spell.GetSpellInfo`;
  oblika povzeta po Details! kodi, na Forever še nepreverjena), klik znova = nazaj; `Summary.lua`: ob izhodu iz dungeona
  povzetek runa v chat (čas, bossi, MVP, Medic, Kicks, Floor inspector – seštevek vseh bojev runa, samo party),
  `/wowco report` ga pošlje v /party; `/wowco details on|off` – ob naloženem Details! se naš meter umakne (enkraten namig).
- ✅ **Brez `/reload` (15. 11. 2026):** vodjo partyja Companion bere iz **chat loga** (`wowlog::parse_group_line`:
  `X has invited you to join a group.`, `X/You is/are now the group leader.`, `[Party Leader] X:` – samo ime, nikoli besedilo;
  `You leave the group.`), na pravem WC logu = Lil Nossral (enako kot addon). Kakovost/ID lootu iz addona pride, ko igra
  sama shrani SavedVariables (odjava, izhod; `PLAYER_LOGOUT` → izvoz) – Companion run dopolni in ponovno naloži (48 h nazaj),
  brisanje logov počaka na to. Addon ne prosi več za `/reload`. Smer Companion → addon (rekordi v igri) se osveži ob
  naslednji prijavi (igra bere `CompanionData.lua` samo ob nalaganju – drugače ne gre).
- ✅ **Vprašanje po dungeonu (addon 0.5.0):** ob izhodu iz dungeona, če je addon v runu zabeležil loot, okno
  *Send this run's loot (N items) to the portal now?* → **Send now** = `C_UI.Reload()` (igra shrani SavedVariables, Companion
  run dopolni v nekaj sekundah), **Later** = gre ob zaprtju igre (Companion brisanje logov počaka, da je run z dopolnitvijo na
  portalu), **Don't ask again** (`/wowco ask on|off`). Če se igra sesuje (brez shranjevanja), ostane run brez kakovosti lootu.
- ✅ **Zavihek chata "WowCompany" (addon 0.5.2, 15. 11. 2026):** `/chatlog` zapiše samo to, kar prikaže kakšno okno chata.
  Uporabnik je v *Chat settings → Other* izklopil *Item Loot* in *System Messages* → v dungeonu Ruins of Lordaeron ni bilo
  lootu, rollov ne vodje v `WoWChatLog.txt` (combat log je bil v redu). Addon ob vklopu logiranja ustvari svoj zavihek
  (`FCF_OpenNewWindow`) s skupinami LOOT, SYSTEM, PARTY(_LEADER), RAID(_LEADER/WARNING), INSTANCE_CHAT(_LEADER); glavni zavihek
  ostane izbran. `/wowco chat on|off`. Filtri *Combat Log Config* vplivajo samo na prikaz, ne na datoteko combat loga.
  **Še ne preverjeno v igri**, ali Forever (Midnight) pozna `FCF_OpenNewWindow` – če ne, addon to pove in svetuje ročno nastavitev.
- ✅ **Pridobitve snemalca (addon 0.5.3, Companion 0.1.11, 16. 11. 2026):** zavihek chata prikazuje še COMBAT_XP_GAIN, MONEY,
  COMBAT_FACTION_CHANGE, SKILL. `wowlog::parse_progress_line` (XP z bonusom za skupino, `You loot`/`Your share of the loot`,
  reputacija, veščine, level) → `RunSummary.progress` (samo snemalec) → tabela `runProgress` (run × snemalec) → run stran
  (zavihek Loot: *coin & glory*) in `/rankings` → *Best value* (XP/uro, zlato/uro po dungeonu). Pravi WC: 8 348 XP (2 467 bonus),
  16s 5c, Wands 90→97. Brez Tradeskills, kanalov, šepetanj, guilda.
- Ruins of Lordaeron (2999) ima 6 bossov – dodan The Butcher (3355), preverjeno na pravem logu.
- **Še odprto:** preizkus 0.5.x v igri (posebej razčlenitev med bojem/po boju), `/wowco probe` v dungeonu.
- Pravila: addon nikoli ne registrira `COMBAT_LOG_EVENT*`; nikoli ne kaže/pošilja drugih igralcev razen partyja (`Meter.Visible`;
  v izvozu je edino tuje ime vodja LASTNEGA partyja).

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

## 3a. Faza W – osebni rekordi iz celega loga (open world) – narejeno 14. 11. 2026, necommitano

Rekordi runov (faza R) veljajo samo znotraj dungeon runa. Faza W doda rekorde **lika, ki snema**, iz celega combat loga:

- [x] `wowrun::personal` (`Personal`, `PersonalUpload`): samo `AFFILIATION_MINE` igralec; tuji igralci so `Another player`,
      sam nase `themselves`; cona iz `ZONE_CHANGE` / `MAP_CHANGE`, `inDungeon` po tabeli dungeonov. Stanje je serializabilno.
      Testa v `tests/runs.rs`; `cargo run -p wowrun --example personal -- <log>` (preverjeno na pravem logu: Silverpine Forest).
- [x] Strežnik: `POST /companion/records` → `companion.ingestPersonal` (validator `personalUpload`, `checkPersonal`,
      omejitev `companionRecords` 60/h). Zapiše samo spremljanega junaka, ki ni last drugega uporabnika, in samo večjo številko.
      `heroRecords`: `runId` neobvezen, `zone` lahko `null`, novo polje `world`. E2E v `scripts/companion-e2e.ts`.
- [x] Portal: Personal Records kaže »Open world · cona«; rekord brez runa ni povezava. (Oznaka še ni pregledana na posnetku.)
- [x] Companion **0.1.4** (še ni izdan): `Pipeline::feed(line, &mut Personal)`, stanje v `records.json` (preživi brisanje logov),
      nalaganje največ 1×/min ob novem rekordu, zavihek **Records**, Guide »Records everywhere«.
- [x] **Brisanje logov ob izhodu:** `cleanup::game_running()` (Linux `/proc/*/cmdline`, Windows `tasklist` – **Windows ni preizkušen**).
      Igra zaprta → odprt run se najprej zaključi in shrani (`Cmd::Finish`), nato se pobrišejo **vsi** logi. Igra odprta ali neznano →
      ostane datoteka, v katero je igra pisala v zadnjih 2 min. Addon datotek ne more brisati; briše samo Companion.
- [x] Addon **0.1.2**: nastavitev **Log everywhere** (privzeto izklopljeno): `/wowco log everywhere` ali gumb v zavihku Logging.

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

**Drugi krog (A0b, 14. 11. 2026, addon 0.0.3):**

- [x] **`LoggingCombat(true)` in `LoggingChat(true)` iz addona delujeta** (vrneta `true`, stanje se vklopi) → samodejni vklop logov je mogoč.
- [x] **Registracija `COMBAT_LOG_EVENT_UNFILTERED` / `COMBAT_LOG_EVENT` sproži `ADDON_ACTION_FORBIDDEN`** in okno
      »WowCompany has been blocked from an action only available to the Blizzard UI«. **Teh dveh dogodkov addon ne sme nikoli registrirati.**
- [x] **`C_DamageMeter` deluje in daje navadne (ne skrite) številke** zunaj boja:
  - funkcije: `IsDamageMeterAvailable`, `GetAvailableCombatSessions`, `GetCombatSessionFromType(sessionType, meterType)`,
    `GetCombatSessionFromID`, `GetCombatSessionSourceFromType`, `GetCombatSessionSourceFromID`, `GetSessionDurationSeconds`, `ResetAllCombatSessions`;
  - `Enum.DamageMeterSessionType`: Overall 0, Current 1, Expired 2;
  - `Enum.DamageMeterType`: DamageDone 0, Dps 1, HealingDone 2, Hps 3, Absorbs 4, Interrupts 5, Dispels 6, DamageTaken 7,
    AvoidableDamageTaken 8, Deaths 9, EnemyDamageTaken 10;
  - `GetAvailableCombatSessions()` → seznam `{sessionID, name, durationSeconds}` – en boj na sejo, ime = glavni nasprotnik,
    bossi z oznako `(!)` (v poročilu je bilo 30 sej prejšnjega runa Wailing Caverns);
  - `GetCombatSessionFromType(...)` → `{durationSeconds, totalAmount, maxAmount, combatSources[]}`; vir:
    `{name ("Ime Priimek"), sourceGUID, classFilename, totalAmount, amountPerSecond, isLocalPlayer, deathRecapID, deathTimeSeconds, …}`.
    Skrit je samo `specIconID`. Overall vsebuje **vse člane partyja**.
  - **Še ne preverjeno:** ali so vrednosti skrite *med* bojem; kaj vrne `GetCombatSessionSourceFromType/ID` (verjetno uroki –
    mogoče največji udarec); argumenti dogodka `DAMAGE_METER_COMBAT_SESSION_UPDATED`.
- [x] `C_LootHistory`: `GetAllEncounterInfos`, `GetInfoForEncounter`, `GetSortedDropsForEncounter`, `GetSortedInfoForDrop`, `GetLootHistoryTime`.
- [x] `C_PartyInfo`: med drugim `GetLootMethod`, `IsPartyFull`, `IsGUIDInGroup`. `UnitClass` deluje.
- [ ] `CHAT_MSG_LOOT` še vedno brez vzorca (med selftestom ni bilo pobiranja) in vodja v partyju – preveriti v prvem dungeonu.

### 4.1a Načrt addona po samotestu

CLEU je zaprt, **Blizzardov merilnik `C_DamageMeter` pa je odprt** – addon je lahko pravi merilnik, le da številke bere iz njega:

| Kaj | Vir v addonu |
|---|---|
| Meter (damage, DPS, healing, HPS, prejeta škoda, smrti, interrupti, dispeli) po boju in za cel run | `C_DamageMeter` (seje Current / Overall / po ID-ju) |
| Seznam bojev runa z bossi | `GetAvailableCombatSessions()` |
| Samodejni `/combatlog` + `/chatlog` v dungeonu | `LoggingCombat(true)`, `LoggingChat(true)` |
| Vodja partyja, sestava | `UnitIsGroupLeader`, `GROUP_ROSTER_UPDATE`, `PARTY_LEADER_CHANGED` |
| Loot s kakovostjo, rolli | `CHAT_MSG_LOOT` (preveriti), `C_LootHistory`, `START_LOOT_ROLL` |
| Statistika lika | `GetCritChance`, `UnitAttackPower`, `UnitArmor`, `GetAverageItemLevel` |
| **Največji crit (rekordi)** | iz combat loga prek Companiona; v igri samo, če `GetCombatSessionSource…` da udarce po urokih |

Kanala ostajata: addon → Companion prek SavedVariables (ob `/reload` / odjavi), Companion → addon prek
`Interface/AddOns/WowCompany/CompanionData.lua` (rekordi in lestvice s portala, vidni po `/reload`).

Dodatna vrednost: addon z `C_DamageMeter` da meter runa **tudi brez `/combatlog`** – Companion lahko iz SavedVariables naloži
osnovni run (damage/healing/smrti po igralcih), če combat loga ni. To je rezervni vir, combat log ostane glavni (uroki, časovnica, recapi).

Pravila za kodo addona: nikoli `RegisterEvent("COMBAT_LOG_EVENT*")`; vsako vrednost skozi `issecretvalue`; skritih vrednosti ne
primerjaj in ne računaj z njimi (lahko se jih samo prikaže s `SetText`); `C_Item.GetItemInfo` namesto `GetItemInfo`.

Vzori: ForeverDungeonJournal (`Systems/RunLog.lua` – zaznava runa brez CLEU), `postblink/KwikTip`.

### 4.2 Zgradba (stanje: addon 0.1.0, prvi del napisan)

```
addon/
  .luacheckrc           seznam WoW funkcij za luacheck
  smoke.lua             preizkus zunaj igre: lažen WoW API naloži addon, sproži dogodke, izriše vse zavihke (40 preverjanj)
  WowCompany/
    WowCompany.toc      ## Interface: 16001, SavedVariables: WowCompanyDB
    Core.lua            ns, nastavitve, dogodki (ns.on – COMBAT_LOG_EVENT* zavrne), ns.command, /wowco
    Logging.lua         samodejni LoggingCombat/LoggingChat v dungeonu; izklop 20 min po izhodu, samo če jih je vklopil addon
    Meter.lua           branje C_DamageMeter (boj / overall / pretekli boj po ID-ju), seznam bojev
    UI.lua              okno Meter · Fights · Logging (premično, Escape zapre)
    Probe.lua           /wowco probe – vzorči odprta vprašanja (skrivnosti med bojem, uroki, loot, vodja)
```

**Preverjanje:** `bun run check:addon` = `luac5.1 -p` + `lua5.1 addon/smoke.lua` + `luacheck` (orodja: `sudo apt install lua5.1 lua-check`).
Smoke test dokazuje samo, da je naša koda zdrava – ne, da se pravi odjemalec vede kot lažni. **V igri še ni preizkušeno.**

**Ukazi v igri:** `/wowco` (okno), `/wowco log on|off|auto|everywhere`, `/wowco advanced`, `/wowco probe`, `/wowco reset`.
Okno: odpre se ob prijavi (če ni bilo zaprto), privzeto na vrhu zaslona, vlečenje, gumb `pin`, položaj se shrani.

**Addon 0.1.3:** zavihek **Now** (privzet) – ena stran za trenutni boj: tarča, trajanje, tvoj damage/DPS, healing/HPS, prejeta škoda,
interrupti; osvežuje se 2× na sekundo iz seje `Current`.

**Pravilo zasebnosti (zahteva uporabnika 14. 11. 2026): addon ne sme kazati drugih igralcev, razen članov partyja.**
`Meter.Visible(session)` pusti samo: lastno vrstico (`isLocalPlayer` ali GUID), člane skupine (`C_PartyInfo.IsGUIDInGroup`), ali vse
vrstice, če si s skupino v dungeonu (zasebna instanca). Vrstica, katere lastnika ni mogoče preveriti (skrita identiteta med bojem),
se **ne pokaže** in se ne ugiba. Skupni seštevki seje se kažejo samo v dungeonu s skupino (`Meter.TotalsAreParty`). Znana luknja:
ime boja v zavihku Fights je ime nasprotnika – pri dvoboju je to lahko ime igralca.

**Addon 0.2.0 – prenovljeno okno (UI.lua na novo):** okvir z igrinim robom namigov (`UI-Tooltip-Border`), zlata glava z zavihki
(podčrtan aktivni), kartice 2×2 na strani Now (vrednost, na sekundo, »Overall«), vrstice metra z deležem v %, razredno barvo in
teksturo `UI-StatusBar`, zavihek Logging s statusnimi lučkami in opisi, namigi (`GameTooltip`) na gumbih, noga z lučko REC, cono in verzijo.
Uporabljene so samo igrine pisave in teksture. **Run v dungeonu:** `Meter.Run()` (cona, čas, število bojev in bossov od vstopa;
`db.state.run`, nadaljuje po corpse runu do 20 min) – pas na strani Now in ime dungeona v nogi. Videz v igri še ni pregledan.

**Še manjka (drugi del):** zavihka Records in Loot, izvoz za Companion (`WowCompanyDB.export`), branje `CompanionData.lua`,
minimap gumb, vodja partyja in rolli. Najprej rezultat `/wowco probe` iz pravega dungeona.

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

### 4.2 Diagnostika iz igre (16. 11. 2026, poročilo »Help development«, addon 0.5.6)
- **Med bojem** je v `C_DamageMeter` vse *secret* (imena, GUID, zneski, trajanje, na sekundo) – razen razreda.
  **Po boju** je vse navadno. → seštevanje in primerjave samo po boju (tako že dela Summary.lua).
- `GetCombatSessionSourceFrom*` → `combatSpells[]`: `spellID, totalAmount, amountPerSecond, overkillAmount,
  isAvoidable, isDeadly, creatureName, combatSpellDetails{unitName, unitClassFilename, classification, isMob,
  isPet, amount}`. Pri prejeti škodi `combatSpellDetails` pove, kateri mob (ime, tip) – osnova za "kdo me je tepel".
- `GetSessionDurationSeconds(sessionType)` – sprejme TIP seje (Current = 19 s po boju), ne ID boja.
- Seja "Overall" traja od prijave (npr. ~6,5 h) → `amountPerSecond` je tam razredčen, ni DPS boja.
- `CHAT_MSG_LOOT` ima povezavo predmeta (itemId, barva kakovosti `nIQ2`).
- Izven skupine `UnitIsGroupLeader` vrže napako (pcall).

### 4.5 Koledar iz igre (addon 0.6.8, 17. 11. 2026)

`Calendar.lua`: ob `PLAYER_ENTERING_WORLD` `C_Calendar.OpenCalendar()`, ob `CALENDAR_UPDATE_EVENT_LIST` (največ na
10 min) in ob odjavi prebere ta in naslednji mesec (`SetAbsMonth` na današnji mesec – ne, če je odprto okno koledarja).
Vzame samo `calendarType` HOLIDAY in SYSTEM; opis praznika iz `GetHolidayInfo`. Časi v koledarju so realm čas:
odmik = `GetCurrentCalendarTime()` (kot UTC) − `GetServerTime()`, zaokrožen na 15 min. **Nepreverjeno v igri:** ali
Forever vrača praznike in ali `endTime` pri večdnevnem prazniku res pomeni konec praznika.

### 4.6 Lastna pozicija v dungeonu – NE (preverjeno 18. 11. 2026, addon 0.6.9 probe)

Ragefire Chasm, 57 vzorcev po 2 s, v boju in izven njega: `UnitPosition("player")` vrne samo ID instance
(389), x/y/z = nil; `C_Map.GetBestMapForUnit("player")` = nil (torej tudi `GetPlayerMapPosition` nič). Enako kot
retail od 7.1. **Addon v instanci ne more snemati poti** (tudi OpenMap v instancah ne pošilja). Pozicije v
dungeonu ostanejo iz advanced combat loga; strežnik zdaj replay vseh snemalcev istega runa **združi**
(`lib/replayMerge.ts`) – vsak log doda pozicije svojega snemalca, tudi daleč od ostalih. Več članov s
Companionom in vklopljenim combat logom = popolnejši replay.

### 4.7 Kdo snema v partyju (addon 0.7.0, 18. 11. 2026)

`Party.lua`: addon sporočila (predpona `WowCoParty`, samo PARTY/INSTANCE_CHAT, nikoli guild):
`S\tverzija\tcombat\tchat\tadvanced\task`. Ob vstopu v dungeon in spremembi partyja pozdrav z `ask=1`
(največ 1 na 5 s), drugi odgovorijo (`ask=0`, največ 1 na 5 s); ob spremembi lastnega logiranja znova.
Meter: število ob lučki = koliko jih snema combat log (zeleno, rdeča 0), tooltip lučke = seznam. Enkrat na
dungeon (po 20 s) opozorilo v chatu: nihče ne snema / nekdo ima novejši addon. Podatki samo v pomnilniku.
Nepreverjeno v igri: ali sporočila med addoni na Forever v dungeonu pridejo (OpenMap jih uporablja za GUILD).

### 4.8 Meter v odprtem svetu s partyjem (addon 0.7.1, Companion 0.1.22, 22. 11. 2026)

Med bojem v odprtem svetu igra v `C_DamageMeter` skrije identitete (`sourceGUID` = secret), zato je pravilo
zasebnosti skrilo vse razen tebe (`MineLive`). Zdaj `Meter.Visible` vrne še število skritih vrstic; če so,
okno vpraša `Meter.PartyLive`: za `player` + `party1..4` (ali `raid1..N`) `GetCombatSessionSourceFromType/ID` po
GUID-u iz lastnih party enot → samo ti in tvoj party, tujec na istem mobu nikoli. Skrite vrednosti se ne
primerjajo: vrstni red ti, nato party; ko so vrednosti navadne, po velikosti. **V igri nepreverjeno:** ali
Forever med bojem odgovori za GUID drugega člana (za lastnega odgovori).

### 4.9 Item level iz igre (addon 0.7.2, Companion 0.1.23, 26. 11. 2026)

Blizzardov profil za Forever like od ~23. 11. 2026 **ne vrača več** `equipped_item_level`, `average_item_level` in
`level` pri predmetih (preverjeno na API-ju: Bonobo, Pharaun, Purr – polj ni; Sinek jih ima še iz stare prijave).
Statični API predmetov Forever predmetov ne pozna, classic/era pa imata za isti predmet različne številke.
Zato: addon izvozi `v1|GEAR|ime|equipped|best|reža:itemId:ilvl,…|epoch` (`GetInventoryItemLink` +
`C_Item.GetDetailedItemLevelInfo`, `GetAverageItemLevel`; ob `PLAYER_EQUIPMENT_CHANGED`, ob odjavi/`/reload`
na disk) → Companion `POST /companion/gear` ob spremembi (`gear-sent.json`) → strežnik `companion.ingestGear`
(samo lastnikovi junaki, tabela `gameGear`) dopolni `summaries.ilvlEquipped/ilvlAverage` in `details.equipment`
(ilvl + vrstica »Item Level« v tooltipu), kjer je Blizzardov 0; `poll.apply` naredi isto ob vsakem osveževanju
(`lib/gameGear.ts` `withGameGear`). Kar Blizzard da, ima prednost. Brez addona stran kaže »–« namesto 0.
- **28. 11. (addon 0.7.3, Companion 0.1.24):** ob `PLAYER_LOGOUT` igra ne vrne več opreme in statistik (vse 0,
  `GEAR` manjkal, `CHAR` same ničle – zadnji izvoz je povozil dobrega). Addon si zapomni zadnji dobri vrstici
  (`db.lastChar`, `db.lastGear`; ob vstopu v svet +5 s in ob menjavi opreme) in ju ob odjavi zapiše namesto ničel.
