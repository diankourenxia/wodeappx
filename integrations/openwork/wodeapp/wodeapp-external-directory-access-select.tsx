/** @jsxImportSource react */
import * as React from "react";
import { Check, ChevronDown, Hand, ShieldAlert } from "lucide-react";

import { t } from "@/i18n";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  DEFAULT_EXTERNAL_DIRECTORY_ACCESS,
  normalizeExternalDirectoryAccessMode,
  type ExternalDirectoryAccessMode,
} from "./wodeapp-external-directory-access";

const MODE_OPTIONS: Array<{
  id: ExternalDirectoryAccessMode;
  icon: typeof Hand;
  titleKey: string;
  descriptionKey: string;
  tone: "default" | "full";
}> = [
  {
    id: "ask",
    icon: Hand,
    titleKey: "settings.external_directory_access_ask_title",
    descriptionKey: "settings.external_directory_access_ask_desc",
    tone: "default",
  },
  {
    id: "full",
    icon: ShieldAlert,
    titleKey: "settings.external_directory_access_full_title",
    descriptionKey: "settings.external_directory_access_full_desc",
    tone: "full",
  },
];

/** Compact Codex-style control for the composer toolbar under the chat input. */
export function WodeAppExternalDirectoryAccessSelect() {
  const local = useLocal();
  const mode = normalizeExternalDirectoryAccessMode(
    local.prefs.externalDirectoryAccess ?? DEFAULT_EXTERNAL_DIRECTORY_ACCESS,
  );
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const selected = MODE_OPTIONS.find((option) => option.id === mode) ?? MODE_OPTIONS[0];
  const SelectedIcon = selected.icon;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={[
          "flex h-9 max-h-9 max-w-[11rem] items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-colors hover:bg-gray-3",
          selected.tone === "full" ? "text-amber-11 hover:text-amber-11" : "text-gray-10 hover:text-gray-12",
        ].join(" ")}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("settings.external_directory_access_title")}
      >
        <SelectedIcon size={13} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t(selected.titleKey)}</span>
        <ChevronDown size={13} className="shrink-0" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("settings.external_directory_access_title")}
          className="absolute bottom-full left-0 z-40 mb-2 w-[min(calc(100vw-2.5rem),20rem)] overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]"
        >
          <div className="border-b border-dls-border px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-10">
            {t("settings.external_directory_access_title")}
          </div>
          <div className="space-y-1 p-2">
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={[
                    "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                    active
                      ? option.tone === "full"
                        ? "bg-amber-3/25 text-amber-11"
                        : "bg-gray-2 text-gray-12"
                      : "text-gray-11 hover:bg-gray-2/70",
                  ].join(" ")}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    local.setPrefs((previous) => ({
                      ...previous,
                      externalDirectoryAccess: option.id,
                    }));
                    setOpen(false);
                  }}
                >
                  <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold leading-4">
                      {t(option.titleKey)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-gray-10">
                      {t(option.descriptionKey)}
                    </span>
                  </span>
                  {active ? <Check size={14} className="mt-0.5 shrink-0" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
