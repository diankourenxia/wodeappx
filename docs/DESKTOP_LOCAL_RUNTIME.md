# Desktop Local Runtime（本机可有 / 可无；云端可选加层）

> 状态：**MVP（2026-08-12）**  
> 产品模型：桌面是宿主；runtime 仍是 monorepo 里的 sidecar，**不折进 `wodeappx` 仓**。  
> 云端用户体系 / 积分是**可选加层**，不是开机前置条件。

## 1. 三态

| 态 | 条件 | 能力 |
|---|---|---|
| **A. 纯桌面** | 无本机 sidecar、无云 | 聊天 / Skill / 本机 BYOK；无能力项目站点 |
| **B. 本机 sidecar** | `mainserver`+`runtime-server` 在 loopback | 能力项目、集合、MCP、生图视频走本机；单机主人（installId），无登录 / 无积分 |
| **C. 可选云** | 用户连上 wodeapp.cn/.ai 或显式允许 cloud bootstrap | 平台积分、托管模型、多端同步等 |

A→B→C 是叠加，不是替换。OSS 默认不抢云端身份。

## 2. 怎么开本机 sidecar

```bash
# 需 monorepo + DATABASE_URL（现阶段仍用 Postgres；SQLite 内嵌以后再做）
cd /path/to/wodeapp
node scripts/desktop-local-sidecar.mjs start
node scripts/desktop-local-sidecar.mjs status
node scripts/desktop-local-sidecar.mjs stop
```

桌面侧：

- `WODEAPPX_LOCAL_SIDECAR=1` 强制尝试拉起
- `profile=local-only` 同强制
- `WODEAPPX_EDITION=oss` 且能解析到 monorepo → 自动尝试
- `WODEAPPX_LOCAL_SIDECAR=0` 关闭自动拉起

云端加层：

- OSS：默认**不**做 cloud embedded bootstrap（本机没有也不硬连云）
- 商业版（WodeAppX）：本机没有时仍可回落云端内嵌身份
- 显式：`WODEAPPX_CLOUD_BOOTSTRAP=1` 或配置 `profile=cloud`

## 3. 代码入口

| 文件 | 职责 |
|---|---|
| `scripts/desktop-local-sidecar.mjs` | 拉起/停/探活 mainserver+runtime-server |
| `wodeappx/integrations/wodeapp-cloud/electron/wodeapp-local-runtime.mjs` | 桌面 ensure / 策略 |
| `…/wodeapp-auth-ipc.mjs` | 启动：先本机，再按策略可选云 |
| `…/embedded-bootstrap.mjs` | installId → API Key；loopback → `local-only` |
| `server` health | `desktopLocal` / `openSourceMode` / `profile` |

## 4. 还没做

- 安装包内嵌二进制（无 monorepo 也能 B）
- SQLite Desktop Profile（去掉外部 Postgres）
- 设置页「本机 / 自建 / 云端」一键切换 UI
- **手机端云中转遥控**（顶栏入口已隐藏）：当前 register 要 WodeApp 登录/API Key，与「云端可选」冲突。开关：`WODEAPP_MOBILE_REMOTE_ENABLED`（`wodeapp-mobile-remote-feature.ts`）。后续路径：登录可选或本机 LAN 配对后再打开。

## 5. 验收

```bash
node --test wodeappx/integrations/wodeapp-cloud/electron/wodeapp-local-runtime.test.mjs
# 有 DATABASE_URL 时：
node scripts/desktop-local-sidecar.mjs start
curl -s http://127.0.0.1:3000/mainserver/api/health
curl -s http://127.0.0.1:4100/health
```
