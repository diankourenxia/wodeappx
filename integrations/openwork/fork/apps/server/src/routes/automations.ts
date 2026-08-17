import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { ApiError } from "../errors.js";
import { resolveOpencodeDbPath } from "../opencode-db.js";
import {
  WODEAPPX_SCHEDULER_SUPERVISOR_MARKER,
  WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT,
} from "../opencode-plugins/wodeappx-scheduler-supervisor.js";
import { buildOpenworkRuntimeConfig } from "../openwork-runtime-config.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;
type RequireClientScope = (ctx: RequestContext, scope: "owner" | "collaborator" | "viewer") => void;
type ResolveWorkspace = (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;

type SchedulerInvocation = {
  command?: string;
  args?: string[];
};

type SchedulerRun = {
  prompt?: string;
  command?: string;
  arguments?: string;
  model?: string;
  agent?: string;
};

type SchedulerManagedMetadata = {
  paused?: boolean;
  pausedAt?: string;
  resumedAt?: string;
  workspaceId?: string;
  timezone?: string;
  runtimeConfigPath?: string;
  originalInvocation?: SchedulerInvocation;
  lastRunSessionId?: string;
  lastRunSessionAt?: string;
};

type SchedulerJob = {
  scopeId: string;
  slug: string;
  name: string;
  schedule: string;
  workdir?: string;
  createdAt?: string;
  updatedAt?: string;
  lastRunAt?: string;
  lastRunSource?: string;
  lastRunStatus?: string;
  lastRunExitCode?: number;
  lastRunError?: string;
  timeoutSeconds?: number;
  prompt?: string;
  run?: SchedulerRun;
  invocation?: SchedulerInvocation;
  wodeappx?: SchedulerManagedMetadata;
  [key: string]: unknown;
};

type AutomationRouteDependencies = {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: RequireClientScope;
  resolveWorkspace: ResolveWorkspace;
};

const JOB_PART = /^[A-Za-z0-9._-]+$/;
const SESSION_ID = /^ses_[A-Za-z0-9]+$/;
const AUTOMATION_LOG_TAIL_BYTES = 512 * 1024;
const ACCOUNT_RUNTIME_ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "OPENCODE_CONFIG_DIR",
] as const;

/**
 * Remap managed UI XDG (`…/openwork-runtime-data/<id>/xdg/…`) onto a sibling
 * `scheduler-xdg` tree so scheduled `opencode run` never opens the interactive
 * UI `opencode.db` (dual-writer corruption).
 */
export function remapUiXdgPathToSchedulerIsolation(filePath: string): string {
  const raw = String(filePath ?? "");
  if (!raw.includes("openwork-runtime-data")) return raw;
  return raw.replace(/([/\\])xdg([/\\])/g, "$1scheduler-xdg$2");
}

export function remapUiXdgEnvToSchedulerIsolation(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  for (const key of ACCOUNT_RUNTIME_ENV_KEYS) {
    const value = typeof out[key] === "string" ? out[key]!.trim() : "";
    if (!value) continue;
    out[key] = remapUiXdgPathToSchedulerIsolation(value);
  }
  return out;
}

function schedulerPaths(home = homedir()) {
  const opencodeRoot = join(home, ".config", "opencode");
  return {
    schedulerRoot: join(opencodeRoot, "scheduler"),
    scopesRoot: join(opencodeRoot, "scheduler", "scopes"),
    logsRoot: join(opencodeRoot, "logs", "scheduler"),
    supervisorPath: join(opencodeRoot, "scheduler", "supervisor.pl"),
    launchAgentsRoot: join(home, "Library", "LaunchAgents"),
    systemdRoot: join(home, ".config", "systemd", "user"),
  };
}

function encodeAutomationId(scopeId: string, slug: string): string {
  return Buffer.from(`${scopeId}\0${slug}`, "utf8").toString("base64url");
}

export function decodeAutomationId(id: string): { scopeId: string; slug: string } {
  let decoded = "";
  try {
    decoded = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    throw new ApiError(400, "automation_id_invalid", "Invalid automation id");
  }
  const [scopeId, slug, ...rest] = decoded.split("\0");
  if (rest.length || !scopeId || !slug || !JOB_PART.test(scopeId) || !JOB_PART.test(slug)) {
    throw new ApiError(400, "automation_id_invalid", "Invalid automation id");
  }
  return { scopeId, slug };
}

