# WodeAppX（wodeappx）桌面端文档

> **开源对外：WodeAppX**；仓内 codename `wodeappx`。默认产品名就是 WodeAppX。
> 桌面端文档索引。产品入口见 [`../README.md`](../README.md)。  
> 平台契约（API / 积分 / MCP）以 monorepo [`docs/README.md`](../../docs/README.md) 为准，勿在此复制 URL 表。

## 现行文档

| 文档 | 说明 |
|------|------|
| [`DESKTOP.md`](DESKTOP.md) | 桌面里程碑、preview-token、Local Chat、发布要点 |
| [`HANG_TRACE.md`](HANG_TRACE.md) | busy 空壳挂起跨层追踪（`[hang-trace]` / TTFT / bug-report dump） |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 桌面架构与模块边界 |
| [`CAPABILITIES.md`](CAPABILITIES.md) | 能力面：Skill / 模型 / MCP / Computer Use |
| [`AGENT_MINIMAL_CONTEXT.md`](AGENT_MINIMAL_CONTEXT.md) | Agent 出图/视频分轨与最小上下文契约 |
| [`../../.agents/memories/README.md`](../../.agents/memories/README.md) | 用户习惯记忆（`USER.md` / `MEMORY.md`，学 Hermes） |
| [`AGENT_CAPABILITY_TESTING.md`](AGENT_CAPABILITY_TESTING.md) | Agent 能力路由与测试门禁（P0 不变式；含 A17 sticky 禁假模型） |
| [`../integrations/openwork/TOOL_DISCOVERY.md`](../integrations/openwork/TOOL_DISCOVERY.md) | Deferred/`tool_search`/sticky lease；无假模型、默认不烧积分验收 |
| [`LOCAL_XLS_PRODUCT_IMPORT_TEST_PLAN.md`](LOCAL_XLS_PRODUCT_IMPORT_TEST_PLAN.md) | 本地 `.xls` + 图片理解 + 商品入库的分层回归方案 |
| [`TOOL_EXECUTION.md`](TOOL_EXECUTION.md) | 工具注册、统一执行入口、审批矩阵与 Hook 边界 |
| [`AGENT_RELIABILITY_CONTRACT.md`](AGENT_RELIABILITY_CONTRACT.md) | Item/Turn/Goal/Run 可靠性契约（冻结）；`executeWithContract` / 可恢复失败 |
| [`RUNTIME_PERFORMANCE_REMEDIATION.md`](RUNTIME_PERFORMANCE_REMEDIATION.md) | 桌面卡顿实测、根因链、运行时整改、OpenCode v1/v2 兼容边界、收益、测试、灰度与回滚 |
| [`SELF_EVOLUTION_DESIGN.md`](SELF_EVOLUTION_DESIGN.md) | 对话内自修改、验证门禁、A/B 版本切换与回滚的设计草案 |
| [`examples/skin-theme-evolve-examples.md`](examples/skin-theme-evolve-examples.md) | 外观自进化示例提示词（萌宠 / 可爱风 / 水墨）；非主题引擎 |
| [`SHOWCASE_PLAN.md`](SHOWCASE_PLAN.md) | 推广 Showcase 方案（四幕剧本、素材/验收、分期落地，评估用） |
| [`AGENTS_CONFIG.md`](AGENTS_CONFIG.md) | 智能体配置体系：内置 Layer0 + 品牌 Layer1 |
| [`BRAND_AGENTS_CONFIG.md`](BRAND_AGENTS_CONFIG.md) | 品牌智能体 `~/.wodeapp/brand-agents.json` 配置契约（字段、规则、校验） |
| [`UI_CONTRAST.md`](UI_CONTRAST.md) | 皮肤对比度硬门槛（WCAG AA）与自动验收脚本 |
| [`RELEASE.md`](RELEASE.md) | 桌面发布 / 打包；对外下载页 `/wodeappx`（兼容旧路径 `/xiaolingtong`） |
| [`OPEN_SOURCE_PLAN.md`](OPEN_SOURCE_PLAN.md) | 开源目标、缺口与路线图（**现行规划**，非归档） |
| [`../TRADEMARK.md`](../TRADEMARK.md) | 开源产品名 / Logo；Fork 不得冒充官方发行 |
| [`../SECURITY.md`](../SECURITY.md) | 漏洞私密报告与响应时限 |
| [`EDITIONS.md`](EDITIONS.md) | 发行品牌 WodeAppX vs 工作台壳（supor/beauty） |
| [`OSS_TEST_PACKAGE.md`](OSS_TEST_PACKAGE.md) | WodeAppX 测试包：默认工作区 + 能力项目怎么打、怎么测 |
| [`OSS_VERIFY.md`](OSS_VERIFY.md) | 开源陌生人路径：VPS Docker 导出 / 契约 / setup / 补丁幂等 |
| [`LOCAL_KEY_INVOKE.md`](LOCAL_KEY_INVOKE.md) | 能力工作台与对话同一条模型列表/调用；未登录走本机 Key |
| [`PRODUCT_HUNT_LAUNCH.md`](PRODUCT_HUNT_LAUNCH.md) | Product Hunt 英文上架文案、素材清单与发布前检查 |
| [`WODEAPP_PLATFORM_BOUNDARY.md`](WODEAPP_PLATFORM_BOUNDARY.md) | 开源客户端 vs 私有平台边界（登录、凭证、吊销） |
| [`I18N.md`](I18N.md) | 桌面多语言策略与核心文案覆盖门禁 |
| [`SECURITY_EXCEPTIONS.md`](SECURITY_EXCEPTIONS.md) | 已知安全审计例外与到期策略 |
| [`../PRIVACY.md`](../PRIVACY.md) | 隐私说明（本地优先 / BYOK / 可选云端） |

## 集成说明

| 路径 | 说明 |
|------|------|
| [`../integrations/README.md`](../integrations/README.md) | 集成总览 |
| [`../integrations/openwork/README.md`](../integrations/openwork/README.md) | OpenWork 插件 / MCP |
| [`../integrations/opencode/README.md`](../integrations/opencode/README.md) | OpenCode MCP 连接（sidecar；主产品轨为 OpenWork） |

## 归档

历史里程碑 / 已收敛方案见 [`archive/README.md`](archive/README.md)。
