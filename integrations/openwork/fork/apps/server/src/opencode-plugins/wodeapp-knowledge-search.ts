import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import { buildContextReadbackPlan } from "./wodeapp-context-artifacts.js";

type KnowledgeToolContext = {
  directory?: string;
  worktree?: string;
};

type KnowledgeProfile = {
  scope: string;
  envRoot: string;
  relativeRoots: readonly string[];
};

const KNOWLEDGE_PROFILES: Readonly<Record<string, KnowledgeProfile>> = {
  "wynne-brand-agent": {
    scope: "wynne",
    envRoot: "WODEAPPX_WYNNE_KNOWLEDGE_ROOT",
    relativeRoots: [".wodeapp/knowledge/wynne", "knowledge/wynne"],
  },
};

const TEXT_EXTENSIONS = new Set([".csv", ".htm", ".html", ".json", ".md", ".mdx", ".txt"]);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHUNK_CHARS = 1_600;

const knowledgeSearchArgs = z.object({
  query: z.string().min(1).max(500).describe("Question or terms to search for in the scoped brand knowledge base."),
  profile: z.enum(["wynne-brand-agent"]).describe("Runtime profile that selects the permitted knowledge scope."),
  topK: z.number().int().min(1).max(12).optional().describe("Maximum matching chunks. Defaults to 5."),
});

function tokens(value: string): string[] {
  const normalized = value.toLowerCase();
  const words = normalized
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const cjkGroups = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const cjk = cjkGroups.flatMap((group) => {
    const chars = [...group];
    return [group, ...chars, ...chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)];
  });
  return [...new Set([...words, ...cjk])];
}

function chunks(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      if (current) result.push(current);
      current = "";
      for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
        result.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARS));
      }
      continue;
    }
    if (!current) {
      current = paragraph;
      continue;
    }
    if (current.length + paragraph.length + 2 <= MAX_CHUNK_CHARS) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    result.push(current);
    current = paragraph;
  }
  if (current) result.push(current);
  return result;
}

async function existingKnowledgeRoot(
  profile: KnowledgeProfile,
  context: KnowledgeToolContext | undefined,
): Promise<{ root: string; configuredBy: "environment" | "workspace" } | null> {
  const configured = process.env[profile.envRoot]?.trim();
  if (configured) {
    const root = resolve(configured);
    const info = await stat(root).catch(() => null);
    return info?.isDirectory() ? { root, configuredBy: "environment" } : null;
  }
  const workspace = context?.directory?.trim() || context?.worktree?.trim() || "";
  if (!workspace) return null;
  for (const relativeRoot of profile.relativeRoots) {
    const root = resolve(workspace, relativeRoot);
    const info = await stat(root).catch(() => null);
    if (info?.isDirectory()) return { root, configuredBy: "workspace" };
  }
  return null;
}

async function collectKnowledgeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && files.length < MAX_FILES) {
    const current = pending.shift();
    if (!current) break;
    const entries = await readdir(current.directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 8) {
        pending.push({ directory: path, depth: current.depth + 1 });
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(path);
        if (files.length >= MAX_FILES) break;
      }
    }
  }
  return files;
}

function scoreChunk(query: string, queryTokens: readonly string[], path: string, content: string): number {
  const normalizedContent = content.toLowerCase();
  const normalizedPath = path.toLowerCase();
  let score = normalizedContent.includes(query.toLowerCase()) ? 12 : 0;
  for (const token of queryTokens) {
    if (normalizedPath.includes(token)) score += 5;
    const matches = normalizedContent.split(token).length - 1;
    score += Math.min(matches, 8);
  }
  return score;
}

export async function searchWodeAppKnowledge(
  rawArgs: unknown,
  context?: KnowledgeToolContext,
): Promise<Record<string, unknown>> {
  const args = knowledgeSearchArgs.parse(rawArgs);
  const profile = KNOWLEDGE_PROFILES[args.profile];
  const configured = await existingKnowledgeRoot(profile, context);
  if (!configured) {
    return {
      ok: false,
      code: "knowledge_scope_not_configured",
      profile: args.profile,
      scope: profile.scope,
      error: `No real knowledge directory is configured. Set ${profile.envRoot} or create one of: ${profile.relativeRoots.join(", ")}.`,
      matches: [],
    };
  }

  const files = await collectKnowledgeFiles(configured.root);
  const queryTokens = tokens(args.query);
  const candidates: Array<{
    score: number;
    source: string;
    chunk: number;
    text: string;
    updatedAt: string;
    version: string;
  }> = [];

  for (const path of files) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) continue;
    const content = await readFile(path, "utf8").catch(() => "");
    if (!content) continue;
    const version = createHash("sha256").update(content).digest("hex").slice(0, 12);
    chunks(content).forEach((text, index) => {
      const score = scoreChunk(args.query, queryTokens, path, text);
      if (score <= 0) return;
      candidates.push({
        score,
        source: path,
        chunk: index + 1,
        text,
        updatedAt: info.mtime.toISOString(),
        version,
      });
    });
  }

  const matches = candidates
    .sort((left, right) => right.score - left.score || left.source.localeCompare(right.source))
    .slice(0, args.topK ?? 5);
  const readback = matches[0]
    ? buildContextReadbackPlan({
        artifactKind: "knowledge source",
        path: matches[0].source,
        queryHint: args.query,
      })
    : null;

  return {
    ok: true,
    profile: args.profile,
    scope: profile.scope,
    configuredBy: configured.configuredBy,
    root: configured.root,
    query: args.query,
    indexedFiles: files.length,
    matches,
    ...(readback ? { readback } : {}),
    ...(matches.length === 0
      ? { message: "No matching knowledge was found. Do not answer with invented brand facts." }
      : {}),
  };
}

export function buildWodeAppKnowledgeSearchTool() {
  return {
    description:
      "Search a runtime-profile-scoped local brand knowledge base on demand. Returns real text chunks with source paths, versions, and updatedAt timestamps. It never supplies demo knowledge and fails closed when the scope is not configured.",
    args: knowledgeSearchArgs.shape,
    async execute(rawArgs: unknown, context?: KnowledgeToolContext) {
      return JSON.stringify(await searchWodeAppKnowledge(rawArgs, context), null, 2);
    },
  };
}

export const __testing = {
  chunks,
  tokens,
};
