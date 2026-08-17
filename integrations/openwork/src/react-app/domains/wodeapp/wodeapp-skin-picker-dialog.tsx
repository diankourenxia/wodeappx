/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";

import {
  companionKindLabel,
  readWodeAppCompanionPrefs,
  resolveCompanionFloatEnabled,
  resolveCompanionPerchEnabled,
  skinHasFloatCompanion,
  skinHasPerchCompanion,
  storeWodeAppCompanionPrefs,
  type WodeAppCompanionKind,
  type WodeAppCompanionPrefs,
} from "./wodeapp-companion-prefs";
import {
  companionAvatarSpriteClass,
  companionAvatarSpriteSrc,
  resolveFloatCompanionAvatarForSkin,
  resolvePerchCompanionAvatarForSkin,
  wodeAppCompanionAvatarsForKind,
  type WodeAppCompanionAvatar,
  type WodeAppCompanionPlacement,
} from "./wodeapp-companion-avatars";
import { primeWodeAppComposer, setWodeAppComposerHandoff } from "./wodeapp-composer-handoff";
import { resolveWodeAppEdition } from "./wodeapp-edition";
import { listVisibleWodeAppSkins, type WodeAppSkinId } from "./wodeapp-skins";

type WodeAppSkinPickerDialogProps = {
  open: boolean;
  activeSkin: WodeAppSkinId;
  /** Current chat session — the companion "customize" entry prefills its composer. */
  sessionId?: string | null;
  onClose: () => void;
  onSelect: (skin: WodeAppSkinId) => void;
};

/**
 * Slash-command prefilled into the composer when the user asks for a new
 * companion look. The composer only shows "/新形象 " and the user types their
 * idea after it; on send the base prompt below is prepended automatically
 * (see wodeapp-composer-handoff commandPrefix mode).
 */
const COMPANION_EVOLVE_COMMAND = "/新形象";

function buildCompanionEvolveBasePrompt(
  kind: WodeAppCompanionKind,
  placement: WodeAppCompanionPlacement,
): string {
  if (placement === "perch") {
    return [
      "/自进化 给对话框趴宠新增一个探头精灵形象。",
      "趴宠与悬浮桌宠素材库分开：必须是「趴在输入框上沿探头」构图（下半身被框挡住），不要用站立全身桌宠表。",
      "规格：1×4 横条，帧序固定为 idle 探头 / 闭眼小憩 / 探出更多看你 / 挥手。透明底，参考 companion-perch-*-sheet.png 与 COMPANION_AVATAR_GUIDE 趴宠一节。",
      "登记到 WODEAPP_PERCH_COMPANION_AVATARS，不要写进桌宠列表。",
      "如果我没有写具体想法，先给我 2-3 个形象方向让我选。",
    ].join("\n");
  }
  const target =
    kind === "live2d"
      ? "Live2D 形象（当前只有：小雪）"
      : "精灵图形象（当前已有：小狗、橘猫、小白兔、小机器人）";
  return [
    `/自进化 给悬浮桌宠新增一个${target}。`,
    "桌宠与对话框趴宠素材库分开：桌宠用可拖动站立/全身表（16 帧精灵或 Live2D），不要做成探头趴框表。",
    "制作流程见 wodeappx/docs/COMPANION_AVATAR_GUIDE.md，登记到 WODEAPP_FLOAT_COMPANION_AVATARS。",
    "如果我没有写具体想法，先给我 2-3 个形象方向让我选。",
  ].join("\n");
}

