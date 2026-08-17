import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import {
  automationAccountRuntimeEnv,
  automationInvocationForWorkdir,
  automationRuntimeConfigForWorkdir,
  automationSessionIdFromLog,
  decodeAutomationId,
  ensureWodeAppxSchedulerSupervisor,
  findAutomationSessionIdFromAccountDb,
  nextCronOccurrence,
  summarizeAutomationLog,
} from "./automations.js";
import {
  WODEAPPX_SCHEDULER_SUPERVISOR_MARKER,
  WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT,
} from "../opencode-plugins/wodeappx-scheduler-supervisor.js";

describe("automation ids", () => {
  test("round-trips a scope and slug", () => {
    const id = Buffer.from("workspace-123456789abc\0nightly-maintenance", "utf8").toString("base64url");
    expect(decodeAutomationId(id)).toEqual({
      scopeId: "workspace-123456789abc",
      slug: "nightly-maintenance",
    });
  });

  test("rejects malformed or path-like identities", () => {
    for (const value of ["", "not-base64", Buffer.from("scope\0../job", "utf8").toString("base64url")]) {
      expect(() => decodeAutomationId(value)).toThrow("Invalid automation id");
    }
  });
});

describe("nextCronOccurrence", () => {
  test("returns the next minute for an every-minute schedule", () => {
    expect(nextCronOccurrence("* * * * *", new Date("2026-07-15T12:30:42.000Z")))
      .toBe("2026-07-15T12:31:00.000Z");
  });

  test("finds the next local 23:00 run", () => {
    const next = nextCronOccurrence("0 23 * * *", new Date());
    expect(next).not.toBeNull();
    const local = new Date(next!);
    expect(local.getHours()).toBe(23);
    expect(local.getMinutes()).toBe(0);
  });

  test("accepts Sunday as 7 and rejects unsupported cron text", () => {
    expect(nextCronOccurrence("0 9 * * 7", new Date())).not.toBeNull();
    expect(nextCronOccurrence("every day at nine", new Date())).toBeNull();
    expect(nextCronOccurrence("61 9 * * *", new Date())).toBeNull();
  });
});

