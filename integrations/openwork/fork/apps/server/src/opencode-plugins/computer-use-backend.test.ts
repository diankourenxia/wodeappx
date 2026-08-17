import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "./computer-use-backend.js";

const { mapHandsfreeToOcu, normalizeElementIndex, mapPressKey } = __testing;

test("normalizeElementIndex maps HandsFree refs and indexes", () => {
  assert.equal(normalizeElementIndex({ ref: "{e12}" }), "12");
  assert.equal(normalizeElementIndex({ ref: "e3" }), "3");
  assert.equal(normalizeElementIndex({ index: 7 }), "7");
  assert.equal(normalizeElementIndex({ element_index: "9" }), "9");
});

test("mapPressKey normalizes macOS combos for OCU", () => {
  assert.equal(mapPressKey({ combo: "command+k" }), "super+k");
  assert.equal(mapPressKey({ combo: "return" }), "Return");
  assert.equal(mapPressKey({ key: "Escape" }), "Escape");
});

test("mapHandsfreeToOcu maps core tools", () => {
  assert.deepEqual(
    mapHandsfreeToOcu("snapshot", { app: "Notepad" }),
    { tool: "get_app_state", args: { app: "Notepad" } },
  );
  assert.deepEqual(
    mapHandsfreeToOcu("click", { ref: "{e1}" }, "Notepad"),
    { tool: "click", args: { app: "Notepad", element_index: "1" } },
  );
  assert.deepEqual(
    mapHandsfreeToOcu("press_key", { combo: "command+c" }, "Notepad"),
    { tool: "press_key", args: { app: "Notepad", key: "super+c" } },
  );
  assert.deepEqual(
    mapHandsfreeToOcu("perform_action", { ref: "{e2}", action: "AXConfirm" }, "Notepad"),
    { tool: "perform_secondary_action", args: { app: "Notepad", element_index: "2", action: "AXConfirm" } },
  );
});

test("mapHandsfreeToOcu requires app for snapshots on OCU", () => {
  assert.throws(
    () => mapHandsfreeToOcu("snapshot", {}),
    /requires args\.app/,
  );
});