function SkinPreviewCard({
  skinId,
  sidebar,
  main,
  accent,
  topbar,
}: {
  skinId: WodeAppSkinId;
  sidebar: string;
  main: string;
  accent: string;
  topbar: string;
}) {
  return (
    <div
      className={`wapp-skin-preview wapp-skin-preview-${skinId}`}
      style={
        {
          "--wapp-skin-preview-sidebar": sidebar,
          "--wapp-skin-preview-main": main,
          "--wapp-skin-preview-accent": accent,
          "--wapp-skin-preview-topbar": topbar,
        } as React.CSSProperties
      }
      aria-hidden
    >
      <div className="wapp-skin-preview-chrome" />
      <div className="wapp-skin-preview-body">
        <aside className="wapp-skin-preview-sidebar">
          <span />
          <span />
          <span className="is-active" />
          <span />
        </aside>
        <main className="wapp-skin-preview-main">
          <div className="wapp-skin-preview-bubble is-user" />
          <div className="wapp-skin-preview-bubble is-assistant" />
          <div className="wapp-skin-preview-composer" />
        </main>
      </div>
    </div>
  );
}

/**
 * Avatar card thumb. Sprite sheets can animate here; Live2D must stay static —
 * Cubism2 shares one WebGL context, so a second live canvas blacks out the
 * floating companion (pixi-live2d-display#82).
 */
function CompanionAvatarThumb({
  avatar,
  live,
}: {
  avatar: WodeAppCompanionAvatar;
  live: boolean;
}) {
  return (
    <span className="wapp-companion-avatar-thumb" aria-hidden>
      {avatar.kind === "live2d" ? (
        live ? <span className="wapp-companion-avatar-live2d-static">{avatar.label.slice(0, 1)}</span> : null
      ) : (
        <span
          className={companionAvatarSpriteClass(avatar)}
          style={{
            ["--wapp-pet-sprite-sheet" as string]: `url(${JSON.stringify(companionAvatarSpriteSrc(avatar))})`,
          }}
        />
      )}
    </span>
  );
}

