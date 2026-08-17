/**
 * Bash background detach (ses_03523d86 / MEMORY 2026-07-29).
 *
 * OpenCode shell waits on process-group exit and on timeout kills the group,
 * so `nohup … &; sleep; curl` can burn the full 120s timeout and SIGHUP the
 * background server after curl already printed 200.
 *
 * Rewrite rules (POSIX only; Windows unchanged):
 * - Pure background (command ends with `&`): start via setsid, print BG_PID, exit.
 * - Mixed (nohup/&/disown plus foreground tail): `set +m` + `nohup` → `setsid nohup`
 *   so the long-lived child leaves the tool shell's process group.
 */

export type BashBackgroundMode = "none" | "pure" | "mixed"

export type BashBackgroundRewrite = {
  command: string
  rewritten: boolean
  mode: BashBackgroundMode
}

export function bashBackgroundDetachEnabled() {
  const raw = process.env.WODEAPPX_BASH_BG_DETACH?.trim()
  if (!raw) return true
  return !/^(0|false|off|no)$/i.test(raw)
}

/** Strip `2>&1` / `>&1` / `&>` so redirect ampersands are not treated as job control. */
export function stripRedirectAmpersands(command: string) {
  return command
    .replace(/\d*>&\d+/g, " ")
    .replace(/&>/g, " ")
}

export function hasStandaloneBackgroundAmp(command: string) {
  const stripped = stripRedirectAmpersands(command)
  // Job-control `&`: not `&&`, not leftover from redirects.
  return /(?:^|[^&])&(?!&)/.test(stripped)
}

export function hasBashBackgroundIntent(command: string) {
  if (!command || typeof command !== "string") return false
  if (/\b(?:nohup|disown|setsid)\b/.test(command)) return true
  return hasStandaloneBackgroundAmp(command)
}

export function isPureBackgroundLaunch(command: string) {
  const trimmed = command.trim()
  if (!trimmed.endsWith("&")) return false
  if (trimmed.endsWith("&&")) return false
  const withoutAmp = trimmed.replace(/&\s*$/, "").trimEnd()
  if (withoutAmp.endsWith("&")) return false
  // Pure = trailing `&` and no foreground statement after any earlier `&`…
  // Simpler: only one job-control `&` (the trailing one) after stripping redirects.
  const stripped = stripRedirectAmpersands(withoutAmp)
  return !/(?:^|[^&])&(?!&)/.test(stripped)
}

function hasStdoutRedirect(command: string) {
  return /(?:^|[\s;])\d?>|>>|&>/.test(command) || /\d>&\d/.test(command)
}

function stripLeadingSetsid(command: string) {
  return command.replace(/^\s*setsid\s+/i, "")
}

function ensureSetsIdBeforeNohup(command: string) {
  return command.replace(/(^|[\n;|&]\s*)nohup\b/g, (full, prefix: string) => {
    // Avoid `setsid setsid nohup` if user already wrote setsid nohup
    if (/setsid\s+$/i.test(prefix)) return full
    return `${prefix}setsid nohup`
  })
}

/**
 * Rewrite a bash command so background work does not pin the tool shell.
 * No-op on Windows or when WODEAPPX_BASH_BG_DETACH=0.
 */
export function rewriteBashCommandForBackgroundDetach(command: string): BashBackgroundRewrite {
  if (process.platform === "win32" || !bashBackgroundDetachEnabled()) {
    return { command, rewritten: false, mode: "none" }
  }
  if (!hasBashBackgroundIntent(command)) {
    return { command, rewritten: false, mode: "none" }
  }

  const trimmed = command.trim()
  if (isPureBackgroundLaunch(trimmed)) {
    const body = stripLeadingSetsid(trimmed.replace(/&\s*$/, "").trim())
    const withIo = hasStdoutRedirect(body)
      ? body
      : `${body} >/tmp/wodeappx-bash-bg-$$.log 2>&1`
    const next = [
      "set +m",
      `setsid ${withIo} </dev/null &`,
      'echo "BG_PID:$!"',
    ].join("\n")
    return { command: next, rewritten: true, mode: "pure" }
  }

  let next = trimmed
  if (!/^\s*set\s+\+m\b/m.test(next)) {
    next = `set +m\n${next}`
  }
  next = ensureSetsIdBeforeNohup(next)
  const rewritten = next !== command.trim() && next !== command
  // Still mark rewritten when we only normalized whitespace via trim+prefix
  return {
    command: next,
    rewritten: rewritten || next !== command,
    mode: "mixed",
  }
}

export function rewriteBashToolArgs(rawArgs: unknown): { args: unknown; rewrite: BashBackgroundRewrite } {
  const args = rawArgs && typeof rawArgs === "object" ? { ...(rawArgs as Record<string, unknown>) } : rawArgs
  if (!args || typeof args !== "object") {
    return {
      args: rawArgs,
      rewrite: { command: "", rewritten: false, mode: "none" },
    }
  }
  const command = typeof (args as { command?: unknown }).command === "string"
    ? (args as { command: string }).command
    : ""
  const rewrite = rewriteBashCommandForBackgroundDetach(command)
  if (!rewrite.rewritten) {
    return { args: rawArgs, rewrite }
  }
  return {
    args: { ...(args as Record<string, unknown>), command: rewrite.command },
    rewrite,
  }
}
