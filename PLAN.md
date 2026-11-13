# WowCompany – načrt dela

Osebna, nekomercialna spletna aplikacija za spremljanje WoW Forever likov skupine prijateljev (~30 igralcev).
Statistike se samodejno pobirajo z Battle.net API-ja, prikazujejo na spletni strani in objavljajo v Discord kanal.
Vse mora delovati znotraj **brezplačnih paketov**.

---

## 0. Stanje projekta (13. 11. 2026) – kje nadaljujemo

**V produkciji in deluje:** https://wowcompany.vercel.app · GitHub `sinkec/wowcompany` (zaseben) · Convex projekt `wowcompany` (dev + prod).

| Področje | Stanje |
|---|---|
| Poller (Convex cron 1 min, If-Modified-Since → 304) | ✅ prod teče · **dev poller je USTAVLJEN** (da Discord objave niso podvojene; za razvoj vklopi v dev adminu → Settings) |
| Spletna stran (EN, WoW slog, šaljiv/črn humor) | ✅ seznam, lestvice (Glory / This Week / Hall of Shame), stran lika (Gear & Guts, **Talents**, Progress, Professions, Every Stat Ever), Tavern Gossip feed |
| Prijava (Better Auth + Google) | ✅ prvi prijavljeni = admin (prod admin = lastnik) · Google aplikacija je še v **Testing** (odprto: *Publish app*, priporočilo **brez logotipa**, ker logotip sproži brand verification) |
| Prošnje + admin "Guild Master's Office" | ✅ Petitions, Heroes, Visibility (Website + Discord, select/deselect all), Settings & Budget, **Portal Room**, Members |
| Discord objave (webhook) | ✅ povzetek seje ob odjavi (identiteta, level, ilvl, best ilvl, kills, deaths, errands, HKs, cheevos, day jobs, shenanigans, respec, loot); prazne seje se preskočijo |
| Discord slash ukazi (HTTP interactions) | ✅ `/roster`, `/hero` (autocomplete), `/leaderboard` (15 lestvic) |
| Discord nastavitve prek spleta | ✅ Portal Room: webhook URL + bot token (write-only, tabela `secrets`), App ID / Public Key / Server ID samodejno; env samo rezerva (prod ima trenutno še env vrednosti) |
| Talenti | ✅ drevesa, rangi x/max, ikone, build "5/22/0", respec v objavah, polje vidnosti `talents` |
| Ikona, Privacy, Terms | ✅ `static/icon.svg` (+ `icon-120.png` za Google, `icon-512.png` za Discord avatar), `/privacy`, `/terms` |
| Glavna stran pri 20+ junakih | ✅ Roster s **fiksno višino**: Cards 2×2 ali List 8 vrstic na stran, iskalnik + listanje ‹ › (izbira pogleda v localStorage, privzeto List pri > 8). **Tavern Gossip** enake višine kot Roster (absolutno v stolpcu), lasten zlat drsnik (`.wow-scroll` v `layout.css`), do 30 dogodkov; obiskovalcu "Members only", če je `lastLogin` skrit. Preverjeno: obe višini 504 px, lestvice vedno na istem mestu. |
| Navigacija + uporabniške nastavitve | ✅ glava 64 px: Heroes · Dungeon Runs, GitHub (repo je **zaseben** – obiskovalci dobijo 404), Join/Office, avatar meni (Profile & settings, My characters, Companion devices, Office, Log out). `/settings`: Profile (ime/priimek v tabeli `profiles` + `roles.name`, glavni junak), Characters (alti po `players.by_owner`: make main, disown, remove z vpisom imena, dodaj alta = peticija, umik peticije), Companion devices, Account. Tok preizkušen na dev s `convex run --identity '{subject,sessionId}'`. |

**Naslednji velik projekt: WowCompany Companion** (C1–C5 ✅: parser, detektor, Convex API + /link, Tauri aplikacija `desktop/`, portal `/runs`; naslednja C6 distribucija) (namizna aplikacija Tauri za Windows/Linux, dungeon analitika iz combat loga, prijava prek portala, rubrika Dungeon Runs) – celoten načrt, preverjena dejstva o combat logu in faze so v **[COMPANION.md](COMPANION.md)**.

