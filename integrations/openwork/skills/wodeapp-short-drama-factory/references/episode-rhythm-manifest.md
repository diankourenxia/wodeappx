# Episode Rhythm Manifest

Use this reference when planning or converting episode-level timing before writing final storyboard prose or WodeApp scene JSON.

## Role in the Pipeline

`EpisodeRhythmManifest` is the **machine-checkable truth source** for one episode's timing and narrative rhythm. Human storyboard scripts and engine prompts are **adapter outputs**, not competing sources of truth.

```
创意 / 剧本意图
  └─ EpisodeRhythmManifest (beats + shots + entityState)
        ├─ 分镜稿 (human authoring layer)
        ├─ WodeApp scene JSON (task layer)
        └─ Seedance / Kling / Veo adapter prompt (engine layer)
```

Schema: `references/episode-rhythm-manifest.schema.json` (current: **v1.2**)

## v1.2 changes (2026-07-11)

- Root `durationSec` accepts **frame-level decimals** (e.g. `32.25`); gates use **1/24s tolerance**.
- **`timingMeta`**: video-stage estimate provenance (`estimatedDurationSec`, `timingSource`, `scriptHash`, `stale`). Script-stage timing must not be restored here.
- **`dialogueLedger`**: stable `dialogueId` / `audioAssetId` for dedupe gates (no repeated lines across scenes).
- **`audioPlan`**: `dialogueTracks`, `ambienceTracks`, `sfxTracks`, `musicTracks` — execution layer, not hand-written HTML audio tags.
- **`classification`**: dimensional typing (`framing`, `temporalMode`, `audioMode`, `subjectPresence`, `transitionMode`, optional `displayType` for UI). Do **not** collapse into a single `type` field.
- **Top-level `shots[]` stay contiguous and non-overlapping** (min 4s). Short empty shots, pupil inserts, and flashbacks belong in parent **`timeSlots[]`**. Split to sibling shots only when sending separate video-model clips.
- **`renderProfile` (`review` | `clean`) is a render-task parameter**, not stored in the manifest. One manifest derives both outputs.
- Type-registry duration bands (`narrative-shot-types.json`) are **lint warnings only**, never auto-estimation formulas.

Validator: `scripts/episode-rhythm-manifest/validate.mjs`
Deriver: `scripts/episode-rhythm-manifest/derive-hyperframes.mjs`

## Core Principle

**镜头由剧本决定，模型由镜头需求决定。**

Author the manifest from dramatic need first. Do **not** pick Seedance 2.0 / 2.5 up front and then force every shot into 15s.

| Layer | Owns | Does not own |
|-------|------|----------------|
| Script / rhythm manifest | `durationSec`, beats, bridges, narrative function | `providerModel`, engine SKU |
| Execution / UI | model routing, split, extend, billing | story breathing |

Routing rules at execution time:

| Shot `durationSec` | `executionTier` | Typical routing |
|--------------------|-----------------|-----------------|
| `<= 15` | `universal` | Preferred execution lane; target 12-15s when the beat can breathe naturally |
| `16 – 30` | `long_clip` | Seedance 2.5 or any engine with confirmed 30s support; use only when continuity would suffer from splitting |
| `> 30` | `must_split` | Split into child shots, or use extend / long-video strategy |

Default execution target: **15s**. This is a continuity target, not a story clamp. Let a tiny insert stay short, let a true 24s performance stay long if SD2.5 is available, but when auto-splitting an episode or expanding a loose outline, pack normal executable scenes toward 12-15s instead of scattering many 5-8s fragments.

UI badge examples:

- `8s` → 通用
- `18s` → 需 SD2.5
- `32s` → 需拆分

## When to Create It

Create or update a manifest **after** the P0 script-flow gate passes and **before** bulk storyboard prose or video prompt work.

Minimum triggers:

- New episode from idea or outline
- Episode longer than one provider clip
- User asks for rhythm map, beat grid, hook timing, or clip splitting
- Converting an existing分镜稿 back into structured timing

Do **not** replace the human分镜稿 with only JSON. The manifest drives timing; the分镜稿 remains the readable shooting layer.

## Three Time Layers

| Layer | Manifest field | Example |
|-------|----------------|---------|
| Macro | `beats[]` | cold_open @0s, twist @90s, cliffhanger @180s |
| Meso | `shots[]` duration + `narrativeFunction` | 7s pressure beat, 5s reaction, 10s reveal |
| Micro | `shots[].timeSlots[]` | 0-3 establish, 3-6 action, 6-7 ending frame |

`rhythmPreset` only shapes **macro beat anchors**. It does **not** force uniform clip durations, and it does **not** choose a video model.

## modelRequirements

Each shot should carry `modelRequirements`, usually derived from `durationSec`:

