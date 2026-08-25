import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendWodeAppDialogCard,
  parseWodeAppDialogCardFile,
  resolveWodeAppDialogCardStatus,
} from "../wodeapp/wodeapp-dialog-card";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("wodeapp dialog cards", () => {
  test("appends one card per dispatch without inventing extra fields", () => {
    const first = appendWodeAppDialogCard([], { agentId: "visual-generation", name: "图片智能体" });
    const second = appendWodeAppDialogCard(first, { agentId: "video-generation", name: "视频智能体" });
    expect(second.map((item) => item.agentId)).toEqual(["visual-generation", "video-generation"]);
    expect(second.map((item) => item.cycle)).toEqual([1, 2]);
    expect(parseWodeAppDialogCardFile({
      cards: second,
      extra: "drop",
      confirm: true,
    }).cards).toEqual(second);
    expect(JSON.stringify(second)).not.toContain("userConfirmed");
    expect(JSON.stringify(second)).not.toContain("做成视频");
    expect(JSON.stringify(second)).not.toContain("继续改图");
  });

  test("latest card is working; earlier cards are done; stage snapshot can relight", () => {
    const cards = appendWodeAppDialogCard(
      appendWodeAppDialogCard([], { agentId: "visual-generation", name: "图片智能体" }),
      { agentId: "video-generation", name: "视频智能体" },
    );
    expect(resolveWodeAppDialogCardStatus(cards[0], cards)).toBe("done");
    expect(resolveWodeAppDialogCardStatus(cards[1], cards)).toBe("working");
    expect(resolveWodeAppDialogCardStatus(cards[0], cards, {
      workingId: "visual-generation",
      doneIds: ["video-generation"],
    })).toBe("working");
    expect(resolveWodeAppDialogCardStatus(cards[1], cards, {
      workingId: "visual-generation",
      doneIds: ["video-generation"],
    })).toBe("done");
  });

  test("ability open reuses current session and message list mounts cards", () => {
    const shell = readFileSync(resolve(root, "wodeapp/wodeapp-workbench-shell.tsx"), "utf8");
    expect(shell).toContain("recordWodeAppDialogCard");
    expect(shell).toContain("sidebar.selectedSessionId");
    expect(shell).not.toContain("先建对话拿到 sessionId");
    expect(shell).not.toContain("做成视频");
    expect(shell).not.toContain("继续改图");
    expect(shell).not.toContain("userConfirmed");
    const list = readFileSync(
      resolve(root, "fork/apps/app/src/components/chat/message-list.tsx"),
      "utf8",
    );
    expect(list).toContain("WodeAppDialogCards");
    expect(list).not.toContain("做成视频");
    expect(list).not.toContain("userConfirmed");
  });
});
