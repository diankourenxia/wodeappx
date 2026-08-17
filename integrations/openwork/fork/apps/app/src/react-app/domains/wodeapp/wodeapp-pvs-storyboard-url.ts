/**
 * WodeAppX 多条/分镜视频任务 URL 构建：大 payload 落库 pvs_video_shares，shareDoc 用短 docId。
 * 逻辑与 shared-components/sections/productVideo/agentVideoCapability.ts 对齐。
 */
import {
  WodeAppRuntimeRequestError,
  getWodeAppApiCredentials,
  requestWodeAppRuntimeJson,
} from "@/app/lib/wodeapp-auth";
import {
  requireRuntimeDataMutationRecord,
  requireRuntimeDataQueryRecords,
  runtimeDataPayloadMatches,
  runtimeDataRecordId,
} from "./wodeapp-runtime-data-handoff";

const PVS_SHARE_COLLECTION = "pvs_video_shares";
const SHARE_DOC_QUERY_KEY = "shareDoc";
/** @deprecated 旧链接只读兼容 */
const PVS_RUN_QUERY_KEY = "pvsRun";
/** @deprecated 已停用；构建 URL 时会主动剥离 */
const PVS_AUTORUN_QUERY_KEY = "pvsAutoRun";
const WODEAPP_HOST_SUFFIXES = [".wodeapp.cn", ".wodeapp.ai"] as const;
/** 与 agentVideoCapability PRODUCT_VIDEO_RUN_INLINE_MAX_ENCODED_LENGTH 对齐 */
const MAX_INLINE_ENCODED_LENGTH = 1500;
/** Nginx 常见 URI 上限约 8KB；inline 兜底必须低于此值，否则直接放弃生成 URL。 */
const MAX_SAFE_TASK_URL_CHARS = 6000;
/** ≥2 镜分镜批量任务禁止 inline，必须 docId sync */
const MIN_SCENES_REQUIRE_DOC_ID = 2;

export type PvsStoryboardRunPayload = {
  capabilityId?: string;
  id?: string;
  topic?: string;
  inputSnapshot?: { ratio?: string; durationSec?: number };
  scenes: Array<Record<string, unknown>>;
  subjects?: Array<Record<string, unknown>>;
  groups?: Array<Record<string, unknown>>;
};

export type PvsStoryboardProjectHints = {
  slug?: string;
  subdomain?: string;
  projectId?: string;
};

export type PvsStoryboardSyncDiagnostic = {
  attempted: boolean;
  ok: boolean;
  verified?: boolean;
  docId?: string;
  recordId?: string;
  updated?: boolean;
  projectHeader?: string | null;
  projectHeaderSource?: "projectId" | "slug" | "subdomain" | "launchUrl" | "none";
  sceneCount?: number;
  subjectCount?: number;
  runJsonBytes?: number;
  encodedBytes?: number;
  httpStatus?: number;
  error?: string;
  bodySnippet?: string;
};

export type BuildVideoStoryboardTaskUrlResult = {
  url: string | null;
  mode: "inline" | "docId";
  shareDocId?: string;
  updated?: boolean;
  saveError?: string;
  syncDiagnostic?: PvsStoryboardSyncDiagnostic;
};

export type BuildVideoStoryboardTaskUrlOptions = {
  projectHints?: PvsStoryboardProjectHints;
  /** 传入已有 docId 时原地 PUT 更新，保留各镜 videoRefs；省略则创建新 shareDoc */
  shareDocId?: string | null;
};

function encodePayload(payload: PvsStoryboardRunPayload): string | null {
  try {
    if (typeof btoa !== "function") return null;
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    return null;
  }
}

function payloadStats(payload: PvsStoryboardRunPayload) {
  const runJson = JSON.stringify(payload);
  const encoded = encodePayload(payload);
  return {
    sceneCount: payload.scenes?.length ?? 0,
    subjectCount: payload.subjects?.length ?? 0,
    runJsonBytes: runJson.length,
    encodedBytes: encoded?.length ?? 0,
  };
}

function logPvsShare(level: "info" | "warn" | "error", message: string, detail: Record<string, unknown>) {
  const tag = "[WodeAppX][pvs_video_shares]";
  const line = { message, ...detail };
  if (level === "info") console.info(tag, line);
  else if (level === "warn") console.warn(tag, line);
  else console.error(tag, line);
}

function createShareDocId(topic?: string): string {
  const slug = (topic || "storyboard")
    .trim()
    .slice(0, 36)
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "storyboard";
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `pvs_${slug}_${stamp}_${rand}`;
}

