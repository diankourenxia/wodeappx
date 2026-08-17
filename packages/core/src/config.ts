export type WodeAppProfile = 'cloud' | 'selfhost' | 'local-only';

export interface WodeAppConfig {
  profile: WodeAppProfile;
  origin: string;
  apiKey?: string;
  /** From self-context after onboard */
  issuedOrigin?: string;
  /**
   * WodeApp 子域租户后缀，如 `.wodeapp.ai` / `.wodeapp.cn`。
   * 仅当平台使用 `{slug}{suffix}` 托管已发布站点时有值；自建/path 路由可能为 null。
   */
  projectSubdomainSuffix?: string | null;
}

export const CONFIG_DIR_NAME = '.wodeapp';
export const CONFIG_FILE_NAME = 'config.json';
export const WODEAPP_CLOUD_ORIGIN_AI = 'https://wodeapp.ai';
export const WODEAPP_CLOUD_ORIGIN_CN = 'https://wodeapp.cn';
/** OSS / unsigned fallback. Login still lets the user pick .cn. */
export const WODEAPP_CLOUD_ORIGIN = WODEAPP_CLOUD_ORIGIN_AI;

export interface ProjectSiteInput {
  slug?: string | null;
  subdomain?: string | null;
  customDomain?: string | null;
}

export function normalizeWodeAppCloudOrigin(origin?: string | null): string {
  const cleaned = (origin || WODEAPP_CLOUD_ORIGIN).replace(/\/$/, '');
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'wodeapp.ai') return WODEAPP_CLOUD_ORIGIN_AI;
    if (host === 'wodeapp.cn') return WODEAPP_CLOUD_ORIGIN_CN;
    return parsed.origin;
  } catch {
    return cleaned || WODEAPP_CLOUD_ORIGIN;
  }
}

export function normalizeWodeAppCloudUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'wodeapp.ai' || host === 'wodeapp.cn') {
      parsed.protocol = 'https:';
      parsed.hostname = host;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function normalizeWodeAppCloudProjectSuffix(
  suffix?: string | null,
): string | null | undefined {
  if (suffix === 'wodeapp.ai') return '.wodeapp.ai';
  if (suffix === 'wodeapp.cn') return '.wodeapp.cn';
  return suffix;
}

export function normalizeWodeAppCloudConfig(config: WodeAppConfig): WodeAppConfig {
  return {
    ...config,
    origin: normalizeWodeAppCloudOrigin(config.origin),
    issuedOrigin: config.issuedOrigin
      ? normalizeWodeAppCloudOrigin(config.issuedOrigin)
      : config.issuedOrigin,
    projectSubdomainSuffix: normalizeWodeAppCloudProjectSuffix(config.projectSubdomainSuffix),
  };
}

function protocolForOrigin(origin: string): 'http' | 'https' {
  return origin.startsWith('http://') ? 'http' : 'https';
}

/** Infer tenant suffix from platform origin hostname (WodeApp cloud / selfhost with subdomain routing). */
export function inferProjectSubdomainSuffix(origin: string): string | null {
  try {
    const host = new URL(origin.replace(/\/$/, '')).hostname.replace(/^www\./, '');
    if (host === 'localhost' || host === '127.0.0.1') {
      return '.wodeapp.local';
    }
    // WodeApp 常见：主站 host 即 base domain，租户站为 slug.base
    return `.${host}`;
  } catch {
    return null;
  }
}

/**
 * 已发布站点 URL（仅 WodeApp 项目 + 子域/custom domain 模型）。
 * Draft 预览应优先用 preview-token 返回的 `previewUrl`，不要假设域名格式。
 */
export function resolvePublishedSiteUrl(
  origin: string,
  project: ProjectSiteInput,
  tenant?: { projectSubdomainSuffix?: string | null },
): string | null {
  if (project.customDomain?.trim()) {
    const domain = project.customDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${protocolForOrigin(origin)}://${domain}`;
  }

  const slug = (project.subdomain || project.slug)?.trim();
  if (!slug) return null;

  const suffix = tenant?.projectSubdomainSuffix ?? inferProjectSubdomainSuffix(origin);
  if (!suffix) return null;

  const proto = protocolForOrigin(origin);
  if (suffix.startsWith('.')) {
    return `${proto}://${slug}${suffix}`;
  }
  return `${proto}://${slug}.${suffix}`;
}

/** @deprecated Use resolvePublishedSiteUrl — kept for callers passing bare slug */
export function getProjectSiteUrl(origin: string, slug: string): string | null {
  return resolvePublishedSiteUrl(origin, { slug }, {
    projectSubdomainSuffix: inferProjectSubdomainSuffix(origin),
  });
}

export function getWebAgentUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/agent`;
}

/** Desktop shell embed: chat only, no AgentShell sidebar. Never pass API keys in query. */
export function getWebAgentEmbedUrl(origin: string, projectId?: string | null): string {
  const base = origin.replace(/\/$/, '');
  const path = projectId ? `/agent/p/${encodeURIComponent(projectId)}` : '/agent';
  return `${base}${path}?embed=desktop`;
}

export function usesSubdomainTenancy(config: Pick<WodeAppConfig, 'projectSubdomainSuffix' | 'issuedOrigin' | 'origin'>): boolean {
  if (normalizeWodeAppCloudProjectSuffix(config.projectSubdomainSuffix)) return true;
  const o = normalizeWodeAppCloudOrigin(config.issuedOrigin || config.origin);
  const suffix = inferProjectSubdomainSuffix(o);
  return Boolean(suffix && suffix !== '.localhost' && !suffix.includes('127.0.0.1'));
}
