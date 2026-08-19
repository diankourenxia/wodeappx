import en from "./locales/en";
import ja from "./locales/ja";
import zh from "./locales/zh";
import vi from "./locales/vi";
import ptBR from "./locales/pt-BR";
import th from "./locales/th";
import fr from "./locales/fr";
import ca from "./locales/ca";
import es from "./locales/es";
import ru from "./locales/ru";
export const LANGUAGE_PREF_KEY = "openwork.language";

/**
 * Supported languages
 */
export type Language = "en" | "ja" | "zh" | "vi" | "pt-BR" | "th" | "fr" | "ca" | "es" | "ru";
export type Locale = Language;

/**
 * All supported languages - single source of truth
 */
export const LANGUAGES: Language[] = ["en", "ja", "zh", "vi", "pt-BR", "th", "fr", "ca", "es", "ru"];

/**
 * Language options for UI - single source of truth
 */
export const LANGUAGE_OPTIONS = [
  { value: "en" as Language, label: "English", nativeName: "English" },
  { value: "ja" as Language, label: "Japanese", nativeName: "日本語" },
  { value: "zh" as Language, label: "Chinese (Simplified)", nativeName: "简体中文" },
  { value: "vi" as Language, label: "Vietnamese", nativeName: "Tiếng Việt" },
  { value: "pt-BR" as Language, label: "Portuguese (BR)", nativeName: "Português (BR)" },
  { value: "th" as Language, label: "Thai", nativeName: "ไทย" },
  { value: "fr" as Language, label: "French", nativeName: "Français" },
  { value: "ca" as Language, label: "Catalan", nativeName: "Català" },
  { value: "es" as Language, label: "Spanish", nativeName: "Español" },
  { value: "ru" as Language, label: "Russian", nativeName: "Русский" },
] as const;

const PLURAL_SUFFIX_EMPTY_LANGUAGES = new Set<Language>(["ja", "zh", "th"]);

/**
 * Current translation strings use an English-style plural suffix placeholder.
 * Some locales render the noun without a visible plural marker, so we keep
 * that suffix empty for them.
 */
export const pluralSuffix = (locale: Language, count: number): string => {
  if (PLURAL_SUFFIX_EMPTY_LANGUAGES.has(locale)) {
    return "";
  }

  return count === 1 ? "" : "s";
};

/**
 * Translation maps
 */
const TRANSLATIONS: Record<Language, Record<string, string>> = {
  en,
  ja,
  zh,
  vi,
  "pt-BR": ptBR,
  th,
  fr,
  ca,
  es,
  ru,
};

/**
 * Type guard to validate if a value is a Language
 * Replaces long chains like: value === "en" || value === "zh"
 */
export const isLanguage = (value: unknown): value is Language => {
  return typeof value === "string" && LANGUAGES.includes(value as Language);
};

const OFFICIAL_SETTINGS_KEY = "app-settings";

function officialLangTag(lang: Language): "zh-CN" | "en-US" | null {
  if (lang === "zh") return "zh-CN";
  if (lang === "en") return "en-US";
  return null;
}

function syncOfficialSiteLanguage(lang: Language): void {
  if (typeof window === "undefined") return;
  const official = officialLangTag(lang);
  if (!official) return;
  try {
    window.localStorage.setItem("i18nextLng", official);
  } catch {
    /* ignore */
  }
  try {
    const raw = window.localStorage.getItem(OFFICIAL_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as { state?: Record<string, unknown> } : { state: {} };
    parsed.state = { ...(parsed.state || {}), language: official };
    window.localStorage.setItem(OFFICIAL_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

function resolveWebHostLanguage(): Language | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OFFICIAL_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { language?: string } };
      if (parsed?.state?.language) return resolveNavigatorLanguage(parsed.state.language);
    }
  } catch {
    /* ignore */
  }
  const host = window.location.hostname.toLowerCase();
  if (host === "wodeapp.cn" || host.endsWith(".wodeapp.cn")) return "zh";
  if (host === "wodeapp.ai" || host.endsWith(".wodeapp.ai")) return "en";
  try {
    const parentLng = window.localStorage.getItem("i18nextLng");
    if (parentLng) return resolveNavigatorLanguage(parentLng);
  } catch {
    /* ignore */
  }
  return null;
}

function isWebDeploymentEnv(): boolean {
  const env = (typeof import.meta !== "undefined"
    && (import.meta as { env?: { VITE_OPENWORK_DEPLOYMENT?: string } }).env?.VITE_OPENWORK_DEPLOYMENT)
    || "";
  return env.trim().toLowerCase() === "web";
}

/** Module default stays English for SSR/tests; `initLocale()` follows user choice, then host/OS, then English. */
let localeValue: Language = "en";

/**
 * Get current locale
 */
export const currentLocale = (): Language => locale();
function locale(): Language {
  return localeValue;
}

/**
 * Set locale and persist to localStorage
 */
export const setLocale = (newLocale: Language) => {
  if (!isLanguage(newLocale)) {
    console.warn(`Invalid locale: ${newLocale}, falling back to "en"`);
    newLocale = "en";
  }

  localeValue = newLocale;

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", newLocale);
  }

  // Persist to localStorage
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANGUAGE_PREF_KEY, newLocale);
      syncOfficialSiteLanguage(newLocale);
    } catch (e) {
      console.warn("Failed to persist language preference:", e);
    }
  }
};

