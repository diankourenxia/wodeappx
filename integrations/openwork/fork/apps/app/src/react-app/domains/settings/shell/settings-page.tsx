/** @jsxImportSource react */
import type * as React from "react";
import {
  ArrowLeft,
  Bug,
  CloudCog,
  Cog,
  Container,
  FolderLock,
  Info,
  Layout,
  Paintbrush,
  Puzzle,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Terminal,
  UserCircle,
  Wrench,
  Zap,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { t } from "../../../../i18n";
import { isWebDeployment } from "../../../../app/lib/openwork-deployment";
import type { SettingsTab } from "../../../../app/types";
import { useOrgRestrictions } from "../../cloud/desktop-config-provider";
import {
  SettingsContent,
  SettingsPanel,
  SettingsPanelDescription,
  SettingsPanelHeading,
  SettingsPanelTitle,
  SettingsPanelToolbar,
  SettingsPanelToolbarActions,
  SettingsPanelToolbarButton,
  SettingsPanelToolbarMessage,
  SettingsPanelToolbarStatus,
} from "./panel";

export function getSettingsTabIcon(tab: SettingsTab) {
  switch (tab) {
    case "service":
      return CloudCog;
    case "ai":
      return Zap;
    case "preferences":
      return SlidersHorizontal;
    case "shell":
      return Layout;
    case "permissions":
      return FolderLock;
    case "cloud-account":
      return UserCircle;
    case "cloud-marketplaces":
      return Store;
    case "cloud-workers":
      return Container;
    case "cloud-providers":
      return CloudCog;
    case "skills":
      return Sparkles;
    case "extensions":
      return Puzzle;
    case "environment":
      return Terminal;
    case "advanced":
      return Wrench;
    case "appearance":
      return Paintbrush;
    case "updates":
      return RefreshCcw;
    case "recovery":
      return ShieldCheck;
    case "debug":
      return Bug;
    default:
      return Cog;
  }
}

export function getSettingsTabLabel(tab: SettingsTab) {
  switch (tab) {
    case "service":
      return t("settings.tab_service");
    case "ai":
      return "模型服务商";
    case "preferences":
      return "模型偏好";
    case "shell":
      return "界面定制";
    case "permissions":
      return t("settings.tab_permissions");
    case "cloud-account":
      return t("settings.tab_cloud_account");
    case "cloud-marketplaces":
      return t("settings.tab_cloud_marketplaces");
    case "cloud-workers":
      return t("settings.tab_cloud_workers");
    case "cloud-providers":
      return t("settings.tab_cloud_providers");
    case "skills":
      return t("settings.tab_skills");
    case "extensions":
      return t("settings.tab_extensions");
    case "environment":
      return t("settings.tab_environment");
    case "advanced":
      return t("settings.tab_advanced");
    case "appearance":
      return t("settings.tab_appearance");
    case "updates":
      return t("settings.tab_updates");
    case "recovery":
      return t("settings.tab_recovery");
    case "debug":
      return t("settings.tab_debug");
    case "general":
      return "概览";
    default:
      return t("settings.tab_general");
  }
}

export function getSettingsTabDescription(tab: SettingsTab) {
  switch (tab) {
    case "ai":
      return "接入本地或第三方模型服务（BYOK）";
    case "preferences":
      return "默认模型、思考过程与上下文压缩";
    case "shell":
      return "界面定制与壳层开关";
    case "permissions":
      return t("settings.tab_description_permissions");
    case "cloud-account":
      return t("settings.tab_description_cloud_account");
    case "cloud-marketplaces":
      return t("settings.tab_description_cloud_marketplaces");
    case "cloud-workers":
      return t("settings.tab_description_cloud_workers");
    case "cloud-providers":
      return t("settings.tab_description_cloud_providers");
    case "skills":
      return t("settings.tab_description_skills");
    case "extensions":
      return t("settings.tab_description_extensions");
    case "environment":
      return t("settings.tab_description_environment");
    case "advanced":
      return t("settings.tab_description_advanced");
    case "appearance":
      return t("settings.tab_description_appearance");
    case "updates":
      return t("settings.tab_description_updates");
    case "recovery":
      return t("settings.tab_description_recovery");
    case "debug":
      return t("settings.tab_description_debug");
    case "general":
      return "设置入口概览";
    case "service":
      return t("settings.tab_description_service");
    default:
      return t("settings.tab_description_general");
  }
}

/** High-frequency settings shown in the main nav. */
export function getPrimarySettingsTabs(): SettingsTab[] {
  // Web shares one cloud engine: no local keys, folder permissions, or app updates.
  if (isWebDeployment()) return ["appearance"];
  // 「模型偏好」「模型服务商」「环境变量」已下线：平台模型与本机 Key 同步均在「服务与模型」。
  // 「高级 / 恢复 / 调试」不再进侧栏；页面路由仍可用。
  return ["service", "extensions", "appearance", "permissions", "updates"];
}

/** @deprecated Hidden from nav. Kept so old callers don't break. */
export function getMoreSettingsTabs(_developerMode: boolean): SettingsTab[] {
  return [];
}

/** @deprecated Prefer getPrimarySettingsTabs / getMoreSettingsTabs. */
export function getWorkspaceSettingsTabs(): SettingsTab[] {
  return ["extensions"];
}

/** @deprecated Prefer getPrimarySettingsTabs / getMoreSettingsTabs. */
export function getGlobalSettingsTabs(_developerMode: boolean): SettingsTab[] {
  return getMoreSettingsTabs(_developerMode);
}

/** OpenWork Cloud tabs are hidden from the default nav (routes still work). */
export const CLOUD_SETTINGS_TABS: SettingsTab[] = [];

export function getSettingsNavSections(_developerMode: boolean): Array<{
  label: string | null;
  tabs: SettingsTab[];
}> {
  return [{ label: null, tabs: getPrimarySettingsTabs() }];
}

type SettingsPageProps = {
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  showUpdateToolbar?: boolean;
  updateToolbarTone?: string;
  updateToolbarTitle?: string;
  updateToolbarSpinning?: boolean;
  updateToolbarLabel?: string;
  updateToolbarActionLabel?: string | null;
  updateToolbarDisabled?: boolean;
  updateRestartBlockedMessage?: string | null;
  onUpdateToolbarAction?: () => void;
  children: React.ReactNode;
};

type SettingsSidebarProps = Pick<SettingsPageProps, "activeTab" | "onSelectTab" | "developerMode"> & {
  onClose: () => void;
};

const SETTINGS_NAV_BUTTON_CLASS =
  "h-10 gap-3 px-3.5 text-[15px] font-medium [&_svg]:size-5";

export function SettingsSidebar(props: SettingsSidebarProps) {
  const sections = getSettingsNavSections(props.developerMode);

  return (
    <Sidebar className="mac:**:data-[sidebar=sidebar]:bg-transparent">
      <div className="hidden h-10 mac:block mac:titlebar-drag" />
      <SidebarHeader className="px-3 pt-3 pb-1">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className={SETTINGS_NAV_BUTTON_CLASS}
              onClick={props.onClose}
            >
              <ArrowLeft />
              <span>{t("dashboard.back_to_app")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label ?? "primary"} className="px-3 py-2">
            {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent className="text-[15px]">
              <SidebarMenu className="gap-1">
                {section.tabs.map((tab) => {
                  const Icon = getSettingsTabIcon(tab);
                  return (
                    <SidebarMenuItem key={tab}>
                      <SidebarMenuButton
                        type="button"
                        className={SETTINGS_NAV_BUTTON_CLASS}
                        isActive={props.activeTab === tab}
                        onClick={() => props.onSelectTab(tab)}
                      >
                        <Icon />
                        <span>{getSettingsTabLabel(tab)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

function DesktopPolicyBanner() {
  const config = useOrgRestrictions();

  // Show the banner when the org has any active desktop policy restriction
  // (a boolean set to false) or any white-label branding override.
  const hasRestriction = Object.entries(config).some(
    ([key, value]) => typeof value === "boolean" && value === false && key !== "allowedDesktopVersions",
  );
  const hasBranding = Boolean(config.brandLogoUrl ?? config.brandAccentColor);

  if (!hasRestriction && !hasBranding) return null;

  return (
    <div
      data-testid="desktop-policy-banner"
      className="flex items-start gap-2.5 rounded-xl border border-indigo-6/30 bg-indigo-2/50 px-3.5 py-2.5 text-sm dark:border-indigo-7/25 dark:bg-indigo-3/30"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-indigo-11" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-indigo-12">
          {t("settings.desktop_policy_active_title")}
        </p>
        <p className="mt-0.5 text-xs text-indigo-11">
          {t("settings.desktop_policy_active_body")}
        </p>
      </div>
    </div>
  );
}

export function SettingsPage(props: SettingsPageProps) {
  return (
    <SettingsContent>
      <SettingsPanel>
        <SettingsPanelHeading>
          <SettingsPanelTitle>{getSettingsTabLabel(props.activeTab)}</SettingsPanelTitle>
          <SettingsPanelDescription>{getSettingsTabDescription(props.activeTab)}</SettingsPanelDescription>
        </SettingsPanelHeading>
        <DesktopPolicyBanner />

        {props.showUpdateToolbar && props.activeTab === "general" ? (
          <SettingsPanelToolbar>
            <SettingsPanelToolbarActions>
              <SettingsPanelToolbarStatus
                tone={props.updateToolbarTone}
                title={props.updateToolbarTitle}
                spinning={props.updateToolbarSpinning}
              >
                {props.updateToolbarLabel}
              </SettingsPanelToolbarStatus>
              {props.updateToolbarActionLabel ? (
                <SettingsPanelToolbarButton
                  onClick={props.onUpdateToolbarAction}
                  disabled={props.updateToolbarDisabled}
                  title={props.updateRestartBlockedMessage ?? ""}
                >
                  {props.updateToolbarActionLabel}
                </SettingsPanelToolbarButton>
              ) : null}
            </SettingsPanelToolbarActions>
            {props.updateRestartBlockedMessage ? (
              <SettingsPanelToolbarMessage>{props.updateRestartBlockedMessage}</SettingsPanelToolbarMessage>
            ) : null}
          </SettingsPanelToolbar>
        ) : null}
      </SettingsPanel>

      {props.children}
    </SettingsContent>
  );
}
