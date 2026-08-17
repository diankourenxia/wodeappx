# Storyboard Source Format and Conversion Rules

Use this reference when the source material is a prompt-first storyboard script (分镜稿), or when authoring one as the main creative layer. The pipeline is two layers plus metadata, not three documents:

```
分镜稿 (authoring layer, human-owned)
  └─ conversion pass ─→ scene.script + scene.prompt + execution metadata (WodeApp layer)
```

When timing is planned structurally first, author `EpisodeRhythmManifest` (`references/episode-rhythm-manifest.md`) and derive the分镜稿 from it. The manifest is the machine truth source; the分镜稿 remains the human-readable shooting layer.

Do not create a separate intermediate "shotPlan" document. The storyboard IS the structured plan; conversion extracts fields directly from it.

## Storyboard Template (分镜稿模板)

Each shot block follows this shape:

```text
1-2 街角 咖啡座 / 街道 各处 外 白天 (00:30 - 01:00)
AI镜头提示 (Camera): 快速的微距蒙太奇。强烈的 ASMR 级音效设计。
△ 特写 1：楚河伸出手指，将桌角的空玻璃杯轻轻往前推了三厘米。（音效：玻璃摩擦桌面的刺耳声）
△ 特写 2：玻璃杯坠落砸碎。一只流浪猫受惊，猛地窜向马路。（音效：玻璃碎裂，猫叫）
楚河 (VO / 声音冷峻平静): 但如果我拨动因果的琴弦……
(模型估时：5秒)
[风险备注]: 无
```

Line grammar:

- **Header line**: `集号-镜号 场景名 内/外 日/夜 (起始 - 结束时间码)`.
- **AI镜头提示 (Camera)**: camera language, shot size, movement, editing texture, sound-design intent.
- **`△` action beats**: one visible event per `△`, in causal order. Inline `（音效：…）` allowed.
- **Dialogue/VO line**: `角色名 (VO/对白 + delivery note): line`.
- **Model-timing line**: `(模型估时)` — optional production metadata authored by a text model after reading the full performance; never derive it from word count.
- **[风险备注]** (optional): platform/provider review risk for this shot (graphic injury, weapons, minors, privacy-sensitive imagery, sexual content, politics/brands).

This format is deliberately close to a runnable prompt. Keep it that way: every `△` must be filmable, every mood must be expressed through light/sound/action.

## Conversion Table: Which Line Goes Where

| Storyboard line | Destination | Handling |
|---|---|---|
| 集号-镜号 | `groupId` / `orderInGroup` | Never in prompt |
| 场景名 内/外 日/夜 | `prompt` (location + light) + `locationRef` | Rewrite as visible staging: `白天街角咖啡座，烈日阳光` |
| 时间码 | `duration` (task field) | Never in prompt; check against provider clip limit |
| AI镜头提示 | `prompt` camera layer + `motionPrompt` | Keep only executable camera language; drop editing-strategy words the model cannot act on |
| `△` action beats | `prompt` main body | See beat-splitting rule below |
| `（音效：…）` | `audioPrompt`; critical ones also in `prompt` | Sound the clip must contain goes in prompt; texture notes stay metadata |
| VO / 对白 | `prompt` (spoken, with delivery) + `audioPrompt` | Dialogue is performed audio, never rendered text |
| 模型估时 | drop (or timing metadata) | Never in prompt; do not recalculate from characters/lines |
| Backstory / judgment words | rewrite, then `prompt` | See visualization rewrite below |
| [风险备注] | `riskNotes` metadata | Triggers indirect-depiction rewrite in prompt |

## Visualization Rewrite (可视化改写)

Conversion is not just deletion. Storyboard language written for humans must be rewritten into what a camera can see or a microphone can hear:

- **Non-diegetic knowledge**: the model does not know who characters are. `逃脱了法律制裁的黑心财阀李董` → `中年男人穿深色西装，表情狂妄大笑，保镖簇拥`. Identity, backstory, legal status, and plot function never survive conversion; only their visible evidence does.
- **Judgment adjectives**: `狂妄地`, `冷峻`, `神秘` must be grounded: facial expression, posture, line delivery, lighting. Follow the existing shootability rules in `creative-spec.md`.
- **Probability/theme narration**: thematic VO stays as spoken dialogue in the prompt; thematic *explanation of what the shot means* is dropped.