/** 与 agentVideoCapability.normalizeProductVideoShareDocId 对齐 */
export function normalizeShareDocId(raw?: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (/^pvs[_-]/i.test(trimmed)) return trimmed;
  return null;
}

function storyboardSceneIdKey(scene: Record<string, unknown>): string {
  const id = typeof scene.id === "string" ? scene.id.trim() : "";
  return id ? `id:${id}` : "";
}

function storyboardSceneNameKey(scene: Record<string, unknown>): string {
  const name = typeof scene.name === "string" ? scene.name.trim() : "";
  return name ? `name:${name}` : "";
}

function storyboardVideoRefKey(ref: Record<string, unknown>, index: number): string {
  const id = typeof ref.id === "string" ? ref.id.trim() : "";
  const taskId = typeof ref.taskId === "string" ? ref.taskId.trim() : "";
  const url = typeof ref.url === "string" ? ref.url.trim() : "";
  return id || taskId || url || `idx:${index}`;
}

function mergeStoryboardVideoRefs(existing: unknown, incoming: unknown): unknown[] | undefined {
  const left = Array.isArray(existing) ? existing : [];
  const right = Array.isArray(incoming) ? incoming : [];
  if (!left.length && !right.length) return undefined;

  const refs = new Map<string, Record<string, unknown>>();
  [...left, ...right].forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return;
    const ref = candidate as Record<string, unknown>;
    const key = storyboardVideoRefKey(ref, index);
    refs.set(key, { ...refs.get(key), ...ref });
  });
  return [...refs.values()];
}

function mergeStoryboardSceneRecord(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existingId = typeof existing.id === "string" ? existing.id.trim() : "";
  const incomingId = typeof incoming.id === "string" ? incoming.id.trim() : "";
  const videoRefs = mergeStoryboardVideoRefs(existing.videoRefs, incoming.videoRefs);

  return {
    ...existing,
    ...incoming,
    // Scene identity belongs to the persisted workbench record. Normalized model
    // input contains `id: undefined`, so blindly spreading it used to erase the
    // runtime id and made the workbench mint a new sc-seed id on every update.
    ...((existingId || incomingId) ? { id: existingId || incomingId } : {}),
    ...(videoRefs ? { videoRefs } : {}),
    activeVideoId: incoming.activeVideoId ?? existing.activeVideoId,
    taskId: incoming.taskId ?? existing.taskId,
    videoUrl: incoming.videoUrl ?? existing.videoUrl,
    thumbnailUrl: incoming.thumbnailUrl ?? existing.thumbnailUrl,
    status: incoming.status ?? existing.status,
    revision: incoming.revision ?? existing.revision,
    progress: incoming.progress ?? existing.progress,
    error: incoming.error ?? existing.error,
    scriptFrameUrl: incoming.scriptFrameUrl ?? existing.scriptFrameUrl,
    nineGridUrl: incoming.nineGridUrl ?? existing.nineGridUrl,
    storyboardSheetUrl: incoming.storyboardSheetUrl ?? existing.storyboardSheetUrl,
    previewMode: incoming.previewMode ?? existing.previewMode,
    reviewStatus: incoming.reviewStatus ?? existing.reviewStatus,
  };
}

/** 按 group.id 合并；incoming 覆盖同 id，新 id 追加。不传 incoming 则保留 existing。 */
export function mergeStoryboardGroupRecords(
  existing?: Array<Record<string, unknown>>,
  incoming?: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | undefined {
  const existingGroups = Array.isArray(existing) ? existing : [];
  const incomingGroups = Array.isArray(incoming) ? incoming : [];
  if (!incomingGroups.length) return existingGroups.length ? existingGroups : undefined;
  if (!existingGroups.length) return incomingGroups;

  const order: string[] = [];
  const map = new Map<string, Record<string, unknown>>();
  const keyOf = (group: Record<string, unknown>, index: number) => {
    const id = typeof group.id === "string" ? group.id.trim() : "";
    return id || `anon:${index}`;
  };

  existingGroups.forEach((group, index) => {
    const key = keyOf(group, index);
    map.set(key, group);
    if (!order.includes(key)) order.push(key);
  });
  incomingGroups.forEach((group, index) => {
    const key = keyOf(group, existingGroups.length + index);
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, ...group } : group);
    if (!order.includes(key)) order.push(key);
  });

  return order.map((key) => map.get(key)!);
}

