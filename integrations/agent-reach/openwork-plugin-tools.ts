    agent_reach_status: {
      description: "Check WodeAppX local internet capability status: installed upstream commands, OpenCLI readiness, and built-in read-only Agent Reach style tools.",
      args: {},
      async execute() {
        return asJsonText(await agentReachStatus());
      },
    },
    agent_reach_web_search: {
      description: "Search the public web for current information and return titles, snippets, and source URLs. Use this for news, recent facts, prices, schedules, public figures, and any query that may have changed.",
      args: agentReachWebSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWebSearchArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWebSearch(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_weather: {
      description: "Get current weather, a daily forecast, and the next 24 hourly observations for a city or place. Uses Open-Meteo and requires no API key.",
      args: agentReachWeatherArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWeatherArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWeather(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_web_read: {
      description: "Read a public web page as text. Uses Jina Reader first and direct fetch fallback. Use this for known URLs before general browser automation.",
      args: agentReachWebReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWebReadArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWebRead(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_rss_read: {
      description: "Read a public RSS or Atom feed and return recent items. This is read-only and does not require a browser or MCP server.",
      args: agentReachRssReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachRssReadArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachRssRead(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_youtube_transcript: {
      description: "Extract YouTube video metadata and transcript through local yt-dlp. Requires yt-dlp installed on the user's machine.",
      args: agentReachYoutubeTranscriptArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachYoutubeTranscriptArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachYoutubeTranscript(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    video_resolve_link: {
      description: "Resolve a public video URL locally into platform, video id, resolved URL, and canonical URL. This performs no media extraction and should be the first step for online video links.",
      args: localVideoResolveArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = localVideoResolveArgsSchema.parse(rawArgs);
          return asJsonText(await localVideoResolve(args));
        } catch (error) {
          return asJsonText({ ok: false, executor: "local", stage: "resolve_link", error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    video_extract_metadata: {
      description: "Extract video metadata and a playable media URL locally with yt-dlp. Call video_resolve_link first. This does not download, transcribe, analyze, or modify the video.",
      args: localVideoExtractMetadataArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = localVideoExtractMetadataArgsSchema.parse(rawArgs);
          return asJsonText(await localVideoExtractMetadata(args));
        } catch (error) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "execution",
            executor: "local",
            stage: "extract_metadata",
            error: error instanceof Error ? error.message : String(error),
            fallbackTool: "video_parse_link",
            data: { code: "LOCAL_EXTRACTION_FAILED", fallbackTool: "video_parse_link" },
          });
        }
      },
    },
    agent_reach_bilibili_search: {
      description: "Search Bilibili videos through the public search API. Use this for discovery; use real Chrome/OpenCLI only when login-required content is needed.",
      args: agentReachBilibiliSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachBilibiliSearchArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachBilibiliSearch(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_v2ex: {
      description: "Read V2EX public data: hot topics, node topics, topic replies, or user profile.",
      args: agentReachV2exArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachV2exArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachV2ex(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
