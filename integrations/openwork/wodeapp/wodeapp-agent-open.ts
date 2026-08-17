import { toast } from "@/components/ui/sonner";

import { syncWodeAppAbilityProjects } from "@/app/lib/wodeapp-auth";

import {
  getAbilityWorkbenchContext,
  matchAbilityProject,
  openWodeAppBuiltinAgentView,
  pickAbilityProjects,
  setWodeAppAbilityProjects,
  type WodeAppAbilityProject,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";

export function describeBuiltinAgentOpenFailure(params: {
  signedIn: boolean;
  agent: WodeAppBuiltinAgent;
  projects: readonly WodeAppAbilityProject[];
  syncError?: string | null;
  preferLocal?: boolean;
}): string {
  const agentName = params.agent.name || "智能体";

  if (!params.signedIn) {
    if (params.preferLocal ?? getAbilityWorkbenchContext().preferLocal) {
      return "本机工作台还没就绪，请稍后重试";
    }
    return "WodeApp 内嵌能力正在初始化，请稍后重试";
  }

  const syncError = params.syncError?.trim();
  if (syncError) {
    if (/401|403|AUTH|auth|身份|凭证|expired|unauthorized/i.test(syncError)) {
      return "WodeApp 账户暂不可用，请稍后重试";
    }
    if (/网络|fetch|ECONNREFUSED|ETIMEDOUT|timeout|Failed to fetch/i.test(syncError)) {
      return "暂时无法连接 WodeApp 平台，请检查网络后重试";
    }
    return `无法打开「${agentName}」：${syncError}`;
  }

  if (params.projects.length === 0) {
    return "专属智能体项目还在同步，请稍等几秒后重试";
  }

  if (!matchAbilityProject(params.agent, params.projects)) {
    return `「${agentName}」专属项目暂未开通，请稍后再试`;
  }

  return `暂时无法打开「${agentName}」，请稍后重试`;
}

export async function openBuiltinAgentWithFeedback(params: {
  agent: WodeAppBuiltinAgent;
  signedIn: boolean;
  userId: string | null;
  projects: readonly WodeAppAbilityProject[];
  sessionId?: string;
}): Promise<boolean> {
  const tryOpen = (projects: readonly WodeAppAbilityProject[]) =>
    openWodeAppBuiltinAgentView(params.agent, projects, params.sessionId);

  if (tryOpen(params.projects)) return true;

  if (!params.signedIn) {
    toast.error(describeBuiltinAgentOpenFailure({
      signedIn: false,
      agent: params.agent,
      projects: params.projects,
      preferLocal: getAbilityWorkbenchContext().preferLocal,
    }));
    return false;
  }

  let syncError: string | null = null;
  let projects = params.projects;

  try {
    const synced = await syncWodeAppAbilityProjects();
    syncError = synced.error ?? null;
    if (synced.projects.length > 0) {
      projects = synced.projects;
      setWodeAppAbilityProjects(synced.projects, params.userId);
    } else if (!syncError) {
      projects = pickAbilityProjects(undefined, params.userId);
    }
  } catch (error) {
    syncError = error instanceof Error ? error.message : "同步失败";
    projects = pickAbilityProjects(undefined, params.userId);
  }

  if (tryOpen(projects)) return true;

  toast.error(describeBuiltinAgentOpenFailure({
    signedIn: true,
    agent: params.agent,
    projects,
    syncError,
  }));
  return false;
}