**Dev baza:** vsebuje 20 testnih junakov (člani guilda) iz preizkusa postavitve rosterja – po želji odstrani v dev adminu → Heroes.

**Naslednji koraki (predlogi):**
1. Google Auth Platform → Branding izpolniti (home `/`, `/privacy`, `/terms`, authorized domain `wowcompany.vercel.app`) → Audience → **Publish app** (brez logotipa).
2. Po ~1 tednu: Convex dashboard → Usage (primerjaj z razdelkom 8) in izmeri zakasnitev Blizzarda po odjavi.
3. Opcijsko: Blizzard ključi nastavljivi prek Portal Room (kot Discord); Discord bot avatar = `static/icon-512.png`; bot viden med člani (`bot` scope brez pravic).

**Upravljanje (ukazi):**
```bash
bunx convex dev                     # dev funkcije (pusti teči); za CLI: export CONVEX_TMPDIR=$PWD/node_modules/.convex-tmp
bun run dev                         # http://localhost:5173
bun run check                       # tipi (svelte-check)
bun run test                        # 53 enotskih testov (Discord objave + slash ukazi po vidnosti)
bun run check:visibility            # ~1500 preverjanj javno/zasebno na dev deploymentu
bun run check:companion             # Companion E2E na dev (povezava naprave, upload, združevanje; za sabo pobriše)
cargo test && cargo run --bin wowrun -- <log>   # Companion: parser + detektor runov (crates/)
cd desktop && bun install && bunx tauri dev       # Companion namizna aplikacija (WOWCOMPANY_API=<dev convex.site> za dev strežnik)
bun run env:push [-- --prod]        # .env -> Convex env (vrednosti *_PROD za produkcijo)
bun run discord:register            # registracija slash ukazov iz .env (ali gumb v Portal Room)
bunx convex run [--prod] admin:refetchAll && bunx convex run [--prod] poll:run '{"force":true}'   # ponovni prenos vseh likov
bunx convex run [--prod] players:addByName '{"name":"Ime Priimek"}'                              # ročno dodajanje
git push origin main                # Vercel samodejno: convex deploy (prod) + build
```

**Pomembne odločitve:** UI v angleščini, odgovori v slovenščini · ilvl samo od Blizzarda (brez lastnih izračunov) · Bun · Convex inicializiran v `src/hooks.ts` (SvelteKit 3 način) namesto `setupConvex()` · slash ukazi angleški · interakcije: SvelteKit pot posreduje Convex HTTP akciji (podpis + interne poizvedbe) · poizvedbe ne berejo ure (`since` pošlje brskalnik).

---

## 1. Kaj sistem zna (in česa ne)

| Dogodek                                                    | Ali ga zaznamo?                    | Zakasnitev                          |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------------- |
| Igralec se **odjavi** iz igre                              | ✅ Blizzard takrat posodobi profil | ~1–2 min (+ Blizzardova zakasnitev) |
| Level up, nova oprema, ilvl, ubiti, smrti, questi, poklici | ✅ ob odjavi                       | kot zgoraj                          |
| Igralec se **prijavi** v igro                              | ❌ API tega ne izpostavi           | –                                   |
| Spremembe med igranjem (v živo)                            | ❌ šele ob odjavi                  | –                                   |

Discord objava je zato **povzetek seje** ob odjavi: "Sinek je končal sejo: +2 lvl, +140 ubitih, nov predmet …".

---

## 2. Tehnološki sklop

| Del                      | Izbira                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Frontend + lahek backend | **SvelteKit** (Svelte 5) + **Tailwind v4** + **shadcn-svelte**, `@sveltejs/adapter-vercel`                  |
| Gostovanje               | **Vercel Hobby** (brez Vercel cronov)                                                                       |
| Baza, cron, akcije       | **Convex Free** (`convex-svelte`, `setupConvex()` v korenskem layoutu)                                      |
| Prijava                  | **Better Auth + Google** prek Convex komponente, SvelteKit adapter `@mmailaender/convex-better-auth-svelte` |
| Discord                  | objave prek **webhooka** iz Convex akcije; slash ukazi prek **HTTP Interactions** na SvelteKit poti         |
| Vir podatkov             | **Battle.net API** (client credentials, namespace `profile-forever-eu`)                                     |
| JS runtime / paketi      | **Bun**                                                                                                     |

