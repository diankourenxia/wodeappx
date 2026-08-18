<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Customize the agent. Mix and match models.</strong><br />
  Open-source AI desktop. Skills, tools, and skins you define. Mix models for writing, images, and video.<br />
  Image and video workbenches ship ready. Local-first. Your keys. No login wall.
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3"><img src="https://img.shields.io/github/v/release/diankourenxia/wodeappx?color=111111&label=release" alt="release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-111111" alt="Apache-2.0" /></a>
  <a href="https://github.com/diankourenxia/wodeappx/stargazers"><img src="https://img.shields.io/github/stars/diankourenxia/wodeappx?style=flat&color=111111" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://x.wodeapp.ai/">Website</a>
  ·
  <a href="https://wodeapp.ai/chat">Try in the browser</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Download v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Trailer</a>
  ·
  <a href="AGENTS.md">For agents</a>
  ·
  <a href="https://x.com/wodeappai">X</a>
</p>

<p align="center">
  <a href="https://youtu.be/gULs1_u1JYE">
    <img src="https://img.youtube.com/vi/gULs1_u1JYE/hqdefault.jpg" alt="Watch the WodeAppX trailer" width="720" />
  </a>
</p>

<p align="center">
  <img src="https://x.wodeapp.ai/product-hunt/en/01-workbench-en.jpg" alt="WodeAppX workbench" width="920" />
</p>

---

## Contents

