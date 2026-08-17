import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlazaCommand } from "./plaza-cmd.ts";

describe("plaza cli", () => {
  const previous = process.env.WODEAPP_CONFIG_DIR;

  afterEach(() => {
    if (previous == null) delete process.env.WODEAPP_CONFIG_DIR;
    else process.env.WODEAPP_CONFIG_DIR = previous;
  });

  test("install list export remove share the disk catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wodeapp-plaza-cli-"));
    process.env.WODEAPP_CONFIG_DIR = dir;
    const pack = join(dir, "pack.json");
    await writeFile(
      pack,
      `${JSON.stringify({
        wodeappxPlaza: 1,
        kind: "agent",
        name: "CLI 笔记",
        agent: { id: "cli-notes-agent", name: "CLI 笔记", brandId: "cli-notes" },
      })}\n`,
    );

    expect(await runPlazaCommand(["install", pack])).toBe(0);
    const catalog = JSON.parse(await readFile(join(dir, "plaza", "catalog.json"), "utf8")) as {
      items: Array<{ id: string }>;
    };
    expect(catalog.items[0]?.id).toBe("cli-notes-agent");
    const agents = JSON.parse(await readFile(join(dir, "brand-agents.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(agents.agents[0]?.id).toBe("cli-notes-agent");

    expect(await runPlazaCommand(["list"])).toBe(0);
    const out = join(dir, "exported.json");
    expect(await runPlazaCommand(["export", "cli-notes-agent", out])).toBe(0);
    const exported = JSON.parse(await readFile(out, "utf8")) as { kind: string; id: string };
    expect(exported.kind).toBe("agent");
    expect(exported.id).toBe("cli-notes-agent");

    expect(await runPlazaCommand(["remove", "cli-notes-agent", "--uninstall"])).toBe(0);
    const after = JSON.parse(await readFile(join(dir, "plaza", "catalog.json"), "utf8")) as {
      items: unknown[];
    };
    expect(after.items).toEqual([]);
    const afterAgents = JSON.parse(await readFile(join(dir, "brand-agents.json"), "utf8")) as {
      agents: unknown[];
    };
    expect(afterAgents.agents).toEqual([]);
  });
});
