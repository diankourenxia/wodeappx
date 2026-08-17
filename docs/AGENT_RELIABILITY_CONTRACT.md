# WodeAppX Agent 可靠性契约

> **状态：冻结（2026-07-15，序与字段二次收紧）**  
> **目标**：在现有 OpenWork / OpenCode 会话路径上做到「难说谎」，不另起状态引擎。  
> **相关**：[`AGENT_CAPABILITY_TESTING.md`](AGENT_CAPABILITY_TESTING.md) · [`CAPABILITIES.md`](CAPABILITIES.md) · 平台 [`docs/DESKTOP_AGENT_BORROW.md`](../../docs/DESKTOP_AGENT_BORROW.md)

## 1. 一句话

> **Goal 定义什么算完成；Evidence 证明发生了什么；ApprovalReceipt 证明谁允许了什么；TurnOutcome 判断本回合是否满足目标；AutomationRun 隔离每次周期执行。以上都由系统记录，模型只能引用，不能自报。**  
> **失败属于 Item，可恢复性是失败 Item 的属性，不用「成功状态」包装错误。**

## 2. 数据流（实施顺序以此为准）

```text
工具 Item → Evidence → TurnOutcome
                    ↓
              Goal.progress（系统聚合，模型不直写）
```

```text
Session
 ├─ Structured Goal（可选；基于 Evidence 自动推进）
 ├─ Turns
 │    ├─ Items（tool / approval / …）
 │    ├─ Evidence[]（系统观测）
 │    └─ TurnOutcome
 └─ Compacted conversation（可丢弃；只保留 Goal + Evidence 索引）
```

| 层 | 谁负责 | 状态 / 产物 |
|----|--------|-------------|
| **Item** | 单次工具 / 审批 | `pending` · `running` · `completed` · `failed` · `interrupted` |
| **Evidence** | 工具/验证器 | 含 `verifier` + `observation`，不是裸 URL |
| **TurnOutcome** | 系统 | `completed` · `partial` · `waiting` · `failed` · `interrupted` |
| **Goal** | 会话目标 | `active` · `paused` · `completed` · `failed` · `cancelled`；`progress` 由 Evidence 聚合 |
| **Run** | 单次周期执行 | 每次 cron 新建 AutomationRun |

禁止：新建平行失败 store；禁止模型直写 `progress` / 「已完成」。

**实施顺序（冻结，不得改成先 Goal）**：

1. 收完当前 P0（含 ApprovalReceipt，收掉 `confirmed:true` 高风险后门）  
2. 商品图 Evidence MVP  
3. TurnOutcome（由 evidence / typed doneWhen 判定）  
4. Session Goal（revision + typed doneWhen + redirect 事件）  
5. Compact：只留 Goal + Evidence 索引  
6. AutomationJob / AutomationRun  
7. 云端 `AgentRun` 仅同步，不当桌面真相源  

可以先**定义** Goal 类型，但**运行时**必须先有 Evidence，再让 Goal 自动判定完成。否则 Goal 会退化成模型填写的进度表。

## 3. 可恢复失败（冻结语义）

**禁止**再用 `success`/`ok` 为 true 或 Item=`completed` 包装错误。  
**禁止**单独保留含糊的 `shouldContinue:true` 作为正式字段。

若曾出现 `shouldContinue:true`（例如旧 scheduler JSON），实现层必须映射为：

```ts
{
  status: "failed",
  recoverable: true,
  errorKind: "validation" | "ambiguous" | "dependency" | "execution",
  message: string,
}
```

含义：

| 规则 | 说明 |
|------|------|
| Item | 仍为 **`failed`**（OpenCode：`execute` throw → 原生工具失败） |
| `recoverable: true` | Agent **可以**补参或换工具继续 |
| Turn | **保持 `running`**；仅无法恢复或最终放弃时 TurnOutcome=`failed` |
| 需要用户输入 | TurnOutcome → **`waiting`**，不是 failed，也不是 completed |
| `errorKind` | `validation` 参数不合法；`ambiguous` 需消歧；`dependency` 缺外部依赖；`execution` 执行失败 |

**重试预算指纹**（不得只按相同 `errorKind` 计数）：

```text
toolName + errorKind + normalizedArgsHash
```

同一指纹连续失败才消耗重试预算；换参数或换工具视为新的恢复尝试。

**进入 OpenCode Item 的方式（硬要求）**：自定义 `Error` 字段不保证保留。`executeWithContract` 在 throw 前必须：

1. 若存在 `context.metadata`，写入 `metadata.wodeappxFailure = failure.toPayload()`；
2. 错误字符串带稳定标记：`[wodeappxFailure recoverable=… errorKind=…] <可读消息>`。

只有做到以上两点，才算包装器完成了失败发布。最终验收还必须读取 settled Item：`state.status="error"`，并能取得结构化 `wodeappxFailure`。

**OpenCode 1.17.11 兼容规则**：该版本在 `running → error` 时会保留错误字符串、但丢弃 `running` state 上的 metadata。WodeAppX 不另建失败 store；中央 `session-read-model` 必须从稳定标记还原同一份 `state.metadata.wodeappxFailure`。升级到原生保留 error metadata 的 OpenCode 后，已有 metadata 优先，投影不覆盖。因而：

