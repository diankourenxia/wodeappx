import { describe, expect, test } from "bun:test";

import {
  DEFAULT_EXTERNAL_DIRECTORY_ACCESS,
  foldersWithFullExternalAccess,
  foldersWithoutFullExternalAccess,
  hasFullExternalAccess,
  normalizeExternalDirectoryAccessMode,
  syncExternalDirectoryAccessMode,
} from "../wodeapp/wodeapp-external-directory-access";

describe("external directory access mode", () => {
  test("defaults to ask (same as previous product behavior)", () => {
    expect(DEFAULT_EXTERNAL_DIRECTORY_ACCESS).toBe("ask");
    expect(normalizeExternalDirectoryAccessMode(undefined)).toBe("ask");
    expect(normalizeExternalDirectoryAccessMode("ask")).toBe("ask");
    expect(normalizeExternalDirectoryAccessMode("full")).toBe("full");
    expect(normalizeExternalDirectoryAccessMode("nope")).toBe("ask");
  });

  test("adds and removes the root full-access folder", () => {
    expect(foldersWithFullExternalAccess(["/Users/me/Desktop"])).toEqual([
      "/",
      "/Users/me/Desktop",
    ]);
    expect(hasFullExternalAccess(["/", "/Users/me/Desktop"])).toBe(true);
    expect(foldersWithoutFullExternalAccess(["/", "/Users/me/Desktop"])).toEqual([
      "/Users/me/Desktop",
    ]);
  });

  test("syncs full mode by authorizing /* once", async () => {
    const calls: string[][] = [];
    const client = {
      listAuthorizedFolders: async () => ({ folders: ["/Users/me/Desktop"] }),
      setAuthorizedFolders: async (_id: string, folders: string[]) => {
        calls.push(folders);
        return { folders };
      },
    };

    const first = await syncExternalDirectoryAccessMode({
      mode: "full",
      openworkClient: client,
      openworkWorkspaceId: "ws_1",
    });
    expect(first.changed).toBe(true);
    expect(first.folders).toEqual(["/", "/Users/me/Desktop"]);

    const second = await syncExternalDirectoryAccessMode({
      mode: "full",
      openworkClient: {
        ...client,
        listAuthorizedFolders: async () => ({ folders: ["/", "/Users/me/Desktop"] }),
      },
      openworkWorkspaceId: "ws_1",
    });
    expect(second.changed).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("sync ask mode removes only the full-access root", async () => {
    const client = {
      listAuthorizedFolders: async () => ({ folders: ["/", "/Users/me/Desktop"] }),
      setAuthorizedFolders: async (_id: string, folders: string[]) => ({ folders }),
    };
    const result = await syncExternalDirectoryAccessMode({
      mode: "ask",
      openworkClient: client,
      openworkWorkspaceId: "ws_1",
    });
    expect(result.changed).toBe(true);
    expect(result.folders).toEqual(["/Users/me/Desktop"]);
  });
});
