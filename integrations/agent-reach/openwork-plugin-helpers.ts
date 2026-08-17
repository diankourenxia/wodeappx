function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = match.slice(1).map((part) => Number(part));
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function assertPublicHttpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) URLs are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    throw new Error("Internal host is not allowed.");
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || isPrivateIpv4(host)) {
    throw new Error("Private or local IP address is not allowed.");
  }
  return url;
}

function stripHtmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function xmlDecode(input: string): string {
  return stripHtmlToText(input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16))));
}

async function fetchTextWithTimeout(url: string, options: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<{ text: string; status: number; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WodeAppX-AgentReach/0.1)",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return { text, status: response.status, contentType: response.headers.get("content-type") || "" };
}

async function probeCommand(command: string, args: string[] = ["--version"], timeoutMs = 10_000): Promise<Record<string, unknown>> {
  try {
    const result = await runProcess(command, args, { timeoutMs });
    return {
      command,
      installed: result.code !== null,
      ok: result.code === 0,
      code: result.code,
      output: `${result.stdout}${result.stderr}`.trim().slice(0, 1200),
    };
  } catch (error) {
    return {
      command,
      installed: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentReachStatus(): Promise<Record<string, unknown>> {
  const [agentReach, ytDlp, opencli, bili, gh, mcporter, ffmpeg] = await Promise.all([
    probeCommand("agent-reach", ["--version"]),
    probeCommand("yt-dlp", ["--version"]),
    probeCommand("opencli", ["--version"]),
    probeCommand("bili", ["--version"]),
    probeCommand("gh", ["--version"]),
    probeCommand("mcporter", ["config", "list"]),
    probeCommand("ffmpeg", ["-version"]),
  ]);
  const opencliDaemon = opencli.ok ? await probeCommand("opencli", ["daemon", "status"]) : null;
  return {
    ok: true,
    mode: "wodeappx-agent-reach-local",
    note: "Read-only public routes are built in. Login-required social platforms should use explicit user-owned Chrome/OpenCLI setup.",
    commands: { agentReach, ytDlp, opencli, opencliDaemon, bili, gh, mcporter, ffmpeg },
    builtInTools: [
      "agent_reach_web_search",
      "agent_reach_weather",
      "agent_reach_web_read",
      "agent_reach_rss_read",
      "agent_reach_youtube_transcript",
      "video_resolve_link",
      "video_extract_metadata",
      "agent_reach_bilibili_search",
      "agent_reach_v2ex",
    ],
  };
}

/** Lean search payloads; re-fetch result pages when full details are needed. */
const WEB_SEARCH_DEFAULT_LIMIT = 5;
const WEB_SEARCH_HARD_MAX = 8;
const WEB_SEARCH_TITLE_MAX = 120;
const WEB_SEARCH_SNIPPET_MAX = 160;
const WEB_READ_DEFAULT_MAX_CHARS = 6_000;
const WEB_READ_SPILL_THRESHOLD = 4_000;
const WEB_READ_SPILL_STORE_MAX = 80_000;
const WEB_READ_PACK_ROOT = join(homedir(), ".wodeappx", "web-read-packs");

function duckDuckGoResultUrl(rawHref: string): string {
  const decoded = xmlDecode(rawHref);
  try {
    const url = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
    const redirected = /(^|\.)duckduckgo\.com$/i.test(url.hostname) ? url.searchParams.get("uddg") : null;
    return redirected || url.toString();
  } catch {
    return decoded;
  }
}

function parseDuckDuckGoResults(html: string, limit: number): Array<Record<string, string>> {
  const resultAnchors = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
  const results: Array<Record<string, string>> = [];
  for (let index = 0; index < resultAnchors.length && results.length < limit; index += 1) {
    const match = resultAnchors[index];
    const attributes = match[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(attributes)?.[1] || "";
    const url = duckDuckGoResultUrl(href);
    if (!/^https?:\/\//i.test(url)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = resultAnchors[index + 1]?.index ?? html.length;
    const resultTail = html.slice(start, end);
    const snippetHtml = /<(?:a|div)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(resultTail)?.[1] || "";
    let domain = "";
    try { domain = new URL(url).hostname; } catch { /* Keep an empty domain. */ }
    const title = truncateText(xmlDecode(match[2]).replace(/\s+/g, " ").trim(), WEB_SEARCH_TITLE_MAX).text;
    const snippet = truncateText(xmlDecode(snippetHtml).replace(/\s+/g, " ").trim(), WEB_SEARCH_SNIPPET_MAX).text;
    results.push({
      title,
      url,
      domain,
      snippet,
    });
  }
  return results;
}

async function agentReachWebSearch(rawArgs: z.infer<typeof agentReachWebSearchArgsSchema>): Promise<Record<string, unknown>> {
  const limit = Math.min(rawArgs.limit ?? WEB_SEARCH_DEFAULT_LIMIT, WEB_SEARCH_HARD_MAX);
  const params = new URLSearchParams({
    q: rawArgs.query,
    kl: rawArgs.region?.trim() || (/[^\u0000-\u00ff]/.test(rawArgs.query) ? "cn-zh" : "wt-wt"),
  });
  const freshness = rawArgs.freshness;
  const freshnessCode = freshness && freshness !== "all"
    ? ({ day: "d", week: "w", month: "m", year: "y" } as const)[freshness]
    : undefined;
  if (freshnessCode) params.set("df", freshnessCode);
  const response = await fetchTextWithTimeout(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    timeoutMs: 25_000,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const results = parseDuckDuckGoResults(response.text, limit);
  return {
    ok: results.length > 0,
    backend: "DuckDuckGo HTML",
    query: rawArgs.query,
    searchedAt: new Date().toISOString(),
    resultCount: results.length,
    results,
    ...(results.length ? {} : { error: "The search provider returned no parseable results. Try a broader query or the built-in browser." }),
  };
}

function weatherCodeLabel(rawCode: unknown): string {
  const code = Number(rawCode);
  if (code === 0) return "晴 / Clear sky";
  if (code === 1) return "大部晴朗 / Mainly clear";
  if (code === 2) return "局部多云 / Partly cloudy";
  if (code === 3) return "阴 / Overcast";
  if ([45, 48].includes(code)) return "雾 / Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨 / Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "雨 / Rain";
  if ([71, 73, 75, 77].includes(code)) return "雪 / Snow";
  if ([80, 81, 82].includes(code)) return "阵雨 / Rain showers";
  if ([85, 86].includes(code)) return "阵雪 / Snow showers";
  if ([95, 96, 99].includes(code)) return "雷暴 / Thunderstorm";
  return `未知天气代码 / Unknown weather code (${Number.isFinite(code) ? code : "n/a"})`;
}

function weatherSeriesValue(series: Record<string, unknown>, key: string, index: number): unknown {
  const values = series[key];
  return Array.isArray(values) ? values[index] : undefined;
}

async function agentReachWeather(rawArgs: z.infer<typeof agentReachWeatherArgsSchema>): Promise<Record<string, unknown>> {
  const language = rawArgs.language?.trim() || "zh";
  const geocodingParams = new URLSearchParams({
    name: rawArgs.location,
    count: "8",
    language,
    format: "json",
  });
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?${geocodingParams.toString()}`;
  const geocoding = asRecord(await getJsonWithTimeout(geocodingUrl));
  const candidates = (Array.isArray(geocoding.results) ? geocoding.results : [])
    .map((item) => asRecord(item))
    .filter((item) => typeof item.latitude === "number" && typeof item.longitude === "number");
  const countryCode = rawArgs.countryCode?.trim().toUpperCase();
  const place = (countryCode ? candidates.find((item) => String(item.country_code || "").toUpperCase() === countryCode) : null) || candidates[0];
  if (!place) {
    return { ok: false, location: rawArgs.location, error: "Location was not found by Open-Meteo geocoding.", source: geocodingUrl };
  }

  const forecastDays = rawArgs.forecastDays ?? 3;
  const forecastParams = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: "auto",
    forecast_days: String(forecastDays),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
  });
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`;
  const forecast = asRecord(await getJsonWithTimeout(forecastUrl));
  const current = asRecord(forecast.current);
  const hourly = asRecord(forecast.hourly);
  const daily = asRecord(forecast.daily);
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
  const currentTime = typeof current.time === "string" ? current.time : "";
  const firstHourlyIndex = Math.max(0, hourlyTimes.findIndex((time) => String(time) >= currentTime));
  const next24Hours = hourlyTimes.slice(firstHourlyIndex, firstHourlyIndex + 24).map((time, offset) => {
    const index = firstHourlyIndex + offset;
    const weatherCode = weatherSeriesValue(hourly, "weather_code", index);
    return {
      time,
      temperature: weatherSeriesValue(hourly, "temperature_2m", index),
      precipitationProbability: weatherSeriesValue(hourly, "precipitation_probability", index),
      condition: weatherCodeLabel(weatherCode),
    };
  });
  const dailyForecast = dailyTimes.map((time, index) => {
    const weatherCode = weatherSeriesValue(daily, "weather_code", index);
    return {
      date: time,
      weatherCode,
      condition: weatherCodeLabel(weatherCode),
      temperatureMax: weatherSeriesValue(daily, "temperature_2m_max", index),
      temperatureMin: weatherSeriesValue(daily, "temperature_2m_min", index),
      apparentTemperatureMax: weatherSeriesValue(daily, "apparent_temperature_max", index),
      apparentTemperatureMin: weatherSeriesValue(daily, "apparent_temperature_min", index),
      precipitationProbabilityMax: weatherSeriesValue(daily, "precipitation_probability_max", index),
      precipitationSum: weatherSeriesValue(daily, "precipitation_sum", index),
      windSpeedMax: weatherSeriesValue(daily, "wind_speed_10m_max", index),
      windGustsMax: weatherSeriesValue(daily, "wind_gusts_10m_max", index),
      sunrise: weatherSeriesValue(daily, "sunrise", index),
      sunset: weatherSeriesValue(daily, "sunset", index),
    };
  });

  return {
    ok: true,
    backend: "Open-Meteo",
    requestedLocation: rawArgs.location,
    resolvedLocation: {
      name: place.name,
      admin1: place.admin1,
      admin2: place.admin2,
      country: place.country,
      countryCode: place.country_code,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || forecast.timezone,
    },
    answerReadySummary: {
      observedAt: current.time,
      condition: weatherCodeLabel(current.weather_code),
      temperatureCelsius: current.temperature_2m,
      apparentTemperatureCelsius: current.apparent_temperature,
      relativeHumidityPercent: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      windSpeedKmh: current.wind_speed_10m,
    },
    current: {
      time: current.time,
      temperatureCelsius: current.temperature_2m,
      apparentTemperatureCelsius: current.apparent_temperature,
      relativeHumidityPercent: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
      condition: weatherCodeLabel(current.weather_code),
      cloudCoverPercent: current.cloud_cover,
      windSpeedKmh: current.wind_speed_10m,
      windDirectionDegrees: current.wind_direction_10m,
      windGustsKmh: current.wind_gusts_10m,
    },
    units: { temperature: "°C", precipitation: "mm", windSpeed: "km/h", probability: "%" },
    dailyForecast,
    next24Hours,
    alternateLocations: candidates.slice(1, 3).map((item) => ({
      name: item.name,
      admin1: item.admin1,
      country: item.country,
      countryCode: item.country_code,
      latitude: item.latitude,
      longitude: item.longitude,
    })),
    source: { provider: "Open-Meteo", forecastUrl, geocodingUrl, retrievedAt: new Date().toISOString() },
  };
}

async function spillWebReadPack(input: {
  url: string;
  text: string;
  backend: string;
}): Promise<{ path: string; chars: number } | null> {
  try {
    await mkdir(WEB_READ_PACK_ROOT, { recursive: true });
    const hash = createHash("sha1")
      .update(`${input.url}\n${input.text.slice(0, 2048)}`)
      .digest("hex")
      .slice(0, 16);
    const filePath = join(WEB_READ_PACK_ROOT, `web_${hash}.txt`);
    const stored = input.text.length > WEB_READ_SPILL_STORE_MAX
      ? `${input.text.slice(0, WEB_READ_SPILL_STORE_MAX)}\n\n[truncated for storage at ${WEB_READ_SPILL_STORE_MAX} chars]`
      : input.text;
    const header = [
      "# WodeAppX web-read pack",
      `# url: ${input.url}`,
      `# backend: ${input.backend}`,
      `# storedAt: ${new Date().toISOString()}`,
      `# chars: ${stored.length}`,
      "",
    ].join("\n");
    await writeFile(filePath, `${header}${stored}`, "utf8");
    return { path: filePath, chars: stored.length };
  } catch {
    return null;
  }
}

async function agentReachWebRead(rawArgs: z.infer<typeof agentReachWebReadArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const maxChars = rawArgs.maxChars ?? WEB_READ_DEFAULT_MAX_CHARS;
  const jinaUrl = `https://r.jina.ai/${url.toString()}`;
  let backend = "Jina Reader";
  let contentType = "";
  let fullText = "";
  let jinaError: string | undefined;
  try {
    const jina = await fetchTextWithTimeout(jinaUrl, {
      timeoutMs: 30_000,
      headers: { Accept: "text/plain" },
    });
    contentType = jina.contentType;
    fullText = jina.text.trim();
  } catch (error) {
    backend = "direct-fetch";
    jinaError = error instanceof Error ? error.message : String(error);
    const direct = await fetchTextWithTimeout(url.toString(), { timeoutMs: 20_000 });
    contentType = direct.contentType;
    fullText = stripHtmlToText(direct.text);
  }

  const inline = truncateText(fullText, maxChars);
  const shouldSpill = inline.truncated || inline.text.length >= WEB_READ_SPILL_THRESHOLD;
  const spill = shouldSpill
    ? await spillWebReadPack({ url: url.toString(), text: fullText, backend })
    : null;
  return {
    ok: true,
    url: url.toString(),
    backend,
    ...(jinaError ? { jinaError } : {}),
    contentType,
    text: inline.text,
    truncated: inline.truncated,
    chars: inline.chars,
    ...(spill
      ? {
          spilled: true,
          spillPath: spill.path,
          spillChars: spill.chars,
          hint: `Inline text is capped at ${maxChars} chars. Re-read spillPath with openwork_file_extract_text when more detail is needed.`,
        }
      : { spilled: false }),
  };
}

function firstXmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return match ? xmlDecode(match[1]) : "";
}

function atomLink(block: string): string {
  const href = /<link[^>]+href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
  if (href) return xmlDecode(href);
  return firstXmlTag(block, "link");
}

function parseFeedXml(xml: string, limit: number): Record<string, unknown> {
  const feedTitle = firstXmlTag(xml, "title");
  const itemMatches = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const entryMatches = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = (itemMatches.length ? itemMatches : entryMatches).slice(0, limit);
  const items = blocks.map((block) => ({
    title: firstXmlTag(block, "title"),
    link: atomLink(block),
    published: firstXmlTag(block, "pubDate") || firstXmlTag(block, "published") || firstXmlTag(block, "updated"),
    author: firstXmlTag(block, "author") || firstXmlTag(block, "dc:creator"),
    summary: truncateText(firstXmlTag(block, "description") || firstXmlTag(block, "summary") || firstXmlTag(block, "content"), 1000).text,
  }));
  return { ok: true, title: feedTitle, itemCount: items.length, items };
}

async function agentReachRssRead(rawArgs: z.infer<typeof agentReachRssReadArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const limit = rawArgs.limit ?? 10;
  const response = await fetchTextWithTimeout(url.toString(), {
    timeoutMs: 20_000,
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  return { url: url.toString(), backend: "direct-feed", contentType: response.contentType, ...parseFeedXml(response.text, limit) };
}

function pickYoutubeCaption(info: Record<string, unknown>, languages: string[]): { language: string; url: string; ext: string } | null {
  const subtitles = asRecord(info.subtitles);
  const automatic = asRecord(info.automatic_captions);
  const stores = [subtitles, automatic];
  for (const language of languages) {
    for (const store of stores) {
      const entries = Array.isArray(store[language]) ? store[language] as Array<Record<string, unknown>> : [];
      const preferred = entries.find((entry) => getStringProperty(entry, "ext") === "json3")
        ?? entries.find((entry) => getStringProperty(entry, "ext") === "srv3")
        ?? entries.find((entry) => getStringProperty(entry, "ext") === "vtt")
        ?? entries.find((entry) => typeof entry.url === "string");
      if (preferred && typeof preferred.url === "string") {
        return { language, url: preferred.url, ext: getStringProperty(preferred, "ext") || "" };
      }
    }
  }
  for (const store of stores) {
    for (const [language, rawEntries] of Object.entries(store)) {
      const entries = Array.isArray(rawEntries) ? rawEntries as Array<Record<string, unknown>> : [];
      const entry = entries.find((item) => typeof item.url === "string");
      if (entry && typeof entry.url === "string") {
        return { language, url: entry.url, ext: getStringProperty(entry, "ext") || "" };
      }
    }
  }
  return null;
}

function parseYoutubeCaptionText(raw: string, ext: string): string {
  if (ext === "json3" || raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
      return (parsed.events || [])
        .flatMap((event) => event.segs || [])
        .map((seg) => seg.utf8 || "")
        .join("")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();
    } catch {
      // Fall through.
    }
  }
  return raw
    .replace(/^WEBVTT[\s\S]*?\n\n/i, "")
    .replace(/^\d+\s*$/gm, "")
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function agentReachYoutubeTranscript(rawArgs: z.infer<typeof agentReachYoutubeTranscriptArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) throw new Error("URL must be a YouTube video URL.");
  const ytDlp = await probeCommand("yt-dlp", ["--version"]);
  if (!ytDlp.ok) {
    return { ok: false, error: "yt-dlp is not installed or not runnable.", installHint: "Install yt-dlp locally, then retry. Agent Reach can also install/check this dependency.", probe: ytDlp };
  }
  const result = await runProcess("yt-dlp", ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", url.toString()], { timeoutMs: 90_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `yt-dlp exited with ${result.code}`);
  const info = JSON.parse(result.stdout) as Record<string, unknown>;
  const languages = rawArgs.languages?.length ? rawArgs.languages : ["zh-Hans", "zh", "en"];
  const caption = pickYoutubeCaption(info, languages);
  const availableLanguages = [...Object.keys(asRecord(info.subtitles)), ...Object.keys(asRecord(info.automatic_captions))].filter((item, index, arr) => arr.indexOf(item) === index);
  if (!caption) {
    return { ok: true, url: url.toString(), backend: "yt-dlp", title: info.title, channel: info.channel || info.uploader, duration: info.duration, transcript: "", transcriptAvailable: false, availableLanguages };
  }
  const captionText = await fetchTextWithTimeout(caption.url, { timeoutMs: 30_000 });
  return {
    ok: true,
    url: url.toString(),
    backend: "yt-dlp",
    title: info.title,
    channel: info.channel || info.uploader,
    duration: info.duration,
    captionLanguage: caption.language,
    captionExt: caption.ext,
    transcriptAvailable: true,
    availableLanguages,
    ...truncateText(parseYoutubeCaptionText(captionText.text, caption.ext), rawArgs.maxChars ?? 30_000),
  };
}

type LocalVideoPlatform = "douyin" | "kuaishou" | "bilibili" | "xiaohongshu" | "xigua" | "weibo" | "tiktok" | "youtube" | "unknown";

function firstPublicVideoUrl(input: string): URL | null {
  const match = input.match(/https?:\/\/[^\s)}\]>]+/i);
  if (!match) return null;
  return assertPublicHttpUrl(match[0].replace(/[)\]}>，。！？、；：]+$/u, ""));
}

function detectLocalVideoPlatform(url: URL): LocalVideoPlatform {
  const host = url.hostname.toLowerCase();
  if (host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com")) return "douyin";
  if (host === "kuaishou.com" || host.endsWith(".kuaishou.com") || host === "gifshow.com" || host.endsWith(".gifshow.com")) return "kuaishou";
  if (host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv" || host.endsWith(".b23.tv")) return "bilibili";
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com") || host === "xhslink.com" || host.endsWith(".xhslink.com") || host === "xhs.cn") return "xiaohongshu";
  if (host === "ixigua.com" || host.endsWith(".ixigua.com") || host === "toutiao.com" || host.endsWith(".toutiao.com")) return "xigua";
  if (host === "weibo.com" || host.endsWith(".weibo.com") || host === "weibo.cn" || host.endsWith(".weibo.cn") || host === "t.cn") return "weibo";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return "unknown";
}

function localVideoId(platform: LocalVideoPlatform, url: URL, input: string): string {
  const path = decodeURIComponent(url.pathname);
  if (platform === "douyin") return url.searchParams.get("modal_id") || /\/(?:share\/)?(?:video|note)\/(\d{15,21})/i.exec(path)?.[1] || /(\d{15,21})/.exec(input)?.[1] || "";
  if (platform === "bilibili") return /(BV[0-9A-Za-z]+|av\d+)/i.exec(path)?.[1] || url.searchParams.get("bvid") || "";
  if (platform === "youtube") return url.searchParams.get("v") || /\/(?:shorts|embed)\/([^/?]+)/i.exec(path)?.[1] || (url.hostname.toLowerCase() === "youtu.be" ? /^\/([^/]+)/.exec(path)?.[1] : "") || "";
  if (platform === "tiktok") return /\/video\/(\d+)/i.exec(path)?.[1] || "";
  if (platform === "kuaishou") return /\/(?:short-video|photo)\/([^/?]+)/i.exec(path)?.[1] || "";
  if (platform === "xiaohongshu") return /\/(?:explore|discovery\/item)\/([^/?]+)/i.exec(path)?.[1] || "";
  if (platform === "xigua") return /\/video\/(\d+)/i.exec(path)?.[1] || "";
  return "";
}

function canonicalLocalVideoUrl(platform: LocalVideoPlatform, videoId: string, resolvedUrl: URL): string {
  if (!videoId) return resolvedUrl.toString();
  if (platform === "douyin") return `https://www.douyin.com/video/${videoId}`;
  if (platform === "bilibili") return `https://www.bilibili.com/video/${videoId}`;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (platform === "tiktok") return resolvedUrl.toString();
  if (platform === "kuaishou") return `https://www.kuaishou.com/short-video/${videoId}`;
  if (platform === "xiaohongshu") return `https://www.xiaohongshu.com/explore/${videoId}`;
  if (platform === "xigua") return `https://www.ixigua.com/${videoId}`;
  return resolvedUrl.toString();
}

async function followLocalVideoRedirects(initialUrl: URL): Promise<URL> {
  let current = initialUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WodeAppX-LocalVideo/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400) return current;
    const location = response.headers.get("location");
    if (!location) return current;
    current = assertPublicHttpUrl(new URL(location, current).toString());
  }
  return current;
}

async function localVideoResolve(rawArgs: z.infer<typeof localVideoResolveArgsSchema>): Promise<Record<string, unknown>> {
  const original = rawArgs.input.trim();
  let url = firstPublicVideoUrl(original);
  if (!url && /^\d{15,21}$/.test(original)) url = new URL(`https://www.douyin.com/video/${original}`);
  if (!url) throw new Error("No public video URL or supported video id was found.");

  let platform = detectLocalVideoPlatform(url);
  let videoId = localVideoId(platform, url, original);
  let redirectFollowed = false;
  if (!videoId && rawArgs.followRedirects !== false) {
    const resolved = await followLocalVideoRedirects(url);
    redirectFollowed = resolved.toString() !== url.toString();
    url = resolved;
    platform = detectLocalVideoPlatform(url);
    videoId = localVideoId(platform, url, original);
  }

  return {
    ok: true,
    executor: "local",
    stage: "resolve_link",
    platform,
    videoId: videoId || null,
    originalInput: original,
    resolvedUrl: url.toString(),
    canonicalUrl: canonicalLocalVideoUrl(platform, videoId, url),
    redirectFollowed,
  };
}

function firstYtdlpMediaUrl(info: Record<string, unknown>): string {
  if (typeof info.url === "string") return info.url;
  const requested = Array.isArray(info.requested_formats) ? info.requested_formats as Array<Record<string, unknown>> : [];
  return requested.find((item) => typeof item.url === "string")?.url as string || "";
}

async function localVideoExtractMetadata(rawArgs: z.infer<typeof localVideoExtractMetadataArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const ytDlp = await probeCommand("yt-dlp", ["--version"]);
  if (!ytDlp.ok) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      executor: "local",
      stage: "extract_metadata",
      code: "DEPENDENCY_MISSING",
      error: "yt-dlp is not installed or not runnable.",
      fallbackTool: "video_parse_link",
      data: { code: "DEPENDENCY_MISSING", fallbackTool: "video_parse_link" },
      probe: ytDlp,
    };
  }
  const result = await runProcess("yt-dlp", ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", "--socket-timeout", "15", url.toString()], { timeoutMs: 90_000 });
  if (result.code !== 0) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      executor: "local",
      stage: "extract_metadata",
      code: "LOCAL_EXTRACTION_FAILED",
      error: result.stderr.trim() || `yt-dlp exited with ${result.code}`,
      fallbackTool: "video_parse_link",
      data: { code: "LOCAL_EXTRACTION_FAILED", fallbackTool: "video_parse_link" },
    };
  }
  const info = JSON.parse(result.stdout) as Record<string, unknown>;
  const description = typeof info.description === "string" ? info.description : "";
  return {
    ok: true,
    executor: "local",
    stage: "extract_metadata",
    backend: "yt-dlp",
    platform: info.extractor_key || info.extractor || detectLocalVideoPlatform(url),
    videoId: info.id || null,
    canonicalUrl: info.webpage_url || url.toString(),
    title: info.title || info.fulltitle || "",
    author: info.uploader || info.channel || info.creator || "",
    duration: info.duration || null,
    coverUrl: info.thumbnail || "",
    videoUrl: firstYtdlpMediaUrl(info),
    description: rawArgs.includeDescription === false ? undefined : description.slice(0, 12_000),
    tags: Array.isArray(info.tags) ? info.tags.slice(0, 100) : [],
    subtitleLanguages: [...new Set([...Object.keys(asRecord(info.subtitles)), ...Object.keys(asRecord(info.automatic_captions))])],
  };
}

