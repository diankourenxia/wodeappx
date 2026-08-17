import { describe, expect, test } from "bun:test";

import {
  assignStoryboardOrderInGroup,
  coerceStoryboardSceneGroupId,
  collectAgentVideoModelHints,
  getVideoClipMaxSec,
  normalizeStoryboardGroups,
  resolveStoryboardGroupsForPayload,
  stripStoryboardSceneModels,
  unwrapJsonishToolValue,
  validateStoryboardClipDurations,
} from "../wodeapp/wodeapp-storyboard-clips";

describe("WodeAppX storyboard clip duration gate", () => {
  test("uses 30 seconds only for an explicit Seedance 2.5 model", () => {
    expect(getVideoClipMaxSec("seedance-2-5-pro")).toBe(30);
    expect(getVideoClipMaxSec("seedance-2.0-pro")).toBe(15);
    expect(getVideoClipMaxSec(undefined)).toBe(15);
  });

  test("accepts a 25-second 2.5 clip and rejects it without the model", () => {
    expect(validateStoryboardClipDurations({
      model: "seedance-2-5-pro",
      scenes: [{ duration: 25, prompt: "0-25秒：完整镜头" }],
    }).ok).toBe(true);

    const rejected = validateStoryboardClipDurations({
      scenes: [{ duration: 25, prompt: "0-25秒：完整镜头" }],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.issues.some((issue) => issue.kind === "too_long")).toBe(true);
    expect(rejected.error || "").toContain("智能体传入的 model 会被忽略");
  });

  test("rejects a prompt timeline that exceeds the executable duration", () => {
    const result = validateStoryboardClipDurations({
      scenes: [{ duration: 15, prompt: "0-20秒：镜头仍在继续" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.kind === "prompt_timeline_mismatch")).toBe(true);
  });

  test("strips agent scene models and collects ignored hints", () => {
    const stripped = stripStoryboardSceneModels([
      { prompt: "a", duration: 15, model: "seedance-2-5" },
      { prompt: "b", duration: 10 },
    ]);
    expect(stripped.every((scene) => !("model" in scene && scene.model))).toBe(true);
    expect(collectAgentVideoModelHints({
      model: "seedance-2-5",
      modelId: "seedance-2-5-pro",
      scenes: [{ model: "seedance-2-5" }, { model: "doubao-seedance-2-0-mini-260615" }],
    })).toEqual([
      "seedance-2-5",
      "seedance-2-5-pro",
      "doubao-seedance-2-0-mini-260615",
    ]);
  });

  test("unwraps OpenCode $text JSON scene wrappers used by video storyboard handoff", () => {
    const unwrapped = unwrapJsonishToolValue({
      $text: ' { "title": "第1集 · 救狼之夜", "duration": 15, "prompt": "雷雨夜的诊所" }',
    });
    expect(unwrapped).toEqual({
      title: "第1集 · 救狼之夜",
      duration: 15,
      prompt: "雷雨夜的诊所",
    });
    expect(unwrapJsonishToolValue('{"prompt":"clinic"}')).toEqual({ prompt: "clinic" });
  });

  test("unwraps production $text scenes that previously failed as empty prompts", () => {
    // Exact shape logged from ses_06e1ca3e…: scenes[i] = { $text: '{ "title", "duration", "prompt": "..." }' }
    const scenes = [
      {
        $text: '{ "title": "第1集 · 救狼之夜", "duration": 15, "prompt": "雷雨夜诊所外景，女主拖入受伤灰狼，暖黄灯光" }',
      },
      {
        $text: '{ "title": "第1集 · 缝合", "duration": 12, "prompt": "诊所内缝合特写，血雾与兽瞳对视" }',
      },
    ];
    const prompts = scenes
      .map((item) => unwrapJsonishToolValue(item))
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return "";
        return String((item as { prompt?: unknown }).prompt || "").trim();
      })
      .filter(Boolean);
    expect(prompts).toEqual([
      "雷雨夜诊所外景，女主拖入受伤灰狼，暖黄灯光",
      "诊所内缝合特写，血雾与兽瞳对视",
    ]);
  });
});

describe("WodeAppX storyboard groups (ProductVideo tabs)", () => {
  test("coerces group/episode aliases to groupId", () => {
    expect(coerceStoryboardSceneGroupId({ group: "E17" })).toBe("E17");
    expect(coerceStoryboardSceneGroupId({ episode: "第3集" })).toBe("第3集");
    expect(coerceStoryboardSceneGroupId({ groupId: "ep-1", group: "ignored" })).toBe("ep-1");
  });

  test("normalizes groups and fills orderInGroup from scene.groupId", () => {
    const resolved = resolveStoryboardGroupsForPayload(
      [
        { prompt: "a", groupId: "ep-1" },
        { prompt: "b", groupId: "ep-1" },
        { prompt: "c", groupId: "ep-2" },
      ],
      [
        { id: "ep-1", title: "第1集", order: 0 },
        { id: "ep-2", title: "第2集", order: 1 },
      ],
    );
    expect(resolved.groups).toEqual([
      { id: "ep-1", title: "第1集", order: 0 },
      { id: "ep-2", title: "第2集", order: 1 },
    ]);
    expect(resolved.scenes.map((scene) => scene.orderInGroup)).toEqual([0, 1, 0]);
  });

  test("rebuilds groups from scene.groupId when groups[] is omitted", () => {
    const resolved = resolveStoryboardGroupsForPayload([
      { prompt: "a", groupId: "第1集" },
      { prompt: "b", groupId: "第2集" },
    ]);
    expect(resolved.groups.map((group) => group.id)).toEqual(["第1集", "第2集"]);
    expect(normalizeStoryboardGroups(["开端", { id: "act-2", title: "冲突" }])).toEqual([
      { id: "开端", title: "开端", order: 0 },
      { id: "act-2", title: "冲突", order: 1 },
    ]);
  });

  test("assignStoryboardOrderInGroup keeps explicit orderInGroup", () => {
    const scenes = assignStoryboardOrderInGroup([
      { prompt: "a", groupId: "ep-1", orderInGroup: 5 },
      { prompt: "b", groupId: "ep-1" },
    ]);
    expect(scenes[0].orderInGroup).toBe(5);
    expect(scenes[1].orderInGroup).toBe(0);
  });
});
