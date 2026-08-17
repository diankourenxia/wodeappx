const agentReachWebSearchArgsSchema = z.object({
  query: z.string().min(1).describe("Search query for current public web information."),
  limit: z.number().int().min(1).max(8).optional().describe("Maximum search results. Defaults to 5. Hard max 8 to protect context."),
  freshness: z.enum(["all", "day", "week", "month", "year"]).optional().describe("Optional freshness filter. Defaults to all."),
  region: z.string().optional().describe("DuckDuckGo region code, such as cn-zh or us-en. Inferred from the query when omitted."),
});

const agentReachWeatherArgsSchema = z.object({
  location: z.string().min(1).describe("City or place name, such as 杭州, Shanghai, or Paris."),
  forecastDays: z.number().int().min(1).max(7).optional().describe("Number of forecast days. Defaults to 3."),
  countryCode: z.string().length(2).optional().describe("Optional ISO 3166-1 alpha-2 country code to disambiguate the place, such as CN or US."),
  language: z.string().optional().describe("Geocoding result language. Defaults to zh."),
});

const agentReachWebReadArgsSchema = z.object({
  url: z.string().describe("Public http(s) URL to read through Jina Reader first, then direct fetch fallback."),
  maxChars: z.number().int().min(500).max(24_000).optional().describe("Maximum inline characters to return. Defaults to 6,000; longer pages spill to a local readable pack."),
});

const agentReachRssReadArgsSchema = z.object({
  url: z.string().describe("Public RSS or Atom feed URL."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum feed items to return. Defaults to 10."),
});

const agentReachYoutubeTranscriptArgsSchema = z.object({
  url: z.string().describe("Public YouTube video URL."),
  languages: z.array(z.string()).optional().describe("Preferred transcript language codes in order. Defaults to zh-Hans, zh, en."),
  maxChars: z.number().int().min(500).max(120_000).optional().describe("Maximum transcript characters to return. Defaults to 30,000."),
});

const localVideoResolveArgsSchema = z.object({
  input: z.string().min(1).describe("Video URL, video id, or share text containing a public video URL."),
  followRedirects: z.boolean().optional().describe("Resolve public short-link redirects locally. Defaults to true when an id is not already present."),
});

const localVideoExtractMetadataArgsSchema = z.object({
  url: z.string().min(1).describe("Canonical or public video URL returned by video_resolve_link."),
  includeDescription: z.boolean().optional().describe("Include a bounded description field. Defaults to true."),
});

const agentReachBilibiliSearchArgsSchema = z.object({
  query: z.string().min(1).describe("Bilibili video search keyword."),
  limit: z.number().int().min(1).max(30).optional().describe("Maximum search results to return. Defaults to 10."),
});

const agentReachV2exArgsSchema = z.object({
  action: z.enum(["hot", "node", "topic", "user"]).describe("V2EX read action."),
  nodeName: z.string().optional().describe("Node name when action=node, such as tech, python, jobs."),
  topicId: z.number().int().optional().describe("Topic id when action=topic."),
  username: z.string().optional().describe("Username when action=user."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum topics or replies to return. Defaults to 20."),
});

const AGENT_REACH_INTERNET_INSTRUCTION =
  `## Agent Reach style internet routes
For current public information, use agent_reach_web_search, then agent_reach_web_read when a result page needs verification. For weather and forecasts, call agent_reach_weather directly. Also use agent_reach_rss_read for feeds, agent_reach_youtube_transcript for YouTube subtitles, agent_reach_bilibili_search for Bilibili video discovery, and agent_reach_v2ex for V2EX.
Never claim that real-time public information is unavailable before trying the relevant enabled internet tool. Include source URLs and the observation/search time in the answer.
Use agent_reach_status to see which local upstream commands are installed. These tools are read-only and do not require MCP.
For login-required pages, paywalls, or cookie sessions, prefer the WodeAppX Chrome extension typed tools (wodeappx_browser_*) so the user's real Chrome login state can be reused; do not ask for cookies by default and do not keep retrying agent_reach_web_read. Platforms such as XiaoHongShu, Reddit, Facebook, Instagram, LinkedIn, and Twitter search should use that Chrome extension path or an explicit opt-in OpenCLI setup flow. Raw wodeappx_browser_cdp remains helper-last and needs explicit CDP approval.`;
