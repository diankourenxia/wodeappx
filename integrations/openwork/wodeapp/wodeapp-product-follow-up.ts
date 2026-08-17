/**
 * Product-library → chat handoff copy and post-save quick choices.
 * Kept free of React / lucide / auth imports so unit tests can load it.
 */

export type ProductGenerationKind = "image" | "video";

export function buildProductGenerationDisplayText(
  productName: string,
  kind: ProductGenerationKind,
): string {
  const name = productName.trim() || "该商品";
  return kind === "image"
    ? `用商品「${name}」生成商品图：`
    : `用商品「${name}」生成5条视频脚本：`;
}

export function buildProductGenerationAgentMessage(
  productName: string,
  kind: ProductGenerationKind,
  pipelineInstruction: string,
): string {
  const name = productName.trim() || "该商品";
  if (kind === "video") {
    return [
      `用户从商品库「${name}」发起商品短视频任务（不是短剧）。`,
      "请先读取已 @ 关联的商品图与资料。",
      "输入框已预填「生成5条视频脚本」；等用户补全风格/平台/时长等需求后，先输出 5 条可选视频脚本（含钩子、口播要点、镜头建议），不要在用户未选定脚本前直接扣费生成视频。",
      "执行时用 video_generate 或 wodeapp_video_storyboard_open；禁止打开短剧智能体、禁止加载 wodeapp-short-drama-factory。",
      "",
      pipelineInstruction,
    ].join("\n");
  }
  return [
    `用户从商品库「${name}」发起生图任务。`,
    "请先读取已 @ 关联的商品图与资料。",
    "输入框已预填草稿；等用户补全具体需求（张数/风格等）后再调用生成工具，不要在用户未补充前直接扣费生成。",
    "",
    pipelineInstruction,
  ].join("\n");
}

/** Explicit quick-choice block for assistant replies after a successful product_save. */
export function buildProductSaveFollowUpChoicesMarkdown(productName: string): string {
  const name = productName.trim() || "该商品";
  const spec = {
    title: "商品已入库，接下来做什么？",
    submitLabel: "继续",
    fillLabel: "填入输入框",
    questions: [
      {
        id: "next",
        label: "下一步",
        mode: "single",
        options: [
          {
            label: "生成商品图",
            value: `用刚保存的商品「${name}」生成商品主图。请先确认张数与风格，再执行。`,
          },
          {
            label: "生成视频脚本",
            value: `用刚保存的商品「${name}」生成5条视频脚本。请先确认风格与平台方向，再输出脚本。`,
          },
          {
            label: "先不用",
            value: "先不用，入库就好。",
          },
        ],
      },
    ],
  };
  return `\`\`\`wodeapp-choices\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
}