```json
{
  "shotId": "E01-S03",
  "durationSec": 24,
  "narrativeFunction": "压迫升级",
  "modelRequirements": {
    "minDurationSec": 24,
    "requiresLongClip": true,
    "executionTier": "long_clip"
  }
}
```

Derivation helper:

```text
if durationSec <= 15:
  executionTier = universal
  requiresLongClip = false
elif durationSec <= 30:
  executionTier = long_clip
  requiresLongClip = true
else:
  executionTier = must_split
  requiresLongClip = true
```

At execution:

```text
90s episode with no fixed shot count → usually 6 scenes around 15s
24s shot → Seedance 2.5 only when it truly needs to stay continuous
12s shot → Seedance 2.0 / 2.5 both ok; may be expanded toward 15s if the action benefits
32s shot → block until split into <=30s child shots, preferably 12-15s each
```

Do **not** store `providerModel` in the manifest. Store only dramatic timing plus `modelRequirements`. The runtime model catalog decides which provider satisfies the requirement.

## Rhythm Presets

Presets suggest anchor times, not clip formulas.

### `hongguo爽剧`

Suggested macro anchors for ~180-190s vertical爽剧 episodes:

| Anchor | Sec | Type |
|--------|-----|------|
| 冷开 | 0 | cold_open |
| 第一爆点 | 30 | small_climax |
| 第一爽点 | 60 | satisfaction |
| 反转 | 90 | twist |
| 第二爽点 | 120 | satisfaction |
| 钩子 | 150 | setup |
| 倒计时/ cliff | 180 | cliffhanger |

### `na_micro_drama`

North American vertical micro-drama default (~60-90s episodes). Blunt hooks, visual evidence before exposition, relationship/legal/prop cliffhangers.

| Anchor | Sec (90s ep) | Type |
|--------|--------------|------|
| Cold insult / impossible image | 0 | cold_open |
| Status reversal hint | 15 | setup |
| Evidence object | 30 | prop_reveal |
| Relationship flip | 45 | twist |
| Threat / door / legal turn | 60 | small_climax |
| Cliffhanger line or object | 75-90 | cliffhanger |

Use with `scriptLanguage: "en-US"`. See `references/locale-en-us.md` for spoken **word** budgets.

### `suspense_ladder`

Escalating question density; fewer satisfaction beats, more withheld answers.

### `emotional_wave`

Longer breathing room between peaks; favor 6-10s dialogue/reaction clips. Still require **pressure before release** — see `references/emotional-arc-ladder.md`.

### `emotional_pressure` / `emotional_release` beat types

Use in `beats[]` when planning the ladder:

- `emotional_pressure` — 情绪积压/悬置：用自然语言写「还悬着什么」
- `emotional_release` — 情绪变化/释放：用自然语言写「这一刻动了什么」
- `emotional_peak` — the single highest emotional point in the episode (often overlaps release or twist)

P0 review: no major in-episode `twist` / `satisfaction` **payoff** without prior `emotional_pressure` in **this episode or season ledger** (cross-episode buildup counts). `buildup` episodes without release are OK.

### `product_reveal`

Problem → use → proof → payoff; align macro beats to product states, not relationship turns.

### `brand_story`

Brand-safe reveal arc; avoid weapon/graphic injury defaults unless user accepts risk.

### `custom`

Use `rhythmPresetNotes` and explicit `beats[]` only.

## Locale and Dialogue Budgets

Set `scriptLanguage` on the manifest (`zh-CN` default, `en-US` for US scripts). Optional `promptLanguage` overrides prompt adapter language only.

| `durationSec` | `en-US` max spoken words | `zh-CN` max spoken chars |
|---------------|--------------------------|---------------------------|
| 4-8 | 12 | 25 |
| 12-15 | 28 | 45 |
| 16-24 | 50 | 80 |
| >24 | split shot | split shot |

Optional per-shot override: `dialogueWordBudget: { "max": 28, "unit": "words" }`.

`build_wodeapp_drama_package.mjs` validates manifest dialogue and fails on overflow (P0). Full US rules: `references/locale-en-us.md`.

## Duration Variation Guide

Choose `shots[].durationSec` by narrative function, not by averaging. For WodeApp video execution, the default target is **12-15s** because it preserves action, reaction, and handoff continuity better than many very short fragments.

| Function | Typical sec | Notes |
|----------|-------------|-------|
| cold_open impact / clue insert | 4-8 | Fast hook, punchline, or required insert only |
| standard action / dialogue | 12-15 | Default workhorse; aim near 15s when the beat can breathe |
| twist / satisfaction | 12-15 | Room for setup, turn, reaction, and clean ending frame |
| VO / emotional performance / flashback | 15-24 | Use `long_clip` only when cutting would weaken performance continuity |
| transition / bridge | 4-8 | Often `keyframeGate: skip`; keep short when it only connects space/time |

