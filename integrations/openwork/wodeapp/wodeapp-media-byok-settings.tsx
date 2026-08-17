/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, X } from "lucide-react";

import {
  loadWodeAppMediaByok,
  saveWodeAppMediaByok,
  isWodeAppAuthAvailable,
} from "@/app/lib/wodeapp-auth";
import { usePlatform } from "@/react-app/kernel/platform";

import { requestProviderCapabilityRefresh } from "./wodeapp-provider-capability";
import {
  MEDIA_BYOK_PROVIDERS,
  mediaByokProviderStatus,
  normalizeMediaByokFile,
  openMediaByokSettings,
  validateMediaByokProvider,
  writeCachedMediaByokFile,
  type MediaByokFile,
  type MediaByokProviderId,
  type MediaByokProviderValues,
} from "./wodeapp-media-byok";
import { leaveSettingsForSessionBrowser, openUrlInWodeAppRightPane } from "./wodeapp-browser-tab-nav";

import "./wodeapp-legacy-chrome.css";

function statusLabel(status: "ready" | "incomplete" | "empty"): string {
  if (status === "ready") return "已就绪";
  if (status === "incomplete") return "缺字段";
  return "未配置";
}

type WodeAppMediaByokSettingsProps = {
  open: boolean;
  onClose: () => void;
  initialProviderId?: MediaByokProviderId | null;
  docked?: boolean;
};

