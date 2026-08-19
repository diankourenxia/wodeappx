# 品牌智能体配置契约（`brand-agents.json`）

> **Last updated:** 2026-07-31  
> **状态：** v1 冻结（实现与本文同步）  
> **父文档：** [`AGENTS_CONFIG.md`](AGENTS_CONFIG.md)（内置 Layer0 + 品牌 Layer1）  
> **路径：** `~/.wodeapp/brand-agents.json`（用户本机配置，**不进安装包默认内容**）  
> **Schema：** [`schemas/brand-agents.schema.json`](schemas/brand-agents.schema.json)  
> **示例：** [`examples/brand-agents.wynne.example.json`](examples/brand-agents.wynne.example.json) · [`examples/brand-agents.supor.example.json`](examples/brand-agents.supor.example.json)（详情页主任务）

---

## 1. 定位

| 是 | 不是 |
|----|------|
| 客户/本地**品牌经营智能体**的声明式配置（Layer 1） | 安装包默认侧栏（那是 Layer 0 `builtin-agents.default.json`） |
| Runtime Profile + 侧栏入口 +（可选）专用工作台 | 把品牌事实写进 system prompt |
| 本机文件，用户可审计、可复制、可关掉 | 打包进 OSS/商业包的默认侧栏项 |

品牌事实只能通过已配置的 `knowledgeScopes` + `knowledge_search` 进入模型；配置里的 `policy` 是硬规则，不是知识库正文。

**内置智能体同样是配置**，只是打进包的默认层；见父文档。

---

## 2. 文件形态

```json
{
  "$schema": "./schemas/brand-agents.schema.json",
  "version": 1,
  "agents": [ /* BrandAgent */ ]
}
```

| 字段 | 类型 | 必填 | 规则 |
|------|------|------|------|
| `$schema` | string | 否 | 编辑器提示用；运行时忽略 |
| `version` | `1` | 是 | 仅接受 `1`；其它版本整文件视为无效并回落为空列表 |
| `agents` | array | 是 | 缺省或非数组 → `[]`；元素逐条规范化 |

也允许「裸数组」输入（仅兼容）；规范化后一律写成 `{ version: 1, agents }`。

---

## 3. BrandAgent 字段

| 字段 | 类型 | 必填 | 规则 |
|------|------|------|------|
| `id` | string | 是 | 见 §4.1；全局唯一；与内置智能体 id **禁止冲突** |
| `name` | string | 是 | 1–64 字符（trim 后）；用户可见，禁止 emoji |
| `brandId` | string | 是 | 见 §4.2；知识/连接器作用域的品牌键 |
| `meta` | string | 否 | ≤80 字符；侧栏副文案 |
| `connectorScopes` | string[] | 否 | 见 §4.3；去重、保序 |
| `knowledgeScopes` | string[] | 否 | 见 §4.4；对应 `.wodeapp/knowledge/<scope>/` |
| `policy` | string[] | 否 | 每条 1–240 字符；空则用默认硬规则（§5） |
| `entryPrompt` | string | 否 | ≤500；侧栏点击预填 |
| `samplePrompt` | string | 否 | ≤4000；发给模型的能力说明（仍禁止塞品牌事实表） |
| `workbench` | `"generic"` \| `"wynne"` | 否 | 默认 `generic`；见 §4.5 |
| `enabled` | boolean | 否 | 默认 `true`；`false` 保留配置但不进侧栏 |

---

## 4. 标识与作用域规则

### 4.1 `id`

- 正则：`^[a-z][a-z0-9-]{1,62}$`（小写 kebab-case）
- 推荐后缀：`-agent`（如 `acme-brand-agent`）
- **保留内置 id（禁止占用）：** 与 Layer0 `wodeapp-builtin-agents.default.json` 的 `agents[].id` 对齐（当前：`content-orchestrator`、`feishu-agent-mcp`、`visual-generation`、`video-generation`、`script-storyboard`、`agent-infinite-canvas`、`multi-agent-collab`、`home-textile-industry-agent`、`beauty-industry-agent`、`consumer-electronics-industry-agent`、`create-agent`）。**默认启用**：`visual-generation`、`video-generation`、`multi-agent-collab`；画布 / 短剧 `enabled: false`，可从侧栏「添加智能体」钉回；其余仍占坑位。
- 重复 `id`：保留**第一条**，后续丢弃并记 warning