/** 与 agentVideoCapability.mergeProductVideoStoryboardPayload 对齐（AppX 侧无 shared-components 依赖） */
export function mergePvsStoryboardRunPayload(
  existing: PvsStoryboardRunPayload,
  incoming: PvsStoryboardRunPayload,
): PvsStoryboardRunPayload {
  const existingScenes = Array.isArray(existing.scenes) ? existing.scenes : [];
  const incomingScenes = Array.isArray(incoming.scenes) ? incoming.scenes : [];
  const mergedSceneMap = new Map<string, Record<string, unknown>>();
  const sceneAliasMap = new Map<string, string>();
  const order: string[] = [];

  for (const scene of existingScenes) {
    const idKey = storyboardSceneIdKey(scene);
    const nameKey = storyboardSceneNameKey(scene);
    const key = sceneAliasMap.get(idKey)
      || sceneAliasMap.get(nameKey)
      || idKey
      || nameKey;
    if (!key) continue;
    const prev = mergedSceneMap.get(key);
    mergedSceneMap.set(key, prev ? mergeStoryboardSceneRecord(prev, scene) : scene);
    if (!order.includes(key)) order.push(key);
    if (idKey) sceneAliasMap.set(idKey, key);
    if (nameKey) sceneAliasMap.set(nameKey, key);
  }

  for (const scene of incomingScenes) {
    const idKey = storyboardSceneIdKey(scene);
    const nameKey = storyboardSceneNameKey(scene);
    const key = sceneAliasMap.get(idKey)
      || sceneAliasMap.get(nameKey)
      || idKey
      || nameKey
      || `idx:${order.length}`;
    const prev = mergedSceneMap.get(key);
    mergedSceneMap.set(key, prev ? mergeStoryboardSceneRecord(prev, scene) : scene);
    if (!order.includes(key)) {
      order.push(key);
    }
    if (idKey) sceneAliasMap.set(idKey, key);
    if (nameKey) sceneAliasMap.set(nameKey, key);
  }

  const subjectMap = new Map<string, Record<string, unknown>>();
  for (const subject of existing.subjects || []) {
    const name = typeof subject.name === "string" ? subject.name.trim() : "";
    if (name) subjectMap.set(name, subject);
  }
  for (const subject of incoming.subjects || []) {
    const name = typeof subject.name === "string" ? subject.name.trim() : "";
    if (name) subjectMap.set(name, { ...subjectMap.get(name), ...subject });
  }

  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    topic: incoming.topic?.trim() || existing.topic,
    inputSnapshot: { ...existing.inputSnapshot, ...incoming.inputSnapshot },
    scenes: order.map((key) => mergedSceneMap.get(key)!),
    subjects: subjectMap.size ? [...subjectMap.values()] : incoming.subjects || existing.subjects,
    groups: mergeStoryboardGroupRecords(existing.groups, incoming.groups),
  };
}

