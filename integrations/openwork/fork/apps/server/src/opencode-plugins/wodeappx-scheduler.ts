import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createToolItemFailure,
  executeWithContract,
} from "./openwork-tool-result.js";

type SchedulerToolContext = {
  directory: string;
  [key: string]: unknown;
};

type SchedulerToolResult = string | {
  title?: string;
  output: string;
  metadata?: Record<string, unknown>;
  attachments?: unknown[];
};

type SchedulerTool = {
  description: string;
  args: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: SchedulerToolContext) => Promise<SchedulerToolResult>;
};

// Lazy-load so canonical fork unit tests can exercise wrapSchedulerTool without
// requiring the managed OpenCode vendor layout's opencode-scheduler install.
type SchedulerPluginFactory = (
  input: unknown,
  options?: unknown,
) => Promise<{ tool?: Record<string, SchedulerTool>; [key: string]: unknown }>;

const SCHEDULER_PACKAGE_ENTRY = ["opencode-scheduler", "dist", "index.js"];

/**
 * The bundled wrapper lives in Resources/opencode-plugins, while source builds
 * live under apps/server/src/opencode-plugins. Resolve both layouts explicitly
 * so packaging cannot silently point the dynamic import at /Applications.
 */
export function schedulerPluginEntry(
  pluginDirectory = dirname(fileURLToPath(import.meta.url)),
): string {
  const candidates = [
    join(pluginDirectory, "node_modules", ...SCHEDULER_PACKAGE_ENTRY),
    join(pluginDirectory, "..", "..", "..", "..", ".opencode", "node_modules", ...SCHEDULER_PACKAGE_ENTRY),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (entry) return entry;
  throw new Error(`找不到 opencode-scheduler 运行时。已检查：${candidates.join("、")}`);
}

async function loadSchedulerPlugin(): Promise<SchedulerPluginFactory> {
  const mod = await import(pathToFileURL(schedulerPluginEntry()).href);
  return (mod as unknown as { default: SchedulerPluginFactory }).default;
}

type SchedulerJobMatch = {
  scopeId: string;
  slug: string;
  name: string;
  workdir: string;
};

type SchedulerDirectoryResolution = {
  directory: string;
  ambiguous: boolean;
  matches: SchedulerJobMatch[];
};

const IDENTITY_TOOLS = new Set(["get_job", "update_job", "delete_job", "run_job", "job_logs"]);
const SAFE_PART = /^[A-Za-z0-9._-]+$/;
const SHELL_EXECUTABLES = new Set([
  "bash", "sh", "zsh", "fish", "node", "bun", "deno", "python", "python3", "ruby", "perl", "pwsh", "powershell",
]);

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function schedulerScopesRoot(home: string): string {
  return join(home, ".config", "opencode", "scheduler", "scopes");
}

function readSchedulerJobMatches(home: string): SchedulerJobMatch[] {
  const scopesRoot = schedulerScopesRoot(home);
  if (!existsSync(scopesRoot)) return [];
  const matches: SchedulerJobMatch[] = [];
  let scopeIds: string[] = [];
  try {
    scopeIds = readdirSync(scopesRoot);
  } catch {
    return [];
  }
  for (const scopeId of scopeIds) {
    if (!SAFE_PART.test(scopeId)) continue;
    const jobsRoot = join(scopesRoot, scopeId, "jobs");
    if (!existsSync(jobsRoot)) continue;
    let filenames: string[] = [];
    try {
      filenames = readdirSync(jobsRoot);
    } catch {
      continue;
    }
    for (const filename of filenames) {
      if (!filename.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(jobsRoot, filename), "utf8")) as Record<string, unknown>;
        const slug = typeof parsed.slug === "string" ? parsed.slug.trim() : filename.slice(0, -5);
        const name = typeof parsed.name === "string" ? parsed.name.trim() : slug;
        const workdir = typeof parsed.workdir === "string" ? parsed.workdir.trim() : "";
        if (!slug || !name || !workdir || !SAFE_PART.test(slug)) continue;
        matches.push({ scopeId, slug, name, workdir: resolve(workdir) });
      } catch {
        // A malformed job must not prevent healthy tasks from being resolved.
      }
    }
  }
  return matches;
}

function resolveSchedulerHome(home = process.env.WODEAPPX_SCHEDULER_HOME || process.env.HOME || homedir()): string {
  return home;
}

