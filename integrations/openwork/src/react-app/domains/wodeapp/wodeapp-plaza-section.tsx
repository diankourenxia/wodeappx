/** @jsxImportSource react */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Palette, Sparkles, Upload } from "lucide-react";

import {
  listWodeAppBrandAgents,
  listWodeAppPlazaCatalog,
  saveWodeAppBrandAgents,
  saveWodeAppPlazaCatalog,
} from "@/app/lib/wodeapp-auth";
import { buildBuiltinAgentTask } from "./wodeapp-auto-orchestration";
import {
  brandAgentConfigToBuiltinAgent,
  type WodeAppBrandAgentConfig,
  readStoredWodeAppBrandAgents,
  WODEAPP_BRAND_AGENTS_STORAGE_KEY,
  writeStoredWodeAppBrandAgents,
  normalizeWodeAppBrandAgentsFile,
} from "./wodeapp-brand-agent-config";
import {
  addWodeAppPlazaItems,
  coercePlazaCatalog,
  dropBrandAgent,
  listWodeAppPlazaItems,
  mergeBrandAgentsWithPlaza,
  parsePlazaUpload,
  plazaItemToPack,
  publishAgentToPlaza,
  publishSkinToPlaza,
  removeWodeAppPlazaItem,
  slugifyPlazaId,
  upsertWodeAppPlazaItems,
  type WodeAppPlazaItem,
  type WodeAppPlazaKind,
} from "./wodeapp-plaza";
import { storeWodeAppSkin, type WodeAppSkinPreview } from "./wodeapp-skins";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";

type PlazaFilter = "all" | WodeAppPlazaKind;

const KIND_FILTERS: Array<{ id: PlazaFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "agent", label: "智能体" },
  { id: "skin", label: "皮肤" },
];

function asBrandAgents(input: unknown): WodeAppBrandAgentConfig[] {
  const agents = Array.isArray(input) ? input : [];
  return normalizeWodeAppBrandAgentsFile({ version: 1, agents }).agents;
}

function readAllBrandAgents(): WodeAppBrandAgentConfig[] {
  if (typeof window === "undefined") return readStoredWodeAppBrandAgents();
  try {
    const raw = window.localStorage.getItem(WODEAPP_BRAND_AGENTS_STORAGE_KEY);
    if (!raw) return [];
    return asBrandAgents(JSON.parse(raw)?.agents);
  } catch {
    return readStoredWodeAppBrandAgents();
  }
}