Pred uporabo vsake knjižnice se preveri trenutna uradna dokumentacija.

---

## 3. Preverjena dejstva o WoW Forever API (12. 11. 2026, neuradno)

- Za podatke likov zadošča client ID + secret (client credentials).
- Namespaceji: `profile-forever-eu`, `dynamic-forever-eu`, `static-forever-eu`.
- Liki **nimajo realma**: `/profile/wow/character/{ime}-{priimek}` (male črke), npr. `sinek-helgater`.
- Delujoči pod-endpointi: `equipment`, `statistics`, `character-media`, `specializations`, `professions`, `pvp-summary`, `achievements/statistics`.
- Odgovori imajo `Last-Modified`; z `If-Modified-Since` API vrne **304 brez vsebine**, če se lik ni spremenil.
- Guild roster (`/data/wow/guild/zadna-runda/roster`) vrne vse člane (ime, priimek, level, razred, rasa) v enem klicu.
- ilvl se jemlje **neposredno od Blizzarda** (`equipped_item_level`, `average_item_level`), brez lastnih izračunov.
- Nekatere ikone na `render.worldofwarcraft.com/forever-eu/…` vrnejo 403; ista ikona obstaja na `/eu/…`.
- Lik pod levelom 10 ali še ne odjavljen vrne 404.

---

## 4. Arhitektura

```
Battle.net API
     ▲  (1 akcija / min, vzporedno, If-Modified-Since → večinoma 304)
     │
┌────┴──────────────────────── Convex ────────────────────────────┐
│ cron (1 min) → action poll                                       │
│   1. prebere 1 dokument pollState (~4,5 KB)                      │
│   2. za vsakega igralca pogojni GET profila (≤10 hkrati)         │
│   3. 200 → prenese še pod-endpointe, normalizira                 │
│   4. 1 mutacija: zapiše povzetek, podrobnosti, zgodovino, dogodke │
│   5. dogodki → Discord webhook (povzetek seje)                   │
│                                                                  │
│ queries (filtrirajo javno/zasebno glede na vlogo)                │
└────┬───────────────────────────────────────────▲─────────────────┘
     │ live subscriptions                         │ ConvexHttpClient
     ▼                                            │
SvelteKit na Vercelu ────────────────────────────┘
  • javni pogled, prijava z Googlom, pogled za člane, admin dashboard
  • /api/discord/interactions  ← Discord slash ukazi (preveri podpis, odgovor < 3 s)
```

Vercel ne izvaja nobenih cronov; ves časovni del je v Convexu.

---

## 5. Vloge in dostop

| Vloga           | Kdo                                    | Pravice                                                              |
| --------------- | -------------------------------------- | -------------------------------------------------------------------- |
| **Admin**       | **prvi uporabnik, ki se prijavi** (namestitev platforme)   | vse; potrjuje/zavrača zahteve, ureja igralce, javnost polj, interval |
| **Član**        | uporabnik, čigar lika je admin potrdil | vidi **zasebne podatke vseh** igralcev                               |
| **Obiskovalec** | neprijavljen ali nepotrjen             | samo javna polja; prijavljen vidi stanje svoje zahteve               |

Filtriranje se izvaja **v Convex poizvedbah na strežniku**, nikoli v brskalniku.

### Namestitev (prvi admin)

- Ko v bazi še ni admina, prvi uporabnik, ki se prijavi z Googlom, postane **admin** (Better Auth trigger `user.onCreate`, atomarna mutacija).
- Potem je namestitev zaklenjena; vsi naslednji so obiskovalci, dokler jim admin ne potrdi lika.
- Dev in production deployment imata ločeni bazi → na vsakem se prvi prijavljeni (ti) spet postane admin.
- Zaščita: Google OAuth consent screen ostane v načinu **Testing** s tabo kot edinim testnim uporabnikom, dokler se ne prijaviš kot admin na produkciji.

### Tok dodajanja igralca

1. Uporabnik se prijavi z Googlom.
2. Vpiše "Ime Priimek" (predlogi iz guild rostra, osveženega 1× na dan).
3. Convex akcija preveri lika pri Blizzardu in pokaže predogled (level, rasa, razred).
4. Nastane zahteva s statusom `pending` (največ 3 odprte na uporabnika).
5. Admin v dashboardu klikne **Accept** / **Reject**. Accept → lik se začne spremljati, uporabnik postane član.

