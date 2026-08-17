import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolItemFailure, parseToolItemFailureTag } from "./openwork-tool-result.js";
import {
  findSchedulerJobMatches,
  resolveSchedulerToolDirectory,
  schedulerCommandValidationError,
  schedulerPluginEntry,
  schedulerPromptValidationError,
  schedulerToolArgs,
  wrapSchedulerTool,
} from "./wodeappx-scheduler.js";

const temporaryHomes: string[] = [];

function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "wodeappx-scheduler-"));
  temporaryHomes.push(home);
  return home;
}

function writeJob(home: string, scopeId: string, job: Record<string, unknown>) {
  const directory = join(home, ".config", "opencode", "scheduler", "scopes", scopeId, "jobs");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${job.slug}.json`), JSON.stringify({ scopeId, ...job }), "utf8");
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("scheduler tool bridge", () => {
  test("resolves the scheduler runtime beside a packaged plugin", () => {
    const root = temporaryHome();
    const pluginDirectory = join(root, "Resources", "opencode-plugins");
    const entry = join(pluginDirectory, "node_modules", "opencode-scheduler", "dist", "index.js");
    mkdirSync(join(pluginDirectory, "node_modules", "opencode-scheduler", "dist"), { recursive: true });
    writeFileSync(entry, "export default async () => ({})", "utf8");

    expect(schedulerPluginEntry(pluginDirectory)).toBe(entry);
  });

  test("resolves the scheduler runtime from the managed source layout", () => {
    const root = temporaryHome();
    const openworkRoot = join(root, "openwork");
    const pluginDirectory = join(openworkRoot, "apps", "server", "src", "opencode-plugins");
    const entry = join(openworkRoot, ".opencode", "node_modules", "opencode-scheduler", "dist", "index.js");
    mkdirSync(join(openworkRoot, ".opencode", "node_modules", "opencode-scheduler", "dist"), { recursive: true });
    writeFileSync(entry, "export default async () => ({})", "utf8");

    expect(schedulerPluginEntry(pluginDirectory)).toBe(entry);
  });

  test("defaults creation and global listing to the real tool context", () => {
    expect(schedulerToolArgs("schedule_job", { name: "nightly" }, "/workspace/app"))
      .toEqual({ name: "nightly", workdir: "/workspace/app" });
    expect(schedulerToolArgs("list_jobs", {}, "/workspace/app"))
      .toEqual({ allScopes: true, scopeRoot: "/workspace/app" });
  });

  test("finds a job outside the server process directory", () => {
    const home = temporaryHome();
    writeJob(home, "app-123", {
      slug: "daily-readonly-check",
      name: "daily readonly check",
      workdir: "/workspace/app",
    });
    expect(findSchedulerJobMatches("daily-readonly-check", home)).toHaveLength(1);
    expect(resolveSchedulerToolDirectory("daily-readonly-check", "/server/process", undefined, home))
      .toMatchObject({ directory: "/workspace/app", ambiguous: false });
  });

  test("treats missing or non-string job identities as no match", () => {
    const home = temporaryHome();
    writeJob(home, "app-123", {
      slug: "daily-readonly-check",
      name: "daily readonly check",
      workdir: "/workspace/app",
    });

    expect(findSchedulerJobMatches(undefined, home)).toEqual([]);
    expect(findSchedulerJobMatches({ name: "daily-readonly-check" }, home)).toEqual([]);
    expect(resolveSchedulerToolDirectory(undefined, "/server/process", undefined, home))
      .toMatchObject({ directory: "/server/process", ambiguous: false });
  });

  test("requires scopeRoot when the same name exists in multiple workspaces", () => {
    const home = temporaryHome();
    writeJob(home, "app-a", { slug: "nightly", name: "nightly", workdir: "/workspace/a" });
    writeJob(home, "app-b", { slug: "nightly", name: "nightly", workdir: "/workspace/b" });
    expect(resolveSchedulerToolDirectory("nightly", "/server/process", undefined, home).ambiguous).toBe(true);
    expect(resolveSchedulerToolDirectory("nightly", "/server/process", "/workspace/b", home))
      .toMatchObject({ directory: "/workspace/b", ambiguous: false });
  });

  test("rejects shell executables in the OpenCode command field", () => {
    expect(schedulerCommandValidationError("bash")).toContain("prompt");
    expect(schedulerCommandValidationError("/bin/zsh -lc")).toContain("zsh");
    expect(schedulerCommandValidationError("review-changes")).toBeNull();
  });

  test("rejects broad staging and ambiguous document deletion", () => {
    expect(schedulerPromptValidationError(
      "先检查 git status，然后运行 git add .，提交并推送；保留用户原有改动，禁止 force push。",
    )).toContain("所有改动");
    expect(schedulerPromptValidationError(
      "每天查看代码，将所有相关改动暂存、提交并推送；识别并删除过时、无用的文档。",
    )).toContain("所有改动");
    expect(schedulerPromptValidationError(
      "每天检查 git status，只提交本任务产生的文件，保留用户原有改动，禁止 force push，并删除过时文档。",
    )).toContain("目录与期限");
  });

  test("accepts a scoped code and document maintenance prompt", () => {
    expect(schedulerPromptValidationError(
      "先检查 git status，只提交本任务产生且确认的文件，保留用户原有改动，禁止 force push；只删除 docs/archive 下超过 90 天的文档。",
    )).toBeNull();
    expect(schedulerPromptValidationError(
      "先检查 git status，不要使用 git add .，禁止暂存或提交所有改动；只提交确认的文件并保留用户原有改动，禁止 force push；仅报告疑似过时文档，不自动删除。",
    )).toBeNull();
    expect(schedulerPromptValidationError("读取状态并生成一份日报，不修改文件。")).toBeNull();
  });

  test("wrapped schedule_job throws recoverable Item failure for shell command misuse", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const tool = wrapSchedulerTool("schedule_job", {
      description: "fake",
      args: {},
      async execute() {
        return "should-not-run";
      },
    });

    let failure: unknown;
    try {
      await tool.execute({
        name: "nightly",
        command: "bash",
        prompt: "先检查 git status，只提交本任务产生且确认的文件，保留用户原有改动，禁止 force push。",
      }, {
        directory: "/workspace/app",
        metadata(input: { title?: string; metadata?: Record<string, unknown> }) {
          writes.push(input as Record<string, unknown>);
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ToolItemFailure);
    expect(failure).toMatchObject({
      recoverable: true,
      errorKind: "validation",
    });
    expect(parseToolItemFailureTag((failure as ToolItemFailure).message)).toEqual({
      recoverable: true,
      errorKind: "validation",
    });
    expect(writes[0]?.metadata).toMatchObject({
      wodeappxFailure: {
        status: "failed",
        recoverable: true,
        errorKind: "validation",
      },
    });
  });

  test("wrapped get_job throws recoverable ambiguous failure without scopeRoot", async () => {
    const home = temporaryHome();
    writeJob(home, "app-a", { slug: "nightly", name: "nightly", workdir: "/workspace/a" });
    writeJob(home, "app-b", { slug: "nightly", name: "nightly", workdir: "/workspace/b" });
    const previousHome = process.env.WODEAPPX_SCHEDULER_HOME;
    process.env.WODEAPPX_SCHEDULER_HOME = home;

    const writes: Array<Record<string, unknown>> = [];
    const tool = wrapSchedulerTool("get_job", {
      description: "fake",
      args: {},
      async execute() {
        return "should-not-run";
      },
    });

    try {
      await expect(tool.execute({ name: "nightly" }, {
        directory: "/server/process",
        metadata(input: { title?: string; metadata?: Record<string, unknown> }) {
          writes.push(input as Record<string, unknown>);
        },
      })).rejects.toMatchObject({
        name: "ToolItemFailure",
        recoverable: true,
        errorKind: "ambiguous",
      });
      expect(writes[0]?.metadata).toMatchObject({
        wodeappxFailure: {
          status: "failed",
          recoverable: true,
          errorKind: "ambiguous",
        },
      });
    } finally {
      if (previousHome === undefined) delete process.env.WODEAPPX_SCHEDULER_HOME;
      else process.env.WODEAPPX_SCHEDULER_HOME = previousHome;
    }
  });
});
