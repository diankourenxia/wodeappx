/** @jsxImportSource react */
import * as React from "react";

import {
  listWodeAppBrandAgents,
  saveWodeAppBrandAgents,
} from "@/app/lib/wodeapp-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  readWodeAppAbilityProjects,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import { buildAgentProfile } from "./wodeapp-agent-knowledge";
import {
  listEnabledWodeAppBrandAgents,
  normalizeWodeAppBrandAgentsFile,
  readStoredWodeAppBrandAgents,
  writeStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import { listShippedBuiltinAgentIds } from "./wodeapp-builtin-agents-config";
import { hideShippedSidebarAgent, writeAgentProfileEdit } from "./wodeapp-sidebar-agents";

function asBrandAgents(input: unknown): WodeAppBrandAgentConfig[] {
  const agents = Array.isArray(input) ? input : [];
  return normalizeWodeAppBrandAgentsFile({ version: 1, agents }).agents;
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

function canRemoveAgent(agent: WodeAppBuiltinAgent): boolean {
  if (agent.kind === "brand") return true;
  return listShippedBuiltinAgentIds().includes(agent.id);
}

export function WodeAppManageAgentsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: WodeAppBuiltinAgent | null;
  onUseAgent: (id: string) => void;
}) {
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (!props.open) return;
    setStatus(null);
    if (!props.agent) {
      setTitle("");
      setDescription("");
      return;
    }
    const profile = buildAgentProfile(props.agent, readWodeAppAbilityProjects());
    setTitle(profile.title);
    setDescription(profile.description);
  }, [props.open, props.agent]);

  const persistEdits = React.useCallback(() => {
    const agent = props.agent;
    if (!agent) return false;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setStatus("标题不能为空");
      return false;
    }
    writeAgentProfileEdit(agent.id, { name: nextTitle, description });
    setStatus(null);
    return true;
  }, [description, props.agent, title]);

  const handleSave = React.useCallback(() => {
    persistEdits();
  }, [persistEdits]);

  const handleRemove = React.useCallback(async () => {
    const agent = props.agent;
    if (!agent || !canRemoveAgent(agent)) return;
    setBusy(true);
    setStatus(null);
    try {
      if (agent.kind === "brand") {
        const listed = await listWodeAppBrandAgents();
        const existing = listed.ok ? asBrandAgents(listed.agents) : listEnabledWodeAppBrandAgents(readStoredWodeAppBrandAgents());
        const error = await persistBrandAgents(existing.filter((item) => item.id !== agent.id));
        if (error) {
          setStatus(error);
          return;
        }
      } else {
        hideShippedSidebarAgent(agent.id);
      }
      props.onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }, [props]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="wx-manage-agent-dialog max-w-[min(880px,calc(100vw-32px))] sm:max-w-[min(880px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>编辑智能体</DialogTitle>
        </DialogHeader>
        <div className="wx-manage-agent-body">
          <div className="wx-manage-agent-detail">
            {status ? <p className="wx-add-agent-status" role="alert">{status}</p> : null}
            {props.agent ? (
              <>
                <label className="wx-manage-agent-field">
                  <span>标题</span>
                  <input
                    className="wx-manage-agent-title"
                    value={title}
                    maxLength={64}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="wx-manage-agent-field">
                  <span>内容</span>
                  <textarea
                    className="wx-manage-agent-desc"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <p>没有可编辑的智能体档案。</p>
            )}
          </div>
        </div>
        <DialogFooter>
          {props.agent && canRemoveAgent(props.agent) ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void handleRemove()}>
              从侧栏移除
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={!props.agent}
            onClick={() => {
              if (!persistEdits() || !props.agent) return;
              props.onOpenChange(false);
              props.onUseAgent(props.agent.id);
            }}
          >
            使用
          </Button>
          <Button type="button" disabled={!props.agent || busy} onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
