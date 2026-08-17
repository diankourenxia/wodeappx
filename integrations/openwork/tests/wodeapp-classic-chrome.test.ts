import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const here = dirname(fileURLToPath(import.meta.url));
const shellSource = readFileSync(
  join(here, "../wodeapp/wodeapp-workbench-shell.tsx"),
  "utf8",
);
const shellCss = readFileSync(join(here, "../wodeapp/wodeapp-shell.css"), "utf8");
const classicCss = readFileSync(
  join(here, "../wodeapp/wodeapp-skin-classic-blue.css"),
  "utf8",
);

describe("classic chrome mount/unmount", () => {
  test("workbench mounts classic frame only for classic-blue", () => {
    expect(shellSource).toMatch(
      /\{skin === "classic-blue" \? \(\s*<WodeAppClassicFrame/,
    );
    expect(shellSource).toMatch(
      /\{skin === "classic-blue" \? \(\s*<WodeAppClassicAssistantRail/,
    );
    expect(shellSource).not.toMatch(/<WodeAppClassicFrame\n          activeSurface/);
  });

  test("does not CSS-hide classic chrome as a fallback", () => {
    expect(shellCss).not.toMatch(
      /\.wapp-classic-titlebar,\s*\.wapp-classic-toolbar,\s*\.wapp-classic-assistant \{\s*display: none;/,
    );
    expect(classicCss).not.toMatch(
      /^\.wapp-classic-titlebar,\s*\.wapp-classic-toolbar,\s*\.wapp-classic-assistant \{\s*display: none;/m,
    );
  });
});
