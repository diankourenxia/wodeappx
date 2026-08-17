#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import {
  resolveScriptLanguage,
  normalizeLocale,
  validateManifestDialogue,
  formatDialogueLine,
  deriveDialogueBudget,
} from "./locale-dialogue-budget.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) {
  fail("Usage: node build_wodeapp_drama_package.mjs --input creative-spec.json --output wodeapp-import.json");
}

const inputPath = resolve(args.input);
const outputPath = resolve(args.output);
const inputDir = dirname(inputPath);
const spec = JSON.parse(readFileSync(inputPath, "utf8"));
const scriptLanguage = resolveScriptLanguage(spec);
const now = Date.now();

const series = spec.series || {};
const format = series.format || {};
const episodeCount = Number(format.episodeCount || spec.episodes?.length || 0);
const episodeDurationSeconds = Number(format.episodeDurationSeconds || 90);
const targetClipDurationSeconds = clampNumber(
  Number(format.targetClipDurationSeconds || format.preferredClipDurationSeconds || 15),
  4,
  30,
);
const maxClipDurationSeconds = clampNumber(Number(format.maxClipDurationSeconds || 30), 4, 30);
const rawEpisodes = Array.isArray(spec.episodes) ? spec.episodes : [];
const suppliedPanelCount = rawEpisodes
  .map(ep => Array.isArray(ep.panels) ? ep.panels.length : 0)
  .find(count => count > 0);
const inferredShotsPerEpisode = Math.max(
  1,
  Math.ceil(episodeDurationSeconds / Math.max(1, Math.min(targetClipDurationSeconds, maxClipDurationSeconds))),
);
const shotsPerEpisode = Number(format.shotsPerEpisode || suppliedPanelCount || inferredShotsPerEpisode);
const clipDurationSeconds = Math.min(
  maxClipDurationSeconds,
  Math.ceil(episodeDurationSeconds / Math.max(1, shotsPerEpisode)),
);

const characters = normalizeCharacters(spec.characters || [], series.styleBible);
const sceneAssets = normalizeSceneAssets(spec.scenes || [], series.styleBible);
const rhythmManifestSources = [];
const episodes = rawEpisodes.map((ep, index) => normalizeEpisode(ep, index));
const scenes = episodes.flatMap(ep => episodeToShots(ep));
enrichScenePrompts(scenes, { characters, sceneAssets, series, clipDurationSeconds });
const groups = episodes.map((ep, index) => {
  const groupId = episodeId(ep.no);
  const sceneIds = scenes.filter(scene => scene.groupId === groupId).map(scene => scene.id);
  return {
    id: groupId,
    title: `EP${pad(ep.no)} ${ep.title}`,
    order: index,
    sceneCount: sceneIds.length,
    sceneIds,
    episodeNo: ep.no,
    targetDurationSeconds: episodeDurationSeconds,
    clipDurationSeconds,
    targetClipDurationSeconds,
    maxClipDurationSeconds,
    logline: ep.logline || "",
    hook: ep.panels.at(-1)?.description || "",
  };
});

const storyboard = {
  schemaVersion: 3,
  title: series.title || "Untitled Short Drama",
  cnTitle: series.cnTitle || series.title || "Untitled Short Drama",
  format: `${episodeCount || episodes.length} episode groups x ${shotsPerEpisode} shots x ${clipDurationSeconds} seconds`,
  totalDurationSeconds: episodes.length * episodeDurationSeconds,
  episodeCount: episodeCount || episodes.length,
  shotsPerEpisode,
  clipDurationSeconds,
  targetClipDurationSeconds,
  maxClipDurationSeconds,
  targetMarket: series.targetMarket || "",
  scriptLanguage,
  promptLanguage: series.promptLanguage || scriptLanguage,
  genre: series.genre || [],
  logline: series.logline || "",
  assetStyleBible: series.styleBible || {},
  styleLock: series.styleBible?.hardStyleLock || "",
  negativeStyle: series.styleBible?.negativeStyle || "",
  assets: {
    characters,
    scenes: sceneAssets,
    styleBible: series.styleBible || {},
  },
  scenes,
  groups,
};

