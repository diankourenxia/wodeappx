/** @jsxImportSource react */
import * as React from "react";
import { Check, HardDrive, KeyRound, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  detectWodeAppProviderCapabilities,
  isWodeAppAuthAvailable,
  removeWodeAppCustomVendor,
  saveWodeAppCustomVendor,
} from "@/app/lib/wodeapp-auth";
import { usePlatform } from "@/react-app/kernel/platform";

import {
  emptyProviderCapabilitySnapshot,
  formatCapabilityProbedAt,
  capabilityConfigActionLabel,
  isCapabilitySourceConfigured,
  isProviderCapabilitySnapshotStale,
  mergeCapabilityTableRows,
  publishProviderCapabilitySnapshot,
  readCachedProviderCapabilitySnapshot,
  sampleModelsForModality,
  shortCapabilityModelLabel,
  snapshotFromCapabilityProbes,
  WODEAPP_PROVIDER_CAPABILITY_EVENT,
  WODEAPP_REFRESH_PROVIDER_CAPABILITY_EVENT,
  type GenerationModality,
  type ProviderCapabilityFillHint,
  type ProviderCapabilityModalities,
  type ProviderCapabilitySnapshot,
  type ProviderCapabilitySource,
} from "./wodeapp-provider-capability";
import { pickerTitleForModelRef } from "./wodeapp-model-picker-families";
import {
  mediaByokProviderFromCapabilitySource,
  openMediaByokSettings,
} from "./wodeapp-media-byok";
import { leaveSettingsForSessionBrowser, openUrlInWodeAppRightPane } from "./wodeapp-browser-tab-nav";
import { resolveCapabilityConsoleUrl, resolveCapabilityUsageUrl } from "./wodeapp-provider-billing-links";
import { openFirstMileGuide } from "./wodeapp-first-mile";
import { WODEAPP_OPEN_LOCAL_KEY_EVENT } from "./wodeapp-model-display";

const MODALITIES: readonly GenerationModality[] = ["text", "image", "video"];

const MODALITY_LABEL: Record<GenerationModality, string> = {
  text: "对话",
  image: "生图",
  video: "生视频",
};

