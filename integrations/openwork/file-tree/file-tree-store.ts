import { create } from "zustand";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { buildFileTree, type FileTreeNode } from "./build-file-tree";

type FileTreeLoadStatus = "idle" | "loading" | "ready" | "error";

type WorkspaceFileTreeState = {
  status: FileTreeLoadStatus;
  nodes: FileTreeNode[];
  error: string | null;
  loadedAt: number | null;
  truncated: boolean;
};

const EMPTY_WORKSPACE_STATE: WorkspaceFileTreeState = {
  status: "idle",
  nodes: [],
  error: null,
  loadedAt: null,
  truncated: false,
};

const EMPTY_EXPANDED_PATHS: Set<string> = new Set();

type FileTreeStore = {
  byWorkspaceId: Record<string, WorkspaceFileTreeState>;
  expandedPathsByWorkspaceId: Record<string, Set<string>>;
  load: (workspaceId: string, client: OpenworkServerClient) => Promise<void>;
  toggleExpanded: (workspaceId: string, path: string) => void;
};

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  byWorkspaceId: {},
  expandedPathsByWorkspaceId: {},

  load: async (workspaceId, client) => {
    const existing = get().byWorkspaceId[workspaceId] ?? EMPTY_WORKSPACE_STATE;
    if (existing.status === "loading") return;

    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: { ...existing, status: "loading", error: null },
      },
    }));

    try {
      const result = await client.listWorkspaceFileTree(workspaceId);
      const nodes = buildFileTree(result.items);
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            status: "ready",
            nodes,
            error: null,
            loadedAt: Date.now(),
            truncated: result.truncated,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            status: "error",
            nodes: [],
            error: error instanceof Error ? error.message : "Failed to load workspace files",
            loadedAt: null,
            truncated: false,
          },
        },
      }));
    }
  },

  toggleExpanded: (workspaceId, path) => set((state) => {
    const current = new Set(state.expandedPathsByWorkspaceId[workspaceId] ?? EMPTY_EXPANDED_PATHS);
    if (current.has(path)) {
      current.delete(path);
    } else {
      current.add(path);
    }
    return {
      expandedPathsByWorkspaceId: {
        ...state.expandedPathsByWorkspaceId,
        [workspaceId]: current,
      },
    };
  }),
}));

export function useWorkspaceFileTree(workspaceId: string): WorkspaceFileTreeState {
  return useFileTreeStore((state) => state.byWorkspaceId[workspaceId] ?? EMPTY_WORKSPACE_STATE);
}

export function useExpandedFileTreePaths(workspaceId: string): Set<string> {
  return useFileTreeStore((state) => state.expandedPathsByWorkspaceId[workspaceId] ?? EMPTY_EXPANDED_PATHS);
}
