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
  label: string;
}> = [
  { id: "agents", label: "默认智能体" },
  { id: "assets", label: "数字资产" },
  { id: "schedule", label: "自动任务" },
  { id: "capabilities", label: "能力中心" },
];