function jobPath(scopeId: string, slug: string, home = homedir()) {
  const paths = schedulerPaths(home);
  return join(paths.scopesRoot, scopeId, "jobs", `${slug}.json`);
}

function logPath(job: Pick<SchedulerJob, "scopeId" | "slug">, home = homedir()) {
  return join(schedulerPaths(home).logsRoot, job.scopeId, `${job.slug}.log`);
}

async function readJob(scopeId: string, slug: string, home = homedir()): Promise<SchedulerJob> {
  const path = jobPath(scopeId, slug, home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new ApiError(404, "automation_not_found", "Automation not found");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(500, "automation_invalid", "Automation file is invalid");
  }
  const job = parsed as SchedulerJob;
  if (job.scopeId !== scopeId || job.slug !== slug) {
    throw new ApiError(500, "automation_invalid", "Automation identity does not match its file");
  }
  return job;
}

async function writeJob(job: SchedulerJob, home = homedir()): Promise<void> {
  const path = jobPath(job.scopeId, job.slug, home);
  await mkdir(join(schedulerPaths(home).scopesRoot, job.scopeId, "jobs"), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
}

async function listJobFiles(home = homedir()): Promise<Array<{ scopeId: string; slug: string }>> {
  const { scopesRoot } = schedulerPaths(home);
  let scopes: string[] = [];
  try {
    scopes = (await readdir(scopesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && JOB_PART.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const jobs = await Promise.all(scopes.map(async (scopeId) => {
    try {
      return (await readdir(join(scopesRoot, scopeId, "jobs"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => ({ scopeId, slug: entry.name.slice(0, -5) }))
        .filter((item) => JOB_PART.test(item.slug));
    } catch {
      return [];
    }
  }));
  return jobs.flat();
}

function workspaceForJob(config: ServerConfig, job: SchedulerJob): WorkspaceInfo | undefined {
  const workdir = job.workdir?.trim();
  if (!workdir) return undefined;
  const normalized = resolve(workdir);
  return config.workspaces.find((workspace) => workspace.workspaceType === "local" && resolve(workspace.path) === normalized);
}

function normalizeInvocation(value: unknown): SchedulerInvocation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const args = Array.isArray(input.args) ? input.args.filter((item): item is string => typeof item === "string") : [];
  return command ? { command, args } : undefined;
}

export function automationInvocationForWorkdir(
  invocation: SchedulerInvocation,
  workdir: string,
): SchedulerInvocation {
  const command = invocation.command?.trim();
  if (!command) return invocation;
  const args = [...(invocation.args ?? [])];
  const executable = basename(command).toLowerCase();
  if (executable !== "opencode" || args[0] !== "run") {
    return { command, args };
  }

  const separatorIndex = args.indexOf("--");
  const insertBeforePrompt = (...values: string[]) => {
    const currentSeparator = args.indexOf("--");
    args.splice(currentSeparator >= 0 ? currentSeparator : args.length, 0, ...values);
  };
  if (!args.includes("--dir")) {
    args.splice(separatorIndex >= 0 ? separatorIndex : args.length, 0, "--dir", resolve(workdir));
  }

  const formatIndex = args.findIndex((arg) => arg === "--format" || arg.startsWith("--format="));
  if (formatIndex >= 0) {
    if (args[formatIndex] === "--format") {
      if (formatIndex + 1 < args.length && args[formatIndex + 1] !== "--") {
        args[formatIndex + 1] = "json";
      } else {
        args.splice(formatIndex + 1, 0, "json");
      }
    } else {
      args[formatIndex] = "--format=json";
    }
  } else {
    insertBeforePrompt("--format", "json");
  }
  return { command, args };
}

export function automationAccountRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  // Keep secrets out of persisted job JSON. launchd runs resolve WODEAPP_API_KEY
  // from ~/.wodeapp/config.json inside the enhanced supervisor instead.
  // Remap UI XDG → scheduler-xdg so timed jobs never dual-write the UI DB.
  const isolated = remapUiXdgEnvToSchedulerIsolation(env);
  return ACCOUNT_RUNTIME_ENV_KEYS.flatMap((key) => {
    const value = isolated[key]?.trim();
    return value ? [`${key}=${value}`] : [];
  });
}

async function ensureSchedulerRuntimeDirs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const isolated = remapUiXdgEnvToSchedulerIsolation(env);
  for (const key of ACCOUNT_RUNTIME_ENV_KEYS) {
    const value = isolated[key]?.trim();
    if (value) await mkdir(value, { recursive: true });
  }
  const dataHome = isolated.XDG_DATA_HOME?.trim();
  if (dataHome) await mkdir(join(dataHome, "opencode"), { recursive: true });
}

export async function ensureWodeAppxSchedulerSupervisor(home = homedir()): Promise<string> {
  const path = schedulerPaths(home).supervisorPath;
  const current = await readFile(path, "utf8").catch(() => "");
  if (current.includes(WODEAPPX_SCHEDULER_SUPERVISOR_MARKER) && current === WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT) {
    return path;
  }
  await mkdir(join(home, ".config", "opencode", "scheduler"), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT, { encoding: "utf8", mode: 0o755 });
  await chmod(temporary, 0o755).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o755).catch(() => undefined);
  return path;
}

export function automationRuntimeConfigForWorkdir(runtimeConfig: string, workdir: string): string {
  const parsed = JSON.parse(runtimeConfig) as Record<string, unknown>;
  const permission = parsed.permission && typeof parsed.permission === "object" && !Array.isArray(parsed.permission)
    ? parsed.permission as Record<string, unknown>
    : {};
  const currentExternal = permission.external_directory
    && typeof permission.external_directory === "object"
    && !Array.isArray(permission.external_directory)
    ? permission.external_directory as Record<string, unknown>
    : {};
  const normalizedWorkdir = resolve(workdir);
  const workdirPattern = normalizedWorkdir === "/" ? "/*" : `${normalizedWorkdir}/*`;
  return JSON.stringify({
    ...parsed,
    permission: {
      ...permission,
      external_directory: {
        ...currentExternal,
        [workdirPattern]: "allow",
      },
    },
  });
}

async function alignRuntimeConfig(config: ServerConfig, input: SchedulerJob): Promise<SchedulerJob> {
  await ensureWodeAppxSchedulerSupervisor().catch(() => undefined);
  const workspace = workspaceForJob(config, input);
  if (!workspace) return input;
  const currentInvocation = normalizeInvocation(input.invocation);
  if (!currentInvocation?.command) return input;

  const metadata = input.wodeappx ?? {};
  const originalInvocation = normalizeInvocation(metadata.originalInvocation) ?? currentInvocation;
  if (!originalInvocation.command) return input;

  const scopeRoot = join(schedulerPaths().scopesRoot, input.scopeId);
  const runtimeConfigPath = join(scopeRoot, `wodeappx-runtime-${workspace.id.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`);
  await mkdir(scopeRoot, { recursive: true });
  await ensureSchedulerRuntimeDirs().catch(() => undefined);
  const runtimeConfig = `${automationRuntimeConfigForWorkdir(
    await buildOpenworkRuntimeConfig(config, workspace.id),
    workspace.path,
  )}\n`;
  const currentRuntimeConfig = await readFile(runtimeConfigPath, "utf8").catch(() => "");
  if (currentRuntimeConfig !== runtimeConfig) {
    const temporary = `${runtimeConfigPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, runtimeConfig, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, runtimeConfigPath);
  }

  const workdirInvocation = automationInvocationForWorkdir(originalInvocation, workspace.path);
  const desiredInvocation: SchedulerInvocation = {
    command: "/usr/bin/env",
    args: [
      ...automationAccountRuntimeEnv(),
      `OPENCODE_CONFIG=${runtimeConfigPath}`,
      workdirInvocation.command!,
      ...(workdirInvocation.args ?? []),
    ],
  };
  const desiredMetadata: SchedulerManagedMetadata = {
    ...metadata,
    workspaceId: workspace.id,
    timezone: metadata.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    runtimeConfigPath,
    originalInvocation,
  };
  if (
    JSON.stringify(input.invocation) === JSON.stringify(desiredInvocation)
    && JSON.stringify(input.wodeappx) === JSON.stringify(desiredMetadata)
  ) return input;

  const next: SchedulerJob = {
    ...input,
    invocation: desiredInvocation,
    wodeappx: desiredMetadata,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(next);
  return next;
}

function parseCronField(expression: string, min: number, max: number, normalize?: (value: number) => number): Set<number> | null {
  const values = new Set<number>();
  for (const rawPart of expression.split(",")) {
    const part = rawPart.trim();
    if (!part) return null;
    const [rangePart, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [startRaw, endRaw] = rangePart.split("-");
        start = Number(startRaw);
        end = Number(endRaw);
      } else {
        start = Number(rangePart);
        end = start;
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(normalize ? normalize(value) : value);
  }
  return values;
}

export function nextCronOccurrence(schedule: string, from = new Date()): string | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = parseCronField(fields[0]!, 0, 59);
  const hours = parseCronField(fields[1]!, 0, 23);
  const monthDays = parseCronField(fields[2]!, 1, 31);
  const months = parseCronField(fields[3]!, 1, 12);
  const weekDays = parseCronField(fields[4]!, 0, 7, (value) => value === 7 ? 0 : value);
  if (!minutes || !hours || !monthDays || !months || !weekDays) return null;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const maxChecks = 60 * 24 * 400;
  const anyMonthDay = fields[2] === "*";
  const anyWeekDay = fields[4] === "*";
  for (let index = 0; index < maxChecks; index += 1) {
    const dayMatches = monthDays.has(candidate.getDate());
    const weekMatches = weekDays.has(candidate.getDay());
    const calendarMatches = anyMonthDay && anyWeekDay
      ? true
      : anyMonthDay
        ? weekMatches
        : anyWeekDay
          ? dayMatches
          : dayMatches || weekMatches;
    if (
      minutes.has(candidate.getMinutes())
      && hours.has(candidate.getHours())
      && months.has(candidate.getMonth() + 1)
      && calendarMatches
    ) return candidate.toISOString();
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

function promptPreview(job: SchedulerJob): string {
  const prompt = typeof job.run?.prompt === "string" ? job.run.prompt : typeof job.prompt === "string" ? job.prompt : "";
  const command = typeof job.run?.command === "string"
    ? `${job.run.command}${job.run.arguments ? ` ${job.run.arguments}` : ""}`
    : "";
  return (prompt || command || "未提供任务内容").trim().slice(0, 280);
}

function publicJob(config: ServerConfig, job: SchedulerJob, lastRunSessionId: string | null = null) {
  const workspace = workspaceForJob(config, job);
  const paused = job.wodeappx?.paused === true;
  return {
    id: encodeAutomationId(job.scopeId, job.slug),
    scopeId: job.scopeId,
    slug: job.slug,
    name: job.name,
    schedule: job.schedule,
    timezone: job.wodeappx?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    status: paused ? "paused" : job.lastRunStatus === "running" ? "running" : job.lastRunStatus === "failed" ? "failed" : "active",
    paused,
    prompt: promptPreview(job),
    workdir: job.workdir || "",
    workspaceId: workspace?.id ?? job.wodeappx?.workspaceId ?? null,
    workspaceName: workspace?.displayName || workspace?.name || basename(job.workdir || "") || "未关联工作区",
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    lastRunAt: job.lastRunAt ?? null,
    lastRunStatus: job.lastRunStatus ?? null,
    lastRunExitCode: job.lastRunExitCode ?? null,
    lastRunError: job.lastRunError ?? null,
    lastRunSessionId,
    nextRunAt: paused ? null : nextCronOccurrence(job.schedule),
    model: job.run?.model ?? null,
    agent: job.run?.agent ?? null,
    timeoutSeconds: job.timeoutSeconds ?? null,
    runtimeConfigManaged: Boolean(job.wodeappx?.runtimeConfigPath),
  };
}

async function listAutomations(config: ServerConfig): Promise<ReturnType<typeof publicJob>[]> {
  await ensureWodeAppxSchedulerSupervisor().catch(() => undefined);
  const identities = await listJobFiles();
  const jobs = await Promise.all(identities.map(async ({ scopeId, slug }) => {
    try {
      return await alignRuntimeConfig(config, await readJob(scopeId, slug));
    } catch {
      return null;
    }
  }));
  const visibleJobs = await Promise.all(
    jobs
      .filter((job): job is SchedulerJob => Boolean(job))
      .map(async (job) => {
        const managed = job.wodeappx;
        if (
          managed?.lastRunSessionId
          && managed.lastRunSessionAt === job.lastRunAt
        ) {
          return publicJob(config, job, managed.lastRunSessionId);
        }
        const logTail = await readAutomationLogTail(job);
        const linkedJob = await persistAutomationSessionLink(job, logTail);
        const linkedMetadata = linkedJob.wodeappx;
        let linkedSessionId: string | null = null;
        if (linkedMetadata && linkedMetadata.lastRunSessionAt === linkedJob.lastRunAt) {
          linkedSessionId = linkedMetadata.lastRunSessionId ?? null;
        }
        return publicJob(
          config,
          linkedJob,
          automationSessionIdForJob(linkedJob, logTail) ?? linkedSessionId,
        );
      }),
  );
  return visibleJobs.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

async function executeCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code ?? "unknown"}`)));
  });
}

