export type WodeAppAutomationStatus = "active" | "paused" | "running" | "failed";

export type WodeAppAutomationJob = {
  id: string;
  scopeId: string;
  slug: string;
  name: string;
  schedule: string;
  timezone: string;
  status: WodeAppAutomationStatus;
  paused: boolean;
  prompt: string;
  workdir: string;
  workspaceId: string | null;
  workspaceName: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunExitCode: number | null;
  lastRunError: string | null;
  lastRunSessionId: string | null;
  nextRunAt: string | null;
  model: string | null;
  agent: string | null;
  timeoutSeconds: number | null;
  runtimeConfigManaged: boolean;
};

export type WodeAppAutomationList = {
  jobs: WodeAppAutomationJob[];
  timezone: string;
};

export type WodeAppAutomationLogs = {
  job: WodeAppAutomationJob;
  sessionId: string | null;
  summary: string;
  logs: string;
  path: string;
};

export type WodeAppAutomationClient = {
  list: () => Promise<WodeAppAutomationList>;
  run: (id: string) => Promise<{ ok: boolean; job: WodeAppAutomationJob }>;
  pause: (id: string) => Promise<{ ok: boolean; job: WodeAppAutomationJob }>;
  resume: (id: string) => Promise<{ ok: boolean; job: WodeAppAutomationJob }>;
  repair: (id: string) => Promise<{ ok: boolean; job: WodeAppAutomationJob }>;
  logs: (id: string, lines?: number) => Promise<WodeAppAutomationLogs>;
  delete: (id: string, includeHistory?: boolean) => Promise<{ ok: boolean; id: string }>;
  /** 技能 hub（能力中心）：与 OpenWork server /workspace/:id/skills 与 /hub/skills 对齐。 */
  skills: WodeAppSkillHubClient;
};

export type WodeAppSkillHubRepo = {
  owner: string;
  repo: string;
  ref: string;
};

export type WodeAppInstalledSkill = {
  name: string;
  description?: string;
  trigger?: string;
  path?: string;
};

export type WodeAppHubSkill = {
  name: string;
  description?: string;
  trigger?: string;
};

export type WodeAppSkillHubClient = {
  listInstalled: (workspaceId: string) => Promise<WodeAppInstalledSkill[]>;
  listHub: (repo?: WodeAppSkillHubRepo) => Promise<WodeAppHubSkill[]>;
  install: (
    workspaceId: string,
    name: string,
    repo?: WodeAppSkillHubRepo,
  ) => Promise<{ ok: boolean; name: string; action?: string }>;
  uninstall: (workspaceId: string, name: string) => Promise<{ ok: boolean }>;
};

/** 技能 hub 列表查询路径；无 repo 时服务端回退到默认仓库。 */
export function buildWodeAppHubSkillsPath(repo?: WodeAppSkillHubRepo): string {
  const params = new URLSearchParams();
  const owner = repo?.owner?.trim();
  const name = repo?.repo?.trim();
  const ref = repo?.ref?.trim();
  if (owner) params.set("owner", owner);
  if (name) params.set("repo", name);
  if (ref) params.set("ref", ref);
  const query = params.toString();
  return query ? `/hub/skills?${query}` : "/hub/skills";
}

type AutomationClientOptions = {
  baseUrl: string;
  token?: string | null;
};

async function requestJson<T>(
  options: AutomationClientOptions,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; errorLabel?: string } = {},
): Promise<T> {
  const errorLabel = init.errorLabel ?? "自动任务";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  try {
    const headers = new Headers({ Accept: "application/json" });
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.token?.trim()) headers.set("Authorization", `Bearer ${options.token.trim()}`);
    const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = typeof payload?.message === "string" ? payload.message : response.statusText || `${errorLabel}请求失败`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(`${errorLabel}请求超时`);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function createWodeAppAutomationClient(options: AutomationClientOptions): WodeAppAutomationClient {
  const action = <T>(id: string, name: string, body?: unknown) => requestJson<T>(
    options,
    `/automations/${encodeURIComponent(id)}/${name}`,
    { method: "POST", body: body ?? {}, timeoutMs: 60_000 },
  );
  return {
    list: () => requestJson<WodeAppAutomationList>(options, "/automations"),
    run: (id) => action(id, "run"),
    pause: (id) => action(id, "pause"),
    resume: (id) => action(id, "resume"),
    repair: (id) => action(id, "repair"),
    logs: (id, lines = 200) => requestJson<WodeAppAutomationLogs>(
      options,
      `/automations/${encodeURIComponent(id)}/logs?lines=${Math.max(1, Math.min(1000, Math.floor(lines)))}`,
    ),
    delete: (id, includeHistory = true) => requestJson<{ ok: boolean; id: string }>(
      options,
      `/automations/${encodeURIComponent(id)}`,
      { method: "DELETE", body: { includeHistory }, timeoutMs: 60_000 },
    ),
    skills: {
      listInstalled: async (workspaceId) => {
        const response = await requestJson<{ items?: WodeAppInstalledSkill[] }>(
          options,
          `/workspace/${encodeURIComponent(workspaceId)}/skills?includeGlobal=true`,
          { errorLabel: "技能" },
        );
        return Array.isArray(response?.items) ? response.items : [];
      },
      listHub: async (repo) => {
        const response = await requestJson<{ items?: WodeAppHubSkill[] }>(
          options,
          buildWodeAppHubSkillsPath(repo),
          { timeoutMs: 45_000, errorLabel: "技能仓库" },
        );
        return Array.isArray(response?.items) ? response.items : [];
      },
      install: (workspaceId, name, repo) => requestJson<{ ok: boolean; name: string; action?: string }>(
        options,
        `/workspace/${encodeURIComponent(workspaceId)}/skills/hub/${encodeURIComponent(name)}`,
        { method: "POST", body: repo ? { repo } : {}, timeoutMs: 120_000, errorLabel: "技能安装" },
      ),
      uninstall: async (workspaceId, name) => {
        await requestJson<{ path?: string }>(
          options,
          `/workspace/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(name)}`,
          { method: "DELETE", timeoutMs: 60_000, errorLabel: "技能卸载" },
        );
        return { ok: true };
      },
    },
  };
}