describe("automation result summaries", () => {
  test("returns the final assistant block and removes terminal formatting", () => {
    const log = [
      "=== Scheduled run 2026-07-15T01:12:04+0800 runId=1 ===",
      "\u001b[0m$ git status\u001b[0m",
      "\t../../tmp/noisy-file.png",
      "",
      "完成：检查通过，没有修改文件。",
      "",
      "=== Finished 2026-07-15T01:12:40+0800 status=success exitCode=0 ===",
    ].join("\n");
    expect(summarizeAutomationLog(log)).toBe("完成：检查通过，没有修改文件。");
  });

  test("prefers the last structured text event", () => {
    const log = [
      JSON.stringify({ type: "text", part: { type: "text", text: "第一段" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: "最终摘要" } }),
    ].join("\n");
    expect(summarizeAutomationLog(log)).toBe("最终摘要");
  });

  test("turns a structured runtime error into a readable result", () => {
    const log = JSON.stringify({
      type: "error",
      error: { data: { message: "Unexpected server error." } },
    });
    expect(summarizeAutomationLog(log)).toBe("运行失败：Unexpected server error.");
  });

  test("finds the account-scoped conversation for the latest scheduled run", () => {
    const log = [
      "=== Scheduled run 2026-07-15T01:12:04+0800 runId=1 ===",
      JSON.stringify({ type: "text", sessionID: "ses_previous123", part: { text: "旧结果" } }),
      "=== Finished 2026-07-15T01:12:40+0800 status=success exitCode=0 ===",
      "=== Scheduled run 2026-07-16T01:12:04+0800 runId=2 ===",
      "{truncated tail",
      JSON.stringify({ type: "step_start", sessionID: "ses_latest456", part: { sessionID: "ses_latest456" } }),
    ].join("\n");
    expect(automationSessionIdFromLog(log)).toBe("ses_latest456");
  });

  test("recovers a legacy formatted run from the current account database", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-automation-session-"));
    const dbPath = join(root, "opencode.db");
    const database = new Database(dbPath);
    try {
      database.exec(`
        create table session (
          id text primary key,
          directory text not null,
          time_created integer not null
        )
      `);
      database.prepare(
        "insert into session (id, directory, time_created) values (?1, ?2, ?3)",
      ).run(
        "ses_legacyMatch123",
        "/tmp/wynne workspace",
        new Date("2026-07-29T18:07:15+08:00").getTime(),
      );
      expect(await findAutomationSessionIdFromAccountDb({
        workdir: "/tmp/wynne workspace",
        lastRunAt: "2026-07-29T18:07:14+08:00",
      }, dbPath)).toBe("ses_legacyMatch123");
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not guess when two legacy sessions are equally plausible", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-automation-session-"));
    const dbPath = join(root, "opencode.db");
    const database = new Database(dbPath);
    try {
      database.exec(`
        create table session (
          id text primary key,
          directory text not null,
          time_created integer not null
        )
      `);
      const insert = database.prepare(
        "insert into session (id, directory, time_created) values (?1, ?2, ?3)",
      );
      const startedAt = new Date("2026-07-29T18:07:14+08:00").getTime();
      insert.run("ses_candidateOne123", "/tmp/wynne workspace", startedAt + 1_000);
      insert.run("ses_candidateTwo456", "/tmp/wynne workspace", startedAt + 2_000);
      expect(await findAutomationSessionIdFromAccountDb({
        workdir: "/tmp/wynne workspace",
        lastRunAt: "2026-07-29T18:07:14+08:00",
      }, dbPath)).toBeNull();
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("automation background runtime", () => {
  test("pins OpenCode runs to the scheduled workspace and emits transcript events", () => {
    expect(automationInvocationForWorkdir({
      command: "/Applications/WodeAppX.app/Contents/Resources/sidecars/opencode",
      args: ["run", "--", "生成今日物料"],
    }, "/tmp/wynne workspace")).toEqual({
      command: "/Applications/WodeAppX.app/Contents/Resources/sidecars/opencode",
      args: ["run", "--dir", "/tmp/wynne workspace", "--format", "json", "--", "生成今日物料"],
    });
  });

  test("upgrades an existing default output format to JSON", () => {
    expect(automationInvocationForWorkdir({
      command: "opencode",
      args: ["run", "--format", "default", "--dir", "/tmp/existing", "--", "检查状态"],
    }, "/tmp/ignored")).toEqual({
      command: "opencode",
      args: ["run", "--format", "json", "--dir", "/tmp/existing", "--", "检查状态"],
    });
  });

  test("carries scheduler-isolated OpenCode runtime paths into scheduled runs", () => {
    expect(automationAccountRuntimeEnv({
      XDG_CONFIG_HOME: "/app/openwork-runtime-data/acct/xdg/config",
      XDG_DATA_HOME: "/app/openwork-runtime-data/acct/xdg/data",
      XDG_STATE_HOME: "/app/openwork-runtime-data/acct/xdg/state",
      XDG_CACHE_HOME: "  ",
      OPENCODE_CONFIG_DIR: "/app/openwork-runtime-data/acct/xdg/config/opencode",
      WODEAPP_API_KEY: "must-not-be-copied",
    })).toEqual([
      "XDG_CONFIG_HOME=/app/openwork-runtime-data/acct/scheduler-xdg/config",
      "XDG_DATA_HOME=/app/openwork-runtime-data/acct/scheduler-xdg/data",
      "XDG_STATE_HOME=/app/openwork-runtime-data/acct/scheduler-xdg/state",
      "OPENCODE_CONFIG_DIR=/app/openwork-runtime-data/acct/scheduler-xdg/config/opencode",
    ]);
  });

  test("leaves non-managed XDG paths unchanged when remapping for scheduler", () => {
    expect(automationAccountRuntimeEnv({
      XDG_DATA_HOME: "/tmp/custom-data",
      OPENCODE_CONFIG_DIR: "/tmp/custom-config",
    })).toEqual([
      "XDG_DATA_HOME=/tmp/custom-data",
      "OPENCODE_CONFIG_DIR=/tmp/custom-config",
    ]);
  });

  test("installs an auth-aware scheduler supervisor that resolves WODEAPP_API_KEY at run time", async () => {
    expect(WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT).toContain(WODEAPPX_SCHEDULER_SUPERVISOR_MARKER);
    expect(WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT).toContain("resolve_wodeapp_api_key");
    expect(WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT).toContain(".wodeapp/config.json");

    const home = await mkdtemp(join(tmpdir(), "wodeappx-scheduler-supervisor-"));
    try {
      const path = await ensureWodeAppxSchedulerSupervisor(home);
      expect(path).toBe(join(home, ".config", "opencode", "scheduler", "supervisor.pl"));
      const written = await Bun.file(path).text();
      expect(written).toBe(WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT);
      expect(written).toContain(WODEAPPX_SCHEDULER_SUPERVISOR_MARKER);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("keeps existing permissions and allows the scheduled workspace", () => {
    const config = automationRuntimeConfigForWorkdir(JSON.stringify({
      permission: {
        external_directory: {
          "/existing/*": "allow",
        },
      },
      plugin: ["example"],
    }), "/tmp/wynne workspace");
    expect(JSON.parse(config)).toEqual({
      permission: {
        external_directory: {
          "/existing/*": "allow",
          "/tmp/wynne workspace/*": "allow",
        },
      },
      plugin: ["example"],
    });
  });
});
