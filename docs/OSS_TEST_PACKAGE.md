# WodeAppX 测试包说明（WodeApp + WodeAppX 合体）

> 给「装包就能测」用。完整本机 SQLite 内置 mainserver 仍在规划中；本测试包验证品牌、默认工作区与默认能力项目。
> 产品模型见 [`DESKTOP_LOCAL_RUNTIME.md`](DESKTOP_LOCAL_RUNTIME.md)：本机 sidecar **可有可无**；云端是可选加层。

## 这包里有什么

| 层 | 首启行为 |
|----|----------|
| WodeAppX | 自动创建本地 `default-workspace`（对话落在侧栏「最近」，**不是**「项目」） |
| 自进化项目 | 安装包内嵌**筛选后的 monorepo 源码**；首启解压到 `userData/self-evolve-source/<version>/wodeapp`，自动挂到侧栏「项目」→ `wodeapp（自进化）`。也可用 `WODEAPP_MONOREPO_ROOT` / `WODEAPPX_SOURCE_ROOT` 覆盖；可用「新建 → 使用现有文件夹」手动挂载 |
| WodeApp | 通过 `desktop-embedded-bootstrap` + `wodeappx-bootstrap` 创建默认能力项目（图片 / 视频 / 短剧 / 画布 / 多模型），出现在「我的智能体」 |
| 品牌 | **WodeAppX** |
| 我的智能体 | **配置驱动 Layer0**（[`AGENTS_CONFIG.md`](AGENTS_CONFIG.md)）：安装包内 `wodeapp-builtin-agents.default.json`，按「能力 / 行业 / 品牌」三组展示 |
| 品牌智能体 | **仅本机** `~/.wodeapp/brand-agents.json`；提交/打包过滤（见 [`AGENTS_CONFIG.md`](AGENTS_CONFIG.md) §6）。示例 `docs/examples/brand-agents.wynne.example.json` |
| 连接 | 优先探活本机 `127.0.0.1:3000`；不通则走云端（保证能测合体） |

代码入口：

- 本机探活：`integrations/wodeapp-cloud/electron/wodeapp-local-runtime.mjs`
- 打包：`pnpm release:macos:oss`（内含 `pack-self-evolve-source`）
- 源码包单独生成：`pnpm pack:self-evolve-source`
- 品牌覆写：`scripts/apply-oss-product-brand.mjs`
- 独立仓导出：`pnpm open-source:export:git`

## 怎么打测试包

```bash
cd wodeappx
# 建议升一个 patch 版本后再打，避免覆盖已有正式包
pnpm release:macos:oss
# 已 patch 过可加速：
pnpm release:macos:oss -- --skip-bootstrap
```

产物在 `wodeappx/release/`，文件名带 `-oss`。

## 你怎么测

1. 安装 `wodeappx-mac-*-<ver>-oss.dmg`
2. 打开 App，确认窗口标题 / 关于为 **WodeAppX**
3. 确认已有默认本地工作区（无需再「选文件夹」才能聊）
4. 侧栏 / 账户能力里能看到默认能力项目（或首次联网后自动出现）
5. （可选）本机先起 `server` 在 `:3000`，再开 App，确认优先连本地

## 还不在本包里的

- 安装包内嵌 SQLite mainserver（完整 Desktop Profile）
- 完全离线、无 Postgres 也能建平台项目（依赖上一条）

开发机可选手动本机 sidecar（需 monorepo `.env` 的 `DATABASE_URL`）：

```bash
node scripts/desktop-local-sidecar.mjs start
# 或 WODEAPPX_LOCAL_SIDECAR=1 启动桌面；OSS + monorepo 会自动尝试
```

「服务与模型」配置入口已落地：设置 → 服务与模型（独立设置页，含 Origin 预设 / 探活 / API Key / 状态卡）与「账号与模型」页均可改配置；CLI `wodeapp onboard` 写同一套 `~/.wodeapp/config.json`。能力中心含「连接器」区，可查看 Platform MCP 实时状态并一键启用。