const userIdea = {
  idea: storyboard.logline,
  sceneCount: scenes.length,
  shotCount: scenes.length,
  episodeCount: episodes.length,
  shotsPerEpisode,
  clipDurationSeconds,
  targetClipDurationSeconds,
  maxClipDurationSeconds,
  durationPerEpisodeSeconds: episodeDurationSeconds,
  aspectRatio: format.aspectRatio || "9:16",
  targetMarket: storyboard.targetMarket,
};

const subjectImages = {
  images: [],
  count: characters.length + sceneAssets.length,
  characters: characters.map(assetPreview),
  scenes: sceneAssets.map(assetPreview),
};

const storyboardPreview = {
  scenes: scenes.map(scene => ({
    id: scene.id,
    title: scene.title,
    script: scene.script,
    voiceoverText: scene.voiceoverText,
    imageUrl: scene.storyboardImageUrl || scene.firstFrameUrl || scene.imageUrl || "",
    firstFrameUrl: scene.firstFrameUrl || scene.storyboardImageUrl || scene.imageUrl || "",
    subjects: (scene.characterRefs || []).map(characterId => {
      const subject = characters.find(item => item.id === characterId);
      return {
        id: subject?.id || characterId,
        name: subject?.name || characterId,
        type: subject?.type || "character",
        description: subject?.description || "",
        imageUrl: subject?.imageUrl || "",
      };
    }),
  })),
};

const productVideoRun = buildProductVideoRun(storyboard);
const productVideoSectionConfig = {
  type: "ProductVideoSection",
  props: {
    title: `${storyboard.title} 视频生成工作台`,
    subtitle: "剧本分镜已拆成可逐镜生成的视频任务",
    brandThemeId: "orange-light",
    initialActiveRunId: productVideoRun.id,
    initialRuns: [productVideoRun],
  },
};

const steps = [
  step("input-idea", "parallelForm", "输入创意", "", userIdea),
  step("gen-storyboard", "generateJSON", "生成分镜脚本", userIdea, storyboard),
  step("gen-scene-images", "editImage", "生成分镜图", { count: scenes.length, aspectRatio: format.aspectRatio || "9:16" }, subjectImages),
  step("assemble-storyboard", "code", "组装分镜预览", { count: scenes.length }, storyboardPreview),
];

const runData = {
  title: `${storyboard.title}｜${episodes.length} episode short drama`,
  status: "success",
  workflowId: "storyboard-workflow",
  userInput: spec.userInput || storyboard.logline,
  steps,
  startedAt: now,
  finishedAt: now,
  durationMs: 0,
  ctxSnapshot: JSON.stringify({
    storyboard,
    userIdea,
    subjectImages,
    productVideoRun,
    productVideoSectionConfig,
    importMeta: {
      source: "wodeapp-short-drama-factory",
      inputPath,
      rhythmManifestSources,
      notes: "Episodes are groups; generated-video shots are scenes. Shot durationSec and executionTier come from EpisodeRhythmManifest when provided; provider model is resolved at execution time.",
    },
  }),
};

const output = {
  project: spec.project || {},
  productVideoRun,
  productVideoSectionConfig,
  workflowRun: {
    collection: "workflow_runs",
    data: runData,
    mcpTool: "create_workflow_runs",
    mcpArgs: {
      forceCreate: true,
      data: runData,
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({
  outputPath,
  groups: groups.length,
  scenes: scenes.length,
  characters: characters.length,
  sceneAssets: sceneAssets.length,
  clipDurationSeconds,
}, null, 2));

function normalizeCharacters(items, styleBible = {}) {
  return items.map(item => ({
    type: "character",
    imageUrl: "",
    assetId: "",
    styleLock: styleBible.hardStyleLock || item.styleLock || "",
    negativeStyle: styleBible.negativeStyle || item.negativeStyle || "",
    ...item,
    id: item.id || slugId("char", item.name),
  }));
}

function normalizeSceneAssets(items, styleBible = {}) {
  return items.map(item => ({
    type: "scene",
    imageUrl: "",
    assetId: "",
    styleLock: styleBible.sceneStyleLock || item.styleLock || "",
    negativeStyle: styleBible.negativeStyle || item.negativeStyle || "",
    ...item,
    id: item.id || slugId("scene", item.name),
  }));
}

function clampNumber(value, min, max) {
  const number = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, number));
}

