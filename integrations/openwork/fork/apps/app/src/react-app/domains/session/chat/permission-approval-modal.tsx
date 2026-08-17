/** @jsxImportSource react */
import { Check, ChevronRight, Clock3, FolderOpen, HardDrive, RefreshCcw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";
import { cn } from "@/lib/utils";
import { useLocal } from "@/react-app/kernel/local-provider";

type PermissionPresentation = {
  title: string;
  message: string;
  permissionLabel: string;
  scopeLabel: string;
  scopeValue: string;
  isDoomLoop: boolean;
  note: string | null;
  preferSessionAllow: boolean;
};

type PermissionDetail = {
  label: string;
  value: string;
  multiline?: boolean;
};

type PermissionApprovalModalProps = {
  permission: PendingPermission;
  busy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
};

const metadataDetailKeys: Array<{ key: string; labelKey: string; multiline?: boolean }> = [
  { key: "command", labelKey: "session.permission_detail_command", multiline: true },
  { key: "description", labelKey: "session.permission_detail_description" },
  { key: "cwd", labelKey: "session.permission_detail_cwd" },
  { key: "filepath", labelKey: "session.permission_detail_file" },
  { key: "filePath", labelKey: "session.permission_detail_file" },
  { key: "path", labelKey: "session.permission_detail_path" },
  { key: "target", labelKey: "session.permission_detail_target" },
  { key: "parentDir", labelKey: "session.permission_detail_parent_directory" },
  { key: "url", labelKey: "session.permission_detail_url" },
  { key: "query", labelKey: "session.permission_detail_query", multiline: true },
  { key: "subagent_type", labelKey: "session.permission_detail_agent" },
  { key: "tool", labelKey: "session.permission_detail_tool" },
  { key: "files", labelKey: "session.permission_detail_files", multiline: true },
  { key: "diff", labelKey: "session.permission_detail_diff", multiline: true },
];

function readablePermissionLabel(permission: string): string {
  if (permission === "bash") return t("session.permission_kind_bash");
  if (permission === "edit") return t("session.permission_kind_edit");
  if (permission === "read") return t("session.permission_kind_read");
  if (permission === "external_directory") return t("session.permission_kind_external_directory");
  if (permission === "task") return t("session.permission_kind_task");
  if (permission === "todowrite") return t("session.permission_kind_todowrite");
  if (permission === "question") return t("session.permission_kind_question");
  if (permission === "skill") return t("session.permission_kind_skill");
  return permission;
}

function permissionCopy(permission: string): Pick<PermissionPresentation, "title" | "message" | "preferSessionAllow"> {
  if (permission === "bash") {
    return {
      title: t("session.permission_title_bash"),
      message: t("session.permission_message_bash"),
      preferSessionAllow: false,
    };
  }
  if (permission === "edit") {
    return {
      title: t("session.permission_title_edit"),
      message: t("session.permission_message_edit"),
      preferSessionAllow: false,
    };
  }
  if (permission === "read") {
    return {
      title: t("session.permission_title_read"),
      message: t("session.permission_message_read"),
      preferSessionAllow: false,
    };
  }
  if (permission === "external_directory") {
    return {
      title: t("session.permission_title_external_directory"),
      message: t("session.permission_message_external_directory"),
      preferSessionAllow: true,
    };
  }
  if (permission === "task") {
    return {
      title: t("session.permission_title_task"),
      message: t("session.permission_message_task"),
      preferSessionAllow: false,
    };
  }
  return {
    title: t("session.permission_title_generic", undefined, { permission: readablePermissionLabel(permission) }),
    message: t("session.permission_message"),
    preferSessionAllow: false,
  };
}

function fileChangeLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const path =
    (typeof record.relativePath === "string" && record.relativePath.trim()) ||
    (typeof record.filePath === "string" && record.filePath.trim()) ||
    (typeof record.path === "string" && record.path.trim()) ||
    null;
  if (!path) return null;
  const type = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "change";
  return `${type}: ${path}`;
}

function metadataValue(key: string, value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (key === "files" && Array.isArray(value)) {
    const lines = value.flatMap((item) => {
      const line = fileChangeLine(item);
      return line ? [line] : [];
    });
    return lines.length ? lines.join("\n") : null;
  }
  return null;
}

export function permissionDetailRows(metadata: Record<string, unknown>): PermissionDetail[] {
  const seen = new Set<string>();
  const rows: PermissionDetail[] = [];
  for (const item of metadataDetailKeys) {
    if (seen.has(item.labelKey)) continue;
    const value = metadataValue(item.key, metadata[item.key]);
    if (!value) continue;
    seen.add(item.labelKey);
    rows.push({
      label: t(item.labelKey),
      value,
      multiline: item.multiline,
    });
  }
  return rows;
}