---

## 6. Convex shema

| Tabela                     | Namen                      | Ključna polja                                                                                           |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| _(Better Auth komponenta)_ | uporabniki, seje           | upravlja komponenta                                                                                     |
| `members`                  | vloge                      | `userId`, `role` (`member`), `createdAt`                                                                |
| `claims`                   | zahteve za dodajanje       | `userId`, `name`, `slug`, `preview`, `status`, `createdAt`, `decidedAt`                                 |
| `players`                  | spremljani liki            | `slug`, `displayName`, `ownerUserId?`, `addedAt`, `active`                                              |
| `pollState`                | **en dokument** za cron    | `entries[]: { playerId, slug, lastModified, lastLogin }`                                                |
| `summaries`                | majhen povzetek za seznam  | `playerId`, level, razred, rasa, guild, ilvl, avatar, lastLogin, kills, deaths, quests, hk, `updatedAt` |
| `details`                  | velik JSON za stran lika   | `playerId`, oprema (+tooltip), statistika, poklici, števci, vse statistike, render                      |
| `history`                  | samo spremenjene vrednosti | `playerId`, `at`, `changes`                                                                             |
| `events`                   | dogodki za Discord in feed | `playerId`, `at`, `type`, `payload`, `postedAt?`                                                        |
| `settings`                 | en dokument                | `pollIntervalSec`, `publicFields[]`                                                                     |
| `itemIcons`                | trajni predpomnilnik ikon  | `itemId`, `url`                                                                                         |
| `guildRoster`              | en dokument, 1× na dan     | `fetchedAt`, `members[]`                                                                                |

**Javnost:** vsako polje ima ključ (npr. `level`, `equipment`, `deaths`, `talents`). V `settings.publicFields` admin označi, kaj vidijo obiskovalci na spletu, v `settings.discordFields` pa, kaj gre v Discord. Ime, priimek in povezava so vedno javni. Feed (Tavern Gossip) je javen samo, če je `lastLogin` javen (razkrije čas odjave); v Discordu je `lastLogin` glavno stikalo za objave.

---

## 7. Discord

- **Objave ob spremembah:** Convex akcija → webhook. Povzetek seje ob odjavi, level up, nov epic/rare predmet, mejniki (npr. 1000 ubitih).
- **Slash ukazi** (HTTP Interactions, brez websocket bota): `/roster`, `/hero name`, `/leaderboard category`.
  - Pot `/api/discord/interactions` v SvelteKitu posreduje zahtevo Convex HTTP akciji `/discord/interactions`, ki preveri Ed25519 podpis (tweetnacl) in odgovori iz internih poizvedb; neveljavno → 401. Zasebni podatki tako nikoli ne gredo skozi javno poizvedbo.
  - Odgovor v 3 s; če ne gre, odloženi odgovor (type 5) in nato dopolnitev prek webhooka interakcije.
- Registracija ukazov: bun skripta, ki jih pošlje v Discord API (guild ukazi, takoj vidni).

---

## 8. Proračun brezplačnih paketov (30 igralcev, preverjanje vsako minuto)

Convex Free (preverjeno v dokumentaciji 12. 11. 2026):

| Limit                      | Ocena       | Delež | Ukrep                                                   |
| -------------------------- | ----------- | ----- | ------------------------------------------------------- |
| 1 M klicev funkcij / mesec | ~100 k      | ~10 % | 1 akcija/min z zanko; mutacija samo ob spremembi        |
| 20 GB-ur akcij             | ~0,8 GB-h   | ~4 %  | Convex runtime (64 MiB), vzporedni klici, 304           |
| **1 GB DB I/O / mesec**    | ~150–200 MB | ~20 % | pollState v enem dokumentu; ločeni povzetki/podrobnosti |
| 1 GB prenosa / mesec       | majhno      | –     | seznam bere samo povzetke; slike pri Blizzardu          |
| 0,5 GB baze                | nekaj MB    | ~1 %  | zgodovina samo sprememb                                 |

