/** @jsxImportSource react */
import { BookOpen, Building2, Package, Play, Upload } from "lucide-react";

import type { DigitalAssetItem } from "./digital-assets-data";
import { digitalAssetKindIcon } from "./digital-assets-data";

function promptAssetTheme(category?: string): string {
  switch (category) {
    case "视频":
      return "video";
    case "图片":
      return "image";
    case "人物":
      return "people";
    case "风格":
      return "style";
    case "环境":
      return "scene";
    case "动作":
      return "motion";
    case "光质":
      return "light";
    case "产品图":
      return "product";
    default:
      return "general";
  }
}

function compactAssetCopy(text: string | undefined, maxLength = 54): string {
  if (!text) return "可直接复用到生成任务的内置资产";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function WodeAppAssetTileContent({ item }: { item: DigitalAssetItem }) {
  if (item.preview === "assetUpload" || item.preview === "productUpload" || item.preview === "brandCreate") {
    const actionMeta =
      item.preview === "productUpload"
        ? { icon: Package, className: "is-product", title: "添加商品", copy: "上传商品图和描述" }
        : item.preview === "brandCreate"
          ? { icon: Building2, className: "is-brand", title: "添加品牌", copy: "沉淀 Logo、色彩和规范" }
          : { icon: Upload, className: "is-material", title: "添加素材", copy: "上传图片与参考图" };
    const ActionIcon = actionMeta.icon;
    return (
      <span className={`wx-asset-upload-tile ${actionMeta.className}`} aria-hidden>
        <ActionIcon aria-hidden />
        <strong>{actionMeta.title}</strong>
        <small>{actionMeta.copy}</small>
      </span>
    );
  }

  if (item.preview === "product") {
    const productCover = item.coverImage || item.productImages?.find(Boolean);
    const imageStatusLabel =
      item.productImageSyncStatus === "local-only"
        ? "仅本机"
        : item.productImageSyncStatus === "syncing"
          ? "同步中"
          : item.productImageSyncStatus === "failed"
            ? "未同步"
            : "主图";
    if (productCover) {
      return (
        <span className="wx-asset-cover is-product" aria-hidden>
          <img src={productCover} alt="" loading="lazy" decoding="async" />
          <span className="wx-asset-cover-shade" />
          <span className="wx-asset-cover-chip">{imageStatusLabel}</span>
        </span>
      );
    }
    return (
      <span className="wx-asset-product-scene is-thermos" aria-hidden>
        <span className="wx-asset-product-surface" />
        <span className="wx-asset-product-object" />
        <span className="wx-asset-product-accent" />
        <span className="wx-asset-product-shadow" />
        <span className="wx-asset-product-note">{imageStatusLabel}</span>
      </span>
    );
  }

  if (item.preview === "prompt") {
    const category = item.promptCategory || "通用";
    if (item.coverImage) {
      return (
        <span className={`wx-asset-cover is-prompt is-${promptAssetTheme(category)}`} aria-hidden>
          <img src={item.coverImage} alt="" loading="lazy" decoding="async" />
          <span className="wx-asset-cover-shade" />
          <span className="wx-asset-prompt-cover-copy">
            <b>{category}</b>
            <i>{compactAssetCopy(item.promptText, 36)}</i>
          </span>
        </span>
      );
    }
    return (
      <span className={`wx-asset-prompt-tile is-${promptAssetTheme(category)}`} aria-hidden>
        <span className="wx-asset-prompt-head">
          <BookOpen aria-hidden />
          <b>{category}</b>
        </span>
        <span className="wx-asset-prompt-copy">{compactAssetCopy(item.promptText)}</span>
        <span className="wx-asset-prompt-rule" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }

  if (item.preview === "brand") {
    const colors = item.brandColors?.length ? item.brandColors.slice(0, 4) : ["#FF6600", "#C24F00", "#1A1A1A"];
    const entryCategories = item.brandEntries?.map((entry) => entry.category).filter(Boolean) || [];
    const materials = entryCategories.length
      ? Array.from(new Set(entryCategories)).slice(0, 3)
      : item.brandAssets?.length
        ? ["Logo", "色彩", "规范"]
        : ["Logo", "色彩", "语气"];
    return (
      <span className="wx-asset-brand-tile" aria-hidden>
        <span className="wx-asset-brand-mark">
          {item.coverImage ? <img src={item.coverImage} alt="" loading="lazy" decoding="async" /> : <Building2 aria-hidden />}
        </span>
        <span className="wx-asset-brand-palette">
          {colors.map((color) => (
            <i key={color} style={{ backgroundColor: color }} />
          ))}
        </span>
        <span className="wx-asset-brand-materials">
          {materials.map((material) => (
            <i key={material}>{material}</i>
          ))}
        </span>
        <span className="wx-asset-brand-copy">
          <b>{item.name}</b>
          <small>{compactAssetCopy(item.brandVoice || item.brandRules, 42)}</small>
        </span>
      </span>
    );
  }

  if (item.coverImage) {
    const coverClass =
      item.preview === "video" ? "is-video" : item.preview === "role" ? "is-role" : "is-image";
    return (
      <span className={`wx-asset-cover ${coverClass}`} aria-hidden>
        <img src={item.coverImage} alt="" loading="lazy" decoding="async" />
        <span className="wx-asset-cover-shade" />
        {item.preview === "video" ? (
          <span className="wx-asset-playmark">
            <Play aria-hidden />
          </span>
        ) : null}
        <span className="wx-asset-cover-chip">{item.preview === "video" ? item.durationLabel || item.kind : item.kind}</span>
      </span>
    );
  }

  if (item.preview === "video") {
    return (
      <span className="wx-asset-video-scene is-city-timelapse" aria-hidden>
        <span className="wx-asset-video-frame" />
        <span className="wx-asset-video-skyline" />
        <span className="wx-asset-playmark">
          <Play aria-hidden />
        </span>
        {item.durationLabel ? <span className="wx-asset-duration">{item.durationLabel}</span> : null}
      </span>
    );
  }

  if (item.preview === "script") {
    return (
      <span className="wx-asset-script-tile is-launch-script" aria-hidden>
        <span className="wx-asset-script-tab">TXT</span>
        {["开场", "展示", "收尾"].map((scene, index) => (
          <span className="wx-asset-script-line" key={scene}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <i>{scene}</i>
          </span>
        ))}
      </span>
    );
  }

  if (item.preview === "audio") {
    return (
      <span className="wx-asset-sound-tile is-female-voice" aria-hidden>
        <span className="wx-asset-sound-play">
          <Play aria-hidden />
        </span>
        <span className="wx-asset-mini-wave" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
      </span>
    );
  }

  if (item.preview === "role") {
    return (
      <span className="wx-asset-role-tile is-avatar-host" aria-hidden>
        <span className="wx-asset-role-portrait">
          <span />
        </span>
        <span className="wx-asset-role-strip" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }

  if (item.preview === "image") {
    return (
      <span className="wx-asset-picture-scene is-commerce-poster" aria-hidden>
        <span className="wx-asset-picture-main" />
        <span className="wx-asset-picture-caption">4K</span>
      </span>
    );
  }

  const KindIcon = digitalAssetKindIcon(item.kind);
  return <KindIcon className="wx-asset-placeholder-icon" aria-hidden />;
}
