export type NormalizedEngineRunState = "active" | "waiting_permission" | "retrying";

export interface NormalizedEngineRun {
  sessionId: string;
  state: NormalizedEngineRunState;
  sourceStatus?: string;
}

export interface EngineAdapterCapabilities {
  atomicReload: false;
  dynamicPluginReload: boolean;
  serviceOwnership: boolean;
}

export interface EngineAdapter {
  readonly protocol: "opencode-v1";
  readonly capabilities: EngineAdapterCapabilities;
  activeRuns(): Promise<NormalizedEngineRun[]>;
  reload(): Promise<void>;
}

export interface OpenCodeV1Connection {
  baseUrl: string;
  directory?: string | null;
  authHeader?: string | null;
}
