/** @jsxImportSource react */
import * as React from "react";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, Loader2, Server } from "lucide-react";

import {
  getWodeAppServiceConfig,
  isWodeAppAuthAvailable,
  probeWodeAppServiceOrigin,
  saveWodeAppServiceConfig,
  type WodeAppServiceConfigSummary,
} from "@/app/lib/wodeapp-auth";

const LOCAL_ORIGIN = "http://127.0.0.1:3000";
const CLOUD_ORIGIN_AI = "https://wodeapp.ai";
const CLOUD_ORIGIN_CN = "https://wodeapp.cn";

type OriginPreset = "local" | "cloud" | "custom";

/** Custom/self-hosted origin is not product-ready yet; keep logic, hide the picker. */
const SHOW_CUSTOM_ORIGIN = false;

function detectPreset(origin: string): OriginPreset {
  const cleaned = origin.replace(/\/$/, "");
  if (cleaned === LOCAL_ORIGIN || cleaned === "http://localhost:3000") return "local";
  if (
    cleaned === CLOUD_ORIGIN_AI
    || cleaned === CLOUD_ORIGIN_CN
    || cleaned === "https://www.wodeapp.ai"
    || cleaned === "https://www.wodeapp.cn"
  ) return "cloud";
  return "custom";
}

function profileLabel(profile: WodeAppServiceConfigSummary["profile"] | null): string {
  if (profile === "cloud") return "云端";
  if (profile === "local-only") return "仅本地";
  if (profile === "selfhost") return "自托管 / 本地";
  return "未配置";
}

function originForPreset(preset: OriginPreset, customOrigin: string): string {
  if (preset === "local") return LOCAL_ORIGIN;
  if (preset === "cloud") return CLOUD_ORIGIN_AI;
  return customOrigin.trim() || LOCAL_ORIGIN;
}

function modePill(preset: OriginPreset, summary: WodeAppServiceConfigSummary | null): string {
  const fromSaved = summary?.origin ? detectPreset(summary.origin) : null;
  const mode = fromSaved || preset;
  if (mode === "local") return "本地 · 本机 Key";
  if (mode === "custom") return "自托管";
  return "云端 · 积分";
}

function formatProbeFailure(origin: string, error: string | null | undefined): string {
  const base = `探活失败：${error || "无法连接"}`;
  if (detectPreset(origin) === "local" || /127\.0\.0\.1|localhost/.test(origin)) {
    return `${base}。请先在本机启动 mainserver（默认 ${LOCAL_ORIGIN}），确认可访问后再探活。`;
  }
  return base;
}

/**
 * Platform model source card. Origin / API Key editor stays collapsed by default
 * once configured — keeps local-vs-cloud focus instead of a big always-on server form.
 */
