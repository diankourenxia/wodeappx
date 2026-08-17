/** @jsxImportSource react */
import * as React from "react";
import { LoaderCircle, Settings2, ShieldCheck } from "lucide-react";

import { useOptionalWodeAppWorkbench } from "./wodeapp-workbench-context";

export type WodeAppFeishuAuthorizationPanelProps = {
  status: "ready" | "needs_setup";
  busy: boolean;
  onAuthorize: () => void;
  onConfigure: () => void;
  onDismiss: () => void;
};

export function WodeAppFeishuAuthorizationPanel(
  props: WodeAppFeishuAuthorizationPanelProps,
) {
  const needsSetup = props.status === "needs_setup";

  return (
    <div className="px-3 pb-2 pt-1" data-wodeapp-feishu-authorization>
      <section
        aria-label="飞书授权请求"
        aria-live="polite"
        className="overflow-hidden rounded-2xl border border-[rgba(var(--dls-accent-rgb),0.22)] bg-gradient-to-b from-[rgba(var(--dls-accent-rgb),0.08)] to-dls-surface shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(var(--dls-accent-rgb),0.12)] text-dls-accent ring-1 ring-[rgba(var(--dls-accent-rgb),0.22)]">
            <ShieldCheck size={17} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="inline-flex max-w-full items-center rounded-full border border-dls-border/80 bg-dls-surface/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-dls-secondary">
              <span className="truncate">授权请求</span>
            </span>
            <h3 className="mt-1.5 text-[14px] font-semibold leading-5 text-dls-text">
              {needsSetup ? "配置飞书应用后继续" : "允许WodeAppX 连接飞书？"}
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-dls-secondary">
              {needsSetup
                ? "当前工作区还没有飞书应用凭证。完成配置后，再从这里打开浏览器授权。"
                : "授权将在系统浏览器中打开。完成后，WodeAppX 可以在对话中使用你允许的飞书消息、文档、表格、任务和日历能力。"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dls-border/80 bg-dls-hover/20 px-4 py-3">
          <button
            type="button"
            className="inline-flex min-h-8 max-w-full min-w-0 items-center justify-center rounded-xl px-3 text-xs font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-50"
            onClick={props.onDismiss}
            disabled={props.busy}
          >
            <span className="truncate">稍后</span>
          </button>
          {needsSetup ? (
            <button
              type="button"
              className="inline-flex min-h-8 max-w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border border-dls-border bg-dls-surface px-3 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover disabled:pointer-events-none disabled:opacity-50"
              onClick={props.onConfigure}
              disabled={props.busy}
            >
              <Settings2 size={14} className="shrink-0" />
              <span className="truncate">配置飞书应用</span>
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-8 max-w-full min-w-0 items-center justify-center gap-1.5 rounded-xl bg-dls-accent px-3 text-xs font-medium text-[var(--dls-accent-fg)] transition-colors hover:bg-[var(--dls-accent-hover)] disabled:pointer-events-none disabled:opacity-50"
              onClick={props.onAuthorize}
              disabled={props.busy}
            >
              {props.busy ? (
                <LoaderCircle size={14} className="shrink-0 animate-spin" />
              ) : (
                <ShieldCheck size={14} className="shrink-0" />
              )}
              <span className="truncate">{props.busy ? "正在打开..." : "打开飞书授权"}</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function WodeAppFeishuAuthorizationAccessory() {
  const workbench = useOptionalWodeAppWorkbench();
  const prompt = workbench?.feishuAuthorizationPrompt ?? null;

  const handleAuthorize = React.useCallback(() => {
    void workbench?.onConfirmFeishuAuthorization?.();
  }, [workbench]);
  const handleConfigure = React.useCallback(() => {
    workbench?.onOpenFeishuSettings?.();
  }, [workbench]);
  const handleDismiss = React.useCallback(() => {
    workbench?.onDismissFeishuAuthorization?.();
  }, [workbench]);

  if (!prompt) return null;
  return (
    <WodeAppFeishuAuthorizationPanel
      status={prompt.status}
      busy={Boolean(workbench?.feishuAuthorizationBusy)}
      onAuthorize={handleAuthorize}
      onConfigure={handleConfigure}
      onDismiss={handleDismiss}
    />
  );
}
