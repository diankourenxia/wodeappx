# BrowserAct integration

BrowserAct is exposed in WodeAppX as an optional OpenWork extension.

## Phase 1: BrowserAct MCP

The built-in extension connects a BrowserAct MCP server that the user creates in the BrowserAct Dashboard.

Required inputs:

- BrowserAct MCP Server URL
- BrowserAct MCP API key

WodeAppX writes an OpenWork MCP entry named `browseract` with:

```json
{
  "type": "remote",
  "url": "https://...",
  "headers": {
    "Authorization": "Bearer <key>"
  },
  "oauth": false,
  "timeout": 300000
}
```

This keeps BrowserAct account, credits, workflows, and API keys owned by the user.

## Future: local CLI and Skill

The local BrowserAct path is separate from MCP:

- install `browser-act-cli`
- install the `browser-act/SKILL.md` entry skill
- let OpenWork/OpenCode invoke the local CLI under normal desktop permissions

Do not vendor the full `browser-act/skills` solutions catalog by default. Some solution skills depend on BrowserAct cloud APIs, paid proxy/stealth features, or site-specific automation policies.