async function pauseSystemJob(job: SchedulerJob): Promise<void> {
  const paths = schedulerPaths();
  if (platform() === "darwin") {
    const plist = join(paths.launchAgentsRoot, `com.opencode.job.${job.scopeId}.${job.slug}.plist`);
    if (!existsSync(plist)) throw new ApiError(409, "automation_unit_missing", "Automation scheduler unit is missing");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    await executeCommand("/bin/launchctl", ["bootout", `gui/${uid}`, plist]).catch(async () => {
      await executeCommand("/bin/launchctl", ["unload", plist]).catch(() => undefined);
    });
    return;
  }
  if (platform() === "linux") {
    const timer = `opencode-job-${job.scopeId}-${job.slug}.timer`;
    await executeCommand("systemctl", ["--user", "disable", "--now", timer]).catch(() => undefined);
    return;
  }
  throw new ApiError(501, "automation_pause_unsupported", "Pause is not supported on this platform yet");
}

async function resumeSystemJob(job: SchedulerJob): Promise<void> {
  const paths = schedulerPaths();
  if (platform() === "darwin") {
    const plist = join(paths.launchAgentsRoot, `com.opencode.job.${job.scopeId}.${job.slug}.plist`);
    if (!existsSync(plist)) throw new ApiError(409, "automation_unit_missing", "Automation scheduler unit is missing");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    await executeCommand("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist]).catch(async () => {
      await executeCommand("/bin/launchctl", ["load", plist]);
    });
    return;
  }
  if (platform() === "linux") {
    const timer = `opencode-job-${job.scopeId}-${job.slug}.timer`;
    await executeCommand("systemctl", ["--user", "enable", "--now", timer]);
    return;
  }
  throw new ApiError(501, "automation_resume_unsupported", "Resume is not supported on this platform yet");
}

