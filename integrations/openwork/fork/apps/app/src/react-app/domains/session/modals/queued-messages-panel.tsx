/** @jsxImportSource react */
import { useLayoutEffect, useRef } from "react";
import { ArrowUp, ListPlus, X } from "lucide-react";

import { t } from "@/i18n";

/** Cap for the auto-growing queued-message editor; beyond this it scrolls. */
const QUEUED_EDITOR_MAX_HEIGHT_PX = 160;

type QueuedMessageEditorProps = {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onChange: (text: string) => void;
};

/**
 * Auto-height textarea: starts at one line, grows with content, and stops at
 * QUEUED_EDITOR_MAX_HEIGHT_PX (inner scroll takes over past the cap).
 */
function QueuedMessageEditor(props: QueuedMessageEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, QUEUED_EDITOR_MAX_HEIGHT_PX)}px`;
  }, [props.value]);

  return (
    <textarea
      ref={textareaRef}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      rows={1}
      placeholder={props.placeholder}
      className="max-h-40 w-full min-w-0 resize-none overflow-y-auto rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm leading-5 text-gray-11 outline-none transition-[border-color,background-color] placeholder:text-gray-9 focus:border-gray-6 focus:bg-background"
      aria-label={props.ariaLabel}
    />
  );
}

export type QueuedMessagesPanelProps = {
  messages: string[];
  /** Optional hint under empty text (e.g. attachments-only queue entry). */
  attachmentHints?: Array<string | null>;
  onRemove: (index: number) => void;
  onChange?: (index: number, text: string) => void;
  /** Send a single queued entry immediately (do not wait for idle). */
  onSendNow?: (index: number) => void | Promise<void>;
  sendDisabled?: boolean;
};

/**
 * Shows the follow-up messages the user has queued while the agent is busy.
 * Rendered above the composer (mirrors the QuestionPanel header style). Each
 * entry can be edited, sent immediately, or removed.
 */
export function QueuedMessagesPanel(props: QueuedMessagesPanelProps) {
  if (props.messages.length === 0) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="border-b border-dls-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-gray-7/40 bg-gray-3/40 text-gray-11">
            <ListPlus size={12} />
          </div>
          <div className="min-w-0 flex-1 text-sm font-medium leading-5 text-gray-12">
            {t("composer.queued_count", { count: props.messages.length })}
          </div>
        </div>
      </div>

      <div className="max-h-[min(40vh,320px)] space-y-2 overflow-auto px-4 py-3">
        {props.messages.map((message, index) => (
          <div
            key={index}
            className="flex items-start justify-between gap-3 rounded-xl border border-gray-6 bg-gray-1 px-3 py-2.5"
          >
            {props.onChange ? (
              <div className="min-w-0 flex-1">
                <QueuedMessageEditor
                  value={message}
                  onChange={(text) => props.onChange?.(index, text)}
                  placeholder={props.attachmentHints?.[index] ?? undefined}
                  ariaLabel={t("composer.queued_count", { count: props.messages.length })}
                />
              </div>
            ) : (
              <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-5 text-gray-11">
                {message || props.attachmentHints?.[index] || ""}
              </div>
            )}
            <div className="mt-0.5 flex shrink-0 items-center gap-1">
              {props.onSendNow ? (
                <button
                  type="button"
                  onClick={() => void props.onSendNow?.(index)}
                  disabled={props.sendDisabled || (!message.trim() && !props.attachmentHints?.[index])}
                  className={`inline-flex h-7 max-h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                    props.sendDisabled || (!message.trim() && !props.attachmentHints?.[index])
                      ? "cursor-not-allowed bg-gray-4 text-gray-10"
                      : "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]"
                  }`}
                  title={t("composer.steer_hint")}
                >
                  <ArrowUp size={12} />
                  <span>{t("composer.run_task")}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => props.onRemove(index)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
                title={t("common.remove")}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
