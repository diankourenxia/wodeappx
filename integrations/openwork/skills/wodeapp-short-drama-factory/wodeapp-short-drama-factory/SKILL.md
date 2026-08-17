---
name: wodeapp-short-drama-factory
description: "End-to-end WodeApp short-drama production pipeline. Use when Codex needs to create or batch-produce a vertical short drama package from an idea: market positioning, logline, season outline, episode hooks, full episode scripts, clip splitting for video duration limits, character bible, casting/style bible, scene assets, character turnaround sheets, transformed animal/power forms, WodeApp workflow import JSON, and Seedream 5.0 asset generation/upload."
---

# WodeApp Short Drama Factory

Use this skill to turn a short-drama idea into a WodeApp-ready production package, then generate selectable assets.

Shared prompt and duration rules live in `references/shared-prompt-contract.md`, generated from `server/src/config/dramaPrompts/shortDramaContracts.ts`. After changing that source, run `pnpm sync:short-drama-contracts`.

## Core Workflow

1. **Clarify production constraints**
   - Target audience and region.
   - Total duration, episode count, per-episode duration.
   - **Locale**: set `series.scriptLanguage` (`zh-CN` default, `en-US` for North American / English scripts). When `en-US`, read `references/locale-en-us.md` before writing dialogue, prompts, or rhythm manifests.
   - When you need the user to confirm direction before writing, explain the choices in natural language **and** append a `wodeapp-choices` JSON block (see below). Do not expect the UI to guess options from keywords.
   - Max generated-video duration per clip is resolved at **execution time** from the model catalog, not during script authoring. When planning, write each shot's dramatic `durationSec` first, then derive `modelRequirements` (`universal` / `long_clip` / `must_split`). Prefer executable clips near **15s** for continuity when the story beat can breathe naturally, but do not pre-split a true 24s continuous beat just because Seedance 2.0 exists.
   - Source mode: idea, supplied script, supplied novel/prose, or supplied storyboard. Preserve supplied scripts as source truth; do not silently expand a concrete script back into a vague idea.
   - For prompt-first storyboard sources (集号-镜号 header, `AI镜头提示`, `△` action beats, VO/dialogue, sound cues), read `references/storyboard-source-format.md` and follow its conversion table. The storyboard is the authoring layer; conversion produces `scene.script`/`scene.prompt` plus metadata directly — do not build a separate intermediate shot-plan document.
   - Target video engine(s) and reference strategy: Seedance multimodal/extension, Kling image/video, Runway style clips, Veo longer natural motion, Sora/storyboard reserve, or WodeApp auto routing.
   - Cost safety hard limit: submit at most **4 video generation tasks per execution/batch** unless the user explicitly asks for another batch after seeing the cost/state. Never bulk-submit a full episode or season automatically when it exceeds 4 clips.
   - Visual mode: live-action, anime, comic, 3D, etc. Lock this before generating assets.
   - WodeApp project URL, subdomain header, and API key source only when the user wants direct sync/publish. For planning-only work, leave sync fields as TODOs instead of blocking story generation.

2. **Create the story bible**
   - Write logline, core mystery, relationship engine, season promise, and reveal sequence.
   - Design first 3 episodes with very strong 3-second hooks. A strong hook can be explosive, quiet, intimate, eerie, or progressive; it only needs to create an urgent question.
   - Do not explain the supernatural mechanism before the story has earned it. Early clips may show product use, fatigue, ritual, weather, a screen glow, or a small anomaly; they should not reveal the full time-travel cause unless that reveal belongs in the beat.
   - Split each episode into enough shot beats to respect the clip duration limit. **Do not assume 90s or 120s.** Derive episode length from the beat-budget inventory (`references/beat-budget-gate.md`); fast vertical often lands **60–75s** with ~6 shots of uneven durations. Only after budget is known, pack toward ~12–15s executable clips when a beat group can fill them; preserve a supplied shot count only when it still passes the density gate.
   - Treat the first few episodes' opening clips as hook-driven edits. Hooks can build in layers instead of exploding immediately. Normal clips should stay concise but do not need 4-6 cuts every time.
   - Avoid putting an entire episode into one video generator call when clip max duration is lower than the episode duration.
   - Create a continuity ledger for repeated clues, wounds, props, wardrobe look codes, location geometry, and unresolved questions. The ledger should feed every later shot prompt.
   - Maintain a **season emotional ledger** alongside it: unpaid emotional threads in free language (`emotionalDebts` with `label` + `emotionalGoal` + `visibleMarkers`), relationship shifts, promised payoff episodes, and `episodeEmotionalMode` per ep. See `references/emotional-arc-ladder.md`.
   - Treat recurring physical objects as continuity assets, not prompt decoration. Any prop, product, furniture item, weapon, vehicle, clue, screen/device, note, medicine, or ritual object used in 2+ scenes, touched/pointed at by a character, shown in close-up, revealed as a clue, or needed for spatial continuity must be promoted to a standalone resource before scene generation.
   - For long-form or highly visual projects, optionally draft a 25-beat planning table before final shots: beat number, duration, visual content, shot size/camera, continuity function, and generation risk. Do not replace WodeApp groups/scenes with the table; use it as planning scaffolding.
   - For episode-level timing, create an `EpisodeRhythmManifest` per episode before bulk分镜稿 or scene JSON work. Read `references/episode-rhythm-manifest.md` and validate against `references/episode-rhythm-manifest.schema.json`. The manifest is the machine-checkable truth source for beats, shot durations, bridges, and review tiers; human分镜稿 and engine prompts are adapter outputs derived from it.