function CapabilityMark({
  on,
  label,
}: {
  on: boolean;
  label: string;
}) {
  const Icon = on ? Check : X;
  return (
    <span
      className={`wx-key-capability-mark ${on ? "is-on" : "is-off"}`}
      aria-label={`${label}${on ? "支持" : "不支持"}`}
    >
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}

export function CapabilityModalityChips({
  modalities,
}: {
  modalities: ProviderCapabilityModalities;
}) {
  return (
    <div className="wx-key-capability-chips" role="list">
      {MODALITIES.map((modality) => (
        <span key={modality} className="wx-key-capability-chip-mark" role="listitem">
          <span className="wx-key-capability-chip-label">{MODALITY_LABEL[modality]}</span>
          <CapabilityMark on={modalities[modality]} label={MODALITY_LABEL[modality]} />
        </span>
      ))}
    </div>
  );
}

function isCustomCapabilitySource(source: Pick<ProviderCapabilitySource, "id">): boolean {
  return String(source.id || "").startsWith("custom-");
}

function PlatformCell({
  source,
}: {
  source: ProviderCapabilitySource;
}) {
  return (
    <div className="wx-key-capability-platform">
      <strong>{source.label}</strong>
      {source.keyPreview ? <span>{source.keyPreview}</span> : null}
    </div>
  );
}

function formatCustomProbeMessage(probe?: {
  probeStatus?: string;
  modelCount?: number;
  error?: string;
}): string {
  if (!probe) return "已保存";
  if (probe.probeStatus === "ok") {
    const count = Number(probe.modelCount) || 0;
    return count > 0 ? `已探测到 ${count} 个模型` : "已保存，未列出模型";
  }
  if (probe.probeStatus === "unauthorized") return "Key 已保存，探测未授权";
  if (probe.error) return `Key 已保存，探测失败：${probe.error}`;
  return "Key 已保存，探测失败";
}

function CustomVendorForm({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveWodeAppCustomVendor({ name, baseURL, apiKey });
      if (!result.ok) {
        setError(result.error || "保存失败");
        return;
      }
      setMessage(formatCustomProbeMessage(result.probe));
      setApiKey("");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="wx-custom-vendor" onSubmit={(event) => void submit(event)}>
      <div className="wx-custom-vendor-head">
        <strong>自定义云厂商</strong>
        <span>名称 + Base URL + Key，保存后探测 OpenAI 兼容 /models</span>
      </div>
      <div className="wx-custom-vendor-grid">
        <label className="wx-custom-vendor-field">
          <span>名称</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 SiliconFlow"
            maxLength={40}
            autoComplete="off"
            disabled={saving}
          />
        </label>
        <label className="wx-custom-vendor-field">
          <span>Base URL</span>
          <input
            type="url"
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            disabled={saving}
          />
        </label>
        <label className="wx-custom-vendor-field">
          <span>Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="粘贴 API Key"
            autoComplete="off"
            disabled={saving}
          />
        </label>
        <button
          type="submit"
          className="wapp-surface-button is-primary is-compact wx-custom-vendor-save"
          disabled={saving || !name.trim() || !baseURL.trim() || !apiKey.trim()}
        >
          {saving ? "探测中…" : "保存并探测"}
        </button>
      </div>
      {message ? <p className="wx-custom-vendor-ok">{message}</p> : null}
      {error ? <p className="wx-custom-vendor-error">{error}</p> : null}
    </form>
  );
}

function CapabilityCell({
  source,
  modality,
  compact,
}: {
  source: ProviderCapabilitySource;
  modality: GenerationModality;
  compact: boolean;
}) {
  const on = source.modalities[modality];
  const models = on && !compact ? sampleModelsForModality(source, modality, 2) : [];
  return (
    <div className="wx-key-capability-cell">
      <CapabilityMark on={on} label={MODALITY_LABEL[modality]} />
      {models.map((id) => (
        <span key={id} className="wx-key-capability-cell-model">
          {pickerTitleForModelRef({ providerID: source.id, modelID: id }, []) || shortCapabilityModelLabel(id)}
        </span>
      ))}
    </div>
  );
}

export async function refreshWodeAppProviderCapabilities(force = false): Promise<ProviderCapabilitySnapshot> {
  const empty = emptyProviderCapabilitySnapshot();
  if (!isWodeAppAuthAvailable()) {
    publishProviderCapabilitySnapshot(empty);
    return empty;
  }
  const result = await detectWodeAppProviderCapabilities({ force });
  if (!result.ok) {
    const failed = {
      ...empty,
      ready: true,
      guidance: result.error || "无法探测本机 Key 能力",
    };
    publishProviderCapabilitySnapshot(failed);
    return failed;
  }
  const snapshot = snapshotFromCapabilityProbes(result.probes);
  publishProviderCapabilitySnapshot(snapshot);
  return snapshot;
}

export function useWodeAppProviderCapabilitySnapshot(options?: {
  auto?: boolean;
  forceOnMount?: boolean;
}): {
  snapshot: ProviderCapabilitySnapshot;
  loading: boolean;
  refresh: (force?: boolean) => Promise<void>;
} {
  const [snapshot, setSnapshot] = React.useState<ProviderCapabilitySnapshot>(
    () => readCachedProviderCapabilitySnapshot() ?? emptyProviderCapabilitySnapshot(),
  );
  const [loading, setLoading] = React.useState(!snapshot.ready);
  const auto = options?.auto !== false;
  const forceOnMount = options?.forceOnMount === true;

  const refresh = React.useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = await refreshWodeAppProviderCapabilities(force);
      setSnapshot(next);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ProviderCapabilitySnapshot>).detail;
      if (detail) setSnapshot(detail);
    };
    window.addEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onUpdate);
    return () => window.removeEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onUpdate);
  }, []);

  React.useEffect(() => {
    const onRefresh = (event: Event) => {
      const force = Boolean((event as CustomEvent<{ force?: boolean }>).detail?.force);
      void refresh(force);
    };
    window.addEventListener(WODEAPP_REFRESH_PROVIDER_CAPABILITY_EVENT, onRefresh);
    return () => window.removeEventListener(WODEAPP_REFRESH_PROVIDER_CAPABILITY_EVENT, onRefresh);
  }, [refresh]);

  React.useEffect(() => {
    if (!auto) return;
    void refresh(forceOnMount);
  }, [auto, forceOnMount, refresh]);

  React.useEffect(() => {
    if (!auto) return;
    const maybeRefresh = () => {
      if (document.visibilityState === "hidden") return;
      if (isProviderCapabilitySnapshotStale(readCachedProviderCapabilitySnapshot())) {
        void refresh(true);
      }
    };
    const onFocus = () => maybeRefresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [auto, refresh]);

  return { snapshot, loading, refresh };
}

type WodeAppProviderCapabilityPanelProps = {
  compact?: boolean;
  auto?: boolean;
  showFillAction?: boolean;
  embedded?: boolean;
  onJumpSource?: (source: ProviderCapabilitySource) => void;
  onJumpFillHint?: (hint: ProviderCapabilityFillHint) => void;
};

