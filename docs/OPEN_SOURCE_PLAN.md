# WodeAppX 开源目标、架构与路线图

> 状态基线：**2026-08-17**。本文把“已经实现”“开源阻塞项”和“产品路线图”分开描述。
> 仓：[github.com/diankourenxia/wodeappx](https://github.com/diankourenxia/wodeappx)（**当前 PRIVATE**，未准备好前不公开；Apache-2.0）。
> 日常开发在 monorepo `wodeappx/`；私有镜像用 `pnpm open-source:export` / `export-standalone-repo.mjs` 导出同步。
> 陌生人路径验收：[`OSS_VERIFY.md`](OSS_VERIFY.md)（`pnpm open-source:verify`）。

## 0. P0 实证快照（2026-08-12）

| 项 | 状态 | 证据 |
|---|---|---|
| 独立仓可访问 | ✅ 私有 | `diankourenxia/wodeappx` **private**（2026-08-12 改）；未准备好不公开 |
| `pnpm open-source:check`（monorepo） | ✅（1 warning：OpenWork lock 版本号与包版本不一致） | 本地跑过 |
| 导出脚本 orphan 树 | ✅ | `export-standalone-repo.mjs --init-git` → `wodeappx-standalone`；无 vendor |
| 仓内容新鲜度 | ✅ 已同步 | 2026-08-17 orphan `652ac1c` force-push 到 private `main`（含 TRADEMARK / Logo / `executableName` / install-smoke） |
| main 分支保护 | ❌ | 私有阶段可后补 |
| Windows/Linux CI 构建产物 + 三平台真机安装 | ✅ 安装启动已验 | CI [31790434559](https://github.com/diankourenxia/wodeappx/actions/runs/31790434559) 绿。Linux：腾讯云 TencentOS 解包 AppImage + xvfb，CDP 标题 WodeAppX、工作台壳在、无验证码（`test-results/oss-verify/linux-install-qa.json`）。Windows：GHA `windows-latest` NSIS `/S` 后启动，CDP 标题 WodeAppX（[run 31988811038](https://github.com/diankourenxia/wodeappx/actions/runs/31988811038)）。安装目录/Linux 二进制仍叫 `@openworkdesktop`，已补 `executableName: WodeAppX` 待重打 |
| SBOM / 依赖许可证自动生成入包 | ✅ 本机 OSS DMG | `pnpm` 清单 1059 包 / 0 Unknown；`khroma@2.1.0` override=MIT。打进 `Contents/Resources/licenses/` |
| 签名 / notarization 策略文档化 | ✅ macOS 已公证；Windows 仍无 Authenticode | 本机 Developer ID `yao hui (88B8TA3MKP)`。`release-oss/wodeappx-mac-arm64-1.0.0-oss.dmg`：`.app` `spctl` = Notarized Developer ID；`.app` 与 DMG 票已钉。DMG 文件本身未签名（`spctl --type install` 拒）。政策 `docs/RELEASE.md` §9 |
| 完整 git 历史秘密扫描 | ✅ 独立仓 orphan 1 commit | `test-results/oss-verify/l5-secret-history.json` PASS |
| 干净 Linux 陌生人 setup | ✅ L0–L3 PASS（腾讯云隔离 Docker） | 报告 `wodeappx/test-results/oss-verify/vps-setup.json`。L2：`pnpm run setup`；L3：两次 patch 哈希一致。踩坑：勿用 `pnpm setup`；CN 勿 apt-get；locale `\u2026`；干净 zip 与漂移 vendor 锚点不同；Electron 须 `ELECTRON_MIRROR` |
| L4 桌面 First Mile | ✅ 干净安装活测；公证包复测 | 14:22 未公证包：空 Key 自动弹出「开始使用」，DeepSeek 本机 Key 发「你好」有回复。17:50 公证包：asar/licenses/Gatekeeper PASS；无验证码；「开始使用」可打开，Chrome 步「安装调试 / 忽略」。自动弹出被 leftover `wodeapp/wode/*` + provider `isPending` 挡住（源码已改为只等 `isFetching`） |

**本轮已落地（monorepo → 私有仓）**：
- 仓可见性改为 private；准备好再公开
- 冷启动 BYOK 引导 = 本机 Key only
- 导出默认 `pnpm dev/build` = `WODEAPPX_EDITION=oss`
- OSS edition 账号面隐藏「充值/登录账户」；页脚隐藏「登录云端」
- 本机 sidecar 可选云模型（见 `DESKTOP_LOCAL_RUNTIME.md`）
- 手机端入口暂隐藏（`WODEAPP_MOBILE_REMOTE_ENABLED=false`）

## 1. 项目定义

WodeAppX 是一个本地优先、可扩展的 AI 工作流桌面。它让个人和组织把 Skill、模型、MCP/工具、本地数据和外部平台组合成适合自己的完整流程，并在执行时看到权限、进度、产物、成本与失败位置。

它解决的不是“市场里缺少更多聊天机器人”，而是以下问题：

- 单个 Agent 很会聊天，却无法稳定复现一条跨系统业务流程；
- Skill、工具和模型被藏在对话背后，用户无法理解或调整；
- 多 Agent 全程互相调用成本高，错误边界和责任不清楚；
- 个人工具、公司平台和本地数据难以在同一权限模型下组合；
- 执行结果有了，但缺少运行轨迹、成本、版本和可复用配置。

## 2. 产品原则

1. **流程优先于角色**：先定义输入、步骤、判断、工具、输出与恢复策略，再决定是否需要人格化 Agent。
2. **一个调度模型，按需专业模型**：调度模型负责意图理解、计划和歧义；确定性节点不调用模型；专业模型只在节点需要时出现。
3. **Skill 是可执行契约**：Skill 不只是长 Prompt，必须声明输入、输出、能力、权限、版本和可验证结果。
4. **模型可替换，数据不被锁定**：工作流引用能力和策略，允许用户替换 Provider/模型并迁移配置。
5. **本地优先，Cloud 可选**：开源版本无需登录即可运行；云能力是显式扩展，不是隐藏依赖。
6. **可视化不是装饰**：图必须来自真实运行定义和事件，不维护另一份只用于展示的流程。
7. **默认最小权限**：凭证留在连接器边界，不进入模型上下文；危险操作可预览、审批、撤销和审计。
8. **如实标注状态**：演示、实验、已交付、稳定接口和路线图必须明确区分。

## 3. 目标用户与首批场景

| 用户 | 首要需求 | 首批流程 |
|---|---|---|
| 独立创作者/运营 | 降低重复内容生产成本 | 素材读取 → 文案/图片/视频 → 审核 → 发布包 |
| 开发者 | 在本地工作区安全使用 AI | 理解任务 → 文件/终端/浏览器 → 测试 → 变更说明 |
| 电商团队 | 连接商品与内容平台 | 商品数据 → 视觉素材 → 多渠道内容 → 结果回写 |
| 企业自动化团队 | 接入既有系统并保留治理 | 表单/消息触发 → 审批 → 执行 → 审计/通知 |

开源首发不追求覆盖所有行业。应先用 3–5 条端到端模板证明：同一套运行时可以跨模型、Skill 和平台稳定执行。

## 4. 当前能力盘点

### 已实现

- 基于 OpenWork 的桌面工作区、会话、文件、终端、浏览器、Computer Use、权限和产物面板；
- BYOK Provider、动态模型选择、MCP、Skill、命令与扩展；
- WodeApp 数字资产、图片/视频工作流、浏览器控制、Shopify 等集成；
- Agent 能力契约与测试矩阵、独立捕获引擎；
- OSS 默认与 WodeApp Cloud 可选补丁的代码路径；
- 固定 OpenWork commit 与 archive SHA-256；
- 从干净上游源码可重复生成 WodeAppX vendor，连续 patch 结果一致；
- 使用 pnpm 9.15 的干净依赖安装、前后端 TypeScript 检查和 macOS Electron 生产构建已通过；
- Apache-2.0、NOTICE、贡献、安全和行为规范基础文件。

### 开源发布阻塞项（P0）

| 缺口 | 风险 | 完成标准 | 2026-08-11 |
|---|---|---|---|
| 独立仓库尚未验证公开可访问 | 用户无法 Fork/Issue/下载 | 准备好后再改 public；保护分支与安全报告开启 | **现 private（有意）** |
| 公开仓落后于 monorepo | 用户拿到的不是最新开源体验 | 定期 `open-source:export` 后推送；含 BYOK 冷启动 | **仍 private**。2026-08-17 已 export：`TRADEMARK.md`、`branding/wodeappx-logo-*`、`executableName: WodeAppX`、`install-smoke.yml` 均在 `652ac1c` |
| Windows/Linux CI 与三平台真机安装尚未跑完 | macOS 干净生产构建通过不代表所有安装包可用 | Windows/Linux CI 通过；至少三平台各一台真机安装启动 | ✅ Linux 腾讯云 xvfb + Windows GHA NSIS 均启动出 WodeAppX。见 §0 |
| 第三方许可证清单未自动生成 | 二进制分发可能漏署名 | 发布包附 SBOM/依赖许可证报告，无 `ee/` | ✅ 本机 OSS DMG 含 `licenses/third-party-licenses.json`（1059 包，`khroma@2.1.0`=MIT override，0 Unknown） |
| 发布签名与密钥策略未定 | 系统告警、供应链风险 | macOS notarization、Windows signing 的密钥保管与轮换文档化 | ✅ 政策 `docs/RELEASE.md` §9。macOS Developer ID 已公证；Windows Authenticode 仍无 |
| 首发版本与支持平台未冻结 | 承诺不清，测试范围漂移 | 明确首发矩阵、已知问题和回滚方式 | ✅ 见下节「首发矩阵（2026-08-14）」 |
| 仓库历史秘密扫描未执行 | 当前文件干净不代表历史干净 | 对拟公开仓库完整历史扫描，问题凭证先轮换再清理 | ✅ 工作区 `pnpm open-source:check` PASS。独立仓现 orphan `652ac1c`（1215 文件 check PASS）。前一轮 `5ff55aa` 全历史扫描 PASS：无密钥命中 / 无 `.env` / 无 `vendor/` / 无 `ee/`。报告 `test-results/oss-verify/l5-secret-history.json` |

### 产品路线图缺口

- 当前可管理 Skill 和扩展，但还没有从真实定义生成的 Skill/工具/模型流程图；
- 当前有会话和工具事件，但缺少统一的节点级 run trace、成本、重试与回退视图；
- 模型可选择，但缺少工作流节点级路由策略、预算和质量门槛；
- 企业连接器缺少统一凭证仓、作用域、审批策略和审计导出；
- 流程还不能以稳定、版本化的 manifest 在团队间安全分享。

## 5. 目标架构

```text
触发器 / 用户输入
        |
        v
调度层：意图、计划、预算、权限检查
        |
        v
工作流运行时：DAG / 状态机 / 重试 / 审批 / 恢复
    |           |            |
    v           v            v
  Skill       工具/MCP      专业模型
    |           |            |
    +-----------+------------+
                |
                v
      产物、平台回写、运行轨迹、成本
```

### 5.1 调度层

“一个调度模型”不是永远只允许一个模型，而是默认只让一个模型承担开放式判断，避免多个模型反复讨论。调度层输出结构化计划；运行时负责确定性执行。

调度决策至少包含：

```ts
type RouteDecision = {
  capability: string;
  selectedProvider?: string;
  selectedModel?: string;
  reason: string;
  estimatedCost?: number;
  budgetRemaining?: number;
  fallback?: string[];
  requiresApproval?: boolean;
};
```

优先级建议：确定性规则 → 便宜且满足能力的模型 → 用户固定模型 → 质量回退模型。涉及发布、付款、删除或外部发送时，成本最低不能覆盖安全策略。

### 5.2 Skill 契约

建议引入版本化 `skill.manifest.json`，并保持 `SKILL.md` 作为人和模型可读的操作说明：

```json
{
  "schemaVersion": 1,
  "name": "product-content-pipeline",
  "version": "1.0.0",
  "inputs": {},
  "outputs": {},
  "capabilities": ["assets.read", "image.generate", "publish.prepare"],
  "permissions": ["workspace.read", "network:wodeapp.cn"],
  "steps": [],
  "tests": []
}
```

同一个 manifest 同时驱动运行、可视化、权限预览和测试，避免 UI 图与真实执行漂移。

### 5.3 工作流与运行事件

工作流应采用版本化 DAG/状态机，节点类型最少包括：input、rule、skill、tool、model、approval、transform、output。循环必须有次数或预算上限。

统一事件建议：`run.started`、`node.started`、`permission.requested`、`tool.called`、`model.called`、`artifact.created`、`node.failed`、`node.retried`、`run.completed`。每条事件带 run、workflow、node、版本、时间、耗时、token/费用和脱敏错误。

### 5.4 连接器边界

连接器分为个人、本地/自托管、企业三类，使用同一接口：discover、authorize、test、invoke、revoke。凭证由连接器宿主持有，只向模型暴露经过裁剪的 schema 和结果。

企业版能力可以围绕开源运行时提供 SSO、组织策略、集中凭证、审批、审计和托管连接器，但开源版必须保留自定义 MCP/HTTP/本地连接器能力，不能人为锁死基础互操作。

## 6. 可视化设计

第一版不急于做自由画布编辑器，先做真实、可信的只读运行图：

- 左侧为步骤与依赖；
- 节点展示 Skill/工具/模型、状态、耗时和估算费用；
- 点击节点查看输入输出的脱敏摘要、权限和重试；
- 失败节点给出“从此处重试”“更换模型”“人工补充输入”；
- 运行前显示将访问的数据、外部平台和预算上限。

只读图稳定后，再开放拖拽编辑、分支、循环、子流程和模板发布。这样可以先验证运行时数据模型，避免先造一个漂亮但无法可靠执行的画布。

## 7. 路线图与验收

### P0：可放心公开源码

- 固定并校验上游源码，干净目录可重建且 patch 幂等；
- OSS 默认不登录、不注入 Cloud、不依赖 monorepo 父目录；
- License、NOTICE、安全、贡献、行为规范齐全；
- 开源检查、CI、全平台构建、安装 smoke、SBOM 和许可证报告；
- 导出脚本不复制 vendor、`ee/`、凭证、测试证据和构建产物；
- 公开仓库、Issue/PR 模板、分支保护、发布与漏洞报告流程就绪。

### P1：可观察的完整流程

- 从真实执行事件生成只读流程图；
- 节点级状态、耗时、token/费用、权限、输入输出摘要；
- 一个调度模型 + 确定性节点的首个正式运行策略；
- 节点级 Provider/模型选择、预算上限、超时与 fallback；
- 3–5 条端到端参考流程及可重复评测。

验收：用户能回答“刚才执行了什么、为什么用这个模型、访问了什么、花了多少、在哪失败、能否从失败处继续”。

### P2：可编辑和可分享

- 可视化编辑 DAG、分支、审批与子流程；
- Skill manifest 版本、输入输出 schema、权限和测试；
- 流程导入导出、版本锁定、差异查看与迁移；
- 个人连接器和团队连接器统一管理；
- 流程模板带依赖检查，不携带凭证和私有数据。

### P3：组织治理与生态

- SSO、角色、组织策略、集中凭证和审计导出；
- 团队 Skill/流程包、签名、来源证明与供应链验证；
- 在运行时和安全模型稳定后再考虑公共市场；
- 市场评价以可复现测试、权限透明和维护状态为核心，而不是 Agent 数量。

## 8. 开源与商业边界

建议保持开源：桌面运行时、Skill/工作流 schema、基础可视化、BYOK、自定义 MCP/连接器、本地运行轨迹和导入导出。

可作为商业服务：托管模型与积分、企业 SSO/策略、集中凭证、合规审计、托管连接器、团队协作、云同步和支持服务。商业能力通过公开接口扩展，不修改开源默认行为来制造依赖。

## 9. 发布门禁

每次发布必须满足：

1. `pnpm open-source:check` 通过；
2. 从锁定上游干净 bootstrap，patch 两次结果一致；
3. 单元、能力契约与 capture-engine 测试通过；
4. macOS、Windows、Linux CI 构建通过；
5. 真机安装、首次启动、BYOK 对话、工具审批、升级兼容 smoke 通过；
6. 源码与产物秘密扫描、依赖漏洞、SBOM、许可证清单通过；
7. Release notes 标注 breaking changes、已知问题、上游版本和校验值；
8. 安装包签名，更新源只指向 WodeAppX 官方发布。

## 10. 衡量指标

- 首次成功运行时间；
- 完成一条参考流程所需人工干预次数；
- 每条成功流程的模型成本与模型调用次数；
- 确定性节点占比、重试率、失败恢复率；
- 用户自定义 Provider、Skill、连接器和流程的成功率；
- Issue 首次响应、修复周期、贡献者留存和版本升级成功率。

降低成本的正确指标不是“调用模型越少越好”，而是“每个成功结果的总成本更低，同时质量、可解释性和恢复能力不下降”。

## 11. 首发矩阵（2026-08-14）与负责人已冻结项

**仓库保持 private。** 未再说「改 public」之前，不要把 `diankourenxia/wodeappx` 改公开。

| 平台 | 首发承诺 | 本轮实证 | 已知问题 |
|---|---|---|---|
| macOS arm64 | 对外主安装包 | 本机公证 `release-oss/wodeappx-mac-arm64-1.0.0-oss.dmg`（266MB，17:56）。`.app` Gatekeeper = Notarized Developer ID | DMG 文件本身未签名；CI 那个 237MB mac DMG **没公证**，不要发给外人 |
| Windows x64 | 对外安装包 | NSIS `/S` 在 windows-latest 装到 `%LOCALAPPDATA%\Programs\@openworkdesktop\WodeAppX.exe`，CDP 标题 WodeAppX（[31988811038](https://github.com/diankourenxia/wodeappx/actions/runs/31988811038)） | **unsigned**。安装目录名 `@openworkdesktop`，下轮包用 `executableName: WodeAppX` |
| Linux x64 | 对外安装包 | 腾讯云解包 AppImage，xvfb 启动，CDP 壳/无验证码 PASS（`linux-install-qa.json`） | 二进制仍叫 `@openworkdesktop`，下轮包改名 |

回滚：不要覆盖 `/Applications` 里正在用的桌面；OSS 验收用 `/tmp` 拷贝 + 独立 `userData`。失败则沿用上一份 `release-oss/` DMG。

### 已冻结（2026-08-14，负责人）

| 项 | 决定 |
|---|---|
| 对外品牌 | **WodeAppX** / `wodeappx` |
| Logo | 黑底白字 WodeApp + lime **X** lockup。源文件 `branding/wodeapp-icon-source.png`；README 用 `branding/wodeappx-logo-180.png`。政策 [`TRADEMARK.md`](../TRADEMARK.md) |
| Fork | 代码 Apache-2.0 可改可发；官方名 / Logo / 安装包名不可冒充 |
| 安全报告 | 仓库 owner；GitHub private advisory；ack 2 天、分诊 7 天、高危目标 14 天。见 [`SECURITY.md`](../SECURITY.md) |
| Cloud / 企业边界 | OSS = `wodeappx` 客户端；账号/积分/支付/网关留私有 monorepo。不开 `/ee`，不新开 platform/deploy 仓。见 [`WODEAPP_PLATFORM_BOUNDARY.md`](WODEAPP_PLATFORM_BOUNDARY.md) |
| 公开日期 | **未定**。安装包可先走官网/Gitea；仓仍 private |
| 分支保护 | 私有免费仓 GitHub 不提供；公开后再开。导出仍需允许 orphan force-push |

### 仍须本机证书（脚本做不了）

- Windows **Authenticode 证书本身**（个人 OV 或 Azure Trusted Signing）。CI 已接 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`；secret 空则仍打 unsigned。
- 你明确说「改 public」之后再公开仓、开 Security Advisories 表单、补分支保护