3. **Run the P0 script flow gate before drafting full episode scripts**
   - This gate is about story text quality, not video prompt mechanics. It must pass before generating or rewriting full episode scripts: first make the script short, clear, visible, layered, prop-driven, and ending on a concrete question.
   - Keep development materials separate from shooting pages. IP introductions, season pitches, 40-episode summaries, character bios, reveal maps, and market positioning are pitch/development materials; they must not leak into single-episode shooting text. Shooting text should contain only scene headings, `△` action beats, dialogue, essential sound/VO cues, and episode-end markers.
   - Each episode should add at most one major new setting term, ability term, faction name, ritual rule, or mythology noun. If more are needed, push one into a later episode or turn it into a visible clue without naming it yet.
   - Each scene advances one clear purpose only: meeting, testing, exposing, attacking, rescuing, bargaining, confirming a relationship, or revealing one clue. If a scene explains backstory, reveals a mechanism, escalates romance, and starts a fight at the same time, split it.
   - For vertical short episodes, default to 2-3 scenes per episode. If an episode is 3-5 minutes, 3-5 scenes are acceptable, but each scene still does one job.
   - The first 3 seconds must create a question the audience can say out loud, such as "why is he here?", "why did she survive?", "why is his name on the list?", or "why does the collar punish her?" Do not answer all early mysteries in the first three episodes.
   - Prefer event before explanation and image before concept. Show the body healing, the collar shocking, the unpaid worker losing wages, the ring still kept, the U disk breaking, or the door left unlocked before a character explains what it means.
   - Write one visible action per line and one main action plus one emotional or plot turn per shot beat. Search for "feels", "realizes", "inner", "understands", "意识到", "内心", "感到", and "觉得"; rewrite those sentences into visible action, spoken lines, sound, object state, or lighting change.
   - Dialogue should be short. One line should carry one meaning. More than three consecutive explanatory lines from the same character is a blocker: split the information into an event, a prop reveal, a cutaway, or a later scene.
   - Use props as information carriers, not decoration. Repeated props should follow a question -> conflict -> reveal progression, and they belong in the continuity/prop ledger when they drive recognition, emotion, or plot.
   - Repeated images or lines may create style, but after three uses they must change state: the gun is drawn, handed over, missing, or unloaded; the ring is found, returned, broken, or hidden; the flower is rejected, kept, wilted, or used as evidence.
   - Each episode should shift at least one relationship label in the audience's mind: stranger -> rescuer, rescuer -> suspect, enemy -> reluctant ally, contractor -> co-conspirator, lover -> threat, or ruler -> partner. Use one action or one short line to mark the shift.
   - **Emotional arc ladder:** hooks/twists need **earned** emotion, but pressure may **build across episodes** — not every episode must release inside 90s. Read `references/emotional-arc-ladder.md`. Mark each episode `episodeEmotionalMode` (`buildup` | `payoff` | `bridge` | `mixed`). Maintain `seasonEmotionalLedger` with `emotionalDebts` described in natural language (not a fixed emotion taxonomy). `buildup` episodes may end on cliffhanger without `emotional_release`; `payoff` episodes may rely on ledger from prior eps. Bare plot twists with zero prior emotional accumulation (in-episode or ledger) remain blocked.
   - Every episode ending should land on a concrete unresolved question, image, object, line, or relationship turn. Do not end by summarizing the theme or explaining the lesson.
   - After drafting an episode, run a simple deletion pass: remove any line that does not change action, relationship, clue state, danger, or emotion. If deleting it does not hurt comprehension or tension, it should not stay.
   - **Gate 0 — chapter content sufficiency (before any video script):** Read `references/chapter-content-sufficiency.md`. Give every episode outline a `contentPlan` with event-level seconds, information upgrades, irreversible decision, and visible ending hook; regenerate it after structural rewrites. If content only supports ~70s, do **not** emit a 120s shot list — expand the episode script or lower the target. Outline hooks (e.g. handwriting match) must appear in the shooting text.
   - **script.wodeapp.cn cross-review (product path):** After episode body exists, follow `references/episode-cross-review.md`: free Gate 0 → two independent dynamically discovered text models (capacity + craft) in parallel → deterministic local merge → review card. Cache by `scriptHash` + `targetDurationSec`. Prefer `episode.targetDurationSec` over project `form.duration`. Expand the current episode with merged fixes before video script.

3a. **Run the beat-budget gate before any video script / 分镜时长**
   - **内容先估秒，再组镜头。** Never lock `120s / 8×15s` first and pad with atmosphere. Read `references/beat-budget-gate.md` (after Gate 0).
   - Distinguish **edit beats** (one visible change) from **AI executable shots** (provider clips; min 4s per `shortDramaContracts.durationPolicy`). Do not assign edit-beat seconds from a lookup table.
   - Split the episode into a beat inventory, then ask a text model to judge timing from the full performance context: overlapping dialogue/action, acting pace, reaction, pause, prop handling, and transition. Never use characters-per-second, lines-per-second, or `each △ = N seconds`.
   - `episodeBudgetSec = sum(beat seconds)`. Fast-paced default sweet spot **60–75s/ep**. Use 90–120s only when Gate 0 inventory truly needs it or the user explicitly asks **and** expands plot.
   - Pack model-timed beats into shots (≤2 action beats per shot). Shot duration = sum of those model-authored timings — do **not** default every shot to 15s; do not emit sub-4s AI clips.
   - P0 blockers: Gate 0 failed; padding ≥25% over budget with establish/empty/reaction; opener establish >8s with no question/clue; outline cliffhanger missing from shots; ≥3 plot points in one shot; uniform N×15s when most shots cannot fill 8s of real action.
   - Put the episode-end hook (prop match, evidence, relationship turn) into the budget **first**, then schedule earlier beats.