## Beat-Splitting Rule (动作节拍拆分)

A single provider prompt reliably renders **1-2 action beats**. A causal chain like 推杯→碎裂惊猫→外卖员急转→水柱喷出 (4 beats in 30s) will drop or reorder events if sent as one prompt.

- If a storyboard shot has more than 2 `△` beats or exceeds the provider clip limit, split it into multiple scenes along `△` boundaries.
- Chain the split clips: previous clip's `lastFramePrompt` becomes the next clip's `firstFramePrompt` composition (match-on-action, same object, same screen direction).
- Preserve the storyboard shot number in scene titles (`1-2a`, `1-2b`) so the source mapping stays auditable.

## Field Classes: Injected vs Record-Only

Execution metadata splits into two classes. Confusing them causes either prompt bloat or continuity drift.

**Injected fields** — stored once, but must be re-expanded into every visible `prompt` at build time, because video models have no cross-clip memory:

- `styleBible` style lock and negative style
- `continuity` (active LOOK code, wounds, prop state, location geometry)
- character casting anchors for characters visible in the shot
- critical bans (subtitle/watermark/readable-text ban; folded negatives for engines without `negativePrompt`)

**Record-only fields** — never written into the visible prompt:

- `duration`, `aspectRatio`, `mode`, `model`, resolution
- `riskNotes`
- `engineHints`, `referenceRoles` (mapped to engine slots, not prose)
- narration word counts, timecodes, shot numbers
- strategy notes (hook intent, audience psychology, plot function)

## riskNotes and Indirect Depiction

`riskNotes` records why a shot may fail platform or provider review, and what the approved indirect treatment is. The prompt must already contain the indirect version; riskNotes documents the decision.

Example: 钢筋贯穿人体 is a near-certain review failure. Indirect treatment: steel rebar bursting outward + reaction shot + cut to black + siren audio. The prompt describes only the indirect version; `riskNotes` stores `"原分镜为钢筋贯穿特写，已改为间接表现（甩出钢筋+黑屏+警笛）"`.

Common triggers: graphic injury/gore, weapon discharge (see the weapon de-escalation rule in SKILL.md), human-like covered forms in reference images (see Seedance privacy rules), minors, sexual content, real brands/logos, real-person likeness.

## Worked Example

Storyboard shot 1-2 above (4 beats) converts to two scenes:

Scene 1-2a (`duration: 8`):

```text
写实竖屏都市短剧；参考角色[楚河]（灰色风衣）。白天街角咖啡座，烈日强光。微距特写：楚河伸出手指，把桌角的空玻璃杯缓缓推向桌沿三厘米，玻璃摩擦桌面发出刺耳声；杯子越过边缘坠落砸碎，碎裂声中一只流浪猫受惊窜出画面。结尾定格在碎玻璃和猫窜出的方向。无字幕、无水印、无可读文字。
```

- `lastFramePrompt`: 碎玻璃散落地面，猫向画面右侧窜出
- `audioPrompt`: ASMR级音效——玻璃摩擦、碎裂、急促猫叫
- `riskNotes`: 无

Scene 1-2b (`duration: 8`, `firstFramePrompt` continues the cat's screen direction):

```text
写实竖屏都市短剧。同一街道，外卖员骑电动车为躲避从右侧窜出的猫猛打方向，外卖箱带子勾住路边消防栓阀门；阀门拽松，高压水柱轰鸣喷出，在烈日下形成折射阳光的巨大水幕。楚河冷静旁白："但如果我拨动因果的琴弦……"结尾定格在刺眼水幕。无字幕、无水印、无可读文字。
```

Dropped in conversion: shot number, timecode, word count, "ASMR 级音效设计" as strategy label (converted to concrete sounds), and any explanation of what the causal chain means.

## Round-Trip Rule

The storyboard stays the human source of truth. When a prompt is revised during generation (failed clips, review fixes), write the surviving change back to the storyboard `△` lines or `[风险备注]` so the two layers do not drift. Do not edit only the JSON.
