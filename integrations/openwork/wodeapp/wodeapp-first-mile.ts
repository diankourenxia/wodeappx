/**
 * First Mile checklist — model Key → Chrome (optional).
 * Ability projects are created after cloud login; they are not a wizard step.
 * Workspace is NOT a First Mile step: default is the built-in wodeapp（自进化）workspace.
 * Core complete = usable model. Chrome never blocks chat.
 */

import {
  BYOK_GUIDE_DISMISS_KEY,
  readByokGuideDismissed,
  writeByokGuideDismissed,
} from "./wodeapp-byok-guide";

export const WODEAPP_OPEN_FIRST_MILE_EVENT = "wodeapp:open-first-mile";
/** Session-route / workbench push live checklist inputs. */
export const WODEAPP_FIRST_MILE_STATUS_EVENT = "wodeapp:first-mile-status";
/** Cue listeners (account badge / empty-chat chip) refresh after dismiss. */
export const WODEAPP_FIRST_MILE_CUE_EVENT = "wodeapp:first-mile-cue";

export const FIRST_MILE_DISMISS_KEY = "wodeappx.first-mile.dismissed";
export const FIRST_MILE_LOCAL_LABEL = "本地";
export const FIRST_MILE_CLOUD_LOGIN_LABEL = "云端";

export type FirstMilePhase = "model" | "chrome" | "projects";

export type FirstMileItemStatus = "done" | "todo" | "optional" | "unavailable" | "hidden";

export type FirstMileStatusSnapshot = {
  hasUsableModel: boolean;
  /** Platform signed-in / embedded identity that can own ability projects. */
  hasPlatformIdentity: boolean;
  abilityProjectCount: number;
};

export type FirstMileChromeState =
  | { kind: "unknown" }
  | { kind: "unavailable" }
  | { kind: "ready"; connected: boolean; setupUrl: string };

export type FirstMileChecklist = {
  model: FirstMileItemStatus;
  chrome: FirstMileItemStatus;
  projects: FirstMileItemStatus;
};

export type FirstMileAutoOpenInput = {
  ready: boolean;
  dismissed: boolean;
  hasUsableModel: boolean;
};

export const FIRST_MILE_PHASES: readonly FirstMilePhase[] = [
  "model",
  "chrome",
  "projects",
] as const;

export const FIRST_MILE_PHASE_LABELS: Record<FirstMilePhase, string> = {
  model: "本机 Key",
  chrome: "Chrome",
  projects: "能力项目",
};

export function isFirstMileCoreComplete(input: { hasUsableModel: boolean }): boolean {
  return Boolean(input.hasUsableModel);
}

/**
 * First Mile "has a model" must follow connected-provider truth, not the workbench
 * hide-detection overlay. A leftover `wodeapp/wode/*` default is not usable without login.
 */
export function resolveFirstMileHasUsableModel(input: {
  hasSelectedModel: boolean;
  selectedModelUnavailable: boolean;
}): boolean {
  return Boolean(input.hasSelectedModel && !input.selectedModelUnavailable);
}

function isWebFirstMileRuntime(): boolean {
  try {
    const deployment = String((import.meta as { env?: { VITE_OPENWORK_DEPLOYMENT?: string } }).env?.VITE_OPENWORK_DEPLOYMENT || "");
    return deployment.trim().toLowerCase() === "web";
  } catch {
    return false;
  }
}

export function shouldAutoOpenFirstMile(input: FirstMileAutoOpenInput): boolean {
  if (isWebFirstMileRuntime()) return false;
  return Boolean(
    input.ready
      && !input.dismissed
      && !isFirstMileCoreComplete({ hasUsableModel: input.hasUsableModel }),
  );
}

/**
 * Do not block First Mile on `isPending` after a fetch finished with no data.
 * Packaged OSS with sidecar off / a failed provider list would otherwise never auto-open.
 */
export function shouldWaitForProviderListBeforeFirstMile(input: {
  isFetching: boolean;
}): boolean {
  return Boolean(input.isFetching);
}

/** After the popup closes, keep a badge/chip until they have a model or dismiss. */
export function shouldShowFirstMileEntryCue(input: {
  dismissed: boolean;
  hasUsableModel: boolean;
}): boolean {
  return !input.dismissed && !isFirstMileCoreComplete({ hasUsableModel: input.hasUsableModel });
}

export function resolveFirstMileChecklist(input: {
  hasUsableModel: boolean;
  hasPlatformIdentity: boolean;
  abilityProjectCount: number;
  chrome: FirstMileChromeState;
}): FirstMileChecklist {
  const chromeStatus: FirstMileItemStatus =
    input.chrome.kind === "unknown"
      ? "optional"
      : input.chrome.kind === "unavailable"
        ? "unavailable"
        : input.chrome.connected
          ? "done"
          : "optional";

  return {
    model: input.hasUsableModel ? "done" : "todo",
    chrome: chromeStatus,
    projects: "hidden",
  };
}

