export type WodeAppSurface =
  | "agents"
  | "assets"
  | "schedule"
  | "capabilities"
  | "plugins"
  | "capture"
  | "account";

export const WODEAPP_NAV_ITEMS: Array<{
  id: WodeAppSurface;
  labelKey: `wodeappx.nav.${string}`;
  label: string;
}> = [
  { id: "agents", labelKey: "wodeappx.nav.agents", label: "默认智能体" },
  { id: "assets", labelKey: "wodeappx.nav.assets", label: "数字资产" },
  { id: "schedule", labelKey: "wodeappx.nav.schedule", label: "自动任务" },
  { id: "capabilities", labelKey: "wodeappx.nav.capabilities", label: "能力中心" },
];
