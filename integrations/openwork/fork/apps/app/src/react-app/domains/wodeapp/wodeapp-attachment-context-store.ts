import { desktopBridge } from "@/app/lib/desktop";
import {
  clearWodeAppContextHygieneEvents,
  recordWodeAppContextHygieneEvent,
} from "./wodeapp-context-hygiene-metrics";

export type AttachmentContextStoreFile = {
  filename: string;
  mime: string;
  dataUrl: string;
};

export type StoredAttachmentContextRef = {
  refId: string;
  contextChars: number;
  storedBytes: number;
  storeBytes: number;
  maxStoreBytes: number;
  files: Array<{
    /** Original display name before the Electron store sanitizes the disk basename. */
    originalFilename?: string;
    filename: string;
    mime: string;
    path: string;
    sizeBytes: number;
  }>;
};

function createContextRefId() {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ctx_${uuid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Strip optional data-URL parameters (e.g. charset) so Electron cache decode stays stable. */
function normalizeAttachmentContextDataUrl(dataUrl: string, mimeHint?: string): string {
  const raw = String(dataUrl ?? "").trim();
  const comma = raw.indexOf(",");
  if (!raw.toLowerCase().startsWith("data:") || comma < 0) return raw;
  const meta = raw.slice("data:".length, comma);
  const payload = raw.slice(comma + 1).replace(/\s/g, "");
  const parts = meta.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === "base64")) return raw;
  const mime = parts[0] || mimeHint || "application/octet-stream";
  return `data:${mime};base64,${payload}`;
}

export async function persistAttachmentContext(input: {
  sessionId: string;
  contextPackId?: string;
  context?: string;
  sources?: Array<Record<string, string>>;
  uploadedUrls?: Array<Record<string, string>>;
  files?: AttachmentContextStoreFile[];
}): Promise<StoredAttachmentContextRef | null> {
  if (typeof window === "undefined" || !window.__OPENWORK_ELECTRON__?.invokeDesktop) {
    return null;
  }
  try {
    const normalizedFiles = (input.files || []).map((file) => ({
      ...file,
      dataUrl: normalizeAttachmentContextDataUrl(file.dataUrl, file.mime),
    }));
    const result = await desktopBridge.attachmentContextPut({
      refId: createContextRefId(),
      sessionId: input.sessionId,
      contextPackId: input.contextPackId,
      context: input.context,
      sources: input.sources,
      uploadedUrls: input.uploadedUrls,
      files: normalizedFiles,
    });
    if (!result?.ok || !result.refId) {
      recordWodeAppContextHygieneEvent({
        sessionId: input.sessionId,
        event: "context_pack_unavailable",
      });
      return null;
    }
    recordWodeAppContextHygieneEvent({
      sessionId: input.sessionId,
      event: "context_pack_persisted",
      details: {
        contextChars: result.contextChars,
        files: result.files.length,
        storedBytes: result.storedBytes,
        storeBytes: result.storeBytes,
        maxStoreBytes: result.maxStoreBytes,
      },
    });
    return result;
  } catch (error) {
    console.warn("[WodeAppAttachmentContext] local persistence failed", error);
    recordWodeAppContextHygieneEvent({
      sessionId: input.sessionId,
      event: "context_pack_failed",
      details: {
        reason: error instanceof Error ? error.message : String(error || "unknown"),
      },
    });
    return null;
  }
}

export async function deleteAttachmentContextForSession(sessionId: string): Promise<void> {
  if (typeof window === "undefined" || !window.__OPENWORK_ELECTRON__?.invokeDesktop) {
    return;
  }
  try {
    await desktopBridge.attachmentContextDeleteSession(sessionId);
    clearWodeAppContextHygieneEvents(sessionId);
  } catch (error) {
    console.warn("[WodeAppAttachmentContext] session cleanup failed", error);
  }
}

export async function readAttachmentContextStoreStatus() {
  if (typeof window === "undefined" || !window.__OPENWORK_ELECTRON__?.invokeDesktop) {
    return null;
  }
  try {
    return await desktopBridge.attachmentContextStatus();
  } catch (error) {
    console.warn("[WodeAppAttachmentContext] status read failed", error);
    return null;
  }
}
