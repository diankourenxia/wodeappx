import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, "../fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
  join(here, "../src/react-app/domains/session/surface/session-surface.tsx"),
];
const surfacePath = candidates.find((path) => existsSync(path));

describe("empty-session hero chips", () => {
  test("digital assets prompt, image/video agents, self-evolve slash", () => {
    expect(surfacePath).toBeTruthy();
    const source = readFileSync(surfacePath!, "utf8");
    expect(source).toContain('handleWodeAppHeroPromptClick("把下面的资料保存整理到数字资产")');
    expect(source).toContain('startHeroBuiltinAgent("visual-generation", "用图片智能体生成：")');
    expect(source).toContain('startHeroBuiltinAgent("video-generation", "用视频智能体生成：")');
    expect(source).toContain("生成图片");
    expect(source).toContain("生成视频");
    expect(source).toContain("自定义 Agent");
    expect(source).toContain('handleWodeAppHeroPromptClick("/自进化 ")');
    expect(source).not.toContain("openHeroBuiltinAgent");
    expect(source).not.toContain("openBuiltinAgentWithFeedback");
    expect(source).not.toContain("我想管理数字资产：");
    expect(source).not.toContain("我想生成一张图片：");
    expect(source).not.toContain("我想做一个自定义 Agent：");
  });
});
