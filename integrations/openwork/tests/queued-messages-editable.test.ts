import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("queued messages editable", () => {
  test("panel exposes editable textarea wiring", () => {
    const panel = read("fork/apps/app/src/react-app/domains/session/modals/queued-messages-panel.tsx");
    expect(panel).toContain("onChange?: (index: number, text: string) => void");
    expect(panel).toContain("<textarea");
    expect(panel).toContain("props.onChange?.(index, event.target.value)");
  });

  test("session surface updates queued draft text by real index", () => {
    const surface = read("fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx");
    expect(surface).toContain("handleChangeQueuedDraft");
    expect(surface).toContain("updateQueuedDraftTextInStore");
    expect(surface).toContain("onChange={handleChangeQueuedDraft}");
  });
});