function normalizeClipDuration(value, context = {}) {
  const raw = value === undefined || value === null || value === "" ? clipDurationSeconds : Number(value);
  const duration = Number.isFinite(raw) && raw > 0 ? raw : clipDurationSeconds;
  const modelRequirements = deriveModelRequirements(duration);
  if (modelRequirements.executionTier === "must_split") {
    const label = [
      context.episodeNo ? `EP${pad(context.episodeNo)}` : "",
      context.shotNo ? `S${pad(context.shotNo)}` : "",
      context.shotId || "",
      context.title || "",
    ].filter(Boolean).join(" ");
    fail(`${label || "Shot"} durationSec ${duration}s exceeds 30s. Split into child shots (or use extend/long-video strategy) before building.`);
  }
  return Number(Math.max(4, duration).toFixed(2));
}

function deriveModelRequirements(durationSec) {
  const executionTier = durationSec <= 15
    ? "universal"
    : durationSec <= 30
      ? "long_clip"
      : "must_split";
  return {
    minDurationSec: durationSec,
    requiresLongClip: durationSec > 15,
    executionTier,
  };
}

function resolveManifestPath(ref, baseDir) {
  if (!ref || typeof ref !== "string") return null;
  return isAbsolute(ref) ? ref : resolve(baseDir, ref);
}