async function agentReachBilibiliSearch(rawArgs: z.infer<typeof agentReachBilibiliSearchArgsSchema>): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 10;
  const params = new URLSearchParams({ search_type: "video", keyword: rawArgs.query, page: "1" });
  let apiError = "";
  try {
    const response = await fetchTextWithTimeout(`https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`, {
      timeoutMs: 20_000,
      headers: { Referer: "https://www.bilibili.com/", Accept: "application/json" },
    });
    const parsed = JSON.parse(response.text) as { code?: number; message?: string; data?: { result?: Array<Record<string, unknown>> } };
    if (parsed.code !== 0) throw new Error(`Bilibili API error ${parsed.code}: ${parsed.message || "unknown"}`);
    const results = (parsed.data?.result || []).slice(0, limit).map((item) => ({
      title: stripHtmlToText(String(item.title || "")),
      url: String(item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : "")),
      bvid: item.bvid,
      author: item.author,
      description: stripHtmlToText(String(item.description || "")).slice(0, 500),
      duration: item.duration,
      play: item.play,
      favorites: item.favorites,
      pubdate: item.pubdate,
    }));
    return { ok: true, backend: "Bilibili public search API", query: rawArgs.query, resultCount: results.length, results };
  } catch (error) {
    apiError = error instanceof Error ? error.message : String(error);
  }
  const bili = await probeCommand("bili", ["--version"]);
  if (bili.ok) {
    const result = await runProcess("bili", ["search", rawArgs.query, "--type", "video", "-n", String(limit)], { timeoutMs: 30_000 });
    return { ok: result.code === 0, backend: "bili-cli", query: rawArgs.query, apiError, output: `${result.stdout}${result.stderr}`.trim().slice(0, 20_000), error: result.code === 0 ? undefined : `bili exited with ${result.code}` };
  }
  return { ok: false, backend: "none", query: rawArgs.query, error: apiError, fallbackHint: "Bilibili public API was unavailable from this network. Install bili-cli locally to enable fallback: pipx install bilibili-cli" };
}