- 原始 OpenCode Item 的耐久载体是 `state.error` 中的稳定标记；
- OpenWork/WodeAppX 的统一读取结果必须同时暴露结构化 `state.metadata.wodeappxFailure`；
- 单测只断言 `context.metadata()` 被调用不算端到端通过，必须再验 settled Item / session read model。

## 4. ApprovalReceipt（当前 P0，非体验增强）

`confirmed:true` 只防误触，**不是**审批证据。文件修改、发布、飞书发送、Shopify 写等必须校验一次性 receipt：

```ts
type ApprovalReceipt = {
  id: string;
  sessionId: string;
  turnId: string;
  itemId: string;
  action: string;
  argumentsHash: string;
  decision: "approved" | "denied";
  decidedBy: string;
  decidedAt: string;
  expiresAt?: string;
};
```

优先复用 OpenCode permission request/reply，不另造审批引擎。无 receipt 或参数哈希变化 → Item=`failed`。

## 5. Evidence 与 typed doneWhen

Evidence **不能**只有 URL / 路径 / 模型写的 assert。最小形状：

```ts
{
  id: string;
  type: "asset" | "file" | "browser" | "test" | "api" | "receipt";
  claim: string;
  producedBy: { tool: string; itemId: string };
  observedAt: string;
  verifier: "http_probe" | "task_status" | "fs_stat" | "platform_api";
  observation: Record<string, unknown>; // 如 { status: 200, contentType: "image/png" }
}
```

`taskId + URL` 是声明；**系统重新观察**后的 `observation` 才是证据。由工具/验证器生成，模型不得补写。

`doneWhen` **不能**只是展示用字符串，须含机器谓词，例如：

```ts
doneWhen: [
  { type: "artifact_count", artifact: "image", min: 2 },
  { type: "all_urls_reachable" },
  { type: "tool_completed", tool: "product_visual_batch_image_run" },
]
```

Goal.`progress` 由 Item/Evidence 聚合，**禁止模型直写**。

商品图 Evidence MVP：任务权威状态、张数、HTTPS 引用、URL probe 200、Item 来源。

## 6. 真相源路径（不要重复造轮子）

| 关注点 | 唯一落点 |
|--------|----------|
| 稳定失败标记 / 解析 | `tool-item-failure.ts`（若存在）或 `openwork-tool-result.ts` |
| 结果契约 / `executeWithContract` | `opencode-plugins/openwork-tool-result.ts`（sync → vendor） |
| UI Bridge / Computer Use / 扩展调用收口 | `openwork-extensions-preview.ts` |
| Scheduler 包装 | `wodeappx-scheduler.ts` |
| 失败 metadata 兼容投影 | `session-read-model.ts` |
| 审批 | OpenCode permission → ApprovalReceipt |
| 能力路由与 Live 矩阵 | [`AGENT_CAPABILITY_TESTING.md`](AGENT_CAPABILITY_TESTING.md) |

## 7. 阶段表（与 §2 顺序一致）

| 阶段 | 内容 |
|------|------|
| **P0** | 执行边界零例外；历史素材不参与能力路由；ApprovalReceipt 收高风险 `confirmed:true`；失败标记进 settled Item |
| **P1** | 商品图 Evidence MVP + TurnOutcome |
| **P2** | Session Goal + typed doneWhen + revision；Compact 只留索引 |
| **P3** | AutomationRun；云端 AgentRun 同步；审计导出 |

4～6 周对标 **可感知 ~8.8–9 MVP**，不承诺「接近 10」。

## 8. 黄金用例

1. **可恢复 Item 失败**：`failed + recoverable` → 换路 → TurnOutcome 可 `completed`。  
2. **无 receipt 拒执**：发消息/删文件/发布 → Item=`failed`。  
3. **完成须观测**：声称已出图却无 HTTP 200 / 权威 task 状态 → FAIL。  
4. **同一指纹才耗尽重试**：换 args 或换 tool 不累计旧 `validation` 预算。  
5. **周期新 Run**：第二次 cron 新建 AutomationRun，不继承第一次 `satisfied`。  
6. **流必须结算**：上游 SSE 静默或 tool args 残缺时，不得永久 `pending`；proxy 收口（`finish`/`[DONE]`）或桌面解挂后自动续跑，目标仍是完成用户任务（见平台 [`docs/AI_CHAT_RELIABILITY.md`](../../docs/AI_CHAT_RELIABILITY.md)）。

## 9. 改动如何验收

| 改了什么 | 必跑 |
|----------|------|
| 包装器 / 失败标记 | 对应 `bun test` + settled Item |
| scheduler | `wodeappx-scheduler.test.ts` |
| 路由 / 智能体 | `pnpm --dir wodeappx test:agent-capabilities` |
| 诚实度 / 多模型 | Live core / release |

判断题（合入前）：失败是否单入口？有无平行状态机？高风险是否还只靠 `confirmed:true`？Evidence 是否含 verifier+observation？Goal.progress 是否仍由模型自报？

## 10. 明确不做

- 重做聊天引擎或第二套 runtime  
- 优先大规模子 Agent 产品化  
- **先做 Goal、后补 Evidence**  
- 用 prose compact 保存 Goal 全文证据  
- 用静态扫源码替代运行时包装器
