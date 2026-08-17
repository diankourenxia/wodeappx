import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const RUNTIME_GENERATION_ENV = "WODEAPPX_RUNTIME_GENERATION_ID";

export function createRuntimeGeneration({
  ownerKind = "desktop",
  program,
  cwd,
  scope = null,
  now = Date.now,
  id = randomUUID(),
  platform = process.platform,
} = {}) {
  return {
    generationId: id,
    ownerKind,
    supervisorPid: process.pid,
    rootPid: null,
    processGroupId: null,
    startedAt: now(),
    executablePath: String(program ?? ""),
    cwd: cwd ? String(cwd) : null,
    scope: scope ? String(scope) : null,
    platform,
  };
}

export function attachRuntimeGenerationProcess(generation, pid, platform = process.platform) {
  const rootPid = Number(pid);
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error("Managed runtime did not return a valid root PID");
  }
  generation.rootPid = rootPid;
  generation.processGroupId = platform === "win32" ? null : rootPid;
  return generation;
}

export function runtimeGenerationSpawnOptions(generation, options = {}, platform = process.platform) {
  return {
    ...options,
    detached: platform !== "win32",
    env: {
      ...(options.env ?? process.env),
      [RUNTIME_GENERATION_ENV]: generation.generationId,
    },
  };
}

export function runtimeGenerationSnapshot(generation) {
  if (!generation) return null;
  return {
    generationId: generation.generationId,
    ownerKind: generation.ownerKind,
    supervisorPid: generation.supervisorPid,
    rootPid: generation.rootPid,
    processGroupId: generation.processGroupId,
    startedAt: generation.startedAt,
    executablePath: generation.executablePath,
    cwd: generation.cwd,
    scope: generation.scope,
    platform: generation.platform,
  };
}

function signalTarget(killImpl, target, signal) {
  try {
    killImpl(target, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function targetExists(killImpl, target) {
  try {
    killImpl(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function terminateRuntimeGeneration(
  generation,
  {
    platform = process.platform,
    killImpl = process.kill.bind(process),
    spawnSyncImpl = spawnSync,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    termGraceMs = 750,
    killGraceMs = 500,
  } = {},
) {
  const rootPid = Number(generation?.rootPid);
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return { terminated: true, escalated: false };
  }

  if (platform === "win32") {
    spawnSyncImpl("taskkill", ["/PID", String(rootPid), "/T"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await wait(termGraceMs);
    const forced = spawnSyncImpl("taskkill", ["/PID", String(rootPid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return {
      terminated: forced.status === 0 || forced.status === 128,
      escalated: true,
    };
  }

  const processGroupId = Number(generation.processGroupId ?? rootPid);
  const target = -Math.abs(processGroupId);
  const signaled = signalTarget(killImpl, target, "SIGTERM");
  if (!signaled) return { terminated: true, escalated: false };
  await wait(termGraceMs);
  if (!targetExists(killImpl, target)) {
    return { terminated: true, escalated: false };
  }
  signalTarget(killImpl, target, "SIGKILL");
  await wait(killGraceMs);
  return {
    terminated: !targetExists(killImpl, target),
    escalated: true,
  };
}

function listGenerationGroupPids(generation, spawnSyncImpl) {
  const processGroupId = Number(generation?.processGroupId);
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return [];
  const result = spawnSyncImpl("ps", ["-Ao", "pid=,pgid="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const candidates = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((row) => row.trim().match(/^(\d+)\s+(\d+)$/))
    .filter(Boolean)
    .filter((match) => Number(match[2]) === processGroupId)
    .map((match) => Number(match[1]))
    .filter((pid) => pid > 0 && pid !== process.pid);

  return candidates.filter((pid) => {
    const command = spawnSyncImpl("ps", ["eww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return command.status === 0 &&
      String(command.stdout ?? "").includes(`${RUNTIME_GENERATION_ENV}=${generation.generationId}`);
  });
}

export async function terminatePersistedRuntimeGeneration(
  generation,
  {
    platform = process.platform,
    killImpl = process.kill.bind(process),
    spawnSyncImpl = spawnSync,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    termGraceMs = 750,
    killGraceMs = 500,
  } = {},
) {
  const supervisorPid = Number(generation?.supervisorPid);
  if (Number.isInteger(supervisorPid) && supervisorPid > 0 && supervisorPid !== process.pid) {
    try {
      killImpl(supervisorPid, 0);
      return { terminated: false, escalated: false, remainingPids: [], reason: "supervisor_alive" };
    } catch (error) {
      if (error?.code !== "ESRCH") {
        return { terminated: false, escalated: false, remainingPids: [], reason: "supervisor_unverifiable" };
      }
    }
  }
  if (platform === "win32") {
    // A stale Windows PID cannot be associated with an inherited environment
    // marker safely. Current generations still use taskkill /T in
    // terminateRuntimeGeneration; stale records remain for diagnostics.
    return { terminated: false, escalated: false, remainingPids: [], reason: "ownership_unverifiable" };
  }

  const ownedPids = listGenerationGroupPids(generation, spawnSyncImpl);
  for (const pid of ownedPids) signalTarget(killImpl, pid, "SIGTERM");
  if (ownedPids.length > 0) await wait(termGraceMs);
  let remainingPids = listGenerationGroupPids(generation, spawnSyncImpl);
  for (const pid of remainingPids) signalTarget(killImpl, pid, "SIGKILL");
  if (remainingPids.length > 0) await wait(killGraceMs);
  remainingPids = listGenerationGroupPids(generation, spawnSyncImpl);
  return {
    terminated: remainingPids.length === 0,
    escalated: ownedPids.length > 0 && remainingPids.length > 0,
    remainingPids,
  };
}