3b. **Build the episode rhythm manifest before分镜稿 and scene JSON**
   - Principle: **镜头由剧本决定，模型由镜头需求决定。** Author `durationSec` from the beat-budget inventory first; do not pre-bind the manifest to Seedance 2.0 / 2.5 or to a fixed 8×15 grid.
   - One manifest per episode: `E{NN}_rhythm_manifest.json` (schema v1.1).
   - Set `rhythmPreset` to match the market/genre (`hongguo爽剧`, `na_micro_drama`, `suspense_ladder`, `emotional_wave`, `product_reveal`, `brand_story`, or `custom`). US / `en-US` projects default to `na_micro_drama` or `suspense_ladder`, not `hongguo爽剧`. Presets suggest macro beat anchors only.
   - Define `beats[]` for macro hooks: cold_open, emotional_pressure, small_climax, emotional_release, twist, satisfaction, cliffhanger, etc. Each beat needs `beatId`, `atSec`, `type`, `goal`, preferably `emotionalGoal`, and preferably `audienceQuestion`. See `references/emotional-arc-ladder.md`.
   - Define `shots[]` as dramatic clips: every shot links to one `beatId`, covers the episode timeline without gaps, and carries at most 2 `actionBeats`. Use **12-15s** as the default continuity-friendly execution target; reserve 4-8s for hard hooks, inserts, reactions, and bridge shots.
   - Derive `modelRequirements` from each shot's `durationSec`: `universal` (<=15s), `long_clip` (16-30s), `must_split` (>30s). Do not store `providerModel` in the manifest.
   - Fill continuity fields on every shot: `openingShot`, `endingShot`, `bridgeHint`, `causalLinkToNext`, `continuityFlags`, and `entityDelta` when state changes.
   - Keep spoken dialogue within locale budget per `durationSec` (`references/locale-en-us.md` for `en-US` word caps; `zh-CN` char caps in `references/episode-rhythm-manifest.md`). Optional `shots[].dialogueWordBudget`; builder fails on overflow.
   - Set `keyframeGate`: `required` for cold_open, twist, prop_reveal, transform, cliffhanger, and fragile spatial continuity; `optional` for normal dialogue/reaction; `skip` for simple transitions.
   - At execution time: `<=15s` may use Seedance 2.0 / 2.5 and should be preferred when it can preserve the beat; `16-30s` requires long-clip engines such as Seedance 2.5 and should be used only when splitting would hurt performance/action continuity; `>30s` must be split or use extend/long-video strategy before spending credits.
   - Choose `videoMode` and `promptMode` per shot at adapter time. Default `image2video` + `compact`. Timestamp or semantic rendering is an adapter output, not manifest storage format.
   - Run manifest director review with tiers from `references/episode-rhythm-manifest.md` and `references/shot-execution-schema.md` before converting to分镜稿 or spending video credits.
   - Convert manifest → human分镜稿 → WodeApp `scene.script`/`scene.prompt` using the tables in `references/episode-rhythm-manifest.md`. Do not maintain three diverging truths.

4. **Create the character bible**
   - Give every recurring character: role, age, ethnicity/casting anchor, skin tone, body type, face/hair/eyes, wardrobe silhouette, signature prop/mark, relationship tension, reveal timing, transformed/power form, plus **emotionalCore**, **defaultMode** (free phrase for how they usually carry emotion), **visibleTell**, and **releaseStyle**. Do not limit emotions to humiliation, misunderstanding, or any fixed category list — see `references/emotional-arc-ladder.md`.
   - For characters with multiple story costumes, create a wardrobe map with stable look codes such as `LOOK A`, `LOOK B`, and `LOOK C`. Each look should include episode usage, clothing, hair, makeup, accessories, and continuity notes.
   - Prefer one labeled multi-look wardrobe sheet per character over many separate single-costume assets when the same actor/face must stay consistent. Keep the same face, body, hairline, and proportions across every panel.
   - Do not rely only on text drawn inside the generated image. Store the look-code mapping in the character description and in scene prompts, because image text may be imperfect or ignored by video models.
   - For female-audience romance/fantasy, keep male leads visually distinct in face, body, wardrobe, animal identity, and emotional function.
   - Keep all romantic/sensual characters clearly adult.

5. **Create the asset style bible**
   - Define one production style before generation. Example: live-action North American premium vertical drama.
   - Include hard negative constraints. Example: not anime, not manga, not 3D render, not game concept art, not plastic skin.
   - Use the same style bible in character prompts, scene prompts, storyboard prompts, and video prompts.
   - Define a prompt-layer order for expanded prompts: camera/spatial staging first, lighting, subject/action, mood/continuity, audio, then style lock and negative constraints. Use it as an organizing aid, not as a reason to overfill simple shots.

