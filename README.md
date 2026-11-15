# WowCompany

Tracks a group of friends' **WoW Forever** heroes (EU): levels, gear, stats, dungeon runs and spectacular deaths.

| Folder | What |
|---|---|
| [`web/`](web) | Portal – SvelteKit 3 + Tailwind + shadcn-svelte on Vercel, Convex backend (`web/src/convex`), Better Auth + Google, Discord |
| [`desktop/`](desktop) | WowCompany Companion – Tauri 2 desktop app that reads the combat log and uploads dungeon runs |
| [`crates/`](crates) | Rust libraries: `wowlog` (combat log parser), `wowrun` (run detector + analysis) |
| [`addon/`](addon) | In-game addon `WowCompany` (meter, records, auto combat log) |
| [`docs/`](docs) | Plans and verified facts – start with [docs/README.md](docs/README.md) |

## Local development

```bash
cd web && bun install
bun run convex           # terminal 1 (from the repo root) – Convex functions, keeps running
bun run dev              # terminal 2 – http://localhost:5173
```

Secrets live in `web/.env` (never committed). Push them to Convex from `web/`:

```bash
bun run env:push           # dev deployment
bun run env:push -- --prod # production (uses *_PROD overrides, e.g. SITE_URL_PROD)
```

## Checks

```bash
bun run check:all          # portal types + unit tests, addon (luac, smoke, luacheck), cargo test, desktop types
cd web && bun run check:visibility   # public/private filtering against the dev deployment
```

Discord commands: `cd web && bun run discord:register` (or **Register commands** in Portal Room).

## Deploy

Vercel builds from the repo root with `vercel.json` (`cd web`, `convex deploy` + `bun run build`, then the
build output is moved to `.vercel/output`). Vercel needs only `CONVEX_DEPLOY_KEY` (Production deploy key from the
Convex dashboard). The Companion is released by pushing a `companion-vX.Y.Z` tag (GitHub Actions).

The first user to sign in on a fresh deployment becomes the admin ("Guild Master").

Discord (webhook + bot token) is configured in the browser: **Office → Portal Room**. Secrets are stored in a
Convex table read only by internal functions and are never sent back to the browser. `DISCORD_*` env vars are
only a fallback.

---

Non-commercial fan project. Not affiliated with Blizzard Entertainment.
