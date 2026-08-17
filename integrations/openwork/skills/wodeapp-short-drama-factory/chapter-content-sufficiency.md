# Chapter Content Sufficiency（章节内容充足度 — 第一道门）

> **根因**：章节事件不够 → 视频脚本只能把修花/进门/犹豫拉长 → 成片空且慢。  
> **顺序**：先审章节内容是否撑住目标时长 → 再做 beat-budget → 再组 AI 镜头。  
> 本门不过，**禁止**进入「生成/重新生成视频脚本」。

## What Counts as Content

| 算有效内容 | 不算（灌水） |
|------------|--------------|
| 新事件（进门逼签、领证、威胁） | 纯日常建立超过 8s 预算 |
| 信息变化（重启调查、字迹相同） | 同一情绪重复外化（掐掌心两次） |
| 人物选择 / 不可逆动作（签字） | 解释性旁白 / 主题总结 VO |
| 关系位移（陌生人→契约夫妻） | 空走位、长对视、无信息反应 |
| 结尾钩子（可见问题） | 为凑秒数放慢已有动作 |

## Minimum Inventory by Target Duration

| 目标时长 | 最少有效事件 | 最少信息/关系升级 | 场次数 | 不可逆决定 | 结尾钩 |
|----------|--------------|-------------------|--------|------------|--------|
| **60–75s** | 4–6 | 1–2 | 2–3 | 1 | 1 可见钩 |
| **90s** | 6–8 | 2 | 2–4 | 1 | 1 |
| **120s** | 8–12 | 2–3 | 3–4 | 1+ | 1，且后半须有**新事件** |

「有效事件」= 观众能复述的情节推进，不是 △ 行数。

## Outline Contract: `contentPlan`

Do not wait until the video-script step to discover that an episode is too thin. Every episode outline should carry a machine-readable content budget:

```json
{
  "targetDurationSec": 120,
  "estimatedDurationSec": 116,
  "sceneCount": 3,
  "effectiveEventCount": 9,
  "events": [
    {
      "id": "E01",
      "purpose": "trigger",
      "action": "受托人把协议摔在柜台",
      "change": "结婚交易正式进场",
      "estimatedSec": 8
    }
  ],
  "informationUpgrades": ["男主可重启父亲案件", "威胁字迹与父亲笔记一致"],
  "irreversibleDecision": "女主签字并领证",
  "visibleEndHook": "两份笔迹叠在一起，笔锋完全一致",
  "expansionNeeded": false
}
```

Rules:

- `estimatedDurationSec` must be a defensible sum of `events[].estimatedSec`, not a copy of the requested duration.
- Repeated hesitation, walking, reaction, or atmosphere cannot become separate effective events.
- If the outline inventory is short, add a new conflict/action/clue at the outline stage or set `expansionNeeded: true`; do not hide the shortage until shot generation.
- Regenerate the content plan whenever the episode body is expanded or structurally rewritten.

### 120s 硬规则

若章节只有「协议 → 签字 → 领证 → 纸条」这类 **~6 事件 / ~70s 料**：

- **P0**：不得生成 120s 视频脚本去拉长动作  
- 二选一：把目标改为 **60–75s**，或 **扩写章节**（字迹对照后的监视 / 第一次行动 / 新反转）

## Preflight Checklist（写正文后、出分镜前）

对当前章节勾选：

1. [ ] 开场 3–10s 内有异常或冲突提问  
2. [ ] 有一次明确交易/冲突条件（信息抛出）  
3. [ ] 有一次不可逆动作  
4. [ ] 中段有升级（新信息或关系变）——90s+ 必有；120s 至少两次  
5. [ ] 结尾钩是**可见物/可见发现**，不是主题旁白  
6. [ ] 大纲钩子（如字迹=父亲笔记）已写进正文，不是只在大纲里  
7. [ ] 粗估内容秒数 ≥ 目标时长的 **75%**（硬门槛），且尽量 ≥ **90%**（稳妥线）

任一项失败 → 扩写或降时长，不要进视频脚本。

## Model Timing Contract

Episode seconds must be judged by a text model reading the **whole shooting text**, not calculated locally from line count, character count, dialogue length, or action categories.

The model must consider performance pace, overlapping action/dialogue, reaction time, deliberate pauses, prop handling, scene changes, and fast-cut compression, then return:

```json
{
  "contentEstimateSec": 68,
  "playbackTimeline": [
    { "atSec": 0, "label": "花店", "kind": "scene", "lineIndex": 0 },
    { "atSec": 41, "label": "民政局", "kind": "scene", "lineIndex": 12 },
    { "atSec": 68, "label": "结束", "kind": "end", "lineIndex": -1 }
  ]
}
```

Hard rules:

- Never implement `每条 △ = N 秒`, `N 字/秒`, or short/medium/long action lookup tables.
- After manual text edits, invalidate the previous body timing and show `待 AI 重新估时`; do not fall back to the old outline budget as if it described the edited body.
- A dual-model review may provide an aggregate timing estimate; local code may merge model estimates, but must not invent seconds.
- `contentPlan.events[].estimatedSec` is also model-authored. Local code may sum and validate those values, not assign them.

Gate thresholds are applied **after** a model estimate exists:

```text
if contentEstimateSec < targetDurationSec * 0.75 → FAIL（内容不足）
if 0.75 ≤ ratio < 0.90 → REVIEW（硬门槛已过，但必须继续交叉审核）
if contentEstimateSec > targetDurationSec * 1.25 → WARN（建议加长目标或删支线）
```

## Relation to Other Gates

```
Gate 0  chapter-content-sufficiency.md   ← 你在这里
Review  episode-cross-review.md          （双模型独立审核 + 本地合并）
Gate 1  beat-budget-gate.md              （剪辑节拍估秒 + 合并）
Gate 2  episode-rhythm-manifest + AI shots （12–15s 可执行镜）
```

- Gate 0 失败：改**章节**或**目标时长**  
- Gate 1 失败：改**拆法/合并**，不加水  
- Gate 2：遵守 `shortDramaContracts.durationPolicy`（普通镜 12–15s，短镜 4–8s，最低 4s）

## Agent / Workbench Behavior

生成章节正文时：按目标时长写入**足够事件**，禁止「摘要式一集」。  
生成视频脚本时：

1. 先跑 Gate 0；失败则提示扩写/降时长，**不要**输出 N×15s 空镜  
2. 通过后按内容合并镜头；`totalDurationSeconds` 应接近 **contentEstimate**，不得为凑 `form.duration` 注水  
3. 若用户坚持更长目标：返回「需扩写的事件清单」，而不是自动拉长修花/进门
