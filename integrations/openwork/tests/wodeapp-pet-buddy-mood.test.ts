import assert from "node:assert/strict";
import test from "node:test";

import { resolvePetBuddyMood } from "../wodeapp/wodeapp-pet-buddy-mood.ts";

test("resolvePetBuddyMood: react beats busy and idle", () => {
  assert.equal(
    resolvePetBuddyMood({ reacting: true, selectedStatus: "thinking", asleep: true }),
    "react",
  );
});

test("resolvePetBuddyMood: busy session watches", () => {
  assert.equal(
    resolvePetBuddyMood({ reacting: false, selectedStatus: "responding", asleep: true }),
    "watch",
  );
  assert.equal(
    resolvePetBuddyMood({ reacting: false, selectedStatus: "thinking", asleep: false }),
    "watch",
  );
});

test("resolvePetBuddyMood: asleep flag sleeps", () => {
  assert.equal(
    resolvePetBuddyMood({ reacting: false, selectedStatus: "idle", asleep: true }),
    "sleep",
  );
});

test("resolvePetBuddyMood: short idle stays awake", () => {
  assert.equal(
    resolvePetBuddyMood({ reacting: false, selectedStatus: "idle", asleep: false }),
    "idle",
  );
});

test("resolvePetBuddyMood: legacy idleForMs still works", () => {
  assert.equal(
    resolvePetBuddyMood({ reacting: false, selectedStatus: "idle", idleForMs: 18_000 }),
    "sleep",
  );
});
