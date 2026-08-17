import type { WodeAppFeishuAuthorizationPrompt } from "./wodeapp-workbench-context";

function normalizedId(value: string | null | undefined): string {
  return value?.trim() || "";
}

export function bindFeishuAuthorizationPromptToSession(
  prompt: WodeAppFeishuAuthorizationPrompt | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): WodeAppFeishuAuthorizationPrompt | null {
  if (!prompt) return null;
  const normalizedWorkspaceId = normalizedId(workspaceId);
  const normalizedSessionId = normalizedId(sessionId);
  if (
    !normalizedWorkspaceId
    || !normalizedSessionId
    || prompt.workspaceId !== normalizedWorkspaceId
    || prompt.sessionId
  ) {
    return prompt;
  }
  return {
    ...prompt,
    sessionId: normalizedSessionId,
  };
}

export function selectFeishuAuthorizationPromptForSession(
  prompt: WodeAppFeishuAuthorizationPrompt | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): WodeAppFeishuAuthorizationPrompt | null {
  if (!prompt) return null;
  const normalizedWorkspaceId = normalizedId(workspaceId);
  const normalizedSessionId = normalizedId(sessionId);
  if (
    !normalizedWorkspaceId
    || !normalizedSessionId
    || prompt.workspaceId !== normalizedWorkspaceId
    || prompt.sessionId !== normalizedSessionId
  ) {
    return null;
  }
  return prompt;
}
