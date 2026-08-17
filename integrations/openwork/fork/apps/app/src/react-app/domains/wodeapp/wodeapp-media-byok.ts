/**
 * Desktop media BYOK — user-supplied vendor credentials for image/video.
 * Adapters/URLs stay on the platform; this only stores and validates keys.
 * Prefer local file ~/.wodeapp/media-byok.json when resolving (runtime).
 */

export type MediaByokProviderId =
  | "kling"
  | "seedance"
  | "replicate"
  | "runway"
  | "openai-image";

export type MediaByokFieldDef = {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
};

export type MediaByokProviderSchema = {
  id: MediaByokProviderId;
  label: string;
  kind: "video" | "image" | "both";
  fields: MediaByokFieldDef[];
  docsUrl?: string;
  hint: string;
};

export type MediaByokProviderValues = Record<string, string>;

export type MediaByokFile = {
  version: 1;
  /** When true, local runtime prefers these keys over platform DB/env. */
  preferLocal: boolean;
  providers: Partial<Record<MediaByokProviderId, MediaByokProviderValues>>;
};

export const MEDIA_BYOK_STORAGE_KEY = "wodeappx.media-byok";
export const MEDIA_BYOK_FILE_NAME = "media-byok.json";

export const MEDIA_BYOK_PROVIDERS: readonly MediaByokProviderSchema[] = [
  {
    id: "kling",
    label: "可灵 Kling",
    kind: "video",
    hint: "可灵需要 Access Key 与 Secret Key 一对，缺一不可。",
    docsUrl: "https://app.klingai.com/global/dev/document-api",
    fields: [
      {
        key: "accessKey",
        label: "Access Key (AK)",
        required: true,
        placeholder: "可灵控制台的 Access Key",
        help: "对应环境变量 KLING_ACCESS_KEY",
      },
      {
        key: "secretKey",
        label: "Secret Key (SK)",
        required: true,
        secret: true,
        placeholder: "可灵控制台的 Secret Key",
        help: "对应环境变量 KLING_SECRET_KEY",
      },
    ],
  },
  {
    id: "seedance",
    label: "火山方舟 ARK（图+视频）",
    kind: "both",
    hint: "同一 ARK Key 可用于 Seedance 视频与 Seedream 生图；本机优先、跳过平台积分。",
    docsUrl: "https://console.volcengine.com/ark",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        required: true,
        secret: true,
        placeholder: "ARK API Key",
        help: "对应环境变量 ARK_API_KEY；视频 provider=seedance，生图 provider=volcano",
      },
    ],
  },
  {
    id: "runway",
    label: "Runway",
    kind: "video",
    hint: "填入 Runway API Key 后，本地优先用你的额度生成。",
    docsUrl: "https://docs.dev.runwayml.com/",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        required: true,
        secret: true,
        placeholder: "Runway API Key",
        help: "对应环境变量 RUNWAY_API_KEY",
      },
    ],
  },
  {
    id: "replicate",
    label: "Replicate",
    kind: "image",
    hint: "生图走 Replicate 时优先用你的 Token（平台已接好模型路径）。",
    docsUrl: "https://replicate.com/account/api-tokens",
    fields: [
      {
        key: "apiToken",
        label: "API Token",
        required: true,
        secret: true,
        placeholder: "r8_…",
        help: "对应环境变量 REPLICATE_API_TOKEN",
      },
    ],
  },
  {
    id: "openai-image",
    label: "OpenAI 图片",
    kind: "image",
    hint: "用于 OpenAI 兼容图片接口（DALL·E / gpt-image 等）。",
    docsUrl: "https://platform.openai.com/api-keys",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        required: true,
        secret: true,
        placeholder: "sk-…",
        help: "对应环境变量 OPENAI_API_KEY",
      },
    ],
  },
] as const;

export function emptyMediaByokFile(): MediaByokFile {
  return { version: 1, preferLocal: true, providers: {} };
}

export function normalizeMediaByokFile(input: unknown): MediaByokFile {
  const base = emptyMediaByokFile();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  const preferLocal = raw.preferLocal !== false;
  const providersIn = raw.providers && typeof raw.providers === "object"
    ? (raw.providers as Record<string, unknown>)
    : {};
  const providers: MediaByokFile["providers"] = {};
  for (const schema of MEDIA_BYOK_PROVIDERS) {
    const entry = providersIn[schema.id];
    if (!entry || typeof entry !== "object") continue;
    const values: MediaByokProviderValues = {};
    for (const field of schema.fields) {
      const value = (entry as Record<string, unknown>)[field.key];
      if (typeof value === "string" && value.trim()) {
        values[field.key] = value.trim();
      }
    }
    if (Object.keys(values).length > 0) providers[schema.id] = values;
  }
  return { version: 1, preferLocal, providers };
}

