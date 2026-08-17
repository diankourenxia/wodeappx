# WodeAppX Agent Reach

Agent Reach is used here as a capability pattern, not as a bundled server dependency.

WodeAppX exposes a small read-only local internet toolset directly through the built-in OpenCode plugin:

- `agent_reach_status`: checks local upstream commands such as `yt-dlp`, `opencli`, `bili`, `gh`, `mcporter`, and `ffmpeg`.
- `agent_reach_web_search`: searches current public web results through DuckDuckGo HTML and returns source URLs.
- `agent_reach_weather`: resolves a place and returns current conditions plus hourly/daily forecasts through Open-Meteo.
- `agent_reach_web_read`: reads public web pages through Jina Reader first, then direct fetch fallback.
- `agent_reach_rss_read`: reads public RSS or Atom feeds.
- `agent_reach_youtube_transcript`: extracts YouTube metadata and subtitles through local `yt-dlp`.
- `video_resolve_link`: locally normalizes a public video URL/share text into platform, video id, and canonical URL.
- `video_extract_metadata`: locally extracts bounded metadata and a playable media URL through `yt-dlp`; it does not download or transcribe the video.
- `agent_reach_bilibili_search`: searches Bilibili videos through the public search API.
- `agent_reach_v2ex`: reads V2EX hot topics, node topics, topic replies, and user profiles.

These tools are local, read-only, and do not require MCP.

## Login-Required Platforms

Do not enable cookie or browser-session platforms by default. XiaoHongShu, Reddit, Facebook, Instagram, LinkedIn, and Twitter search must stay opt-in because they depend on user-owned accounts, cookies, or a real Chrome session.

Preferred order for those platforms:

1. Prefer WodeAppX Chrome extension typed tools (`wodeappx_browser_*`) when the page needs login, cookies, or the user's signed-in Chrome session. Do not keep retrying `agent_reach_web_read` against a login wall.
2. Use OpenCLI only after the user explicitly opts into installing and using the OpenCLI Chrome extension. Raw `wodeappx_browser_cdp` stays helper-last and needs explicit CDP approval.
3. Use cookie export only as a last-resort advanced path.

## Upstream Fork

If we maintain a GitHub fork, keep it as `wodeapp/agent-reach` and add upstream:

```bash
git remote add upstream https://github.com/Panniantong/Agent-Reach.git
```

Pulling from upstream should update the routing knowledge and health-check ideas. WodeAppX should still expose a small curated tool surface instead of blindly exposing every upstream command.

## Packaging Notes

Agent Reach upstream is MIT licensed. If code is copied from upstream into WodeAppX, keep the copyright/license notice in the release NOTICE.

The current implementation is independently written TypeScript in:

- `vendor/openwork/apps/server/src/opencode-plugins/openwork-extensions-preview.ts`
- `integrations/browser-control/opencode-plugin/wodeappx-capabilities-bridge.ts`