function stringifyMetadata(metadata: Record<string, unknown>, safeStringify?: (value: unknown) => string) {
  try {
    return safeStringify ? safeStringify(metadata) : JSON.stringify(metadata, null, 2);
  } catch {
    return t("session.permission_metadata_unavailable");
  }
}

function isFocusableElement(element: HTMLElement) {
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Soft-truncate long absolute paths for the compact panel. */
export function formatPermissionPath(value: string, max = 52): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized || normalized.length <= max) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] ?? normalized;
  const parent = parts[parts.length - 2];
  const tail = parent ? `${parent}/${leaf}` : leaf;
  if (tail.length >= max - 1) {
    const keep = Math.max(12, max - 2);
    return `…${leaf.slice(-keep)}`;
  }
  const headBudget = max - tail.length - 1;
  if (headBudget < 8) return `…/${tail}`;
  return `${normalized.slice(0, headBudget)}…/${tail}`;
}

function describePermissionRequest(permission: PendingPermission): PermissionPresentation {
  const patterns = permission.patterns.filter((pattern) => pattern.trim().length > 0);
  if (permission.permission === "doom_loop") {
    const tool =
      permission.metadata && typeof permission.metadata === "object" && typeof permission.metadata.tool === "string"
        ? permission.metadata.tool
        : null;

    return {
      title: t("session.doom_loop_title"),
      message: t("session.doom_loop_message"),
      permissionLabel: t("session.doom_loop_label"),
      scopeLabel: tool ? t("session.doom_loop_tool_label") : t("session.doom_loop_repeated_call_label"),
      scopeValue: tool ?? (patterns.length ? patterns.join(", ") : t("session.doom_loop_repeated_tool_call")),
      isDoomLoop: true,
      note: t("session.doom_loop_note"),
      preferSessionAllow: false,
    };
  }

  const copy = permissionCopy(permission.permission);
  return {
    title: copy.title,
    message: copy.message,
    permissionLabel: readablePermissionLabel(permission.permission),
    scopeLabel: t("session.scope_label"),
    scopeValue: patterns.join(", ") || t("session.permission_scope_empty"),
    isDoomLoop: false,
    note: copy.preferSessionAllow ? t("session.permission_external_note") : null,
    preferSessionAllow: copy.preferSessionAllow,
  };
}

function PermissionActionBar(props: {
  permissionId: string;
  permissionKind?: string;
  busy?: boolean;
  preferSessionAllow?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  stacked?: boolean;
}) {
  const local = useLocal();
  const disabled = props.busy || !props.respondPermission;
  const showFullAccess = props.permissionKind === "external_directory";
  const enableFullAccess = () => {
    local.setPrefs((previous) => ({
      ...previous,
      externalDirectoryAccess: "full",
    }));
    props.respondPermission?.(props.permissionId, "always");
  };
  const onceButton = (
    <Button
      type="button"
      size="sm"
      variant={props.preferSessionAllow ? "outline" : "default"}
      className="min-h-9 min-w-0 max-w-full shadow-sm"
      onClick={() => props.respondPermission?.(props.permissionId, "once")}
      disabled={disabled}
    >
      <Clock3 data-icon="inline-start" />
      <span className="truncate">{t("session.allow_once")}</span>
    </Button>
  );
  const alwaysButton = (
    <Button
      type="button"
      size="sm"
      variant={props.preferSessionAllow ? "default" : "outline"}
      className={cn(
        "min-h-9 min-w-0 max-w-full",
        props.preferSessionAllow && "sm:min-w-[9.5rem]",
      )}
      onClick={() => props.respondPermission?.(props.permissionId, "always")}
      disabled={disabled}
    >
      <Check data-icon="inline-start" />
      <span className="truncate">
        {props.preferSessionAllow
          ? t("session.allow_for_session_external")
          : t("session.allow_for_session")}
      </span>
    </Button>
  );
  const fullAccessButton = showFullAccess ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="min-h-9 min-w-0 max-w-full border-amber-7/40 text-amber-11 hover:bg-amber-3/30"
      onClick={enableFullAccess}
      disabled={disabled}
    >
      <ShieldAlert data-icon="inline-start" />
      <span className="truncate">{t("session.allow_full_external_access")}</span>
    </Button>
  ) : null;
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-2",
        props.stacked ? "justify-stretch sm:justify-end" : "justify-between",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-9 min-w-0 max-w-full text-red-11 hover:bg-red-3/40 hover:text-red-11"
        onClick={() => props.respondPermission?.(props.permissionId, "reject")}
        disabled={disabled}
      >
        <XCircle data-icon="inline-start" />
        <span className="truncate">{t("session.deny")}</span>
      </Button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {onceButton}
        {alwaysButton}
        {fullAccessButton}
      </div>
    </div>
  );
}

