export type StoryboardClipSceneLike = {
  id?: string;
  name?: string;
  prompt: string;
  duration?: number;
  model?: string;
  subjects?: unknown[];
  groupId?: string;
  orderInGroup?: number;
  videoRefs?: unknown[];
  activeVideoId?: string;
  taskId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status?: string;
};

/** ProductVideo 工作台「新建分组」对应的 run.groups 项 */
export type StoryboardGroupPayload = {
  id: string;
  title: string;
  order: number;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/**
 * Resolve scene → ProductVideo group tab id.
 * Agents often emit `group` / `episode` instead of `groupId`; accept those aliases.
 */
export function coerceStoryboardSceneGroupId(record: Record<string, unknown> | null | undefined): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const id = asTrimmedString(
    record.groupId ?? record.group ?? record.groupKey ?? record.episodeId ?? record.episode,
  );
  return id || undefined;
}

/**
 * Normalize agent/tool `groups` into ProductVideo run.groups shape.
 * Accepts strings, {id,title,order}, or episode/act aliases.
 */
export function normalizeStoryboardGroups(raw: unknown): StoryboardGroupPayload[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, StoryboardGroupPayload>();
  raw.forEach((item, index) => {
    if (item == null) return;
    if (typeof item === "string" || typeof item === "number") {
      const title = String(item).trim();
      if (!title || byId.has(title)) return;
      byId.set(title, { id: title, title, order: index });
      return;
    }
    if (typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const title = asTrimmedString(
      record.title ?? record.name ?? record.label ?? record.key ?? record.id,
    );
    const id = asTrimmedString(record.id ?? record.key ?? title);
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      title: title || id,
      order: Number.isFinite(Number(record.order)) ? Number(record.order) : index,
    });
  });
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

/** Rebuild groups metadata from scene.groupId when agent only set per-scene membership. */
export function rebuildStoryboardGroupsFromScenes(
  scenes: Array<{ groupId?: string | null }>,
  existing?: StoryboardGroupPayload[],
): StoryboardGroupPayload[] {
  const byId = new Map<string, StoryboardGroupPayload>();
  for (const group of existing || []) {
    if (group.id) byId.set(group.id, group);
  }
  let nextOrder = byId.size;
  for (const scene of scenes) {
    const id = asTrimmedString(scene.groupId);
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, title: id, order: nextOrder++ });
  }
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

/** Fill missing orderInGroup within each groupId (stable input order). */
export function assignStoryboardOrderInGroup<T extends { groupId?: string; orderInGroup?: number }>(
  scenes: T[],
): T[] {
  const counters = new Map<string, number>();
  return scenes.map((scene) => {
    if (scene.orderInGroup != null && Number.isFinite(scene.orderInGroup)) return scene;
    const key = asTrimmedString(scene.groupId) || "__default__";
    const next = counters.get(key) ?? 0;
    counters.set(key, next + 1);
    return { ...scene, orderInGroup: next };
  });
}

/**
 * Resolve run.groups + scene.groupId/orderInGroup for ProductVideo UI tabs.
 * Prefer explicit groups[]; otherwise derive from distinct scene.groupId values.
 */
export function resolveStoryboardGroupsForPayload<T extends { groupId?: string; orderInGroup?: number }>(
  scenes: T[],
  rawGroups?: unknown,
): { scenes: T[]; groups: StoryboardGroupPayload[] } {
  const explicit = normalizeStoryboardGroups(rawGroups);
  const orderedScenes = assignStoryboardOrderInGroup(scenes);
  const groups = rebuildStoryboardGroupsFromScenes(orderedScenes, explicit);
  return { scenes: orderedScenes, groups };
}

/**
 * Models often emit nested tool args as `{ $text: "<json>" }` (OpenCode/XML)
 * or as a JSON string. Unwrap those into plain objects/strings before scene
 * validation so video storyboard handoff does not falsely reject valid prompts.
 */
