# WodeAppX 开源验证流程

> 用干净 Linux（VPS Docker）模拟陌生人拿到独立仓之后的路径，再叠本机桌面验收。
> 命令入口：`pnpm open-source:verify`。报告：`test-results/oss-verify/`。

## 验证什么

开源是否成立，不看开发机能不能跑，而看这四件事是否同时为真：

1. 独立导出不含 `vendor/`、`.env`、`ee/`、客户 `brand-agents.json`
2. `pnpm open-source:check` 在导出树上通过
3. 陌生 Linux 上 `pnpm run setup` 能完成（拉上游、补丁、装依赖）
4. 连续两次 `openwork:patch` 结果一致

桌面「不登录能聊 / First Mile」仍在本机 macOS 安装包上测，见 [`OSS_TEST_PACKAGE.md`](OSS_TEST_PACKAGE.md)。

## 分层

| 层 | 在哪 | 命令 | 证明 |
|---|---|---|---|
| L0 导出 | 开发机 | `--phase export` | 陌生人拿到的树是干净的 |
| L1 契约 | 开发机（对导出树） | `--phase contract` | 许可证 / 密钥扫描 / 无父仓路径 |
| L2 陌生人 setup | VPS 隔离容器 | `--phase setup` | README 的 `pnpm run setup` 在干净 Linux 成立 |
| L3 补丁幂等 | 同一容器 | `--phase patch-idempotent` | 与 CI 相同的两次 patch 对账 |
| L4 桌面 First Mile | 本机已开桌面 + 单测 | `pnpm open-source:verify:l4` | CDP 标题/工作台/无桌面 OTP；First Mile 向导契约见单测。安装包仍走 `pnpm release:macos:oss` |
| L5 三平台安装包 | GitHub Actions `release.yml` | macos / windows / ubuntu matrix | 安装包能编出来 |

Linux Electron 真机 GUI 不在 VPS 上测。VPS 只证明**源码陌生人路径**。

## 怎么跑

默认打到腾讯云现有机器上的 **隔离 Docker**，目录固定 `/opt/wodeappx-oss-verify`，**不会**碰 `/var/www/wodeapp` 或正在跑的 `wodeapp-server` 容器。容器限制 3 CPU / 8G 内存。

```bash
cd wodeappx

# 完整陌生人路径（导出 + 契约 + VPS setup + 补丁幂等）
pnpm open-source:verify

# 只做导出和契约（不 SSH）
pnpm open-source:verify:contract

# 指定机器 / 镜像
pnpm open-source:verify -- --host wode-cn-tencent --phase export,contract,setup,patch-idempotent
```

环境变量：`WODEAPPX_OSS_VERIFY_HOST`、`WODEAPPX_OSS_VERIFY_DIR`、`WODEAPPX_OSS_VERIFY_IMAGE`。

`--cleanup` 会删远程 `/opt/wodeappx-oss-verify`。默认保留，方便看失败现场。

## VPS 约束

- 远程目录只允许 `/opt/wodeappx-oss-verify*` 或 `/tmp/wodeappx-oss-verify*`
- 拒绝 `/var/www/wodeapp`、`/`、`/opt`
- 容器名 `wodeappx-oss-verify`，与生产 `wodeapp-*` 容器分开
- 镜像默认 `docker.m.daocloud.io/library/node:22-bookworm`（国内拉官方 Docker Hub 经常超时）
- 容器内 npm registry 用 `https://registry.npmmirror.com`；OpenWork zip 仍走 GitHub `codeload`
- Electron 官方 GitHub 下载在国内会卡住。验证容器设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。陌生人在中国大陆本机 setup 也应设这个变量，否则 `pnpm openwork:install` 可能停在 `electron` 的 `install.js`。
- `pnpm setup` 是 pnpm 自己的 shell 安装命令，**不会**跑仓库脚本。陌生人路径必须用 `pnpm run setup`。
- 中国大陆 VPS 从 `codeload.github.com` 拉 OpenWork zip 实测约 30KB/s，完整 `pnpm run setup` 可能要数十分钟。这是公开仓 P0 体验问题，不是脚本没跑。
- OpenWork 0.17.3 的 `en.ts` 把省略号写成源码转义 `\u2026`，branding 锚点必须同时匹配字面 `…`。补丁已在 `openwork-patch-text.mjs` 展开两种写法。
- 重跑 L2 不要用默认 rsync `--delete` 清掉已经下好的 `vendor/`。用：