export function findSchedulerJobMatches(name: unknown, home = resolveSchedulerHome()): SchedulerJobMatch[] {
  const query = typeof name === "string" ? name.trim() : "";
  if (!query) return [];
  const queryLower = query.toLowerCase();
  const querySlug = slugify(query);
  const jobs = readSchedulerJobMatches(home);
  const exact = jobs.filter((job) => (
    job.slug === query
    || job.slug === querySlug
    || job.name.toLowerCase() === queryLower
  ));
  if (exact.length > 0) return exact;
  return jobs.filter((job) => (
    job.slug.endsWith(`-${querySlug}`)
    || job.name.toLowerCase().includes(queryLower)
  ));
}

export function resolveSchedulerToolDirectory(
  name: unknown,
  contextDirectory: string,
  scopeRoot?: string,
  home = resolveSchedulerHome(),
): SchedulerDirectoryResolution {
  const context = resolve(contextDirectory);
  if (scopeRoot?.trim()) {
    return { directory: resolve(scopeRoot), ambiguous: false, matches: [] };
  }
  const matches = findSchedulerJobMatches(name, home);
  const current = matches.find((job) => job.workdir === context);
  if (current) return { directory: current.workdir, ambiguous: false, matches };
  if (matches.length === 1) return { directory: matches[0]!.workdir, ambiguous: false, matches };
  return { directory: context, ambiguous: matches.length > 1, matches };
}

export function schedulerToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  contextDirectory: string,
): Record<string, unknown> {
  if (toolName === "schedule_job") {
    const requested = typeof args.workdir === "string" ? args.workdir.trim() : "";
    return { ...args, workdir: requested || contextDirectory };
  }
  if (toolName === "list_jobs") {
    const scopeRoot = typeof args.scopeRoot === "string" ? args.scopeRoot.trim() : "";
    return {
      ...args,
      allScopes: args.allScopes === undefined ? true : args.allScopes,
      scopeRoot: scopeRoot || contextDirectory,
    };
  }
  return args;
}

export function schedulerCommandValidationError(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const executable = command.trim().split(/\s+/)[0]?.split(/[\\/]/).at(-1)?.toLowerCase() || "";
  if (!SHELL_EXECUTABLES.has(executable)) return null;
  return `自动任务的 command 字段只接受 OpenCode 斜杠命令，不能填写 ${executable}。请把完整任务说明放进 prompt 字段后重试。`;
}

