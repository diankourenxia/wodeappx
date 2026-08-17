# WodeApp Workflow Package Rules

Use this reference when converting a drama spec into WodeApp workflow data.

## Structure

- `groups`: episodes.
- `scenes`: individual generated-video clips / shots.
- `duration`: per-shot duration, not per-episode duration.
- `groupId`: episode id for every shot.
- `orderInGroup`: shot order inside the episode.
- `characterRefs`: character asset ids used in the shot.
- `locationRef`: optional scene/location asset id.
- `promptLayers`, `firstFramePrompt`, `lastFramePrompt`, `motionPrompt`, `audioPrompt`, `negativePrompt`, `transition`, `continuity`, `riskNotes`, `referenceRoles`, and `engineHints`: optional shot-execution metadata used by model adapters and reviews when supplied or needed.

## Workflow Data

The build script emits:

```json
{
  "project": {},
  "productVideoRun": {},
  "productVideoSectionConfig": {},
  "storyboardReviewSectionConfig": {},
  "workflowRun": {
    "collection": "workflow_runs",
    "data": {
      "title": "...",
      "status": "success",
      "workflowId": "storyboard-workflow",
      "steps": [],
      "ctxSnapshot": "{...json string...}"
    },
    "mcpTool": "create_workflow_runs",
    "mcpArgs": {
      "forceCreate": true,
      "data": {}
    }
  }
}
```

`ctxSnapshot` should contain:

```json
{
  "storyboard": {
    "assets": {
      "characters": [],
      "props": [],
      "scenes": [],
      "styleBible": {}
    },
    "groups": [],
    "scenes": []
  },
  "userIdea": {},
  "subjectImages": {},
  "productVideoRun": {},
  "productVideoSectionConfig": {},
  "storyboardReviewSectionConfig": {},
  "importMeta": {}
}
```

## Video Component Handoff

Use WodeApp's existing video production components for execution:

- Keep `StoryboardPipeline` / workflow data as the script, asset, and storyboard record.
- Before `ProductVideoSection`, expose a `WorkflowSection` storyboard review module bound to the saved `workflowRun.data.id`. This lets the user inspect the story script images, episode groups, characters, and scene assets before spending video credits.
- Feed `ProductVideoSection` with `productVideoSectionConfig.props.initialRuns`.
- A 90s episode must remain a group of multiple scenes; do not flatten it into one video scene.
- Every `productVideoRun.scenes[]` item should be one provider-sized clip. Default normal scenes toward 12-15s for continuity; keep 4-8s clips for hard hooks, inserts, reactions, or bridge shots; never submit a single scene over 30s.
- Local JSON packages are build artifacts, not the deployment mechanism. Sync run/share data through WodeApp REST/MCP interfaces so project scoping, auth, realtime collection events, and future migrations are honored.

Minimum section config shape:

```json
{
  "id": "storyboard-workflow",
  "type": "WorkflowSection",
  "props": {
    "title": "Story Script Images and Storyboard Review",
    "displayMode": "waterfall",
    "defaultRunId": "workflow-run-id",
    "phases": [
      {
        "id": "preview",
        "name": "Story Script Image Review",
        "renderer": "StoryboardPreview",
        "observe": ["storyboard", "subjectImages"]
      }
    ],
    "steps": [
      { "id": "input-idea", "type": "parallelForm", "name": "Input Idea", "outputKey": "userIdea" },
      { "id": "gen-storyboard", "type": "generateJSON", "name": "Generate Storyboard", "phase": "preview", "outputKey": "storyboard" }
    ]
  }
}
```

Then place the video section after it:

```json
{
  "type": "ProductVideoSection",
  "props": {
    "title": "Short Drama Video Workspace",
    "brandThemeId": "orange-light",
    "initialActiveRunId": "run-...",
    "initialRuns": [
      {
        "id": "run-...",
        "topic": "...",
        "inputSnapshot": {
          "ratio": "9:16",
          "mode": "std",
          "durationSec": 10
        },
        "subjects": [],
        "scenes": []
      }
    ]
  }
}
```

Each video scene should carry the minimal runnable fields:

- `id`, `name`, `prompt`, `duration`, `aspectRatio`, `mode`.
- `script`: the human-readable story beat / narrative intent.
- `prompt`: the provider-facing video generation prompt. Keep this separate from `script`; it should be a mechanical director prompt with camera, framing, character positions, visible actions, lighting, continuity, and negative constraints.

Optional execution fields should be preserved when present or when the shot needs them:

