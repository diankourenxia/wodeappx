import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getBrandAgentsPath,
  getPlazaCatalogPath,
  loadBrandAgentsFile,
  loadPlazaCatalogFile,
  saveBrandAgentsFile,
  savePlazaCatalogFile,
} from "@wodeapp/app-core";
import {
  addWodeAppPlazaItems,
  coercePlazaCatalog,
  dropBrandAgent,
  mergeBrandAgentsWithPlaza,
  parsePlazaUpload,
  plazaItemToPack,
  type WodeAppPlazaItem,
} from "../../../integrations/openwork/wodeapp/wodeapp-plaza.ts";

export const PLAZA_HELP = `WodeAppX 自定义广场（本机 ~/.wodeapp/plaza/catalog.json）

  wodeapp plaza list
  wodeapp plaza install <file.json>   解析包写入广场；智能体同时装进 brand-agents.json
  wodeapp plaza export <id> [out.json]
  wodeapp plaza remove <id> [--uninstall]   从广场移除；加 --uninstall 同时卸侧栏智能体

与桌面能力中心「自定义广场」共用同一目录。桌面开着时切回该 Tab 会重读。
`;

function normalizeAgents(input: unknown[]): ReturnType<typeof mergeBrandAgentsWithPlaza>["agents"] {
  const items = coercePlazaCatalog({
    items: input.map((agent) => ({
      kind: "agent",
      name: typeof agent === "object" && agent && "name" in agent ? String((agent as { name?: string }).name || "agent") : "agent",
      agent,
    })),
  });
  return items.map((item) => item.agent).filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
}

async function loadCatalogItems(): Promise<WodeAppPlazaItem[]> {
  const loaded = await loadPlazaCatalogFile();
  return coercePlazaCatalog(loaded.file);
}

function printItems(items: WodeAppPlazaItem[]): void {
  if (!items.length) {
    console.log("广场是空的。用 wodeapp plaza install <file.json> 添加。");
    return;
  }
  for (const item of items) {
    const extra = item.kind === "skin" ? item.skin?.id : item.agent?.id;
    console.log(`${item.kind}\t${item.id}\t${item.name}${extra && extra !== item.id ? `\t${extra}` : ""}`);
  }
}

async function runList(): Promise<number> {
  const items = await loadCatalogItems();
  console.log(getPlazaCatalogPath());
  printItems(items);
  return 0;
}

async function runInstall(filePath: string | undefined): Promise<number> {
  if (!filePath) {
    console.error("用法: wodeapp plaza install <file.json>");
    return 1;
  }
  const text = await readFile(resolve(filePath), "utf8");
  const parsed = parsePlazaUpload(text);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  const catalog = await loadCatalogItems();
  const next = addWodeAppPlazaItems(catalog, parsed.items);
  await savePlazaCatalogFile(next);
  const agents = parsed.items.filter((item) => item.kind === "agent" && item.agent);
  if (agents.length) {
    const existing = normalizeAgents((await loadBrandAgentsFile()).file.agents);
    let merged = existing;
    for (const item of agents) {
      if (item.agent) merged = mergeBrandAgentsWithPlaza(merged, item.agent).agents;
    }
    await saveBrandAgentsFile(merged);
  }
  console.log(`已写入 ${getPlazaCatalogPath()}`);
  if (agents.length) console.log(`已安装 ${agents.length} 个智能体到 ${getBrandAgentsPath()}`);
  printItems(parsed.items);
  return 0;
}

async function runExport(id: string | undefined, outPath: string | undefined): Promise<number> {
  if (!id) {
    console.error("用法: wodeapp plaza export <id> [out.json]");
    return 1;
  }
  const item = (await loadCatalogItems()).find((entry) => entry.id === id);
  if (!item) {
    console.error(`找不到 ${id}`);
    return 1;
  }
  const payload = `${JSON.stringify(plazaItemToPack(item), null, 2)}\n`;
  if (outPath) {
    const dest = resolve(outPath);
    await writeFile(dest, payload, "utf8");
    console.log(dest);
    return 0;
  }
  process.stdout.write(payload);
  return 0;
}

async function runRemove(id: string | undefined, uninstall: boolean): Promise<number> {
  if (!id) {
    console.error("用法: wodeapp plaza remove <id> [--uninstall]");
    return 1;
  }
  const catalog = await loadCatalogItems();
  const item = catalog.find((entry) => entry.id === id);
  if (!item) {
    console.error(`找不到 ${id}`);
    return 1;
  }
  await savePlazaCatalogFile(catalog.filter((entry) => entry.id !== id));
  if (uninstall && item.agent) {
    const existing = normalizeAgents((await loadBrandAgentsFile()).file.agents);
    await saveBrandAgentsFile(dropBrandAgent(existing, item.agent.id).agents);
    console.log(`已卸载智能体 ${item.agent.id}`);
  }
  console.log(`已从广场移除 ${item.id}`);
  return 0;
}

export async function runPlazaCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(PLAZA_HELP);
    return 0;
  }
  try {
    if (sub === "list") return await runList();
    if (sub === "install") return await runInstall(argv[1]);
    if (sub === "export") return await runExport(argv[1], argv[2]);
    if (sub === "remove") return await runRemove(argv[1], argv.includes("--uninstall"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.error(`未知子命令: ${sub}`);
  console.error(PLAZA_HELP);
  return 1;
}
