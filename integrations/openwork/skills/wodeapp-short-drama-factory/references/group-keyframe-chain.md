# Group Keyframe Chain (`groupKeyframeChain`)

Group-level continuity strategy for short-drama video production. Use when a **scene group / episode block** needs stable spatial and character continuity across multiple provider clips.

## Core Rule

**先定整组节点帧，再按相邻节点做首尾帧视频。**

Do not treat each shot as an isolated image2video task when the group shares one location, wardrobe arc, or action path.

## Mental Model

```text
K0 开场帧
  → 镜头 1：K0 首帧 + K1 尾帧生成
K1 承接帧
  → 镜头 2：K1 首帧 + K2 尾帧生成
K2 承接帧
  → 镜头 3：K2 首帧 + K3 尾帧生成
...
```

- **K{n}** = keyframe node on the group timeline (storyboard still)
- Shot **n** uses `firstFrame = K{n-1}`, `lastFrame = K{n}`
- Shot **n+1** opens where shot **n** ended because both share **K{n}**

## When to Use

| Signal | Use `groupKeyframeChain` |
|--------|--------------------------|
| 3+ shots in same location with continuous blocking | Yes |
| Character wardrobe / wound / prop state must carry | Yes |
| Dialogue scene with subtle camera moves only | Often yes |
| Unrelated montage hooks | No — keep independent clips |
| Single 8s hook | No |

Set on the **group** (episode / act), not globally on the series:

```json
{
  "id": "episode_01",
  "continuityStrategy": "groupKeyframeChain",
  "keyframeNodes": [
    { "nodeId": "K0", "atShotId": "E01-S01", "role": "opening", "prompt": "..." },
    { "nodeId": "K1", "atShotId": "E01-S02", "role": "bridge", "prompt": "..." }
  ]
}
```

## Production Flow

1. **Plan shots in `EpisodeRhythmManifest`** — dramatic `durationSec` first; derive `modelRequirements` / `executionTier` later.
2. **Generate group node frames** — for N executable shots, plan **N+1** keyframes (opening + bridges + ending).
3. **Approve keyframes** when `keyframeGate: required` on cold_open, twist, cliffhanger, fragile continuity.
4. **Map each shot to adjacent nodes** — shot 1 → K0/K1, shot 2 → K1/K2, etc.
5. **If nodes contain characters, use Ark temp asset flow** (`generate-with-ark-keyframes`): temp upload → Ark Active → frames2video → cleanup temp Wode assets after success.
6. **Keep character master assets** — turnaround sheets, LOOK tables, prop bibles stay in long-term `assets.*`; node frames are **execution temps**.

## Manifest / Package Fields

| Field | Layer | Notes |
|-------|-------|-------|
| `openingShot` / `endingShot` | Manifest shot | Human-readable bridge anchors |
| `bridgeHint` | Manifest shot | How K{n} hands to K{n+1} |
| `keyframeGate` | Manifest shot | `required` before video spend |
| `videoMode: frames2video` | Execution adapter | Maps to `firstlast` task type |
| `firstFrameUrl` / `lastFrameUrl` | Scene JSON | Populated after node frame gen |
| `continuityStrategy` | Group metadata | `groupKeyframeChain` |

Do **not** store `providerModel` in the manifest. Duration tiers still come from `modelRequirements`.

## Relation to Execution Tiers

- `groupKeyframeChain` is orthogonal to `executionTier`.
- A 24s dramatic shot may still be `long_clip` (needs SD2.5 when configured).
- A group can mix 8s + 12s + 18s shots; each shot keeps its own badge (`通用` / `需 SD2.5` / `需拆分`).

## Anti-Patterns

- Generating video per shot without shared node frames, then hoping prompt continuity holds.
- Deleting character master assets when cleaning temp Ark keyframes.
- Using covered-cloth / silhouette props in human-free location refs (Seedance misread risk).
- Forcing every group into 15s equal clips — node count follows **drama**, not provider default.

## References

- `references/episode-rhythm-manifest.md` — shot timing truth source
- `references/shot-execution-schema.md` — first/last frame + Ark flow
- `scripts/build_wodeapp_drama_package.mjs` — manifest → scene JSON (`videoMode` → `taskType`)