async function getJsonWithTimeout(url: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": "WodeAppX-AgentReach/0.1" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function agentReachV2ex(rawArgs: z.infer<typeof agentReachV2exArgsSchema>): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 20;
  if (rawArgs.action === "hot") {
    const data = await getJsonWithTimeout("https://www.v2ex.com/api/topics/hot.json") as Array<Record<string, unknown>>;
    return { ok: true, action: "hot", items: data.slice(0, limit) };
  }
  if (rawArgs.action === "node") {
    if (!rawArgs.nodeName) throw new Error("nodeName is required for action=node.");
    const data = await getJsonWithTimeout(`https://www.v2ex.com/api/topics/show.json?node_name=${encodeURIComponent(rawArgs.nodeName)}&page=1`) as Array<Record<string, unknown>>;
    return { ok: true, action: "node", nodeName: rawArgs.nodeName, items: data.slice(0, limit) };
  }
  if (rawArgs.action === "topic") {
    if (!rawArgs.topicId) throw new Error("topicId is required for action=topic.");
    const topic = await getJsonWithTimeout(`https://www.v2ex.com/api/topics/show.json?id=${rawArgs.topicId}`) as Array<Record<string, unknown>>;
    const replies = await getJsonWithTimeout(`https://www.v2ex.com/api/replies/show.json?topic_id=${rawArgs.topicId}&page=1`) as Array<Record<string, unknown>>;
    return { ok: true, action: "topic", topic: topic[0] || null, replies: replies.slice(0, limit) };
  }
  if (!rawArgs.username) throw new Error("username is required for action=user.");
  const user = await getJsonWithTimeout(`https://www.v2ex.com/api/members/show.json?username=${encodeURIComponent(rawArgs.username)}`) as Record<string, unknown>;
  return { ok: true, action: "user", user };
}
