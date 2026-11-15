# WowCompany – dokumentacija (kazalo)

| Dokument | Vsebina |
|---|---|
| [PLAN.md](PLAN.md) | portal (SvelteKit + Convex + Vercel): §0 stanje in ukazi, arhitektura, proračun brezplačnih paketov |
| [COMPANION.md](COMPANION.md) | namizna aplikacija (Tauri), combat log dejstva, §14 kontrolni seznam nepreverjenega |
| [ADDON.md](ADDON.md) | addon `WowCompany`: §1 stanje, §4.1 dejstva o Forever API-ju |
| [STATS.md](STATS.md) | v0.3: statistika po vzoru Warcraft Logs + Details!, Company Parses, sezone, preureditev repozitorija |

**ZAČNI TUKAJ:** [STATS.md](STATS.md) §9 (faze) → [ADDON.md](ADDON.md) §1 → [COMPANION.md](COMPANION.md) §14.

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
