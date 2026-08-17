import type { WodeAppConfig } from './config.js';
import {
  normalizeWodeAppCloudConfig,
  normalizeWodeAppCloudOrigin,
  normalizeWodeAppCloudProjectSuffix,
  normalizeWodeAppCloudUrl,
} from './config.js';

export interface AgentIndex {
  lastUpdated?: string;
  basePaths?: { mainserver?: string; runtimeServer?: string };
  mcp?: {
    platform?: { sseUrl?: string; toolsDiscovery?: string };
  };
}

export interface SelfContext {
  issuedOrigin?: string;
  origin?: string;
  mainserverApiBase?: string | null;
  runtimeApiBase?: string | null;
  mcpSseUrl?: string | null;
  /** WodeApp 子域托管后缀；非子域部署时为 null */
  projectSubdomainSuffix?: string | null;
}

export interface HubProject {
  id: string;
  name: string;
  slug?: string;
  subdomain?: string | null;
  customDomain?: string | null;
  status?: string;
  publishedVersion?: number;
  updatedAt?: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  tier?: string;
  provider?: string;
  upstreamId?: string;
  wode?: boolean;
}

export interface PreviewTokenData {
  token: string;
  expiresAt: string;
  previewUrl: string;
  configUrl: string;
  projectId: string;
  projectSlug: string;
}

export type PreviewMode = 'published' | 'draft';

function apiKeyHeaders(apiKey: string, projectSlug?: string): HeadersInit {
  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
    Accept: 'application/json',
  };
  if (projectSlug) {
    headers['x-subdomain-project'] = projectSlug;
  }
  return headers;
}

function runtimeBase(origin: string): string {
  return `${normalizeWodeAppCloudOrigin(origin)}/runtime-server/api/runtime`;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchAgentIndex(origin: string): Promise<AgentIndex> {
  const url = `${normalizeWodeAppCloudOrigin(origin)}/mainserver/api/docs/agent-index`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`agent-index HTTP ${res.status}`);
  }
  return res.json() as Promise<AgentIndex>;
}

export async function fetchSelfContext(origin: string, apiKey: string): Promise<SelfContext> {
  const url = `${normalizeWodeAppCloudOrigin(origin)}/mainserver/api/api-keys/self-context`;
  const res = await fetch(url, { headers: apiKeyHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`self-context HTTP ${res.status}`);
  }
  const json = await readJson<SelfContext & { success?: boolean; data?: SelfContext }>(res);
  if (json?.success && json.data) {
    return json.data;
  }
  if (json && (json.issuedOrigin || json.origin || json.projectSubdomainSuffix !== undefined)) {
    return json;
  }
  throw new Error('self-context response invalid');
}

export async function fetchProjects(origin: string, apiKey: string): Promise<HubProject[]> {
  const url = `${normalizeWodeAppCloudOrigin(origin)}/mainserver/api/json-schema/projects`;
  const res = await fetch(url, { headers: apiKeyHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`projects HTTP ${res.status}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: HubProject[] };
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('projects response invalid');
  }
  return json.data;
}

export async function fetchCredits(origin: string, apiKey: string): Promise<number | null> {
  const url = `${normalizeWodeAppCloudOrigin(origin)}/mainserver/api/credits`;
  const res = await fetch(url, { headers: apiKeyHeaders(apiKey) });
  if (!res.ok) return null;
  const json = (await res.json()) as { success?: boolean; data?: { credits?: number } };
  if (json.success && typeof json.data?.credits === 'number') {
    return json.data.credits;
  }
  return null;
}

export async function fetchAgentModels(origin: string, apiKey: string): Promise<AgentModelOption[]> {
  const url = `${normalizeWodeAppCloudOrigin(origin)}/runtime-server/api/agent/models`;
  const res = await fetch(url, { headers: apiKeyHeaders(apiKey), cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`agent/models HTTP ${res.status}`);
  }
  const json = await readJson<{
    success?: boolean;
    data?: AgentModelOption[];
  }>(res);
  if (!json?.success || !Array.isArray(json.data)) {
    throw new Error('agent/models response invalid');
  }
  return json.data;
}

/**
 * Owner-only: POST /runtime-server/api/runtime/preview-token
 * Token is consumed via runtime-app `#preview=` hash → sessionStorage → X-Preview-Token header.
 */
export async function fetchPreviewToken(
  origin: string,
  apiKey: string,
  project: Pick<HubProject, 'id' | 'slug' | 'name'>,
): Promise<PreviewTokenData> {
  const slug = project.slug || project.name;
  if (!slug) {
    throw new Error('项目缺少 slug，无法签发 preview token');
  }

  const url = `${runtimeBase(origin)}/preview-token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...apiKeyHeaders(apiKey, slug),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId: project.id }),
    cache: 'no-store',
  });

  const json = await readJson<{
    success?: boolean;
    error?: string;
    code?: string;
    data?: PreviewTokenData;
  }>(res);

  if (res.status === 503 && json?.code === 'PREVIEW_NOT_ENABLED') {
    throw new Error('Preview token 未启用（服务端需 DRAFT_OWNER_ONLY=true）');
  }
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || `preview-token HTTP ${res.status}`);
  }

  return {
    ...json.data,
    previewUrl: normalizeWodeAppCloudUrl(json.data.previewUrl) || json.data.previewUrl,
    configUrl: normalizeWodeAppCloudUrl(json.data.configUrl) || json.data.configUrl,
  };
}

export function isPreviewTokenExpired(expiresAt: string): boolean {
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return true;
  return ms <= Date.now() + 5000;
}

/** Onboard: validate key + resolve issuedOrigin. */
export async function verifyConfig(config: WodeAppConfig): Promise<WodeAppConfig> {
  const normalized = normalizeWodeAppCloudConfig(config);
  await fetchAgentIndex(normalized.origin);
  if (!normalized.apiKey) {
    throw new Error('API Key required');
  }
  const ctx = await fetchSelfContext(normalized.origin, normalized.apiKey);
  const issuedOrigin = ctx.issuedOrigin || ctx.origin;
  return normalizeWodeAppCloudConfig({
    ...normalized,
    issuedOrigin: issuedOrigin || normalized.origin,
    projectSubdomainSuffix: normalizeWodeAppCloudProjectSuffix(ctx.projectSubdomainSuffix ?? null),
  });
}
