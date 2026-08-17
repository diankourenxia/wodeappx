import { describe, expect, mock, test } from "bun:test";

mock.module("@/app/lib/wodeapp-auth", () => ({
  applyWodeAppProvider: async () => ({ ok: true }),
  loadCachedWodeAppAuthState: async () => ({
    ok: true,
    signedIn: true,
    config: { credits: 10 },
  }),
  getWodeAppServiceConfig: async () => ({
    ok: true,
    config: { profile: "cloud", origin: "https://wodeapp.cn" },
  }),
}));

const {
  classifyWodeAppCreditGatedError,
  ensureWodeAppSendReady,
  isLocalByokSendLane,
  isLocalServiceMode,
  isWodeAppCreditGatedErrorText,
  LOCAL_BYOK_SEND_HINT,
  LOCAL_MODE_SEND_HINT,
  WodeAppSendBlockedError,
} = await import("../wodeapp/wodeapp-send-readiness");

describe("WodeApp send readiness", () => {
  test("detects credit-gated upstream errors", () => {
    expect(isWodeAppCreditGatedErrorText("INSUFFICIENT_CREDITS")).toBe(true);
    expect(isWodeAppCreditGatedErrorText('{"error":{"code":"credit_error"}}')).toBe(true);
    expect(isWodeAppCreditGatedErrorText("Status: 402")).toBe(true);
    expect(isWodeAppCreditGatedErrorText("积分不足")).toBe(true);
    expect(isWodeAppCreditGatedErrorText("请先登录")).toBe(true);
    expect(isWodeAppCreditGatedErrorText("network timeout")).toBe(false);
  });

  test("maps AUTH_REQUIRED to login", () => {
    const classified = classifyWodeAppCreditGatedError("AUTH_REQUIRED: please sign in", 99);
    expect(classified).toEqual({
      reason: "provider",
      kind: "provider-not-ready",
      message: "账号未就绪，请重试发送",
    });
  });

  test("local service AUTH_REQUIRED points at local Key setup", () => {
    const classified = classifyWodeAppCreditGatedError("AUTH_REQUIRED", null, {
      localServiceMode: true,
    });
    expect(classified?.message).toBe(LOCAL_MODE_SEND_HINT);
  });

  test("unsigned AUTH_REQUIRED points at local Key setup", () => {
    const classified = classifyWodeAppCreditGatedError("AUTH_REQUIRED", null, {
      unsigned: true,
    });
    expect(classified?.message).toBe(LOCAL_BYOK_SEND_HINT);
  });

  test("local BYOK 402 is provider hint not recharge", () => {
    const classified = classifyWodeAppCreditGatedError("Status: 402 INSUFFICIENT_CREDITS", 0, {
      localByokActive: true,
    });
    expect(classified?.reason).toBe("provider");
  });

  test("local credits >= 1 + 402 means provider race, not recharge", () => {
    const classified = classifyWodeAppCreditGatedError(
      "Status: 402 INSUFFICIENT_CREDITS required: 1",
      42,
    );
    expect(classified).toEqual({
      reason: "provider",
      kind: "provider-not-ready",
      message: "账号未就绪，请重试发送",
    });
  });

  test("zero or unknown local credits + 402 means recharge", () => {
    expect(classifyWodeAppCreditGatedError("INSUFFICIENT_CREDITS", 0)?.reason).toBe("recharge");
    expect(classifyWodeAppCreditGatedError("INSUFFICIENT_CREDITS", null)?.reason).toBe("recharge");
  });

  test("WodeAppSendBlockedError carries gate kind", () => {
    const login = new WodeAppSendBlockedError("login", "请先登录后再发送");
    expect(login.name).toBe("WodeAppSendBlockedError");
    expect(login.kind).toBe("auth-required");

    const recharge = new WodeAppSendBlockedError("recharge", "积分不足，请充值或领取每日积分");
    expect(recharge.kind).toBe("insufficient-credits");

    const provider = new WodeAppSendBlockedError("provider", "账号未就绪");
    expect(provider.kind).toBe("provider-not-ready");
  });

  test("isLocalServiceMode detects localhost and profiles", () => {
    expect(isLocalServiceMode("http://127.0.0.1:3000", "cloud")).toBe(true);
    expect(isLocalServiceMode("https://wodeapp.cn", "local-only")).toBe(true);
    expect(isLocalServiceMode("https://wodeapp.cn", "selfhost")).toBe(true);
    expect(isLocalServiceMode("https://wodeapp.cn", "cloud")).toBe(false);
  });

  test("local BYOK lane skips WodeApp login", async () => {
    expect(
      isLocalByokSendLane(
        { providerID: "openrouter", modelID: "x" },
        ["openrouter"],
      ),
    ).toBe(true);

    const ready = await ensureWodeAppSendReady({
      selectedModel: { providerID: "openrouter", modelID: "x" },
      connectedProviderIds: ["openrouter"],
    });
    expect(ready.mode).toBe("local-byok");
    expect(ready.config).toBeNull();
  });

  test("unsigned WodeApp family remaps to local DeepSeek and skips login", async () => {
    expect(
      isLocalByokSendLane(
        { providerID: "wodeapp", modelID: "wode/deepseek-v4-flash" },
        ["deepseek"],
        [{ id: "deepseek", models: ["deepseek-v4-flash"] }],
      ),
    ).toBe(true);

    const ready = await ensureWodeAppSendReady({
      selectedModel: { providerID: "wodeapp", modelID: "wode/deepseek-v4-flash" },
      connectedProviderIds: ["deepseek"],
      connectedModels: [{ id: "deepseek", models: ["deepseek-v4-flash"] }],
    });
    expect(ready.mode).toBe("local-byok");
  });
});
