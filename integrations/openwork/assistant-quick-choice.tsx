import * as React from "react";
import { Check, ChevronDown, ImagePlus, PencilLine, RotateCcw, Send, X } from "lucide-react";

import { cn } from "@/lib/utils";

type ChoiceMode = "single" | "multiple" | "text";

type QuickChoiceOption = {
  label: string;
  value?: string;
};

export type AssistantQuickChoiceQuestion = {
  id: string;
  label: string;
  helper?: string;
  mode: ChoiceMode;
  options: QuickChoiceOption[];
  allowCustom?: boolean;
  customPlaceholder?: string;
};

export type AssistantQuickChoiceSpec = {
  title?: string;
  submitLabel?: string;
  fillLabel?: string;
  questions: AssistantQuickChoiceQuestion[];
};

const EXPLICIT_SPEC_RE = /```(?:wodeapp-choices|quick-choices)\s*([\s\S]*?)```/gi;
const NUMBERED_QUESTION_RE = /^\s*(?:\d+[\.\、)]|[-*])\s*(?:\*\*)?(.+?)(?:\*\*)?\s*[—–-]\s*(.+)$/;
const PLAIN_QUESTION_RE = /^\s*(?:\*\*)?([^—–\n-]{2,40}?)(?:\*\*)?\s*[—–-]\s*(.+)$/;

function cleanText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueOptions(options: string[]) {
  const seen = new Set<string>();
  return options
    .map(cleanText)
    .filter((option) => option && option.length <= 80)
    .filter((option) => {
      const key = option.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((label) => ({ label, value: label }));
}

/** Remove machine-readable choice blocks from assistant markdown. */
export function stripAssistantQuickChoiceBlocks(text: string): string {
  return text.replace(EXPLICIT_SPEC_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function parseBodyOptions(body: string) {
  const cleaned = body
    .replace(/^(比如|例如|如|像是?)[：:]?\s*/i, "")
    .replace(/[?？。！!…]+$/g, "")
    .trim();
  const parts = cleaned
    .split(/(?:、|，|,|或者|或是|还是|\/)/)
    .map((part) => part.replace(/^[或\s]+/, "").trim())
    .filter((part) => part.length >= 2 && part.length <= 80);
  return parts.length >= 2 ? uniqueOptions(parts) : [];
}

function extractInlineOptions(body: string) {
  const ratioMatches = body.match(/\d+\s*:\s*\d+(?:[（(][^）)]{1,24}[）)])?/g);
  if (ratioMatches && ratioMatches.length >= 2) {
    return uniqueOptions(ratioMatches);
  }

  const firstQuestion = body.split(/[?？]/)[0] ?? body;
  const optionSource = firstQuestion.includes("比如")
    ? firstQuestion.slice(firstQuestion.indexOf("比如") + 2)
    : firstQuestion;
  const cleaned = optionSource
    .replace(/等$/, "")
    .replace(/会影响.*$/, "")
    .replace(/如果.*$/, "")
    .trim();
  const parts = cleaned.split(/[、，,]/).map((part) => part.replace(/^或/, "").trim());
  return parts.length >= 2 ? uniqueOptions(parts) : [];
}

function isQuestionBoundaryLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return NUMBERED_QUESTION_RE.test(line) || PLAIN_QUESTION_RE.test(line);
}

function collectFollowingOptions(lines: string[], startIndex: number) {
  const options: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      if (options.length >= 2) break;
      continue;
    }
    if (isQuestionBoundaryLine(raw)) break;
    if (/^(请告诉|如果你|默认|#{1,3}\s|```|好的，)/.test(line)) break;

    const bullet = line.match(/^(?:[-*•]|\d+[\.\)、])\s*(.+)$/);
    if (bullet?.[1]) {
      options.push(cleanText(bullet[1]));
      continue;
    }

    if (line.length <= 80 && !/[?？]$/.test(line) && !/^(你是|我可以|或者)/.test(line)) {
      options.push(cleanText(line));
      continue;
    }

    if (options.length >= 2) break;
    break;
  }
  return options;
}

function extractOptions(body: string, followingLines: string[] = []) {
  const fromFollowing = uniqueOptions(followingLines);
  if (fromFollowing.length >= 2) return fromFollowing;

  const fromBody = parseBodyOptions(body);
  if (fromBody.length >= 2) return fromBody;

  return extractInlineOptions(body);
}

function questionMode(label: string, body: string, options: QuickChoiceOption[]): ChoiceMode {
  if (options.length === 0) return "text";
  if (/多选|哪些|包括|核心功能/.test(`${label} ${body}`)) return "multiple";
  if (options.length > 1 && /风格|类型|题材|平台|渠道/.test(label)) return "multiple";
  return "single";
}

function slugQuestionId(index: number, label: string) {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `question-${index + 1}`;
}

function normalizeExplicitQuestion(input: unknown, index: number): AssistantQuickChoiceQuestion | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const label = typeof record.label === "string" ? cleanText(record.label) : "";
  if (!label) return null;
  const modeValue = typeof record.mode === "string" ? record.mode : "single";
  const mode: ChoiceMode = modeValue === "multiple" || modeValue === "text" ? modeValue : "single";
  const options = Array.isArray(record.options)
    ? record.options.flatMap((option): QuickChoiceOption[] => {
        if (typeof option === "string") return [{ label: cleanText(option), value: cleanText(option) }];
        if (!option || typeof option !== "object" || Array.isArray(option)) return [];
        const optionRecord = option as Record<string, unknown>;
        const optionLabel = typeof optionRecord.label === "string" ? cleanText(optionRecord.label) : "";
        if (!optionLabel) return [];
        return [{
          label: optionLabel,
          value: typeof optionRecord.value === "string" ? optionRecord.value : optionLabel,
        }];
      })
    : [];
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : slugQuestionId(index, label),
    label,
    helper: typeof record.helper === "string" ? cleanText(record.helper) : undefined,
    mode,
    options,
    allowCustom: record.allowCustom !== false,
    customPlaceholder: typeof record.customPlaceholder === "string" ? record.customPlaceholder : undefined,
  };
}