/** Chrome stays optional: 忽略 closes the wizard; 安装调试 is the only setup action. */
export type FirstMileChromeFooter = {
  primary: "skip";
  secondary: "install";
};

export function resolveFirstMileChromeFooter(
  _chrome?: FirstMileChromeState,
): FirstMileChromeFooter {
  return { primary: "skip", secondary: "install" };
}

export function firstMileChromePrimaryLabel(
  _action?: FirstMileChromeFooter["primary"],
): string {
  return "忽略";
}

export function firstMileChromeSecondaryLabel(
  _action?: FirstMileChromeFooter["secondary"],
): string {
  return "安装调试";
}

export function visibleFirstMilePhases(checklist: FirstMileChecklist): FirstMilePhase[] {
  return FIRST_MILE_PHASES.filter((phase) => checklist[phase] !== "hidden");
}

export function pickInitialFirstMilePhase(checklist: FirstMileChecklist): FirstMilePhase {
  const visible = visibleFirstMilePhases(checklist);
  const firstTodo = visible.find((phase) => checklist[phase] === "todo");
  if (firstTodo) return firstTodo;
  const firstOptional = visible.find(
    (phase) => checklist[phase] === "optional" || checklist[phase] === "unavailable",
  );
  if (firstOptional) return firstOptional;
  return visible[0] ?? "model";
}

export function nextVisibleFirstMilePhase(
  phase: FirstMilePhase,
  checklist: FirstMileChecklist,
): FirstMilePhase | "done" {
  const visible = visibleFirstMilePhases(checklist);
  const index = visible.indexOf(phase);
  if (index < 0) return visible[0] ?? "done";
  if (index >= visible.length - 1) return "done";
  return visible[index + 1]!;
}

export function prevVisibleFirstMilePhase(
  phase: FirstMilePhase,
  checklist: FirstMileChecklist,
): FirstMilePhase | null {
  const visible = visibleFirstMilePhases(checklist);
  const index = visible.indexOf(phase);
  if (index <= 0) return null;
  return visible[index - 1] ?? null;
}

export function isFirstMilePhase(value: unknown): value is FirstMilePhase {
  return value === "model" || value === "chrome" || value === "projects";
}

export function readFirstMileDismissed(
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return false;
    if (store.getItem(FIRST_MILE_DISMISS_KEY) === "1") return true;
    // Migrate legacy BYOK-only dismiss so we don't re-spam users who already opted out.
    return readByokGuideDismissed(store);
  } catch {
    return false;
  }
}

export function writeFirstMileDismissed(
  dismissed: boolean,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): void {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    if (dismissed) {
      store.setItem(FIRST_MILE_DISMISS_KEY, "1");
      writeByokGuideDismissed(true, store);
    } else {
      store.removeItem(FIRST_MILE_DISMISS_KEY);
      store.removeItem(BYOK_GUIDE_DISMISS_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WODEAPP_FIRST_MILE_CUE_EVENT));
  }
}

export function publishFirstMileStatus(snapshot: FirstMileStatusSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WODEAPP_FIRST_MILE_STATUS_EVENT, { detail: snapshot }),
  );
}

export type FirstMileOpenDetail = Partial<FirstMileStatusSnapshot> & {
  /** Optional seed phase for guided reopen / accept (not a clickable tab). */
  phase?: FirstMilePhase;
};

export function openFirstMileGuide(detail?: FirstMileOpenDetail): void {
  if (typeof window === "undefined") return;
  if (isWebFirstMileRuntime()) {
    window.dispatchEvent(new Event("wodeapp:open-login"));
    return;
  }
  window.dispatchEvent(
    new CustomEvent(WODEAPP_OPEN_FIRST_MILE_EVENT, { detail: detail ?? {} }),
  );
}

export function normalizeFirstMileStatusDetail(
  detail: unknown,
): Partial<FirstMileStatusSnapshot> {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const record = detail as Record<string, unknown>;
  const out: Partial<FirstMileStatusSnapshot> = {};
  if (typeof record.hasUsableModel === "boolean") out.hasUsableModel = record.hasUsableModel;
  if (typeof record.hasPlatformIdentity === "boolean") {
    out.hasPlatformIdentity = record.hasPlatformIdentity;
  }
  if (typeof record.abilityProjectCount === "number" && Number.isFinite(record.abilityProjectCount)) {
    out.abilityProjectCount = Math.max(0, Math.floor(record.abilityProjectCount));
  }
  return out;
}

export function normalizeFirstMileOpenDetail(detail: unknown): FirstMileOpenDetail {
  const status = normalizeFirstMileStatusDetail(detail);
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return status;
  const phase = (detail as Record<string, unknown>).phase;
  if (isFirstMilePhase(phase)) return { ...status, phase };
  return status;
}
