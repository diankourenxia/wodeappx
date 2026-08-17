/**
 * Isolate one vendor key, probe its catalog, match chat/image/video routes,
 * optionally ping a live invoke. Swap vendor ids without rewriting the flow.
 *
 * Never returns raw secrets.
 */

import {
  collectProviderSecrets,
  probeProviderSecret,
} from "../../wodeapp-cloud/electron/wodeapp-provider-capability-detect.mjs";
import {
  buildModelRoutesFromSources,
  isOriginalProvider,
  matchGenerationRoute,
  matchModelRoute,
  type ModelRoute,
  type ModelRouteSource,
} from "./wodeapp-model-route-match";
import type { GenerationModality } from "./wodeapp-provider-capability";

export type IsolateInvokeMode = "none" | "chat" | "image";

export type IsolatedVendorCatalog = {
  vendorId: string;
  modelCount: number;
  families: string[];
  match: {
    text: ModelRoute | null;
    image: ModelRoute | null;
    video: ModelRoute | null;
  };
  invokeCandidates: {
    text: string[];
    image: string[];
    video: string[];
  };
};

export type IsolatedVendorPing = {
  kind: IsolateInvokeMode;
  ok: boolean;
  status: number;
  model?: string;
  hasContent?: boolean;
  hasOutput?: boolean;
  err?: string;
  attempts?: Array<{ model: string; status: number; ok: boolean; err?: string }>;
};

export type IsolatedVendorReport = {
  ok: boolean;
  vendorId: string;
  probeStatus?: string;
  error?: string;
  catalog?: IsolatedVendorCatalog;
  ping?: IsolatedVendorPing;
};

const SKIP_INVOKE = /embed|tts|rerank|whisper|codec|tokenizer|character/i;
const IMAGE_PROMPT = "a red apple, simple studio, white background";

type VendorSecret = {
  id: string;
  apiKey: string;
  modelsUrl?: string;
  assumed?: { text?: boolean; image?: boolean; video?: boolean };
};

export function catalogDateScore(modelID: string): number {
  const id = String(modelID || "").toLowerCase();
  const match = id.match(/(?:^|[-_/])((?:20)?(\d{6}))(?:[-_/]|$)/);
  if (!match) return 0;
  const six = match[2] || match[1]?.slice(-6);
  const n = Number(six);
  return Number.isFinite(n) ? n : 0;
}

function homeVendorScore(route: ModelRoute, vendorId?: string): number {
  const vendor = String(vendorId || "").trim().toLowerCase();
  if (!vendor) return 0;
  return isOriginalProvider(route.familyId, vendor) ? 1 : 0;
}

export function rankInvokeCandidates(
  routes: readonly ModelRoute[],
  modality: GenerationModality,
  vendorId?: string,
): string[] {
  return [...routes]
    .filter((route) => route.modality === modality && !SKIP_INVOKE.test(route.modelID))
    .sort((a, b) => {
      const byHome = homeVendorScore(b, vendorId) - homeVendorScore(a, vendorId);
      if (byHome !== 0) return byHome;
      const byDate = catalogDateScore(b.modelID) - catalogDateScore(a.modelID);
      if (byDate !== 0) return byDate;
      return a.modelID.localeCompare(b.modelID);
    })
    .map((route) => route.modelID);
}

export function isolateVendorCatalog(source: ModelRouteSource): IsolatedVendorCatalog {
  const vendorId = String(source.id || "").trim();
  const routes = buildModelRoutesFromSources([source]);
  const families = [...new Set(routes.map((route) => route.familyId))];
  return {
    vendorId,
    modelCount: Array.isArray(source.modelIds) ? source.modelIds.length : routes.length,
    families,
    match: {
      text: matchModelRoute(null, routes, "text"),
      image: matchGenerationRoute([source], "image"),
      video: matchGenerationRoute([source], "video"),
    },
    invokeCandidates: {
      text: rankInvokeCandidates(routes, "text", vendorId),
      image: rankInvokeCandidates(routes, "image", vendorId),
      video: rankInvokeCandidates(routes, "video", vendorId),
    },
  };
}

export async function listIsolatedVendorIds(): Promise<string[]> {
  const secrets = await collectProviderSecrets({ skipMonorepo: true }) as VendorSecret[];
  return secrets.map((item) => item.id);
}

function chatCompletionsUrl(modelsUrl?: string): string | null {
  const url = String(modelsUrl || "").trim();
  if (!url) return null;
  if (url.endsWith("/models")) return `${url.slice(0, -"/models".length)}/chat/completions`;
  if (url.endsWith("/models/")) return `${url.slice(0, -"/models/".length)}/chat/completions`;
  return null;
}

function chatHeaders(vendorId: string): Record<string, string> {
  if (vendorId === "openrouter") {
    return {
      "HTTP-Referer": "https://wodeappx.local",
      "X-Title": "WodeAppX isolation",
    };
  }
  return {};
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, ok: response.ok, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, ok: response.ok, json: { parseError: true } };
  }
}

function jsonErr(json: unknown): string {
  const row = json && typeof json === "object" ? json as Record<string, unknown> : {};
  const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
  const raw = String(nested.message || nested.code || row.detail || row.error || "");
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/<(ak|sk)-[^>]+>/gi, "<$1-***>")
    .replace(/\b(ak|sk)-[a-z0-9-]+/gi, "$1-***")
    .replace(/\borg-[a-f0-9]+\b/gi, "org-***")
    .slice(0, 240);
}

