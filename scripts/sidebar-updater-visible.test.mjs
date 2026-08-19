import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const footer = readFileSync(
  join(root, "integrations/openwork/wodeapp/wodeapp-account-footer.tsx"),
  "utf8",
);
const chrome = readFileSync(
  join(root, "integrations/openwork/wodeapp/wodeapp-legacy-chrome.css"),
  "utf8",
);

test("sidebar has no update control; version updates live in settings", () => {
  assert.doesNotMatch(footer, /WodeAppSidebarUpdater/);
  assert.doesNotMatch(footer, /wodeapp-sidebar-updater/);
  assert.doesNotMatch(footer, /下载更新|安装更新|重试更新|下载中/);
  assert.doesNotMatch(chrome, /wx-sidebar-update-btn/);
  assert.equal(
    existsSync(join(root, "integrations/openwork/wodeapp/wodeapp-sidebar-updater.tsx")),
    false,
  );
});
