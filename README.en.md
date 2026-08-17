# WodeAppX

<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="160" />
</p>

<p align="center"><strong>Languages:</strong> <a href="README.md">中文</a> · <a href="README.en.md">English</a></p>

> Open-source desktop AI workbench.  
> **Customize the agent. Mix and match models.**
> Shape the agent your way. Mix models for writing, images, and video. Image and video workbenches are ready — multiple models already wired. Local-first; data can stay on your machine.

**This open-source product is WodeAppX** (`wodeappx`). Commercial distributions may use another brand; OSS repos and builds ship as WodeAppX.

## At a glance

WodeAppX is a **local-first AI workflow desktop**: combine skills, models, MCP/tools, local files, and optional platform services into **repeatable** flows — not one-off chat.

It targets **content production, site publishing, and local automation**, and helps developers use AI safely in a real workspace (files, terminal, browser). Compared with coding assistants like Cursor / Codex (great at editing *your* repo), WodeAppX also emphasizes an agent you **customize**, **models you mix and match**, and an agent that can **improve the product itself**, with visual workflows as a product pillar.

OSS defaults to **BYOK / self-hosted** with no sign-in required. Official cloud is an explicit option, not a hard dependency.

## Who it's for

| Audience | Primary need | Example flow |
|---|---|---|
| Creators / operators | Cut repetitive content cost | Assets → copy / image / video → review → publish pack |
| Developers | Safe AI in a local workspace | Understand task → edit files / terminal / browser → verify |
| Content / brand teams | Scale images, video, and sites | Save assets → batch generate → publish |
| Automation teams | Integrate existing systems | Trigger → approve → execute → audit / notify |

## Skills vs agents

We use these terms differently throughout the docs:

| | **Skill** | **Agent** |
|---|---|---|
| What it is | A versioned **capability contract** (inputs, outputs, tools, permissions) | The **orchestrator** that understands intent, picks tools, runs multi-step work, handles failures |
| How you use it | Install, compose, **batch** the same flow | Conversational driver; can target a workspace for complex tasks |
| Product focus | **See, control, batch** — production line | **Customize, self-evolve** — assistant you shape |

**Skills define what can run; agents run it end to end.**

## vs coding assistants

| | Typical coding assistant (Cursor / Codex, etc.) | WodeAppX |
|---|---|---|
| Main job | Edit business code in your repo | Content / site / media workflows + can improve **this app** |
| Reuse | Mostly per-session | Skills saved, batched, visual orchestration (roadmap) |
| Models | Often one strong text model | **Mix and match** — text / image / video each on its own |
| Deployment | Often cloud-centric | **Local-first**; sidecar / self-hosted / cloud |
| Extension | Varies | Skills, MCP, connectors, self-evolution gates as first-class |

## What you can do

- **Customize the agent** — skills, tools, MCP, connectors, skins; assemble your way, no fixed template
- **Mix and match models** — writing, images, and video can each use a different model; swap anytime, no lock-in
- **Operate skills** — visible, controllable, batchable (images, assets, site steps); inspect permissions, cost, retries
- **Self-evolve the product** — point the workspace at this app's source; backup → edit → verify → roll back (not just your business repo)
- **Built-in digital assets** — save generated images and video in one tap; reference them in chat
- **Built-in batch image, video, and more** — ready-made workspaces with multiple models already wired, no flow to assemble first
- **Local-first sites & media** — publishing, image/video on local / self-hosted infra; cloud optional
- **Real work on your computer** — files, terminal, browser — not chat-only

## Why WodeAppX

| Advantage | What it means |
|---|---|
| **Customize the agent** | Skills, tools, MCP, connectors, skins — assemble your way |
| **Mix and match models** | Writing, image, video each on its own model; swap anytime — no lock-in |
| **Self-evolving agent** | Improves *this product* (product code, not model weights); backup and rollback gates |
| **Skills you can operate** | See, control, batch — turn one-off chats into a repeatable line |
| **Built-in digital assets** | Save outputs fast; reuse them in chat |
| **Built-in image & video projects** | Ready to go — multiple models already wired |
| **Local-first** | Core work on your machine; OSS needs no login to start |
| **BYOK / cloud optional** | Your keys first; cloud when you want it |
| **Open and auditable** | Apache-2.0 — inspect, fork, redistribute |

## Product direction

1. **Workflows before personas** — define steps, tools, recovery; then add agent personality if needed.
2. **One planner, specialist models on demand** — don't burn LLM tokens on deterministic steps; use the best image/video models where they matter.
3. **Skills are contracts** — not just long prompts; declare I/O, permissions, verifiable results.
4. **Local-first, cloud optional** — no hidden login wall on the OSS path.
5. **Honest status labels** — demo vs shipped vs roadmap.

