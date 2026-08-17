/** Slash command name: letters (incl. CJK), digits, underscore, hyphen. */
const SLASH_COMMAND_NAME = String.raw`[\p{L}\p{N}_-]+`;
const SLASH_COMMAND_QUERY_RE = new RegExp(String.raw`^\/(${SLASH_COMMAND_NAME.replace("+", "*")})$`, "u");
const SLASH_COMMAND_INVOCATION_RE = new RegExp(
  String.raw`^\/(${SLASH_COMMAND_NAME})(?:[ \t]+([\s\S]*))?$`,
  "u",
);

export function getSlashCommandQuery(value: string) {
  const match = value.match(SLASH_COMMAND_QUERY_RE);
  return match ? match[1] : null;
}

export function parseSlashCommandInvocation(value: string) {
  const match = value.trim().match(SLASH_COMMAND_INVOCATION_RE);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  return { name, arguments: match[2] ?? "" };
}