async function pingChat(url: string, apiKey: string, model: string, extraHeaders: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word pong." }],
      max_tokens: 8,
      stream: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await readJson(response);
  const choice = body.json?.choices?.[0];
  const content = String(choice?.message?.content || choice?.text || choice?.message?.reasoning_content || "").trim();
  return {
    status: body.status,
    ok: body.ok,
    hasChoice: Boolean(choice),
    hasContent: Boolean(content),
    err: jsonErr(body.json),
  };
}

async function pingChatUntilOk(
  url: string,
  apiKey: string,
  models: string[],
  extraHeaders: Record<string, string>,
): Promise<IsolatedVendorPing> {
  const attempts: IsolatedVendorPing["attempts"] = [];
  for (const model of models.slice(0, 8)) {
    const result = await pingChat(url, apiKey, model, extraHeaders);
    attempts.push({ model, status: result.status, ok: result.ok && (result.hasContent || result.hasChoice), err: result.err });
    if (result.ok && (result.hasContent || result.hasChoice)) {
      return { kind: "chat", ok: true, status: result.status, model, hasContent: result.hasContent, attempts };
    }
  }
  return {
    kind: "chat",
    ok: false,
    status: attempts[0]?.status || 0,
    model: models[0],
    hasContent: false,
    err: attempts[0]?.err || "all chat candidates failed",
    attempts,
  };
}

async function pingVolcanoImage(apiKey: string, model: string): Promise<IsolatedVendorPing> {
  const body = await readJson(await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: IMAGE_PROMPT,
      size: "2K",
      response_format: "url",
      watermark: false,
    }),
    signal: AbortSignal.timeout(90_000),
  }));
  const url = String(body.json?.data?.[0]?.url || body.json?.data?.[0]?.b64_json || "");
  return {
    kind: "image",
    ok: body.ok && Boolean(url),
    status: body.status,
    model,
    hasOutput: Boolean(url),
    err: jsonErr(body.json),
  };
}

async function pingReplicateImage(apiKey: string, model: string): Promise<IsolatedVendorPing> {
  const body = await readJson(await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ input: { prompt: IMAGE_PROMPT } }),
    signal: AbortSignal.timeout(90_000),
  }));
  const status = String(body.json?.status || "");
  const output = body.json?.output;
  return {
    kind: "image",
    ok: body.ok && (status === "succeeded" || Boolean(output)),
    status: body.status,
    model,
    hasOutput: Boolean(output) || status === "succeeded",
    err: jsonErr(body.json) || (status && status !== "succeeded" ? status : ""),
  };
}

export async function runIsolatedVendor(
  vendorId: string,
  options: { invoke?: IsolateInvokeMode } = {},
): Promise<IsolatedVendorReport> {
  const id = String(vendorId || "").trim();
  const invoke = options.invoke || "none";
  const secrets = await collectProviderSecrets({ skipMonorepo: true }) as VendorSecret[];
  const secret = secrets.find((item) => item.id === id);
  if (!secret?.apiKey) {
    return { ok: false, vendorId: id, error: "no local key" };
  }

  const probe = await probeProviderSecret(secret, { timeoutMs: 20_000 });
  const modelIds = (probe.models || []).map((item: { id?: string }) => String(item.id || "").trim()).filter(Boolean);
  const catalog = isolateVendorCatalog({
    id,
    modelIds,
    estimated: Boolean(secret.assumed) && modelIds.length === 0,
    modalities: secret.assumed,
  });
  const report: IsolatedVendorReport = {
    ok: probe.probeStatus === "ok" || probe.probeStatus === "configured",
    vendorId: id,
    probeStatus: probe.probeStatus,
    catalog,
  };
  if (!report.ok) {
    report.error = probe.error || probe.probeStatus;
    return report;
  }

  if (invoke === "chat") {
    const url = chatCompletionsUrl(secret.modelsUrl);
    if (!url || catalog.invokeCandidates.text.length === 0) {
      report.ping = { kind: "chat", ok: false, status: 0, err: "no chat endpoint or candidates" };
      report.ok = false;
      return report;
    }
    report.ping = await pingChatUntilOk(url, secret.apiKey, catalog.invokeCandidates.text, chatHeaders(id));
    report.ok = report.ping.ok;
    return report;
  }

  if (invoke === "image") {
    const model = catalog.invokeCandidates.image[0] || catalog.match.image?.modelID;
    if (!model) {
      report.ping = { kind: "image", ok: false, status: 0, err: "no image candidate" };
      report.ok = false;
      return report;
    }
    if (id === "volcano") report.ping = await pingVolcanoImage(secret.apiKey, model);
    else if (id === "replicate") report.ping = await pingReplicateImage(secret.apiKey, model);
    else {
      report.ping = { kind: "image", ok: false, status: 0, model, err: "no image adapter for this vendor yet" };
    }
    report.ok = Boolean(report.ping?.ok);
    return report;
  }

  return report;
}

export async function runIsolatedVendors(
  vendorIds: readonly string[],
  options: { invoke?: IsolateInvokeMode } = {},
): Promise<IsolatedVendorReport[]> {
  const reports: IsolatedVendorReport[] = [];
  for (const vendorId of vendorIds) {
    reports.push(await runIsolatedVendor(vendorId, options));
  }
  return reports;
}
