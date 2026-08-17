import { toast } from "@/components/ui/sonner";
import type { ModelRef } from "@/app/types";
import { readWodeAppContextHygieneEvents } from "./wodeapp-context-hygiene-metrics";

export type WodeAppSessionDebugContext = {
  workspaceId: string;
  sessionId: string;
  workspaceRoot: string;
  model?: ModelRef;
  opencodeBaseUrl?: string;
  sessionStatus?: string;
  sessionError?: string | null;
  messageCount?: number;
  wodeappWorkbench?: boolean;
};

export function buildWodeAppSessionDebugBundle(context: WodeAppSessionDebugContext): string {
  return JSON.stringify(
    {
      product: "WodeAppX",
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
      contextHygiene: readWodeAppContextHygieneEvents(context.sessionId, 30),
      location: typeof window !== "undefined" ? window.location.href : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    },
    null,
    2,
  );
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Electron / 部分 WebView 会在失焦或异步回调里拒绝 Clipboard API，继续走兜底。
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

async function copyText(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    toast.warning(`${label}为空`);
    return false;
  }
  const copied = await writeClipboardText(trimmed);
  if (copied) {
    toast.message(`已复制${label}`);
    return true;
  }
  toast.error(`复制${label}失败，请手动复制：${trimmed.length > 48 ? `${trimmed.slice(0, 20)}…${trimmed.slice(-12)}` : trimmed}`);
  return false;
}

export async function copyWodeAppSessionId(sessionId: string) {
  return copyText("对话 ID", sessionId);
}

export async function copyWodeAppSessionDebugBundle(context: WodeAppSessionDebugContext) {
  return copyText("调试信息", buildWodeAppSessionDebugBundle(context));
}