async function persistBrandAgents(agents: WodeAppBrandAgentConfig[]): Promise<string | null> {
  const file = normalizeWodeAppBrandAgentsFile({ version: 1, agents });
  writeStoredWodeAppBrandAgents(file);
  const saved = await saveWodeAppBrandAgents(file);
  if (saved.ok) {
    writeStoredWodeAppBrandAgents(asBrandAgents(saved.agents));
    return null;
  }
  return saved.error || null;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function PlazaCard(props: {
  name: string;
  description?: string;
  Icon: LucideIcon;
  badgeText: string;
  footText?: string;
  installed?: boolean;
  primary?: { label: string; busy?: boolean; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  tertiary?: { label: string; onClick: () => void };
}) {
  const { Icon } = props;
  return (
    <article className="wx-cap-card">
      <div className="wx-cap-card-head">
        <div className="wx-cap-card-icon">
          <Icon aria-hidden />
        </div>
        <div className="wx-cap-card-title">
          <h4 title={props.name}>{props.name}</h4>
          <div className="wx-cap-card-badges">
            {props.installed ? <span className="wx-cap-dot-tag">已安装</span> : null}
            <span className="wx-cap-badge is-custom">{props.badgeText}</span>
          </div>
        </div>
      </div>
      {props.description ? <p className="wx-cap-card-desc">{props.description}</p> : null}
      <div className="wx-cap-card-foot">
        <span className="wx-cap-card-foot-text">{props.footText ?? ""}</span>
        <div className="wx-cap-card-actions">
          {props.tertiary ? (
            <button type="button" className="wx-cap-ghost-btn" onClick={props.tertiary.onClick}>
              {props.tertiary.label}
            </button>
          ) : null}
          {props.secondary ? (
            <button type="button" className="wx-cap-ghost-btn" onClick={props.secondary.onClick}>
              {props.secondary.label}
            </button>
          ) : null}
          {props.primary ? (
            <button
              type="button"
              className="wx-cap-primary"
              disabled={props.primary.busy}
              onClick={props.primary.onClick}
            >
              {props.primary.label}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function WodeAppPlazaSection(props: { query: string }) {
  const workbench = useWodeAppWorkbench();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = React.useState<WodeAppPlazaItem[]>(() => listWodeAppPlazaItems());
  const [filter, setFilter] = React.useState<PlazaFilter>("all");
  const [status, setStatus] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [installedAgentIds, setInstalledAgentIds] = React.useState<Set<string>>(
    () => new Set(readAllBrandAgents().map((agent) => agent.id)),
  );
  const [publishKind, setPublishKind] = React.useState<WodeAppPlazaKind>("agent");
  const [publishName, setPublishName] = React.useState("");
  const [publishDescription, setPublishDescription] = React.useState("");
  const [publishPrompt, setPublishPrompt] = React.useState("");
  const [publishPreview, setPublishPreview] = React.useState<WodeAppSkinPreview>({
    sidebar: "#E8F1EE",
    main: "#FBFCFB",
    accent: "#2A7A6A",
    topbar: "#FBFCFB",
  });
  const [localAgents, setLocalAgents] = React.useState<WodeAppBrandAgentConfig[]>(() => readAllBrandAgents());

  const refreshInstalled = React.useCallback(async () => {
    const listed = await listWodeAppBrandAgents();
    const agents = listed.ok ? asBrandAgents(listed.agents) : readAllBrandAgents();
    setInstalledAgentIds(new Set(agents.map((agent) => agent.id)));
    setLocalAgents(agents);
  }, []);

  React.useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const persistCatalog = React.useCallback(async (items: WodeAppPlazaItem[]) => {
    const next = upsertWodeAppPlazaItems(items);
    setCatalog(next);
    await saveWodeAppPlazaCatalog({ version: 1, items: next });
    return next;
  }, []);

  const hydrateCatalog = React.useCallback(async () => {
    const disk = await listWodeAppPlazaCatalog();
    if (disk.ok && disk.exists) {
      setCatalog(upsertWodeAppPlazaItems(coercePlazaCatalog({ items: disk.items })));
      return;
    }
    const local = listWodeAppPlazaItems();
    setCatalog(local);
    if (disk.ok) await saveWodeAppPlazaCatalog({ version: 1, items: local });
  }, []);

  React.useEffect(() => {
    void hydrateCatalog();
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void hydrateCatalog();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [hydrateCatalog]);

  const handleUploadFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setStatus(null);
      setNotice(null);
      const incoming: WodeAppPlazaItem[] = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parsePlazaUpload(text);
        if (!parsed.ok) {
          setStatus(`${file.name}：${parsed.error}`);
          return;
        }
        incoming.push(...parsed.items);
      }
      const next = addWodeAppPlazaItems(catalog, incoming);
      await persistCatalog(next);
      setNotice(`已上传 ${incoming.length} 个自定义包，可安装后使用`);
    },
    [catalog, persistCatalog],
  );

  const handlePublish = React.useCallback(() => {
    setStatus(null);
    setNotice(null);
    if (publishKind === "agent") {
      const name = publishName.trim();
      if (!name) {
        setStatus("请填写智能体名称");
        return;
      }
      const result = publishAgentToPlaza(catalog, {
        id: slugifyPlazaId(name),
        name,
        brandId: "custom",
        meta: publishDescription.trim() || undefined,
        entryPrompt: publishPrompt.trim() || `向「${name}」提问。`,
        workbench: "generic",
        enabled: true,
      });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      void persistCatalog(result.items);
    } else {
      const result = publishSkinToPlaza(catalog, {
        name: publishName.trim(),
        description: publishDescription.trim(),
        preview: publishPreview,
      });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      void persistCatalog(result.items);
    }
    setPublishOpen(false);
    setPublishName("");
    setPublishDescription("");
    setPublishPrompt("");
    setNotice("已发布到自定义广场");
  }, [catalog, persistCatalog, publishDescription, publishKind, publishName, publishPreview, publishPrompt]);

  const handlePublishExistingAgent = React.useCallback(
    (agent: WodeAppBrandAgentConfig) => {
      const result = publishAgentToPlaza(catalog, agent);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      void persistCatalog(result.items);
      setNotice(`已将「${agent.name}」发布到广场`);
    },
    [catalog, persistCatalog],
  );

  const handleInstallAgent = React.useCallback(
    async (item: WodeAppPlazaItem) => {
      if (!item.agent || busyId) return;
      setBusyId(item.id);
      setStatus(null);
      setNotice(null);
      try {
        const listed = await listWodeAppBrandAgents();
        const existing = listed.ok ? asBrandAgents(listed.agents) : readAllBrandAgents();
        const merged = mergeBrandAgentsWithPlaza(existing, item.agent);
        const error = await persistBrandAgents(merged.agents);
        if (error && !readAllBrandAgents().some((agent) => agent.id === item.agent?.id)) {
          setStatus(error);
          return;
        }
        setInstalledAgentIds(new Set(merged.agents.map((agent) => agent.id)));
        setNotice(`已安装「${item.name}」，侧栏品牌分组可以使用`);
      } finally {
        setBusyId(null);
      }
    },
    [busyId],
  );

  const handleUninstallAgent = React.useCallback(
    async (item: WodeAppPlazaItem) => {
      if (!item.agent || busyId) return;
      setBusyId(item.id);
      setStatus(null);
      try {
        const listed = await listWodeAppBrandAgents();
        const existing = listed.ok ? asBrandAgents(listed.agents) : readAllBrandAgents();
        const next = dropBrandAgent(existing, item.agent.id);
        await persistBrandAgents(next.agents);
        setInstalledAgentIds(new Set(next.agents.map((agent) => agent.id)));
        setNotice(`已卸载「${item.name}」`);
      } finally {
        setBusyId(null);
      }
    },
    [busyId],
  );

  const handleUseAgent = React.useCallback(
    (item: WodeAppPlazaItem) => {
      const workspaceId = workbench.selectedWorkspaceId?.trim() ?? "";
      if (!item.agent || !workbench.onCreateTaskWithPrompt || !workspaceId) return;
      workbench.onCreateTaskWithPrompt(
        workspaceId,
        buildBuiltinAgentTask(brandAgentConfigToBuiltinAgent(item.agent), {
          displayText: `使用智能体：${item.agent.name}`,
          autoSend: false,
        }),
      );
    },
    [workbench],
  );

  const handleUseSkin = React.useCallback((item: WodeAppPlazaItem) => {
    if (!item.skin) return;
    storeWodeAppSkin(item.skin.id);
    setNotice(`已切换到「${item.name}」`);
  }, []);

  const handleRemove = React.useCallback(
    (item: WodeAppPlazaItem) => {
      void persistCatalog(removeWodeAppPlazaItem(catalog, item.id));
      setNotice(`已从广场移除「${item.name}」`);
    },
    [catalog, persistCatalog],
  );

  const trimmedQuery = props.query.trim().toLowerCase();
  const visible = catalog.filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    if (!trimmedQuery) return true;
    return `${item.name} ${item.description} ${item.kind}`.toLowerCase().includes(trimmedQuery);
  });

  return (
    <div className="wx-plaza">
      <div className="wx-cap-repo-bar">
        <div className="wx-plaza-filters" role="tablist" aria-label="广场分类">
          {KIND_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              className={`wx-cap-tab${filter === entry.id ? " is-active" : ""}`}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={(event) => {
            void handleUploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" className="wx-cap-repo-action" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />
          上传包
        </button>
        <button type="button" className="wx-cap-repo-action" onClick={() => setPublishOpen((open) => !open)}>
          发布到广场
        </button>
      </div>

      {publishOpen ? (
        <div className="wx-plaza-publish">
          <div className="wx-plaza-publish-grid">
            <label>
              <span>类型</span>
              <select value={publishKind} onChange={(event) => setPublishKind(event.target.value as WodeAppPlazaKind)}>
                <option value="agent">智能体</option>
                <option value="skin">皮肤</option>
              </select>
            </label>
            <label>
              <span>名称</span>
              <input
                type="text"
                value={publishName}
                onChange={(event) => setPublishName(event.target.value)}
                placeholder={publishKind === "agent" ? "例如 research-notes" : "例如 松绿工作台"}
              />
            </label>
            <label className="wx-plaza-span">
              <span>简介</span>
              <input
                type="text"
                value={publishDescription}
                onChange={(event) => setPublishDescription(event.target.value)}
                placeholder="一句话说明这个包做什么"
              />
            </label>
            {publishKind === "agent" ? (
              <label className="wx-plaza-span">
                <span>入口提示</span>
                <textarea
                  value={publishPrompt}
                  onChange={(event) => setPublishPrompt(event.target.value)}
                  placeholder="点击侧栏时预填的第一句话"
                  rows={3}
                />
              </label>
            ) : (
              <div className="wx-plaza-colors wx-plaza-span">
                {(
                  [
                    ["sidebar", "侧栏"],
                    ["main", "主区"],
                    ["accent", "强调"],
                    ["topbar", "顶栏"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="color"
                      value={publishPreview[key]}
                      onChange={(event) =>
                        setPublishPreview((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          {publishKind === "agent" && localAgents.length > 0 ? (
            <div className="wx-plaza-local">
              <span>或从本机已有智能体发布</span>
              <div className="wx-plaza-local-row">
                {localAgents.slice(0, 8).map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className="wx-cap-ghost-btn"
                    onClick={() => handlePublishExistingAgent(agent)}
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="wx-plaza-publish-foot">
            <button type="button" className="wx-cap-ghost-btn" onClick={() => setPublishOpen(false)}>
              取消
            </button>
            <button type="button" className="wx-cap-primary" onClick={handlePublish}>
              发布
            </button>
          </div>
        </div>
      ) : null}

      {status ? (
        <div className="wx-cap-status is-error" role="alert">
          {status}
        </div>
      ) : null}
      {notice ? (
        <div className="wx-cap-status is-ok" role="status">
          {notice}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="wx-cap-empty" role="status">
          <p>
            {trimmedQuery
              ? `没有找到「${props.query.trim()}」相关的自定义包`
              : "还没有自定义内容。上传智能体 JSON 或皮肤包，或点「发布到广场」。"}
          </p>
        </div>
      ) : (
        <section className="wx-cap-section" aria-label="自定义广场">
          <h3>自定义广场（{visible.length}）</h3>
          <div className="wx-cap-grid">
            {visible.map((item) => {
              const installed = item.kind === "agent" && item.agent ? installedAgentIds.has(item.agent.id) : false;
              return (
                <PlazaCard
                  key={item.id}
                  name={item.name}
                  description={item.description}
                  Icon={item.kind === "skin" ? Palette : Sparkles}
                  badgeText={item.kind === "skin" ? "皮肤" : "智能体"}
                  footText={item.source === "example" ? "示例" : item.source === "publish" ? "本机发布" : "已上传"}
                  installed={installed}
                  tertiary={
                    item.kind === "agent" && installed
                      ? { label: "卸载", onClick: () => void handleUninstallAgent(item) }
                      : { label: "移除", onClick: () => handleRemove(item) }
                  }
                  secondary={{
                    label: "导出",
                    onClick: () => downloadJson(`${item.id}.json`, plazaItemToPack(item)),
                  }}
                  primary={
                    item.kind === "skin"
                      ? { label: "使用", onClick: () => handleUseSkin(item) }
                      : installed
                        ? {
                            label: "使用",
                            onClick: () => handleUseAgent(item),
                          }
                        : {
                            label: busyId === item.id ? "安装中" : "安装",
                            busy: busyId === item.id,
                            onClick: () => void handleInstallAgent(item),
                          }
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {visible.some((item) => item.kind === "agent" && item.agent && installedAgentIds.has(item.agent.id)) ? (
        <p className="wx-plaza-hint">广场包可在此安装使用。自定义智能体请用侧栏「添加智能体」，会开对话创建 runtime 项目。</p>
      ) : null}

      <p className="wx-plaza-hint">
        包格式是 JSON。导出后可发给别人，对方在此上传即可安装智能体或使用皮肤。
      </p>
    </div>
  );
}
