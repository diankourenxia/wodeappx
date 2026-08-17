# WodeAppX 工具执行契约

> 本文定义 Agent / Control Tool 的长期边界。能力路由测试见
> [`AGENT_CAPABILITY_TESTING.md`](AGENT_CAPABILITY_TESTING.md)，工具结果与 Run 可靠性见
> [`AGENT_RELIABILITY_CONTRACT.md`](AGENT_RELIABILITY_CONTRACT.md)。

## 1. 不变式

1. 消息发送、附件理解和上下文整理不得创建或修改业务记录。
2. Agent 可调用工具的副作用只能通过 `executeTool()` 发生。
3. 工具对模型可见不等于工具可执行；能力路由只决定本轮工具表，不授予权限。
4. `effect`、`approval`、参数和执行结果以运行时注册表为准，提示词不能放宽它们。
5. 稳定业务操作必须作为独立、强类型工具暴露；内部 `actionId` 固定在适配器中，不进入模型参数。
6. 通用 Action 执行器只承载运行时 UI 控件，其 `actionId` 由实时注册表生成枚举，并在执行前再次校验。
7. 查询结果只能证明记录已存在；只有本轮写入工具返回成功，才能证明本轮发生了写入。
8. Hook 只允许观察、审计、通知、补充上下文或投影注册表元数据；不得改写用户意图、写业务库或串联另一业务工具。
9. 人类在产品 UI 中直接点击保存等操作不属于 Agent Tool；它们仍须遵守各自的业务权限和确认规则。

## 2. 五层职责

| 层 | 负责 | 不负责 |
|----|------|--------|
| 能力路由 | 决定本轮向模型提供哪些工具 | 权限、审批、业务执行顺序 |
| 工具契约注册表 | 工具名、内部 Action 映射、完整参数、`effect`、`approval` | 根据用户句式编排业务 |
| 模型适配器 | 把稳定契约生成独立工具；把动态 UI 注册表投影为枚举 | 让模型填写未注册的内部标识 |
| `executeTool` | 校验、确认、执行许可、Run 事实记录 | 猜测用户意图 |
| Hook | 生命周期观察；`tool.definition` 只同步实时 UI 枚举 | 业务写入、自动编排、修正工具选择 |

## 3. 元数据与审批矩阵

`effect`：

- `read`：不改变业务或外部状态。
- `write`：创建或修改业务、外部或持久状态。
- `destructive`：删除、撤销、清理或不可逆覆盖。

`approval`：

- `auto`：运行时可直接执行。
- `prompt`：每次执行前确认。
- `writes`：只读自动执行，其他 effect 确认。

| effect | auto | writes | prompt |
|--------|------|--------|--------|
| read | 自动 | 自动 | 确认 |
| write | 自动 | 确认 | 确认 |
| destructive | **强制确认** | **强制确认** | **强制确认** |

破坏性动作不能被局部 `auto` 配置降级。缺少新元数据的旧 Action 使用兼容适配；只读默认
`read + auto`，其余默认 `write + prompt`。未知动作不得静默自动执行。

## 4. 执行与旁路门禁

- `ToolDefinition` 不公开 raw handler；注册时 handler 存放在内部映射。
- 稳定业务工具由同一份契约生成 Renderer 元数据和模型工具；模型参数中不得出现 `actionId` 或通用 `args:any`。
- 通用 UI 执行器在模型工具解析阶段读取实时 Action 注册表，只暴露已启用且没有独立工具的 Action；目录不可用时失败关闭。
- 通用 UI 调用在进入 `/execute` 前再次校验 Action 是否仍然存在、启用以及参数是否匹配，防止注册表变化和伪造调用。
- 注册到 Control Provider 的 Action 会被保护，入口外调用其 handler 会失败。
- 源码门禁扫描直接 `.execute(...)` 与 `["execute"](...)` 调用；仅允许公开 Control API，后者仍进入 `executeTool()`。
- 新工具应显式声明 `effect` 和 `approval`。`sideEffect` 与名称推断仅用于旧 Action 迁移，不是长期真相源。
- 不按 `save/delete/generate/publish` 等词建立业务流程；名称只可用于迁移期保守分类。
- 能力路由只引用具体工具名；需要动态 UI 控制时，由工具依赖图统一补齐只读目录。
- 直连工具的能力分组属于契约字段；基础工具、资产工具和全量受管工具表必须从注册表派生，不维护第二张手工清单。
- 提示词只说明能力目标和跨工具约束；工具名称、内部 Action 映射、参数和审批不得靠提示词维持正确性。
- 业务工具参数不得再携带 `confirmed` 之类的第二套审批状态。只读预览与破坏性执行应拆成不同工具，确认只由 `executeTool()` 判定。
- 附件、同步、编排、handoff 和消息发送等 Hook/上下文模块由源码门禁禁止导入业务库写入函数；旧聊天附件自动入库 API 已移除。
- 写入失败、取消或 Action 不存在后不得报告成功，也不得用一次 `list` 查询冒充本轮写入事实。

## 5. 最小 Run 事实

每次入口调用记录：

- `runId`
- `toolId`
- `effect` / `approval`
- 元数据来源
- 开始、结束和耗时
- `returned` / `failed` / `cancelled`
- 错误类别

记录不包含工具参数、附件正文、API Key 或业务敏感值。当前只保留最近 100 条内存记录，供测试和诊断使用；仪表盘、持久审计和慢请求策略以后按需求增加。

## 6. 分阶段范围

当前兑现：注册表适配、统一执行入口、保守审批、raw handler 保护、Hook/上下文写库门禁、内存 Run 事实、按契约分组的稳定数字资产直连工具、只读预览/破坏性执行分离、动态 UI 实时枚举和双重校验。

后续可做：逐批把旧 Action 显式迁到 `effect/approval`；确有观察需求时再实现只读的
`BeforeToolUse` / `AfterToolUse`。不引入 Codex Rust 内核、OS Sandbox 或 Starlark Rules。

设计参考 OpenAI Codex 的工具分层与 Hook 生命周期；WodeAppX 复用协议思想和命名，不复制其执行内核。
