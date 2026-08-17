import type { SlashCommandOption } from "@/app/types";
import { LANGUAGE_PREF_KEY, currentLocale, t, type Language } from "@/i18n";

export const SELF_EVOLVE_COMMAND_ZH = "自进化";
export const SELF_EVOLVE_COMMAND_EN = "evolve";

const SELF_EVOLVE_NAMES = new Set([SELF_EVOLVE_COMMAND_ZH, SELF_EVOLVE_COMMAND_EN]);

function resolveSlashLocale(locale: Language = currentLocale()): Language {
  if (locale === "zh") return "zh";
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(LANGUAGE_PREF_KEY) === "zh") {
      return "zh";
    }
    if (typeof document !== "undefined" && document.documentElement.getAttribute("lang") === "zh") {
      return "zh";
    }
  } catch {
    /* ignore */
  }
  return locale;
}

export function preferredSelfEvolveCommandName(locale: Language = currentLocale()): string {
  return resolveSlashLocale(locale) === "zh" ? SELF_EVOLVE_COMMAND_ZH : SELF_EVOLVE_COMMAND_EN;
}

export function isSelfEvolveCommandName(name: string | null | undefined): boolean {
  return Boolean(name && SELF_EVOLVE_NAMES.has(name));
}

/**
 * Collapse `/自进化` + `/evolve` into one locale-appropriate entry and pin it first.
 * zh → 自进化 + Chinese description; other locales → evolve + English description.
 * Always injects the preferred entry even when the engine has not listed it yet
 * (seed/hot-reload lag), so the slash picker stays usable.
 */
export function preferLocalizedSlashCommands(
  commands: SlashCommandOption[],
  locale: Language = currentLocale(),
): SlashCommandOption[] {
  const effectiveLocale = resolveSlashLocale(locale);
  const preferredName = preferredSelfEvolveCommandName(effectiveLocale);
  const rest = commands.filter((command) => !isSelfEvolveCommandName(command.name));
  const source = commands.find((command) => command.name === preferredName)
    ?? commands.find((command) => isSelfEvolveCommandName(command.name));

  const localized: SlashCommandOption = {
    id: `cmd:${preferredName}`,
    name: preferredName,
    description: t("wodeapp.slash.self_evolve_desc"),
    source: source?.source ?? "command",
  };

  return [localized, ...rest];
}
