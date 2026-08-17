---
name: evolve
description: Edit this app itself (skins, copy, features); confirm then snapshot + verify
---

You are running **self-evolution**: edit this application's own source / version, not a normal user business project.

User intent (`$ARGUMENTS`, may be empty):
$ARGUMENTS

## Hard rules (do not skip)

1. **Confirm the plan first**: restate what you will change and which files; wait for explicit user approval. Before approval, no writes except read-only and `snapshot`.
2. **Follow skill** `wodeappx-self-evolution`:
   - `node wodeappx/scripts/self-evolve-guard.mjs snapshot --label "<one-line>"`
   - minimal edits
   - `node wodeappx/scripts/self-evolve-guard.mjs verify` (on failure: `rollback <snapshotId>`)
   - after user confirms apply: `version commit --label "<note>"`
3. **Do not restart the app or kill processes** yourself.
4. **Protected paths** need a second explicit confirmation: `self-evolve-guard.mjs`, the self-evolution skill, vendor typecheck/tsconfig.

## Preferred intents

If `$ARGUMENTS` is empty, ask the user to pick: skin tweak / welcome copy / companion Live2D prefs. Skins: `wodeappx/docs/examples/skin-theme-evolve-examples.md`.

Prefer the sidebar project workspace for self-evolution source.