6. **Build the WodeApp package**
   - Use `scripts/build_wodeapp_drama_package.mjs` when the creative spec is already structured as JSON.
   - When `rhythmManifestPath`, inline `rhythmManifest`, or per-episode `episodes[].rhythmManifestPath` is present, treat `EpisodeRhythmManifest` as the shot timing truth source. The builder maps `shots[]` → executable `scenes[]` with `durationSec`, `modelRequirements`, and `executionTier`; it does **not** inject `providerModel`.
   - Legacy `episodes[].panels[]` still works when no manifest is attached.
   - Treat generated JSON as a local import package / backup artifact only. Do not treat a JSON file copy or direct database write as the normal WodeApp sync path.
   - Treat episodes as `groups`; treat individual executable shots as `scenes`, targeting about 15s when auto-splitting and never exceeding 30s in a single submitted scene.
   - Include `assets.characters`, `assets.scenes`, `groups`, `scenes`, `subjectImages`, and workflow step outputs.
   - Also emit `storyboardReviewSectionConfig`, `productVideoRun`, and `productVideoSectionConfig` so the WodeApp page shows story script images / storyboard review before `ProductVideoSection` per-shot video generation tasks.
   - Build an asset dependency ledger before finalizing scenes. Repeated props must appear in `assets.props` or equivalent with a stable `id`, `name`, `asset`/`assetUrl` when available, `description`, and `referenceRole: "prop_reference"`. Scenes that use them must list `scene.propRefs`; if a human-free location asset already contains the prop, also list the location in `scene.sceneRefs` and keep the prop reference separate.
   - Keep story and video-generation text separate but not content-separated: `scene.script` is the human story beat, and `scene.prompt` is the provider-facing video direction. Any dialogue, prop action, product behavior, clue, or emotional turn required by the beat must appear in the prompt as visible or audible instructions. Do not drop dialogue from the prompt just because it already appears in `script`.
   - Treat WodeApp video prompts as shootable director instructions, not summaries. Replace abstract descriptions with things the model can render: gestures, body position, object placement, lighting change, camera movement, spoken lines, on-screen action, and ending frame.
   - Rewrite unshootable filler such as "looks tired", "like a doctor", "mysterious atmosphere", or "high-end feeling" into visible or audible evidence. Example: "she rubs sore thumb joints, loosens stiff fingers, drops her work bag, and says she massaged clients for ten hours".
   - Also rewrite non-diegetic knowledge the model cannot know: character identity, backstory, legal status, and plot function. `逃脱了法律制裁的黑心财阀李董` becomes `中年男人穿深色西装，表情狂妄大笑，保镖簇拥`. Only visible/audible evidence survives conversion into `scene.prompt`; the source language stays in `scene.script`.
   - Limit each provider prompt to 1-2 action beats. Multi-beat causal chains (e.g. push cup → cat startles → rider swerves → hydrant bursts) drop or reorder events when sent as one prompt; split them into chained scenes along `△`/beat boundaries using lastFrame→firstFrame match-on-action handoffs. See `references/storyboard-source-format.md`.
   - Classify execution metadata as injected or record-only. Injected fields (style lock, continuity/LOOK state, casting anchors, critical bans) are stored once but must be re-expanded into every visible `scene.prompt` at build time because video models have no cross-clip memory. Record-only fields (duration/mode/model, `riskNotes`, `engineHints`, `referenceRoles`, timecodes, strategy notes) never enter the visible prompt.
   - Record platform/provider review risk in `scene.riskNotes` and keep only the indirect depiction in `scene.prompt`. Example: a rebar-impalement beat ships as thrown rebar + reaction + cut to black + siren audio, with `riskNotes` documenting the original beat and the accepted indirect treatment.
   - When scene/location/prop/product images may be passed to Seedance as reference images, keep those non-character references human-free and clean-object/clean-space only. Avoid covered-cloth, draped, sheet-covered, mannequin-like, body-shaped, or silhouette-like props/scenes because they can be misread as privacy-sensitive human figures. Human characters can still appear in the final video through approved character assets or text prompt descriptions.
   - For shots combining people with a human-free scene/prop/product asset, rebuild only the needed composition in text: who appears, active LOOK code, position, touched/untouched prop, action, sound/dialogue, and ending frame. Example: `参考[林薇]，使用LOOK C夜间披肩旗袍；在无人[顾府西厢时空房]里，她站在[时空按摩椅]左侧，右手悬在蓝色侧灯前，侧灯忽然亮起`. **Do not bracket dialogue-only / off-screen / voiceover-only characters** — write their lines as quoted speech or narration without `[name]`.
   - Default to compact provider prompts. For normal 12-15s executable beats: **`zh-CN` 120-220 characters** or **`en-US` 80-140 words** — style/reference, location, character blocking, one visible action, sound/dialogue if needed, ending frame, and concise text/watermark ban. Short 4-8s clips should stay even leaner. Expand only for fragile spatial continuity, transformations, prop handoffs, multimodal references, or repeatedly failed generations (`references/locale-en-us.md`).
   - Generation parameters such as `aspectRatio`, `resolution`, `duration`, `mode`, and `model` must live in scene fields / run input snapshots / API task input, not inside the visible `scene.prompt`. The prompt may say the visual style is vertical drama when useful, but do not write literal settings like `9:16`, `480p`, or `15秒镜头` as scene content.
   - Preserve shot-execution metadata when supplied or needed: `promptLayers`, `firstFramePrompt`, `lastFramePrompt`, `motionPrompt`, `audioPrompt`, `negativePrompt`, `transition`, `continuity`, `riskNotes`, `referenceRoles`, and `engineHints`. Do not force all fields onto every normal shot; keep extra adapter details as metadata instead of inflating the visible `scene.prompt`.
   - Use first/last-frame descriptions for fragile continuity, product reveals, prop handoffs, entrances, exits, and transformations. The first frame should define the opening composition; the last frame should define the handoff or cliffhanger.
   - Use `motionPrompt` to describe visible movement only: camera path, body movement, prop movement, speed, and screen direction. Avoid hidden intention or strategy labels.
   - Use `audioPrompt` for natural sound, dialogue delivery, phone/radio/room tone, impact sounds, and sound bridges. Keep dialogue spoken/performed, not rendered as text.
   - Use `negativePrompt` as model-adapter metadata where supported; for Seedance, merge critical negative constraints into the visible prompt because Seedance does not support a separate `negativePrompt`.
   - For Seedance-compatible prompts, write explicit reference roles such as first frame, last frame, character reference, scene reference, prop reference, motion reference video, or audio reference. Use official `@图片N` / `@视频N` / `@音频N` language only when the execution surface will map those references.
   - For cross-clip continuity, prefer match-on-action, occlusion, light carryover, sound carryover, doorway movement, or object placement continuity. Avoid "no hard cuts" as a universal rule for short-drama pacing; use it when the two generated clips must feel physically continuous.
   - Expanded 15-second prompts usually work best in this order: style lock; exact reference tags; positive spatial staging; character blocking and entry direction; visible hand/body actions; spoken dialogue or audible cue; prop/device behavior; ending frame; concise negative constraints.
   - Prefer positive spatial staging over patch-style negation. Describe the camera origin, doorway, window, wall/floor material, furniture positions, weather/light evidence, and movement path so the model can construct the set correctly, e.g. `镜头从密室内门门槛外向里推进，右侧是红木门框，正前方书案，左后墙挂军事地图，对面高窗纸上挂着雨珠，林薇已经坐在房间中央红木椅旁`. Use long `not X / not Y` lists only for repeated confirmed failures or safety-critical constraints.
   - The video prompt must be mechanical shot direction: style lock, location asset, referenced characters/props/scenes, character positions, camera movement, visible action, exact or paraphrased dialogue, product/device behavior, light, continuity, ending frame, and negative constraints. Keep technical output settings outside `scene.prompt`; do not put strategy notes like "hook", "grab the audience", or plot explanation into `scene.prompt`.
   - Do not escalate weapon action beyond the script's relationship logic. If a character will soon protect or negotiate with the protagonist, avoid trigger-pull, cocking, accidental shot, or firing gestures unless the beat explicitly requires it. Use controlled threat language instead: gun raised, muzzle steady, finger outside trigger guard, muzzle slowly lowering, safety distance, or gun held downward.
   - Keep a transported protagonist's dialogue emotionally plausible. Early lines should sound confused, tired, and trying to remember, not like a narrator explaining the mechanism. Prefer natural fragments such as `我也不知道啊，我明明只是想躺十分钟啊……让我想想` before any theory about time travel.
   - Default subtitle/text ban: add a concise ban on subtitles, captions, watermarks, UI labels, and readable on-screen text unless the user explicitly requests visible text. Dialogue should be spoken/performed in audio and action, not rendered as text on the image.
   - Use match on action / action continuity when a physical action crosses two generated clips. The previous clip should end with the action already starting, and the next clip should begin by continuing the same hand/object/motion direction before adding new information.
   - Avoid empty slow pans, empty establishing shots, and long pure reactions in episode openers unless the pause reveals a concrete clue or raises a clear question. For normal clips, focus on a clear mini-beat with a visible or audible turn; action, reaction, dialogue, and suspense can coexist when they serve the same moment.
   - Run a compact director-review pass before syncing video workbench data or spending video credits. Treat P0 issues as blockers: missing script/prompt separation, unshootable prompt, dropped required action/dialogue, **major in-episode payoff without prior pressure (episode + season ledger)**, **emotionally flat burst shots**, dialogue overflow for locale/duration, wrong duration, critical prop drift, premature reveal, future-beat leakage, unsafe references, or style drift. A `buildup` episode ending on emotional cliffhanger without release is **OK**. Store warnings or accepted risks without requiring every optional field to be present.
   - For every scene, run a "can the camera see or hear it?" pass. If a sentence cannot be filmed or heard, rewrite it into a visible action, spoken line, sound, object state, screen detail, or lighting change before syncing.
   - For key mystery shots, use an action-object contract: actor, verb, target object, touch/no-touch, distance, and continuity clue. Example: if a shot is about recognizing a black leather-cord collar/necklace, the opening action should point at the collar/tag rather than becoming a generic medical-check gesture.
   - Treat critical physical clues as prop assets. If a clue is pointed at, touched, matched across clips, or shown in close-up, add it to `assets.props`, `scene.propRefs`, and the relevant character asset specification with fixed body position and negative constraints. Example: a collar/necklace must be a physical object, not a tattoo, imprint, mark, brand, shadow, or skin pattern.
   - For first episodes, major structural rewrites, or user-requested quality checks, run the cross-review in `references/episode-cross-review.md` when suitable platform text models are available. Discover reviewer candidates from the platform model interface, choose two different model IDs, and never bind the workflow to named brands/models. Treat non-consensus craft feedback as advisory, synthesize the final revision yourself, and store summaries plus the editorial decision in `productVideoRun.scriptReview`.
   - For `en-US` / North American scripts, assign the craft reviewer an English dialogue/speakability brief; for `zh-CN`, assign it Chinese vertical-drama tone and shootability. The role prompt changes by locale, not the model-discovery rule. See `references/locale-en-us.md`.
   - Prefer WodeApp's OpenAI-compatible proxy (`{origin}/mainserver/api/ai/v1/chat/completions` with `WODEAPP_API_KEY`, `X_API_KEY`, `API_KEY`, or `~/.wodeapp/config.json` `apiKey`) before direct provider keys. If fewer than two distinct platform models are available, label the result as degraded single-model advice; never duplicate one model and call it dual review.
   - Run a light model-adapter review for the first generated episode or any new engine mix. Check the fields the selected engine can actually use, then keep unsupported details as metadata rather than adding them to every visible prompt.
   - For WodeApp API paths and auth, prefer the current repo `AGENTS.md` and `docs/API_BASE.md` if working inside a WodeApp checkout.