function CompanionPlacementConfig({
  placement,
  title,
  description,
  enabled,
  kind,
  activeAvatar,
  sessionId,
  onToggle,
  onKind,
  onAvatar,
  onCustomize,
}: {
  placement: WodeAppCompanionPlacement;
  title: string;
  description: string;
  enabled: boolean;
  kind: WodeAppCompanionKind;
  activeAvatar: WodeAppCompanionAvatar;
  sessionId?: string | null;
  onToggle: () => void;
  onKind: (kind: WodeAppCompanionKind) => void;
  onAvatar: (avatar: WodeAppCompanionAvatar) => void;
  onCustomize: () => void;
}) {
  const kinds: WodeAppCompanionKind[] =
    placement === "perch" ? ["sprite"] : ["sprite", "live2d"];
  const kindGroup = `${placement}-kind`;
  const avatarGroup = `${placement}-avatar`;

  return (
    <div className="wapp-companion-slot" data-placement={placement}>
      <div className="wapp-companion-prefs-row">
        <div className="wapp-companion-prefs-copy">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <button
          type="button"
          className={`wapp-companion-switch${enabled ? " is-on" : ""}`}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? `关闭${title}` : `开启${title}`}
          onClick={onToggle}
        >
          <span className="wapp-companion-switch-knob" aria-hidden />
        </button>
      </div>
      {kinds.length > 1 ? (
        <div className={`wapp-companion-kind-row${enabled ? "" : " is-disabled"}`}>
          <span className="wapp-companion-kind-label">形态</span>
          <div className="wapp-companion-kind-options" role="radiogroup" aria-label={`${title}形态`}>
            {kinds.map((option) => {
              const active = kind === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  name={kindGroup}
                  aria-checked={active}
                  disabled={!enabled}
                  className={`wapp-companion-kind-option${active ? " is-active" : ""}`}
                  onClick={() => onKind(option)}
                >
                  {companionKindLabel(option)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={`wapp-companion-avatar-wall${enabled ? "" : " is-disabled"}`}>
        <span className="wapp-companion-kind-label">形象</span>
        <div className="wapp-companion-avatar-grid" role="radiogroup" aria-label={`${title}形象`}>
          {wodeAppCompanionAvatarsForKind(kind, placement).map((avatar) => {
            const active = activeAvatar.id === avatar.id;
            return (
              <button
                key={avatar.id}
                type="button"
                role="radio"
                name={avatarGroup}
                aria-checked={active}
                disabled={!enabled}
                className={`wapp-companion-avatar-card${active ? " is-active" : ""}`}
                onClick={() => onAvatar(avatar)}
              >
                <CompanionAvatarThumb avatar={avatar} live={enabled} />
                <span className="wapp-companion-avatar-name">{avatar.label}</span>
                {active ? (
                  <span className="wapp-companion-avatar-check" aria-hidden>
                    <Check />
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="wapp-companion-avatar-card is-custom"
            disabled={!enabled || !sessionId?.trim()}
            title={
              sessionId?.trim()
                ? `在当前对话框输入 ${COMPANION_EVOLVE_COMMAND} 命令，补充你的想法后发送`
                : "先打开一个对话，再自定义形象"
            }
            onClick={onCustomize}
          >
            <span className="wapp-companion-avatar-thumb is-custom" aria-hidden>
              <Plus />
            </span>
            <span className="wapp-companion-avatar-name">自定义新形象</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function WodeAppSkinPickerDialog({
  open,
  activeSkin,
  sessionId,
  onClose,
  onSelect,
}: WodeAppSkinPickerDialogProps) {
  const [companion, setCompanion] = React.useState<WodeAppCompanionPrefs>(() => readWodeAppCompanionPrefs());
  const [companionTab, setCompanionTab] = React.useState<WodeAppCompanionPlacement>("float");

  React.useEffect(() => {
    if (!open) return;
    setCompanion(readWodeAppCompanionPrefs());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const hasFloat = skinHasFloatCompanion(activeSkin);
  const hasPerch = skinHasPerchCompanion(activeSkin);

  React.useEffect(() => {
    if (companionTab === "float" && !hasFloat && hasPerch) setCompanionTab("perch");
    if (companionTab === "perch" && !hasPerch && hasFloat) setCompanionTab("float");
  }, [companionTab, hasFloat, hasPerch]);

  const updateCompanion = (patch: Partial<WodeAppCompanionPrefs>) => {
    setCompanion(storeWodeAppCompanionPrefs(patch));
  };

  const customizeCompanion = (placement: WodeAppCompanionPlacement) => {
    const id = sessionId?.trim();
    if (!id) return;
    const kind = placement === "perch" ? companion.perchKind : companion.kind;
    setWodeAppComposerHandoff(id, {
      displayText: `${COMPANION_EVOLVE_COMMAND} `,
      agentMessage: buildCompanionEvolveBasePrompt(kind, placement),
      commandPrefix: COMPANION_EVOLVE_COMMAND,
    });
    primeWodeAppComposer(id, `${COMPANION_EVOLVE_COMMAND} `);
    onClose();
  };

  if (!open) return null;

  const productName = resolveWodeAppEdition().productName;
  const floatOn = resolveCompanionFloatEnabled(companion, activeSkin);
  const perchOn = resolveCompanionPerchEnabled(companion, activeSkin);
  const floatAvatar = resolveFloatCompanionAvatarForSkin(companion, activeSkin);
  const perchAvatar = resolvePerchCompanionAvatarForSkin(companion, activeSkin);

  return createPortal(
    <div className="wapp-skin-picker-backdrop" role="presentation" onClick={onClose}>
      <section
        className="wapp-skin-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wapp-skin-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="wapp-skin-picker-header">
          <div>
            <h2 id="wapp-skin-picker-title">选择皮肤</h2>
            <p>预览工作台配色；桌宠和趴宠跟随当前皮肤</p>
          </div>
          <button
            type="button"
            className="wapp-skin-picker-close"
            onClick={onClose}
            aria-label="关闭皮肤选择"
          >
            <X aria-hidden />
          </button>
        </header>

        <div className="wapp-skin-picker-body">
          <section className="wapp-companion-prefs" aria-label="桌面陪伴">
            {hasFloat || hasPerch ? (
              <>
                <div className="wapp-companion-tabs" role="tablist" aria-label="陪伴类型">
                  {hasFloat ? (
                    <button
                      type="button"
                      role="tab"
                      id="wapp-companion-tab-float"
                      aria-selected={companionTab === "float"}
                      aria-controls="wapp-companion-panel-float"
                      className={`wapp-companion-tab${companionTab === "float" ? " is-active" : ""}`}
                      onClick={() => setCompanionTab("float")}
                    >
                      悬浮桌宠
                      <span className="wapp-companion-tab-state">{floatOn ? "开" : "关"}</span>
                    </button>
                  ) : null}
                  {hasPerch ? (
                    <button
                      type="button"
                      role="tab"
                      id="wapp-companion-tab-perch"
                      aria-selected={companionTab === "perch"}
                      aria-controls="wapp-companion-panel-perch"
                      className={`wapp-companion-tab${companionTab === "perch" ? " is-active" : ""}`}
                      onClick={() => setCompanionTab("perch")}
                    >
                      对话框趴宠
                      <span className="wapp-companion-tab-state">{perchOn ? "开" : "关"}</span>
                    </button>
                  ) : null}
                </div>

                {hasFloat && floatAvatar ? (
                  <div
                    id="wapp-companion-panel-float"
                    role="tabpanel"
                    aria-labelledby="wapp-companion-tab-float"
                    hidden={companionTab !== "float"}
                  >
                    <CompanionPlacementConfig
                      placement="float"
                      title="悬浮桌宠"
                      description={`跟随${productName}窗口的可拖动陪伴`}
                      enabled={floatOn}
                      kind={companion.kind}
                      activeAvatar={floatAvatar}
                      sessionId={sessionId}
                      onToggle={() => updateCompanion({ enabled: !companion.enabled })}
                      onKind={(kind) => updateCompanion({ kind })}
                      onAvatar={(avatar) => updateCompanion({ kind: avatar.kind, avatarId: avatar.id })}
                      onCustomize={() => customizeCompanion("float")}
                    />
                  </div>
                ) : null}

                {hasPerch && perchAvatar ? (
                  <div
                    id="wapp-companion-panel-perch"
                    role="tabpanel"
                    aria-labelledby="wapp-companion-tab-perch"
                    hidden={companionTab !== "perch"}
                  >
                    <CompanionPlacementConfig
                      placement="perch"
                      title="对话框趴宠"
                      description="专属探头精灵，趴在输入框上沿；不可拖动，点一下互动"
                      enabled={perchOn}
                      kind={companion.perchKind === "live2d" ? "sprite" : companion.perchKind}
                      activeAvatar={perchAvatar}
                      sessionId={sessionId}
                      onToggle={() => updateCompanion({ perchEnabled: !perchOn })}
                      onKind={(kind) => updateCompanion({ perchKind: kind })}
                      onAvatar={(avatar) =>
                        updateCompanion({ perchKind: avatar.kind, perchAvatarId: avatar.id })
                      }
                      onCustomize={() => customizeCompanion("perch")}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="wapp-companion-empty">当前皮肤没有桌宠或趴宠</p>
            )}
          </section>

          <div className="wapp-skin-picker-grid" role="listbox" aria-label="可用皮肤">
            {listVisibleWodeAppSkins().map((skin) => {
              const active = skin.id === activeSkin;
              return (
                <button
                  key={skin.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`wapp-skin-picker-card${active ? " is-active" : ""}`}
                  onClick={() => {
                    onSelect(skin.id);
                    onClose();
                  }}
                >
                  <SkinPreviewCard
                    skinId={skin.id}
                    sidebar={skin.preview.sidebar}
                    main={skin.preview.main}
                    accent={skin.preview.accent}
                    topbar={skin.preview.topbar}
                  />
                  <div className="wapp-skin-picker-card-meta">
                    <strong>{skin.label}</strong>
                    <span>{skin.description}</span>
                  </div>
                  {active ? (
                    <span className="wapp-skin-picker-check" aria-hidden>
                      <Check />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