async function triggerAutomation(job: SchedulerJob): Promise<void> {
  const paths = schedulerPaths();
  const path = jobPath(job.scopeId, job.slug);
  await ensureWodeAppxSchedulerSupervisor().catch(() => undefined);
  if (platform() !== "win32" && existsSync(paths.supervisorPath)) {
    const child = spawn("/usr/bin/perl", [paths.supervisorPath, path], {
      cwd: job.workdir || homedir(),
      detached: true,
      env: { ...process.env },
      stdio: "ignore",
    });
    child.unref();
    return;
  }
  const invocation = normalizeInvocation(job.invocation);
  if (!invocation?.command) throw new ApiError(409, "automation_invocation_missing", "Automation invocation is missing");
  const child = spawn(invocation.command, invocation.args ?? [], {
    cwd: job.workdir || homedir(),
    detached: true,
    env: { ...process.env },
    stdio: "ignore",
  });
  child.unref();
}

async function removeSystemJob(job: SchedulerJob): Promise<void> {
  const paths = schedulerPaths();
  await pauseSystemJob(job).catch(() => undefined);
  if (platform() === "darwin") {
    await rm(join(paths.launchAgentsRoot, `com.opencode.job.${job.scopeId}.${job.slug}.plist`), { force: true });
  } else if (platform() === "linux") {
    await rm(join(paths.systemdRoot, `opencode-job-${job.scopeId}-${job.slug}.timer`), { force: true });
    await rm(join(paths.systemdRoot, `opencode-job-${job.scopeId}-${job.slug}.service`), { force: true });
    await executeCommand("systemctl", ["--user", "daemon-reload"]).catch(() => undefined);
  }
  await rm(jobPath(job.scopeId, job.slug), { force: true });
}

