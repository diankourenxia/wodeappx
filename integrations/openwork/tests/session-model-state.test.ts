import { describe, expect, test } from "bun:test";

import {
  resolveSessionModelState,
  selectSessionModel,
} from "../src/react-app/domains/wodeapp/wodeapp-session-model-state";

const defaultModel = { providerID: "wodeapp", modelID: "wode/default" };
const sessionAModel = { providerID: "wodeapp", modelID: "wode/session-a" };

describe("session model state", () => {
  test("a session override does not change the default or another session", () => {
    const sessionA = selectSessionModel(
      resolveSessionModelState(defaultModel, "balanced", undefined),
      sessionAModel,
    );

    expect(resolveSessionModelState(defaultModel, "balanced", sessionA)).toEqual({
      model: sessionAModel,
      variant: null,
    });
    expect(resolveSessionModelState(defaultModel, "balanced", undefined)).toEqual({
      model: defaultModel,
      variant: "balanced",
    });
    expect(defaultModel).toEqual({ providerID: "wodeapp", modelID: "wode/default" });
  });

  test("reselecting the same session model preserves its variant", () => {
    const current = resolveSessionModelState(defaultModel, "high", {
      model: sessionAModel,
      variant: "max",
    });

    expect(selectSessionModel(current, sessionAModel)).toEqual({
      model: sessionAModel,
      variant: "max",
    });
  });
});