export type MediaByokValidation =
  | { ok: true; values: MediaByokProviderValues }
  | { ok: false; missing: string[]; message: string };

export function validateMediaByokProvider(
  providerId: MediaByokProviderId,
  values: MediaByokProviderValues | null | undefined,
): MediaByokValidation {
  const schema = MEDIA_BYOK_PROVIDERS.find((item) => item.id === providerId);
  if (!schema) {
    return { ok: false, missing: [], message: `未知媒体服务商：${providerId}` };
  }
  const next: MediaByokProviderValues = {};
  const missing: string[] = [];
  for (const field of schema.fields) {
    const value = String(values?.[field.key] ?? "").trim();
    if (field.required && !value) missing.push(field.label);
    else if (value) next[field.key] = value;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `${schema.label}还需填写：${missing.join("、")}。${schema.hint}`,
    };
  }
  return { ok: true, values: next };
}

export function mediaByokProviderStatus(
  file: MediaByokFile,
  providerId: MediaByokProviderId,
): "ready" | "incomplete" | "empty" {
  const values = file.providers[providerId];
  if (!values || Object.keys(values).length === 0) return "empty";
  const validation = validateMediaByokProvider(providerId, values);
  return validation.ok ? "ready" : "incomplete";
}

/** Map stored values → video resolve override (apiKey + optional secret). */
export function mediaByokToVideoOverride(
  providerId: string,
  values: MediaByokProviderValues | null | undefined,
): { apiKey: string; secretValue?: string } | null {
  if (!values) return null;
  if (providerId === "kling") {
    const accessKey = values.accessKey?.trim();
    const secretKey = values.secretKey?.trim();
    if (!accessKey || !secretKey) return null;
    return { apiKey: accessKey, secretValue: secretKey };
  }
  if (providerId === "seedance" || providerId === "runway") {
    const apiKey = values.apiKey?.trim();
    if (!apiKey) return null;
    return { apiKey };
  }
  return null;
}

/** Map stored values → image env-style token for known providers. */
export function mediaByokToImageToken(
  providerId: string,
  values: MediaByokProviderValues | null | undefined,
): string | null {
  if (!values) return null;
  if (providerId === "replicate") return values.apiToken?.trim() || null;
  if (providerId === "openai-image" || providerId === "seedance" || providerId === "volcano") {
    return values.apiKey?.trim() || null;
  }
  return null;
}

export function readCachedMediaByokFile(): MediaByokFile {
  if (typeof window === "undefined") return emptyMediaByokFile();
  try {
    const raw = window.localStorage.getItem(MEDIA_BYOK_STORAGE_KEY);
    if (!raw) return emptyMediaByokFile();
    return normalizeMediaByokFile(JSON.parse(raw));
  } catch {
    return emptyMediaByokFile();
  }
}

export function writeCachedMediaByokFile(file: MediaByokFile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEDIA_BYOK_STORAGE_KEY, JSON.stringify(normalizeMediaByokFile(file)));
  } catch {
    // ignore quota
  }
}

const MEDIA_BYOK_SOURCE_ALIASES: Record<string, MediaByokProviderId> = {
  kling: "kling",
  runway: "runway",
  replicate: "replicate",
  "openai-image": "openai-image",
  seedance: "seedance",
};

/** Map a capability-table source / fill-hint id onto a media BYOK provider. */
export function mediaByokProviderFromCapabilitySource(
  sourceId: string | null | undefined,
  keyOrigin?: string | null,
): MediaByokProviderId | null {
  const id = String(sourceId ?? "").trim().toLowerCase();
  if (!id) return null;
  const mapped = MEDIA_BYOK_SOURCE_ALIASES[id];
  if (mapped) return mapped;
  if (id === "volcano" || id === "doubao" || id === "ark") {
    return keyOrigin === "media-byok" ? "seedance" : null;
  }
  if (keyOrigin === "media-byok") {
    return MEDIA_BYOK_PROVIDERS.find((item) => item.id === id)?.id ?? null;
  }
  return null;
}

export const WODEAPP_OPEN_MEDIA_BYOK_EVENT = "wodeapp:open-media-byok";

export type WodeAppOpenMediaByokDetail = {
  providerId?: MediaByokProviderId;
  docked?: boolean;
};

export function openMediaByokSettings(
  providerId?: MediaByokProviderId,
  docked = false,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WODEAPP_OPEN_MEDIA_BYOK_EVENT, {
    detail: { providerId, docked } satisfies WodeAppOpenMediaByokDetail,
  }));
}