- Free plan ima **trde meje**: ob presegu zapisi začnejo padati (brez računa). Admin dashboard prikaže opozorilo.
- Battle.net: ~1.000–1.800 zahtev/h od 36.000/h. Ob 429 → ponovni poskus z zakasnitvijo.
- Vercel Hobby: samo SSR + slash ukazi; daleč pod limiti.

Po prvem tednu primerjaj ocene z Convex nadzorno ploščo; interval je nastavljiv.

---

## 9. Faze dela

### Faza 0 – Priprava

- [x] Battle.net client ID + secret (`.env`)
- [x] Convex projekt povezan (`bunx convex dev`)
- [x] Google OAuth client
- [x] Discord aplikacija, bot, webhook
- [x] GitHub repozitorij
- [x] Vercel projekt

### Faza 1 – Skelet

- [x] SvelteKit (TS) + Tailwind v4 + shadcn-svelte z Bunom
- [x] Convex + `convex-svelte`, `setupConvex()` v `+layout.svelte`
- [x] WoW tema (barve razredov, kakovost predmetov, pisava Cinzel)
- [x] `.gitignore` (`.env*`)

### Faza 2 – Shema in Blizzard klient

- [x] Convex shema (razdelek 6)
- [x] Blizzard klient v Convex akciji: token (v pomnilniku akcije), pogojni GET, normalizacija
- [x] Interna mutacija za ročno dodajanje igralca (preizkus brez prijave)

### Faza 3 – Poller

- [x] Cron vsako minuto → `poll` akcija
- [x] Zaznavanje sprememb, zapis povzetka/podrobnosti/zgodovine/dogodkov
- [x] Predpomnilnik ikon, guild roster 1× na dan
- [x] Retry ob 429/5xx

### Faza 4 – Javni frontend

- [x] Seznam igralcev (kartice), povzetek ekipe, lestvice
- [x] Stran lika: oprema s tooltipi, statistika, poklici, grafi zgodovine
- [x] Žive Convex naročnine

### Faza 5 – Prijava in vloge

- [x] Better Auth + Google (Convex komponenta + `@mmailaender/convex-better-auth-svelte`)
- [x] Token iz piškotkov v `hooks.server.ts` za SSR
- [x] Vloge admin / član / obiskovalec; filtriranje polj v poizvedbah

### Faza 6 – Zahteve in admin dashboard

- [x] Obrazec "Dodaj svojega lika" s preverjanjem pri Blizzardu
- [x] Admin: zahteve (Accept/Reject), igralci, javnost polj, interval, poraba

### Faza 7 – Discord objave

- [x] Webhook iz Convex akcije, oblikovani embedi (barva razreda, portret)

### Faza 8 – Discord slash ukazi

- [x] `/api/discord/interactions` s preverjanjem podpisa
- [x] `/roster`, `/hero`, `/leaderboard`; skripta za registracijo ukazov

### Faza 9 – Objava

- [x] Convex production deployment + env
- [x] Vercel projekt iz GitHuba + env
- [x] Discord Interactions Endpoint URL → Vercel

### Faza 10 – Preizkus

- [x] Javni pogled brez prijave, prijava, zahteva → accept, slash ukaz, objava ob odjavi
- [ ] Poraba v Convex nadzorni plošči po 1 tednu

---

## 10. Skrivnosti (samo env, nikoli v kodi)

| Spremenljivka                                  | Kje                                   |
| ---------------------------------------------- | ------------------------------------- |
| `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET` | Convex env                            |
| `BETTER_AUTH_SECRET`, `SITE_URL`               | Convex env                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Convex env                            |
| `DISCORD_WEBHOOK_URL`                          | Convex env                            |
| `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` | Vercel env                            |
| `DISCORD_BOT_TOKEN`                            | lokalno (samo za registracijo ukazov) |
| `PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`  | Vercel env / `.env.local`             |

Lokalno: `.env` (tvoji ključi) in `.env.local` (Convex ga ustvari sam). Oba v `.gitignore`.

---

## 11. Odprta vprašanja

- [x] Ali slash ukazi v Discordu prikazujejo samo javne podatke ali vse? → ločen stolpec *Discord channel* v Visibility
- [x] Katere dogodke objavljati? → vsako sejo, ki ima vsaj eno vidno spremembo (prazne seje se preskočijo)
- [ ] Hitrost Blizzardove posodobitve profila po odjavi (izmeriti v praksi).