function linesParam(ctx: RequestContext): number {
  const value = Number(ctx.url.searchParams.get("lines") || 200);
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 1000)) : 200;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function latestAutomationRunLog(raw: string): string {
  const clean = stripAnsi(raw).replace(/\r/g, "");
  const lastStart = clean.lastIndexOf("=== Scheduled run");
  return lastStart >= 0 ? clean.slice(lastStart) : clean;
}

function sessionIdFromJsonEvent(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  for (const key of ["sessionID", "sessionId", "session_id"]) {
    const candidate = event[key];
    if (typeof candidate === "string" && SESSION_ID.test(candidate)) return candidate;
  }
  const part = event.part;
  if (!part || typeof part !== "object" || Array.isArray(part)) return null;
  for (const key of ["sessionID", "sessionId", "session_id"]) {
    const candidate = (part as Record<string, unknown>)[key];
    if (typeof candidate === "string" && SESSION_ID.test(candidate)) return candidate;
  }
  return null;
}

export function automationSessionIdFromLog(raw: string): string | null {
  let sessionId: string | null = null;
  for (const line of latestAutomationRunLog(raw).split("\n")) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      sessionId = sessionIdFromJsonEvent(JSON.parse(candidate)) ?? sessionId;
    } catch {
      // A bounded tail can begin mid-line. Later complete JSON events still
      // identify the scheduled run's account-scoped conversation.
    }
  }
  return sessionId;
}