function PermissionPathChip(props: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2",
        props.emphasize
          ? "border-[rgba(var(--dls-accent-rgb),0.22)] bg-[rgba(var(--dls-accent-rgb),0.06)]"
          : "border-dls-border/80 bg-dls-hover/40",
      )}
    >
      <FolderOpen size={14} className="mt-0.5 shrink-0 text-dls-secondary" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium tracking-wide text-dls-secondary">{props.label}</div>
        <div
          className="mt-0.5 break-all font-mono text-[12px] leading-5 text-dls-text"
          title={props.value}
        >
          {formatPermissionPath(props.value)}
        </div>
      </div>
    </div>
  );
}

export function PermissionApprovalModal(props: PermissionApprovalModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const presentation = useMemo(() => describePermissionRequest(props.permission), [props.permission]);
  const metadata =
    props.permission.metadata && typeof props.permission.metadata === "object"
      ? props.permission.metadata
      : {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const detailRows = permissionDetailRows(metadata);
  const Icon = presentation.isDoomLoop ? RefreshCcw : ShieldCheck;
  const iconClass = presentation.isDoomLoop
    ? "bg-amber-3/40 text-amber-11 ring-1 ring-amber-7/25"
    : "bg-[rgba(var(--dls-accent-rgb),0.12)] text-dls-accent ring-1 ring-[rgba(var(--dls-accent-rgb),0.22)]";

  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      previousActiveElementRef.current?.focus({ preventScroll: true });
    };
  }, [props.permission.id]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.respondPermission?.(props.permission.id, "reject");
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isFocusableElement);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden border-dls-border p-0 sm:max-w-lg"
      >
        <AlertDialogHeader className="shrink-0 space-y-0 border-b border-dls-border px-5 py-4 text-left">
          <div className="flex items-start gap-3.5">
            <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", iconClass)}>
              <Icon size={22} strokeWidth={1.9} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium tracking-wide text-dls-secondary">
                {t("session.permission_badge")}
              </div>
              <AlertDialogTitle className="mt-1 text-[17px] font-semibold leading-6">
                {presentation.title}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1.5 text-[13px] leading-5 text-dls-secondary">
                {presentation.message}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <PermissionPathChip
            label={presentation.scopeLabel}
            value={presentation.scopeValue}
            emphasize={presentation.preferSessionAllow}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex max-w-full items-center rounded-full border border-dls-border bg-dls-hover/50 px-2.5 py-1 text-[11px] font-medium text-dls-secondary">
              <span className="truncate">{presentation.permissionLabel}</span>
            </span>
            {presentation.note ? (
              <span className="min-w-0 flex-1 text-[12px] leading-5 text-dls-secondary">{presentation.note}</span>
            ) : null}
          </div>

          {detailRows.length > 0 || hasMetadata ? (
            <details className="group rounded-2xl border border-dls-border bg-dls-surface px-3.5 py-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-dls-text">
                <span>{t("session.details_label")}</span>
                <ChevronRight size={15} className="shrink-0 text-dls-secondary transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-2.5 space-y-2.5">
                {detailRows.map((row) => (
                  <div key={row.label}>
                    <div className="text-[12px] font-medium text-dls-secondary">{row.label}</div>
                    <div
                      className={cn(
                        "mt-1 rounded-xl border border-dls-border bg-dls-hover/50 px-3 py-2 font-mono text-[12px] leading-5 text-dls-text",
                        row.multiline ? "max-h-40 overflow-auto whitespace-pre-wrap" : "break-all",
                      )}
                    >
                      {row.value}
                    </div>
                  </div>
                ))}
                {hasMetadata ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-dls-border bg-dls-hover/45 px-3 py-2.5 text-[12px] leading-5 text-dls-secondary">
                    {stringifyMetadata(metadata, props.safeStringify)}
                  </pre>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        <AlertDialogFooter className="shrink-0 flex-col gap-3 border-t border-dls-border bg-dls-hover/25 px-5 py-4 sm:flex-col">
          <p className="w-full text-left text-[12px] leading-5 text-dls-secondary">
            {presentation.preferSessionAllow
              ? t("session.permission_decision_hint_external")
              : t("session.permission_decision_hint")}
          </p>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto]">
            <AlertDialogAction
              variant="ghost"
              className="justify-center text-red-11 hover:bg-red-3/40 hover:text-red-11 sm:justify-self-start"
              onClick={() => props.respondPermission?.(props.permission.id, "reject")}
              disabled={props.busy || !props.respondPermission}
            >
              <XCircle data-icon="inline-start" />
              {t("session.deny")}
            </AlertDialogAction>
            <AlertDialogAction
              variant={presentation.preferSessionAllow ? "outline" : "default"}
              className="justify-center shadow-sm"
              onClick={() => props.respondPermission?.(props.permission.id, "once")}
              disabled={props.busy || !props.respondPermission}
            >
              <Clock3 data-icon="inline-start" />
              {t("session.allow_once")}
            </AlertDialogAction>
            <AlertDialogAction
              variant={presentation.preferSessionAllow ? "default" : "outline"}
              className="justify-center sm:justify-self-end"
              onClick={() => props.respondPermission?.(props.permission.id, "always")}
              disabled={props.busy || !props.respondPermission}
            >
              <Check data-icon="inline-start" />
              {presentation.preferSessionAllow
                ? t("session.allow_for_session_external")
                : t("session.allow_for_session")}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PermissionApprovalPanel(props: PermissionApprovalModalProps) {
  const presentation = useMemo(() => describePermissionRequest(props.permission), [props.permission]);
  const metadata =
    props.permission.metadata && typeof props.permission.metadata === "object"
      ? props.permission.metadata
      : {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const detailRows = permissionDetailRows(metadata);
  const Icon = presentation.isDoomLoop ? RefreshCcw : ShieldCheck;
  const tone = presentation.isDoomLoop
    ? {
        shell: "border-amber-7/30 from-amber-2/50 to-dls-surface",
        icon: "bg-amber-3/50 text-amber-11 ring-1 ring-amber-7/30",
      }
    : {
        shell: "border-[rgba(var(--dls-accent-rgb),0.22)] from-[rgba(var(--dls-accent-rgb),0.08)] to-dls-surface",
        icon: "bg-[rgba(var(--dls-accent-rgb),0.12)] text-dls-accent ring-1 ring-[rgba(var(--dls-accent-rgb),0.22)]",
      };

  return (
    <div className="px-3 pb-2 pt-1">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-gradient-to-b shadow-[0_8px_24px_rgba(0,0,0,0.06)]",
          tone.shell,
        )}
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", tone.icon)}>
            <Icon size={17} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center rounded-full border border-dls-border/80 bg-dls-surface/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-dls-secondary">
                <span className="truncate">{t("session.permission_badge")}</span>
              </span>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-dls-border/70 bg-dls-hover/35 px-2 py-0.5 text-[10px] font-medium text-dls-secondary">
                <HardDrive size={11} className="shrink-0" />
                <span className="truncate">{presentation.permissionLabel}</span>
              </span>
            </div>
            <div className="mt-1.5 text-[14px] font-semibold leading-5 text-dls-text">
              {presentation.title}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-dls-secondary">{presentation.message}</div>
            {presentation.isDoomLoop && presentation.note ? (
              <div className="mt-1 text-[12px] leading-5 text-dls-secondary">{presentation.note}</div>
            ) : null}
          </div>
        </div>

        <div className="space-y-2.5 border-t border-dls-border/80 bg-dls-surface/70 px-4 py-3">
          <PermissionPathChip
            label={presentation.scopeLabel}
            value={presentation.scopeValue}
            emphasize={presentation.preferSessionAllow}
          />

          {detailRows.length > 0 || hasMetadata ? (
            <details className="group rounded-xl border border-dls-border/80 bg-dls-hover/25 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-medium text-dls-text">
                <span>{t("session.details_label")}</span>
                <ChevronRight size={14} className="shrink-0 text-dls-secondary transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-2 space-y-2">
                {detailRows.map((row) => (
                  <div key={row.label} className="min-w-0">
                    <div className="text-[11px] font-medium text-dls-secondary">{row.label}</div>
                    <div
                      className={cn(
                        "mt-1 rounded-lg border border-dls-border/80 bg-dls-hover/35 px-2.5 py-1.5 font-mono text-[11px] leading-5 text-dls-text",
                        row.multiline ? "max-h-24 overflow-auto whitespace-pre-wrap" : "break-all",
                      )}
                      title={row.value}
                    >
                      {row.value}
                    </div>
                  </div>
                ))}
                {hasMetadata ? (
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-dls-hover/45 px-3 py-2 text-[11px] leading-5 text-dls-secondary">
                    {stringifyMetadata(metadata, props.safeStringify)}
                  </pre>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        <div className="border-t border-dls-border/80 bg-dls-hover/20 px-4 py-3">
          <PermissionActionBar
            permissionId={props.permission.id}
            permissionKind={props.permission.permission}
            busy={props.busy}
            preferSessionAllow={presentation.preferSessionAllow}
            respondPermission={props.respondPermission}
            stacked
          />
          <p className="mt-2 text-[11px] leading-4 text-dls-secondary">
            {presentation.preferSessionAllow
              ? t("session.permission_decision_hint_external")
              : t("session.permission_decision_hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
