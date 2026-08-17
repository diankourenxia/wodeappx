# 智能体配置体系（内置 + 品牌）

> **Last updated:** 2026-07-31  
> **状态：** v1  
> **子契约：** 品牌层见 [`BRAND_AGENTS_CONFIG.md`](BRAND_AGENTS_CONFIG.md)

---

## 1. 一句话

**内置智能体也是配置**——只是打进安装包的默认层；品牌智能体是用户本机层。两边同一家族：声明式 JSON → 规范化 → 侧栏 / Runtime Profile / 工作台。

```text
Layer 0  安装包默认   wodeapp-builtin-agents.default.json   （随版本发布）
Layer 1  本机品牌     ~/.wodeapp/brand-agents.json           （用户/客户，默认真空）
（预留） Layer 2  本机覆盖   ~/.wodeapp/agents.override.json      （禁用/排序，未做）
```

合并结果 = 启用的 Layer0 ∪ 启用的 Layer1（Layer1 **不得**占用 Layer0 的 id）。

---

## 2. 分层职责

| 层 | 谁维护 | 典型内容 | 分发 |
|----|--------|----------|------|
| 0 builtin | 产品发版 | 图片/视频/画布/短剧/创建/飞书入口… + **行业 demo**（家纺/美妆/数码 3C） | 写进包 |
| 1 brand | 客户/本地 | Wynne 等品牌经营智能体 | 仅本机文件 |
| 2 override | 用户（预留） | 关掉某个内置、调顺序 | 本机 |

运行时门禁（如飞书需 setup skill）仍在代码里，是对配置条目的 **启用条件**，不是第二套智能体定义。

---

## 3. 共同字段（两层都有）

| 字段 | 含义 |
|------|------|
| `id` | 稳定标识（kebab-case） |
| `name` / `meta` | 侧栏展示 |
| `entryPrompt` / `samplePrompt` | 入口与能力说明 |
| `enabled` | 配置存在但可不展示 |
| `version` | 文件格式版本，当前均为 `1` |

### Layer 0 追加

| 字段 | 含义 |
|------|------|
| `kind` | `capability` \| `orchestrator` \| `integration` \| `workflow` \| `industry` \| `brand` |
| `abilityKind` | 能力项目匹配：`image` / `video` / … |
| `defaultUrl` | 未 bootstrap 时的官方工作台兜底 |
| `runtimeProfileId` | 行业/品牌对话绑定的 Runtime Profile id |
| `autoSend` | 点击是否自动发送 |

侧栏分组：`capability`+`integration` → **能力**；`industry` → **行业**；`brand`（含 Layer1 转换）→ **品牌**。

### Layer 1 追加

| 字段 | 含义 |
|------|------|
| `brandId` | 品牌键 |
| `connectorScopes` / `knowledgeScopes` | 连接器与知识范围 |
| `policy` | Runtime 硬规则 |
| `workbench` | `generic` \| `wynne` |

真相源文件：

- Layer 0：`integrations/openwork/wodeapp/wodeapp-builtin-agents.default.json`
- Layer 1：`~/.wodeapp/brand-agents.json`（示例 `docs/examples/brand-agents.wynne.example.json` / `brand-agents.industry.example.json`）

---

## 4. 不变式

1. **安装包默认侧栏 = Layer0 启用项**；可含通用**行业 demo**，**不含客户品牌**（如 Wynne）。  
2. **Layer1 禁止占用 Layer0 id**（校验 error）。  
3. **品牌事实不进 samplePrompt**；走 knowledge_search。  
4. **改内置默认** = 改 Layer0 JSON + 发版；不要在业务代码里再堆一份数组。  
5. **稳定 id 常量**（如 `feishu-agent-mcp`）可留在 TS 供路由引用，但**文案与能力说明以 JSON 为准**。  
6. 本机若缺少 `brand-agents.json`，Electron 可种子写入 Wynne 示例（仅本机文件，不进 OSS Layer0）。  
7. **行业智能体 ≠ 侧栏多挂一个 id**：正确模型是整机换皮（自进化示例 / 未来 Skill）。`wodeappx-beauty-industry` + `edition.manifest.json` 是样板；侧栏不展示 `kind===industry`。家纺/3C/美妆 Layer0 条目默认 `enabled: false`，美妆 Runtime Profile 仍由 pack 注册并作为新会话默认。换皮后必须过对比度验收，见 [`UI_CONTRAST.md`](UI_CONTRAST.md)。

---

## 5. 加载顺序

1. 读并规范化 Layer0（失败 → 空，产品应保证发版文件合法）。  
2. 读并规范化 Layer1（失败/缺文件 → 空）。  
3. 应用运行时门禁（飞书 ready、短剧开关等）。  
4. 渲染侧栏；品牌项挂 Runtime Profile。

---

## 6. 本地 vs 提交 / 打包

| 场景 | 品牌智能体 |
|------|------------|
| 本机开发 | `~/.wodeapp/brand-agents.json`（可从 `docs/examples/brand-agents.wynne.example.json` 或 `brand-agents.industry.example.json` 复制/合并） |
| git 提交 | **禁止**提交真实 `brand-agents.json`（已 gitignore + open-source check） |
| 安装包 | `scripts/filter-local-brand-agents.mjs` 剥掉打进 runtime 的 Wynne agent；Layer0 不得含品牌 id |

调试包若需保留本地品牌 runtime：`WODEAPPX_KEEP_LOCAL_BRAND_AGENTS=1 pnpm release:macos:oss`。打包后若还要本机开发 Wynne，再跑一次 `pnpm openwork:patch`。

## 7. 演进

| 下一步 | 说明 |
|--------|------|
| 补齐家纺 / 3C 适配包 | 复制美妆 pack 模式（policy + playbook + skill） |
| `agents.override.json` | 用户禁用/置顶内置项，不改包 |
| 设置页编辑器 | 可视化改 Layer1，保存走现有 IPC |
| 远程目录 | 企业下发品牌包（仍落成本机 JSON） |

破坏性变更升各自文件的 `version`，并更新本页与子契约。
