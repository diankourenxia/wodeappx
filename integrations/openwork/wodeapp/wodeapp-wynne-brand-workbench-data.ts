import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Building2,
  Library,
  MessageSquareText,
  PackageSearch,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import {
  digitalAssetSearchText,
  type DigitalAssetItem,
} from "./digital-assets-data";
import { WODEAPP_WYNNE_RUNTIME_PROFILE_ID } from "./wodeapp-runtime-profile";
import type { WodeAppTaskPromptInput } from "./wodeapp-composer-handoff";

export const WODEAPP_SHOPIFY_ADMIN_MCP_SERVER = "wodeapp-shopify-admin";
/** Keep local to avoid pulling runtime-projects → storyboard → auth into unit tests. */
const WODEAPP_FEISHU_MCP_SERVER = "lark-mcp";

export type WynneBrandWorkflowId =
  | "brand-chat"
  | "shopify-catalog"
  | "feishu-ops"
  | "knowledge-lookup";

export type WynneBrandConnector = {
  id: "shopify" | "feishu" | "knowledge" | "assets";
  title: string;
  description: string;
  examples: string;
  badge: string;
  Icon: LucideIcon;
  action: "shopify-mcp" | "feishu-mcp" | "assets" | "knowledge-chat";
};

export type WynneBrandWorkflow = {
  id: WynneBrandWorkflowId;
  title: string;
  description: string;
  tag: string;
  Icon: LucideIcon;
};

const WYNNE_BRAND_BASE_INSTRUCTION = `你是 Wynne 品牌智能体。当前会话已绑定 Runtime Profile「${WODEAPP_WYNNE_RUNTIME_PROFILE_ID}」。

执行规则：
1. 不要预载或编造品牌知识、库存、订单、价格或连接状态；需要事实时再发现并调用工具。
2. Shopify / 飞书写操作必须先预览，等我确认后再执行。
3. 检索品牌知识时调用 knowledge_search，并传入 profile="${WODEAPP_WYNNE_RUNTIME_PROFILE_ID}"；引用返回的 source 与 updatedAt。
4. 连接状态只能以实时 status / connections 工具结果为准。
5. 需要店铺或飞书能力时先 tool_search（profile="${WODEAPP_WYNNE_RUNTIME_PROFILE_ID}"），不要假设工具已常驻。`;

const WYNNE_BRAND_PROMPTS: Record<WynneBrandWorkflowId, string> = {
  "brand-chat": `${WYNNE_BRAND_BASE_INSTRUCTION}

任务：按我的问题回答 Wynne 品牌经营相关事项。缺资料时只追问最关键的一项，并优先通过 Shopify、飞书或品牌知识库取证。`,
  "shopify-catalog": `${WYNNE_BRAND_BASE_INSTRUCTION}

任务：查看 Wynne 关联的 Shopify 商品/库存/订单概况。先确认店铺连接，再读取真实数据；缺失字段明确标注，禁止编造。`,
  "feishu-ops": `${WYNNE_BRAND_BASE_INSTRUCTION}

任务：用已授权的飞书工具协助 Wynne 经营协同（多维表、群消息或云文档）。先核验数据源，再给有来源的摘要；写回/发送前必须确认。`,
  "knowledge-lookup": `${WYNNE_BRAND_BASE_INSTRUCTION}

任务：按我的问题检索 Wynne 品牌知识库。先 knowledge_search；无命中时如实说明范围未配置或无结果，不要用通用常识冒充品牌政策。`,
};

export const WYNNE_BRAND_CONNECTORS: readonly WynneBrandConnector[] = [
  {
    id: "shopify",
    title: "Shopify Admin MCP",
    description: "店铺商品、库存、订单与飞书同步",
    examples: "connections_list · graphql · feishu sync",
    badge: WODEAPP_SHOPIFY_ADMIN_MCP_SERVER,
    Icon: ShoppingBag,
    action: "shopify-mcp",
  },
  {
    id: "feishu",
    title: "飞书 / Lark MCP",
    description: "多维表格、群消息、云文档与经营协同",
    examples: "授权后按需发现工具",
    badge: WODEAPP_FEISHU_MCP_SERVER,
    Icon: MessageSquareText,
    action: "feishu-mcp",
  },
  {
    id: "knowledge",
    title: "品牌知识库",
    description: "本地 scope：wynne；按需 knowledge_search",
    examples: ".wodeapp/knowledge/wynne",
    badge: "knowledge_search",
    Icon: BookOpen,
    action: "knowledge-chat",
  },
  {
    id: "assets",
    title: "数字资产",
    description: "品牌库、商品库与可 @ 引用的素材",
    examples: "品牌规范 · 产品图 · 提示词",
    badge: "数字资产",
    Icon: Library,
    action: "assets",
  },
];

export const WYNNE_BRAND_WORKFLOWS: readonly WynneBrandWorkflow[] = [
  {
    id: "brand-chat",
    title: "开始品牌对话",
    description: "进入 Wynne Runtime Profile，按需发现 Shopify、飞书与知识库。",
    tag: "推荐",
    Icon: Sparkles,
  },
  {
    id: "shopify-catalog",
    title: "查看 Shopify 经营数据",
    description: "先确认店铺连接，再读取商品、库存或订单事实。",
    tag: "Shopify",
    Icon: PackageSearch,
  },
  {
    id: "feishu-ops",
    title: "飞书经营协同",
    description: "汇总多维表、群消息或云文档，写操作前确认。",
    tag: "飞书",
    Icon: Building2,
  },
  {
    id: "knowledge-lookup",
    title: "检索品牌知识",
    description: "只查询 wynne 知识范围，无结果时明确说明。",
    tag: "知识库",
    Icon: BookOpen,
  },
];

export function buildWynneBrandPrompt(workflowId: WynneBrandWorkflowId): string {
  return WYNNE_BRAND_PROMPTS[workflowId];
}

export function buildWynneBrandTask(
  workflowId: WynneBrandWorkflowId,
  options?: { displayText?: string; autoSend?: boolean },
): WodeAppTaskPromptInput {
  const agentMessage = buildWynneBrandPrompt(workflowId);
  const displayText = options?.displayText?.trim()
    || (workflowId === "brand-chat"
      ? "向 Wynne 品牌智能体提问；需要数据时再检索 Shopify、飞书或品牌知识库。"
      : WYNNE_BRAND_WORKFLOWS.find((item) => item.id === workflowId)?.title
        || "开始 Wynne 品牌任务");
  return {
    displayText,
    agentMessage,
    autoSend: options?.autoSend ?? false,
    runtimeProfileId: WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
  };
}

export function isWynneBrandWorkflowId(value: string | undefined): value is WynneBrandWorkflowId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(WYNNE_BRAND_PROMPTS, value));
}

function isCreationAsset(item: DigitalAssetItem): boolean {
  return item.preview === "assetUpload"
    || item.preview === "productUpload"
    || item.preview === "brandCreate"
    || item.preview === "assetCreate";
}

export function listWynneRelatedDigitalAssets(
  assets: readonly DigitalAssetItem[],
  limit = 6,
): DigitalAssetItem[] {
  const needle = /wynne|窗帘|curtain/i;
  const scored = assets
    .filter((item) => !isCreationAsset(item) && item.assetUse !== "生成历史")
    .map((item) => {
      const haystack = digitalAssetSearchText(item);
      const brandKind = item.kind === "品牌库" || item.kind === "商品库" ? 2 : 0;
      const nameHit = needle.test(haystack) ? 3 : 0;
      return { item, score: brandKind + nameHit };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "zh-CN"));
  return scored.slice(0, limit).map((entry) => entry.item);
}
