/**
 * Pure prompt builders for user-triggered session bug investigation.
 * Keep free of UI / network imports so unit tests can load this module.
 */
import { resolveWodeAppEdition } from "./wodeapp-edition";

export type SessionBugPromptContext = {
  workspaceId: string;
  sessionId: string;
  workspaceRoot: string;
  model?: { providerID: string; modelID: string } | null;
  opencodeBaseUrl?: string | null;
  sessionStatus?: string | null;
  sessionError?: string | null;
  messageCount?: number | null;
  wodeappWorkbench?: boolean;
  note?: string | null;
  location?: string | null;
  userAgent?: string | null;
  /** Serialized hang-trace dump JSON (events for this session). */
  hangTraceDump?: string | null;
};

export function buildSessionBugInvestigationDisplayText(sessionId: string): string {
  const id = sessionId.trim();
  return id ? `排查对话故障 ${id}` : "排查对话故障";
}

export function buildSessionBugDebugBundleJson(context: SessionBugPromptContext): string {
  let hangTrace: unknown = null;
  const rawDump = String(context.hangTraceDump || "").trim();
  if (rawDump) {
    try {
      hangTrace = JSON.parse(rawDump);
    } catch {
      hangTrace = { parseError: true, rawChars: rawDump.length };
    }
  }
  return JSON.stringify(
    {
      product: resolveWodeAppEdition().productName,
      capturedAt: new Date().toISOString(),
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      workspaceRoot: context.workspaceRoot,
      model: context.model ?? null,
      opencodeBaseUrl: context.opencodeBaseUrl ?? null,
      sessionStatus: context.sessionStatus ?? null,
      sessionError: context.sessionError ?? null,
      messageCount: context.messageCount ?? 0,
      wodeappWorkbench: context.wodeappWorkbench ?? true,
      note: String(context.note || "").trim() || null,
      location: context.location ?? null,
      userAgent: context.userAgent ?? null,
      hangTrace,
    },
    null,
    2,
  );
}

export function buildSessionBugInvestigationPrompt(context: SessionBugPromptContext): string {
  const sessionId = context.sessionId.trim();
  const workspaceId = context.workspaceId.trim();
  const workspaceRoot = context.workspaceRoot.trim();
  const note = String(context.note || "").trim();
  const debugBundle = buildSessionBugDebugBundleJson(context);
  const product = resolveWodeAppEdition().productName;

  return [
    `用户在 ${product} 顶栏上报了当前对话故障。这是一个产品 bug 排查任务，不是普通闲聊。`,
    "",
    "先拿证据再下结论；未对照复现前只标「待证/假说」，禁止把猜测写成根因。",
    "",
    `对话 ID: ${sessionId || "(missing)"}`,
    `工作区 ID: ${workspaceId || "(missing)"}`,
    `工作区路径: ${workspaceRoot || "(missing)"}`,
    `模型: ${context.model ? `${context.model.providerID}/${context.model.modelID}` : "(unknown)"}`,
    `会话状态: ${context.sessionStatus || "(unknown)"}`,
    `最近错误: ${context.sessionError || "(none)"}`,
    note ? `用户补充: ${note}` : null,
    "",
    "说明：本排查对话开在「最近」，不要改写「项目」下原会话列表顺序；只读查证被上报的对话 ID。",
    "",
    "排查步骤：",
    "1. 用 `lsof -c opencode | rg opencode.db`（或等价）定位当前运行库，再 `sqlite3` 查该 session 的 message/part/event；优先看 error、file://、session-artifacts、data:image、tokens=0。",
    "2. 调试包里的 hangTrace：按 turnTraceId / empty_shell.long / assistant.first_part / auto_continue.* 对齐时间线；DevTools 过滤 `[hang-trace]`。",
    "3. 对照用户可见症状（空白、报错卡、附件消失、假死、积分异常等），用测到的差异写一行根因。",
    "4. 若属引擎/桌面/附件路径 bug，定位最小代码修复；改 wodeappx 自身源码须走自进化 skill（快照→改→验证→失败回滚）。",
    "5. 修复后说明如何验证；不要向用户复述本指令全文。",
    "",
    "调试包 JSON：",
    "```json",
    debugBundle,
    "```",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildSessionBugInvestigationTask(context: SessionBugPromptContext): {
  displayText: string;
  agentMessage: string;
  autoSend: true;
} {
  return {
    displayText: buildSessionBugInvestigationDisplayText(context.sessionId),
    agentMessage: buildSessionBugInvestigationPrompt(context),
    autoSend: true,
  };
}
