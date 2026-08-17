/**
 * 生成历史分享：把结果媒体做成可打开的工作台短链（shareDoc / 内联 payload）。
 * 打开后可在图片/视频工作台查看生成结果。
 */
import type { DigitalAssetItem, DigitalAssetKind } from "./digital-assets-data";
import {
  buildOwnedAbilityLaunchUrl,
  findWodeAppBuiltinAgent,
  isOfficialAbilityDemoUrl,
  matchAbilityProject,
  readWodeAppAbilityProjects,
  type WodeAppAbilityProject,
} from "./runtime-projects";
import {
  requireRuntimeDataMutationRecord,
  requireRuntimeDataQueryRecords,
  runtimeDataRecordId,
} from "./wodeapp-runtime-data-handoff";

const PVS_SHARE_COLLECTION = "pvs_video_shares";
const PV_SHARE_COLLECTION = "pv_visual_shares";
const SHARE_DOC_QUERY_KEY = "shareDoc";
const PVS_INLINE_QUERY_KEY = "pvsShare";
const PV_INLINE_QUERY_KEY = "pvShare";
const MAX_INLINE_SHARE_QUERY_LEN = 1800;
const WODEAPP_HOST_SUFFIXES = [".wodeapp.cn", ".wodeapp.ai"] as const;