7. **Generate selectable assets**
   - Use `scripts/generate_turnaround_assets.mjs` for character three-view sheets and transformed/power forms.
   - 真人角色资产默认策略：character, wardrobe, turnaround, and transformed/power-form assets should be generated with text-to-image using `doubao-seedream-5-0-260128` (Seedream 5.0). Use another model only when the user explicitly overrides the policy and the override is recorded.
   - 真人角色资产默认不用图生图：do not pass `imageUrl`, uploaded portraits, previous character images, screenshots, face references, or old wardrobe sheets when generating live-action human character assets unless the user explicitly confirms the image is self-owned, licensed, or otherwise authorized and accepts the identity/provenance risk. Regenerate from a text casting/wardrobe prompt when authorization is unclear.
   - The only normal exception is non-human, prop, product, or scene/location assets; those may use other approved image models when useful. A user can explicitly override this rule, but the override must be recorded in metadata.
   - Prop, product, scene, and location assets that may be passed to Seedance should be generated as human-free references: no visible people, faces, bodies, portraits, actors, silhouettes that read as people, crowd figures, mannequin-like forms, or cloth-covered/draped forms that could read as a hidden body. For "protagonist + prop" or "protagonist + scene" needs, keep the protagonist out of the prop/scene image by default and describe the interaction in the script and video prompt.
   - Standalone prop-resource rule: before generating scene/location assets, scan the script for physical objects that appear repeatedly or drive continuity. Generate/record each qualifying object as its own clean asset first; do not rely on a scene image, prompt phrase, or pasted reference collage as the only source of truth. This includes furniture used as a landing point, product devices, guns, medical items, letters, tokens, door keys, lamps, vehicles, and any clue the audience must recognize later.
   - If a scene/location asset contains a fixed prop, product, clue, furniture item, or vehicle that must stay consistent, generate the clean prop/product asset first and use it as a reference when generating the human-free scene/location asset. Record the relationship in metadata (`sceneAssets[].propRefs`, `scene.propRefs`, `scene.sceneRefs`, or equivalent), and send both the scene reference and prop reference to video generation when that object appears in-frame. Do not let the scene model invent a substitute object.
   - When sending a scene to video generation, attach/reference every recurring prop separately from the scene asset. The visible prompt should name the relationship in text, e.g. `参考无人[顾府密室]与道具[红木太师椅]，林薇坐在太师椅旁`; this keeps the model from replacing the prop with a generic chair or accidentally introducing a modern product.
   - Seedream 5.0 live-action human character assets are synthetic role references, not real-person privacy photos. Do not reject, remove, or replace them merely because they look photorealistic.
   - If a downstream video provider such as Seedance reports `InputImageSensitiveContentDetected.PrivacyInformation`, do not immediately downgrade the shot to pure text-to-video. First triage references in this order: verify Seedream 5.0 text-to-image provenance for character assets and keep them canonical; remove or regenerate suspicious non-character references first, especially covered-cloth, draped, sheet-covered, mannequin-like, body-shaped, reflection-heavy, or crowd/portrait scene and prop images; retry with Seedream character references plus fully textual scene/prop staging. Only if the cleaned submission still fails should a single-shot fallback remove character image URLs from `imageList`, `imageUrls`, `referenceImages`, `referenceImageUrls`, `subjects`, `characterRefs`, `assetIds`, and stale `generationRequest.input.imageList` while preserving names, LOOK codes, clothing, position, action, and dialogue in `script` and `prompt`. Pure `taskType: "text2video"` with all image fields cleared is the last resort after suspect scene/prop/product references have been removed or replaced and one retry has failed; record the fallback reason in metadata.
   - Scene/location assets may use other approved image models when useful, but character identity assets should stay on Seedream 5.0 for consistency.
   - For multi-costume roles, generate a labeled wardrobe contact sheet: one actor, 3-4 panels, full-body front view per look, clear panel labels, neutral background, same face and body across panels. Also store a text `wardrobeMap` beside the subject asset.
   - When sending a wardrobe sheet to video generation, scene prompts must name the active look, e.g. `参考[林薇]，使用LOOK A现代家居服` or `参考[林薇]，使用LOOK B素色旗袍`. This prevents costume blending.
   - For key shots, generate or request first-frame/keyframe references after the script is locked, not before. Prioritize P0 shots: episode opener, transformation, product/prop reveal, midpoint reversal, cliffhanger, and any shot with fragile spatial continuity.
   - Store reference purpose metadata beside assets: `first_frame`, `last_frame`, `character_reference`, `scene_reference`, `prop_reference`, `motion_reference`, `audio_reference`, or `style_reference`. Do not rely on filenames alone.
   - Generate 1-3 variants per character according to budget; upload chosen assets to the WodeApp resource library; produce a contact sheet and JSON/Markdown report when variants are generated.
   - Let the user pick winners before overwriting official character references.