function parseExplicitSpec(text: string): AssistantQuickChoiceSpec | null {
  const match = text.match(/```(?:wodeapp-choices|quick-choices)\s*([\s\S]*?)```/i);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const questions = Array.isArray(record.questions)
      ? record.questions.flatMap((question, index) => {
          const normalized = normalizeExplicitQuestion(question, index);
          return normalized ? [normalized] : [];
        })
      : [];
    if (!questions.length) return null;
    return {
      title: typeof record.title === "string" ? cleanText(record.title) : undefined,
      submitLabel: typeof record.submitLabel === "string" ? cleanText(record.submitLabel) : undefined,
      fillLabel: typeof record.fillLabel === "string" ? cleanText(record.fillLabel) : undefined,
      questions,
    };
  } catch {
    return null;
  }
}

function parseQuestionLine(line: string) {
  const numbered = line.match(NUMBERED_QUESTION_RE);
  if (numbered?.[1] && numbered[2]) {
    return { label: cleanText(numbered[1]), body: cleanText(numbered[2]) };
  }
  const plain = line.match(PLAIN_QUESTION_RE);
  if (plain?.[1] && plain[2]) {
    return { label: cleanText(plain[1]), body: cleanText(plain[2]) };
  }
  return null;
}

function parseNumberedQuestions(text: string): AssistantQuickChoiceSpec | null {
  const lines = text.split(/\r?\n/);
  const questions: AssistantQuickChoiceQuestion[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseQuestionLine(lines[index]);
    if (!parsed?.label || !parsed.body) continue;

    const following = collectFollowingOptions(lines, index + 1);
    const options = extractOptions(parsed.body, following);
    questions.push({
      id: slugQuestionId(questions.length, parsed.label),
      label: parsed.label,
      helper: parsed.body.length > 42 ? parsed.body : undefined,
      mode: questionMode(parsed.label, parsed.body, options),
      options,
      allowCustom: true,
      customPlaceholder: options.length ? "其他补充..." : "请输入...",
    });
  }

  if (questions.length < 2) return null;
  return {
    title: "快速确认",
    submitLabel: "发送选择",
    fillLabel: "填入输入框",
    questions,
  };
}

export function parseAssistantQuickChoice(text: string): AssistantQuickChoiceSpec | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 12000) return null;
  // Only render the quick-choice card when the model emits an explicit
  // ```wodeapp-choices JSON block. The old numbered/dash heuristic hijacked
  // normal prose (loglines, numbered beats, "Ep1-10" ranges) into garbled cards.
  return parseExplicitSpec(trimmed);
}