- [Start here](#start-here)
- [What you can do](#what-you-can-do)
- [Why WodeAppX](#why-wodeappx)
- [Download](#download)
- [After you open it](#after-you-open-it)
- [Run from source](#run-from-source)
- [For agents / contributors](#for-agents--contributors)
- [FAQ](#faq)
- [Docs](#docs)
- [License](#license)

## Start here

| Path | For | What happens |
|---|---|---|
| [Download the desktop app](#download) | Daily use | Install → add a local key (or cloud sign-in) → talk |
| [Try in the browser](https://wodeapp.ai/chat) | A quick look | Official chat in the site sidebar. China: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Run from source](#run-from-source) | Change the product / contribute | `pnpm run setup && pnpm dev` |

Sites: [x.wodeapp.ai](https://x.wodeapp.ai/) · China [x.wodeapp.cn](https://x.wodeapp.cn/). Compare: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## What you can do

- **Customize the agent** — skills, tools, MCP, connectors, skins; assemble your way
- **Mix and match models** — writing, images, and video each on their own model; no lock-in
- **Image and video ready** — batch images, storyboards, image-to-video already wired; sidebar agents for image / video / short drama / canvas / multi-model
- **Digital assets** — save generated images and video in one tap; reuse them in chat
- **Browser automation** — Chrome extension clicks, reads, and screenshots real pages
- **Skills you can batch** — run the same flow across a set; see permissions, cost, retries
- **Self-evolve** — point the workspace at this product's source; the agent can change the app (snapshot → verify → roll back)
- **Real work on your computer** — local folders, files, terminal, browser — not chat-only
- **Sites and media can stay local** — publish and produce on your machine or self-hosted infra; cloud is optional

Skills define what can run; the agent runs it. Say what you want to do.

## Why WodeAppX

Cursor / Claude Code / Codex edit your repo. WodeAppX is a desktop agent workbench: customize the agent, mix models, ship image/video workbenches, and change the product itself. The software is free (Apache-2.0). You pay only the models you bring. No subscription wall.

- **You shape the assistant** — skills, tools, and skins are first-class
- **The right model for each job** — writing, images, and video do not share one vendor
- **A production line, not an empty shell** — image and video workbenches ship ready
- **Data can stay private** — sessions, files, terminal, and browser on your machine; OSS starts with no login
- **Your keys** — local key or self-host first; official cloud is extra, not a gate
- **It can change this app** — self-evolve has snapshot and rollback, not a slogan
- **Open and auditable** — Apache-2.0; inspect, fork, redistribute

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Customize the agent" />
      <p><strong>Customize the agent</strong><br />Assemble skills, tools, and skins. The agent can also change this product (snapshot → verify → roll back).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Digital assets" />
      <p><strong>Digital assets</strong><br />Save generated images and video in one tap. Reuse them in chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Image workbench" />
      <p><strong>Image workbench</strong><br />Batch-ready. Multiple models already wired.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Video workbench" />
      <p><strong>Video workbench</strong><br />Storyboards, image-to-video, and queues in one place.</p>
    </td>
  </tr>
</table>

## Download

Official build: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS notarized). Site: [x.wodeapp.ai](https://x.wodeapp.ai/) · China: [x.wodeapp.cn](https://x.wodeapp.cn/)

| Platform | Installer |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

On first launch: local key, or cloud sign-in. No account required to start.

## After you open it

1. **Local key (default)**  
   Sidebar **Local** or **Configure local keys**. DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (one key for GPT / Claude / Grok), and a connected OpenAI key all work.  
   You can also add a **custom vendor**: name + Base URL + key; we probe OpenAI-compatible `/models`.  
   Keys stay in `~/.wodeapp/keys.json` on your machine. They are not uploaded to WodeApp.

2. **Chrome (optional)**  
   Install the browser extension from Capabilities so the agent can click, read, and screenshot real pages. You can skip this and install later.

3. **Cloud (optional)**  
   Sidebar **Cloud**, then pick a site: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) or China [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). Sign-in opens the system browser. WodeApp is one provider among others. Login does not reset your default model to the cloud.

4. **Talk**  
   Say what you need in an empty chat, or open Image / Video / Digital assets / Capabilities. The model picker shows current families and matches them to keys you actually connected.

Chat, image, and video share the same keys and routing. If a key is missing, the UI asks you to configure it — not only to sign in.

## Run from source

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Do not use Node 26. The command is `pnpm run setup`, not `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` fetches the desktop shell, applies patches, and installs dependencies. `vendor/` is generated — do not treat it as source. Then create a local workspace and add keys.

See [CONTRIBUTING.md](CONTRIBUTING.md) for gates.

## For agents / contributors

After clone, read **[AGENTS.md](AGENTS.md)** (repo map, where to edit, product rules), then [docs/README.md](docs/README.md).

| Change | Where |
|---|---|
| First-party features, local keys, browser extension | `integrations/`, `capture-engine/`, `scripts/` |
| Desktop UI overlays | `integrations/openwork/fork/`, registered in the apply script |
| Upstream desktop shell pin | `openwork.lock.json` (do not bump casually) |

In-app self-evolve is gated (snapshot → verify → rollback). Editing this git clone in your editor is a normal source change.

## FAQ

**Is this a Cursor / Codex replacement?**  
Yes — and more. Use WodeAppX for the repo, custom agents, image and video, and sites. Build your own workbench: skills, tools, skins, models. Bring your own key.

**Do I need cloud sign-in?**  
No. OSS works with keys you bring. Cloud is optional.

**Is self-evolution model training?**  
No. It means gated edits to this product's source (backup → verify → rollback), not training weights.

**Does my data leave this computer?**  
OSS is local-first. Sessions and files can stay on your machine. Only model APIs you configure go to the network. Cloud sign-in is not a gate.

**Is visual skill editing done?**  
Skills / MCP / tools run today. Full flow-graph editing is on the roadmap.

**Windows says the installer is unsigned?**  
Windows is not Authenticode-signed yet. macOS is notarized. You can run from source or read the Releases notes.

## Docs

| Audience | Docs |
|---|---|
| First file after clone | This page · [中文](README.md) · [Website](https://x.wodeapp.ai/) |
| Agents / contributors | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Capabilities and local keys | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Full desktop index | [docs/README.md](docs/README.md) |
| Open-source plan | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Security / privacy / trademark | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

Original code is [Apache License 2.0](LICENSE). Third-party notices: [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