If `durationSec > 30`, split along `actionBeats` boundaries and chain with `lastFrame → firstFrame`. Do **not** clamp dramatic timing to 15s or 30s during authoring; split only when execution requires it.

For `16-30s` dialogue or emotional blocks, prefer `semantic_shots` or expanded `timeSlots[]` over forcing many short provider clips. For loose outlines without locked durations, prefer fewer near-15s executable clips before escalating to 16-30s long clips.

## Keyframe Gate Rules

| Gate | When |
|------|------|
| `required` | cold_open, twist, prop_reveal, transform, cliffhanger, fragile spatial continuity |
| `optional` | standard dialogue, travel, reaction |
| `skip` | simple transition, VO over b-roll, non-fragile hard cut |

Approving a keyframe image is cheaper than revising video. See Review Tiers in `shot-execution-schema.md`.

## Beat ↔ Shot Rules

Hard invariants:

1. Every `shot.beatId` must reference an existing `beats[].beatId`.
2. Every beat must have at least one shot.
3. Shots must cover the episode timeline without gaps or overlaps.
4. Each shot carries at most **2** `actionBeats`.
5. `openingShot` of shot N+1 must be achievable from `endingShot` of shot N unless `transition` is `motivated_cut` or `hard_cut` with explicit `bridgeHint`.

## Continuity and Bridge Fields

Use these fields for cross-clip checks:

- `openingShot` / `endingShot` — visible composition anchors
- `bridgeHint` — how the cut should feel
- `causalLinkToNext` — story motivation for the next clip
- `continuityFlags` — LOOK codes, prop states, wounds, geometry
- `entityDelta` — what changes after this shot (`prop:工牌污渍=new`)

### Jump-cut guard

Flag **P1** (not automatic P0) when adjacent shots share the same subject, scene, angle, and shot size **and** there is no `match_on_action`, `bridgeHint`, or sound/light bridge.

Motivated cuts and match-on-action are allowed exceptions.

## Conversion: Manifest → 分镜稿

For each `shot`:

```text
{episode}-{index:02d} {location} {内/外} {日/夜} ({start} - {end})
AI镜头提示 (Camera): {camera}
△ {actionBeats[0]}
△ {actionBeats[1]?}
{dialogue lines}
(预计用时：{durationSec}秒)
[风险备注]: {riskNotes or 无}
```

Record-only in分镜稿 header: beatId, shotId, rhythmPreset, presetTag.

## Conversion: Manifest → WodeApp Scene

| Manifest field | WodeApp scene field | Class |
|----------------|---------------------|-------|
| `narrativeFunction` + `actionBeats` | `script` | human |
| compact/timestamp/semantic adapter output | `prompt` | engine |
| `durationSec` | `duration` | record-only |
| `aspectRatio` | `aspectRatio` | record-only |
| `openingShot` | `firstFramePrompt` | metadata |
| `endingShot` | `lastFramePrompt` | metadata |
| `camera` | `motionPrompt` / `promptLayers.camera` | metadata |
| `audioCues` + `dialogue` | `audioPrompt` | metadata |
| `bridgeHint` + `transition` | `transition` | metadata |
| `continuityFlags` + `entityDelta` | `continuity` | injected at build |
| `riskNotes` | `riskNotes` | record-only |
| `videoMode` | `engineHints.seedance.mode` | record-only |
| `promptMode` | `engineHints.seedance.promptMode` | record-only |
| `shotId` | scene title / external id | record-only |
| `keyframeGate` | production gate only | record-only |

Build `prompt` with the compact pattern from `shot-execution-schema.md` unless `promptMode` requires expansion.

## Conversion: Manifest → Seedance Adapter

`promptMode` controls rendering only. Never store Seedance timestamp prose back into the manifest.

### `compact` (default)

Use the compact director prompt in `scriptLanguage`. Keep `durationSec` in task fields, not in prompt prose. Budgets: `zh-CN` 120-220 chars / `en-US` 80-140 words for 12-15s clips (`references/locale-en-us.md`).

### `timestamp`

Render `timeSlots[]` when present; otherwise derive a 15s five-slot template **only if** `durationSec` is 12-15 and the shot is action-dense:

| Slot | Function |
|------|----------|
| 0-3s | establish |
| 3-6s | introduce_subject |
| 6-9s | develop |
| 9-12s | climax |
| 12-15s | resolve |

Do not force this template on dialogue-heavy or sub-12s clips.

### `semantic_shots`

Render as `镜头1：… 镜头2：… 镜头3：…` when timestamp control would over-constrain performance or dialogue.

### `videoMode` routing

