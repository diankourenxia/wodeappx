import * as React from "react";

import { cn } from "@/lib/utils";
import { findDigitalAssetByMentionValue } from "@/react-app/domains/wodeapp/digital-assets-store";
import {
  PREVIEW_ASSET_MENTION_EVENT,
  decodeComposerMentionValue,
} from "@/react-app/domains/session/surface/composer/mention-encoding";
import { resolveAssetMentionById } from "@/react-app/domains/wodeapp/wodeapp-workbench-context";

const SENT_ASSET_CONTEXT_START = "[已关联数字资产：只读素材上下文]";
const SENT_ASSET_CONTEXT_END = "[只读素材上下文结束]";
const SENT_ASSET_TOKEN_RE = /@asset:([^\s@]+)/g;

type SentAssetMention = {
  id: string;
  name?: string;
  kind?: string;
};

function assetMentionId(value: string) {
  return decodeComposerMentionValue(value).replace(/^asset:/, "");
}

function sentAssetMentionMeta(mention: SentAssetMention) {
  const value = `asset:${mention.id}`;
  const asset = findDigitalAssetByMentionValue(value) ?? findDigitalAssetByMentionValue(mention.id);
  const remembered = resolveAssetMentionById(mention.id);
  const kind = asset?.kind || remembered?.kind || mention.kind || "数字资产";
  const assetFile = asset?.assetFile || remembered?.assetFile;
  const assetFileType = asset?.assetFileType || remembered?.assetFileType || "";
  const imageUrl = kind === "品牌库" || kind === "提示词"
    ? undefined
    : asset?.coverImage
      || remembered?.coverImage
      || asset?.productImages?.[0]
      || asset?.assetImages?.[0]
      || remembered?.productImages?.[0]
      || remembered?.assetImages?.[0]
      || (assetFileType.startsWith("image/") ? assetFile : undefined);
  const videoUrl = assetFileType.startsWith("video/") ? assetFile : undefined;
  return {
    value,
    name: asset?.name || remembered?.name || mention.name || mention.id,
    kind,
    imageUrl,
    videoUrl,
  };
}

const SentAssetMentionChip = React.memo(function SentAssetMentionChip({ mention }: { mention: SentAssetMention }) {
  const meta = sentAssetMentionMeta(mention);
  const isPrompt = meta.kind === "提示词";
  const initial = Array.from((meta.name || meta.kind || "资").trim())[0] || "资";
  const handlePreview = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent(PREVIEW_ASSET_MENTION_EVENT, { detail: { value: meta.value } }));
  }, [meta.value]);

  return (
    <button
      type="button"
      className={cn(
        "mx-0.5 inline-flex h-9 max-w-full items-center rounded-full border text-[13px] font-semibold leading-none align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-6/40",
        isPrompt
          ? "border-violet-6/35 bg-violet-3/20 px-3 text-violet-11"
          : "gap-2 border-violet-6/35 bg-violet-3/20 pl-1.5 pr-3 text-violet-11",
      )}
      title={`${meta.name} · ${meta.kind}`}
      onClick={handlePreview}
    >
      {!isPrompt ? (
        <span className="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/70 bg-violet-4/50 text-[11px] font-bold text-violet-11">
          {meta.imageUrl ? (
            <img src={meta.imageUrl} alt="" decoding="async" loading="lazy" className="h-full w-full object-cover" />
          ) : meta.videoUrl ? (
            <video src={meta.videoUrl} muted preload="metadata" playsInline className="h-full w-full object-cover" />
          ) : initial}
        </span>
      ) : null}
      <span className="min-w-0 max-w-[190px] overflow-hidden text-ellipsis whitespace-nowrap">@{meta.name}</span>
    </button>
  );
});

function parseSentAssetContext(text: string) {
  const start = text.indexOf(SENT_ASSET_CONTEXT_START);
  if (start < 0) return { visibleText: text, mentions: [] as SentAssetMention[] };
  const end = text.indexOf(SENT_ASSET_CONTEXT_END, start + SENT_ASSET_CONTEXT_START.length);
  const context = text.slice(start + SENT_ASSET_CONTEXT_START.length, end < 0 ? undefined : end);
  const mentions: SentAssetMention[] = [];
  for (const match of context.matchAll(/^\d+\. ([^：\n]+)：([^\n]+)\n资产ID：([^\n]+)$/gm)) {
    const kind = match[1]?.trim();
    const name = match[2]?.trim();
    const id = match[3]?.trim().replace(/^asset:/, "");
    if (id) mentions.push({ id, name, kind });
  }
  let visibleText = text.slice(0, start).trimEnd();
  if (visibleText === "请基于已关联资产继续。" || visibleText.startsWith("请执行以下用户本轮明确选择的提示词；")) {
    visibleText = "";
  }
  return { visibleText, mentions };
}

export function renderUserTextWithResourceChips(
  text: string,
  renderText: (value: string) => React.ReactNode,
) {
  const parsed = parseSentAssetContext(text);
  const inlineMentions: SentAssetMention[] = [];
  let offset = 0;
  const inlineContent = parsed.visibleText.split(SENT_ASSET_TOKEN_RE).map((segment, index) => {
    const key = `${offset}:${segment}`;
    offset += segment.length;
    if (index % 2 === 1) {
      const id = assetMentionId(segment);
      inlineMentions.push({ id });
      return <SentAssetMentionChip key={key} mention={{ id }} />;
    }
    return <React.Fragment key={key}>{renderText(segment)}</React.Fragment>;
  });
  const contextMentions = parsed.mentions.filter(
    (mention) => !inlineMentions.some((inline) => inline.id === mention.id),
  );

  return (
    <>
      {contextMentions.map((mention) => <SentAssetMentionChip key={mention.id} mention={mention} />)}
      {contextMentions.length > 0 && parsed.visibleText ? " " : null}
      {inlineContent}
    </>
  );
}
