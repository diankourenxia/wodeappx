export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file" | "video" | "audio";
  file: File;
  size: number;
};
export type ComposerAssetMention = Record<string, unknown>;
export type ComposerDraft = {
  mode?: string;
  parts?: unknown[];
  text: string;
  resolvedText?: string;
  attachments: ComposerAttachment[];
  assetMentions?: ComposerAssetMention[];
  systemContext?: string;
};
