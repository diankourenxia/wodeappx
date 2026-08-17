#!/usr/bin/env node
/**
 * Watch the latest WodeAppX Release workflow run. On failure, print the Error
 * lines and exit non-zero so an agent can fix + retag.
 *
 * Usage:
 *   node scripts/watch-wodeappx-release.mjs
 *   node scripts/watch-wodeappx-release.mjs --run 30000085546
 *   node scripts/watch-wodeappx-release.mjs --tag wodeappx-v0.17.12
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function flagValue(name) {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function gh(ghArgs) {
  const result = spawnSync("gh", ghArgs, { encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

const explicitRun = flagValue("--run");
const tag = flagValue("--tag");
const pollMs = Number(flagValue("--poll-ms") || 20000);

let runId = explicitRun;
if (!runId) {
  const listArgs = ["run", "list", "--workflow=wodeappx-release.yml", "--limit", "5", "--json", "databaseId,status,conclusion,headBranch,displayTitle,url,createdAt"];
  const listed = gh(listArgs);
  if (listed.status !== 0) {
    console.error(listed.stderr || listed.stdout);
    process.exit(1);
  }
  const rows = JSON.parse(listed.stdout);
  const match = tag
    ? rows.find((row) => row.headBranch === tag)
    : rows[0];
  if (!match) {
    console.error(tag ? `No run found for tag ${tag}` : "No wodeappx-release runs found");
    process.exit(1);
  }
  runId = String(match.databaseId);
  console.log(`watching ${match.displayTitle} (${match.headBranch}) ${match.url}`);
}

while (true) {
  const view = gh(["run", "view", runId, "--json", "status,conclusion,url,jobs,displayTitle"]);
  if (view.status !== 0) {
    console.error(view.stderr || view.stdout);
    process.exit(1);
  }
  const data = JSON.parse(view.stdout);
  const jobs = (data.jobs || []).map((j) => `${j.name}:${j.status}/${j.conclusion || "-"}`).join(" | ");
  console.log(`[${new Date().toISOString()}] ${data.status} ${data.conclusion || ""} :: ${jobs}`);

  if (data.status === "completed") {
    if (data.conclusion === "success") {
      console.log(`OK ${data.url}`);
      process.exit(0);
    }
    console.error(`FAILED (${data.conclusion}) ${data.url}`);
    const failed = gh(["run", "view", runId, "--log-failed"]);
    const lines = String(failed.stdout || failed.stderr || "")
      .split(/\r?\n/)
      .filter((line) => /Error:|anchor not found|ENOENT|AssertionError|Unexpected |ELIFECYCLE|##\[error\]/.test(line))
      .slice(-40);
    for (const line of lines) console.error(line);
    console.error("\nNext: fix the printed error locally, then:");
    console.error("  cd wodeappx && pnpm release:preflight");
    console.error("  # commit, push, retag: git tag -f wodeappx-vX.Y.Z && git push origin wodeappx-vX.Y.Z --force");
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, pollMs));
}
