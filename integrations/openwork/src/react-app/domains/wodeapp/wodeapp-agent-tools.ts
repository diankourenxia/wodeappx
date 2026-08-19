import {
  resolveWodeAppToolDocKey,
  resolveWodeAppToolDocs,
} from "./wodeapp-tool-docs";

const ABILITY_TOOLS: Record<string, readonly string[]> = {
  video: [
    "wodeapp.video.generate",
    "wodeapp.video.status",
    "video_storyboard",
    "wodeapp.video_storyboard.update",
    "wodeapp_image_asset_save",
  ],
  image: [
    "wodeapp_batch_image_prepare",
    "product_visual_batch_image_run",
    "wodeapp_product_save",
    "wodeapp_image_asset_save",
  ],
};

export function listAgentTools(agent: {
  tools?: readonly string[];
  abilityKind?: string;
}): string[] {
  if (agent.tools?.length) return agent.tools.map((name) => name.trim()).filter(Boolean);
  return agent.abilityKind ? [...(ABILITY_TOOLS[agent.abilityKind] || [])] : [];
}

export function formatAgentToolCatalog(toolNames: readonly string[]): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const name of toolNames) {
    const key = resolveWodeAppToolDocKey(name);
    const doc = resolveWodeAppToolDocs(name);
    if (!key || !doc || seen.has(key)) continue;
    seen.add(key);
    const lines = [`${doc.title}（${key}）`, doc.whenToUse];
    if (doc.requiredFields?.length) lines.push(`必填 ${doc.requiredFields.join("、")}`);
    for (const rule of doc.rules || []) {
      if (rule.startsWith("完整规范见")) continue;
      lines.push(`- ${rule}`);
    }
    if (doc.examples?.length) {
      lines.push("调用：");
      for (const example of doc.examples) lines.push(`  ${example}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export function buildAgentCapabilityText(agent: {
  tools?: readonly string[];
  abilityKind?: string;
  samplePrompt?: string;
  entryPrompt?: string;
  meta?: string;
}): string {
  const catalog = formatAgentToolCatalog(listAgentTools(agent));
  const policy = (agent.samplePrompt || agent.entryPrompt || agent.meta || "").trim();
  return [policy, catalog].filter(Boolean).join("\n\n");
}