export function WodeAppProviderCapabilityPanel({
  compact = false,
  auto = true,
  showFillAction = true,
  embedded = false,
  onJumpSource,
}: WodeAppProviderCapabilityPanelProps) {
  const { snapshot, loading, refresh } = useWodeAppProviderCapabilitySnapshot({
    auto,
    forceOnMount: embedded,
  });
  const navigate = useNavigate();
  const platform = usePlatform();
  const probedLabel = formatCapabilityProbedAt(snapshot.probedAt);
  const tableRows = React.useMemo(
    () => mergeCapabilityTableRows(snapshot.sources),
    [snapshot.sources],
  );
  const jumpToUsage = React.useCallback(async (sourceId: string) => {
    const url = resolveCapabilityUsageUrl(sourceId);
    if (!url) return;
    await platform.openLink(url);
  }, [platform]);
  const jumpToConsole = React.useCallback(async (sourceId: string) => {
    const url = resolveCapabilityConsoleUrl(sourceId);
    if (!url) return false;
    const leftSettings = await leaveSettingsForSessionBrowser(navigate);
    const opened = await openUrlInWodeAppRightPane(url);
    if (!opened) await platform.openLink(url);
    return leftSettings;
  }, [navigate, platform]);

  const handleSourceClick = React.useCallback((source: ProviderCapabilitySource) => {
    if (isCustomCapabilitySource(source)) return;
    if (onJumpSource) {
      onJumpSource(source);
      return;
    }
    void (async () => {
      const mediaId = mediaByokProviderFromCapabilitySource(source.id, source.keyOrigin);
      const jumped = await jumpToConsole(source.id);
      if (mediaId) {
        window.setTimeout(() => openMediaByokSettings(mediaId, true), jumped ? 280 : 80);
      }
    })();
  }, [jumpToConsole, onJumpSource]);

  const handleRemoveCustom = React.useCallback(async (source: ProviderCapabilitySource) => {
    const result = await removeWodeAppCustomVendor(source.id);
    if (result.ok) await refresh(true);
  }, [refresh]);

  return (
    <section className={`wx-key-capability ${compact ? "is-compact" : ""}${embedded ? " is-embedded" : ""}`} aria-label="本机 Key 能力">
      <div className="wx-key-capability-head">
        <h3>本机 Key 能调用的能力</h3>
        <div className="wx-key-capability-refresh">
          {embedded ? null : (
            <>
              <button
                type="button"
                className="wapp-surface-button is-primary is-compact"
                onClick={() => openFirstMileGuide()}
              >
                <KeyRound aria-hidden />
                初始化引导
              </button>
              <button
                type="button"
                className="wapp-surface-button is-compact"
                onClick={() => window.dispatchEvent(new Event(WODEAPP_OPEN_LOCAL_KEY_EVENT))}
              >
                <HardDrive aria-hidden />
                导入本机 Key
              </button>
            </>
          )}
          {snapshot.ready && probedLabel && !loading ? (
            <span className="wx-key-capability-updated">{probedLabel}</span>
          ) : null}
          <button
            type="button"
            className="wx-byok-guide-link"
            onClick={() => void refresh(true)}
            disabled={loading}
          >
            {loading ? "更新中…" : "更新"}
          </button>
        </div>
      </div>
      {embedded ? null : (
        <p className="wx-key-capability-summary">
          {loading && !snapshot.ready ? "正在读取本机 Key…" : snapshot.summary}
        </p>
      )}
      {tableRows.length === 0 && !loading ? (
        <p className="wx-byok-guide-meta">还没扫到可用 Key。点下方平台去配置。</p>
      ) : tableRows.length > 0 ? (
        <div className="wx-key-capability-table-wrap">
          <table className="wx-key-capability-table">
            <thead>
              <tr>
                <th scope="col">平台</th>
                {MODALITIES.map((modality) => (
                  <th key={modality} scope="col">{MODALITY_LABEL[modality]}</th>
                ))}
                <th scope="col">配置</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((source) => {
                const configured = isCapabilitySourceConfigured(source);
                const actionLabel = capabilityConfigActionLabel(source);
                return (
                <tr key={source.id}>
                  <th scope="row">
                    <PlatformCell source={source} />
                  </th>
                  {MODALITIES.map((modality) => (
                    <td key={modality}>
                      <CapabilityCell
                        source={source}
                        modality={modality}
                        compact={compact}
                      />
                    </td>
                  ))}
                  <td className="wx-key-capability-action">
                    {configured ? (
                      <div className="wx-key-capability-action-stack">
                        {resolveCapabilityUsageUrl(source.id) ? (
                          <button
                            type="button"
                            className="wx-key-capability-status is-usage"
                            onClick={() => void jumpToUsage(source.id)}
                          >
                            <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                            查看用量
                          </button>
                        ) : (
                          <span className="wx-key-capability-status" title={actionLabel}>
                            <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                            {actionLabel}
                          </span>
                        )}
                        {isCustomCapabilitySource(source) ? (
                          <button
                            type="button"
                            className="wx-key-capability-action-btn"
                            onClick={() => void handleRemoveCustom(source)}
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="wx-key-capability-action-btn is-setup"
                        onClick={() => handleSourceClick(source)}
                      >
                        去配置
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {isWodeAppAuthAvailable() ? <CustomVendorForm onSaved={() => refresh(true)} /> : null}
      {embedded ? null : snapshot.guidance ? <p className="wx-key-capability-guide">{snapshot.guidance}</p> : null}
      {showFillAction && snapshot.missing.length > 0 ? (
        <button
          type="button"
          className="wx-byok-guide-link"
          onClick={() => openFirstMileGuide()}
        >
          去配置缺少的 Key
        </button>
      ) : null}
    </section>
  );
}
