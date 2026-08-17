/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import { WodeAppProviderCapabilityPanel } from "./wodeapp-provider-capability-panel";

import "./wodeapp-legacy-chrome.css";

type WodeAppLocalKeyDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function WodeAppLocalKeyDialog({ open, onClose }: WodeAppLocalKeyDialogProps) {
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    window.addEventListener("openwork-open-right-pane", close);
    return () => window.removeEventListener("openwork-open-right-pane", close);
  }, [open, onClose]);

  if (!open) return null;

  const goQuickSetup = () => {
    onClose();
    navigate("/settings/service");
  };

  return createPortal(
    <div className="wx-login-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="wx-byok-guide-dialog wx-first-mile-dialog wx-local-key-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-local-key-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="wx-byok-guide-header">
          <div className="wx-byok-guide-title-copy">
            <h2 id="wx-local-key-dialog-title">配置本机 Key</h2>
            <p>用本机已有 Key，不必登录。下面是当前能调的能力，缺的可以快速配置。</p>
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

        <div className="wx-byok-guide-body wx-first-mile-body">
          <WodeAppProviderCapabilityPanel
            embedded
            showFillAction={false}
            onJumpSource={goQuickSetup}
            onJumpFillHint={goQuickSetup}
          />
        </div>

        <footer className="wx-byok-guide-footer">
          <div className="wx-byok-guide-footer-actions">
            <button type="button" className="wx-byok-guide-secondary" onClick={onClose}>
              稍后
            </button>
            <button type="button" className="wx-login-dialog-primary" onClick={goQuickSetup}>
              快速配置
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