export function unwrapJsonishToolValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return unwrapJsonishToolValue(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const textPayload = record.$text;
  if (typeof textPayload === "string" && Object.keys(record).every((key) => key === "$text")) {
    return unwrapJsonishToolValue(textPayload);
  }
  return value;
}

/** 与 shared-components agentVideoCapability / seedanceDuration 对齐 */
export const VIDEO_CLIP_MIN_SEC = 4;
export const VIDEO_CLIP_MAX_SEC = 15;
export const VIDEO_CLIP_MAX_SEC_25 = 30;

/** 视频智能体 / 分镜工作台平台默认模型；智能体传入的 model 一律忽略，改用此默认。 */
export const PRODUCT_VIDEO_DEFAULT_MODEL = "doubao-seedance-2-0-mini-260615";
export const PRODUCT_VIDEO_DEFAULT_MODEL_LABEL = "Seedance 2.0 Mini";

export function isStoryboardSeedance25Model(model?: string): boolean {
  const m = (model || "").toLowerCase();
  return /seedance[-_/]?2[\.-]?5/.test(m) || /seedance[-_/]?2[-_]5/.test(m);
}

/** 收集智能体试图指定的视频 model，便于诊断；执行路径应忽略这些值。 */
export function collectAgentVideoModelHints(opts: {
  model?: string | null;
  modelId?: string | null;
  scenes?: Array<{ model?: string | null }>;
}): string[] {
  const hints: string[] = [];
  for (const value of [opts.model, opts.modelId, ...(opts.scenes || []).map((scene) => scene.model)]) {
    const trimmed = String(value || "").trim();
    if (trimmed && !hints.includes(trimmed)) hints.push(trimmed);
  }
  return hints;
}

/** 去掉 scene.model，避免智能体用 2.5 绕过默认 ≤15s 硬门。 */
export function stripStoryboardSceneModels<T extends { model?: string }>(scenes: T[]): Array<Omit<T, "model">> {
  return scenes.map((scene) => {
    if (!("model" in scene) || scene.model == null) return scene as Omit<T, "model">;
    const { model: _ignored, ...rest } = scene;
    return rest;
  });
}

export function getVideoClipMaxSec(model?: string): number {
  if (isStoryboardSeedance25Model(model)) return VIDEO_CLIP_MAX_SEC_25;
  return VIDEO_CLIP_MAX_SEC;
}

export function getVideoClipMinSec(_model?: string): number {
  return VIDEO_CLIP_MIN_SEC;
}

export type StoryboardDurationIssue = {
  sceneIndex: number;
  sceneName?: string;
  duration: number;
  kind: "too_long" | "too_short" | "prompt_timeline_mismatch";
  detail: string;
  model?: string;
  maxClipSec?: number;
};

export type StoryboardDurationValidation = {
  ok: boolean;
  issues: StoryboardDurationIssue[];
  error?: string;
};

const PROMPT_TIMELINE_RANGE = /(\d+(?:\.\d+)?)\s*[-–~—到至]\s*(\d+(?:\.\d+)?)\s*秒/g;

export function extractStoryboardPromptTimelineEndSec(prompt: string): number | null {
  const text = String(prompt || "");
  if (!text.trim()) return null;
  let maxEnd: number | null = null;
  for (const match of text.matchAll(PROMPT_TIMELINE_RANGE)) {
    const end = Number(match[2]);
    if (!Number.isFinite(end)) continue;
    maxEnd = maxEnd == null ? end : Math.max(maxEnd, end);
  }
  return maxEnd;
}

function modelLabelForClipGate(model: string | undefined, max: number): string {
  if (isStoryboardSeedance25Model(model)) return `Seedance 2.5（≤${max}s）`;
  return `Seedance 2.0/Mini（≤${max}s）`;
}

/**
 * 视频智能体入口硬门：单镜时长随模型变化（2.0/Mini≤15，2.5≤30），
 * prompt 时间轴不得越过可执行时长。超限 recoverable 拒收。
 */
