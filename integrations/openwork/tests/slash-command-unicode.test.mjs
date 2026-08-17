import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const slashCommandPath = path.resolve(
  here,
  "../fork/apps/app/src/react-app/domains/session/surface/composer/slash-command.ts",
);
const localizePath = path.resolve(
  here,
  "../fork/apps/app/src/react-app/domains/session/surface/composer/slash-command-localize.ts",
);
const commandZh = path.resolve(here, "../commands/自进化.md");
const commandEn = path.resolve(here, "../commands/evolve.md");

const SLASH_COMMAND_NAME = String.raw`[\p{L}\p{N}_-]+`;
const SLASH_COMMAND_QUERY_RE = new RegExp(String.raw`^\/(${SLASH_COMMAND_NAME.replace("+", "*")})$`, "u");
const SLASH_COMMAND_INVOCATION_RE = new RegExp(
  String.raw`^\/(${SLASH_COMMAND_NAME})(?:[ \t]+([\s\S]*))?$`,
  "u",
);

function getSlashCommandQuery(value) {
  const match = value.match(SLASH_COMMAND_QUERY_RE);
  return match ? match[1] : null;
}

function parseSlashCommandInvocation(value) {
  const match = value.trim().match(SLASH_COMMAND_INVOCATION_RE);
  if (!match?.[1]) return null;
  return { name: match[1], arguments: match[2] ?? "" };
}

/** Mirror of preferLocalizedSlashCommands without i18n import (node:test). */
function preferLocalizedSlashCommands(commands, locale) {
  const preferredName = locale === "zh" ? "自进化" : "evolve";
  const aliasName = preferredName === "自进化" ? "evolve" : "自进化";
  const names = new Set(["自进化", "evolve"]);
  const preferred = commands.find((c) => c.name === preferredName);
  const alias = commands.find((c) => c.name === aliasName);
  const rest = commands.filter((c) => !names.has(c.name));
  return [
    {
      id: `cmd:${preferredName}`,
      name: preferredName,
      description: locale === "zh"
        ? "修改本机应用自身（皮肤、文案、功能）；须确认后快照与验证"
        : "Edit this app itself (skins, copy, features); confirm then snapshot + verify",
      source: "command",
    },
    ...rest,
  ];
}

test("slash-command.ts keeps Unicode letter support", () => {
  const source = readFileSync(slashCommandPath, "utf8");
  assert.match(source, /\\p\{L\}/);
  assert.match(source, /\\p\{N\}/);
  assert.match(source, /["']u["']/);
});

test("localize helper pins preferred self-evolve name by locale", () => {
  const source = readFileSync(localizePath, "utf8");
  assert.match(source, /preferLocalizedSlashCommands/);
  assert.match(source, /SELF_EVOLVE_COMMAND_ZH/);

  const input = [
    { id: "cmd:init", name: "init", description: "setup" },
    { id: "cmd:evolve", name: "evolve", description: "en" },
    { id: "cmd:自进化", name: "自进化", description: "zh" },
    { id: "cmd:review", name: "review", description: "review" },
  ];

  const zh = preferLocalizedSlashCommands(input, "zh");
  assert.equal(zh[0].name, "自进化");
  assert.equal(zh.length, 3);
  assert.ok(!zh.some((c) => c.name === "evolve"));
  assert.match(zh[0].description, /修改本机/);

  const en = preferLocalizedSlashCommands(input, "en");
  assert.equal(en[0].name, "evolve");
  assert.equal(en.length, 3);
  assert.ok(!en.some((c) => c.name === "自进化"));
  assert.match(en[0].description, /Edit this app/);
});

test("injects preferred even when engine list empty", () => {
  const zh = preferLocalizedSlashCommands([{ id: "cmd:init", name: "init" }], "zh");
  assert.equal(zh[0].name, "自进化");
  assert.equal(zh[1].name, "init");
});

test("slash query accepts /自进化 and /evolve", () => {
  assert.equal(getSlashCommandQuery("/自进化"), "自进化");
  assert.equal(getSlashCommandQuery("/evolve"), "evolve");
  assert.equal(getSlashCommandQuery("/自进化 extra"), null);
  assert.equal(getSlashCommandQuery("自进化"), null);
});

test("slash invocation parses Chinese command + args", () => {
  assert.deepEqual(parseSlashCommandInvocation("/自进化 换萌宠皮"), {
    name: "自进化",
    arguments: "换萌宠皮",
  });
  assert.deepEqual(parseSlashCommandInvocation("/evolve skin pet-soft"), {
    name: "evolve",
    arguments: "skin pet-soft",
  });
});

test("command markdown files are language-pure", () => {
  const zh = readFileSync(commandZh, "utf8");
  const en = readFileSync(commandEn, "utf8");
  assert.match(zh, /^---\nname:\s*自进化\n/m);
  assert.match(en, /^---\nname:\s*evolve\n/m);
  assert.match(zh, /你正在执行/);
  assert.match(en, /You are running/);
  assert.doesNotMatch(zh, /You are running/);
  assert.doesNotMatch(en, /你正在执行/);
});