| Mode | Use when |
|------|----------|
| `image2video` | Default; approved keyframe exists |
| `frames2video` | Twist, prop reveal, transform, cliffhanger |
| `multiframe2video` | Complex continuous action |
| `multimodal2video` | Fallback when references are rich |
| `extend` | Continue previous clip; prepend `将@视频1延长{N}s` |

## Director Review on Manifest

Run before storyboard finalization and again before video spend.

### P0 blockers

- Chapter content sufficiency failed for target duration — see `references/chapter-content-sufficiency.md`
- Beat-budget gate failed: no inventory, or `sum(shot.durationSec)` pads ≥25% over content budget with establish/empty/reaction — see `references/beat-budget-gate.md`
- Episode opener establish shot `>8s` with no new clue or audience question
- Outline/script cliffhanger prop or reveal absent from any shot
- Missing beat for a major preset anchor the user requested
- Shot `durationSec > 30` without `splitOf` child shots planned
- Shot has more than 2 `actionBeats` in a single executable clip
- Required dialogue or prop action absent from `actionBeats` / `dialogue`
- `keyframeGate: required` but no approved keyframe path planned
- Continuity drift vs `entityState`
- Future-beat leakage in `openingShot` / `endingShot` / dialogue
- Adjacent shots jump-cut without bridge or accepted risk

### P1 warnings

- `keyframeGate: optional` and no first-frame prompt
- Hard cut without match-on-action on a physical action
- Uniform 5s durations across an entire episode
- Auto-split output produces many sub-10s clips even though the beats could breathe as 12-15s continuous scenes
- `timeSlots` missing on a 12-15s action clip where timestamp mode is selected

### `accepted_risk`

User-approved exceptions. Record in `review.issues[]` with `tier: "accepted_risk"`.

## Worked Example (minimal)

```json
{
  "version": "1.1",
  "episode": 1,
  "title": "咖啡与工牌",
  "durationSec": 90,
  "aspectRatio": "9:16",
  "rhythmPreset": "hongguo爽剧",
  "beats": [
    {
      "beatId": "E01-B01",
      "atSec": 0,
      "type": "cold_open",
      "goal": "3秒内抛冲突",
      "audienceQuestion": "谁把咖啡泼在她工牌上？"
    },
    {
      "beatId": "E01-B02",
      "atSec": 30,
      "type": "small_climax",
      "goal": "第一个物理冲击",
      "presetTag": "hongguo_30s_burst"
    },
    {
      "beatId": "E01-B03",
      "atSec": 85,
      "type": "cliffhanger",
      "goal": "下一集钩子",
      "audienceQuestion": "电梯里那个人是谁？"
    }
  ],
  "shots": [
    {
      "shotId": "E01-S01",
      "beatId": "E01-B01",
      "index": 1,
      "startSec": 0,
      "endSec": 7,
      "durationSec": 7,
      "narrativeFunction": "外力施压",
      "beatType": "cold_open",
      "camera": "特写慢推",
      "openingShot": "特写，女主低头，咖啡泼在工牌上",
      "endingShot": "近景，女主抬眼，手指攥紧",
      "bridgeHint": "视线从工牌抬向走廊深处",
      "causalLinkToNext": "她决定去找泼咖啡的人",
      "continuityFlags": ["女主发型", "工牌位置", "咖啡污渍"],
      "entityDelta": { "prop:coffee_stain": "new" },
      "actionBeats": ["咖啡泼在工牌上", "女主抬眼攥拳"],
      "videoMode": "image2video",
      "promptMode": "compact",
      "keyframeGate": "required",
      "transition": "motivated_cut"
    },
    {
      "shotId": "E01-S02",
      "beatId": "E01-B02",
      "index": 2,
      "startSec": 7,
      "endSec": 31,
      "durationSec": 24,
      "narrativeFunction": "压迫升级",
      "beatType": "small_climax",
      "camera": "中景缓推",
      "openingShot": "走廊尽头，反派挡在门口",
      "endingShot": "女主停步，呼吸急促",
      "bridgeHint": "视线从反派胸前工牌切到女主手中咖啡杯",
      "actionBeats": ["反派逼近一步", "女主后退半步"],
      "modelRequirements": {
        "minDurationSec": 24,
        "requiresLongClip": true,
        "executionTier": "long_clip"
      },
      "promptMode": "semantic_shots",
      "keyframeGate": "required",
      "transition": "motivated_cut"
    }
  ]
}
```

## Round-Trip Rule

If generation fixes a shot during video QA, update **both**:

1. the manifest shot fields (`openingShot`, `endingShot`, `actionBeats`, `entityDelta`)
2. the human分镜稿 `△` lines

Never let JSON and分镜稿 drift.

## File Naming

Per episode:

- `E01_rhythm_manifest.json`
- `E01_分镜稿.md` (human layer)
- `wodeapp-import.json` or share doc (task layer)