type AssistantQuickChoiceProps = {
  spec: AssistantQuickChoiceSpec;
  onSetPrompt: (prompt: string, files?: File[]) => void;
  onSubmitPrompt?: (prompt: string, files?: File[]) => void;
};

function optionValue(option: QuickChoiceOption) {
  return option.value ?? option.label;
}

function buildReply(
  spec: AssistantQuickChoiceSpec,
  selected: Record<string, string[]>,
  custom: Record<string, string>,
  uploads: Record<string, File[]>,
) {
  const lines = spec.questions.flatMap((question) => {
    const values = [...(selected[question.id] ?? [])];
    const customValue = custom[question.id]?.trim();
    if (customValue) values.push(customValue);
    const uploadedFiles = uploads[question.id] ?? [];
    if (uploadedFiles.length > 0) {
      values.push(`已上传${uploadedFiles.length}张：${uploadedFiles.map((file) => file.name).join("、")}`);
    }
    const normalized = values.map(cleanText).filter(Boolean);
    if (!normalized.length) return [];
    return [`- ${question.label}: ${normalized.join("、")}`];
  });
  if (!lines.length) return "";
  return `这些选项我先这样确认：\n\n${lines.join("\n")}\n\n请按以上选择继续。请用自然、可读的中文直接回答并交付下一步内容（按当前任务可能是方案、脚本、图片或视频计划），不要把 shell/工具调用当作对用户可见的主要回复。`;
}

function questionAcceptsImageUpload(question: AssistantQuickChoiceQuestion) {
  const promptText = [
    question.label,
    question.helper ?? "",
    question.customPlaceholder ?? "",
  ].join(" ");
  const optionText = question.options.map((option) => option.label).join(" ");
  return (
    /参考图|参考图片|参考照片|图片|照片|图像|素材|底图|商品图|上传|本地准备|jpe?g|png|webp|heic/i.test(promptText) ||
    /上传图片|上传照片|选择图片|选择照片|本地准备|jpe?g|png|webp|heic/i.test(optionText)
  );
}

function allUploadedFiles(uploads: Record<string, File[]>) {
  return Object.values(uploads).flat();
}

