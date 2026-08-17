/**
 * WodeApp App core — config + public API contract helpers
 * @see wodeappx/docs/ARCHITECTURE.md
 */

export type { WodeAppProfile, WodeAppConfig, ProjectSiteInput } from './config.js';
export {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  getProjectSiteUrl,
  getWebAgentUrl,
  inferProjectSubdomainSuffix,
  normalizeWodeAppCloudConfig,
  normalizeWodeAppCloudOrigin,
  normalizeWodeAppCloudProjectSuffix,
  normalizeWodeAppCloudUrl,
  resolvePublishedSiteUrl,
  usesSubdomainTenancy,
  WODEAPP_CLOUD_ORIGIN,
  WODEAPP_CLOUD_ORIGIN_AI,
  WODEAPP_CLOUD_ORIGIN_CN,
} from './config.js';

export { getConfigDir, getConfigPath, loadConfig, saveConfig } from './config-store.js';

export {
  BRAND_AGENTS_FILE_NAME,
  PLAZA_CATALOG_DIR_NAME,
  PLAZA_CATALOG_FILE_NAME,
  getBrandAgentsPath,
  getPlazaCatalogPath,
  loadBrandAgentsFile,
  loadPlazaCatalogFile,
  saveBrandAgentsFile,
  savePlazaCatalogFile,
} from './plaza-catalog-store.js';
export type { BrandAgentsFile, PlazaCatalogFile } from './plaza-catalog-store.js';

export type {
  AgentModelOption,
  AgentIndex,
  SelfContext,
  HubProject,
  PreviewTokenData,
  PreviewMode,
} from './api.js';
export {
  fetchAgentIndex,
  fetchAgentModels,
  fetchSelfContext,
  fetchProjects,
  fetchCredits,
  fetchPreviewToken,
  isPreviewTokenExpired,
  verifyConfig,
} from './api.js';

export type {
  AgentChatRequest,
  AgentSseParseState,
  AgentStreamEvent,
  AgentToolCall,
  AgentToolResult,
} from './agent.js';
export {
  createAgentSseParseState,
  isAgentProjectWriteTool,
  parseAgentSseChunk,
} from './agent.js';
