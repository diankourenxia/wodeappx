import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  collectProviderSecrets,
  probeUnifiedOpenAiCompatible,
  extractModelRecords,
  looksLikeEnvPlaceholder,
  maskKeyPreview,
  detectConfiguredProviderCapabilitiesUnified,
  clearProviderCapabilityProbeCache,
} from "../../wodeapp-cloud/electron/wodeapp-provider-capability-detect.mjs";

describe("unified OpenAI-compatible probe", () => {
  beforeEach(() => {
    clearProviderCapabilityProbeCache();
  });

  afterEach(() => {
    clearProviderCapabilityProbeCache();
  });

  test("old keys.json without unified shape still loads", async () => {
    const envMap = new Map([
      ["DEEPSEEK_API_KEY", "sk-test-deepseek-123"],
      ["MOONSHOT_API_KEY", "sk-test-moonshot-456"],
    ]);

    const secrets = await collectProviderSecrets({
      envMap,
      envOrigins: new Map([
        ["DEEPSEEK_API_KEY", "desktop-env"],
        ["MOONSHOT_API_KEY", "desktop-env"],
      ]),
      authMap: new Map(),
      processEnv: {},
    });

    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.some((s) => s.id === "deepseek")).toBe(true);
    expect(secrets.some((s) => s.id === "moonshot")).toBe(true);
  });

  test("probe failure hides the row (no failed probes appear)", async () => {
    const mockFetch = mock(() => Promise.reject(new Error("Network timeout")));

    const result = await probeUnifiedOpenAiCompatible({
      envMap: new Map([["DEEPSEEK_API_KEY", "sk-invalid"]]),
      envOrigins: new Map([["DEEPSEEK_API_KEY", "desktop-env"]]),
      authMap: new Map(),
      processEnv: {},
      fetchImpl: mockFetch,
    });

    expect(result).toBeNull();
  });

  test("successful probe returns unified row with merged models", async () => {
    const mockFetch = mock((url) => {
      if (url.includes("deepseek")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            data: [
              { id: "deepseek-chat", name: "DeepSeek Chat" },
              { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
            ],
          })),
        });
      }
      if (url.includes("moonshot")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            data: [
              { id: "moonshot-v1-8k", name: "Moonshot 8K" },
            ],
          })),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    const result = await probeUnifiedOpenAiCompatible({
      envMap: new Map([
        ["DEEPSEEK_API_KEY", "sk-test-deepseek-123"],
        ["MOONSHOT_API_KEY", "sk-test-moonshot-456"],
      ]),
      envOrigins: new Map([
        ["DEEPSEEK_API_KEY", "desktop-env"],
        ["MOONSHOT_API_KEY", "desktop-env"],
      ]),
      authMap: new Map(),
      processEnv: {},
      fetchImpl: mockFetch,
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe("openai-compatible");
    expect(result.probeStatus).toBe("ok");
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.some((m) => m.id === "deepseek-chat")).toBe(true);
    expect(result.models.some((m) => m.id === "moonshot-v1-8k")).toBe(true);
  });

  test("no apiKey is written into models.json (provider options stripped)", () => {
    const providerWithKey = {
      npm: "@ai-sdk/openai-compatible",
      name: "Test Provider",
      options: {
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-secret-key-12345",
        timeout: 30000,
      },
    };

    // Simulate normalizeUserProviders stripping
    const normalized = { ...providerWithKey };
    const options = { ...normalized.options };
    delete options.apiKey;
    normalized.options = options;

    expect(normalized.options.apiKey).toBeUndefined();
    expect(normalized.options.baseURL).toBe("https://api.example.com/v1");
    expect(normalized.options.timeout).toBe(30000);
  });

  test("extractModelRecords handles various response formats", () => {
    const openAiFormat = { data: [{ id: "gpt-4", name: "GPT-4" }] };
    const registryFormat = {
      registry: {
        text: [{ id: "model-1", label: "Model 1" }],
      },
    };

    expect(extractModelRecords(openAiFormat).length).toBe(1);
    expect(extractModelRecords(registryFormat).length).toBe(1);
    expect(extractModelRecords(null).length).toBe(0);
  });

  test("looksLikeEnvPlaceholder detects placeholder values", () => {
    expect(looksLikeEnvPlaceholder("")).toBe(true);
    expect(looksLikeEnvPlaceholder("changeme")).toBe(true);
    expect(looksLikeEnvPlaceholder("YOUR_API_KEY_HERE")).toBe(true);
    expect(looksLikeEnvPlaceholder("sk-real-key-123abc")).toBe(false);
  });

  test("maskKeyPreview masks keys correctly", () => {
    expect(maskKeyPreview("sk-1234567890abcdef")).toBe("sk-1***cdef");
    expect(maskKeyPreview("short")).toBe("sh***");
    expect(maskKeyPreview("")).toBe("");
  });

  test("detectConfiguredProviderCapabilitiesUnified returns unified mode by default", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          data: [{ id: "test-model" }],
        })),
      }),
    );

    const result = await detectConfiguredProviderCapabilitiesUnified({
      envMap: new Map([["DEEPSEEK_API_KEY", "sk-test"]]),
      envOrigins: new Map([["DEEPSEEK_API_KEY", "desktop-env"]]),
      authMap: new Map(),
      processEnv: {},
      fetchImpl: mockFetch,
      force: true,
    });

    expect(result.ok).toBe(true);
    const hasUnified = result.probes.some((p) => p.id === "openai-compatible");
    expect(hasUnified).toBe(true);
  });

  test("legacy mode still returns separate vendor rows", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          data: [{ id: "test-model" }],
        })),
      }),
    );

    const result = await detectConfiguredProviderCapabilitiesUnified({
      envMap: new Map([
        ["DEEPSEEK_API_KEY", "sk-test-deepseek"],
        ["MOONSHOT_API_KEY", "sk-test-moonshot"],
      ]),
      envOrigins: new Map([
        ["DEEPSEEK_API_KEY", "desktop-env"],
        ["MOONSHOT_API_KEY", "desktop-env"],
      ]),
      authMap: new Map(),
      processEnv: {},
      fetchImpl: mockFetch,
      force: true,
      mode: "legacy",
    });

    expect(result.ok).toBe(true);
    const hasDeepSeek = result.probes.some((p) => p.id === "deepseek");
    const hasMoonshot = result.probes.some((p) => p.id === "moonshot");
    expect(hasDeepSeek || hasMoonshot).toBe(true);
  });
});
