<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Customize the agent. Mix and match models.</strong><br />
  Open-source AI desktop. Shape the agent — skills, tools, skins.<br />
  Mix models for writing, images, and video. Image and video workbenches ship ready.<br />
  Local-first. Data can stay on your machine. Your keys. No login wall.
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
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Download v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Trailer</a>
  ·
  <a href="https://x.com/wodeappai">X</a>
</p>

<p align="center">
  <a href="https://youtu.be/gULs1_u1JYE">
    <img src="https://img.youtube.com/vi/gULs1_u1JYE/hqdefault.jpg" alt="Watch the WodeAppX trailer" width="720" />
  </a>
</p>

<p align="center">
  <img src="https://x.wodeapp.ai/product-hunt/01-hero-workbench.png" alt="WodeAppX workbench" width="920" />
</p>

---

## What you can do

- **Customize the agent** — skills, tools, MCP, connectors, skins; assemble your way, no fixed template
- **Mix and match models** — writing, images, and video each on their own model; swap anytime, no lock-in
- **Image and video ready** — batch images, storyboards, image-to-video already wired; change vendors without building a flow from scratch
- **Digital assets** — save generated images and video in one tap; reuse them in chat
- **Skills you can batch** — run the same flow across a set; see and control permissions, cost, retries
- **Self-evolve** — point the workspace at this product's source; the agent can change the app (snapshot → verify → roll back)
- **Real work on your computer** — local folders, files, terminal, browser — not chat-only
- **Sites and media can stay local** — publish and produce on your machine or self-hosted infra; cloud is optional

Skills define what can run; the agent runs it. Say what you want to do.

## Why WodeAppX

Most desktop assistants are one model and one chat. WodeAppX is an agent you can shape, and a model mix you can change.

- **You shape the assistant** — skills, tools, and skins are first-class; add capability without waiting for a release
- **The right model for each job** — writing, images, and video do not have to share one vendor
- **A production line, not an empty shell** — image and video workbenches ship ready
- **Data can stay private** — sessions, files, terminal, and browser on your machine; OSS starts with no login
- **Your keys** — local key or self-host first; official cloud is extra, not a gate
- **It can change this app** — self-evolve has snapshot and rollback, not a slogan
- **Open and auditable** — Apache-2.0; inspect, fork, redistribute

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/05-customize-skin.png" alt="Customize the skin" />
      <p><strong>Customize the agent</strong><br />Assemble skills, tools, and skins your way. The agent can also change this product (snapshot → verify → roll back).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/03-digital-assets.png" alt="Digital assets" />
      <p><strong>Digital assets</strong><br />Save generated images and video in one tap. Reuse them in chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/04-image-workbench.png" alt="Image workbench" />
      <p><strong>Image workbench</strong><br />Batch-ready. Multiple models already wired.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/06-video-workbench.png" alt="Video workbench" />
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

## Run from source

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Do not use Node 26.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` fetches the desktop shell, applies WodeAppX patches, and installs dependencies. Then create a local workspace and add keys under **Settings → Service & models**.

## Docs

- [Docs index](docs/README.md)
- [Open-source plan](docs/OPEN_SOURCE_PLAN.md)
- [Desktop capabilities](docs/CAPABILITIES.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Name and logo](TRADEMARK.md)

## License

Original code is [Apache License 2.0](LICENSE). Third-party notices: [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