/** 从已发布站点 launchUrl 解析 runtime 所需的 x-subdomain-project。 */
export function extractProjectHeaderFromLaunchUrl(launchUrl: string): string | null {
  try {
    const hostname = new URL(launchUrl).hostname.trim().toLowerCase();
    for (const suffix of WODEAPP_HOST_SUFFIXES) {
      if (!hostname.endsWith(suffix)) continue;
      const subdomain = hostname.slice(0, -suffix.length);
      if (subdomain && subdomain !== "www") return subdomain;
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

export function resolveStoryboardProjectHeader(
  launchUrl: string,
  hints?: PvsStoryboardProjectHints,
): { header: string | null; source: PvsStoryboardSyncDiagnostic["projectHeaderSource"] } {
  const projectId = typeof hints?.projectId === "string" ? hints.projectId.trim() : "";
  if (projectId) return { header: projectId, source: "projectId" };

  const slug = typeof hints?.slug === "string" ? hints.slug.trim() : "";
  if (slug) return { header: slug, source: "slug" };

  const subdomain = typeof hints?.subdomain === "string" ? hints.subdomain.trim() : "";
  if (subdomain) return { header: subdomain, source: "subdomain" };

  const fromUrl = extractProjectHeaderFromLaunchUrl(launchUrl);
  if (fromUrl) return { header: fromUrl, source: "launchUrl" };

  return { header: null, source: "none" };
}

type PvsShareQueryRow = {
  recordId: string;
  run: PvsStoryboardRunPayload | null;
};

async function queryPvsVideoShareRow(
  docId: string,
  projectHeader: string,
  expectedRecordId?: string,
): Promise<PvsShareQueryRow | null> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，无法读取 pvs_video_shares");
  }

  const response = await requestWodeAppRuntimeJson<unknown>(
    "/v1/data/query",
    {
      method: "POST",
      headers: { "x-subdomain-project": projectHeader },
      body: JSON.stringify({
        collection: PVS_SHARE_COLLECTION,
        filter: { docId },
        limit: 20,
        orderBy: { createdAt: "desc" },
      }),
    },
    30000,
  );
  const records = requireRuntimeDataQueryRecords(response, "pvs_video_shares query");
  const row = expectedRecordId
    ? records.find((record) => runtimeDataRecordId(record) === expectedRecordId)
    : records[0];
  if (!row) return null;
  const recordId = runtimeDataRecordId(row);
  if (!recordId) {
    throw new Error("pvs_video_shares query failed: record id is missing");
  }
  const runRaw = row.run;
  const run =
    runRaw && typeof runRaw === "object" && Array.isArray((runRaw as PvsStoryboardRunPayload).scenes)
      ? (runRaw as PvsStoryboardRunPayload)
      : null;
  return { recordId, run };
}

async function upsertPvsVideoShare(
  docId: string,
  run: PvsStoryboardRunPayload,
  projectHeader: string,
  stats: ReturnType<typeof payloadStats>,
  existingRow: PvsShareQueryRow | null,
): Promise<
  | { ok: true; updated: boolean; recordId: string }
  | { ok: false; error: string; httpStatus?: number; bodySnippet?: string }
> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    const error = "WodeApp 内嵌能力暂未初始化，无法写入 pvs_video_shares";
    logPvsShare("error", "sync skipped: missing credentials", {
      docId,
      projectHeader,
      ...stats,
    });
    return { ok: false, error };
  }

  const payload = { id: docId, docId, run, createdAt: Date.now() };

  if (existingRow?.recordId) {
    logPvsShare("info", "put start", { docId, recordId: existingRow.recordId, projectHeader, ...stats });
    try {
      const putResponse = await requestWodeAppRuntimeJson<unknown>(
        `/v1/data/${encodeURIComponent(existingRow.recordId)}`,
        {
          method: "PUT",
          headers: { "x-subdomain-project": projectHeader },
          body: JSON.stringify({ data: payload, merge: false }),
        },
        60000,
      );
      requireRuntimeDataMutationRecord(putResponse, "pvs_video_shares put");
      const readback = await queryPvsVideoShareRow(
        docId,
        projectHeader,
        existingRow.recordId,
      );
      if (!readback?.run || !runtimeDataPayloadMatches(run, readback.run)) {
        throw new Error(
          "pvs_video_shares readback failed: storyboard payload does not match the updated draft",
        );
      }
      logPvsShare("info", "put verified", {
        docId,
        recordId: existingRow.recordId,
        projectHeader,
        ...stats,
      });
      return { ok: true, updated: true, recordId: existingRow.recordId };
    } catch (error) {
      const httpStatus = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
      const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined;
      const message = error instanceof Error ? error.message : "pvs_video_shares put failed";
      logPvsShare("error", "put failed", {
        docId,
        recordId: existingRow.recordId,
        projectHeader,
        httpStatus,
        error: message,
        bodySnippet,
        ...stats,
      });
      return { ok: false, error: message, httpStatus, bodySnippet };
    }
  }

  const body = JSON.stringify({
    collection: PVS_SHARE_COLLECTION,
    data: payload,
  });

  logPvsShare("info", "sync start", {
    docId,
    projectHeader,
    origin: credentials.origin,
    bodyBytes: body.length,
    ...stats,
  });

  try {
    const syncResponse = await requestWodeAppRuntimeJson<unknown>(
      "/v1/data/sync",
      {
        method: "POST",
        headers: { "x-subdomain-project": projectHeader },
        body,
      },
      60000,
    );
    const mutationRecord = requireRuntimeDataMutationRecord(
      syncResponse,
      "pvs_video_shares sync",
    );
    const readback = await queryPvsVideoShareRow(docId, projectHeader);
    if (!readback?.run || !runtimeDataPayloadMatches(run, readback.run)) {
      throw new Error(
        "pvs_video_shares readback failed: storyboard payload does not match the saved draft",
      );
    }
    const recordId = readback.recordId || runtimeDataRecordId(mutationRecord);
    logPvsShare("info", "sync verified", { docId, recordId, projectHeader, ...stats });
    return { ok: true, updated: false, recordId };
  } catch (error) {
    const httpStatus = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
    const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined;
    const message = error instanceof Error ? error.message : "pvs_video_shares sync failed";
    logPvsShare("error", "sync failed", {
      docId,
      projectHeader,
      httpStatus,
      error: message,
      bodySnippet,
      ...stats,
    });
    return { ok: false, error: message, httpStatus, bodySnippet };
  }
}