8. **Sync and verify**
   - Sync to WodeApp through public platform interfaces: Project MCP or REST data APIs. Do not write `JsonRuntimeRecord` directly except for read-only diagnosis or emergency repair explicitly approved by the user.
   - For video workbench handoff, write `pvs_video_shares` through `/runtime-server/api/v1/data/query`, `/runtime-server/api/v1/data/sync`, and `PUT /runtime-server/api/v1/data/:recordId`. Use the stable `docId` as the share code and keep `run` as `productVideoRun`.
   - When writing generated video results back to the workbench, update both the new version model and the old display fields: keep `scene.videoRefs[]` + `scene.activeVideoId` as the version truth source, and mirror the active result into `scene.status`, `scene.videoUrl`, `scene.thumbnailUrl`, `scene.taskId`, `scene.progress`, and `scene.error`.
   - Normalize provider task statuses before saving to ProductVideoSection: `queued/submitted/pending/processing/polling` -> UI `generating` and VideoRef `processing`; `completed/complete/success/succeeded/done` -> `succeed`; `failed/failure/error/timeout/cancelled/payment_failed` -> `failed`. Do not store raw provider statuses as the only scene status.
   - For workflow run state, prefer `/runtime-server/api/v1/data/sync-run` or the workflow APIs. If the full import package is near the runtime body limit, split the payload: shareDoc only needs `productVideoRun`; workflow/archive data can be synced separately or kept as a local import artifact.
   - Update the workflow run or import package with selected asset URLs.
   - Verify counts: episodes/groups, shots/scenes, character assets, scene assets, selected subject images.
   - Verify `ProductVideoSection.props.initialRuns[0].scenes.length` matches the storyboard shot count and no scene exceeds the video provider's max duration.
   - Verify every generated-video scene has script, provider prompt, duration/model fields, and reference-role metadata when references are attached. Prompt-layer, continuity, and engine metadata are required only when supplied, expanded, or needed for the selected engine.
   - Verify no recurring physical object exists only inside prose or a baked scene image. Every multi-use/touched/clue prop must have a standalone prop resource, and every scene that shows it must include `propRefs`; scenes generated from that prop must also preserve `sceneRefs` + `propRefs` for video handoff.
   - Verify `negativePrompt` is not lost: keep it as metadata for engines that support it, and fold critical bans into `prompt` for engines that do not.
   - Verify first-frame and last-frame prompts are present for any shot marked as a continuity bridge, transformation, prop handoff, or cliffhanger.
   - Verify the stored director review is `pass`, `warn`, or intentionally accepted. Fix P0 errors before spending video credits.
   - Visually inspect contact sheets. Do not rely only on prompt text if images already show mixed styles.

