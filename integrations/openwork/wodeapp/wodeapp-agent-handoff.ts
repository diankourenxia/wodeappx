import {
  digitalAssetToMention,
  type AssetMentionRef,
  type DigitalAssetItem,
} from "./digital-assets-data";
import {
  WODEAPP_BUILTIN_AGENTS,
  PIPELINE_INSTRUCTION,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import type { WodeAppTaskPromptInput } from "./wodeapp-composer-handoff";
import { rememberAssetMention } from "./wodeapp-workbench-context";
import {
  buildProductGenerationAgentMessage,
  buildProductGenerationDisplayText,
  type ProductGenerationKind,
} from "./wodeapp-product-follow-up";

export type { ProductGenerationKind } from "./wodeapp-product-follow-up";
export { buildProductSaveFollowUpChoicesMarkdown } from "./wodeapp-product-follow-up";

/** Keep in sync with composer/mention-encoding.ts — avoid @/ import so unit tests can load this module. */
function encodeComposerMentionValue(value: string) {
  return value.replaceAll("%", "%25").replaceAll(" ", "%20");
}

export type BuiltinAgentId = WodeAppBuiltinAgent["id"];

export type AgentHandoffOption = {
  targetAgentId: BuiltinAgentId;
  label: string;
  displayText: (asset: DigitalAssetItem) => string;
};

export function getBuiltinAgentById(id: string): WodeAppBuiltinAgent | undefined {
  return WODEAPP_BUILTIN_AGENTS.find((agent) => agent.id === id);
}

export function handoffOptionsForAsset(asset: DigitalAssetItem): AgentHandoffOption[] {
  switch (asset.kind) {
    case "图片":
      return [
        {
          targetAgentId: "video-generation",
          label: "做成视频",
          displayText: () => "用已关联图片做图生视频：",
        },
        {
          targetAgentId: "visual-generation",
          label: "继续改图",
          displayText: () => "在已关联图片基础上继续改图：",
        },
      ];
    case "提示词":
      return [
        {
          targetAgentId: "visual-generation",
          label: "按提示词生图",
          displayText: () => "按已关联提示词生图：",
        },
        {
          targetAgentId: "video-generation",
          label: "按提示词做视频",
          displayText: () => "按已关联提示词做短视频：",
        },
      ];
    case "商品库":
      return [
        {
          targetAgentId: "visual-generation",
          label: "生成图片",
          displayText: (item) => `用商品「${item.name}」生成商品图：`,
        },
        {
          targetAgentId: "video-generation",
          label: "生成视频",
          displayText: (item) => `用商品「${item.name}」生成5条视频脚本：`,
        },
      ];
    case "视频":
      return [
        {
          targetAgentId: "video-generation",
          label: "继续剪视频",
          displayText: () => "在已关联视频基础上继续剪辑：",
        },
      ];
    case "剧本":
      return [
        {
          targetAgentId: "visual-generation",
          label: "按分镜生图",
          displayText: () => "按已关联剧本分镜生图：",
        },
        {
          targetAgentId: "video-generation",
          label: "按分镜做视频",
          displayText: () => "按已关联剧本分镜做短视频：",
        },
      ];
    default:
      return [];
  }
}

export function buildComposerTextWithAssetMentions(baseText: string, refs: AssetMentionRef[]): string {
  if (!refs.length) return baseText.trim();
  const mentionTokens = refs
    .map((ref) => `@${encodeComposerMentionValue(ref.id.startsWith("asset:") ? ref.id : `asset:${ref.id}`)}`)
    .join(" ");
  const trimmed = baseText.trim();
  return trimmed ? `${trimmed} ${mentionTokens} ` : `${mentionTokens} `;
}

export function buildProductGenerationTask(
  asset: DigitalAssetItem,
  kind: ProductGenerationKind,
): WodeAppTaskPromptInput {
  const mention = digitalAssetToMention(asset);
  return {
    displayText: buildProductGenerationDisplayText(asset.name, kind),
    agentMessage: buildProductGenerationAgentMessage(asset.name, kind, PIPELINE_INSTRUCTION),
    assetMentions: [mention],
    autoSend: false,
  };
}

export function buildAgentHandoffTask(
  option: AgentHandoffOption,
  asset: DigitalAssetItem,
): WodeAppTaskPromptInput {
  if (asset.kind === "商品库") {
    if (option.targetAgentId === "visual-generation") {
      return buildProductGenerationTask(asset, "image");
    }
    if (option.targetAgentId === "video-generation") {
      return buildProductGenerationTask(asset, "video");
    }
  }

  const targetAgent = getBuiltinAgentById(option.targetAgentId);
  if (!targetAgent) {
    throw new Error(`Unknown agent: ${option.targetAgentId}`);
  }

  const mention = digitalAssetToMention(asset);
  const displayText = buildComposerTextWithAssetMentions(option.displayText(asset), [mention]);
  const agentMessage = [
    `用户从数字资产「${asset.kind} · ${asset.name}」流转到「${targetAgent.name}」。`,
    "请先读取已 @ 关联的资产内容。",
    "输入框已预填草稿；等用户补全具体需求后再执行生成，不要在用户未补充前直接扣费。",
    "",
    PIPELINE_INSTRUCTION,
    "",
    targetAgent.samplePrompt,
  ].join("\n");

  return {
    displayText,
    agentMessage,
    assetMentions: [mention],
    autoSend: false,
  };
}

export function primeComposerAssetMentions(sessionId: string, refs: AssetMentionRef[]) {
  if (typeof window === "undefined" || !refs.length) return;
  const fire = () => {
    for (const ref of refs) {
      rememberAssetMention(ref);
      window.dispatchEvent(
        new CustomEvent("wodeapp:insert-asset-mention", { detail: ref }),
      );
    }
  };
  [120, 320, 640].forEach((delay) => window.setTimeout(fire, delay));
}

export function requestAgentHandoff(
  workspaceId: string,
  onCreateTaskWithPrompt: (workspaceId: string, prompt: WodeAppTaskPromptInput) => void,
  option: AgentHandoffOption,
  asset: DigitalAssetItem,
) {
  const task = buildAgentHandoffTask(option, asset);
  window.dispatchEvent(new Event("wodeapp:focus-agents"));
  onCreateTaskWithPrompt(workspaceId, task);
}

export function requestProductGenerationHandoff(
  workspaceId: string,
  onCreateTaskWithPrompt: (workspaceId: string, prompt: WodeAppTaskPromptInput) => void,
  asset: DigitalAssetItem,
  kind: ProductGenerationKind,
) {
  const task = buildProductGenerationTask(asset, kind);
  window.dispatchEvent(new Event("wodeapp:focus-agents"));
  onCreateTaskWithPrompt(workspaceId, task);
}

export { PIPELINE_INSTRUCTION } from "./runtime-projects";
