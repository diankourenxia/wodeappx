/**
 * WodeAppX 批量出图任务：payload 落库 pv_visual_tasks，页面用平台统一短链 ?shareDoc=pvi_xxx 拉取。
 */
import {
  WodeAppRuntimeRequestError,
  getWodeAppApiCredentials,
  requestWodeAppRuntimeJson,
} from "@/app/lib/wodeapp-auth";

import {
  extractProjectHeaderFromLaunchUrl,
  type PvsStoryboardProjectHints,
  resolveStoryboardProjectHeader,
} from "./wodeapp-pvs-storyboard-url";
import {
  requireRuntimeDataMutationRecord,
  requireRuntimeDataQueryRecords,
  runtimeDataPayloadMatches,
  runtimeDataRecordId,
} from "./wodeapp-runtime-data-handoff";

const PV_VISUAL_TASK_COLLECTION = "pv_visual_tasks";
// 平台统一分享/注入参数；批量出图 doc 用 pvi_ 前缀路由到 pv_visual_tasks
const SHARE_DOC_QUERY_KEY = "shareDoc";
// @deprecated 旧链接只读兼容
const PV_TASK_DOC_QUERY_KEY = "pvTaskDoc";
const PV_CATALOG_IMPORT_QUERY_KEY = "pvCatalogImport";
/** @deprecated 旧链接兼容清理 */
const PV_AUTORUN_QUERY_KEY = "pvAutoRun";
/** headless 批次 ID（pvb_），仅作兼容/追踪；第三栏主入口使用 shareDoc=pvi_ */
export const PV_BATCH_ID_QUERY_KEY = "pvBatchId";
const PV_BATCH_TASK_ID_ALIAS_KEY = "taskId";
const PV_ASPECT_RATIO_QUERY_KEY = "pvAspectRatio";
const PV_ITER_COUNT_QUERY_KEY = "pvIterCount";
const PV_PARALLEL_QUERY_KEY = "pvParallel";
const PV_SELECTED_TYPES_QUERY_KEY = "pvTypes";

const MAX_INLINE_ENCODED_LENGTH = 1500;
const MAX_SAFE_TASK_URL_CHARS = 6000;

export type VisualGenerationTaskPayload = {
  capabilityId?: string;
  name?: string;
  productImages?: string[];
  refImages?: string[];
  supplement?: string;
  productInfo?: string;
  sourceAssetId?: string;
  sourceAssetKind?: string;
  aspectRatio?: string;
  iterCount?: number;
  parallel?: number;
  model?: string;
  selectedCreativeTypes?: string[];
  creativeTypes?: Array<{
    id: string;
    label: string;
    promptSuffix: string;
    aspectRatios?: string[];
    plannerHint?: string;
  }>;
  activeMode?: "simple" | "full";
  skipPlanner?: boolean;
  imageCards?: Array<{
    id: string;
    title: string;
    prompt: string;
    negativePrompt?: string;
    creativeTypeId: string;
    aspectRatio: string;
    model?: string;
    status: "draft" | "generating" | "succeeded" | "failed";
    resultUrl?: string;
    error?: string;
    createdAt: number;
  }>;
};

export type PvVisualTaskSyncDiagnostic = {
  attempted: boolean;
  ok: boolean;
  verified?: boolean;
  docId?: string;
  recordId?: string;
  projectHeader?: string | null;
  projectHeaderSource?: "projectId" | "slug" | "subdomain" | "launchUrl" | "none";
  taskJsonBytes?: number;
  encodedBytes?: number;
  httpStatus?: number;
  error?: string;
  bodySnippet?: string;
};

export type BuildVisualGenerationTaskUrlResult = {
  url: string | null;
  mode: "docId" | "inline";
  taskDocId?: string;
  saveError?: string;
  syncDiagnostic?: PvVisualTaskSyncDiagnostic;
};

function createPvVisualTaskDocId(name?: string): string {
  const slug = (name || "batch")
    .trim()
    .slice(0, 36)
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "batch";
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `pvi_${slug}_${stamp}_${rand}`;
}

function encodeVisualTaskPayload(payload: VisualGenerationTaskPayload): string | null {
  try {
    if (typeof btoa !== "function") return null;
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    return null;
  }
}

function taskStats(task: VisualGenerationTaskPayload) {
  const taskJson = JSON.stringify(task);
  const encoded = encodeVisualTaskPayload(task);
  return {
    taskJsonBytes: taskJson.length,
    encodedBytes: encoded?.length ?? 0,
  };
}