export function validateStoryboardClipDurations(opts: {
  scenes: Array<{ name?: string; prompt?: string; duration?: number; model?: string }>;
  durationSec?: number;
  model?: string;
  maxClipSec?: number;
  minClipSec?: number;
}): StoryboardDurationValidation {
  const runModel = opts.model;
  const runMax = opts.maxClipSec ?? getVideoClipMaxSec(runModel);
  const min = opts.minClipSec ?? getVideoClipMinSec(runModel);
  const issues: StoryboardDurationIssue[] = [];
  const globalRaw = opts.durationSec;
  const globalDur = globalRaw != null && Number.isFinite(Number(globalRaw))
    ? Math.round(Number(globalRaw))
    : undefined;

  if (globalDur != null) {
    if (globalDur > runMax) {
      issues.push({
        sceneIndex: -1,
        duration: globalDur,
        kind: "too_long",
        model: runModel,
        maxClipSec: runMax,
        detail: `durationSec=${globalDur} 超过 ${modelLabelForClipGate(runModel, runMax)} 单镜上限。请拆成 ≤${runMax}s 多条；智能体勿传 model。`,
      });
    } else if (globalDur < min) {
      issues.push({
        sceneIndex: -1,
        duration: globalDur,
        kind: "too_short",
        model: runModel,
        maxClipSec: runMax,
        detail: `durationSec=${globalDur} 低于单镜下限 ${min}s`,
      });
    }
  }

  for (let i = 0; i < (opts.scenes || []).length; i += 1) {
    const scene = opts.scenes[i] || { prompt: "" };
    const sceneModel = scene.model || runModel;
    const max = opts.maxClipSec ?? getVideoClipMaxSec(sceneModel);
    const raw = scene.duration ?? globalDur ?? Math.min(VIDEO_CLIP_MAX_SEC, max);
    const duration = Math.round(Number(raw) || 0);
    const label = scene.name?.trim() || `场景 ${i + 1}`;

    if (duration > max) {
      issues.push({
        sceneIndex: i,
        sceneName: scene.name,
        duration,
        kind: "too_long",
        model: sceneModel,
        maxClipSec: max,
        detail: max >= VIDEO_CLIP_MAX_SEC_25
          ? `第 ${i + 1} 条「${label}」duration=${duration}s > ${max}s（${modelLabelForClipGate(sceneModel, max)}）。请拆成多条 ≤${max}s 并按新时长重写 prompt 时间轴。`
          : `第 ${i + 1} 条「${label}」duration=${duration}s > ${max}s（平台默认 ${modelLabelForClipGate(sceneModel, max)}）。请拆成多条 ≤${max}s 并重写 prompt；智能体勿传 model。`,
      });
    } else if (duration > 0 && duration < min) {
      issues.push({
        sceneIndex: i,
        sceneName: scene.name,
        duration,
        kind: "too_short",
        model: sceneModel,
        maxClipSec: max,
        detail: `第 ${i + 1} 条「${label}」duration=${duration}s < ${min}s 下限`,
      });
    }

    const allowedDur = duration > max
      ? max
      : (duration > 0 ? duration : max);
    const timelineEnd = extractStoryboardPromptTimelineEndSec(scene.prompt || "");
    if (timelineEnd != null && timelineEnd > allowedDur + 0.5) {
      issues.push({
        sceneIndex: i,
        sceneName: scene.name,
        duration: allowedDur,
        kind: "prompt_timeline_mismatch",
        model: sceneModel,
        maxClipSec: max,
        detail: `第 ${i + 1} 条「${label}」prompt 时间轴写到 ${timelineEnd}s，但可执行时长仅为 ${allowedDur}s（${modelLabelForClipGate(sceneModel, max)}）。请按 ${allowedDur}s 重写脚本或拆成多条；智能体勿传 model 升档。`,
      });
    }
  }

  if (!issues.length) return { ok: true, issues: [] };

  return {
    ok: false,
    issues,
    error: [
      "视频分镜时长不合规（平台默认 Seedance 2.0 Mini 单镜≤15s；智能体传入的 model 会被忽略）：",
      ...issues.map((issue) => `- ${issue.detail}`),
      "请修正后重试：每条 ≤15s，并让 prompt 时间轴与 duration 一致。更长内容请拆成多条 ≤15s。",
    ].join("\n"),
  };
}