const LEGACY_VIDEO_SHARE_QUERY_KEYS = [
  PVS_RUN_QUERY_KEY,
  "pvsDoc",
  "pvsShare",
  PVS_AUTORUN_QUERY_KEY,
] as const;

/** 从 URL 查询参数解析 shareDoc docId；shareDoc 与 pvsRun 冲突时优先较新的 pvsRun */
export function resolveShareDocParamFromWorkbenchUrl(parsed: URL): string | null {
  const shareDocRaw = parsed.searchParams.get(SHARE_DOC_QUERY_KEY)?.trim() || "";
  const pvsRunRaw = parsed.searchParams.get(PVS_RUN_QUERY_KEY)?.trim() || "";
  const pvsDocRaw = parsed.searchParams.get("pvsDoc")?.trim() || "";

  const shareDocId = normalizeShareDocId(shareDocRaw);
  const legacyDocId = normalizeShareDocId(pvsRunRaw) || normalizeShareDocId(pvsDocRaw);

  if (shareDocId && legacyDocId && shareDocId !== legacyDocId) {
    return legacyDocId;
  }
  return shareDocId || legacyDocId || null;
}

/** 写入单一 shareDoc 并剥离旧版分镜参数 */
export function attachShareDocToWorkbenchUrl(baseUrl: string, docId: string): string | null {
  const normalized = normalizeShareDocId(docId);
  if (!normalized) return null;
  try {
    const url = new URL(baseUrl);
    for (const key of LEGACY_VIDEO_SHARE_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    url.searchParams.set(SHARE_DOC_QUERY_KEY, normalized);
    return url.toString();
  } catch {
    return null;
  }
}

/** 规范化分镜工作台 URL：单一 shareDoc，去掉 pvsRun/pvsDoc 混用 */
export function canonicalizeVideoStoryboardWorkbenchUrl(
  url: string,
  forcedDocId?: string | null,
): string | null {
  try {
    const docId = forcedDocId
      ? normalizeShareDocId(forcedDocId)
      : resolveShareDocParamFromWorkbenchUrl(new URL(url));
    if (!docId) return url;
    return attachShareDocToWorkbenchUrl(url, docId);
  } catch {
    return null;
  }
}

export function attachStoryboardPayloadToWorkbenchUrl(baseUrl: string, param: string): string | null {
  const trimmed = param.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(baseUrl);
    for (const key of LEGACY_VIDEO_SHARE_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    url.searchParams.set(SHARE_DOC_QUERY_KEY, trimmed);
    return url.toString();
  } catch {
    return null;
  }
}

function buildSyncDiagnostic(
  partial: Omit<PvsStoryboardSyncDiagnostic, "attempted" | "ok"> & {
    attempted: boolean;
    ok: boolean;
  },
): PvsStoryboardSyncDiagnostic {
  return partial;
}

export async function buildVideoStoryboardTaskUrlAsync(
  demoUrl: string,
  payload: PvsStoryboardRunPayload,
  options?: BuildVideoStoryboardTaskUrlOptions,
): Promise<BuildVideoStoryboardTaskUrlResult> {
  const { header: projectHeader, source: projectHeaderSource } = resolveStoryboardProjectHeader(
    demoUrl,
    options?.projectHints,
  );

  const requestedDocId = normalizeShareDocId(options?.shareDocId);
  let docId = requestedDocId || createShareDocId(payload.topic);
  let runToSave = payload;
  let existingRow: PvsShareQueryRow | null = null;
  let lookupError: {
    error: string;
    httpStatus?: number;
    bodySnippet?: string;
  } | null = null;

  if (requestedDocId && projectHeader) {
    try {
      existingRow = await queryPvsVideoShareRow(requestedDocId, projectHeader);
      if (existingRow?.run) {
        runToSave = mergePvsStoryboardRunPayload(existingRow.run, payload);
        runToSave.id = existingRow.run.id || runToSave.id;
      }
    } catch (error) {
      lookupError = {
        error: error instanceof Error ? error.message : "pvs_video_shares query failed",
        httpStatus: error instanceof WodeAppRuntimeRequestError ? error.status : undefined,
        bodySnippet: error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined,
      };
    }
  }

  const stats = payloadStats(runToSave);
  const encoded = encodePayload(runToSave);
  const requiresDocId =
    stats.sceneCount >= MIN_SCENES_REQUIRE_DOC_ID
    || Boolean(encoded && encoded.length > MAX_INLINE_ENCODED_LENGTH);

  let syncDiagnostic: PvsStoryboardSyncDiagnostic = buildSyncDiagnostic({
    attempted: false,
    ok: false,
    docId,
    updated: false,
    projectHeader,
    projectHeaderSource,
    ...stats,
    encodedBytes: encoded?.length ?? 0,
  });

  if (projectHeader) {
    syncDiagnostic = buildSyncDiagnostic({ ...syncDiagnostic, attempted: true });
    if (lookupError) {
      syncDiagnostic = buildSyncDiagnostic({
        ...syncDiagnostic,
        ok: false,
        httpStatus: lookupError.httpStatus,
        error: lookupError.error,
        bodySnippet: lookupError.bodySnippet,
      });
      return {
        url: null,
        mode: "docId",
        shareDocId: docId,
        saveError: `读取现有视频分镜失败，未执行覆盖或新建：${lookupError.error}`,
        syncDiagnostic,
      };
    }
    const saved = await upsertPvsVideoShare(
      docId,
      runToSave,
      projectHeader,
      stats,
      existingRow,
    );
    if (saved.ok) {
      syncDiagnostic = buildSyncDiagnostic({
        ...syncDiagnostic,
        ok: true,
        verified: true,
        recordId: saved.recordId,
        updated: saved.updated,
      });
      return {
        url: attachShareDocToWorkbenchUrl(demoUrl, docId),
        mode: "docId",
        shareDocId: docId,
        updated: saved.updated,
        syncDiagnostic,
      };
    }
    syncDiagnostic = buildSyncDiagnostic({
      ...syncDiagnostic,
      ok: false,
      httpStatus: saved.httpStatus,
      error: saved.error,
      bodySnippet: saved.bodySnippet,
    });
  } else {
    logPvsShare("warn", "sync skipped: unresolved project header", {
      demoUrl,
      docId,
      hints: options?.projectHints ?? null,
      ...stats,
    });
    syncDiagnostic = buildSyncDiagnostic({
      ...syncDiagnostic,
      error: "无法解析 x-subdomain-project（缺少 projectId/slug/subdomain 且 launchUrl 无效）",
    });
  }

  if (!encoded) {
    return {
      url: null,
      mode: "inline",
      shareDocId: docId,
      saveError: projectHeader
        ? `分镜写入云端失败：${syncDiagnostic.error || "未知错误"}`
        : "无法从视频项目链接解析项目标识（x-subdomain-project）",
      syncDiagnostic,
    };
  }

  if (requiresDocId) {
    const detail = syncDiagnostic.httpStatus
      ? `HTTP ${syncDiagnostic.httpStatus}${syncDiagnostic.bodySnippet ? ` — ${syncDiagnostic.bodySnippet.slice(0, 120)}` : ""}`
      : syncDiagnostic.error || "未知错误";
    return {
      url: null,
      mode: "inline",
      shareDocId: docId,
      saveError: projectHeader
        ? `视频任务过大（${stats.sceneCount} 条 / ${stats.runJsonBytes} 字节），必须先写入 pvs_video_shares 短链；sync 失败：${detail}。请检查 WodeApp 登录状态、API Key 与视频项目权限后重试，禁止 inline 兜底。`
        : "无法从视频项目链接解析项目标识，无法写入 pvs_video_shares 短链",
      syncDiagnostic,
    };
  }

  const inlineUrl = attachStoryboardPayloadToWorkbenchUrl(demoUrl, encoded);
  if (inlineUrl && inlineUrl.length <= MAX_SAFE_TASK_URL_CHARS) {
    logPvsShare("info", "inline fallback (single short scene only)", {
      urlChars: inlineUrl.length,
      ...stats,
    });
    return { url: inlineUrl, mode: "inline", syncDiagnostic };
  }

  return {
    url: null,
    mode: "inline",
    shareDocId: docId,
    saveError: projectHeader
      ? `视频任务过大，云端短链写入失败${inlineUrl ? `（URL 长度 ${inlineUrl.length} 超过安全上限 ${MAX_SAFE_TASK_URL_CHARS}）` : ""}：${syncDiagnostic.error || "请重试"}`
      : "无法从视频项目链接解析项目标识，无法写入 pvs_video_shares 短链",
    syncDiagnostic,
  };
}
