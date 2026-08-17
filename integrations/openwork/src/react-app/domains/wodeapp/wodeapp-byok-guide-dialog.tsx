/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";

import { openDesktopUrl } from "@/app/lib/desktop";
import { usePlatform } from "@/react-app/kernel/platform";
import { toast } from "@/components/ui/sonner";

import {
  findByokGuideVendor,
  resolveCapabilityJump,
  WODEAPP_OPEN_BYOK_GUIDE_EVENT,
  type ByokGuideStep,
  type ByokGuideVendorId,
} from "./wodeapp-byok-guide";
import {
  FIRST_MILE_CLOUD_LOGIN_LABEL,
  FIRST_MILE_LOCAL_LABEL,
  FIRST_MILE_PHASE_LABELS,
  firstMileChromePrimaryLabel,
  firstMileChromeSecondaryLabel,
  normalizeFirstMileOpenDetail,
  normalizeFirstMileStatusDetail,
  nextVisibleFirstMilePhase,
  pickInitialFirstMilePhase,
  prevVisibleFirstMilePhase,
  publishFirstMileStatus,
  readFirstMileDismissed,
  resolveFirstMileChecklist,
  resolveFirstMileChromeFooter,
  shouldShowFirstMileEntryCue,
  visibleFirstMilePhases,
  writeFirstMileDismissed,
  WODEAPP_FIRST_MILE_CUE_EVENT,
  WODEAPP_FIRST_MILE_STATUS_EVENT,
  WODEAPP_OPEN_FIRST_MILE_EVENT,
  type FirstMileChromeState,
  type FirstMilePhase,
  type FirstMileStatusSnapshot,
} from "./wodeapp-first-mile";
import { WODEAPP_OPEN_LOGIN_EVENT } from "./wodeapp-model-display";
import {
  findWodeAppProviderBillingLink,
  type WodeAppProviderBillingLink,
} from "./wodeapp-provider-billing-links";
import { openOrActivateWodeAppBrowserTab } from "./wodeapp-browser-tab-nav";
import { WodeAppProviderCapabilityPanel } from "./wodeapp-provider-capability-panel";

import "./wodeapp-legacy-chrome.css";

const BROWSER_BRIDGE_BASE = "http://127.0.0.1:17654";

type WodeAppByokGuideDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Optional seed from host; live updates also arrive via status events. */
  status?: Partial<FirstMileStatusSnapshot>;
};

async function openConsoleInBuiltinBrowser(url: string): Promise<boolean> {
  window.dispatchEvent(new Event("wodeapp:focus-agents"));
  window.dispatchEvent(new CustomEvent("openwork-open-right-pane", { detail: { pane: "browser" } }));
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return openOrActivateWodeAppBrowserTab(url);
}

function modelStepTitle(step: ByokGuideStep): string {
  if (step === "console") return "打开控制台，复制 API Key";
  if (step === "paste") return "粘贴到服务与模型";
  return "本地或云端";
}

function modelStepHint(step: ByokGuideStep): string {
  if (step === "console") return "登录厂商控制台后创建 Key，只复制，不要发到聊天里。";
  if (step === "paste") return "保存后会按模型列表确认：能调对话、生图还是生视频。";
  return "本地配本机 Key，可不登录；云端登录后能力全开。勾是这家支持什么，不是已经配好。";
}

