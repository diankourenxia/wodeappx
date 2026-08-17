# Shot Execution Schema and Engine Adapters

Use this reference when a short-drama scene needs more than the minimal WodeApp video fields. The goal is to keep ordinary clips compact while preserving enough metadata for fragile continuity, multimodal references, and engine-specific adapters.

Episode-level timing and beat structure live in `EpisodeRhythmManifest` (`references/episode-rhythm-manifest.md`). This document covers per-scene execution fields after manifest conversion.

Most shots need only `script`, `prompt`, `duration`, `aspectRatio`, `mode`, and `subjects`. Add the optional fields below only when continuity is fragile, transformations occur, reference media must be mapped to engine roles, or a selected provider can use the extra adapter metadata.

## Minimal Scene

Every generated-video scene should be runnable with these fields:

```json
{
  "script": "Human story beat and intent.",
  "prompt": "Provider-facing director prompt.",
  "duration": 10,
  "aspectRatio": "9:16",
  "mode": "std",
  "subjects": []
}
```

`prompt` is the human-inspectable field a generic engine can run. Keep it concrete: camera-visible action, blocking, prop state, spoken/audio cues, and ending frame. Keep technical settings such as duration, resolution, mode, and model in task fields.

## Optional Execution Fields

Add these fields only when supplied in the creative spec or when the shot needs them:

```json
{
  "promptMode": "compact",
  "promptLayers": {
    "camera": "Camera origin, movement, shot size, screen direction.",
    "lighting": "Practical light, color temperature, shadows, motivated changes.",
    "subject": "Characters, props, action, and dialogue.",
    "mood": "Only mood expressed through visible behavior, light, sound, or pacing.",
    "audio": "Dialogue, room tone, sound effects, sound bridge.",
    "style": "Locked visual style and concise negative constraints."
  },
  "firstFramePrompt": "Opening composition for image-to-video or preview.",
  "lastFramePrompt": "Ending composition, handoff, or cliffhanger.",
  "motionPrompt": "Camera, character, and prop movement only.",
  "audioPrompt": "Sound design and spoken line notes.",
  "negativePrompt": "Bans for engines that support a separate negative field.",
  "transition": "Only when adjacent clips need a physical, sound, light, or object bridge.",
  "continuity": "Wardrobe, wounds, prop state, location geometry, clue state, handoff.",
  "riskNotes": "Platform/provider review risk and the accepted indirect depiction. Record-only; the prompt already contains the indirect version.",
  "referenceRoles": [
    { "assetId": "char_ivy", "role": "character_reference", "name": "Ivy" }
  ],
  "engineHints": {
    "preferredEngine": "seedance",
    "seedance": {},
    "kling": {},
    "runway": {},
    "veo": {},
    "sora": {}
  }
}
```

Use `promptMode: "compact"` by default. Use `promptMode: "expanded"` for transformations, prop handoffs, first/last-frame continuity, complex staging, multimodal reference roles, or repeated failed generations.

## Injected vs Record-Only Fields

Execution metadata has two classes. Confusing them causes prompt bloat or continuity drift.

- **Injected**: stored once, re-expanded into every visible `prompt` at build time because video models have no cross-clip memory — style lock + negative style, `continuity` state (active LOOK, wounds, prop state, location geometry), casting anchors for visible characters, and critical bans (fold into `prompt` for engines without `negativePrompt`).
- **Record-only**: never written into the visible `prompt` — `duration`, `aspectRatio`, `mode`, `model`, `riskNotes`, `engineHints`, `referenceRoles` (mapped to engine slots, not prose), timecodes, shot numbers, word counts, and strategy notes (hook intent, plot function).

One more hard limit: a single provider prompt should carry at most 1-2 action beats. Longer causal chains must be split into chained scenes with lastFrame→firstFrame match-on-action handoffs (see `references/storyboard-source-format.md`).

## Compact Prompt Pattern

