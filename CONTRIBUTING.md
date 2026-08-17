# Contributing to WodeAppX

感谢你帮助 WodeAppX 成为一个真正可组合、可审计、可自托管的 AI 工作流桌面。

## 开发环境

需要 Node.js 22、pnpm 9.15、Bun 1.3.9+、Go 1.23，以及上游 OpenWork 要求的桌面构建工具。

```bash
pnpm run setup
pnpm dev
```

`pnpm run setup` 会下载 `openwork.lock.json` 固定的 OpenWork 提交、校验 SHA-256、应用 WodeAppX 改动并安装依赖。`vendor/openwork/` 是生成目录，不提交到 Git。

## 修改位置

- WodeAppX 自有能力放在 `integrations/`、`capture-engine/` 或 `scripts/`。
- 对上游文件的完整覆盖放在 `integrations/openwork/fork/`，并在 `apply-openwork-integration.mjs` 中显式登记。
- 小而稳定的上游改动可写成可重复执行的 transform。
- 不要直接把 `vendor/openwork/` 当作源代码提交；直接修改会在下一次 bootstrap 时丢失。
- OSS 默认路径必须保持 BYOK/local-first；WodeApp Cloud 只能通过显式 `pnpm dev:cloud` 启用。

## 提交前检查

```bash
pnpm open-source:check
pnpm open-source:verify:contract
pnpm run openwork:bootstrap -- --force
pnpm openwork:patch
pnpm openwork:patch
pnpm release:check
pnpm test:agent-capabilities
(cd capture-engine && go test ./...)
```

连续执行两次 patch 后生成结果必须一致。模型列表必须来自动态接口或用户 Provider 配置；Skill 与工具调用应有权限边界、运行记录和可解释的成本信息。

## 更新 OpenWork

更新上游不是简单改分支名。Pull Request 必须同时提交：

1. `openwork.lock.json` 中完整 commit、对应版本和 archive SHA-256；
2. 对 fork 覆盖文件与 transform 的兼容调整；
3. 干净目录 bootstrap、双次 patch、测试和构建证据；
4. 上游许可证边界复核，确认没有引入 `ee/` 或其他非开源代码。

## Pull Request

保持单一主题，说明用户场景、实现边界、测试结果、平台差异和安全影响。行为变更请补测试与文档。建议使用 Conventional Commits，如 `feat:`、`fix:`、`docs:`、`test:`。

提交贡献即表示你同意按 [Apache License 2.0](LICENSE) 授权该贡献，并确认你有权提交相关代码和素材。

漏洞请走 [SECURITY.md](SECURITY.md)，不要开公开 Issue。Fork 可以改代码，但不能把官方产品名 / Logo 当成自己的发行品牌，见 [TRADEMARK.md](TRADEMARK.md)。
