import {
  getOrCreateWodeAppInstallId,
  loadWodeAppConfig,
  normalizeWodeAppCloudConfig,
} from "./config-store.mjs";

/**
 * Browser login replaces the embedded install wallet. Keep installId for
 * device telemetry only — billing must use the logged-in apiKey thereafter.
 */
export async function buildLoggedInWodeAppConfig(partial) {
  const previous = await loadWodeAppConfig();
  const installId = typeof previous?.embeddedInstallId === "string" && previous.embeddedInstallId.trim()
    ? previous.embeddedInstallId.trim()
    : await getOrCreateWodeAppInstallId();
  return normalizeWodeAppCloudConfig({
    ...partial,
    embedded: false,
    embeddedInstallId: installId,
  });
}