function automationRunStartedAtFromLog(raw: string): string | null {
  const firstLine = latestAutomationRunLog(raw).split("\n", 1)[0]?.trim() ?? "";
  const match = firstLine.match(/^=== Scheduled run\s+(\S+)\s+/);
  return match?.[1] ?? null;
}

function sameAutomationRun(left: string | undefined, right: string | null): boolean {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= 5_000;
}

function accountOpencodeDbCandidates(): string[] {
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (!xdgDataHome) return [];
  const uiRoot = resolve(xdgDataHome);
  const schedulerRoot = resolve(remapUiXdgPathToSchedulerIsolation(xdgDataHome));
  const fromEnv = (() => {
    try {
      const candidate = resolve(resolveOpencodeDbPath());
      return candidate === uiRoot || candidate.startsWith(`${uiRoot}${sep}`)
        ? [candidate]
        : [];
    } catch {
      return [];
    }
  })();
  return [
    // Prefer isolated scheduler DB (post-isolation jobs).
    join(schedulerRoot, "opencode", "opencode.db"),
    ...fromEnv,
    // Legacy shared UI DB (pre-isolation jobs).
    join(uiRoot, "opencode", "opencode.db"),
  ].filter((value, index, all) => all.indexOf(value) === index);
}

export async function findAutomationSessionIdFromAccountDb(
  job: Pick<SchedulerJob, "workdir" | "lastRunAt">,
  explicitDbPath?: string,
): Promise<string | null> {
  const workdir = job.workdir?.trim();
  const startedAtMs = job.lastRunAt ? new Date(job.lastRunAt).getTime() : Number.NaN;
  const dbPaths = explicitDbPath?.trim()
    ? [explicitDbPath.trim()]
    : accountOpencodeDbCandidates();
  if (!workdir || !Number.isFinite(startedAtMs) || dbPaths.length === 0) return null;

  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue;
    const found = await findAutomationSessionIdInDb(job, dbPath, workdir, startedAtMs);
    if (found) return found;
  }
  return null;
}

async function findAutomationSessionIdInDb(
  job: Pick<SchedulerJob, "workdir" | "lastRunAt">,
  dbPath: string,
  workdir: string,
  startedAtMs: number,
): Promise<string | null> {
  void job;

  try {
    const statement = `
      select id, time_created as timeCreated
      from session
      where directory = ?1
        and time_created between ?2 and ?3
      order by abs(time_created - ?4), time_created
      limit 2
    `;
    const parameters = [
      resolve(workdir),
      startedAtMs - 5_000,
      startedAtMs + 20_000,
      startedAtMs,
    ] as const;
    let candidates: Array<{ id?: unknown; timeCreated?: unknown }> = [];
    if (typeof process.versions.bun === "string") {
      const { Database: BunDatabase } = await import("bun:sqlite");
      const database = new BunDatabase(dbPath, { readonly: true });
      try {
        candidates = database.query(statement).all(...parameters) as typeof candidates;
      } finally {
        database.close();
      }
    } else {
      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(dbPath, { readOnly: true });
      try {
        candidates = database.prepare(statement).all(...parameters) as typeof candidates;
      } finally {
        database.close();
      }
    }
    const first = candidates[0];
    const sessionId = typeof first?.id === "string" && SESSION_ID.test(first.id) ? first.id : null;
    const firstCreatedAt = typeof first?.timeCreated === "number" ? first.timeCreated : Number.NaN;
    if (!sessionId || !Number.isFinite(firstCreatedAt) || Math.abs(firstCreatedAt - startedAtMs) > 15_000) {
      return null;
    }

    const secondCreatedAt = typeof candidates[1]?.timeCreated === "number"
      ? candidates[1]!.timeCreated
      : Number.NaN;
    if (
      Number.isFinite(secondCreatedAt)
      && Math.abs(secondCreatedAt - startedAtMs) <= Math.abs(firstCreatedAt - startedAtMs) + 2_000
    ) {
      return null;
    }
    return sessionId;
  } catch {
    return null;
  }
}