export function WodeAppServiceSettings() {
  const available = isWodeAppAuthAvailable();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [preset, setPreset] = React.useState<OriginPreset>("cloud");
  const [customOrigin, setCustomOrigin] = React.useState("");
  const [apiKeyDraft, setApiKeyDraft] = React.useState("");
  const [summary, setSummary] = React.useState<WodeAppServiceConfigSummary | null>(null);
  const [probeMessage, setProbeMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const advancedBootstrapped = React.useRef(false);

  const applySummary = React.useCallback((next: WodeAppServiceConfigSummary | null) => {
    setSummary(next);
    if (!next) {
      setPreset("cloud");
      setCustomOrigin("");
      return;
    }
    const nextPreset = detectPreset(next.origin);
    setPreset(nextPreset);
    setCustomOrigin(nextPreset === "custom" ? next.origin : "");
  }, []);

  const refresh = React.useCallback(async () => {
    if (!available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getWodeAppServiceConfig();
      if (!result.ok) {
        setError(result.error || "无法读取服务配置");
        applySummary(null);
        if (!advancedBootstrapped.current) {
          setAdvancedOpen(true);
          advancedBootstrapped.current = true;
        }
      } else {
        applySummary(result.config);
        if (!advancedBootstrapped.current) {
          // Already configured → keep Origin/Key form hidden.
          // First-time / incomplete → open so 小白能看见配置路径。
          setAdvancedOpen(!(result.config?.origin && result.config?.hasApiKey));
          advancedBootstrapped.current = true;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取服务配置");
      if (!advancedBootstrapped.current) {
        setAdvancedOpen(true);
        advancedBootstrapped.current = true;
      }
    } finally {
      setLoading(false);
    }
  }, [applySummary, available]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeOrigin = originForPreset(preset, customOrigin);
  const configured = Boolean(summary?.origin);

  const onProbe = async () => {
    setProbing(true);
    setProbeMessage(null);
    setError(null);
    try {
      const result = await probeWodeAppServiceOrigin(activeOrigin);
      if (result.ok) {
        setProbeMessage(`探活成功：${result.origin}${result.status ? ` (HTTP ${result.status})` : ""}`);
      } else {
        setProbeMessage(formatProbeFailure(activeOrigin, result.error));
      }
    } catch (err) {
      setProbeMessage(formatProbeFailure(activeOrigin, err instanceof Error ? err.message : "探活失败"));
    } finally {
      setProbing(false);
    }
  };

  const persistPreset = async (nextPreset: Exclude<OriginPreset, "custom">) => {
    setPreset(nextPreset);
    setSaving(true);
    setStatusMessage(null);
    setError(null);
    try {
      const origin = originForPreset(nextPreset, customOrigin);
      const result = await saveWodeAppServiceConfig({
        origin,
        apiKey: apiKeyDraft.trim() || undefined,
        profile: nextPreset === "cloud" ? "cloud" : "local-only",
      });
      if (!result.ok) {
        setError(result.error || "保存失败");
        return;
      }
      applySummary(result.config);
      setApiKeyDraft("");
      const modeLabel = nextPreset === "local" ? "本地" : "云端";
      setStatusMessage(
        result.providerError
          ? `已切换到${modeLabel}（${origin}），但模型同步失败：${result.providerError}`
          : `已切换到${modeLabel}。当前生效：${origin}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    setError(null);
    try {
      const result = await saveWodeAppServiceConfig({
        origin: activeOrigin,
        apiKey: apiKeyDraft.trim() || undefined,
        profile: preset === "cloud" ? "cloud" : preset === "local" ? "local-only" : "selfhost",
      });
      if (!result.ok) {
        setError(result.error || "保存失败");
        return;
      }
      applySummary(result.config);
      setApiKeyDraft("");
      const savedOrigin = result.config?.origin || activeOrigin;
      const mode = detectPreset(savedOrigin);
      const modeLabel = mode === "local" ? "本地" : mode === "custom" ? "自托管" : "云端";
      setStatusMessage(
        result.providerError
          ? `已保存（当前生效：${modeLabel} ${savedOrigin}），但模型同步失败：${result.providerError}`
          : `已保存。当前生效：${modeLabel} ${savedOrigin}`,
      );
      setAdvancedOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!available) {
    return (
      <section className="wapp-model-source-card" aria-label="平台模型">
        <div className="wapp-model-source-card-head">
          <h3>平台模型</h3>
          <p>当前环境无法编辑桌面服务配置。请在桌面端打开本页。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="wapp-model-source-card" aria-label="平台模型">
      <div className="wapp-model-source-card-head">
        <div className="wapp-model-source-card-title-row">
          <h3>平台模型</h3>
          <span className="wapp-service-settings-pill">{modePill(preset, summary)}</span>
        </div>
        <p>
          {preset === "local" || (summary?.origin && detectPreset(summary.origin) === "local")
            ? "用本机 Key，不必登录。"
            : "登录后用平台积分，也可改用本机 Key。"}
        </p>
      </div>

      {loading ? (
        <p className="wapp-service-settings-status">
          <Loader2 aria-hidden className="wapp-service-settings-spinner" />
          正在读取配置…
        </p>
      ) : (
        <>
          <div className="wapp-service-settings-status-row" role="status">
            <span className="wapp-service-settings-pill">
              <Server aria-hidden />
              {profileLabel(summary?.profile ?? null)}
            </span>
            <span className="wapp-service-settings-meta" title={summary?.origin || undefined}>
              {summary?.origin || "尚未保存 Origin"}
            </span>
            <span className="wapp-service-settings-meta">
              {summary?.hasApiKey
                ? `API Key ${summary.apiKeyPreview || "已配置"}`
                : "未配置 API Key"}
            </span>
          </div>

          <p className="wapp-service-settings-meta">
            选「本地」= 本机 Key 运行（不强制登录）。选「云端」= 登录后所有能力立即可用。
          </p>
          <div className="wapp-service-settings-presets" role="radiogroup" aria-label="运行方式">
            {(
              [
                { id: "local" as const, label: "本地", hint: "本机 Key · 可不登录" },
                { id: "cloud" as const, label: "云端", hint: "登录 · 所有能力立即可用" },
                ...(SHOW_CUSTOM_ORIGIN
                  ? [{ id: "custom" as const, label: "自定义", hint: "自托管域名" }]
                  : []),
              ]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={preset === item.id}
                className={`wapp-service-settings-preset${preset === item.id ? " is-active" : ""}`}
                disabled={saving}
                onClick={() => {
                  setProbeMessage(null);
                  setStatusMessage(null);
                  if (item.id === "custom") {
                    setPreset("custom");
                    setAdvancedOpen(true);
                    return;
                  }
                  void persistPreset(item.id);
                }}
              >
                <span className="wapp-service-settings-preset-label">{item.label}</span>
                <span className="wapp-service-settings-preset-hint">{item.hint}</span>
              </button>
            ))}
          </div>
          {statusMessage ? <p className="wapp-service-settings-status is-ok">{statusMessage}</p> : null}

          <button
            type="button"
            className="wapp-service-settings-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {advancedOpen
              ? "收起服务地址"
              : configured
                ? "更改服务地址与 API Key"
                : "配置服务地址"}
          </button>

          {advancedOpen ? (
            <div className="wapp-service-settings-advanced">
              {preset === "local" ? (
                <p className="wapp-service-settings-meta">
                  本地模式步骤：① 在能力表导入/授权本机模型 Key（对话 / 生图 / 生视频） ② 对话里选用该模型。平台 sk_live_ Key 可选；要跑本机 WodeApp 工具时再起 mainserver（{LOCAL_ORIGIN}）。
                </p>
              ) : null}

              {SHOW_CUSTOM_ORIGIN && preset === "custom" ? (
                <label className="wapp-service-settings-field">
                  <span>自定义 Origin</span>
                  <input
                    type="url"
                    value={customOrigin}
                    onChange={(event) => setCustomOrigin(event.currentTarget.value)}
                    placeholder="https://your-host.example"
                    autoComplete="off"
                  />
                </label>
              ) : null}

              <label className="wapp-service-settings-field">
                <span>
                  {preset === "local"
                    ? "平台 API Key（可选，仅本机项目/MCP 需要）"
                    : "API Key（留空则保留已保存的 Key）"}
                </span>
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.currentTarget.value)}
                  placeholder={preset === "local" ? "可选 sk_live_…" : "sk_live_…"}
                  autoComplete="off"
                />
              </label>

              <div className="wapp-surface-actions">
                <button
                  type="button"
                  className="wapp-surface-button"
                  disabled={probing || !activeOrigin}
                  onClick={() => void onProbe()}
                >
                  {probing ? <Loader2 aria-hidden className="wapp-service-settings-spinner" /> : <Activity aria-hidden />}
                  {probing ? "探活中…" : "探活"}
                </button>
                <button
                  type="button"
                  className="wapp-surface-button is-primary"
                  disabled={saving || !activeOrigin}
                  onClick={() => void onSave()}
                >
                  {saving ? <Loader2 aria-hidden className="wapp-service-settings-spinner" /> : <CheckCircle2 aria-hidden />}
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>

              {probeMessage ? (
                <p className={`wapp-service-settings-status${/探活失败/.test(probeMessage) ? " is-error" : " is-ok"}`}>
                  {probeMessage}
                </p>
              ) : null}
              {statusMessage ? <p className="wapp-service-settings-status is-ok">{statusMessage}</p> : null}
              {error ? <p className="wapp-service-settings-status is-error">{error}</p> : null}
            </div>
          ) : null}

          {!advancedOpen && error ? (
            <p className="wapp-service-settings-status is-error">{error}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
