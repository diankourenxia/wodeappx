import { describe, expect, test } from "bun:test"
import {
  hasBashBackgroundIntent,
  hasStandaloneBackgroundAmp,
  isPureBackgroundLaunch,
  rewriteBashCommandForBackgroundDetach,
  rewriteBashToolArgs,
  stripRedirectAmpersands,
} from "./bash-background-detach"

describe("bash-background-detach", () => {
  test("stripRedirectAmpersands removes 2>&1 / &> so they are not job-control", () => {
    expect(stripRedirectAmpersands("cmd 2>&1").includes("&")).toBe(false)
    expect(stripRedirectAmpersands("cmd &>log").includes("&")).toBe(false)
    expect(hasStandaloneBackgroundAmp("sleep 9 &")).toBe(true)
    expect(hasStandaloneBackgroundAmp("curl x 2>&1")).toBe(false)
  })

  test("detects nohup / disown / trailing &", () => {
    expect(hasBashBackgroundIntent("echo hi")).toBe(false)
    expect(hasBashBackgroundIntent("nohup node server.js &")).toBe(true)
    expect(hasBashBackgroundIntent("sleep 1 & disown")).toBe(true)
    expect(hasBashBackgroundIntent("setsid myserver &")).toBe(true)
    expect(hasBashBackgroundIntent("sleep 30 &")).toBe(true)
    expect(hasBashBackgroundIntent("curl http://x 2>&1")).toBe(false)
  })

  test("pure vs mixed background", () => {
    expect(isPureBackgroundLaunch("nohup node app.js >/tmp/a.log 2>&1 &")).toBe(true)
    expect(
      isPureBackgroundLaunch("nohup node app.js >/tmp/a.log 2>&1 &\nsleep 2; curl http://127.0.0.1/setup"),
    ).toBe(false)
    expect(isPureBackgroundLaunch("echo hi")).toBe(false)
  })

  test("pure background rewrites to setsid + BG_PID and returns immediately shape", () => {
    const prev = process.env.WODEAPPX_BASH_BG_DETACH
    delete process.env.WODEAPPX_BASH_BG_DETACH
    try {
      if (process.platform === "win32") return
      const out = rewriteBashCommandForBackgroundDetach("nohup node server.js &")
      expect(out.mode).toBe("pure")
      expect(out.rewritten).toBe(true)
      expect(out.command).toMatch(/^set \+m\n/)
      expect(out.command).toMatch(/setsid /)
      expect(out.command).toMatch(/BG_PID:\$!/)
      expect(out.command).toMatch(/<\/dev\/null &/)
      expect(out.command).toMatch(/wodeappx-bash-bg-\$\$\.log/)
    } finally {
      if (prev === undefined) delete process.env.WODEAPPX_BASH_BG_DETACH
      else process.env.WODEAPPX_BASH_BG_DETACH = prev
    }
  })

  test("ses_03523d86 mixed nohup+curl: set +m and setsid nohup", () => {
    if (process.platform === "win32") return
    const cmd = [
      "cd /tmp && nohup node --input-type=module --eval 'setInterval(()=>{},6e4)' > /tmp/preview.log 2>&1 &",
      "sleep 2; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:17655/setup",
    ].join("\n")
    const out = rewriteBashCommandForBackgroundDetach(cmd)
    expect(out.mode).toBe("mixed")
    expect(out.rewritten).toBe(true)
    expect(out.command).toMatch(/^set \+m\n/)
    expect(out.command).toContain("setsid nohup")
    expect(out.command).not.toMatch(/setsid setsid/)
    expect(out.command).toContain("curl")
  })

  test("does not double-prefix setsid nohup", () => {
    if (process.platform === "win32") return
    const out = rewriteBashCommandForBackgroundDetach("setsid nohup sleep 9 >/tmp/x.log 2>&1 &\ntrue")
    expect(out.mode).toBe("mixed")
    expect((out.command.match(/setsid nohup/g) || []).length).toBe(1)
  })

  test("WODEAPPX_BASH_BG_DETACH=0 disables rewrite", () => {
    const prev = process.env.WODEAPPX_BASH_BG_DETACH
    process.env.WODEAPPX_BASH_BG_DETACH = "0"
    try {
      const out = rewriteBashCommandForBackgroundDetach("nohup sleep 9 &")
      expect(out.rewritten).toBe(false)
      expect(out.mode).toBe("none")
      expect(out.command).toBe("nohup sleep 9 &")
    } finally {
      if (prev === undefined) delete process.env.WODEAPPX_BASH_BG_DETACH
      else process.env.WODEAPPX_BASH_BG_DETACH = prev
    }
  })

  test("rewriteBashToolArgs mutates command field only when rewritten", () => {
    if (process.platform === "win32") return
    const { args, rewrite } = rewriteBashToolArgs({
      command: "sleep 1 &",
      timeout: 120000,
    })
    expect(rewrite.rewritten).toBe(true)
    expect(typeof args).toBe("object")
    expect((args as { timeout: number }).timeout).toBe(120000)
    expect((args as { command: string }).command).toMatch(/BG_PID/)
  })
})
