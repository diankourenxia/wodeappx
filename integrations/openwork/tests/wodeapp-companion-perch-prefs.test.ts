import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCompanionFloatEnabled,
  resolveCompanionPerchEnabled,
  skinHasFloatCompanion,
  skinHasPerchCompanion,
  WODEAPP_SKIN_COMPANION_KIT,
} from "../wodeapp/wodeapp-companion-prefs.ts";
import {
  companionAvatarsForPlacement,
  resolveFloatCompanionAvatar,
  resolveFloatCompanionAvatarForSkin,
  resolvePerchCompanionAvatar,
  resolvePerchCompanionAvatarForSkin,
} from "../wodeapp/wodeapp-companion-avatars.ts";

const base = {
  enabled: true,
  kind: "sprite" as const,
  avatarId: "cat",
  perchEnabled: false,
  perchConfigured: false,
  perchKind: "sprite" as const,
  perchAvatarId: "perch-poodle",
};

test("skin kits: pet-soft / otome-diary / summer-breeze ship both pets; others ship none", () => {
  assert.equal(skinHasFloatCompanion("pet-soft"), true);
  assert.equal(skinHasPerchCompanion("pet-soft"), true);
  assert.equal(skinHasFloatCompanion("otome-diary"), true);
  assert.equal(skinHasPerchCompanion("otome-diary"), true);
  assert.equal(skinHasFloatCompanion("summer-breeze"), true);
  assert.equal(skinHasPerchCompanion("summer-breeze"), true);
  for (const skin of ["ink-book", "default", "cute-pastel", "red-compact", "supor"]) {
    assert.equal(skinHasFloatCompanion(skin), false);
    assert.equal(skinHasPerchCompanion(skin), false);
  }
  assert.equal(WODEAPP_SKIN_COMPANION_KIT["pet-soft"]?.floatAvatarId, "dog");
  assert.equal(WODEAPP_SKIN_COMPANION_KIT["otome-diary"]?.perchAvatarId, "perch-otome");
  assert.equal(WODEAPP_SKIN_COMPANION_KIT["summer-breeze"]?.floatAvatarId, "otter");
  assert.equal(WODEAPP_SKIN_COMPANION_KIT["summer-breeze"]?.perchAvatarId, "perch-otter");
});

test("unconfigured perch follows skins that ship a 趴宠", () => {
  assert.equal(resolveCompanionPerchEnabled(base, "pet-soft"), true);
  assert.equal(resolveCompanionPerchEnabled(base, "otome-diary"), true);
  assert.equal(resolveCompanionPerchEnabled(base, "summer-breeze"), true);
  assert.equal(resolveCompanionPerchEnabled(base, "ink-book"), false);
  assert.equal(resolveCompanionPerchEnabled(base, "default"), false);
});

test("configured perch still cannot appear on skins without a kit", () => {
  assert.equal(
    resolveCompanionPerchEnabled({ ...base, perchEnabled: true, perchConfigured: true }, "ink-book"),
    false,
  );
  assert.equal(
    resolveCompanionPerchEnabled({ ...base, perchEnabled: false, perchConfigured: true }, "pet-soft"),
    false,
  );
  assert.equal(
    resolveCompanionPerchEnabled({ ...base, perchEnabled: true, perchConfigured: true }, "pet-soft"),
    true,
  );
});

test("float companion is gated by the skin kit", () => {
  assert.equal(resolveCompanionFloatEnabled(base, "pet-soft"), true);
  assert.equal(resolveCompanionFloatEnabled(base, "otome-diary"), true);
  assert.equal(resolveCompanionFloatEnabled(base, "summer-breeze"), true);
  assert.equal(resolveCompanionFloatEnabled(base, "ink-book"), false);
  assert.equal(resolveCompanionFloatEnabled(base, "red-compact"), false);
  assert.equal(resolveCompanionFloatEnabled({ ...base, enabled: false }, "pet-soft"), false);
});

test("float and perch avatar catalogs are separate", () => {
  const floatIds = companionAvatarsForPlacement("float").map((a) => a.id);
  const perchIds = companionAvatarsForPlacement("perch").map((a) => a.id);
  assert.ok(floatIds.includes("cat"));
  assert.ok(floatIds.includes("otome-default"));
  assert.ok(!floatIds.includes("perch-poodle"));
  assert.ok(perchIds.includes("perch-poodle"));
  assert.ok(perchIds.includes("perch-otome"));
  assert.ok(perchIds.includes("perch-cat"));
  assert.ok(perchIds.includes("perch-rabbit"));
  assert.ok(!perchIds.includes("cat"));
});

test("float and perch resolve avatars independently", () => {
  assert.equal(resolveFloatCompanionAvatar(base).id, "cat");
  assert.equal(resolvePerchCompanionAvatar(base).id, "perch-poodle");
  assert.equal(
    resolvePerchCompanionAvatar({ ...base, perchAvatarId: "perch-cat" }).id,
    "perch-cat",
  );
});

test("unconfigured perch avatar follows skin default", () => {
  const unconfigured = { ...base, perchConfigured: false, perchAvatarId: "perch-poodle" };
  assert.equal(resolvePerchCompanionAvatarForSkin(unconfigured, "pet-soft")?.id, "perch-poodle");
  assert.equal(resolvePerchCompanionAvatarForSkin(unconfigured, "otome-diary")?.id, "perch-otome");
  assert.equal(resolvePerchCompanionAvatarForSkin(unconfigured, "summer-breeze")?.id, "perch-otter");
  assert.equal(resolvePerchCompanionAvatarForSkin(unconfigured, "ink-book"), null);
});

test("skin-owned float avatars follow the active skin; generic customs stay", () => {
  const dogPrefs = { ...base, avatarId: "dog" };
  assert.equal(resolveFloatCompanionAvatarForSkin(dogPrefs, "pet-soft")?.id, "dog");
  assert.equal(resolveFloatCompanionAvatarForSkin(dogPrefs, "otome-diary")?.id, "otome-default");
  assert.equal(resolveFloatCompanionAvatarForSkin(dogPrefs, "summer-breeze")?.id, "otter");
  assert.equal(resolveFloatCompanionAvatarForSkin(dogPrefs, "ink-book"), null);

  const catPrefs = { ...base, avatarId: "cat" };
  assert.equal(resolveFloatCompanionAvatarForSkin(catPrefs, "pet-soft")?.id, "cat");
  assert.equal(resolveFloatCompanionAvatarForSkin(catPrefs, "otome-diary")?.id, "cat");
  assert.equal(resolveFloatCompanionAvatarForSkin(catPrefs, "summer-breeze")?.id, "cat");
});

test("skin-owned perch avatars follow the active skin", () => {
  const configured = {
    ...base,
    perchConfigured: true,
    perchEnabled: true,
    perchAvatarId: "perch-poodle",
  };
  assert.equal(resolvePerchCompanionAvatarForSkin(configured, "pet-soft")?.id, "perch-poodle");
  assert.equal(resolvePerchCompanionAvatarForSkin(configured, "otome-diary")?.id, "perch-otome");
  assert.equal(resolvePerchCompanionAvatarForSkin(configured, "summer-breeze")?.id, "perch-otter");
  assert.equal(resolvePerchCompanionAvatarForSkin(configured, "cute-pastel"), null);

  const customPerch = { ...configured, perchAvatarId: "perch-cat" };
  assert.equal(resolvePerchCompanionAvatarForSkin(customPerch, "pet-soft")?.id, "perch-cat");
});