/**
 * Resolve a translation entry with the locale → English → null fallback chain.
 */
const lookupEntry = (loc: Language, candidateKey: string): string | null => {
  if (TRANSLATIONS[loc]?.[candidateKey]) return TRANSLATIONS[loc][candidateKey];
  if (loc !== "en" && TRANSLATIONS.en?.[candidateKey]) return TRANSLATIONS.en[candidateKey];
  return null;
};

const pluralRulesByLanguage: Record<Language, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  ja: new Intl.PluralRules("ja"),
  zh: new Intl.PluralRules("zh"),
  vi: new Intl.PluralRules("vi"),
  "pt-BR": new Intl.PluralRules("pt-BR"),
  th: new Intl.PluralRules("th"),
  fr: new Intl.PluralRules("fr"),
  ca: new Intl.PluralRules("ca"),
  es: new Intl.PluralRules("es"),
  ru: new Intl.PluralRules("ru"),
};
const pluralRule = (loc: Language, count: number): Intl.LDMLPluralRule => {
  return pluralRulesByLanguage[loc].select(count);
};

/**
 * Pick the right key variant for a count. Tries `${key}_zero` (only when count === 0),
 * then `${key}_${rule}` (e.g. `_one` / `_other`), then `${key}_other`, then the bare
 * key. Asian locales (no grammatical plural) define only the bare key and hit the
 * final step. Each candidate runs through the locale → English fallback so an
 * untranslated key still resolves to the English `_one` / `_other` variant.
 */
const resolvePluralKey = (loc: Language, key: string, count: number): string => {
  const candidates: string[] = [];
  if (count === 0) candidates.push(`${key}_zero`);
  candidates.push(`${key}_${pluralRule(loc, count)}`, `${key}_other`, key);

  for (const candidate of candidates) {
    if (lookupEntry(loc, candidate) !== null) return candidate;
  }
  return key;
};

/**
 * Translation function with fallback behavior.
 * - Locale fallback: target language → English → key itself.
 * - Plural fallback: when params include a numeric `count`, the lookup picks
 *   `${key}_one` / `${key}_other` (or `${key}_zero` when count === 0) per
 *   `Intl.PluralRules`, and falls back to the bare key when no variants exist.
 */
type TranslationParams = Record<string, string | number> & { lng?: Language };

export const t = (
  key: string,
  paramsOrLocale?: TranslationParams | Language,
  legacyParams?: Record<string, string | number>,
): string => {
  const params = legacyParams ?? (typeof paramsOrLocale === "string" ? undefined : paramsOrLocale);
  const loc: Language = typeof paramsOrLocale === "string"
    ? paramsOrLocale
    : isLanguage(params?.lng)
      ? params.lng
      : locale();

  const lookupKey =
    typeof params?.count === "number" ? resolvePluralKey(loc, key, params.count) : key;

  const result = lookupEntry(loc, lookupKey);
  if (result === null) return hideEngineBrand(key, loc);

  if (!params) return hideEngineBrand(result, loc);

  let out = result;
  for (const [k, v] of Object.entries(params)) {
    if (k === "lng") continue;
    out = out.replace(`{${k}}`, String(v));
  }
  return hideEngineBrand(out, loc);
};

/** User-visible copy must not mention the engine brands. */
export function hideEngineBrand(text: string, loc: Language = locale()): string {
  if (!text) return text;
  const engine = loc === "zh" ? "工作台" : "WodeAppX";
  return text
    .replace(/OpenWork Cloud/gi, "WodeAppX")
    .replace(/OpenWork/gi, "WodeAppX")
    .replace(/OpenCode/gi, engine);
}

/**
 * Map a navigator.language / Accept-Language tag onto a supported Language.
 * Unknown tags fall back to English.
 */
export const resolveNavigatorLanguage = (input?: string | null): Language => {
  const raw = String(input ?? "").trim().toLowerCase().replaceAll("_", "-");
  if (!raw) return "en";
  if (isLanguage(raw)) return raw;
  if (raw === "zh-cn" || raw === "zh-hans" || raw.startsWith("zh")) return "zh";
  if (raw === "pt-br" || raw.startsWith("pt")) return "pt-BR";
  const short = raw.split("-")[0] ?? "";
  if (isLanguage(short)) return short;
  return "en";
};

/**
 * Initialize locale.
 * Desktop: user choice → OS locale → English.
 * Web: official-site language / host (.cn=zh, .ai=en) wins over a stale workbench pref.
 */
export const initLocale = (): Language => {
  const apply = (next: Language, persist = false): Language => {
    localeValue = next;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", next);
    }
    if (persist && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LANGUAGE_PREF_KEY, next);
        syncOfficialSiteLanguage(next);
      } catch {
        /* ignore */
      }
    }
    return next;
  };

  if (typeof window === "undefined") {
    return apply("en");
  }

  if (isWebDeploymentEnv()) {
    const hostLang = resolveWebHostLanguage();
    if (hostLang) return apply(hostLang);
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_PREF_KEY);
    if (isLanguage(stored)) {
      return apply(stored);
    }
  } catch (e) {
    console.warn("Failed to read language preference:", e);
  }

  const nav =
    window.navigator?.language ||
    (Array.isArray(window.navigator?.languages) ? window.navigator.languages[0] : "") ||
    "";
  return apply(resolveNavigatorLanguage(nav));
};