```bash
pnpm open-source:verify -- --skip-export --keep-remote-vendor --tree /tmp/wodeappx-oss-verify-tree --phase setup,patch-idempotent
```

不要新开一台「生产同规格」机器把整份 monorepo rsync 上去。只同步 **export 后的独立树**。

## 本机桌面（L4）

VPS 通过只说明源码能在 Linux 上 bootstrap。用户可见的开源体验按 [`OSS_TEST_PACKAGE.md`](OSS_TEST_PACKAGE.md) 测。

活验收（开发机已开桌面、CDP 9823/9223，只读不点按）：

```bash
pnpm open-source:verify:l4
```

报告：`test-results/oss-verify/l4-desktop.json`。检查窗口标题、工作台壳、输入栏，以及当前视图没有桌面验证码表单。First Mile 向导契约由 `integrations/openwork/tests/wodeapp-first-mile.test.ts` 覆盖。

安装包（不覆盖正在跑的开发桌面）：

```bash
pnpm release:macos:oss -- --skip-bootstrap
```

产物 `release-oss/wodeappx-mac-arm64-<ver>-oss.dmg`。本轮只读挂载确认 `WodeAppX.app` + asar 无 `send-code` / `quick-register`，报告 `test-results/oss-verify/l4-dmg.json`。不要对正在用的开发实例装包覆盖。

## L5（GitHub 三平台）

独立仓 `diankourenxia/wodeappx` 的 `Release` workflow（`flavor=oss`）才是陌生人 CI。`workflow_dispatch` 会把三平台候选包上传到预发布 `ci-packages-<version>`，并尽力保留 2 天的 Actions artifact；它不是正式产品发版。正式 GitHub Release 仍只由 `v*` tag 触发。

**本轮已推私有仓** `47026c1`（仍 private）。L5 三平台绿：https://github.com/diankourenxia/wodeappx/actions/runs/31790434559

正式包：https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.0 （公证 Mac arm64/x64、Win exe、Linux AppImage）。预发布 `ci-packages-*` 不是对外安装包，不要发给外人。

干净树上修过的坑：branding `\u2026`；`openwork:install` 不能 `--frozen-lockfile`（补丁写入 pnpm overrides）；补丁必须同步 `session-empty-chrome` / `wodeapp-assistant-html-fence` / `wodeappx-scheduler-supervisor`；`runtimeEnabledProviderList` 导入要兼容 0.17.3 的 import 列表。OpenWork 0.17.3 的 `constants.json` 是 sidecar `v1.17.11`，动态工具补丁锚点按本机已验证的 `v1.18.16` 写；`openwork:patch` 必须改写该字段，否则 Win/Linux `build:electron` 会在 `session.ts` 的 `SessionMessage` import 上失败。Windows runner `git clone` OpenCode 源码是 CRLF，`tools.ts` 的 `\n` 锚点必须先规范化换行。`electron-builder.yml` 的 `built-in-skills` 只能出现一次，第二次 `openwork:patch` 不能在 docs 前再插一份（Linux `EEXIST` hardlink）。`defaultSessionMediaRoot()` 测试要用 `path.resolve`，Windows 会把 `/tmp/...` 收成 `C:\\tmp\\...`。Release 的 macOS runner 用 `macos-14` 且只打 `--arm64`：`macos-13` 排队拿不到机器；ARM runner 上 `--x64` 会缺 `opencode-x86_64-apple-darwin` sidecar。

相关本地证据：

- 秘密扫描：`test-results/oss-verify/l5-secret-history.json`（orphan 全历史 PASS）
- 许可证清单：`test-results/oss-verify/l5-licenses.json`（未入包）
- 签名政策：`docs/RELEASE.md` §9

## 判定

`oss-verify-*.json` 里 `verdict` 为 `PASS` 才算 L0–L3 过。某一层 `ok: false` 时先看 `notes` 和远程 `tree/oss-verify-report.json`，不要改生产容器排障。