function loadRhythmManifest(ref, baseDir) {
  if (!ref) return null;
  if (typeof ref === "object" && !Array.isArray(ref)) return ref;
  const path = resolveManifestPath(String(ref), baseDir);
  if (!path || !existsSync(path)) {
    fail(`Rhythm manifest not found: ${ref}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveEpisodeManifest(ep, spec, baseDir) {
  const episodeNo = Number(ep.no);
  if (ep.rhythmManifest && typeof ep.rhythmManifest === "object") {
    return ep.rhythmManifest;
  }
  if (ep.rhythmManifestPath) {
    return loadRhythmManifest(ep.rhythmManifestPath, baseDir);
  }
  if (spec.rhythmManifests && typeof spec.rhythmManifests === "object") {
    const keyed = spec.rhythmManifests[String(episodeNo)]
      ?? spec.rhythmManifests[episodeNo]
      ?? spec.rhythmManifests[`E${pad(episodeNo)}`];
    if (keyed) return loadRhythmManifest(keyed, baseDir);
  }
  if (spec.rhythmManifestPath && (episodeNo === 1 || rawEpisodes.length === 1)) {
    return loadRhythmManifest(spec.rhythmManifestPath, baseDir);
  }
  if (spec.rhythmManifest && typeof spec.rhythmManifest === "object" && (episodeNo === 1 || rawEpisodes.length === 1)) {
    return spec.rhythmManifest;
  }
  return null;
}

function beatMapFromManifest(manifest) {
  const map = new Map();
  for (const beat of manifest.beats || []) {
    if (beat?.beatId) map.set(beat.beatId, beat);
  }
  return map;
}

function manifestShotsToPanels(manifest, ep, locale = scriptLanguage) {
  const beatMap = beatMapFromManifest(manifest);
  const shots = Array.isArray(manifest.shots) ? [...manifest.shots] : [];
  shots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return shots.map((shot, index) => {
    const beat = beatMap.get(shot.beatId);
    const dialogueLines = Array.isArray(shot.dialogue)
      ? shot.dialogue.map((line) => {
          if (!line || typeof line !== "object") return "";
          return formatDialogueLine(line.speaker, line.line, locale);
        }).filter(Boolean)
      : [];
    const actionText = Array.isArray(shot.actionBeats) ? shot.actionBeats.join("；") : "";
    const description = [
      shot.openingShot,
      actionText,
      shot.endingShot,
    ].filter(Boolean).join(" ").trim() || shot.narrativeFunction || `Shot ${index + 1}`;
    return {
      beat: shot.narrativeFunction || beat?.goal || `Shot ${index + 1}`,
      description,
      characters: [],
      location: "",
      prompt: "",
      dialogue: dialogueLines.join("\n"),
      camera: shot.camera || "",
      continuity: [shot.bridgeHint, shot.causalLinkToNext].filter(Boolean).join(" "),
      endingFrame: shot.endingShot || "",
      durationSec: shot.durationSec,
      dialogueWordBudget: shot.dialogueWordBudget || deriveDialogueBudget(Number(shot.durationSec || clipDurationSeconds), locale),
      modelRequirements: shot.modelRequirements || deriveModelRequirements(Number(shot.durationSec || clipDurationSeconds)),
      manifestShotId: shot.shotId,
      beatId: shot.beatId,
      openingShot: shot.openingShot,
      endingShot: shot.endingShot,
      bridgeHint: shot.bridgeHint,
      causalLinkToNext: shot.causalLinkToNext,
      continuityFlags: shot.continuityFlags || [],
      actionBeats: shot.actionBeats || [],
      audioCues: shot.audioCues || [],
      timeSlots: shot.timeSlots || [],
      videoMode: shot.videoMode,
      promptMode: shot.promptMode,
      keyframeGate: shot.keyframeGate,
      transition: shot.transition,
      splitOf: shot.splitOf,
      riskNotes: shot.riskNotes,
      rhythmPreset: manifest.rhythmPreset,
      source: "rhythm_manifest",
    };
  });
}

function normalizeEpisode(ep, index) {
  const no = Number(ep.no || index + 1);
  const manifest = resolveEpisodeManifest({ ...ep, no }, spec, inputDir);
  let panels;
  if (manifest) {
    const locale = normalizeLocale(manifest.scriptLanguage || manifest.promptLanguage || scriptLanguage);
    const dialogueFailures = validateManifestDialogue(manifest, locale);
    if (dialogueFailures.length) {
      fail(dialogueFailures.map((item) => item.message).join("\n"));
    }
    rhythmManifestSources.push({
      episodeNo: no,
      episode: manifest.episode ?? no,
      title: manifest.title || ep.title,
      version: manifest.version,
      shotCount: Array.isArray(manifest.shots) ? manifest.shots.length : 0,
      rhythmPreset: manifest.rhythmPreset,
      scriptLanguage: normalizeLocale(manifest.scriptLanguage || manifest.promptLanguage || scriptLanguage),
      path: ep.rhythmManifestPath || spec.rhythmManifestPath || null,
    });
    panels = manifestShotsToPanels(manifest, ep, locale);
  } else {
    panels = (ep.panels || []).map((panel, panelIndex) => {
      if (Array.isArray(panel)) {
        return {
          beat: panel[0] || `Shot ${panelIndex + 1}`,
          description: panel[1] || "",
          characters: panel[2]?.characters || panel.characters || [],
          location: panel[2]?.location || panel.location || "",
          durationSec: panel[2]?.durationSec || panel[2]?.duration || panel.durationSec || panel.duration,
        };
      }
      return {
        beat: panel.beat || panel.title || `Shot ${panelIndex + 1}`,
        description: panel.description || panel.summary || "",
        characters: panel.characters || panel.characterRefs || [],
        location: panel.location || panel.locationRef || "",
        prompt: panel.prompt || "",
        dialogue: panel.dialogue || panel.spokenLine || "",
        camera: panel.camera || panel.motionPrompt || "",
        lookCode: panel.lookCode || panel.look || "",
        audioPrompt: panel.audioPrompt || "",
        endingFrame: panel.endingFrame || panel.lastFramePrompt || "",
        continuity: panel.continuity || "",
        propRefs: panel.propRefs || [],
        durationSec: panel.durationSec || panel.duration,
        modelRequirements: panel.modelRequirements || undefined,
      };
    });
  }
  return {
    ...ep,
    no,
    title: ep.title || manifest?.title || `Episode ${no}`,
    logline: ep.logline || manifest?.beats?.find((b) => b.type === "cold_open")?.goal || ep.logline,
    rhythmPreset: ep.rhythmPreset || manifest?.rhythmPreset,
    rhythmManifestEpisode: manifest?.episode,
    panels,
  };
}

function episodeToShots(ep) {
  const groupId = episodeId(ep.no);
  return ep.panels.map((panel, index) => {
    const shotNo = index + 1;
    const id = `${groupId}_shot_${pad(shotNo)}`;
    const characterRefs = normalizeRefs(panel.characters, panel.description);
    const durationSec = normalizeClipDuration(panel.durationSec, {
      episodeNo: ep.no,
      shotNo,
      shotId: panel.manifestShotId,
      title: panel.beat,
    });
    const modelRequirements = panel.modelRequirements || deriveModelRequirements(durationSec);
    const taskType = mapVideoModeToTaskType(panel.videoMode);
    return {
      id: panel.manifestShotId || id,
      episodeNo: ep.no,
      shotNo,
      title: `EP${pad(ep.no)}-${pad(shotNo)} ${panel.beat}`,
      groupId,
      orderInGroup: index,
      duration: durationSec,
      durationSec,
      modelRequirements,
      executionTier: modelRequirements.executionTier,
      manifestShotId: panel.manifestShotId,
      beatId: panel.beatId,
      openingShot: panel.openingShot,
      endingShot: panel.endingShot || panel.endingFrame,
      bridgeHint: panel.bridgeHint,
      causalLinkToNext: panel.causalLinkToNext,
      continuityFlags: panel.continuityFlags,
      actionBeats: panel.actionBeats,
      audioCues: panel.audioCues,
      timeSlots: panel.timeSlots,
      videoMode: panel.videoMode,
      promptMode: panel.promptMode,
      keyframeGate: panel.keyframeGate,
      transition: panel.transition,
      splitOf: panel.splitOf,
      riskNotes: panel.riskNotes,
      rhythmSource: panel.source || "panels",
      targetClipDurationSeconds,
      maxClipDurationSeconds,
      mood: series.mood || "",
      summary: panel.description,
      beat: panel.beat,
      episodeTitle: ep.title,
      episodeLogline: ep.logline || "",
      script: buildShotScript(ep, panel, index),
      prompt: panel.prompt || "",
      dialogue: panel.dialogue || "",
      camera: panel.camera || "",
      lookCode: panel.lookCode || "",
      audioPrompt: panel.audioPrompt || "",
      endingFrame: panel.endingFrame || "",
      continuity: panel.continuity || "",
      propRefs: panel.propRefs || [],
      voiceoverText: panel.description,
      storyboardPanels: [{
        id: `${groupId}_panel_${shotNo}`,
        order: shotNo,
        beat: panel.beat,
        description: panel.description,
      }],
      imagePrompt: buildImagePrompt(ep, panel, shotNo),
      characterRefs,
      locationRef: panel.location || "",
      storyboardImageUrl: "",
      imageUrl: "",
      subjectImages: [],
      styleLock: series.styleBible?.hardStyleLock || "",
      negativeStyle: series.styleBible?.negativeStyle || "",
      assetStyleInstruction: "Use referenced character and scene assets exactly. Keep the locked style consistent.",
      taskType,
      engine: "volcano",
    };
  });
}

function mapVideoModeToTaskType(videoMode) {
  switch (videoMode) {
    case "frames2video":
    case "multiframe2video":
      return "firstlast";
    case "multimodal2video":
      return "omni";
    default:
      return "omni";
  }
}

function buildShotScript(ep, panel, index) {
  const prev = ep.panels[index - 1];
  const next = ep.panels[index + 1];
  const shotDuration = normalizeClipDuration(panel.durationSec, {
    episodeNo: ep.no,
    shotNo: index + 1,
    title: panel.beat,
  });
  const isEarlyHook = ep.no <= 3 && index <= 2;
  const isEpisodeOpener = ep.no <= 8 && index === 0;
  const pacing = isEarlyHook || isEpisodeOpener
    ? [
        "Hook pacing: the first 3s must create an urgent question. The hook may be explosive or quiet-progressive: impossible detail, intimate danger, forbidden evidence, eerie sound, or visual contradiction.",
        "Use 2-4 layered story clues in this opening hook clip: evidence insert, wound/blood change, supernatural detail, restrained physical action, or a short hook line.",
        "Avoid empty slow pans, empty establishing shots, long pure reactions, and atmosphere-only movement. A pause is allowed only if it reveals a new clue or raises tension.",
      ]
    : [
        "Normal pacing: keep one clear story beat. Use 2-3 visible actions or inserts, then hand off cleanly to the next beat.",
        "Do not force trailer-style rapid cuts unless the story beat needs them. Avoid dead air, slow-only camera drift, and long pure reactions.",
      ];
  return [
    `Episode ${pad(ep.no)} "${ep.title}", clip ${pad(index + 1)}/${ep.panels.length}, ${shotDuration}s short-drama beat.`,
    "Generate only this clip's story beat. Do not complete the whole episode or play out the next clip.",
    `Episode logline: ${ep.logline || ""}`,
    panel.openingShot ? `Opening frame: ${panel.openingShot}` : (prev ? `Previous shot: ${prev.beat} - ${prev.description}` : "Opening shot: start with a strong hook."),
    `This shot: ${panel.beat} - ${panel.description}`,
    panel.endingShot || panel.endingFrame ? `Ending frame: ${panel.endingShot || panel.endingFrame}` : (next ? `Only foreshadow the next shot, do not play it out: ${next.beat} - ${next.description}` : "Ending shot: stop on a strong cliffhanger."),
    panel.bridgeHint ? `Bridge to next: ${panel.bridgeHint}` : "",
    panel.causalLinkToNext ? `Causal link: ${panel.causalLinkToNext}` : "",
    Array.isArray(panel.continuityFlags) && panel.continuityFlags.length
      ? `Continuity flags: ${panel.continuityFlags.join(", ")}`
      : "",
    ...pacing,
    "Dialogue: keep it short. Prioritize visible action, prop reveals, blood changes, animal marks, phone/evidence inserts, and physical interruption when relevant.",
    "Keep continuity in wardrobe, wounds, hair, props, and supernatural marks.",
  ].join("\n\n");
}

function buildImagePrompt(ep, panel, shotNo) {
  const style = [
    series.styleBible?.hardStyleLock || "",
    series.styleBible?.negativeStyle ? `Negative style: ${series.styleBible.negativeStyle}` : "",
  ].filter(Boolean).join(" ");
  return `Vertical ${format.aspectRatio || "9:16"} short-drama shot reference. Episode ${ep.no} "${ep.title}", shot ${shotNo}: ${panel.beat}. Only show this beat: ${panel.description}. ${style}`.trim();
}

function enrichScenePrompts(scenes, ctx) {
  const byGroup = new Map();
  for (const scene of scenes) {
    if (!byGroup.has(scene.groupId)) byGroup.set(scene.groupId, []);
    byGroup.get(scene.groupId).push(scene);
  }
  for (const groupScenes of byGroup.values()) {
    groupScenes.sort((a, b) => a.orderInGroup - b.orderInGroup);
    for (let index = 0; index < groupScenes.length; index++) {
      const scene = groupScenes[index];
      if (String(scene.prompt || "").trim()) continue;
      scene.prompt = buildMechanicalVideoPrompt(scene, {
        prev: groupScenes[index - 1],
        next: groupScenes[index + 1],
        total: groupScenes.length,
        ...ctx,
      });
      scene.promptMode = scene.promptMode || "compact";
    }
  }
}

function buildMechanicalVideoPrompt(scene, ctx) {
  const {
    prev,
    next,
    total,
    characters,
    sceneAssets,
    series,
    clipDurationSeconds,
  } = ctx;
  const styleBible = series.styleBible || {};
  const styleLock = compactStyleLock(styleBible.hardStyleLock || series.styleLock || "写实竖屏短剧，真人实拍感，电影感写实");
  const negativeStyle = styleBible.negativeStyle || "不要动漫、漫画、3D、游戏概念图、塑料皮肤、字幕、水印、可读UI文字";
  const charTags = characterTagsForScene(scene, characters);
  const location = sceneAssets.find(item => item.id === scene.locationRef);
  const locationLine = location
    ? `场景参考[${location.name}]${location.description ? `，${rewriteForCamera(location.description)}` : ""}。`
    : "";
  const lookLine = scene.lookCode
    ? charTags.map(tag => `${tag}使用${scene.lookCode}`).join("；")
    : "";
  const visibleAction = rewriteForCamera(scene.summary || scene.beat || scene.title || "");
  const dialogueLine = scene.dialogue
    ? `对白/旁白（口型与声音，不要渲染成屏幕文字）：${scene.dialogue}`
    : "";
  const cameraLine = scene.camera
    ? rewriteForCamera(scene.camera)
    : isHookShot(scene)
      ? "镜头：中近景或特写为主，允许一个可读插入镜头；禁止空慢摇与纯反应长镜头。"
      : "镜头：稳定可读的中景或近景，单一清晰动作；禁止空镜慢摇。";
  const continuityIn = prev
    ? `承接上一镜：${rewriteForCamera(prev.summary || prev.beat || prev.title || "")}。保持服装、伤口、道具与屏幕方向连续。`
    : "开场镜：直接进入画面，无标题卡、无logo、无空establishing。";
  const continuityOut = next
    ? `结尾停在本镜动作完成处，不要演下一镜：${rewriteForCamera(next.summary || next.beat || next.title || "")}。`
    : "结尾停在本集悬念画面，不要加 epilogue。";
  const endingFrame = scene.endingFrame
    ? rewriteForCamera(scene.endingFrame)
    : inferEndingFrame(scene.summary || scene.beat || "");
  const audioLine = scene.audioPrompt ? `音效：${rewriteForCamera(scene.audioPrompt)}。` : "";
  const continuityMeta = scene.continuity ? `连续性：${rewriteForCamera(scene.continuity)}。` : "";

  const lines = [
    `竖屏短剧镜头 - 第${pad(scene.episodeNo)}集《${scene.episodeTitle || ""}》镜头${pad(scene.shotNo)}/${total}。`,
    "仅生成这一镜。无字幕、无水印、无可读屏幕文字。",
    `风格：${styleLock}。`,
    charTags.length ? `参考角色${charTags.join("、")}。${lookLine ? `${lookLine}。` : ""}` : "",
    locationLine,
    `可见动作：${visibleAction}`,
    cameraLine,
    dialogueLine,
    audioLine,
    continuityMeta,
    continuityIn,
    continuityOut,
    endingFrame ? `结尾定格：${endingFrame}。` : "",
    `禁令：${negativeStyle}。`,
  ].filter(Boolean);

  return lines.join("\n");
}

function characterTagsForScene(scene, characters) {
  return (scene.characterRefs || [])
    .map(id => characters.find(item => item.id === id)?.name)
    .filter(Boolean)
    .map(name => `[${name}]`);
}

function isHookShot(scene) {
  return (scene.episodeNo <= 3 && scene.shotNo <= 3) || scene.orderInGroup === 0;
}

function compactStyleLock(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "写实竖屏短剧，真人实拍感，电影感写实";
  if (text.length <= 120) return text;
  return text.slice(0, 117).trim() + "...";
}

function rewriteForCamera(text) {
  return String(text || "")
    .replace(/\[(?:char|scene)_[^\]]+\]/gi, "")
    .replace(/hook pacing|grab the audience|episode logline|strategy note|观众|钩子节奏|本集剧情/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferEndingFrame(summary) {
  const text = rewriteForCamera(summary);
  if (!text) return "";
  const parts = text.split(/[。；;]/).map(item => item.trim()).filter(Boolean);
  return parts.at(-1) || text;
}

function normalizeRefs(refs, blob) {
  if (Array.isArray(refs) && refs.length) return refs;
  const text = String(blob || "").toLowerCase();
  const matched = characters
    .filter(character => text.includes(String(character.name || "").toLowerCase()))
    .map(character => character.id);
  return matched.length ? matched : characters.slice(0, 1).map(character => character.id);
}

function assetPreview(item) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    description: item.description || "",
    imageUrl: item.imageUrl || "",
    assetId: item.assetId || "",
    styleLock: item.styleLock || "",
    negativeStyle: item.negativeStyle || "",
  };
}

function buildProductVideoRun(storyboard) {
  const assets = storyboard.assets || {};
  const assetSubjects = [
    ...(assets.characters || []),
    ...(assets.scenes || []),
  ].map((item, index) => ({
    id: item.id || `sub-${index}`,
    name: item.name || item.id || `素材 ${index + 1}`,
    type: item.type === 'scene' || item.type === 'prop' ? item.type : 'character',
    description: item.description || item.visualProfile || '',
    imageUrl: item.imageUrl || item.url || '',
  })).filter((item) => item.name);
  const subjectById = new Map(assetSubjects.map((item) => [item.id, item]));
  const videoScenes = (storyboard.scenes || []).map((scene, index) => {
    const subjects = [
      ...(scene.characterRefs || []).map((id) => subjectById.get(id)).filter(Boolean),
      scene.locationRef ? subjectById.get(scene.locationRef) : null,
    ].filter(Boolean);
    const prompt = String(scene.prompt || '').trim() || buildMechanicalVideoPrompt(scene, {
      prev: null,
      next: null,
      total: (storyboard.scenes || []).filter(item => item.groupId === scene.groupId).length || 1,
      characters: assets.characters || [],
      sceneAssets: assets.scenes || [],
      series: { styleBible: storyboard.assets?.styleBible || {}, styleLock: storyboard.styleLock || '' },
      clipDurationSeconds: storyboard.clipDurationSeconds || clipDurationSeconds,
    });
    return {
      id: scene.id || `sc-seed-${index}`,
      name: scene.title || scene.name || `分镜 ${index + 1}`,
      script: scene.script || '',
      prompt,
      promptMode: scene.promptMode || 'compact',
      duration: Number(scene.duration || storyboard.clipDurationSeconds || 10),
      durationSec: Number(scene.durationSec || scene.duration || storyboard.clipDurationSeconds || 10),
      modelRequirements: scene.modelRequirements || deriveModelRequirements(Number(scene.durationSec || scene.duration || storyboard.clipDurationSeconds || 10)),
      executionTier: scene.executionTier || scene.modelRequirements?.executionTier || deriveModelRequirements(Number(scene.durationSec || scene.duration || storyboard.clipDurationSeconds || 10)).executionTier,
      manifestShotId: scene.manifestShotId,
      beatId: scene.beatId,
      openingShot: scene.openingShot,
      endingShot: scene.endingShot,
      bridgeHint: scene.bridgeHint,
      keyframeGate: scene.keyframeGate,
      videoMode: scene.videoMode,
      rhythmSource: scene.rhythmSource,
      camera: scene.camera || '',
      subjects,
      imageUrl: scene.firstFrameUrl || scene.storyboardImageUrl || scene.imageUrl || '',
      imageList: subjects
        .filter((subject) => subject.imageUrl)
        .map((subject) => ({ image_url: subject.imageUrl, name: subject.name, type: subject.type })),
      taskType: scene.taskType || 'omni',
      engine: scene.engine || 'volcano',
      model: scene.model || '',
      mode: scene.mode || 'std',
      aspectRatio: scene.aspectRatio || format.aspectRatio || '9:16',
      source: 'ai',
      status: 'idle',
    };
  });
  return {
    id: `run-${Date.now()}`,
    topic: storyboard.cnTitle || storyboard.title || '短剧视频生成',
    createdAt: Date.now(),
    inputSnapshot: {
      topic: storyboard.cnTitle || storyboard.title || '短剧视频生成',
      ratio: format.aspectRatio || '9:16',
      mode: 'std',
      aiModel: 'deepseek-v4-flash',
      durationSec: storyboard.clipDurationSeconds || clipDurationSeconds,
      targetClipDurationSeconds: storyboard.targetClipDurationSeconds || targetClipDurationSeconds,
      maxClipDurationSeconds: storyboard.maxClipDurationSeconds || maxClipDurationSeconds,
    },
    scenes: videoScenes,
    subjects: assetSubjects,
  };
}

function step(id, type, name, input, output) {
  return {
    taskId: id,
    stepId: id,
    stepType: type,
    stepName: name,
    status: "done",
    input: typeof input === "string" ? input : JSON.stringify(input),
    output: JSON.stringify(output),
    durationMs: 0,
  };
}

function episodeId(no) {
  return `episode_${pad(no)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function slugId(prefix, name) {
  return `${prefix}_${String(name || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
    else parsed[arg.slice(2)] = argv[index + 1]?.startsWith("--") ? true : argv[++index];
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