type AutomationLogTail = {
  content: string;
  modifiedAtMs: number | null;
};

function automationSessionIdForJob(job: SchedulerJob, log: AutomationLogTail): string | null {
  const sessionId = automationSessionIdFromLog(log.content);
  if (!sessionId) return null;
  const startedAt = automationRunStartedAtFromLog(log.content);
  if (startedAt) return sameAutomationRun(job.lastRunAt, startedAt) ? sessionId : null;

  // A long JSON event stream can push the run marker outside the bounded
  // tail. In that case the log must have been written after this run began;
  // otherwise the tail may still belong to the previous run.
  const lastRunMs = job.lastRunAt ? new Date(job.lastRunAt).getTime() : Number.NaN;
  return Number.isFinite(lastRunMs)
    && log.modifiedAtMs !== null
    && log.modifiedAtMs >= lastRunMs
    ? sessionId
    : null;
}

async function persistAutomationSessionLink(job: SchedulerJob, log: AutomationLogTail): Promise<SchedulerJob> {
  const sessionId = automationSessionIdForJob(job, log)
    ?? await findAutomationSessionIdFromAccountDb(job);
  if (!sessionId) return job;
  if (
    job.wodeappx?.lastRunSessionId === sessionId
    && job.wodeappx.lastRunSessionAt === job.lastRunAt
  ) return job;
  const next: SchedulerJob = {
    ...job,
    wodeappx: {
      ...job.wodeappx,
      lastRunSessionId: sessionId,
      lastRunSessionAt: job.lastRunAt,
    },
  };
  await writeJob(next);
  return next;
}

async function readAutomationLogTail(job: Pick<SchedulerJob, "scopeId" | "slug">): Promise<AutomationLogTail> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(logPath(job), "r");
    const stats = await handle.stat();
    const length = Math.min(stats.size, AUTOMATION_LOG_TAIL_BYTES);
    if (length <= 0) return { content: "", modifiedAtMs: stats.mtimeMs };
    const start = Math.max(0, stats.size - length);
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, start);
    return {
      content: buffer.subarray(0, result.bytesRead).toString("utf8"),
      modifiedAtMs: stats.mtimeMs,
    };
  } catch {
    return { content: "", modifiedAtMs: null };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function textFromJsonEvent(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === "text") {
    if (typeof event.text === "string" && event.text.trim()) return event.text.trim();
    const part = event.part;
    if (part && typeof part === "object" && !Array.isArray(part)) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  if (event.role === "assistant" && typeof event.content === "string" && event.content.trim()) {
    return event.content.trim();
  }
  if (event.type === "error") {
    const error = event.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const data = (error as Record<string, unknown>).data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const message = (data as Record<string, unknown>).message;
        if (typeof message === "string" && message.trim()) return `运行失败：${message.trim()}`;
      }
    }
  }
  return null;
}

function looksLikeLogNoise(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("=== Scheduled run")
    || trimmed.startsWith("=== Finished")
    || trimmed.startsWith("> openwork")
    || trimmed.startsWith("$ ")
    || /^(?:\?\?|[ MADRCU!]{1,2})\s+\S/.test(trimmed)
    || /^(?:\.\.\/|\.\/|\/)[^\s]+/.test(trimmed)
  );
}

