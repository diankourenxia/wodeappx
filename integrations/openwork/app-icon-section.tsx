/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { AppearanceViewProps } from "../pages/appearance-view";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";
import { SettingsNotice } from "../settings-section";

interface AppIconSectionProps
  extends Pick<
    AppearanceViewProps,
    "busy" | "appIconState" | "appIconBusy" | "appIconError" | "chooseAppIcon" | "resetAppIcon"
  > {}

export function AppIconSection(props: AppIconSectionProps) {
  const disabled = props.busy || props.appIconBusy;
  const isCustom = props.appIconState?.custom === true;

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.app_icon_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.app_icon_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background">
              {props.appIconState?.dataUrl ? (
                <img
                  alt=""
                  src={props.appIconState.dataUrl}
                  className="size-full object-cover"
                  draggable={false}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <LayoutSectionItemTitle>{isCustom ? t("settings.app_icon_custom") : t("settings.app_icon_default")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>{t("settings.app_icon_formats")}</LayoutSectionItemDescription>
            </div>
          </div>
          <LayoutSectionItemHeaderActions className="flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void props.chooseAppIcon()} disabled={disabled}>
              {props.appIconBusy ? t("settings.app_icon_applying") : t("settings.app_icon_choose")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void props.resetAppIcon()} disabled={disabled || !isCustom}>
              {t("settings.app_icon_reset")}
            </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>

      {props.appIconError ? <SettingsNotice tone="error">{props.appIconError}</SettingsNotice> : null}
    </LayoutSection>
  );
}
