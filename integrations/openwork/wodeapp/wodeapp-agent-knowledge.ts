import {
  getAbilityWorkbenchContext,
  matchAbilityProject,
  type WodeAppAbilityProject,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import { buildAgentCapabilityText } from "./wodeapp-agent-tools";
import {
  readWodeAppAgentsOverride,
  type WodeAppAgentsOverride,
} from "./wodeapp-sidebar-agents";

const RECOMMENDED_SKILLS: Record<string, string> = {
  "script-storyboard": "wodeapp-short-drama-factory",
  "beauty-industry-agent": "wodeappx-beauty-industry",
};

export type WodeAppAgentProfile = {
  title: string;
  description: string;
};

function agentHasWorkbench(agent: WodeAppBuiltinAgent): boolean {
  if (agent.id === "create-agent") return false;
  if (agent.id === "script-storyboard" || agent.abilityKind === "short-drama") return false;
  if (agent.kind === "brand" || agent.kind === "orchestrator" || agent.kind === "industry") return false;
  return Boolean(agent.abilityKind);
}

function recommendedSkill(agent: WodeAppBuiltinAgent): string | undefined {
  if (RECOMMENDED_SKILLS[agent.id]) return RECOMMENDED_SKILLS[agent.id];
  if (agent.kind === "brand" && agent.id.startsWith("skill-")) {
    return agent.id.replace(/^skill-/, "") || undefined;
  }
  return undefined;
}

function extraSentences(agent: WodeAppBuiltinAgent, capability: string): string[] {
  const extras: string[] = [];
  if (agent.abilityKind === "video" && !capability.includes("wodeapp_video_template_render")) {
    extras.push("可选成片包装 wodeapp_video_template_render。");
  }
  const skill = recommendedSkill(agent);
  if (skill && !capability.includes(skill)) extras.push(`优先技能 ${skill}。`);
  return extras;
}

function projectSentence(
  agent: WodeAppBuiltinAgent,
  projects: readonly WodeAppAbilityProject[],
  preferLocal: boolean,
): string {
  if (agent.demoUrl && (agent.kind === "brand" || agent.id.startsWith("custom-"))) {
    return `已开通对应项目 ${agent.demoUrl}。`;
  }
  if (!agentHasWorkbench(agent)) {
    return "无专属云项目，在当前对话完成。";
  }
  const project = matchAbilityProject(agent, projects);
  const name = project?.title || project?.name || project?.slug || "";
  if (preferLocal) {
    return name ? `本机工作台「${name}」。` : "使用本机工作台。";
  }
  if (name) return `已开通对应项目「${name}」。`;
  return "有对应工作台，登录后同步。";
}

export function buildAgentProfile(
  agent: WodeAppBuiltinAgent,
  projects: readonly WodeAppAbilityProject[] = [],
  preferLocal = getAbilityWorkbenchContext().preferLocal,
  override: WodeAppAgentsOverride = readWodeAppAgentsOverride(),
): WodeAppAgentProfile {
  const edit = override.profiles?.[agent.id];
  const capability = buildAgentCapabilityText(agent);
  const extras = [
    projectSentence(agent, projects, preferLocal),
    ...extraSentences(agent, capability),
  ];
  let description = edit?.description?.trim()
    || [capability, extras.join("")].filter(Boolean).join("\n\n");
  if (
    agent.demoUrl
    && (agent.kind === "brand" || agent.id.startsWith("custom-"))
    && !description.includes(agent.demoUrl)
  ) {
    description = [description, `已开通对应项目 ${agent.demoUrl}。`].filter(Boolean).join("\n\n");
  }
  return {
    title: edit?.name || agent.name,
    description,
  };
}

export function formatAgentProfilePrompt(profile: WodeAppAgentProfile): string {
  return `你是「${profile.title}」。\n${profile.description}`;
}

export function buildAgentProfilePrompt(
  agent: WodeAppBuiltinAgent,
  projects: readonly WodeAppAbilityProject[] = [],
  preferLocal = getAbilityWorkbenchContext().preferLocal,
): string {
  return formatAgentProfilePrompt(buildAgentProfile(agent, projects, preferLocal));
}