export function summarizeAutomationLog(raw: string, maxChars = 1600): string {
  const run = latestAutomationRunLog(raw);
  const finish = run.lastIndexOf("=== Finished");
  const body = finish >= 0 ? run.slice(0, finish) : run;
  const lines = body.split("\n");

  let jsonSummary = "";
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const text = textFromJsonEvent(JSON.parse(candidate));
      if (text) jsonSummary = text;
    } catch {
      // Mixed text/JSON logs are valid; fall through to the human-readable tail.
    }
  }
  if (jsonSummary) return jsonSummary.slice(-maxChars);

  while (lines.length > 0 && !lines.at(-1)?.trim()) lines.pop();
  const finalBlock: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      if (finalBlock.length > 0) break;
      continue;
    }
    if (!looksLikeLogNoise(line)) finalBlock.unshift(line.trimEnd());
    if (finalBlock.join("\n").length >= maxChars) break;
  }
  return finalBlock.join("\n").trim().slice(-maxChars);
}

export function registerAutomationRoutes(deps: AutomationRouteDependencies): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable, requireClientScope } = deps;

  addRoute(routes, "GET", "/automations", "client", async () => {
    return jsonResponse({ jobs: await listAutomations(config), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local" });
  });

  addRoute(routes, "GET", "/automations/:id/logs", "client", async (ctx) => {
    const identity = decodeAutomationId(ctx.params.id);
    const job = await readJob(identity.scopeId, identity.slug);
    let content = "";
    try {
      content = await readFile(logPath(job), "utf8");
    } catch {
      content = "";
    }
    const clean = stripAnsi(content);
    const lines = clean.split(/\r?\n/).slice(-linesParam(ctx)).join("\n");
    const sessionId = automationSessionIdFromLog(clean)
      ?? await findAutomationSessionIdFromAccountDb(job);
    const linkedJob = sessionId
      ? await persistAutomationSessionLink(job, {
          content: clean,
          modifiedAtMs: null,
        })
      : job;
    return jsonResponse({
      job: publicJob(config, linkedJob, sessionId),
      sessionId,
      summary: summarizeAutomationLog(clean),
      logs: lines,
      path: logPath(job),
    });
  });

  addRoute(routes, "POST", "/automations/:id/run", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const identity = decodeAutomationId(ctx.params.id);
    const job = await alignRuntimeConfig(config, await readJob(identity.scopeId, identity.slug));
    await triggerAutomation(job);
    return jsonResponse({ ok: true, job: publicJob(config, { ...job, lastRunStatus: "running", lastRunAt: new Date().toISOString() }) });
  });

  addRoute(routes, "POST", "/automations/:id/pause", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const identity = decodeAutomationId(ctx.params.id);
    const job = await readJob(identity.scopeId, identity.slug);
    await pauseSystemJob(job);
    const next = {
      ...job,
      wodeappx: { ...job.wodeappx, paused: true, pausedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await writeJob(next);
    return jsonResponse({ ok: true, job: publicJob(config, next) });
  });

  addRoute(routes, "POST", "/automations/:id/resume", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const identity = decodeAutomationId(ctx.params.id);
    const job = await alignRuntimeConfig(config, await readJob(identity.scopeId, identity.slug));
    await resumeSystemJob(job);
    const next = {
      ...job,
      wodeappx: { ...job.wodeappx, paused: false, resumedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await writeJob(next);
    return jsonResponse({ ok: true, job: publicJob(config, next) });
  });

  addRoute(routes, "POST", "/automations/:id/repair", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const identity = decodeAutomationId(ctx.params.id);
    const job = await alignRuntimeConfig(config, await readJob(identity.scopeId, identity.slug));
    return jsonResponse({ ok: true, job: publicJob(config, job) });
  });

  addRoute(routes, "DELETE", "/automations/:id", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const identity = decodeAutomationId(ctx.params.id);
    const job = await readJob(identity.scopeId, identity.slug);
    const body: Record<string, unknown> = await readJsonBody(ctx.request).catch(() => ({}));
    await removeSystemJob(job);
    if (body.includeHistory === true) {
      await rm(logPath(job), { force: true });
      await rm(join(schedulerPaths().scopesRoot, job.scopeId, "runs", `${job.slug}.jsonl`), { force: true });
      await rm(join(schedulerPaths().scopesRoot, job.scopeId, "locks", `${job.slug}.json`), { force: true });
    }
    return jsonResponse({ ok: true, id: ctx.params.id });
  });
}
