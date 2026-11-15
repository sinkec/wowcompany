<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`web/src/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Repository layout

`web/` portal (SvelteKit + Convex in `web/src/convex`), `desktop/` Tauri Companion, `crates/` Rust parser/analyzer,
`addon/` in-game addon, `docs/` plans (start with `docs/README.md`). Run portal commands from `web/`.
