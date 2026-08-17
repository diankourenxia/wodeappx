/**
 * PERF-05 §10.1: live SSE and snapshot hydrate must share one slimming contract.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SLIM_DATA_URL_MIN_CHARS,
  SLIM_TOOL_TEXT_MAX_CHARS,
  slimLiveMessagePart,
  slimOpenworkSessionSnapshot,
} from "../wodeapp/wodeapp-session-snapshot-slim";

const here = dirname(fileURLToPath(import.meta.url));
const fatDataUrl = `data:image/png;base64,${"A".repeat(SLIM_DATA_URL_MIN_CHARS + 64)}`;
const httpsUrl = "https://cdn.example.com/product.png";

describe("live-event-payload-slim (PERF-05)", () => {
  test("large data URL file parts become empty url with filename preserved", () => {
    const slimmed = slimLiveMessagePart({
      type: "file",
      mime: "image/png",
      filename: "shot.png",
      url: fatDataUrl,
    }) as { url: string; filename: string };

    expect(slimmed.url).toBe("");
    expect(slimmed.filename).toBe("shot.png");
    expect(slimmed.url.length).toBeLessThan(fatDataUrl.length);
  });

  test("oversized tool output/error become bounded summaries", () => {
    const slimmed = slimLiveMessagePart({
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        output: "o".repeat(SLIM_TOOL_TEXT_MAX_CHARS + 500),
        error: "e".repeat(SLIM_TOOL_TEXT_MAX_CHARS + 100),
      },
    }) as { state: { output: string; error: string } };

    expect(slimmed.state.output.length).toBeLessThan(SLIM_TOOL_TEXT_MAX_CHARS + 80);
    expect(slimmed.state.output).toContain("[slimmed");
    expect(slimmed.state.error).toContain("[slimmed");
  });

  test("tool attachment data URLs are slimmed for live expansion path", () => {
    const slimmed = slimLiveMessagePart({
      type: "tool",
      tool: "image_inspect",
      state: {
        status: "completed",
        output: "ok",
        attachments: [
          { type: "file", mime: "image/png", filename: "frame.png", url: fatDataUrl },
          { type: "file", mime: "image/png", filename: "remote.png", url: httpsUrl },
        ],
      },
    }) as {
      state: {
        attachments: Array<{ url: string; filename: string }>;
      };
    };

    expect(slimmed.state.attachments[0]?.url).toBe("");
    expect(slimmed.state.attachments[0]?.filename).toBe("frame.png");
    expect(slimmed.state.attachments[1]?.url).toBe(httpsUrl);
  });

  test("plain text, HTTPS URLs, and structured tool results stay intact", () => {
    const text = slimLiveMessagePart({
      type: "text",
      text: "普通正文保持不变",
    }) as { text: string };
    expect(text.text).toBe("普通正文保持不变");

    const file = slimLiveMessagePart({
      type: "file",
      mime: "image/png",
      filename: "remote.png",
      url: httpsUrl,
    }) as { url: string };
    expect(file.url).toBe(httpsUrl);

    const tool = slimLiveMessagePart({
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        output: JSON.stringify({ ok: true, path: "/tmp/a.txt" }),
        metadata: { exit: 0 },
      },
    }) as { state: { output: string; metadata: { exit: number } } };
    expect(tool.state.output).toContain('"ok":true');
    expect(tool.state.metadata.exit).toBe(0);
  });

  test("live slim and snapshot hydrate produce the same part shape", () => {
    const part = {
      type: "file" as const,
      mime: "image/png",
      filename: "shot.png",
      url: fatDataUrl,
    };
    const tool = {
      type: "tool" as const,
      tool: "bash",
      state: {
        status: "completed",
        output: "x".repeat(SLIM_TOOL_TEXT_MAX_CHARS + 200),
        attachments: [{ type: "file", mime: "image/png", filename: "a.png", url: fatDataUrl }],
      },
    };

    const liveFile = slimLiveMessagePart(part);
    const liveTool = slimLiveMessagePart(tool);
    const snapshot = slimOpenworkSessionSnapshot({
      messages: [{ info: { id: "msg_1" }, parts: [part, tool] }],
    });
    const snapParts = snapshot.messages[0]?.parts as unknown[];

    expect(snapParts?.[0]).toEqual(liveFile);
    expect(snapParts?.[1]).toEqual(liveTool);
  });

  test("session-sync applies slimLiveMessagePart on message.part.updated before toUIParts", () => {
    const syncPath = join(
      here,
      "../fork/apps/app/src/react-app/domains/session/sync/session-sync.ts",
    );
    const source = readFileSync(syncPath, "utf8");
    const updatedIdx = source.indexOf('if (event.type === "message.part.updated")');
    expect(updatedIdx).toBeGreaterThan(-1);
    const slice = source.slice(updatedIdx, updatedIdx + 2500);
    expect(slice).toContain("toUIParts(slimLiveMessagePart(part))");
    expect(source).toContain("SLIM_DATA_URL_MIN_CHARS");
    // observe hooks must stay on the raw part
    const observeAt = slice.indexOf("observeLiveToolPart(part");
    const slimCallAt = slice.indexOf("toUIParts(slimLiveMessagePart(part))");
    expect(observeAt).toBeGreaterThan(-1);
    expect(slimCallAt).toBeGreaterThan(-1);
    expect(observeAt).toBeLessThan(slimCallAt);
  });
});
