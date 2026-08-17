/** @jsxImportSource react */
import { useEffect, useSyncExternalStore } from "react";

import {
  getWodeAppApiCredentials,
  requestWodeAppRuntimeJson,
  type WodeAppApiCredentials,
} from "@/app/lib/wodeapp-auth";

import {
  appendAssetContextToPrompt,
  assetMentionLabel,
  digitalAssetSearchText,
  digitalAssetToMention,
  type DigitalAssetItem,
} from "./digital-assets-data";
import { findDigitalAssetById, getDigitalAssetsList } from "./digital-assets-store";

export type WodeAppCloudRelayState = {
  status: "idle" | "registering" | "online" | "error";
  workspaceId: string;
  deviceId: string;
  pairCode: string;
  pairingLink: string;
  paired: boolean;
  online: boolean;
  error: string;
};

type RelayRequest = {
  requestId: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

type RelayRegisterResponse = {
  deviceId: string;
  pairCode: string;
  pairingLink?: string;
  paired?: boolean;
};

type RelayHeartbeatResponse = {
  paired?: boolean;
  online?: boolean;
};

type RelayRequestsResponse = {
  requests?: RelayRequest[];
};

type MobilePromptMention = {
  type?: "asset" | "skill";
  value?: string;
};

type MobilePromptAttachment = {
  url?: string;
  filename?: string;
  mime?: string;
  size?: number;
};

type UseWodeAppCloudRelayBridgeOptions = {
  enabled: boolean;
  localBaseUrl?: string | null;
  localToken?: string | null;
  workspaceId?: string | null;
};

const initialState: WodeAppCloudRelayState = {
  status: "idle",
  workspaceId: "",
  deviceId: "",
  pairCode: "",
  pairingLink: "",
  paired: false,
  online: false,
  error: "",
};

let relayState = initialState;
const listeners = new Set<() => void>();

function publishRelayState(next: Partial<WodeAppCloudRelayState>) {
  relayState = { ...relayState, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWodeAppCloudRelayState(): WodeAppCloudRelayState {
  return useSyncExternalStore(subscribe, () => relayState, () => initialState);
}

function relayDeviceStorageKey(workspaceId: string): string {
  return `wodeappx.cloud-relay.device.v1:${workspaceId}`;
}

function relayPairingLink(origin: string, code: string): string {
  const params = new URLSearchParams({ origin: origin.replace(/\/$/, ""), code });
  return `wodeapp://relay?${params.toString()}`;
}

function asMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "";
  if (message.includes("接口不存在") || /\b404\b/.test(message)) {
    return "云中转服务正在发布，请稍后重试";
  }
  return message || "云中转暂时不可用";
}

async function postRelayResponse(
  credentials: WodeAppApiCredentials,
  deviceId: string,
  requestId: string,
  response: { status: number; body: unknown; contentType?: string },
) {
  await requestWodeAppRuntimeJson(
    `/wodeappx-relay/devices/${encodeURIComponent(deviceId)}/responses/${encodeURIComponent(requestId)}`,
    {
      method: "POST",
      body: JSON.stringify(response),
      wodeAppCredentials: credentials,
    },
    15_000,
  );
}

async function forwardToDesktop(
  localBaseUrl: string,
  localToken: string,
  request: RelayRequest,
): Promise<{ status: number; body: unknown; contentType?: string }> {
  try {
    const headers = new Headers({
      Authorization: `Bearer ${localToken}`,
      "X-OpenWork-Client-Id": "wodeapp-cloud-relay",
      Accept: "application/json",
    });
    const localRequest = async (path: string, method: "GET" | "POST" = "GET", value?: unknown) => {
      const nextHeaders = new Headers(headers);
      let body: string | undefined;
      if (value !== undefined) {
        nextHeaders.set("Content-Type", "application/json");
        body = JSON.stringify(value);
      }
      const response = await fetch(`${localBaseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: nextHeaders,
        body,
      });
      const contentType = response.headers.get("content-type") || undefined;
      const responseText = await response.text();
      let responseBody: unknown = null;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = responseText;
      }
      return { status: response.status, body: responseBody, contentType };
    };

    const parsedPath = new URL(request.path, "http://wodeappx.local");
    const mentionMatch = parsedPath.pathname.match(/^\/workspace\/([^/]+)\/mobile\/mentions$/);
    if (request.method === "GET" && mentionMatch?.[1]) {
      const query = (parsedPath.searchParams.get("query") || "").trim().toLowerCase();
      const assets = getDigitalAssetsList()
        .filter((item) => !["productUpload", "assetUpload", "assetCreate", "brandCreate"].includes(item.preview))
        .filter((item) => !query || digitalAssetSearchText(item).includes(query) || item.id.toLowerCase().includes(query))
        .slice(0, 100)
        .map((item) => ({
          id: `asset:${item.id}`,
          type: "asset" as const,
          value: item.id,
          label: assetMentionLabel(item),
          assetKind: item.kind,
          description: item.meta,
          thumbnail: mobileAssetThumbnail(item),
        }));
      const workspaceId = decodeURIComponent(mentionMatch[1]);
      const skillResponse = await localRequest(
        `/workspace/${encodeURIComponent(workspaceId)}/skills?includeGlobal=true`,
      );
      const skillBody = isRecord(skillResponse.body) ? skillResponse.body : {};
      const skillItems = Array.isArray(skillBody.items) ? skillBody.items : [];
      const skills = skillItems.flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = stringValue(item.name);
        if (!name) return [];
        const description = stringValue(item.description) || stringValue(item.trigger) || "工作流指令";
        const searchText = `${name} ${description}`.toLowerCase();
        if (query && !searchText.includes(query)) return [];
        return [{
          id: `skill:${name}`,
          type: "skill" as const,
          value: name,
          label: name,
          description,
        }];
      });
      return { status: 200, body: { items: [...assets, ...skills] }, contentType: "application/json" };
    }

    const snapshotMatch = parsedPath.pathname.match(/^\/workspace\/([^/]+)\/mobile\/snapshot$/);
    if (request.method === "GET" && snapshotMatch?.[1]) {
      const workspaceId = decodeURIComponent(snapshotMatch[1]);
      const sessionId = (parsedPath.searchParams.get("sessionId") || "").trim();
      const [sessions, approvals, messages, permissions, questions] = await Promise.all([
        localRequest(`/workspace/${encodeURIComponent(workspaceId)}/sessions?limit=50`),
        localRequest("/approvals"),
        sessionId
          ? localRequest(`/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`)
          : Promise.resolve({ status: 200, body: { items: [] }, contentType: "application/json" }),
        localRequest(`/w/${encodeURIComponent(workspaceId)}/opencode/permission`),
        localRequest(`/w/${encodeURIComponent(workspaceId)}/opencode/question`),
      ]);
      const failed = [sessions, approvals, messages].find((entry) => entry.status < 200 || entry.status >= 300);
      if (failed) return failed;
      return {
        status: 200,
        body: {
          sessions: sessions.body,
          approvals: approvals.body,
          messages: messages.body,
          permissions: permissions.status >= 200 && permissions.status < 300 ? permissions.body : [],
          questions: questions.status >= 200 && questions.status < 300 ? questions.body : [],
          sessionId,
        },
        contentType: "application/json",
      };
    }

    const promptMatch = parsedPath.pathname.match(
      /^\/workspace\/([^/]+)\/mobile\/sessions\/([^/]+)\/prompt_async$/,
    );
    if (request.method === "POST" && promptMatch?.[1] && promptMatch[2]) {
      const workspaceId = decodeURIComponent(promptMatch[1]);
      const sessionId = decodeURIComponent(promptMatch[2]);
      const input = isRecord(request.body) ? request.body : {};
      const mentions = Array.isArray(input.mentions) ? input.mentions as MobilePromptMention[] : [];
      const attachments = Array.isArray(input.attachments) ? input.attachments as MobilePromptAttachment[] : [];
      const assetRefs = mentions.flatMap((mention) => {
        if (mention?.type !== "asset") return [];
        const asset = findDigitalAssetById(stringValue(mention.value));
        return asset ? [digitalAssetToMention(asset)] : [];
      });
      const skillNames = [...new Set(mentions
        .filter((mention) => mention?.type === "skill")
        .map((mention) => stringValue(mention.value))
        .filter(Boolean))];
      const safeAttachments = attachments.flatMap((attachment) => {
        const url = stringValue(attachment?.url);
        if (!/^https?:\/\//i.test(url)) return [];
        return [{
          url,
          filename: stringValue(attachment.filename) || "附件",
          mime: stringValue(attachment.mime) || "application/octet-stream",
          size: Number(attachment.size) || 0,
        }];
      }).slice(0, 8);
      const requestedText = stringValue(input.text);
      let resolvedText = appendAssetContextToPrompt(
        requestedText || (assetRefs.length || skillNames.length || safeAttachments.length ? "请基于已关联内容继续。" : ""),
        assetRefs,
        { sessionId },
      );
      if (safeAttachments.length) {
        resolvedText = `${resolvedText}\n\n[本条消息附件]\n${safeAttachments
          .map((attachment, index) => `${index + 1}. ${attachment.filename} · ${attachment.mime} · ${attachment.url}`)
          .join("\n")}`;
      }
      const parts: Array<Record<string, unknown>> = resolvedText ? [{ type: "text", text: resolvedText }] : [];
      for (const skillName of skillNames) {
        parts.push({ type: "text", text: `Load [skill ${skillName}] and follow its instructions.` });
      }
      const seenFileUrls = new Set<string>();
      const addFilePart = (url: string, filename: string, mime: string) => {
        if (!url || seenFileUrls.has(url) || seenFileUrls.size >= 16) return;
        if (!/^https?:\/\//i.test(url)) return;
        seenFileUrls.add(url);
        parts.push({ type: "file", url, filename, mime });
      };
      safeAttachments.forEach((attachment) => addFilePart(attachment.url, attachment.filename, attachment.mime));
      assetRefs.forEach((ref, refIndex) => {
        const prefix = `${ref.kind || "asset"}-${refIndex + 1}`;
        (ref.productImages || []).forEach((url, index) => addFilePart(url, `${prefix}-product-${index + 1}`, "image/*"));
        (ref.assetImages || []).forEach((url, index) => addFilePart(url, `${prefix}-image-${index + 1}`, "image/*"));
        (ref.brandAssets || []).forEach((url, index) => addFilePart(url, `${prefix}-brand-${index + 1}`, "image/*"));
        if (ref.coverImage) addFilePart(ref.coverImage, `${prefix}-cover`, "image/*");
      });
      return localRequest(
        `/w/${encodeURIComponent(workspaceId)}/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`,
        "POST",
        { parts },
      );
    }

    return localRequest(request.path, request.method, request.body);
  } catch (error) {
    return { status: 502, body: { error: asMessage(error) } };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mobileAssetThumbnail(item: DigitalAssetItem): string | undefined {
  return [item.coverImage, ...(item.productImages || []), ...(item.assetImages || []), ...(item.brandAssets || [])]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
}

export function useWodeAppCloudRelayBridge(options: UseWodeAppCloudRelayBridgeOptions) {
  const localBaseUrl = options.localBaseUrl?.trim().replace(/\/$/, "") || "";
  const localToken = options.localToken?.trim() || "";
  const workspaceId = options.workspaceId?.trim() || "";

  useEffect(() => {
    if (!options.enabled || !localBaseUrl || !localToken || !workspaceId) {
      publishRelayState({ ...initialState, workspaceId });
      return;
    }

    let cancelled = false;
    let heartbeatTimer: number | null = null;
    let pollTimer: number | null = null;
    let retryTimer: number | null = null;
    let pollFailures = 0;
    const processing = new Set<string>();

    const schedulePoll = (run: () => void, delay = 150) => {
      if (cancelled) return;
      pollTimer = window.setTimeout(run, delay);
    };

    const connect = async () => {
      publishRelayState({
        ...initialState,
        status: "registering",
        workspaceId,
      });
      try {
        const credentials = await getWodeAppApiCredentials();
        if (!credentials) throw new Error("请先登录 WodeAppX");
        const storageKey = relayDeviceStorageKey(workspaceId);
        const storedDeviceId = window.localStorage.getItem(storageKey)?.trim() || "";
        const registered = await requestWodeAppRuntimeJson<RelayRegisterResponse>(
          "/wodeappx-relay/devices/register",
          {
            method: "POST",
            body: JSON.stringify({
              deviceId: storedDeviceId || undefined,
              workspaceId,
              name: "WodeAppX 桌面端",
              pairCodeFormat: "numeric-6",
            }),
            wodeAppCredentials: credentials,
          },
          15_000,
        );
        if (cancelled) return;
        window.localStorage.setItem(storageKey, registered.deviceId);
        publishRelayState({
          status: "online",
          workspaceId,
          deviceId: registered.deviceId,
          pairCode: registered.pairCode,
          pairingLink: relayPairingLink(credentials.origin, registered.pairCode),
          paired: registered.paired === true,
          online: true,
          error: "",
        });

        const heartbeat = async () => {
          try {
            const result = await requestWodeAppRuntimeJson<RelayHeartbeatResponse>(
              `/wodeappx-relay/devices/${encodeURIComponent(registered.deviceId)}/heartbeat`,
              { method: "POST", wodeAppCredentials: credentials },
              12_000,
            );
            if (!cancelled) {
              publishRelayState({
                status: "online",
                paired: result.paired === true,
                online: result.online !== false,
                error: "",
              });
            }
          } catch (error) {
            if (!cancelled) publishRelayState({ status: "error", online: false, error: asMessage(error) });
          }
        };

        const poll = async () => {
          try {
            const result = await requestWodeAppRuntimeJson<RelayRequestsResponse>(
              `/wodeappx-relay/devices/${encodeURIComponent(registered.deviceId)}/requests?wait=20`,
              { wodeAppCredentials: credentials },
              25_000,
            );
            const pending = Array.isArray(result.requests) ? result.requests : [];
            await Promise.all(pending.map(async (request) => {
              if (!request?.requestId || processing.has(request.requestId)) return;
              processing.add(request.requestId);
              try {
                const response = await forwardToDesktop(localBaseUrl, localToken, request);
                await postRelayResponse(credentials, registered.deviceId, request.requestId, response);
              } finally {
                processing.delete(request.requestId);
              }
            }));
            pollFailures = 0;
            if (!cancelled && relayState.status === "error") {
              publishRelayState({ status: "online", online: true, error: "" });
            }
          } catch (error) {
            pollFailures += 1;
            if (!cancelled) publishRelayState({ status: "error", online: false, error: asMessage(error) });
          } finally {
            const retryDelay = pollFailures > 0
              ? Math.min(1_000 * 2 ** Math.min(pollFailures - 1, 5), 30_000)
              : 150;
            schedulePoll(() => void poll(), retryDelay);
          }
        };

        await heartbeat();
        heartbeatTimer = window.setInterval(() => void heartbeat(), 15_000);
        void poll();
      } catch (error) {
        if (!cancelled) {
          publishRelayState({ status: "error", online: false, error: asMessage(error) });
          retryTimer = window.setTimeout(() => void connect(), 3_000);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [localBaseUrl, localToken, options.enabled, workspaceId]);
}