export function WodeAppMediaByokSettings({
  open,
  onClose,
  initialProviderId,
  docked = false,
}: WodeAppMediaByokSettingsProps) {
  const available = isWodeAppAuthAvailable();
  const navigate = useNavigate();
  const platform = usePlatform();
  const [layoutDocked, setLayoutDocked] = React.useState(docked);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [file, setFile] = React.useState<MediaByokFile>(() => normalizeMediaByokFile(null));
  const [activeId, setActiveId] = React.useState<MediaByokProviderId>("kling");
  const [draft, setDraft] = React.useState<MediaByokProviderValues>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const activeSchema = MEDIA_BYOK_PROVIDERS.find((item) => item.id === activeId) ?? MEDIA_BYOK_PROVIDERS[0];

  const refresh = React.useCallback(async () => {
    if (!available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await loadWodeAppMediaByok();
      if (!result.ok) {
        setError(result.error || "无法读取媒体 BYOK");
        return;
      }
      const next = normalizeMediaByokFile(result);
      setFile(next);
      writeCachedMediaByokFile(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取媒体 BYOK");
    } finally {
      setLoading(false);
    }
  }, [available]);

  React.useEffect(() => {
    if (!open) return;
    if (initialProviderId) setActiveId(initialProviderId);
    void refresh();
  }, [open, initialProviderId, refresh]);

  React.useEffect(() => {
    setDraft(file.providers[activeId] ?? {});
    setMessage(null);
    setError(null);
  }, [activeId, file.providers]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    setLayoutDocked(Boolean(docked));
  }, [docked, open]);

  const openVendorConsole = React.useCallback(async () => {
    const url = activeSchema.docsUrl?.trim();
    if (!url) return;
    const leftSettings = await leaveSettingsForSessionBrowser(navigate);
    if (leftSettings) {
      onClose();
      window.setTimeout(() => {
        void openUrlInWodeAppRightPane(url);
        openMediaByokSettings(activeId, true);
      }, 280);
      return;
    }
    setLayoutDocked(true);
    const opened = await openUrlInWodeAppRightPane(url);
    if (!opened) await platform.openLink(url);
  }, [activeId, activeSchema.docsUrl, navigate, onClose, platform]);

  const handleSaveProvider = async () => {
    const validation = validateMediaByokProvider(activeId, draft);
    if (!validation.ok) {
      setError(validation.message);
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next: MediaByokFile = normalizeMediaByokFile({
        ...file,
        preferLocal: file.preferLocal,
        providers: {
          ...file.providers,
          [activeId]: validation.values,
        },
      });
      const saved = await saveWodeAppMediaByok(next);
      if (!saved.ok) {
        setError(saved.error || "保存失败");
        return;
      }
      const normalized = normalizeMediaByokFile(saved);
      setFile(normalized);
      writeCachedMediaByokFile(normalized);
      setMessage(`${activeSchema.label}已保存；本地生成将优先使用你的 Key，并已重新探测能力`);
      requestProviderCapabilityRefresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleClearProvider = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const providers = { ...file.providers };
      delete providers[activeId];
      const next = normalizeMediaByokFile({ ...file, providers });
      const saved = await saveWodeAppMediaByok(next);
      if (!saved.ok) {
        setError(saved.error || "清除失败");
        return;
      }
      const normalized = normalizeMediaByokFile(saved);
      setFile(normalized);
      writeCachedMediaByokFile(normalized);
      setDraft({});
      setMessage(`已清除${activeSchema.label}凭证，将回落平台渠道`);
      requestProviderCapabilityRefresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清除失败");
    } finally {
      setSaving(false);
    }
  };

  const togglePreferLocal = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = normalizeMediaByokFile({ ...file, preferLocal: !file.preferLocal });
      const saved = await saveWodeAppMediaByok(next);
      if (!saved.ok) {
        setError(saved.error || "保存失败");
        return;
      }
      const normalized = normalizeMediaByokFile(saved);
      setFile(normalized);
      writeCachedMediaByokFile(normalized);
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`wx-login-dialog-backdrop wx-media-byok-backdrop${layoutDocked ? " is-docked" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="wx-media-byok-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-media-byok-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="wx-media-byok-header">
          <div className="wx-media-byok-heading">
            <h2 id="wx-media-byok-title">粘贴 Key</h2>
            <p>
              填入自己的 Key 后仅在本机直连上游。凭证保存在本机，不会上传云端。
            </p>
          </div>
          <button
            type="button"
            className="wx-login-dialog-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="wx-media-byok-body">
          {!available ? (
            <p className="wx-media-byok-meta">仅桌面端可配置可灵 / Seedance / Replicate 等自备凭证。</p>
          ) : (
            <>
              <label className="wx-media-byok-prefer">
                <input
                  type="checkbox"
                  checked={file.preferLocal}
                  onChange={() => void togglePreferLocal()}
                  disabled={loading || saving}
                />
                已填写时优先使用本地自备 Key
              </label>

              <div className="wx-media-byok-tabs" role="tablist" aria-label="媒体服务商">
                {MEDIA_BYOK_PROVIDERS.map((provider) => {
                  const status = mediaByokProviderStatus(file, provider.id);
                  const active = provider.id === activeId;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`wx-media-byok-tab${active ? " is-active" : ""}`}
                      onClick={() => setActiveId(provider.id)}
                    >
                      <span className="wx-media-byok-tab-label">{provider.label}</span>
                      <span className="wx-media-byok-tab-status">{statusLabel(status)}</span>
                    </button>
                  );
                })}
              </div>

              {loading ? (
                <div className="wx-media-byok-meta">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载中…
                </div>
              ) : (
                <div className="wx-media-byok-fields">
                  <p className="wx-media-byok-meta">{activeSchema.hint}</p>
                  {activeSchema.docsUrl ? (
                    <button
                      type="button"
                      className="wx-byok-guide-link"
                      onClick={() => void openVendorConsole()}
                    >
                      打开{activeSchema.label}控制台 / 文档
                    </button>
                  ) : null}
                  {activeSchema.fields.map((field) => (
                    <label key={field.key} className="wx-media-byok-field">
                      <span>
                        {field.label}
                        {field.required ? "（必填）" : ""}
                      </span>
                      <input
                        type={field.secret ? "password" : "text"}
                        value={draft[field.key] ?? ""}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                        }}
                        disabled={saving}
                      />
                      {field.help ? <em>{field.help}</em> : null}
                    </label>
                  ))}
                </div>
              )}

              {error ? <p className="wx-media-byok-error">{error}</p> : null}
              {message ? (
                <p className="wx-media-byok-ok">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {message}
                </p>
              ) : null}
            </>
          )}
        </div>

        {available ? (
          <footer className="wx-media-byok-footer">
            <button
              type="button"
              className="wx-media-byok-save"
              onClick={() => void handleSaveProvider()}
              disabled={saving || loading}
            >
              {saving ? "保存中…" : `保存${activeSchema.label}`}
            </button>
            <button
              type="button"
              className="wx-media-byok-clear"
              onClick={() => void handleClearProvider()}
              disabled={saving || loading}
            >
              清除此服务商
            </button>
          </footer>
        ) : (
          <footer className="wx-media-byok-footer">
            <button type="button" className="wx-media-byok-clear" onClick={onClose}>
              关闭
            </button>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
