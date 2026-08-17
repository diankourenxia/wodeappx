import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Loader2, Pencil, X } from "lucide-react";

import { downloadUrl } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { toast } from "@/components/ui/sonner";

export type LightboxImage = {
  src: string;
  alt: string;
};

const BROWSER_IMAGE_DROP_MIME = "application/x-openwork-browser-image";

type ImageLightboxProps = {
  image: LightboxImage | null;
  allowEdit?: boolean;
  onClose: () => void;
};

function imageBytes(value: ArrayBuffer | Uint8Array | number[] | undefined) {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

function imageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  return mimeType.split("/")[1]?.replace("+xml", "") || "png";
}

function imageDownloadName(image: LightboxImage, mimeType = "image/png", preferredName = "") {
  let name = preferredName.trim();
  if (!name) {
    try {
      name = decodeURIComponent(new URL(image.src).pathname.split("/").pop() || "");
    } catch {}
  }
  if (!name) name = image.alt.trim() || "image";
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 120).trim() || "image";
  if (!/\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(name)) {
    name = `${name}.${imageExtension(mimeType)}`;
  }
  return name;
}

async function downloadableImage(image: LightboxImage) {
  const bridge = window.__OPENWORK_ELECTRON__?.browser?.readImageForComposer;
  if (bridge) {
    try {
      const readImage = bridge as unknown as (
        payload: string | { url: string; label: string; name: string },
      ) => ReturnType<NonNullable<typeof bridge>>;
      let result: Awaited<ReturnType<NonNullable<typeof bridge>>>;
      try {
        result = await readImage({ url: image.src, label: image.alt, name: image.alt });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");
        if (!message.includes("No image URL found")) throw error;
        result = await readImage(image.src);
      }
      const bytes = imageBytes(result?.bytes);
      if (!result?.error && bytes) {
        const mimeType = result.mimeType?.startsWith("image/") ? result.mimeType : "image/png";
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return {
          blob: new Blob([buffer], { type: mimeType }),
          name: imageDownloadName(image, mimeType, result.name),
        };
      }
    } catch {}
  }

  const response = await fetch(image.src, { credentials: "include" });
  if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`);
  const blob = await response.blob();
  const mimeType = blob.type.startsWith("image/") ? blob.type : "image/png";
  return { blob, name: imageDownloadName(image, mimeType) };
}

function clickDownload(href: string, name: string, openFallback = false) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  if (openFallback) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
  }
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function blobAsClipboardPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  if (typeof createImageBitmap !== "function") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), "image/png");
    });
    return png || blob;
  } finally {
    bitmap.close();
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function ImageLightbox({ image, allowEdit = false, onClose }: ImageLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyImageRef = useRef<() => Promise<void>>(async () => {});

  const copyImage = async () => {
    if (!image || copying) return;
    setCopying(true);
    try {
      const result = await downloadableImage(image);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          const pngBlob = await blobAsClipboardPng(result.blob);
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": pngBlob }),
          ]);
          toast.message("已复制图片");
          return;
        } catch {
          // fall through to URL copy
        }
      }
      if (await writeClipboardText(image.src)) {
        toast.message("已复制图片链接");
        return;
      }
      toast.error("复制失败");
    } catch {
      if (await writeClipboardText(image.src)) {
        toast.message("已复制图片链接");
      } else {
        toast.error("复制失败");
      }
    } finally {
      setCopying(false);
    }
  };
  copyImageRef.current = copyImage;

  useEffect(() => {
    if (!image || typeof document === "undefined") return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void copyImageRef.current();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [image, onClose]);

  if (!image || typeof document === "undefined") return null;

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Desktop: main-process saves the URL straight into Downloads.
      // Do not round-trip through readImageForComposer / open-in-tab.
      if (isElectronRuntime()) {
        const name = imageDownloadName(image);
        if (image.src.startsWith("blob:")) {
          const response = await fetch(image.src);
          const blob = await response.blob();
          const mimeType = blob.type.startsWith("image/") ? blob.type : "image/png";
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("read failed"));
            reader.readAsDataURL(blob);
          });
          const saved = await downloadUrl({
            url: dataUrl,
            name: imageDownloadName(image, mimeType, name),
            reveal: true,
          });
          if (!saved?.ok) throw new Error(saved?.reason || "download failed");
          toast.message("已保存到下载文件夹");
          return;
        }

        const saved = await downloadUrl({
          url: image.src,
          name,
          reveal: true,
        });
        if (!saved?.ok) throw new Error(saved?.reason || "download failed");
        toast.message("已保存到下载文件夹");
        return;
      }

      const result = await downloadableImage(image);
      const objectUrl = URL.createObjectURL(result.blob);
      clickDownload(objectUrl, result.name);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch {
      try {
        const result = await downloadableImage(image);
        const objectUrl = URL.createObjectURL(result.blob);
        clickDownload(objectUrl, result.name);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      } catch {
        clickDownload(image.src, imageDownloadName(image), true);
      }
    } finally {
      setDownloading(false);
    }
  };

  const edit = async () => {
    if (editing) return;
    setEditing(true);
    const detail = {
      url: image.src,
      sourceUrl: image.src,
      label: image.alt,
      name: image.alt,
      trigger: "lightbox-edit",
    };
    try {
      const result = await downloadableImage(image);
      const file = new File([result.blob], result.name, {
        type: result.blob.type || "image/png",
        lastModified: Date.now(),
      });
      window.dispatchEvent(new CustomEvent("openwork:edit-image", {
        detail: { ...detail, file },
      }));
    } catch {
      window.dispatchEvent(new CustomEvent("openwork:edit-image", { detail }));
    } finally {
      setEditing(false);
      onClose();
    }
  };

  const dragImage = (event: React.DragEvent<HTMLImageElement>) => {
    const url = image.src.trim();
    if (!url) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(BROWSER_IMAGE_DROP_MIME, JSON.stringify({
      url,
      sourceUrl: url,
      label: image.alt,
      name: image.alt,
      trigger: "lightbox-drag",
    }));
    event.dataTransfer.setData("text/uri-list", url);
    event.dataTransfer.setData("text/plain", url);
    window.setTimeout(onClose, 0);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || "Image preview"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <img
        src={image.src}
        alt={image.alt}
        draggable
        onDragStart={dragImage}
        className="block max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] cursor-grab object-contain active:cursor-grabbing sm:max-h-[calc(100dvh-4rem)] sm:max-w-[calc(100vw-4rem)]"
      />
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {allowEdit ? (
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
            aria-label={t("common.edit")}
            title={t("common.edit")}
            disabled={editing}
            onClick={() => void edit()}
          >
            {editing ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
          aria-label="复制"
          title="复制"
          disabled={copying}
          onClick={() => void copyImage()}
        >
          {copying ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
          aria-label={t("settings.update_download_button")}
          title={t("settings.update_download_button")}
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