Full definition, gaps, and acceptance criteria: [Open source plan](docs/OPEN_SOURCE_PLAN.md).

## Capability status

| Area | Status |
|---|---|
| Self-evolution (backup → verify → rollback) | Shipped; improving |
| Desktop workspace, files / terminal / browser, BYOK, skills / MCP | Shipped |
| Sites / assets / image-video (sidecar or self-hosted, no cloud required) | Shipped or optional |
| Visual skill runs, editable flow graph, per-node models & batch | Roadmap / next |
| Enterprise approval, audit, team packs | Planned |

Docs index: [docs/README.md](docs/README.md)

## Quick start

**Requirements:** Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23, and the usual desktop shell build toolchain. Node 26 currently breaks the upstream `better-sqlite3` native build.

```bash
pnpm run setup
pnpm dev
```

`pnpm run setup` will:

1. Fetch and verify the pinned desktop-shell sources (SHA-256);
2. Apply WodeAppX integration patches;
3. Install dependencies.

On first launch, create a local workspace and configure model keys under **Settings → Service & models**. OSS does **not** require WodeApp sign-in.

If the local engine download times out, reuse a local CLI:

```bash
pnpm openwork:sidecar:local
pnpm openwork:dev:local-sidecar
```

## Platform runtime (important)

The desktop workspace (sessions, files, terminal, browser, Computer Use, BYOK) works **fully offline**.

Sites, assets, and image/video workflows need a **WodeApp runtime** — not necessarily the public cloud:

| Mode | For | How | Data |
|---|---|---|---|
| Local sidecar | Dev / single machine | Run mainserver locally (`:3000`), desktop probes it | Stays local |
| Self-hosted | Team / private deploy | Settings → Services → custom Origin | Your server |
| Official cloud | Managed collab | Settings → Services → cloud `sk_live_…` | Cloud (optional) |

Entry: **Settings → Services & models**. If no runtime is configured, capability connectors show **not configured / disconnected** — expected, not a broken install.

## OSS vs Cloud

| | OSS default | Optional WodeApp Cloud |
|---|---|---|
| Sign-in | Not required | WodeApp account |
| Models | BYOK / self-hosted | Platform models + credits |
| MCP / skills / local features | Kept | Kept |
| Start | `pnpm dev` | `pnpm dev:cloud` |
| Public brand | **WodeAppX** | Commercial builds may use another name |

Cloud must not be required to build or run the open-source desktop.

Export a standalone OSS tree (no private monorepo history):

```bash
node scripts/export-standalone-repo.mjs --out ~/Desktop/wodeappx --init-git
```

## Architecture & source layout

WodeAppX-owned core experience, capability packs, self-evolution, and desktop integrations live under `integrations/`, `capture-engine/`, `scripts/`, etc. Build pulls and patches upstream components per `openwork.lock.json`; `vendor/` is generated and not committed.

Key docs:

- [Docs index](docs/README.md)
- [Open source plan & roadmap](docs/OPEN_SOURCE_PLAN.md)
- [Desktop capability matrix](docs/CAPABILITIES.md)
- [Agent minimal context & media routing](docs/AGENT_MINIMAL_CONTEXT.md)
- [Agent capability testing contract](docs/AGENT_CAPABILITY_TESTING.md)
- [Release contract](docs/RELEASE.md)
- [Desktop milestones](docs/DESKTOP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Name and logo](TRADEMARK.md)

## OSS checks

```bash
pnpm open-source:check
pnpm open-source:verify:contract
pnpm open-source:verify
pnpm run openwork:bootstrap -- --force
pnpm openwork:patch
pnpm release:check
pnpm test:agent-capabilities
(cd capture-engine && go test ./...)
```

`open-source:verify` runs stranger `pnpm run setup` in an isolated VPS container. See [docs/OSS_VERIFY.md](docs/OSS_VERIFY.md). Before release: clean builds per platform, install/smoke test, upgrade compatibility, third-party license and security scans.

## Acknowledgments

Third-party licenses and notices: [NOTICE](NOTICE), [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/). The build fetches a pinned desktop shell and applies WodeAppX patches. Non-open upstream parts are not in this distribution.

## License

WodeAppX-owned code is under [Apache License 2.0](LICENSE). Third-party code keeps its own licenses and notices. Names and logos: [TRADEMARK.md](TRADEMARK.md).