export function WodeAppByokGuideDialog({ open, onClose, status }: WodeAppByokGuideDialogProps) {
  const navigate = useNavigate();
  const platform = usePlatform();

  const [snapshot, setSnapshot] = React.useState<FirstMileStatusSnapshot>({
    hasUsableModel: Boolean(status?.hasUsableModel),
    hasPlatformIdentity: Boolean(status?.hasPlatformIdentity),
    abilityProjectCount: status?.abilityProjectCount ?? 0,
  });
  const [chrome, setChrome] = React.useState<FirstMileChromeState>({ kind: "unknown" });
  const [phase, setPhase] = React.useState<FirstMilePhase>("model");
  const [modelStep, setModelStep] = React.useState<ByokGuideStep>("vendor");
  const [vendorId, setVendorId] = React.useState<ByokGuideVendorId | null>(null);
  const [opening, setOpening] = React.useState(false);
  const [dontShowAgain, setDontShowAgain] = React.useState(false);
  const phaseTouchedRef = React.useRef(false);
  const seedPhaseRef = React.useRef<FirstMilePhase | null>(null);

  React.useEffect(() => {
    if (!status) return;
    setSnapshot((prev) => ({
      hasUsableModel: status.hasUsableModel ?? prev.hasUsableModel,
      hasPlatformIdentity: status.hasPlatformIdentity ?? prev.hasPlatformIdentity,
      abilityProjectCount: status.abilityProjectCount ?? prev.abilityProjectCount,
    }));
  }, [status]);

  React.useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = normalizeFirstMileStatusDetail((event as CustomEvent).detail);
      setSnapshot((prev) => ({
        hasUsableModel: detail.hasUsableModel ?? prev.hasUsableModel,
        hasPlatformIdentity: detail.hasPlatformIdentity ?? prev.hasPlatformIdentity,
        abilityProjectCount: detail.abilityProjectCount ?? prev.abilityProjectCount,
      }));
    };
    const onOpenSeed = (event: Event) => {
      const detail = normalizeFirstMileOpenDetail((event as CustomEvent).detail);
      if (detail.phase) {
        seedPhaseRef.current = detail.phase;
        phaseTouchedRef.current = true;
        setPhase(detail.phase);
      }
    };
    window.addEventListener(WODEAPP_FIRST_MILE_STATUS_EVENT, onStatus);
    window.addEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, onOpenSeed);
    window.addEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, onOpenSeed);
    return () => {
      window.removeEventListener(WODEAPP_FIRST_MILE_STATUS_EVENT, onStatus);
      window.removeEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, onOpenSeed);
      window.removeEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, onOpenSeed);
    };
  }, []);

  const refreshChrome = React.useCallback(async () => {
    try {
      const response = await fetch(`${BROWSER_BRIDGE_BASE}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const client = Array.isArray(data?.clients) ? data.clients[0] : null;
      setChrome({
        kind: "ready",
        connected: Boolean(client),
        setupUrl: String(data?.setup?.url || `${BROWSER_BRIDGE_BASE}/setup`),
      });
    } catch {
      setChrome({ kind: "unavailable" });
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    phaseTouchedRef.current = false;
    setModelStep("vendor");
    setVendorId(null);
    setOpening(false);
    setDontShowAgain(false);
    if (seedPhaseRef.current) {
      phaseTouchedRef.current = true;
      const seed = seedPhaseRef.current === "projects" ? "chrome" : seedPhaseRef.current;
      setPhase(seed);
      seedPhaseRef.current = null;
    }
    void refreshChrome();
    const timer = window.setInterval(() => void refreshChrome(), 8_000);
    return () => window.clearInterval(timer);
  }, [open, refreshChrome]);

  const checklist = React.useMemo(
    () => resolveFirstMileChecklist({ ...snapshot, chrome }),
    [snapshot, chrome],
  );
  const chromeFooter = React.useMemo(
    () => resolveFirstMileChromeFooter(chrome),
    [chrome],
  );

  React.useEffect(() => {
    if (!open || phaseTouchedRef.current) return;
    setPhase(pickInitialFirstMilePhase(checklist));
  }, [open, checklist]);

  if (!open) return null;

  const vendor = findByokGuideVendor(vendorId);
  const billing: WodeAppProviderBillingLink | undefined = vendorId
    ? findWodeAppProviderBillingLink(vendorId)
    : undefined;
  const consoleUrl = billing?.consoleUrl || "";
  const phases = visibleFirstMilePhases(checklist);
  const phaseIndex = Math.max(0, phases.indexOf(phase));
  const phaseCount = phases.length;

  const closeWithPrefs = () => {
    if (dontShowAgain) writeFirstMileDismissed(true);
    onClose();
  };

  const openCloudLogin = () => {
    closeWithPrefs();
    window.setTimeout(() => {
      window.dispatchEvent(new Event(WODEAPP_OPEN_LOGIN_EVENT));
    }, 40);
  };

  const goSettings = () => {
    closeWithPrefs();
    navigate("/settings/service");
  };

  const jumpToVendor = (vendorId: string) => {
    const target = resolveCapabilityJump(vendorId);
    if (target.kind === "byok") {
      setVendorId(target.vendorId);
      setModelStep("console");
      return;
    }
    goSettings();
  };

  const openChromeSetup = (mode: "install" | "detect" = "install") => {
    const base =
      chrome.kind === "ready" ? chrome.setupUrl : `${BROWSER_BRIDGE_BASE}/setup`;
    const query = mode === "detect" ? "autorun=1&mode=detect" : "autorun=1";
    void openDesktopUrl(`${base}?${query}`);
    toast(
      mode === "detect"
        ? "已开始连接检测（不会打开应用商店）"
        : "已打开 Chrome 安装调试页",
    );
    void refreshChrome();
  };

  const openConsole = async () => {
    if (!consoleUrl) return;
    setOpening(true);
    try {
      const opened = await openConsoleInBuiltinBrowser(consoleUrl);
      if (!opened) await platform.openLink(consoleUrl);
      setModelStep("paste");
    } finally {
      setOpening(false);
    }
  };

  const advancePhase = () => {
    const next = nextVisibleFirstMilePhase(phase, checklist);
    if (next === "done") {
      closeWithPrefs();
      return;
    }
    phaseTouchedRef.current = true;
    setPhase(next);
  };

  const goBack = () => {
    if (phase === "model") {
      if (modelStep === "paste") {
        setModelStep("console");
        return;
      }
      if (modelStep === "console") {
        setModelStep("vendor");
        return;
      }
      return;
    }
    const prev = prevVisibleFirstMilePhase(phase, checklist);
    if (!prev) return;
    phaseTouchedRef.current = true;
    setPhase(prev);
    if (prev === "model") {
      setModelStep("vendor");
    }
  };

  const canGoBack =
    phase !== "model"
    || modelStep === "console"
    || modelStep === "paste";

  const onPrimary = () => {
    if (phase === "model") {
      if (modelStep === "vendor") {
        advancePhase();
        return;
      }
      if (modelStep === "console") {
        void openConsole();
        return;
      }
      goSettings();
      return;
    }

    if (phase === "chrome") {
      advancePhase();
      return;
    }

    closeWithPrefs();
  };

  const primaryDisabled =
    phase === "model"
    && modelStep === "console"
    && opening;

  const primaryLabel = (() => {
    if (phase === "model") {
      if (modelStep === "console") return opening ? "打开中…" : "打开控制台";
      if (modelStep === "paste") return "去服务与模型粘贴";
      return "下一步";
    }
    if (phase === "chrome") {
      return firstMileChromePrimaryLabel();
    }
    return "完成";
  })();

  const secondaryLabel =
    phase === "chrome"
      ? firstMileChromeSecondaryLabel(chromeFooter.secondary)
      : phase === "model"
        ? "稍后"
        : "稍后";

  const onSecondary = () => {
    if (phase === "chrome") {
      openChromeSetup("install");
      return;
    }
    closeWithPrefs();
  };

  const stepTitle =
    phase === "model"
      ? modelStepTitle(modelStep)
      : "连接本机 Chrome（可选）";

  const stepHint =
    phase === "model"
      ? modelStepHint(modelStep)
      : "可选。需要控本机 Chrome 时再安装调试；不需要就忽略。";

  return createPortal(
    <div className="wx-login-dialog-backdrop" role="presentation" onClick={closeWithPrefs}>
      <section
        className="wx-byok-guide-dialog wx-first-mile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-first-mile-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="wx-byok-guide-header">
          <div className="wx-byok-guide-title-copy">
            <h2 id="wx-first-mile-title">开始使用</h2>
            <p>默认在「wodeapp（自进化）」。配本机 Key 或云端登录即可聊天；Chrome 可选。</p>
          </div>
          <button
            type="button"
            className="wx-login-dialog-close"
            onClick={closeWithPrefs}
            aria-label="关闭引导"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <ol className="wx-first-mile-progress" aria-label="初始化进度">
          {phases.map((item, index) => {
            const active = item === phase;
            const past = index < phaseIndex;
            return (
              <li
                key={item}
                className={`wx-first-mile-progress-item${active ? " is-active" : ""}${past ? " is-done" : ""}`}
                aria-current={active ? "step" : undefined}
              >
                <span className="wx-first-mile-progress-dot" aria-hidden>
                  {past ? <Check size={12} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="wx-first-mile-progress-label">{FIRST_MILE_PHASE_LABELS[item]}</span>
              </li>
            );
          })}
        </ol>

        <div className="wx-byok-guide-body wx-first-mile-body">
          <div className="wx-first-mile-step-head">
            <p className="wx-first-mile-step-kicker">
              第 {phaseIndex + 1} / {phaseCount} 步
              {phase === "model" && modelStep !== "vendor"
                ? ` · ${modelStep === "console" ? "取 Key" : "粘贴"}`
                : phase === "model"
                  ? " · 能力一览"
                  : ""}
            </p>
            <h3 className="wx-first-mile-step-title">{stepTitle}</h3>
            <p className="wx-first-mile-step-hint">{stepHint}</p>
          </div>

          {phase === "model" ? (
            <>
              {modelStep === "vendor" ? (
                <>
                  <div className="wx-account-menu-modes wx-first-mile-paths" role="group" aria-label="开始方式">
                    <button
                      type="button"
                      className="wx-account-menu-mode wx-first-mile-local"
                      onClick={() => {
                        document.getElementById("wx-first-mile-local-keys")?.scrollIntoView({
                          block: "nearest",
                        });
                      }}
                    >
                      <span className="wx-account-menu-mode-label">{FIRST_MILE_LOCAL_LABEL}</span>
                      <span className="wx-account-menu-mode-hint">本机 Key · 可不登录</span>
                    </button>
                    <button
                      type="button"
                      className="wx-account-menu-mode wx-first-mile-cloud"
                      onClick={openCloudLogin}
                    >
                      <span className="wx-account-menu-mode-label">{FIRST_MILE_CLOUD_LOGIN_LABEL}</span>
                      <span className="wx-account-menu-mode-hint">登录 · 所有能力立即可用</span>
                    </button>
                  </div>
                  <div id="wx-first-mile-local-keys">
                    <WodeAppProviderCapabilityPanel
                      embedded
                      showFillAction={false}
                      onJumpSource={(source) => jumpToVendor(source.id)}
                      onJumpFillHint={(hint) => jumpToVendor(hint.vendorId)}
                    />
                  </div>
                </>
              ) : null}

              {modelStep === "console" && vendor ? (
                <div className="wx-byok-guide-panel">
                  <p>
                    将打开 <strong>{vendor.name}</strong> 控制台。创建 API Key 后复制即可。
                  </p>
                  <p className="wx-byok-guide-meta">写入变量：{vendor.envVar}</p>
                </div>
              ) : null}

              {modelStep === "paste" && vendor ? (
                <div className="wx-byok-guide-panel">
                  <p>
                    到「设置 → 服务与模型」粘贴 Key 并保存。
                  </p>
                  <p className="wx-byok-guide-meta">变量名：{vendor.envVar}</p>
                  {consoleUrl ? (
                    <button
                      type="button"
                      className="wx-byok-guide-link"
                      onClick={() => void platform.openLink(consoleUrl)}
                    >
                      系统浏览器再开一次控制台
                      <ExternalLink size={14} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "chrome" ? (
            <div className="wx-byok-guide-panel">
              {chrome.kind === "ready" && chrome.connected ? (
                <p className="wx-first-mile-hint">
                  扩展已连接。不需要可忽略；要再检一次就点安装调试。
                </p>
              ) : chrome.kind === "unavailable" ? (
                <p className="wx-byok-guide-meta">
                  本机浏览器桥未就绪。可忽略，稍后再到能力中心安装。
                </p>
              ) : (
                <p className="wx-byok-guide-meta">
                  需要时再装。点「安装调试」才打开 Chrome；也可以忽略。已装过可用下方连接检测。
                </p>
              )}
              {chrome.kind === "ready" && !chrome.connected ? (
                <button
                  type="button"
                  className="wx-byok-guide-link"
                  onClick={() => openChromeSetup("detect")}
                >
                  已安装，开始连接检测
                </button>
              ) : null}
              <button
                type="button"
                className="wx-byok-guide-link"
                onClick={() => void refreshChrome()}
              >
                刷新连接状态
              </button>
            </div>
          ) : null}
        </div>

        <footer className="wx-byok-guide-footer">
          <label className="wx-byok-guide-dismiss">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
            />
            不再自动弹出
          </label>
          <div className="wx-byok-guide-footer-actions">
            {canGoBack ? (
              <button type="button" className="wx-byok-guide-back" onClick={goBack}>
                上一步
              </button>
            ) : null}
            {secondaryLabel ? (
              <button type="button" className="wx-byok-guide-secondary" onClick={onSecondary}>
                {secondaryLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="wx-login-dialog-primary"
              disabled={primaryDisabled}
              onClick={onPrimary}
            >
              {opening ? <Loader2 className="wx-button-spinner" aria-hidden /> : null}
              {primaryLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** Alias for clearer call sites. */
export const WodeAppFirstMileDialog = WodeAppByokGuideDialog;

/** Open First Mile from anywhere; also listens for legacy BYOK event name. */
export function useWodeAppFirstMileOpenState(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const openHandler = (event: Event) => {
      const detail = normalizeFirstMileOpenDetail((event as CustomEvent).detail);
      if (Object.keys(detail).length) {
        publishFirstMileStatus({
          hasUsableModel: Boolean(detail.hasUsableModel),
          hasPlatformIdentity: Boolean(detail.hasPlatformIdentity),
          abilityProjectCount: detail.abilityProjectCount ?? 0,
        });
      }
      setOpen(true);
    };
    window.addEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, openHandler);
    window.addEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, openHandler);
    return () => {
      window.removeEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, openHandler);
      window.removeEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, openHandler);
    };
  }, []);

  return [open, setOpen];
}

/** Account badge / empty-chat chip: still need a model, and they have not dismissed. */
export function useFirstMileEntryCue(): boolean {
  const [cue, setCue] = React.useState(() =>
    shouldShowFirstMileEntryCue({
      dismissed: readFirstMileDismissed(),
      hasUsableModel: false,
    }),
  );

  React.useEffect(() => {
    let hasUsableModel = false;
    const refresh = () => {
      setCue(shouldShowFirstMileEntryCue({
        dismissed: readFirstMileDismissed(),
        hasUsableModel,
      }));
    };
    const onStatus = (event: Event) => {
      const detail = normalizeFirstMileStatusDetail((event as CustomEvent).detail);
      if (typeof detail.hasUsableModel === "boolean") hasUsableModel = detail.hasUsableModel;
      refresh();
    };
    window.addEventListener(WODEAPP_FIRST_MILE_STATUS_EVENT, onStatus);
    window.addEventListener(WODEAPP_FIRST_MILE_CUE_EVENT, refresh);
    return () => {
      window.removeEventListener(WODEAPP_FIRST_MILE_STATUS_EVENT, onStatus);
      window.removeEventListener(WODEAPP_FIRST_MILE_CUE_EVENT, refresh);
    };
  }, []);

  return cue;
}