### 4.2 `brandId`

- 正则：`^[a-z][a-z0-9-]{0,31}$`
- 用于 Runtime Profile `brand="..."` 与知识目录约定；不要用展示名

### 4.3 `connectorScopes`（白名单）

当前允许：

`shopify` · `feishu` · `dingtalk` · `wecom`

- 未知值：丢弃并 warning（不整条作废）
- 空数组合法：表示本品牌暂无连接器，只做知识/对话

### 4.4 `knowledgeScopes`

- 每项：`^[a-z][a-z0-9_-]{0,31}$`
- 不得含 `/` `..`；映射到工作区 `.wodeapp/knowledge/<scope>/`
- 推荐与 `brandId` 对齐（如 `wynne`）

### 4.5 `workbench`

| 值 | 行为 |
|----|------|
| `generic`（默认） | 侧栏点击 → 开对话并绑定 Runtime Profile |
| `wynne` | 打开专用 Wynne 工作台 UI（遗留客户 demo） |

约束：`workbench: "wynne"` 时，`id` 必须为 `wynne-brand-agent` **或** `brandId` 必须为 `wynne`；否则降级为 `generic` 并 warning。  
新品牌一律用 `generic`；不要为每个客户加专用 workbench 枚举。

---

## 5. 默认 policy（未配置时注入）

1. Never invent store data, connection state, prices, inventory, orders, or brand policy.  
2. Read operations may run directly. Any external write must use the existing preview and approval gate.  
3. Protect customer and order privacy, especially in group-channel responses.

用户自定义 `policy` 会**整体替换**默认值（不会自动合并）。建议保留上述三条再追加。

---

## 6. 运行时行为

1. 启动：Electron 读 `~/.wodeapp/brand-agents.json` → 规范化 → 同步到渲染进程缓存。  
2. 侧栏：「我的智能体」列表 = 内置能力（能力/行业分组）∪ **enabled 品牌配置**（品牌分组）。  
3. Runtime Profile：仅由当前启用的品牌配置生成；无配置则 profile 注册表为空。  
4. 知识：模型须 `knowledge_search` + `profile=<id>`；禁止把 SKU/价格写进 `samplePrompt`。  
5. 写操作：仍走既有预览/审批；配置不能绕过。

---

## 7. 校验语义

实现提供「规范化 + 校验报告」：

| 级别 | 含义 |
|------|------|
| error | 整文件或整条 agent 不可用（如 version≠1、id 非法、与内置冲突） |
| warning | 条目仍可用但已修正/丢弃部分字段（未知 connector、重复 id、workbench 降级） |

保存 IPC（`saveBrandAgents`）应对 error 拒绝写入；warning 可写入规范化结果。

---

## 8. 安全与分发

- 安装包 / OSS：**默认不带任何品牌 agents**；打包跑 `scripts/filter-local-brand-agents.mjs`。  
- 客户配置只留在 `~/.wodeapp/brand-agents.json`；仓内只保留 **example**，gitignore + open-source check 拦截真实文件。  
- 配置可含经营策略文案，但**不要**写入 API Key、密码、完整订单数据。  
- `~/.wodeapp/` 文件权限保持 `0600`（与 `config.json` 一致）。
- 本机接入：见 §10；调试包保留品牌 runtime 用 `WODEAPPX_KEEP_LOCAL_BRAND_AGENTS=1`。

---

## 9. 版本演进

| version | 说明 |
|---------|------|
| `1` | 当前：侧栏 + Runtime Profile + generic/wynne workbench |

破坏性变更必须升 `version` 并提供迁移说明；旧版未知 version → 安全回落为空列表（不半解析）。

---

## 10. 本地接入清单

1. 复制示例：  
   `cp wodeappx/docs/examples/brand-agents.wynne.example.json ~/.wodeapp/brand-agents.json`  
2. 按客户改 `id` / `name` / `brandId` / scopes（新客户用 `workbench: "generic"`）。  
3. 在对应工作区准备 `.wodeapp/knowledge/<scope>/`。  
4. 重启桌面端，侧栏应出现该品牌项。  
5. 自测：未配置连接器时不得谎称「已连接」；知识无命中须如实说明。