- `promptMode`: `compact` by default, `expanded` for fragile continuity or multimodal handoff.
- `promptLayers`: structured prompt parts in the order camera, lighting, subject/action, mood/continuity, audio, and style.
- `firstFramePrompt`: opening frame composition for first-frame image generation, fragile continuity, transformations, prop reveals, or product reveals.
- `lastFramePrompt`: ending frame composition, handoff, or cliffhanger.
- `motionPrompt`: visible camera/body/object movement, speed, and screen direction.
- `audioPrompt`: dialogue performance, sound effects, room tone, and sound bridges.
- `negativePrompt`: separate negative constraints for engines that support them. For Seedance, fold only critical bans into `prompt`.
- `transition`: adjacent-shot bridge such as match-on-action, sound carryover, light carryover, occlusion, or intentional hard cut when the adjacent shots need it.
- `continuity`: concise state that must not drift across clips: wardrobe, wounds, prop state, location geometry, clue state, and next-shot handoff.
- `riskNotes`: record-only metadata for platform/provider review risk and the accepted indirect depiction (e.g. graphic injury replaced by reaction + cut to black + siren). The visible `prompt` contains only the indirect version.
- `referenceRoles`: asset-role metadata for model adapters. Valid roles include `first_frame`, `last_frame`, `character_reference`, `scene_reference`, `prop_reference`, `motion_reference`, `audio_reference`, and `style_reference`.
- `engineHints`: model-specific metadata such as preferred engine, Seedance multimodal mode, Kling negative support, Runway concise prompt preference, Veo continuity strength, or Sora storyboard readiness.

- `prompt` should retain required shootable content from `script`: spoken lines, prop actions, product/device behavior, clue reveals, and ending state. Do not remove dialogue or key actions merely because they are already present in `script`.
- `prompt` should be written as a director can shoot it: concrete visible/audible details only. Replace abstract labels with evidence the camera can render, such as hand gestures, body posture, object placement, exact line delivery, screen glow, light change, and final frame.
- For key shots, store or imply an action-object contract in `script`, `prompt`, or metadata: actor, verb, target object, whether the actor touches it, distance, and continuity clue. Use this to keep mystery evidence stable across adjacent scenes.
- When a physical action crosses two clips, store or imply a match-on-action bridge: outgoing movement in the previous clip, incoming continuation in the next clip, same object/body part, and same screen direction. Do not require match-on-action for unrelated hard cuts.
- Critical evidence props should be represented in `assets.props`, `scene.propRefs`, and, when wearable, the relevant character reference. A wearable prop should include a fixed body position and negatives such as "not a tattoo, not a skin mark, not an imprint, not a brand".
- Keep canonical character assets in `productVideoRun.subjects`.
- Keep `scene.subjects` and `scene.imageList` as UI display snapshots when needed, but derive character entries from the canonical run-level subject URL each time the package is built or assets are replaced.
- `scene.imageList` may include global character images for preview/display, plus shot-specific media such as first frame, end frame, user-uploaded reference images, or scene-specific props. Do not let per-scene character URLs drift from `productVideoRun.subjects`.
- For Seedance submissions, attach scene/location/prop/product reference images only when they are human-free and clean-object/clean-space. Keep visible people and cloth-covered/body-like silhouettes out of those non-character reference images by default; if the user explicitly accepts the risk, record the override.
- Human-free scene/prop references should be paired with explicit text composition when the shot needs "protagonist + prop" or "protagonist + location": reference the character by name and LOOK code, describe the empty location, specify where the character is positioned, name the prop, state whether the character touches it, and define the ending frame.
- Recommended prompt pattern: `参考[角色名]，使用LOOK X；参考无人[场景名]作为环境；参考无人/单独[道具名]作为物体外观；角色在场景中的具体位置 + 对道具的动作 + 对白/声音 + 结尾画面`. Do not rely on a scene image to imply any actor action.
- `status: "idle"` before generation.

## Engine Adapter Matrix

Use `engineHints` without weakening WodeApp's canonical `script` and `prompt`.

| Engine | What to Preserve | Adapter Notes |
|--------|------------------|---------------|
| Seedance | reference roles, first/last frame, audio note, critical text bans | Map references to official first-frame / last-frame / reference-image / reference-video / reference-audio roles. Fold critical `negativePrompt` into `prompt`. Keep duration in task fields. |
| Kling | first frame, visible action, `negativePrompt`, mode/duration | Keep negative prompt separate. Respect 5/10s duration limits where applicable. Use image-to-video for identity-sensitive shots. |
| Runway | concise style, first frame, motion | Prefer short visual prompts and clear movement over long plot prose. |
| Veo | spatial layout, natural movement, continuity | Use fewer beats per clip, stronger physical continuity, and explicit ending state. |
| Sora | storyboard-safe narrative, first/last frame, content safety | Keep the WodeApp scene model ready for storyboard-style controls without assuming availability. |
| Auto | all canonical fields | Let WodeApp routing choose the engine, then verify the chosen engine did not drop required metadata. |