export function AssistantQuickChoice({ spec, onSetPrompt, onSubmitPrompt }: AssistantQuickChoiceProps) {
  const [selected, setSelected] = React.useState<Record<string, string[]>>({});
  const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [uploads, setUploads] = React.useState<Record<string, File[]>>({});
  const [collapsed, setCollapsed] = React.useState(true);

  const reply = React.useMemo(() => buildReply(spec, selected, custom, uploads), [custom, selected, spec, uploads]);
  const uploadedFiles = React.useMemo(() => allUploadedFiles(uploads), [uploads]);
  const hasReply = reply.trim().length > 0;

  const toggleOption = React.useCallback((question: AssistantQuickChoiceQuestion, value: string) => {
    setSelected((current) => {
      const currentValues = current[question.id] ?? [];
      if (question.mode === "multiple") {
        const nextValues = currentValues.includes(value)
          ? currentValues.filter((item) => item !== value)
          : [...currentValues, value];
        return { ...current, [question.id]: nextValues };
      }
      return { ...current, [question.id]: currentValues.includes(value) ? [] : [value] };
    });
  }, []);

  const reset = React.useCallback(() => {
    setSelected({});
    setCustom({});
    setUploads({});
  }, []);

  const addUploads = React.useCallback((questionId: string, files: FileList | null) => {
    const nextFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!nextFiles.length) return;
    setUploads((current) => ({
      ...current,
      [questionId]: [...(current[questionId] ?? []), ...nextFiles],
    }));
  }, []);

  const removeUpload = React.useCallback((questionId: string, index: number) => {
    setUploads((current) => {
      const currentFiles = current[questionId] ?? [];
      const nextFiles = currentFiles.filter((_file, fileIndex) => fileIndex !== index);
      return { ...current, [questionId]: nextFiles };
    });
  }, []);

  return (
    <div className="not-prose mt-3 flex w-full max-w-full flex-col gap-4 rounded-lg border border-dls-border/80 bg-dls-surface/80 px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-dls-secondary transition-transform",
              collapsed ? "-rotate-90" : "rotate-0",
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-dls-text">{spec.title ?? "快速确认"}</div>
            <div className="mt-0.5 break-words text-xs text-dls-secondary">
              {collapsed ? "可选辅助，点击展开快速选择选项。" : "可单选、多选，也可以直接补充自定义内容。"}
            </div>
          </div>
        </button>
        {collapsed ? null : (
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-dls-border bg-dls-surface text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
            onClick={reset}
            aria-label="重置选择"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>

      {collapsed ? null : (
      <>
      <div className="flex flex-col gap-4">
        {spec.questions.map((question) => {
          const values = selected[question.id] ?? [];
          const questionUploads = uploads[question.id] ?? [];
          const acceptsUpload = questionAcceptsImageUpload(question);
          return (
            <div key={question.id} className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <div className="min-w-0 break-words text-sm font-semibold text-dls-text">{question.label}</div>
                {question.mode === "multiple" ? (
                  <div className="text-xs text-dls-secondary">多选</div>
                ) : null}
              </div>
              {question.helper ? (
                <div className="mt-1 break-words text-xs leading-relaxed text-dls-secondary">{question.helper}</div>
              ) : null}

              {question.options.length > 0 ? (
                <div className="mt-2 flex max-w-full flex-wrap gap-2 overflow-visible">
                  {question.options.map((option) => {
                    const value = optionValue(option);
                    const active = values.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "inline-flex min-h-9 max-w-full min-w-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-left text-sm font-medium transition-colors",
                          active
                            ? "border-dls-text bg-dls-text text-dls-surface"
                            : "border-dls-border bg-dls-surface text-dls-text shadow-sm hover:bg-dls-hover",
                        )}
                        onClick={() => toggleOption(question, value)}
                        aria-pressed={active}
                      >
                        {question.mode === "multiple" ? (
                          <span
                            className={cn(
                              "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                              active ? "border-dls-surface text-dls-surface" : "border-dls-border text-transparent",
                            )}
                            aria-hidden
                          >
                            <Check className="size-3" />
                          </span>
                        ) : null}
                        <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {question.allowCustom !== false ? (
                <input
                  className="mt-2 h-9 w-full max-w-sm rounded-full border border-dls-border bg-dls-surface px-3.5 text-sm text-dls-text outline-none transition-colors placeholder:text-dls-secondary focus:border-dls-text"
                  value={custom[question.id] ?? ""}
                  onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
                  placeholder={question.customPlaceholder ?? "Other..."}
                />
              ) : null}

              {acceptsUpload ? (
                <div className="mt-2 flex max-w-full flex-col gap-2">
                  <label className="inline-flex min-h-9 w-fit max-w-full cursor-pointer items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-3.5 py-1.5 text-sm font-medium text-dls-text shadow-sm transition-colors hover:bg-dls-hover">
                    <ImagePlus className="size-3.5 shrink-0" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">上传图片</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        addUploads(question.id, event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {questionUploads.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-2">
                      {questionUploads.map((file, index) => (
                        <span
                          key={`${file.name}-${file.lastModified}-${index}`}
                          className="inline-flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-full border border-dls-border bg-dls-hover/60 px-3 py-1 text-xs text-dls-text"
                        >
                          <span className="min-w-0 max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</span>
                          <button
                            type="button"
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-dls-secondary transition-colors hover:bg-dls-surface hover:text-dls-text"
                            onClick={() => removeUpload(question.id, index)}
                            aria-label={`移除 ${file.name}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-dls-border/70 pt-3">
        <button
          type="button"
          className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full bg-dls-text px-4 py-1.5 text-sm font-semibold text-dls-surface transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasReply}
          onClick={() => {
            if (!reply) return;
            if (onSubmitPrompt) {
              onSubmitPrompt(reply, uploadedFiles);
              return;
            }
            onSetPrompt(reply, uploadedFiles);
          }}
        >
          <Send className="size-3.5 shrink-0" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{spec.submitLabel ?? "发送选择"}</span>
        </button>
        <button
          type="button"
          className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-4 py-1.5 text-sm font-medium text-dls-text shadow-sm transition-colors hover:bg-dls-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasReply}
          onClick={() => {
            if (reply) onSetPrompt(reply, uploadedFiles);
          }}
        >
          <PencilLine className="size-3.5 shrink-0" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{spec.fillLabel ?? "填入输入框"}</span>
        </button>
      </div>
      </>
      )}
    </div>
  );
}
