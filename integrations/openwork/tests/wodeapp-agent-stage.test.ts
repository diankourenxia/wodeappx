import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWodeAppAgentStageCards,
  clampWodeAppAgentStagePosition,
  emptyWodeAppAgentStageSnapshot,
  listWodeAppAgentStageAgents,
  markWodeAppAgentStageWorking,
  parseWodeAppAgentStageSnapshot,
  resolveWodeAppAgentStageStatus,
  snapWodeAppAgentStagePosition,
  stageLabelForAbility,
} from "../wodeapp/wodeapp-agent-stage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const agents = [
  { id: "visual-generation", name: "图片智能体", abilityKind: "image" },
  { id: "video-generation", name: "视频智能体", abilityKind: "video" },
  { id: "script-storyboard", name: "短剧智能体", abilityKind: "short-drama" },
  { id: "agent-infinite-canvas", name: "画布智能体", abilityKind: "canvas" },
  { id: "multi-agent-collab", name: "多模型智能体", abilityKind: "multi-agent" },
  { id: "create-agent", name: "创建智能体" },
] as const;

describe("wodeapp agent stage float model", () => {
  test("lists only image/video/short-drama/canvas tool cards", () => {
    const listed = listWodeAppAgentStageAgents(agents);
    expect(listed.map((item) => item.id)).toEqual([
      "visual-generation",
      "video-generation",
      "script-storyboard",
      "agent-infinite-canvas",
    ]);
    expect(stageLabelForAbility("image")).toBe("图片");
    expect(stageLabelForAbility("video")).toBe("视频");
    expect(stageLabelForAbility("short-drama")).toBe("短剧");
    expect(stageLabelForAbility("canvas")).toBe("画布");
  });

  test("card status is idle / working / done and redispatches light the new card", () => {
    let snap = emptyWodeAppAgentStageSnapshot();
    expect(resolveWodeAppAgentStageStatus("visual-generation", snap)).toBe("idle");
    snap = markWodeAppAgentStageWorking(snap, "visual-generation");
    expect(snap.workingId).toBe("visual-generation");
    expect(snap.cycle).toBe(1);
    expect(snap.expanded).toBe(true);
    snap = markWodeAppAgentStageWorking(snap, "video-generation");
    expect(snap.workingId).toBe("video-generation");
    expect(snap.doneIds).toEqual(["visual-generation"]);
    expect(snap.cycle).toBe(2);
    const cards = buildWodeAppAgentStageCards(agents, snap);
    expect(cards.find((item) => item.id === "visual-generation")?.status).toBe("done");
    expect(cards.find((item) => item.id === "video-generation")?.status).toBe("working");
    expect(cards.find((item) => item.id === "script-storyboard")?.status).toBe("idle");
    expect(cards.find((item) => item.label === "图片")?.status).toBe("done");
  });

  test("snapshot parse keeps schema thin; drag clamps and snaps to edges", () => {
    const parsed = parseWodeAppAgentStageSnapshot({
      expanded: true,
      left: 12,
      top: 20,
      workingId: "visual-generation",
      doneIds: ["video-generation", 1, ""],
      cycle: 3.9,
      extra: "drop-me",
    });
    expect(parsed).toEqual({
      expanded: true,
      left: 12,
      top: 20,
      workingId: "visual-generation",
      doneIds: ["video-generation"],
      cycle: 3,
    });
    expect(
      clampWodeAppAgentStagePosition(-40, -10, { width: 300, height: 210 }, { width: 1000, height: 800 }),
    ).toEqual({ left: 8, top: 8 });
    expect(
      snapWodeAppAgentStagePosition(10, 400, { width: 300, height: 210 }, { width: 1000, height: 800 }),
    ).toEqual({ left: 8, top: 400 });
    expect(
      snapWodeAppAgentStagePosition(700, 20, { width: 300, height: 210 }, { width: 1000, height: 800 }),
    ).toEqual({ left: 692, top: 8 });
  });

  test("shell mounts float and does not ship a middle stage strip", () => {
    const shell = readFileSync(resolve(root, "wodeapp/wodeapp-workbench-shell.tsx"), "utf8");
    expect(shell).toContain("WodeAppAgentStageFloat");
    expect(shell).toContain("handleSelectRuntimeProject(agent.id)");
    expect(shell).not.toContain("任务场 · 待命");
    expect(shell).not.toContain("middle stage strip");
  });
});
