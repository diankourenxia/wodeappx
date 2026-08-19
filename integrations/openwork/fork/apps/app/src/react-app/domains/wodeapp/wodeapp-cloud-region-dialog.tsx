/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import {
  originForCloudRegion,
  readStoredCloudRegion,
  suggestCloudRegion,
  type WodeAppCloudRegion,
} from "./wodeapp-cloud-region";

import "./wodeapp-legacy-chrome.css";

type WodeAppCloudRegionDialogProps = {
  open: boolean;
  onClose: () => void;
  onPick: (region: WodeAppCloudRegion) => void;
};

type WodeAppCloudLoginWaitingDialogProps = {
  open: boolean;
  origin?: string;
  phase?: "browser" | "initializing";
  onCancel: () => void;
};

export function WodeAppCloudRegionDialog({
  open,
  onClose,
  onPick,
}: WodeAppCloudRegionDialogProps) {
  if (!open) return null;

  const suggested = suggestCloudRegion();
  const last = readStoredCloudRegion();
  const hintFor = (region: WodeAppCloudRegion) => {
    if (last === region) return "上次使用";
    if (suggested === region) return "建议";
    return null;
  };

  return createPortal(
    <div className="wx-login-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="wx-login-dialog wx-cloud-region-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-cloud-region-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="wx-login-dialog-close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={16} aria-hidden />
        </button>
        <h2 id="wx-cloud-region-title">选择登录站点</h2>
        <p className="wx-cloud-region-copy">
          在浏览器打开官网登录，完成后自动回到这里。
        </p>
        <div className="wx-account-menu-modes" role="group" aria-label="登录站点">
          <button
            type="button"
            className="wx-account-menu-mode"
            onClick={() => onPick("ai")}
          >
            <span className="wx-account-menu-mode-label">
              International
              {hintFor("ai") ? <span className="wx-cloud-region-badge">{hintFor("ai")}</span> : null}
            </span>
            <span className="wx-account-menu-mode-hint">
              {originForCloudRegion("ai")} · 浏览器打开官网
            </span>
          </button>
          <button
            type="button"
            className="wx-account-menu-mode"
            onClick={() => onPick("cn")}
          >
            <span className="wx-account-menu-mode-label">
              中国大陆
              {hintFor("cn") ? <span className="wx-cloud-region-badge">{hintFor("cn")}</span> : null}
            </span>
            <span className="wx-account-menu-mode-hint">
              {originForCloudRegion("cn")} · 浏览器打开官网
            </span>
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function WodeAppCloudLoginWaitingDialog({
  open,
  origin,
  phase = "browser",
  onCancel,
}: WodeAppCloudLoginWaitingDialogProps) {
  if (!open) return null;
  const initializing = phase === "initializing";

  return createPortal(
    <div className="wx-login-dialog-backdrop" role="presentation">
      <section
        className="wx-login-dialog wx-cloud-region-dialog wx-cloud-login-waiting"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-cloud-login-waiting-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="wx-login-dialog-close"
          onClick={onCancel}
          aria-label="取消登录"
        >
          <X size={16} aria-hidden />
        </button>
        <div className="wx-cloud-login-waiting-spinner" aria-hidden />
        <h2 id="wx-cloud-login-waiting-title">
          {initializing ? "登录成功" : "正在浏览器中登录"}
        </h2>
        <p className="wx-cloud-region-copy">
          {initializing ? "初始化中" : "登录完成后会自动回到这里。"}
        </p>
        <button
          type="button"
          className="wx-login-dialog-primary wx-cloud-login-waiting-cancel"
          onClick={onCancel}
        >
          取消
        </button>
      </section>
    </div>,
    document.body,
  );
}
