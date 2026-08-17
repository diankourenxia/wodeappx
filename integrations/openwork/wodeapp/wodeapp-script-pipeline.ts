export const SCRIPT_STORYBOARD_AGENT_ID = "script-storyboard";

/** 打开内置「短剧智能体」页面（第三栏工作台） */
export const WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT = "wodeapp:open-script-workbench";

export type WodeAppOpenScriptWorkbenchDetail = {
  topic?: string;
  sessionId?: string;
};

export function dispatchOpenScriptWorkbench(detail?: WodeAppOpenScriptWorkbenchDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WodeAppOpenScriptWorkbenchDetail>(WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT, {
      detail,
    }),
  );
}
