/**
 * User-triggered session bug report: ingest + spawn investigation chat.
 */
import { toast } from "@/components/ui/sonner";
import {
  reportDesktopDiagnosticAsync,
  type DesktopDiagnosticInput,
} from "./wodeapp-desktop-diagnostics";
import type { WodeAppTaskPromptInput } from "./wodeapp-composer-handoff";
import type { WodeAppSessionDebugContext } from "./wodeapp-session-debug";
import {
  buildSessionBugInvestigationTask as buildPromptTask,
  type SessionBugPromptContext,
} from "./wodeapp-session-bug-report-prompt";
import { exportHangTraceJson } from "./wodeapp-hang-trace";

export type SessionBugReportContext = WodeAppSessionDebugContext & {
  note?: string | null;
};

export {
  buildSessionBugInvestigationDisplayText,
  buildSessionBugInvestigationPrompt,
  buildSessionBugDebugBundleJson,
} from "./wodeapp-session-bug-report-prompt";

function toPromptContext(context: SessionBugReportContext): SessionBugPromptContext {
  let hangTraceDump: string | null = null;
  try {
    hangTraceDump = exportHangTraceJson({ sessionId: context.sessionId, limit: 200 });
  } catch {
    hangTraceDump = null;
  }
  return {
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    workspaceRoot: context.workspaceRoot,
    model: context.model
      ? { providerID: context.model.providerID, modelID: context.model.modelID }
      : null,
    opencodeBaseUrl: context.opencodeBaseUrl ?? null,
    sessionStatus: context.sessionStatus ?? null,
    sessionError: context.sessionError ?? null,
    messageCount: context.messageCount ?? null,
    wodeappWorkbench: context.wodeappWorkbench ?? true,
    note: context.note ?? null,
    location: typeof window !== "undefined" ? window.location.href : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    hangTraceDump,
  };
}

export function buildSessionBugInvestigationTask(
  context: SessionBugReportContext,
): WodeAppTaskPromptInput {
  return buildPromptTask(toPromptContext(context));
}

export async function ingestUserSessionBugReport(
  context: SessionBugReportContext,
): Promise<{ ok: boolean; skipped?: boolean }> {
  const input: DesktopDiagnosticInput = {
    kind: "user_session_bug",
    message: `user reported session bug ${context.sessionId}`.slice(0, 500),
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    context: {
      source: "topbar_report",
      sessionStatus: context.sessionStatus || null,
      sessionError: context.sessionError || null,
      modelId: context.model?.modelID || null,
      providerId: context.model?.providerID || null,
      messageCount: typeof context.messageCount === "number" ? context.messageCount : null,
      note: String(context.note || "").trim().slice(0, 200) || null,
    },
  };
  return reportDesktopDiagnosticAsync(input, { force: true });
}

export type StartSessionBugInvestigation = (
  workspaceId: string,
  prompt: WodeAppTaskPromptInput,
) => void | Promise<void | string | null>;

/**
 * Report to mainserver diagnostics, then open a new chat that auto-starts diagnosis.
 * Prefer spawning under `investigationWorkspaceId` (usually 「最近」) so 「项目」
 * session order is not reshuffled by the new turn.
 */
export async function reportAndInvestigateSessionBug(input: {
  context: SessionBugReportContext;
  startInvestigation: StartSessionBugInvestigation;
  /** Workspace that receives the new investigation chat. Defaults to reported workspace. */
  investigationWorkspaceId?: string | null;
}): Promise<{ reported: boolean; investigationSessionId: string | null }> {
  const sessionId = input.context.sessionId.trim();
  const workspaceId = input.context.workspaceId.trim();
  const investigationWorkspaceId =
    String(input.investigationWorkspaceId || "").trim() || workspaceId;
  if (!sessionId || !workspaceId) {
    toast.warning("当前没有可上报的对话");
    return { reported: false, investigationSessionId: null };
  }

  toast.message("已创建故障排查任务…");
  const ingest = await ingestUserSessionBugReport(input.context);
  const task = buildSessionBugInvestigationTask(input.context);
  let investigationSessionId: string | null = null;
  try {
    const created = await Promise.resolve(
      input.startInvestigation(investigationWorkspaceId, task),
    );
    investigationSessionId = typeof created === "string" && created.trim() ? created.trim() : null;
  } catch {
    investigationSessionId = null;
  }

  if (investigationSessionId) {
    toast.message(ingest.ok ? "已上报，正在自动排查" : "排查已开始（云端上报未成功，本地仍可诊断）");
  } else {
    toast.error("上报后未能自动开启排查对话，请手动新建对话并粘贴对话 ID");
  }

  return { reported: ingest.ok, investigationSessionId };
}
