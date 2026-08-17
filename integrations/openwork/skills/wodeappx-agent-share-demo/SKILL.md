---
name: wodeappx-agent-share-demo
description: 演示「自定义 Agent 共享」：输出可复制的示例智能体人设与试跑句、解释 agent.manifest 字段，并按用户要求扮演该教练或起草可分享的 Agent 包。适用于共享智能体、自定义 Agent 演示、agent 包、导入导出智能体、Agent 共创入口预览。
---

# WodeAppX 自定义 Agent 共享演示

本 Skill 证明共创交换物是 **自定义 Agent 包**（名称 + prompt + starter + 工具声明），不是零散 Skill。当前没有一键导入运行时；交付的是可复制人设与格式预览。

## 何时使用

用户提到以下任一意图时启用本 Skill：

- 共享智能体 / 自定义 Agent 演示
- agent 包 / 导入导出智能体
- 想快速看到「换 Agent = 换行为」

## 工作流

### 1. 出示演示人设与试跑句

1. 读取同目录 `references/demo-agent-prompt.md`。
2. 向用户完整给出两段可复制内容：
   - System / Agent prompt
   - 用户试跑句
3. 说明零工程试跑路径：
   1. 新建对话。
   2. 把 System / Agent prompt 作为首条消息发出（或贴入自定义 Agent 配置，若当前 UI 已有该入口）。
   3. 再发试跑句。
   4. 预期回复呈固定五段：钩子 → 痛点 → 卖点三条 → CTA → 30 秒口播稿；与默认闲聊明显不同。

### 2. 解释分享物格式

1. 读取 `references/agent.manifest.example.json`。
2. 用中文解释字段（勿大段贴密钥或本机路径示例）：

| 字段 | 含义 |
|------|------|
| `schemaVersion` | 包格式版本 |
| `id` | 稳定标识，社区仓/导入用 |
| `name` / `description` | 侧栏与发现页展示 |
| `prompt` | Agent 人设与输出契约 |
| `entryPrompt` | 点击入口时的短开场 |
| `samplePrompt` | 一键试跑例句 |
| `tools` / `skills` | 依赖声明；本 demo 为空 |
| `modelPolicy` | 模型策略；`user-default` 表示跟用户当前默认 |

3. 强调：真实「导入后出现在我的智能体」属于后续产品；此刻是格式预览。

### 3. 当场扮演教练

若用户说「现在就按这个教练回答」或等价意图：

- 后续回复严格遵守 `demo-agent-prompt.md` 中的五段结构与规则。
- 不修改系统配置、不注册隐藏 runtime agent、不调用无关工具。

### 4. 起草用户自己的 Agent 包

若用户说「帮我导出我的 Agent」或描述想分享的人设：

1. 根据对话整理一份与 `agent.manifest.example.json` 同结构的 JSON。
2. 禁止写入 API Key、Token、本机绝对路径、私有客户数据。
3. `tools` / `skills` 只写用户明确需要的名称；没有则空数组。
4. 提醒：对方目前需手动复制 `prompt` 试跑；一键导入尚未上线。

## 边界

- 不实现侧栏「发现/分享智能体」UI，不调用 Hub 上传接口。
- 不把 Skill 市场当主叙事；Skill 只是 Agent 包的可选依赖。
- 用户可见文案不使用 emoji。
