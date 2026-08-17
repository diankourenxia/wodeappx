# wodeappx Architecture

> **Last updated:** 2026-06-28

---

## 1. Architecture Principle

我的AppX（WodeAppX）should preserve the OpenWork conversation/runtime architecture. The desktop app is a branded OpenWork distribution with optional WodeApp Cloud integration, not a separate chat orchestrator.

Normal user chat must stay on the OpenWork path:

```text
SessionSurface
  -> onSendDraft
  -> opencodeClient.session.promptAsync
  -> OpenWork server / OpenCode runtime
  -> MCP / skills / tools / providers
```

WodeApp-specific capabilities plug into that runtime through MCP, providers, skills, and optional Cloud login. The desktop renderer should not pre-route general prompts to WodeApp feature pages or call `/runtime-server/api/agent/chat` as the primary conversation path.

The branded patch must preserve OpenWork-native capabilities instead of replacing them. In particular, keep upstream providers, MCP, skills, commands, BrowserView/browser automation, Computer Use, artifacts, permissions, voice, and session controls in place. WodeApp-only flows belong in a first-party pack layered through MCP/provider/skill/command integration.

---

## 2. Main Components

| Path | Role |
|------|------|
| `vendor/openwork/` | Main desktop runtime and app UI |
| `vendor/openwork/apps/app/src/react-app/domains/session/` | OpenWork session/chat UI |
| `vendor/openwork/apps/desktop/` | Electron shell and local OpenWork server bridge |
| `integrations/opencode/` | WodeApp Platform/Project MCP examples |
| `integrations/wodeapp-cloud/` | Optional WodeApp account login and platform provider patch |

---

## 3. Default Commands

```bash
pnpm dev       # vendor OpenWork desktop
pnpm desktop   # same as pnpm dev
pnpm build     # vendor OpenWork build
```

---

## 4. Integration Boundary

WodeApp mainserver/runtime-server remain the source of truth for hosted apps, publishing, runtime data, and billing. WodeAppX should expose those abilities to OpenWork rather than replacing OpenWork's session loop.

Preferred integration points:

- Project MCP and Platform MCP for build/publish/page/data/workflow tools
- WodeApp Cloud provider for hosted model access
- Skills and commands for WodeApp workflows
- OpenWork Browser/runtime connectors when the user explicitly needs UI control

Keep WodeAppX workbench pages inside `vendor/openwork/apps/app/src/react-app/domains/wodeapp/` or synchronized templates under `integrations/openwork/`.
- WodeApp-specific resource libraries and product/catalog helpers where OpenWork has no equivalent domain model

Avoid:

- A second desktop chat loop that bypasses OpenWork sessions
- Rebuilding OpenWork-native providers, MCP, skills, commands, browser automation, Computer Use, artifacts, or permissions in WodeAppX
- Prompt classification in the desktop UI before the model sees the request
- Forcing navigation to WodeApp feature pages for normal chat requests
