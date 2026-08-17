/**
 * Generic OpenAI-compatible BYOK detection — map key / baseURL hints onto
 * known OpenCode provider ids. Not a per-vendor HTTP adapter.
 */

export type DetectedByokProvider = {
  providerId: string;
  /** high = strong fingerprint (key prefix / host); low = soft host hint */
  confidence: "high" | "low";
  reason: string;
};

const KNOWN_HOST_PROVIDERS: Array<{
  providerId: string;
  hosts: string[];
  confidence: "high" | "low";
}> = [
  { providerId: "openrouter", hosts: ["openrouter.ai"], confidence: "high" },
  { providerId: "openai", hosts: ["api.openai.com"], confidence: "high" },
  { providerId: "anthropic", hosts: ["api.anthropic.com"], confidence: "high" },
  { providerId: "deepseek", hosts: ["api.deepseek.com"], confidence: "high" },
  { providerId: "google", hosts: ["generativelanguage.googleapis.com", "ai.google.dev"], confidence: "low" },
  { providerId: "groq", hosts: ["api.groq.com"], confidence: "high" },
  { providerId: "xai", hosts: ["api.x.ai"], confidence: "high" },
  { providerId: "mistral", hosts: ["api.mistral.ai"], confidence: "high" },
];

const KEY_PREFIX_PROVIDERS: Array<{ providerId: string; prefixes: string[] }> = [
  { providerId: "openrouter", prefixes: ["sk-or-"] },
  { providerId: "anthropic", prefixes: ["sk-ant-"] },
];

function hostFromBaseUrl(baseURL: string | null | undefined): string | null {
  const raw = String(baseURL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Detect a known OpenAI-compatible provider from API key and/or base URL.
 * Returns null when nothing matches — caller should keep the user-selected id
 * or fall back to `~/.wodeapp/models.json` custom openai-compatible entries.
 */
export function detectOpenAiCompatibleProvider(input: {
  apiKey?: string | null;
  baseURL?: string | null;
}): DetectedByokProvider | null {
  const apiKey = String(input.apiKey ?? "").trim();
  const host = hostFromBaseUrl(input.baseURL);

  for (const entry of KEY_PREFIX_PROVIDERS) {
    if (entry.prefixes.some((prefix) => apiKey.startsWith(prefix))) {
      return {
        providerId: entry.providerId,
        confidence: "high",
        reason: `api_key_prefix:${entry.prefixes[0]}`,
      };
    }
  }

  if (host) {
    for (const entry of KNOWN_HOST_PROVIDERS) {
      if (entry.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
        return {
          providerId: entry.providerId,
          confidence: entry.confidence,
          reason: `base_url_host:${host}`,
        };
      }
    }
  }

  return null;
}

/**
 * Resolve which provider id to authorize. High-confidence fingerprints may
 * override a mismatched UI selection (e.g. OpenRouter key pasted under OpenAI).
 */
export function resolveByokProviderIdForAuth(
  selectedProviderId: string,
  input: { apiKey?: string | null; baseURL?: string | null },
): { providerId: string; detected: DetectedByokProvider | null; remapped: boolean } {
  const selected = String(selectedProviderId ?? "").trim();
  const detected = detectOpenAiCompatibleProvider(input);
  if (!detected) {
    return { providerId: selected, detected: null, remapped: false };
  }
  if (detected.confidence === "high" && detected.providerId !== selected) {
    return { providerId: detected.providerId, detected, remapped: true };
  }
  return { providerId: selected || detected.providerId, detected, remapped: false };
}
