/** 内置能力页暴露：聊天 / UI 动作 / 侧栏只负责打开对应默认页面，彼此不耦合。 */

export const VISUAL_GENERATION_AGENT_ID = "visual-generation";
export const VIDEO_GENERATION_AGENT_ID = "video-generation";
export const SCRIPT_STORYBOARD_AGENT_ID = "script-storyboard";

export const WODEAPP_OPEN_ABILITY_PAGE_EVENT = "wodeapp:open-ability-page";

export type WodeAppOpenAbilityPageDetail = {
  agentId: string;
  topic?: string;
};

export function dispatchOpenAbilityPage(detail: WodeAppOpenAbilityPageDetail) {
  if (typeof window === "undefined" || !detail.agentId.trim()) return;
  window.dispatchEvent(
    new CustomEvent<WodeAppOpenAbilityPageDetail>(WODEAPP_OPEN_ABILITY_PAGE_EVENT, {
      detail,
    }),
  );
}

/** @deprecated use dispatchOpenAbilityPage({ agentId: SCRIPT_STORYBOARD_AGENT_ID }) */
export function dispatchOpenScriptWorkbench(detail?: { topic?: string }) {
  dispatchOpenAbilityPage({
    agentId: SCRIPT_STORYBOARD_AGENT_ID,
    topic: detail?.topic,
  });
}

export const WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT = WODEAPP_OPEN_ABILITY_PAGE_EVENT;