## Local attachments and ffmpeg

- **Plain text scripts** (`.txt`, `.md`, storyboard exports): when the user uploads them in chat with a prompt like「根据这个脚本…」, WodeAppX reads the file **locally in the workspace** and injects the text into the message. No WodeApp login or attachment-intelligence credits are required for these files.
- **PDF / PPT / images / video** still use WodeApp attachment intelligence (login + credits) or a vision-capable model.
- **Local media post-processing** (trim, concat, extract frames, transcode, mix audio): use **`ffmpeg` / `ffprobe` via bash** in the project workspace. Write outputs under `.wodeapp/media-output/` or another workspace-relative folder. Do not invent `wodeapp.media.*` tool names.
- **Remote or cloud-generated video**: use Project MCP `video_extract_frames` / `video_generate` instead of assuming local files exist.

## References

- Read `references/creative-spec.md` when designing the input JSON or story/asset schema.
- Read `references/wodeapp-package.md` before building or patching WodeApp workflow data.
- Read `references/asset-style.md` before generating character/scene/video assets.
- Read `references/shot-execution-schema.md` before changing shot prompts, per-engine adapters, or video generation handoff fields.
- Read `references/storyboard-source-format.md` when the source is a prompt-first storyboard script (分镜稿), or when converting storyboard lines into `scene.script`/`scene.prompt` and metadata.
- Read `references/chapter-content-sufficiency.md` before video scripts — chapter events must support the target duration (Gate 0).
- Read `references/episode-cross-review.md` after each episode body — dynamic reviewer selection, cache, consensus, and expand/lower/accept-risk actions.
- Read `references/beat-budget-gate.md` before assigning per-shot durations — edit-beat seconds first, then pack into AI shots.
- Read `references/episode-rhythm-manifest.md` when planning episode beats, clip durations, rhythm presets, continuity bridges, or converting timing structure into分镜稿 / scene JSON / Seedance adapters.
- Read `references/locale-en-us.md` when `scriptLanguage` is `en-US` or the target market is North America / English vertical drama.
- Read `references/emotional-arc-ladder.md` when designing hooks, twists, character depth, or episode beat ladders (pressure → release).
- Read `references/group-keyframe-chain.md` when a scene group needs shared opening/bridge keyframes (K0→K1→K2) before frames2video / firstlast generation.
- Validate machine manifests with `references/episode-rhythm-manifest.schema.json`.

