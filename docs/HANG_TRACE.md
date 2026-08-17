# Busy / empty-shell hang tracing

> Observability only. Does **not** auto-abort or change silent auto-continue.

When a chat stays `busy` with a trailing assistant that has `parts=0` / `finish=None`, use this timeline to align UI ↔ OpenCode SSE ↔ mainserver aiProxy.

## Where logs go

| Layer | What | How to read |
|-------|------|-------------|
| UI / sync | `[hang-trace]` JSON lines | DevTools Console filter `hang-trace` |
| Ring + localStorage | last ~2000–4000 events, **TTL 14 days** | `exportHangTraceJson({ sessionId })` / bug-report debug bundle `hangTrace` |
| Diagnostics ingest | milestones (`kind=hang_trace`) | mainserver desktop diagnostics |
| OpenCode sidecar | `chat.headers` with `X-WodeApp-Request-Id` + `X-WodeApp-Session-Id` | `/tmp/opencode-hang-trace.jsonl`（**14 天**轮转清理，超 8MB 再裁半） |
| aiProxy | `request.received` → `channel.response_headers_received` → `client_stream.first_chunk` / `.first_effective_event` / `.first_message_delta` | mainserver AI proxy logs；同一 `requestId` 串联 |

## Retention

- UI ring / localStorage：按事件 `ts` 保留 **14 天**（半个月）；最多每天 prune 一次（启动时强制一次）。
- Sidecar jsonl：按行内 `at` ISO 保留 **14 天**；每天最多 rewrite 一次，或文件 >8MB 时立即裁剪。
- 条数上限仍生效（ring 4000 / LS 2000），与 TTL 同时作用。

## Key events

- `turn.start` / `prompt.sent` — user or recovery send
- `status.busy` / `status.idle` / `status.retry` — SSE session.status
- `assistant.shell_created` — empty assistant message shell
- `empty_shell.tick` (every ~5s) / `empty_shell.long` (≥12s)
- `assistant.first_part` — TTFT from shell create (`ttftMs`)
- `auto_continue.attempt` / `.sent` / `.skip` — silent recovery path
- `abort.user` / `abort.system` / `abort.api`

Correlate with `turnTraceId` + `sessionId` + `messageId`. WodeApp provider requests use OpenCode `messageId` as `X-WodeApp-Request-Id`; proxy logs echo the same `requestId` and include selected `channelId` / `keyId` plus a safe upstream request id when the provider returns one.

## Bug report

Top-bar「排查对话故障」debug JSON includes `hangTrace` dump for the reported session.

## Repro helpers

- `wodeappx/scripts/repro-busy-empty-shell-hang.mjs`
- `wodeappx/scripts/stable-busy-empty-hang-matrix.mjs`
- `wodeappx/scripts/benchmark-text-proxy-ttft.mjs --profiles tiny,full --models kimicode/k3-256k,minimax/MiniMax-M3`
- `wodeappx/integrations/openwork/tests/busy-empty-shell-hang.repro.test.ts`