function extractProjectHeaderFromLaunchUrl(launchUrl: string): string | null {
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

function resolveShareProjectHeader(
  launchUrl: string,
  abilityProject?: WodeAppAbilityProject,
): string | null {
  const projectId = abilityProject?.projectId?.trim();
  if (projectId) return projectId;
  const slug = abilityProject?.slug?.trim();
  if (slug) return slug;
  const subdomain = abilityProject?.subdomain?.trim();
  if (subdomain) return subdomain;
  return extractProjectHeaderFromLaunchUrl(launchUrl);
}

export type GenerationHistoryShareMode = "existing" | "docId" | "inline" | "media";

export type GenerationHistoryShareResult = {
  shareUrl: string;
  mode: GenerationHistoryShareMode;
  shareDocId?: string;
  mediaType: "video" | "image" | "file";
};

export type GenerationHistoryShareableKind = "video" | "image" | "file";

function isHttpsUrl(value: string | undefined): value is string {
  return Boolean(value && /^https:\/\//i.test(value.trim()));
}

function uniqueHttpsUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const url = value?.trim();
    if (!isHttpsUrl(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function collectGenerationHistoryMediaUrls(item: DigitalAssetItem): string[] {
  return uniqueHttpsUrls([
    ...(item.assetImages || []),
    ...(item.productImages || []),
    ...(item.brandAssets || []),
    item.coverImage,
    item.assetFile,
    ...(item.assetFiles || []).map((file) => file.url),
  ]).slice(0, 24);
}

export function resolveGenerationHistoryShareKind(
  item: DigitalAssetItem,
): GenerationHistoryShareableKind | null {
  const urls = collectGenerationHistoryMediaUrls(item);
  if (!urls.length && !item.generationShareUrl?.trim()) return null;

  if (item.kind === "视频") return "video";
  if (item.kind === "图片" || item.kind === "真人" || item.kind === "商品库" || item.kind === "品牌库") {
    return "image";
  }
  if (item.kind === "声音" || item.kind === "文件" || item.kind === "剧本") return "file";
  if (urls.some((url) => /\.(mp4|webm|mov)(\?|$)/i.test(url))) return "video";
  if (urls.some((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))) return "image";
  return urls.length ? "file" : item.generationShareUrl?.trim() ? "file" : null;
}

export function canShareGenerationHistory(item: DigitalAssetItem): boolean {
  return resolveGenerationHistoryShareKind(item) !== null;
}

function sanitizeShareToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
}

export function buildGenerationHistoryShareDocId(
  item: Pick<DigitalAssetItem, "id">,
  kind: GenerationHistoryShareableKind,
): string {
  const token = sanitizeShareToken(item.id || "generation");
  if (kind === "video") return `pvs_wappxgen_${token}`;
  if (kind === "image") return `wodeapp-img-wappxgen-${token}`;
  return `wodeapp-file-wappxgen-${token}`;
}

function promptFromItem(item: DigitalAssetItem): string {
  return (item.promptText || item.name || "").trim();
}

function encodeSharePayload(payload: unknown): string | null {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    return null;
  }
}

export function buildGenerationHistoryVideoRun(item: DigitalAssetItem): Record<string, unknown> | null {
  const urls = collectGenerationHistoryMediaUrls(item);
  if (!urls.length) return null;
  const prompt = promptFromItem(item);
  const now = Date.now();
  const topic = (item.name || prompt.split(/[\n。！？.!?]/)[0] || "生成历史视频").trim().slice(0, 60);
  const scenes = urls.map((url, index) => ({
    id: `sc-wappxgen-${sanitizeShareToken(item.id)}-${index}`,
    name: urls.length > 1 ? `场景 ${index + 1}` : topic,
    prompt: prompt || topic,
    duration: 5,
    taskType: "text2video",
    engine: item.generationProvider || "",
    model: item.generationModel || "",
    mode: "std",
    aspectRatio: "9:16",
    source: "ai",
    revision: 0,
    updatedAt: now,
    status: "idle",
    videoUrl: url,
    thumbnailUrl: url,
    subjects: [],
    history: [{
      id: `vh-wappxgen-${sanitizeShareToken(item.id)}-${index}`,
      videoUrl: url,
      thumbnailUrl: url,
      createdAt: now,
      prompt: prompt || topic,
    }],
  }));

  return {
    id: `run-wappxgen-${sanitizeShareToken(item.id)}`,
    topic,
    createdAt: now,
    inputSnapshot: {
      topic,
      ratio: "9:16",
      mode: "std",
      aiModel: item.generationModel || "",
    },
    scenes,
    subjects: [],
    status: "done",
    total: scenes.length,
    succeedCount: scenes.length,
    failedCount: 0,
    generatingCount: 0,
  };
}

export function buildGenerationHistoryPvSession(item: DigitalAssetItem): Record<string, unknown> | null {
  const urls = collectGenerationHistoryMediaUrls(item);
  if (!urls.length) return null;
  const prompt = promptFromItem(item);
  const now = Date.now();
  const productName = (item.name || prompt.split(/[\n。！？.!?]/)[0] || "生成历史").trim().slice(0, 40);
  const candidates = urls.map((url, index) => ({
    id: `wappxgen-${sanitizeShareToken(item.id)}-${index}`,
    url,
    label: urls.length > 1 ? `图 ${index + 1}` : "生成结果",
    createdAt: now,
    prompt: prompt || undefined,
  }));

  return {
    id: `wappxgen-${sanitizeShareToken(item.id)}`,
    createdAt: now,
    productName,
    creativeTypes: [],
    candidates,
    snapshot: {
      productImages: [],
      refImages: [],
      productName,
      supplement: prompt,
      aspectRatio: "3:4",
      model: item.generationModel || "",
      plannerModel: "",
      iterCount: urls.length,
      parallel: 1,
      selectedCreativeTypes: [],
    },
  };
}

function attachQuery(baseUrl: string, key: string, value: string): string | null {
  try {
    const url = new URL(baseUrl);
    url.searchParams.delete("pvsRun");
    url.searchParams.delete("pvsDoc");
    url.searchParams.delete("pvsShare");
    url.searchParams.delete("pvShare");
    url.searchParams.delete("pvDoc");
    url.searchParams.delete("pvsAutoRun");
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return null;
  }
}

export function buildGenerationHistoryInlineShareUrl(
  item: DigitalAssetItem,
  kind: GenerationHistoryShareableKind,
  baseUrl: string,
): string | null {
  if (kind === "file") return null;
  const payload = kind === "video"
    ? buildGenerationHistoryVideoRun(item)
    : buildGenerationHistoryPvSession(item);
  if (!payload) return null;
  const encoded = encodeSharePayload(payload);
  if (!encoded) return null;
  const key = kind === "video" ? PVS_INLINE_QUERY_KEY : PV_INLINE_QUERY_KEY;
  const url = attachQuery(baseUrl, key, encoded);
  if (!url || url.length > MAX_INLINE_SHARE_QUERY_LEN + baseUrl.length) return null;
  if (url.length > 6000) return null;
  return url;
}

function resolveShareBaseUrl(
  _kind: GenerationHistoryShareableKind,
  abilityProject: WodeAppAbilityProject | undefined,
): string {
  const launch = abilityProject?.launchUrl?.trim() || abilityProject?.url?.trim() || "";
  if (launch && !isOfficialAbilityDemoUrl(launch)) return launch;
  const slug = abilityProject?.subdomain || abilityProject?.slug || "";
  if (slug) return buildOwnedAbilityLaunchUrl(slug);
  return "";
}

function resolveAbilityProjectForKind(kind: GenerationHistoryShareableKind): WodeAppAbilityProject | undefined {
  const projects = readWodeAppAbilityProjects();
  const agentId = kind === "video" ? "video-generation" : "visual-generation";
  const agent = findWodeAppBuiltinAgent(agentId, projects);
  if (!agent) return undefined;
  return matchAbilityProject(agent, projects);
}

async function syncShareDoc(opts: {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
  projectHeader: string;
}): Promise<{ ok: true; recordId: string } | { ok: false; error: string }> {
  const {
    getWodeAppApiCredentials,
    requestWodeAppRuntimeJson,
    WodeAppRuntimeRequestError,
  } = await import("@/app/lib/wodeapp-auth");

  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    return { ok: false, error: "请先登录 WodeApp 账户后再分享" };
  }

  const payload = {
    id: opts.docId,
    docId: opts.docId,
    createdAt: Date.now(),
    ...opts.data,
  };

  try {
    const existing = await requestWodeAppRuntimeJson<unknown>(
      "/v1/data/query",
      {
        method: "POST",
        headers: { "x-subdomain-project": opts.projectHeader },
        body: JSON.stringify({
          collection: opts.collection,
          filter: { docId: opts.docId },
          limit: 1,
        }),
      },
      30000,
    ).catch(() => null);

    let existingRecordId = "";
    if (existing) {
      try {
        const records = requireRuntimeDataQueryRecords(existing, `${opts.collection} query`);
        existingRecordId = runtimeDataRecordId(records[0] || {});
      } catch {
        existingRecordId = "";
      }
    }

    if (existingRecordId) {
      const putResponse = await requestWodeAppRuntimeJson<unknown>(
        `/v1/data/${encodeURIComponent(existingRecordId)}`,
        {
          method: "PUT",
          headers: { "x-subdomain-project": opts.projectHeader },
          body: JSON.stringify({ data: payload, merge: false }),
        },
        60000,
      );
      requireRuntimeDataMutationRecord(putResponse, `${opts.collection} put`);
      return { ok: true, recordId: existingRecordId };
    }

    const syncResponse = await requestWodeAppRuntimeJson<unknown>(
      "/v1/data/sync",
      {
        method: "POST",
        headers: { "x-subdomain-project": opts.projectHeader },
        body: JSON.stringify({
          collection: opts.collection,
          data: payload,
        }),
      },
      60000,
    );
    const record = requireRuntimeDataMutationRecord(syncResponse, `${opts.collection} sync`);
    return { ok: true, recordId: runtimeDataRecordId(record) || opts.docId };
  } catch (error) {
    const message = error instanceof WodeAppRuntimeRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : "分享记录写入失败";
    return { ok: false, error: message };
  }
}

export async function createGenerationHistoryShare(
  item: DigitalAssetItem,
): Promise<GenerationHistoryShareResult> {
  const existing = item.generationShareUrl?.trim();
  if (existing && /^https?:\/\//i.test(existing)) {
    return {
      shareUrl: existing,
      mode: "existing",
      mediaType: resolveGenerationHistoryShareKind(item) || "file",
    };
  }

  const kind = resolveGenerationHistoryShareKind(item);
  if (!kind) {
    throw new Error("这条生成记录没有可分享的媒体链接");
  }

  const urls = collectGenerationHistoryMediaUrls(item);
  if (kind === "file") {
    const mediaUrl = urls[0];
    if (!mediaUrl) throw new Error("这条生成记录没有可分享的媒体链接");
    return { shareUrl: mediaUrl, mode: "media", mediaType: "file" };
  }

  const abilityProject = resolveAbilityProjectForKind(kind);
  const baseUrl = resolveShareBaseUrl(kind, abilityProject);
  const docId = buildGenerationHistoryShareDocId(item, kind);
  const projectHeader = resolveShareProjectHeader(baseUrl, abilityProject);

  if (projectHeader && abilityProject) {
    const payload = kind === "video"
      ? { run: buildGenerationHistoryVideoRun(item) }
      : { session: buildGenerationHistoryPvSession(item) };
    if (payload.run || payload.session) {
      const synced = await syncShareDoc({
        collection: kind === "video" ? PVS_SHARE_COLLECTION : PV_SHARE_COLLECTION,
        docId,
        data: payload as Record<string, unknown>,
        projectHeader,
      });
      if (synced.ok) {
        const shareUrl = attachQuery(baseUrl, SHARE_DOC_QUERY_KEY, docId);
        if (shareUrl) {
          return {
            shareUrl,
            mode: "docId",
            shareDocId: docId,
            mediaType: kind,
          };
        }
      }
    }
  }

  const inlineUrl = buildGenerationHistoryInlineShareUrl(item, kind, baseUrl);
  if (inlineUrl) {
    return { shareUrl: inlineUrl, mode: "inline", mediaType: kind };
  }

  const mediaUrl = urls[0];
  if (mediaUrl) {
    return { shareUrl: mediaUrl, mode: "media", mediaType: kind };
  }

  throw new Error("无法生成分享链接，请确认结果已是可访问的 https 地址");
}

export function generationHistoryShareToastMessage(mode: GenerationHistoryShareMode): string {
  if (mode === "existing") return "已复制分享链接";
  if (mode === "docId") return "已生成分享链接并复制";
  if (mode === "inline") return "已复制分享链接（打开即可查看）";
  return "已复制媒体链接";
}

/** 测试/调试：仅校验 kind 映射，不发起网络请求 */
export function generationHistoryShareDebugLabel(kind: DigitalAssetKind): string {
  return `generation-share:${kind}`;
}
