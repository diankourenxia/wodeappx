# WodeApp Runtime MCP (OpenCode / OpenWork)

Connect Agent Desktop to a **self-hosted or cloud WodeApp** stack via MCP. No desktop login required — configure keys in OpenWork **Settings → AI Providers** and MCP here.

## OpenCode version

Use **OpenCode >= 1.17.10** (recommended). Notable fixes for WodeApp remote MCP:

- **1.17.10** — MCP server `instructions` injected into session context (WodeApp Platform/Project MCP return these on `initialize`).
- **1.17.8** — OpenAI-compatible providers accept more MCP tool schemas; long-running MCP tools keep timeout during progress.
- **1.17.7** — Workspace exposed as MCP client root for local servers.

Upgrade CLI and refresh OpenWork sidecar:

```bash
curl -fsSL https://opencode.ai/install | bash
cd wodeappx && pnpm openwork:sidecar:local
```

Provider credentials belong in `~/.local/share/opencode/auth.json` (not inline apiKey in `opencode.jsonc`). See `pnpm openwork:sync-byok:local` in the wodeappx root.

## Prerequisites

1. Running WodeApp CE: `mainserver` (3000) + `runtime-server` (4100). See [WodeApp OPEN_SOURCE_GUIDE](https://github.com/wodeapp/wodeapp/blob/main/docs/OPEN_SOURCE_GUIDE.md).
2. API Key: `POST /mainserver/api/auth/quick-register` or builder **/api-skills**.
3. A project slug for Project MCP (`x-subdomain-project`).

## Model provider (BYOK)

In OpenWork desktop: **Settings → AI Providers → Bring your own key**.

Self-hosted WodeApp proxy (optional):

| Field | Value |
|-------|--------|
| npm | `@ai-sdk/openai-compatible` |
| baseURL | `http://localhost:3000/mainserver/api/ai/v1` |
| apiKey | your `sk_live_...` (prefer `auth.json` on OpenCode >= 1.17.x) |

Cloud: use OpenRouter / OpenAI / Anthropic directly — no WodeApp login in OSS build.

## MCP config

Copy [`opencode.wodeapp-mcp.example.jsonc`](./opencode.wodeapp-mcp.example.jsonc) into your workspace or global OpenCode config. Replace `REPLACE_WITH_*` values and adjust hosts for cloud deploys.

| MCP | Scope | Tools (examples) |
|-----|--------|------------------|
| **Platform** | Account / projects / pages / publish | `create_project`, `update_page`, `publish_project`, `build_app` |
| **Project** | Per-project runtime | `page_*`, workflows, `ai_chat`, image/video, Feishu |

### Data-driven video composition (desktop)

WodeAppX has two separate video routes:

- AI-generated motion: use Project MCP / AppX `wodeapp.video.generate` and the video task APIs.
- Data-driven composition: use the built-in `wodeapp_video_template_render` tool. It reads product records and assets, writes a HyperFrames HTML composition, then renders with Chrome + FFmpeg. It supports per-product batch output and one catalog video with `outputMode: "single"`.

Install ffmpeg on the machine (`brew install ffmpeg` on macOS). The selected composition route owns its render command; use raw `ffmpeg`/`ffprobe` only for diagnostics or media inspection.

`timeout` in the example is tuned for `publish_project`, `build_app`, and video tools. Increase if your deploy is slow.

On connect, each server returns **MCP instructions** (tool choice, auth headers, typical flows). OpenCode 1.17.10+ adds them to the agent session automatically.

Verify discovery:

```bash
curl -sS -H "X-API-Key: $KEY" http://localhost:3000/mainserver/mcp/tools | head
curl -sS -H "X-API-Key: $KEY" -H "x-subdomain-project: YOUR_SLUG" \
  http://localhost:4100/mcp/tools | head
```

API paths: WodeApp monorepo `docs/API_BASE.md` (do not duplicate URL tables in skills).

## Phase 2 desktop default

OSS Phase 1 does **not** auto-install these MCP entries. Phase 2 merges this template into workspace `opencode.jsonc` by default (still disable-able).
