# WodeAppX — Agent & contributor index

This file is the machine-readable entry for clones of [github.com/diankourenxia/wodeappx](https://github.com/diankourenxia/wodeappx). Humans start at [README.md](README.md) (中文) or [README.en.md](README.en.md).

Product name in UI and docs: **WodeAppX**. Repo / package / process: `wodeappx`. Do not invent a second brand.

User READMEs match the desktop locale list: `README.md` (zh), `README.en.md`, `README.ja.md`, `README.vi.md`, `README.pt-BR.md`, `README.th.md`, `README.fr.md`, `README.ca.md`, `README.es.md`, `README.ru.md`. This file stays English.

## What this repo is

Open-source **local-first desktop AI workbench** (Apache-2.0). Users customize the agent (skills, tools, skins), mix models for text / image / video, and keep data on the machine. Official cloud (wodeapp.cn / wodeapp.ai) is optional, same rank as any other provider.

This tree is the **standalone** project. After `pnpm run setup`, a generated desktop shell lands in `vendor/` (gitignored). Do not treat `vendor/` as source.

## Product rules (do not violate)

- User-visible copy: no emoji; no third-party engine brand names.
- Do not hardcode user-visible model lists. Families come from the bundled catalog + live `/models` probe.
- WodeApp cloud has no GPT / Claude / Grok. Never invent `wode/gpt*`, `wode/claude*`, `wode/grok*`.
- Default model = last working choice → first connected local key → signed-in WodeApp. Login must not steal the default back to `wode/*`.
- Image / video workbenches use the same key store and routing as chat (`docs/LOCAL_KEY_INVOKE.md`).
- Local keys live in `~/.wodeapp/keys.json` (known vendors + custom `*_API_KEY` / `*_BASE_URL` / `*_LABEL`). Login tokens stay in `credentials.v1.json`.
- Debug API / runtime failures with evidence (request-id, logs, minimal HTTP replay). Do not theorize from code only.
- Sticky / deferred tool-surface acceptance: no fake models. See `docs/AGENT_CAPABILITY_TESTING.md` A17.

## Common tasks → where to edit

| Task | Where |
|------|--------|
| Product copy / this index | `README.md`, `README.en.md`, this file |
| Desktop chrome, agents, assets, first-mile | `integrations/openwork/fork/` (explicit overlays) + register in `scripts/apply-openwork-integration.mjs` |
| Local keys / custom vendor / provider probe | `integrations/wodeapp-cloud/` |
| Browser automation (extension + host) | `integrations/browser-control/` |
| Capture sidecar | `capture-engine/` |
| Optional cloud login | `integrations/wodeapp-cloud/` — OSS default stays local-first |
| Lock upstream desktop shell | `openwork.lock.json` — never bump casually |
| Installer / release | `docs/RELEASE.md` |

Do not edit generated `vendor/` and expect it to persist. Next `pnpm run setup` / patch overwrites it.

## Setup

Need Node.js **22** (not 26), pnpm **9.15**, Bun **1.3.9+**, Go **1.23**.

```bash
pnpm run setup    # not `pnpm setup`
pnpm dev
```

Checks: `pnpm open-source:check`, `pnpm open-source:verify:contract`, twice `pnpm openwork:patch` (must be identical). Details: [CONTRIBUTING.md](CONTRIBUTING.md).

## Docs (this tree)

| Doc | Use |
|-----|-----|
| [docs/README.md](docs/README.md) | Full desktop doc index |
| [docs/CAPABILITIES.md](docs/CAPABILITIES.md) | What the desktop can do |
| [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) | Chat + workbench same key path |
| [docs/SELF_EVOLUTION_DESIGN.md](docs/SELF_EVOLUTION_DESIGN.md) | Gated self-edit of this product |
| [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) | OSS status and roadmap |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module boundaries |
| [SECURITY.md](SECURITY.md) | Private vulnerability reports |
| [PRIVACY.md](PRIVACY.md) | Browser-control extension privacy |

## Self-evolve vs editing this clone

- **This git clone** (Cursor / your editor): edit source directly, run `pnpm dev`.
- **In-app self-evolve**: only when the running desktop workspace is this product, and the user asked to evolve. Snapshot → change → verify → rollback. See `docs/SELF_EVOLUTION_DESIGN.md`.
