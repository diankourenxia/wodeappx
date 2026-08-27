/** @jsxImportSource react */
import * as React from "react";
import { CircleUserRound, ExternalLink } from "lucide-react";

import { usePlatform } from "@/react-app/kernel/platform";

import { WODEAPP_PROVIDER_BILLING_LINKS } from "./wodeapp-provider-billing-links";
import { WodeAppModelUsagePanel } from "./wodeapp-model-usage-panel";
import { WodeAppProviderCapabilityPanel } from "./wodeapp-provider-capability-panel";
import { WodeAppSurfaceFrame } from "./wodeapp-surface-frame";

/** Shared body for workbench「账号与模型」and settings「服务与模型」— one config surface. */
export function WodeAppAccountModelBody() {
  const platform = usePlatform();

  return (
    <>
      <WodeAppProviderCapabilityPanel />
      <WodeAppModelUsagePanel />

      <section className="wapp-vendor-billing" aria-label="厂商控制台">
        <div className="wapp-vendor-billing-head">
          <h3>厂商控制台</h3>
          <p>官网看充值。上面卡片是本机 Key 剩余额度，不含云端 WodeApp 模型用量。</p>
        </div>
        <ul className="wapp-vendor-billing-list">
          {WODEAPP_PROVIDER_BILLING_LINKS.map((link) => (
            <li key={link.id} className="wapp-vendor-billing-item">
              <div className="wapp-vendor-billing-copy">
                <span className="wapp-vendor-billing-name">{link.name}</span>
                <span className="wapp-vendor-billing-meta">{link.meta}</span>
              </div>
              <div className="wapp-vendor-billing-actions">
                <button
                  type="button"
                  className="wapp-surface-button is-compact"
                  onClick={() => void platform.openLink(link.consoleUrl)}
                  title="用系统浏览器打开控制台"
                >
                  控制台
                  <ExternalLink aria-hidden className="wapp-surface-button-icon-trailing" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function WodeAppAccountSurface() {
  return (
    <WodeAppSurfaceFrame
      title="账号与模型"
      subtitle="本机 Key，不必登录。云端从侧栏登录。"
      Icon={CircleUserRound}
    >
      <WodeAppAccountModelBody />
    </WodeAppSurfaceFrame>
  );
}