## Seedance Privacy False Positives

Seedream 5.0 photorealistic character sheets are valid synthetic character assets. If a video task fails with a downstream error such as:

```text
InputImageSensitiveContentDetected.PrivacyInformation
```

do not automatically conclude that the character image is an external real-person photo. First verify:

- the character or wardrobe asset was generated with text-to-image only using `doubao-seedream-5-0-260128`;
- no `imageUrl`, uploaded portrait, previous character image, screenshot, face reference, or old wardrobe sheet was used to create the character asset;
- the asset is stored as a project character reference with a `wardrobeMap` / provenance metadata;
- the scene prompt names the active `LOOK A/B/C` instead of relying on image text alone;
- no user-uploaded real-person portrait was accidentally mixed into `scene.imageList`.
- no scene/location/prop/product reference image in `scene.imageList` contains a person, face, body, portrait, actor-like silhouette, crowd figure, mannequin-like form, or cloth-covered/draped body-like shape.

Treat this as a provider safety false positive or submission-path issue unless provenance proves otherwise. Keep the Seedream 5.0 role asset as canonical. Before removing character references or using pure text-to-video, remove or regenerate suspicious non-character references first: cover cloth, draped sheet, blanket, curtain, mannequin-like shape, body-sized silhouette, reflective portrait-like surface, crowd, or scene images with any human-looking form. Retry with canonical character references plus fully textual scene/prop staging. If a temporary fallback is still needed for a single blocked task, make the fallback explicit in metadata and do not overwrite the character asset with a non-Seedream image.

## Step Outputs

Keep the workflow step outputs synchronized with `ctxSnapshot`.

- `gen-storyboard.output`: JSON string of `storyboard`.
- `gen-scene-images.output`: JSON string of `subjectImages`.
- `assemble-storyboard.output`: JSON string of a light preview object.

## Model Script Review

Before major first-episode rewrites or user-requested script audits, run a model review pass if platform text models are available. This is advisory, not a hard dependency for every package.

- Ask two or three suitable platform text models when available. Prefer strong long-context/reasoning reviewers with enough context for full episode packages, strong Chinese/English handling, and creative-writing critique ability. Query the platform model list when available instead of binding the workflow to fixed vendor names.
- Give both models the same episode script and ask for: 10-point score, top problems, whether a cold open/flashback is better, optimized shot outline, must-keep content, and must-delete/compress content.
- Use the results as critique, not as final truth. Merge overlapping notes, reject off-brief suggestions, then make one editorial revision.
- Store the evidence in `productVideoRun.scriptReview`, for example:

```json
{
  "ep01": {
    "version": "model-review-v1",
    "reviewedAt": "2026-07-04T00:00:00.000Z",
    "models": [
      { "model": "deepseek/deepseek-v4-pro", "score": "7/10", "summary": "..." },
      { "model": "bytedance/doubao-seed-2-pro", "score": "7/10", "summary": "..." }
    ],
    "decision": "Adopt cold open, keep massage-chair flashback, strengthen final chair reveal."
  }
}
```

## Director Review

Before syncing `productVideoRun` to a shareDoc or starting paid video tasks, run a compact director-review pass and store the result in `productVideoRun.directorReview` and/or `ctxSnapshot.importMeta.directorReview`.

The review should check:

- story beat and provider video prompt are separate;
- provider video prompt preserves every required dialogue line, clue, product action, and emotional turn from the script as visible or audible direction;
- prompt contains no unshootable filler such as "looks tired", "like a professional", "mysterious atmosphere", or "high-end feeling" unless grounded in camera-visible evidence;
- every clip stays within the provider duration limit;
- early hooks create a concrete question in the first 3 seconds through evidence, action, wound, object, phone/photo detail, dangerous distance, or animal marker;
- key props and evidence match across adjacent scenes;
- adjacent clips use match-on-action continuity only when one physical action spans the cut;
- critical evidence props exist as physical prop references and are not described as marks/imprints;
- important actions name the actor, verb, target object, touch/no-touch, and distance;
- prompt does not contain empty camera drift, strategy notes, or future-beat action;
- prompt does not prematurely explain hidden supernatural, crime, or relationship mechanisms before the story reveal;
- visual style remains locked to the selected style bible.
- no visible prompt carries more than 1-2 action beats; longer causal chains are split into chained scenes with lastFrame→firstFrame handoffs.
- review-risky beats (graphic injury, weapon discharge, sensitive imagery) use indirect depiction in `prompt` and record the decision in `riskNotes`.
- scene/location/prop/product image references passed to video generation are human-free; people appear only through approved character assets or text prompt descriptions.
- shots that combine people with human-free scene/prop/product references state the needed character LOOK, position, prop touch/no-touch, action, dialogue/sound, and ending frame in `script` and `prompt`.
- user-requested model script review, if any, is summarized in `productVideoRun.scriptReview` with the final editorial decision.

