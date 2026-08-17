# WodeApp Cloud integration (optional — not OSS default)

**Product / WodeApp Cloud build only.** Open-source releases use **BYOK** in OpenWork Settings; see [`integrations/opencode/README.md`](../opencode/README.md).

This layer adds:

- System browser login → loopback handoff → `POST /mainserver/api/auth/desktop-bootstrap`
- `~/.wodeapp/config.json` (API key + origin)
- Local digital assets under Electron `userData/wodeappx-assets`
- Global OpenCode provider `wodeapp` → `{origin}/mainserver/api/ai/v1`
- Onboarding **Sign in with WodeApp**

## Apply to vendor OpenWork

```bash
cd wodeappx
node scripts/bootstrap-openwork.mjs
cd vendor/openwork && pnpm install
node ../scripts/apply-wodeapp-cloud-integration.mjs
pnpm dev
```

## Files

| File | Role |
|------|------|
| `electron/login-bridge.mjs` | Electron modal login |
| `electron/config-store.mjs` | `~/.wodeapp/config.json` |
| `electron/wodeapp-local-assets-ipc.mjs` | Local digital asset files + manifest |
| `electron/wodeapp-provider.mjs` | Write OpenCode global provider |
| `electron/wodeapp-auth-ipc.mjs` | `wodeapp:auth` IPC |
| `app/wodeapp-auth.ts` | Renderer client |

Requires deployed `desktop-bootstrap` on target origin.
