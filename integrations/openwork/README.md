# OpenWork vendor (OSS Agent Desktop shell)

Generic Agent Desktop based on [OpenWork](https://github.com/different-ai/openwork) (MIT).

**OSS default:** no WodeApp login. Users configure **API keys** in OpenWork Settings. WodeApp Platform MCP, WodeApp Project MCP, and BrowserAct MCP are available as built-in OpenWork MCP connectors after `pnpm openwork:patch`.

我的AppX (WodeAppX) keeps OpenWork's native surface: providers, MCP, skills, commands, browser automation, Computer Use, artifacts, permissions, voice, and sessions. The WodeApp layer only adds first-party MCP/provider/skill/command integrations.

## Setup

```bash
pnpm run setup
pnpm dev
```

Requirements: Node 22/24, pnpm, **Bun 1.3.9+**, **OpenCode CLI** on PATH, Rust/Electron toolchain (see upstream README). Node 26 currently fails the OpenWork `better-sqlite3` native build.

If GitHub sidecar download is slow or times out, reuse a local OpenCode CLI:

```bash
pnpm openwork:sidecar:local
pnpm openwork:dev:local-sidecar
```

## OSS vs Cloud

| | OSS (default) | WodeApp Cloud (optional) |
|--|---------------|---------------------------|
| Login | None | `pnpm openwork:patch-cloud` |
| Models | BYOK in Settings | + platform `ai/v1` via bootstrap |
| OpenWork native capabilities | Preserved | Preserved |
| WodeApp MCP | Built-in MCP connectors | Built-in MCP connectors + Cloud login/provider patch |
| BrowserAct MCP | Optional user-owned MCP connector | Optional user-owned MCP connector |

## Optional Cloud patch

```bash
pnpm dev:cloud
```

See [`integrations/wodeapp-cloud/README.md`](../wodeapp-cloud/README.md).

## Related

- [`docs/archive/AGENT_DESKTOP_PHASE1.md`](../../../docs/archive/AGENT_DESKTOP_PHASE1.md)（历史 Phase1 里程碑）
- [`integrations/opencode/README.md`](../opencode/README.md)
