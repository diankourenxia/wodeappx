/** @jsxImportSource react */
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";

import {
  isWodeAppAuthAvailable,
  syncWodeAppLocalByokEnv,
} from "@/app/lib/wodeapp-auth";

export const LOCAL_BYOK_PRIVACY_NOTICE =
  "仅在本机读取，并同步到本机环境变量与本地引擎凭据；不会上传到 WodeApp 云端，也不会同步到任何远程账号服务。";

/**
 * One-click sync of Claude / CC Switch / Codex credentials into OpenWork env.json.
 * Manual only — never auto-runs on mount.
 */
export function WodeAppLocalByokImportSettings() {
  const available = isWodeAppAuthAvailable();
  const [syncing, setSyncing] = React.useState(false);
  const [privacyNotice, setPrivacyNotice] = React.useState(LOCAL_BYOK_PRIVACY_NOTICE);
  const [previews, setPreviews] = React.useState<Array<{ key: string; preview: string; source: string }>>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSync = async () => {
    if (!available) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncWodeAppLocalByokEnv();
      setPrivacyNotice(result.privacyNotice || LOCAL_BYOK_PRIVACY_NOTICE);
      if (!result.ok) {
        setError(result.error || "同步失败");
        setPreviews([]);
        return;
      }
      setPreviews(result.syncedPreviews || []);
      setMessage(
        `已同步 ${result.syncedCount || 0} 个本机环境变量（未上传云端）。若本地引擎已在跑，请重启引擎使进程生效。`,
      );
      window.dispatchEvent(
        new CustomEvent("wodeapp:local-byok-env-synced", {
          detail: {
            keys: result.syncedKeys || [],
            uploaded: false,
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="wapp-model-source-card" aria-label="本机环境变量">
      <div className="wapp-model-source-card-head">
        <div className="wapp-model-source-card-title-row">
          <h3>本机环境变量</h3>
          <span className="wapp-service-settings-pill">一键同步</span>
        </div>
        <p>
          Claude / CC Switch / Codex 本质也是 Key 与 Base URL。点一下同步进本机环境变量（如 ANTHROPIC_API_KEY），默认不自动读。
        </p>
      </div>

      {!available ? (
        <p className="wapp-service-settings-meta">仅桌面端可用。</p>
      ) : (
        <>
          <p className="wapp-service-settings-status is-ok" role="note">
            {privacyNotice}
          </p>

          <div className="wapp-surface-actions">
            <button
              type="button"
              className="wapp-surface-button is-primary"
              disabled={syncing}
              onClick={() => void onSync()}
            >
              {syncing ? (
                <Loader2 aria-hidden className="wapp-service-settings-spinner" />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {syncing ? "同步中…" : "一键同步本机配置"}
            </button>
          </div>

          {!message && !error && !syncing ? (
            <p className="wapp-service-settings-meta">不点按钮不会读取本机文件。</p>
          ) : null}

          {previews.length > 0 ? (
            <ul className="wapp-service-settings-meta">
              {previews.map((item) => (
                <li key={item.key}>
                  {item.key} = {item.preview}
                  {item.source ? ` · ${item.source}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          {message ? <p className="wapp-service-settings-status is-ok">{message}</p> : null}
          {error ? <p className="wapp-service-settings-status is-error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