Treat P0 review errors as blockers before spending video credits. Warnings can be accepted intentionally, but should be visible in the workflow/share metadata.

## WodeApp API Notes

When inside a WodeApp repo, read the local `AGENTS.md` and `docs/API_BASE.md` before calling APIs. Do not hardcode legacy `/llmserver` paths.

For video workbench shareDocs, use the runtime data API:

```text
POST /runtime-server/api/v1/data/query
POST /runtime-server/api/v1/data/sync
PUT  /runtime-server/api/v1/data/:recordId
headers:
  X-API-Key: <api key>
  x-subdomain-project: <project id or slug>
collection:
  pvs_video_shares
data:
  { id, docId, run: productVideoRun, videoPromptVersion, characterAssetVersion, ... }
```

**Open the studio with the canonical URL only:**

```text
{projectLaunchUrl}?shareDoc={docId}
```

- Use `wodeapp.video_storyboard.open` (it syncs + opens + navigates). Do **not** hand-build `?pvsRun=` (legacy read-only; the page will migrate it but agents must not emit it). Always deliver `taskUrl` with `?shareDoc=<docId>` — never a bare project `launchUrl`. Do **not** use `update_page` / `publish_project` to bake storyboard runs into page JSON instead of `pvs_video_shares`.
- Reuse the same `shareDocId` for iterations; do not fork `pvs-wolf-ep02-vN` whole-package links.

For workflow run state, prefer:

```text
POST /runtime-server/api/v1/data/sync-run
headers:
  X-API-Key: <api key>
  x-subdomain-project: <project id or slug>
body:
  { data: { id, _rev?, ...runRecord } }
```

If a generated package is close to the runtime request body limit, split the handoff. `pvs_video_shares` usually only needs `productVideoRun`; full storyboard/archive snapshots can stay local or be synced separately.

For asset upload, the commonly used endpoint is:

```text
POST /runtime-server/api/v1/assets/upload
headers:
  X-API-Key: <api key>
  x-subdomain-project: <project subdomain/header>
multipart fields:
  file
  name
```

For image generation, use the current platform endpoint if available:

```text
POST /runtime-server/api/ai/image/generate
headers:
  X-API-Key: <api key>
  x-subdomain-project: <project subdomain/header>
json:
  prompt, model, size, n, sync
```

Always verify against the deployed project because payload sizes, model names, and auth rules can change.

## Validation Checklist

- `groups.length === episodeCount`.
- `scenes.length === episodeCount * shotsPerEpisode` unless intentionally varied.
- No scene duration exceeds max clip duration.
- Every storyboard scene has `groupId`, `orderInGroup`, `script`, `imagePrompt`, and `characterRefs`.
- Every product-video scene has a mechanical `prompt` that can be sent directly to a video model without story-planning notes.
- Product-video scenes preserve shot-execution metadata when supplied or needed: `promptLayers`, `firstFramePrompt`, `lastFramePrompt`, `motionPrompt`, `audioPrompt`, `negativePrompt`, `transition`, `continuity`, `referenceRoles`, and `engineHints`.
- Every required spoken line in `script` appears in `prompt` as dialogue or close paraphrase when it affects the beat.
- Every abstract emotional or professional state is backed by a visible action, object, sound, or line.
- Every fragile continuity, transformation, prop handoff, and cliffhanger scene has a first-frame and/or last-frame prompt.
- Engine-specific constraints remain machine-readable where possible; simple auto-routed shots do not need every adapter field.
- Characters include style/casting fields, not only names.
- Live-action human character assets have `model: "doubao-seedream-5-0-260128"` and text-to-image provenance; no image-to-image character generation unless explicitly overridden by the user and recorded.
- Scene/location/prop/product assets passed to Seedance are human-free unless the user explicitly accepts and records the risk. For protagonist-with-prop/location shots, the combination is described in both `script` and `prompt` rather than embedded into a scene/prop image.
- Asset URLs are absolute after upload.
- For major first-episode rewrites, model script review exists when requested or feasible, and its recommendations are not blindly copied.
- Director review exists and has no unresolved P0 errors; warnings can be recorded as accepted risk.