export function schedulerPromptValidationError(prompt: unknown): string | null {
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  const text = prompt.replace(/\s+/g, " ").trim();
  const hasUnnegatedMatch = (pattern: RegExp): boolean => {
    const matches = text.matchAll(new RegExp(pattern.source, `${pattern.flags.replaceAll("g", "")}g`));
    for (const match of matches) {
      const prefix = text.slice(Math.max(0, (match.index ?? 0) - 14), match.index);
      if (!/(?:禁止|不得|不要|不可|不能|避免|严禁|不使用).{0,12}$/i.test(prefix)) return true;
    }
    return false;
  };

  const stagesEverything = [
    /git\s+add\s+(?:\.|-A|--all)(?=[\s"'`,，。；;]|$)/i,
    /(?:暂存|提交).{0,8}所有(?:相关)?改动/,
    /所有(?:相关)?改动.{0,8}(?:暂存|提交)/,
    /(?:全量|全部)(?:暂存|提交)/,
  ].some(hasUnnegatedMatch);
  if (stagesEverything) {
    return "自动任务不能暂存或提交工作区的所有改动。请只处理本任务产生且已确认的文件，并明确保留用户的无关改动。";
  }

  const mutatesGit = /(?:git\s+(?:add|commit|push)\b|暂存.{0,8}(?:代码|改动|文件)|提交.{0,8}(?:代码|改动)|推送.{0,8}(?:代码|提交|分支))/i.test(text);
  if (mutatesGit) {
    const inspectsStatus = /git\s+status|检查.{0,8}(?:工作区|代码|文件).{0,8}(?:状态|改动)/i.test(text);
    const preservesUnrelated = /(?:保留|不(?:要|得|会)?提交|排除).{0,12}(?:无关|用户(?:已有|原有)|未授权).{0,8}(?:改动|文件)|(?:无关|用户(?:已有|原有)|未授权).{0,8}(?:改动|文件).{0,8}(?:保留|不提交)/i.test(text);
    if (!inspectsStatus || !preservesUnrelated) {
      return "代码类自动任务必须先检查 git status，只提交本任务产生且已确认的文件，并明确保留用户的无关改动。";
    }
    const pushes = /git\s+push\b|推送.{0,8}(?:代码|提交|分支)/i.test(text);
    const forbidsForcePush = /(?:禁止|不得|不要|不使用).{0,10}(?:force|强制推送|--force|-f\b)/i.test(text);
    if (pushes && !forbidsForcePush) {
      return "包含推送的自动任务必须明确禁止 force push；请补充安全规则后重试。";
    }
  }

  const reportsDocumentsWithoutDeletion = /(?:仅|只).{0,12}(?:报告|列出).{0,18}(?:不|禁止|不得|不要).{0,6}(?:自动)?(?:删除|移除|移动)|(?:不|禁止|不得|不要).{0,6}(?:自动)?(?:删除|移除|移动).{0,18}(?:仅|只).{0,12}(?:报告|列出)/i.test(text);
  const deletesDocuments = !reportsDocumentsWithoutDeletion
    && /(?:删除|移除|清理).{0,16}(?:文档|documentation|docs?\b)|(?:文档|documentation|docs?\b).{0,16}(?:删除|移除|清理)/i.test(text);
  if (deletesDocuments) {
    const hasDocumentPath = /(?:^|[\s"'`(])(?:\.{0,2}[\\/])?(?:docs?|documentation)(?:[\\/][\w.*-]+)+(?:[\s"'`),]|$)/i.test(text);
    const hasAgeRule = /(?:超过|早于|至少|保留).{0,8}\d+\s*(?:天|日|周|个月|月|年)|\d+\s*(?:天|日|周|个月|月|年).{0,8}(?:以上|以前|之前)/i.test(text);
    const namesExactMarkdownFiles = /(?:^|[\s"'`(])(?:\.{0,2}[\\/])?[\w./-]+\.md(?:[\s"'`),]|$)/i.test(text);
    if (!(hasDocumentPath && hasAgeRule) && !namesExactMarkdownFiles) {
      return "文档删除规则不明确。请先让用户确认具体目录与期限（例如 docs/archive 下超过 90 天），或明确列出要删除的 Markdown 文件；确认前不要创建任务。";
    }
  }

  return null;
}

let schedulerCwdQueue: Promise<unknown> = Promise.resolve();

function withSchedulerDirectory<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const run = schedulerCwdQueue.then(async () => {
    const previous = process.cwd();
    process.chdir(directory);
    try {
      return await operation();
    } finally {
      process.chdir(previous);
    }
  });
  schedulerCwdQueue = run.then(() => undefined, () => undefined);
  return run;
}

function throwAmbiguousJob(matches: SchedulerJobMatch[]): never {
  const message = `发现多个工作区存在同名自动任务，请提供 scopeRoot 后重试：${matches.map((job) => job.workdir).join("、")}`;
  throw createToolItemFailure({
    message,
    recoverable: true,
    errorKind: "ambiguous",
    data: { matches },
  });
}

function throwValidationError(output: string): never {
  throw createToolItemFailure({
    message: output,
    recoverable: true,
    errorKind: "validation",
  });
}

export function wrapSchedulerTool(toolName: string, definition: SchedulerTool): SchedulerTool {
  const execute = definition.execute.bind(definition);
  definition.execute = async (rawArgs, context) => {
      return executeWithContract(async (args, toolContext) => {
        const prepared = schedulerToolArgs(toolName, args, toolContext.directory);
        if (toolName === "schedule_job" || toolName === "update_job") {
          const commandError = schedulerCommandValidationError(prepared.command);
          if (commandError) throwValidationError(commandError);
          const promptError = schedulerPromptValidationError(prepared.prompt);
          if (promptError) throwValidationError(promptError);
        }
        let directory = toolContext.directory;
        if (toolName === "schedule_job") {
          directory = String(prepared.workdir || toolContext.directory);
        } else if (IDENTITY_TOOLS.has(toolName)) {
          const name = typeof prepared.name === "string" ? prepared.name : "";
          const scopeRoot = typeof prepared.scopeRoot === "string" ? prepared.scopeRoot : undefined;
          const resolution = resolveSchedulerToolDirectory(name, toolContext.directory, scopeRoot);
          if (resolution.ambiguous) throwAmbiguousJob(resolution.matches);
          directory = resolution.directory;
        }
        return withSchedulerDirectory(resolve(directory), () => execute(prepared, toolContext));
      }, rawArgs, context, `Scheduler tool ${toolName} failed.`);
  };
  return definition;
}

export const WodeAppXSchedulerPlugin = async (
  input: unknown,
  options?: unknown,
) => {
  const SchedulerPlugin = await loadSchedulerPlugin();
  // OpenCode attaches non-public metadata to scheduler tool definitions.
  // Replacing their execute functions makes the loader lose the originating
  // path and reject the entire plugin. Keep the production bridge transparent;
  // WodeAppX applies workspace/runtime alignment through its automation API.
  return SchedulerPlugin(input, options);
};

export default WodeAppXSchedulerPlugin;
