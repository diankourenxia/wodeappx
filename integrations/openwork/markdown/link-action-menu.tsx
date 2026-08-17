/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Eye, FolderOpen, Loader2 } from "lucide-react";

import type { DesktopApplication } from "@/app/lib/desktop";
import { getDesktopApplicationsForFile, openDesktopWithApp } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { isOpenableDirectoryTarget, type OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";

const SUPPORTED_PANEL_PREVIEWS = new Set(["markdown", "sheet", "slides", "image", "pdf", "html", "text"]);

type LinkActionMenuProps = {
  target: OpenTarget;
  anchorRect: DOMRect;
  onOpenTarget: (target: OpenTarget, options?: OpenTargetOptions) => void;
  onClose: () => void;
};

export function LinkActionMenu({ target, anchorRect, onOpenTarget, onClose }: LinkActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [apps, setApps] = useState<DesktopApplication[] | null>(null);
  const [appsLoading, setAppsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const isDirectory = isOpenableDirectoryTarget(target);
  const canOpenInPanel = !isDirectory && target.kind === "file" && SUPPORTED_PANEL_PREVIEWS.has(target.preview);
  const canOpenExternally = isElectronRuntime() && (target.kind === "file" || isDirectory);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (!canOpenExternally || isDirectory) return;
    setAppsLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDesktopApplicationsForFile(target.value);
        if (!cancelled) {
          setApps(result.slice(0, 12));
        }
      } catch {
        if (!cancelled) setApps([]);
      } finally {
        if (!cancelled) setAppsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canOpenExternally, isDirectory, target.value]);

  const handleOpenDefault = () => {
    onOpenTarget(target, { external: true });
    onClose();
  };

  const handleOpenInPanel = () => {
    onOpenTarget(target);
    onClose();
  };

  const handleReveal = () => {
    onOpenTarget(target, { external: true, reveal: true });
    onClose();
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(target.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be denied; keep menu open so the user can still open.
    }
  };

  const handleOpenWithApp = async (app: DesktopApplication) => {
    try {
      await openDesktopWithApp(target.value, app.appPath);
    } catch {
      onOpenTarget(target, { external: true });
    }
    onClose();
  };

  const top = anchorRect.bottom + 4;
  const left = anchorRect.left;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-52 rounded-lg border border-border bg-popover/95 p-1 shadow-lg backdrop-blur-xl"
      style={{ top, left }}
      role="menu"
    >
      <button
        type="button"
        onClick={handleOpenDefault}
        disabled={!canOpenExternally}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-50"
      >
        {isDirectory ? <FolderOpen className="size-4 shrink-0" /> : <ExternalLink className="size-4 shrink-0" />}
        {isDirectory ? "打开文件夹" : "用默认应用打开"}
      </button>
      {canOpenInPanel ? (
        <button
          type="button"
          onClick={handleOpenInPanel}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
        >
          <Eye className="size-4 shrink-0" />
          在面板中打开
        </button>
      ) : null}
      {!isDirectory ? (
        <button
          type="button"
          onClick={handleReveal}
          disabled={!canOpenExternally}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-50"
        >
          <FolderOpen className="size-4 shrink-0" />
          在访达中显示
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void handleCopyPath()}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
      >
        <Copy className="size-4 shrink-0" />
        {copied ? "已复制路径" : "复制路径"}
      </button>
      {canOpenExternally && !isDirectory && apps && apps.length > 0 ? (
        <>
          <div className="my-1 h-px bg-foreground/5" />
          <div className="px-3 py-1 text-[11px] text-muted-foreground">打开方式</div>
          <div className="max-h-48 overflow-y-auto">
            {apps.map((app) => (
              <button
                key={app.appPath}
                type="button"
                onClick={() => void handleOpenWithApp(app)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                {app.icon ? (
                  <img src={app.icon} alt="" className="size-4 shrink-0 object-contain" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="truncate">{app.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : appsLoading ? (
        <>
          <div className="my-1 h-px bg-foreground/5" />
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            正在加载应用…
          </div>
        </>
      ) : null}
    </div>
  );
}
