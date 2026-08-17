import { describe, expect, test } from "bun:test";

import { routeWodeAppCapabilities } from "../wodeapp/wodeapp-capability-routing";
import {
  asksAboutSelfEvolve,
  isSelfEvolveWorkspace,
  isSelfEvolveWorkspaceDirectory,
  isSelfEvolveWorkspaceName,
  resolveSelfEvolveAwarenessPack,
  SELF_EVOLVE_AWARENESS_PACK,
  SELF_EVOLVE_OFF_WORKSPACE_HINT,
} from "../wodeapp/wodeapp-self-evolve-awareness";

describe("self-evolve awareness", () => {
  test("detects self-evolve workspace by name", () => {
    expect(isSelfEvolveWorkspaceName("wodeapp（自进化）")).toBe(true);
    expect(isSelfEvolveWorkspaceName("苏泊尔经营台（自进化）")).toBe(true);
    expect(isSelfEvolveWorkspaceName("图片智能体")).toBe(false);
  });

  test("detects self-evolve directory heuristics", () => {
    expect(isSelfEvolveWorkspaceDirectory("/Users/me/Desktop/wodeapp")).toBe(true);
    expect(isSelfEvolveWorkspaceDirectory("/Users/me/Desktop/wodeapp/")).toBe(true);
    expect(isSelfEvolveWorkspaceDirectory("/tmp/self-evolve-source/1.0.0/wodeapp")).toBe(true);
    expect(isSelfEvolveWorkspaceDirectory("/Users/me/Desktop/notes")).toBe(false);
  });

  test("injects awareness pack inside self-evolve workspace even for small talk", () => {
    const route = routeWodeAppCapabilities({
      text: "你好",
      workspaceName: "wodeapp（自进化）",
      workspaceDirectory: "/Users/me/Desktop/wodeapp",
    });
    expect(route.system).toContain("Self-evolution (本工作区)");
    expect(route.system).toContain("wodeappx-self-evolution");
    expect(route.system).toContain("/自进化");
    expect(route.system).toContain(SELF_EVOLVE_AWARENESS_PACK);
    expect(route.system).toContain("You are WodeAppX");
  });

  test("directory-only monorepo root also injects pack", () => {
    const route = routeWodeAppCapabilities({
      text: "你可以自进化吗",
      workspaceDirectory: "/Users/macpassword0000/Desktop/wodeapp",
    });
    expect(isSelfEvolveWorkspace({ workspaceDirectory: "/Users/macpassword0000/Desktop/wodeapp" })).toBe(true);
    expect(route.system).toContain(SELF_EVOLVE_AWARENESS_PACK);
  });

  test("asks about self-evolve outside project still gets honest hint", () => {
    expect(asksAboutSelfEvolve("你可以自进化吗")).toBe(true);
    expect(isSelfEvolveWorkspace({ workspaceName: "最近", workspaceDirectory: "/tmp" })).toBe(false);
    expect(
      resolveSelfEvolveAwarenessPack({ text: "你可以自进化吗", workspaceName: "最近" }),
    ).toBe(SELF_EVOLVE_OFF_WORKSPACE_HINT);
    const route = routeWodeAppCapabilities({
      text: "你可以自进化吗",
      workspaceName: "default-workspace",
      workspaceDirectory: "/tmp/chat-only",
    });
    expect(route.system).toContain(SELF_EVOLVE_OFF_WORKSPACE_HINT);
    expect(route.system.includes(SELF_EVOLVE_AWARENESS_PACK)).toBe(false);
  });
});