function logPvTask(level: "info" | "warn" | "error", message: string, detail: Record<string, unknown>) {
  const tag = "[WodeAppX][pv_visual_tasks]";
  const line = { message, ...detail };
  if (level === "info") console.info(tag, line);
  else if (level === "warn") console.warn(tag, line);
  else console.error(tag, line);
}

/**
 * Attach query params onto the ability project's launch URL.
 * Keep the existing pathname — WodeAppX 图片能力项目页面在 `/`，
 * 强制改成 `/product-visual` 会在错误子域/无对应页时变成 404。
 * （对齐视频分镜 attachShareDocToWorkbenchUrl 行为。）
 */
function productVisualUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (!url.pathname || url.pathname === "") {
    url.pathname = "/";
  }
  return url;
}

function attachPvVisualTaskDocParam(baseUrl: string, docId: string): string | null {
  try {
    const url = productVisualUrl(baseUrl);
    url.searchParams.set(SHARE_DOC_QUERY_KEY, docId);
    url.searchParams.delete(PV_TASK_DOC_QUERY_KEY);
    url.searchParams.delete(PV_CATALOG_IMPORT_QUERY_KEY);
    url.searchParams.delete(PV_AUTORUN_QUERY_KEY);
    return url.toString();
  } catch {
    return null;
  }
}

/** 在已生成的任务链接上附加 headless 批次 ID，打开后展示执行结果。 */
export function attachProductVisualBatchIdParam(baseUrl: string, batchId: string): string | null {
  const trimmed = batchId.trim();
  if (!trimmed) return null;
  try {
    const url = productVisualUrl(baseUrl);
    url.searchParams.set(PV_BATCH_TASK_ID_ALIAS_KEY, trimmed);
    url.searchParams.set(PV_BATCH_ID_QUERY_KEY, trimmed);
    return url.toString();
  } catch {
    return null;
  }
}

async function savePvVisualTask(
  docId: string,
  task: VisualGenerationTaskPayload,
  projectHeader: string,
  stats: ReturnType<typeof taskStats>,
): Promise<
  | { ok: true; recordId?: string }
  | { ok: false; error: string; httpStatus?: number; bodySnippet?: string }
> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    const error = "WodeApp 内嵌能力暂未初始化，无法写入 pv_visual_tasks";
    logPvTask("error", "sync skipped: missing credentials", { docId, projectHeader, ...stats });
    return { ok: false, error };
  }

  const body = JSON.stringify({
    collection: PV_VISUAL_TASK_COLLECTION,
    data: { id: docId, docId, task, createdAt: Date.now() },
  });

  logPvTask("info", "sync start", {
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
        headers: {
          "x-subdomain-project": projectHeader,
        },
        body,
      },
      60000,
    );
    const mutationRecord = requireRuntimeDataMutationRecord(
      syncResponse,
      "pv_visual_tasks sync",
    );
    const queryResponse = await requestWodeAppRuntimeJson<unknown>(
      "/v1/data/query",
      {
        method: "POST",
        headers: {
          "x-subdomain-project": projectHeader,
        },
        body: JSON.stringify({
          collection: PV_VISUAL_TASK_COLLECTION,
          filter: { docId },
          limit: 20,
          orderBy: { createdAt: "desc" },
        }),
      },
      30000,
    );
    const records = requireRuntimeDataQueryRecords(
      queryResponse,
      "pv_visual_tasks readback",
    );
    const row = records.find((record) => (
      record.docId === docId
      && runtimeDataPayloadMatches(task, record.task)
    ));
    if (!row) {
      throw new Error(
        "pv_visual_tasks readback failed: docId or task payload does not match the saved draft",
      );
    }
    const recordId = runtimeDataRecordId(row) || runtimeDataRecordId(mutationRecord) || undefined;
    logPvTask("info", "sync verified", { docId, recordId, projectHeader, ...stats });
    return { ok: true, recordId };
  } catch (error) {
    const httpStatus = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
    const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined;
    const message = error instanceof Error ? error.message : "pv_visual_tasks sync failed";
    logPvTask("error", "sync failed", {
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

function attachInlineCatalogImport(baseUrl: string, task: VisualGenerationTaskPayload): string | null {
  const encoded = encodeVisualTaskPayload(task);
  if (!encoded) return null;
  try {
    const url = productVisualUrl(baseUrl);
    url.searchParams.set(PV_CATALOG_IMPORT_QUERY_KEY, encoded);
    if (task.aspectRatio) url.searchParams.set(PV_ASPECT_RATIO_QUERY_KEY, task.aspectRatio);
    if (task.iterCount) url.searchParams.set(PV_ITER_COUNT_QUERY_KEY, String(task.iterCount));
    if (task.parallel) url.searchParams.set(PV_PARALLEL_QUERY_KEY, String(task.parallel));
    if (task.selectedCreativeTypes?.length) {
      url.searchParams.set(PV_SELECTED_TYPES_QUERY_KEY, task.selectedCreativeTypes.join(","));
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function buildVisualGenerationTaskUrlAsync(
  demoUrl: string,
  task: VisualGenerationTaskPayload,
  options?: { projectHints?: PvsStoryboardProjectHints },
): Promise<BuildVisualGenerationTaskUrlResult> {
  const stats = taskStats(task);
  const { header: projectHeader, source: projectHeaderSource } = resolveStoryboardProjectHeader(
    demoUrl,
    options?.projectHints,
  );
  const docId = createPvVisualTaskDocId(task.name);
  const encoded = encodeVisualTaskPayload(task);
  const prefersDocId = Boolean(
    projectHeader
    || stats.encodedBytes > MAX_INLINE_ENCODED_LENGTH
    || stats.taskJsonBytes > 4096,
  );

  let syncDiagnostic: PvVisualTaskSyncDiagnostic = {
    attempted: false,
    ok: false,
    docId,
    projectHeader,
    projectHeaderSource,
    ...stats,
  };

  if (projectHeader) {
    syncDiagnostic = { ...syncDiagnostic, attempted: true };
    const saved = await savePvVisualTask(docId, task, projectHeader, stats);
    if (saved.ok) {
      return {
        url: attachPvVisualTaskDocParam(demoUrl, docId),
        mode: "docId",
        taskDocId: docId,
        syncDiagnostic: {
          ...syncDiagnostic,
          ok: true,
          verified: true,
          recordId: saved.recordId,
        },
      };
    }
    syncDiagnostic = {
      ...syncDiagnostic,
      ok: false,
      httpStatus: saved.httpStatus,
      error: saved.error,
      bodySnippet: saved.bodySnippet,
    };
    if (prefersDocId) {
      const detail = saved.httpStatus
        ? `HTTP ${saved.httpStatus}${saved.bodySnippet ? ` — ${saved.bodySnippet.slice(0, 120)}` : ""}`
        : saved.error || "未知错误";
      return {
        url: null,
        mode: "docId",
        taskDocId: docId,
        saveError: `出图任务写入云端失败：${detail}。请检查 WodeApp 登录状态、API Key 与图片项目权限后重试。`,
        syncDiagnostic,
      };
    }
  } else if (prefersDocId) {
    logPvTask("warn", "sync skipped: unresolved project header", {
      demoUrl,
      docId,
      hints: options?.projectHints ?? null,
      ...stats,
    });
    syncDiagnostic = {
      ...syncDiagnostic,
      error: "无法解析 x-subdomain-project（缺少 projectId/slug/subdomain 且 launchUrl 无效）",
    };
    return {
      url: null,
      mode: "docId",
      taskDocId: docId,
      saveError: "无法从图片项目链接解析项目标识，无法写入 pv_visual_tasks 短链",
      syncDiagnostic,
    };
  }

  if (!encoded || stats.encodedBytes > MAX_INLINE_ENCODED_LENGTH) {
    return {
      url: null,
      mode: "inline",
      saveError: syncDiagnostic.error || "出图任务过大，且无法写入云端短链",
      syncDiagnostic,
    };
  }

  const inlineUrl = attachInlineCatalogImport(demoUrl, task);
  if (inlineUrl && inlineUrl.length <= MAX_SAFE_TASK_URL_CHARS) {
    logPvTask("info", "inline fallback", {
      urlChars: inlineUrl.length,
      ...stats,
    });
    return { url: inlineUrl, mode: "inline", syncDiagnostic };
  }

  return {
    url: null,
    mode: "inline",
    saveError: syncDiagnostic.error || `出图任务 URL 过长（${inlineUrl?.length ?? 0} 字符）`,
    syncDiagnostic,
  };
}

export { extractProjectHeaderFromLaunchUrl };
