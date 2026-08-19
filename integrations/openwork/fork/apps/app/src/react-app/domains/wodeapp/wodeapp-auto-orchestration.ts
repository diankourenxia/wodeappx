import {
  readWodeAppAbilityProjects,
  type WodeAppAbilityProject,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import { buildAgentProfilePrompt } from "./wodeapp-agent-knowledge";
import type { WodeAppTaskPromptInput } from "./wodeapp-composer-handoff";

/**
 * Injected only when starting a built-in agent task — not every chat turn.
 * Keep decision-routing only; do not restate tool description rules.
 */
export const AUTO_ORCHESTRATION_INSTRUCTION = `【WodeApp — 编排】
1. 按工具 description + args 填参；不确定字段时调 wodeapp_get_tool_docs。
2. 返回的 URL/taskId/assetId 直接传给下一步；资产 URL 非浏览目标。
3. 出图：工作室预填用 wodeapp_batch_image_prepare；商品套图用 product_visual_batch_image_run；单张通用图用 ai_generate_image。商品保真优先。
4. 视频：≤15s → video_generate；N 条/分镜 → wodeapp_video_storyboard_open；大批量追加 → wodeapp_video_storyboard_update（同 shareDocId，只传 delta≤25）。多集：groups/groupId，勿每集新建 shareDoc。勿传 model。可选 HyperFrames：wodeapp_video_template_render。短剧剧本编辑：wodeapp.short_drama.open + series_preflight；出片仍走视频分镜。脚本可视化：scriptFrameUrl（单帧）/ nineGridUrl（九宫格）/ videoRefs（视频），previewMode 切换。商品短视频禁止 short_drama.open。
5. 资产：查库 wodeapp_assets_list；会话图同一套 selectedImageIds。存商品档案 → wodeapp_product_save；进图片库/要 HTTPS → wodeapp_image_asset_save；>12 只问一次；远端分镜必须 HTTPS 时加 requireHttps。
6. 鉴权先 wodeapp_auth_status；分镜链接必须用返回的 taskUrl（带 shareDoc）；对用户展示时用可点击 Markdown 链接或裸 https URL，禁止反引号/代码块包住链接；本地下载后 openwork_file_open_directory。`;

export function buildBuiltinAgentTask(
  agent: WodeAppBuiltinAgent,
  options?: {
    displayText?: string;
    autoSend?: boolean;
    projects?: readonly WodeAppAbilityProject[];
  },
): WodeAppTaskPromptInput {
  const displayText =
    options?.displayText?.trim() ||
    agent.entryPrompt?.trim() ||
    `请按「${agent.name}」能力契约自动执行，缺的资料你再问我。`;

  const agentMessage = buildAgentProfilePrompt(
    agent,
    options?.projects ?? readWodeAppAbilityProjects(),
  );

  return {
    displayText,
    agentMessage,
    autoSend: options?.autoSend ?? agent.autoSend ?? true,
    runtimeProfileId: agent.runtimeProfileId || agent.id,
  };
}

const pendingAutoSendSessionIds = new Set<string>();

export function queueBuiltinAgentAutoSend(sessionId: string) {
  const id = sessionId.trim();
  if (!id) return;
  pendingAutoSendSessionIds.add(id);
}

export function consumeBuiltinAgentAutoSend(sessionId: string): boolean {
  const id = sessionId.trim();
  if (!id || !pendingAutoSendSessionIds.has(id)) return false;
  pendingAutoSendSessionIds.delete(id);
  return true;
}