For simple provider-sized beats, aim for a compact provider prompt. Normal executable scenes should trend 12-15s for continuity; 4-8s clips are reserved for hard hooks, inserts, reactions, or bridge shots.

1. Style or reference lock.
2. Location and camera origin.
3. Character with active `LOOK` code if relevant.
4. One main visible action plus required spoken/audio cue.
5. Prop/device state or clue if the beat depends on it.
6. Ending frame.
7. Concise text/subtitle/watermark ban.

Do not turn the prompt into a full planning memo. Store adapter details in optional metadata fields.

Compact example:

```text
风格：写实竖屏短剧；参考角色[林薇]LOOK B、场景[无人西厢房]、道具[旧按摩椅]。林薇站在椅子左侧，指尖悬在蓝色侧灯前，侧灯忽然亮起，她低声说“这不是我家的椅子”。结尾定格在她手指停在发光按钮前。无字幕、无水印、无可读UI文字。
```

## Expanded Prompt Pattern

Use expanded prompts when visual continuity is fragile:

1. Style lock and exact reference tags.
2. Camera origin, shot size, movement, and spatial staging.
3. Character positions, entry direction, relationship distance, and active `LOOK`.
4. Visible action and prop state change.
5. Spoken dialogue or audible cue.
6. Ending frame or handoff to next clip.
7. Critical negative constraints.

Action-object contracts are useful for mystery clues and product/device shots, but they are not required for ordinary reaction or travel beats.

## Engine Adapter Notes

### Seedance

- Map `referenceRoles` into the official first-frame, last-frame, reference-image, reference-video, or reference-audio slots when those assets exist.
- Keep duration in task fields unless the execution surface explicitly asks for timestamped text.
- Render timestamp blocks from `EpisodeRhythmManifest.shots[].timeSlots[]` only when `promptMode` is `timestamp`. Do not store timestamp prose back into the manifest.
- Since Seedance does not support a separate `negativePrompt`, fold only critical bans into `prompt`.
- For scene/location/prop/product references passed to Seedance, prefer human-free reference images and rebuild the human composition in text.
- If Seedance flags privacy on a shot with character plus scene/prop references, inspect and remove suspicious non-character images first, especially covered-cloth, draped, sheet-covered, mannequin-like, body-shaped, reflective, portrait/crowd, or silhouette-like references. Retry with character references plus textual scene staging before falling back to pure text-to-video.

### Kling

- Keep `negativePrompt` separate where supported.
- Respect provider duration and mode limits.
- Use first-frame image-to-video when identity consistency matters.

### Runway

- Prefer concise visual prompts plus clear movement.
- Use `motionPrompt` or first-frame references instead of overstuffed plot prose.

### Veo

- Give strong physical continuity, spatial layout, and natural action.
- Use fewer, clearer beats per clip.

### Sora

- Keep storyboard-safe narrative descriptions and content-safety notes.
- Preserve first/last-frame and continuity metadata so the package can map to storyboard-style controls later.

## Review Tiers

P0 blockers before spending video credits:

- Missing `script` or runnable `prompt`.
- Prompt cannot be filmed or heard.
- Required dialogue, prop action, clue, product behavior, or ending state was dropped.
- Clip duration exceeds the selected provider limit.
- Spoken dialogue exceeds locale budget for `durationSec` (`references/locale-en-us.md`, `references/episode-rhythm-manifest.md`). Builder fails on manifest overflow.
- Critical prop, wardrobe, wound, or style continuity drifts.
- Prompt reveals a future beat or hidden mechanism too early.
- Unsafe or wrong reference image type is attached to the engine.

P1 warnings that can be accepted intentionally:

- Optional first/last-frame prompt absent on a simple beat.
- `motionPrompt`, `audioPrompt`, `negativePrompt`, `referenceRoles`, or `engineHints` absent when the selected engine does not need them.
- Hard cut used instead of match-on-action when the physical action does not cross clips.
