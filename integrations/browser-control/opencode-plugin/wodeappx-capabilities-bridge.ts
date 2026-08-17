import { tool } from "@opencode-ai/plugin";
import { executeHyperframesProductVideo } from "./wodeappx-hyperframes-runtime.mjs";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

const z = tool.schema;

const hyperframesProductVideoArgs = {
  products: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    brand: z.string().optional(),
    category: z.string().optional(),
    productType: z.string().optional(),
    description: z.string().optional(),
    info: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
    images: z.array(z.union([z.string(), z.object({ url: z.string().optional(), path: z.string().optional() })])).optional(),
    productImages: z.array(z.union([z.string(), z.object({ url: z.string().optional(), path: z.string().optional() })])).optional(),
    sellingPoints: z.array(z.string()).optional(),
    points: z.array(z.string()).optional(),
    duration: z.number().positive().optional(),
  })).min(1).max(100).describe("商品库记录数组；支持 name/description/price/images/sellingPoints 等字段。"),
  outputMode: z.enum(["per-product", "single"]).optional().describe("per-product 为每个商品输出一条视频；single 将商品串成一条目录视频。默认 per-product。"),
  outputDir: z.string().optional().describe("输出目录，默认当前工作区下的 .wodeapp/media-output。"),
  outputName: z.string().optional().describe("输出文件名；per-product 模式支持 {name} 占位符。"),
  audio: z.object({
    url: z.string().optional(),
    path: z.string().optional(),
    mediaStart: z.number().min(0).optional(),
    volume: z.number().min(0).max(1).optional(),
  }).optional().describe("可选背景音乐或口播音频，不触发视频模型。"),
  secondsPerProduct: z.number().positive().optional().describe("每个商品场景时长，默认 5 秒。"),
  transitionDuration: z.number().min(0).max(2).optional().describe("商品场景交叉淡化时长，默认 0.35 秒。"),
  width: z.number().int().min(320).max(4096).optional(),
  height: z.number().int().min(320).max(4096).optional(),
  fps: z.number().int().min(24).max(60).optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
  render: z.boolean().optional().describe("是否直接渲染 MP4；默认 true。设置 false 只生成 HyperFrames 项目。"),
};

function buildHyperframesProductVideoTool() {
  return tool({
    description: "数据驱动视频能力：不调用 AI 视频生成模型，直接用商品库数据、商品图、价格、卖点和可选音频生成 HyperFrames HTML 时间线，再用 Chrome + FFmpeg 渲染 MP4。由 Agent 根据任务目标、素材完整度、批量需求、稳定性和成本，自主判断是否选择这条路线。",
    args: hyperframesProductVideoArgs,
    async execute(args: unknown, context?: OpenCodeContext) {
      try {
        const result = await executeHyperframesProductVideo(args, context);
        if (typeof result === "object" && result !== null && Reflect.get(result, "ok") === false) {
          const error = Reflect.get(result, "error");
          throw new Error(typeof error === "string" && error.trim() ? error : "HyperFrames render failed.");
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} 请确认本机已安装 Node 22+、FFmpeg，并允许 npx 安装 hyperframes；也可设置 WODEAPPX_HYPERFRAMES_CLI 指向本地 CLI。`);
      }
    },
  });
}

export default async () => ({
  tool: {
    wodeapp_video_template_render: buildHyperframesProductVideoTool(),
  },
});
