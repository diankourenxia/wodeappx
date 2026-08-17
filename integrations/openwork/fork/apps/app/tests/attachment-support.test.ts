import { describe, expect, test } from "bun:test";
import { filterDuplicateComposerAttachmentFiles } from "../src/react-app/domains/session/sync/attachment-support";

function fixtureFile(name: string, options: { size?: number; type?: string; lastModified?: number } = {}) {
  return new File([new Uint8Array(options.size ?? 4)], name, {
    type: options.type ?? "application/octet-stream",
    lastModified: options.lastModified ?? 1_700_000_000_000,
  });
}

describe("composer attachment duplicate guard", () => {
  test("rejects a file already attached to the composer", () => {
    const attached = fixtureFile("brief.pdf", { type: "application/pdf" });
    const selectedAgain = fixtureFile("brief.pdf", { type: "application/pdf" });
    const result = filterDuplicateComposerAttachmentFiles([selectedAgain], [{ file: attached }]);
    expect(result.accepted).toEqual([]);
    expect(result.duplicates).toEqual([selectedAgain]);
  });

  test("deduplicates a picker batch while keeping distinct revisions", () => {
    const first = fixtureFile("product.png", { type: "image/png" });
    const repeated = fixtureFile("product.png", { type: "image/png" });
    const revised = fixtureFile("product.png", { type: "image/png", lastModified: first.lastModified + 1 });
    const result = filterDuplicateComposerAttachmentFiles([first, repeated, revised], []);
    expect(result.accepted).toEqual([first, revised]);
    expect(result.duplicates).toEqual([repeated]);
  });
});