## Quick confirmation (`wodeapp-choices`)

When clarifying market/genre/episode count/visual mode/output depth in WodeAppX chat, always include an explicit JSON block at the end of the assistant message. WodeAppX hides this block and renders the interactive form from it.

Pick **CN** or **US** example based on user region / language. Do not show both in one form.

Example (China):

````markdown
好的，我们先确认方向：

1. 题材偏好
2. 总集数与单集时长
3. 视觉风格

```wodeapp-choices
{
  "title": "短剧方向确认",
  "questions": [
    {
      "id": "genre",
      "label": "题材偏好",
      "mode": "single",
      "options": [
        "狼人 / 超自然浪漫",
        "霸道总裁 / 豪门复仇",
        "穿越 / 重生 / 系统",
        "悬疑惊悚",
        "甜宠 / 先婚后爱"
      ]
    },
    {
      "id": "duration",
      "label": "总集数与单集时长",
      "mode": "single",
      "options": ["60集 x 90秒", "30集 x 120秒", "3集试播 x 90秒"]
    },
    {
      "id": "visual",
      "label": "视觉风格",
      "mode": "single",
      "options": ["真人实拍感", "动画 / 漫画风格"]
    },
    {
      "id": "output",
      "label": "输出深度",
      "mode": "single",
      "options": ["先出故事梗概 + 人物设定", "直接给完整分集脚本"]
    }
  ]
}
```
````

Example (US / English):

````markdown
Let's lock the production direction first:

```wodeapp-choices
{
  "title": "Short drama direction",
  "questions": [
    {
      "id": "genre",
      "label": "Genre lane",
      "mode": "single",
      "options": [
        "Billionaire revenge / secret heiress",
        "Werewolf / supernatural romance",
        "Legal thriller / conspiracy",
        "Forced proximity romance",
        "Mystery / stalker reveal"
      ]
    },
    {
      "id": "duration",
      "label": "Season length",
      "mode": "single",
      "options": ["30 eps x 90s", "60 eps x 90s", "3-ep pilot x 90s"]
    },
    {
      "id": "visual",
      "label": "Visual mode",
      "mode": "single",
      "options": ["Live-action premium vertical", "Anime / stylized"]
    },
    {
      "id": "output",
      "label": "Output depth",
      "mode": "single",
      "options": ["Logline + character bible first", "Full EP01 script now"]
    }
  ]
}
```
````

## After user confirms choices

When the user message contains `这些选项我先这样确认` or `请按以上选择继续`:

- Treat every listed field as locked production constraints. Do not ask the same confirmation questions again unless the user contradicts a choice.
- Reply like a human producer: 2-4 sentences summarizing the locked direction, then deliver the next artifact in the same turn when possible (logline, season promise, EP01 hook outline, character bible, or full EP01 script depending on output depth).
- If visual style includes `真人实拍感` or US `Live-action premium vertical`, lock live-action casting and the asset style bible before generating assets or video prompts.
- If genre/duration choices indicate a US / English production, set `scriptLanguage: "en-US"`, default `rhythmPreset` to `na_micro_drama` or `suspense_ladder`, and follow `references/locale-en-us.md`.
- Background scripts and file writes are allowed, but the visible chat answer must not be dominated by `mkdir`, `ls`, or other raw shell/tool output. Never make filesystem setup the first thing the user sees.
- For short-drama work, load this skill when helpful and continue from step 2 (story bible). To open the built-in 短剧项目 page for side-by-side editing, call AppX UI action `wodeapp.short_drama.open` — it only exposes the default page. For multi-scene video, call `wodeapp.video_storyboard.open` to inject storyboard data; the user must manually start rendering in the studio (Agent does not auto-run batch video).
- When the user attaches a `.txt` / `.md` script in chat, treat the injected attachment text as source truth; do not ask them to paste the script again.

## Scripts

`scripts/build_wodeapp_drama_package.mjs`

```bash
node scripts/build_wodeapp_drama_package.mjs \
  --input /path/to/creative-spec.json \
  --output /path/to/wodeapp-import.json
```

`scripts/generate_turnaround_assets.mjs`

```bash
WODEAPP_API_KEY="sk_live_..." node scripts/generate_turnaround_assets.mjs \
  --input /path/to/wodeapp-import.json \
  --project-url https://ai.wodeapp.cn \
  --project-header ai \
  --variants 3 \
  --out-dir /path/to/output/turnarounds
```

Use `--only "Name A,Name B"` for partial generation and `--force` to overwrite existing variants.

If `WODEAPP_API_KEY` is not exported in the shell, the script automatically falls back to the `apiKey` in `~/.wodeapp/config.json`. WodeAppX bootstraps this config through its embedded WodeApp identity on first use; a bound WodeApp account is optional and only syncs existing assets, balance, and profile data. An unset `WODEAPP_API_KEY` env var is NOT proof that WodeApp is unavailable, and must not be treated as an account prerequisite. Only report an embedded identity problem if a WodeApp auth tool/action explicitly returns `embedded_unavailable` or `auth_failed`; otherwise run the script and let it read the config.