type TimedBeat = {
  start: number;
  end: number;
  bucket: number;
};

const LEADING_SECOND_RANGE = /^\s*(\d+(?:\.\d+)?)\s*[-—–~～至]\s*(\d+(?:\.\d+)?)\s*秒(?:钟)?/;

function parseTimedBeat(prompt: string, clipDurationSec: number): TimedBeat | null {
  const match = prompt.match(LEADING_SECOND_RANGE);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  const bucket = Math.floor(start / clipDurationSec);
  const endBucket = Math.floor(Math.max(start, end - 0.001) / clipDurationSec);
  if (bucket !== endBucket) return null;
  return { start, end, bucket };
}

function localizeTimedBeat(prompt: string, beat: TimedBeat, clipDurationSec: number): string {
  const offset = beat.bucket * clipDurationSec;
  const localStart = Number((beat.start - offset).toFixed(3));
  const localEnd = Number((beat.end - offset).toFixed(3));
  return prompt.replace(LEADING_SECOND_RANGE, `${localStart}-${localEnd}秒`);
}

/**
 * 防御模型把“一段 15 秒里的 5 个节拍”误当成 5 条各 15 秒的视频。
 * 仅合并从 0 秒开始、连续递增、严格落在固定时长分段内的新任务；已有生成结果不动。
 */
export function coalesceStoryboardBeatsIntoClips<T extends StoryboardClipSceneLike>(
  scenes: readonly T[],
  clipDurationSec = 15,
): T[] {
  if (
    scenes.length < 3
    || !Number.isFinite(clipDurationSec)
    || clipDurationSec <= 0
    || scenes.some((scene) =>
      Boolean(
        scene.videoRefs?.length
        || scene.activeVideoId
        || scene.taskId
        || scene.videoUrl
        || scene.thumbnailUrl
        || (scene.status && scene.status !== "idle"),
      )
      || (scene.duration != null && Math.abs(scene.duration - clipDurationSec) > 0.001)
    )
  ) return [...scenes];

  const beats = scenes.map((scene) => parseTimedBeat(scene.prompt, clipDurationSec));
  if (beats.some((beat) => !beat)) return [...scenes];
  const timedBeats = beats as TimedBeat[];
  if (timedBeats[0].start > 0.001) return [...scenes];

  for (let index = 1; index < timedBeats.length; index += 1) {
    const previous = timedBeats[index - 1];
    const current = timedBeats[index];
    if (current.start < previous.start || current.start > previous.end + 1) return [...scenes];
  }

  const buckets = new Map<number, Array<{ scene: T; beat: TimedBeat }>>();
  scenes.forEach((scene, index) => {
    const beat = timedBeats[index];
    const list = buckets.get(beat.bucket) || [];
    list.push({ scene, beat });
    buckets.set(beat.bucket, list);
  });
  const orderedBuckets = [...buckets.entries()].sort(([a], [b]) => a - b);
  if (
    orderedBuckets.length < 2
    || orderedBuckets.some(([bucket, entries], index) => bucket !== index || entries.length < 2)
  ) return [...scenes];

  return orderedBuckets.map(([, entries], clipIndex) => {
    const first = entries[0].scene;
    const {
      id: _id,
      videoRefs: _videoRefs,
      activeVideoId: _activeVideoId,
      taskId: _taskId,
      videoUrl: _videoUrl,
      thumbnailUrl: _thumbnailUrl,
      status: _status,
      ...base
    } = first;
    const subjects = entries.flatMap(({ scene }) => scene.subjects || []);
    return {
      ...base,
      name: `片段 ${clipIndex + 1}（${clipDurationSec}秒）`,
      prompt: entries
        .map(({ scene, beat }) => localizeTimedBeat(scene.prompt, beat, clipDurationSec))
        .join("\n"),
      duration: clipDurationSec,
      ...(subjects.length ? { subjects } : {}),
      orderInGroup: clipIndex,
    } as T;
  });
}
