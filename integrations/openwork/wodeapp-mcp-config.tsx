/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plug, RefreshCw, XCircle } from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

type WodeAppMcpKind = "platform" | "project";

const WODEAPP_PLATFORM_SERVER = "wodeapp-platform";
const WODEAPP_PROJECT_SERVER = "wodeapp-project";
const WODEAPP_MCP_REQUEST_TIMEOUT_MS = 420_000;
const WODEAPP_PLATFORM_URL = "http://localhost:3000/mainserver/mcp";
const WODEAPP_PROJECT_URL = "http://localhost:4100/mcp";
const WODEAPP_PLATFORM_URL_CANDIDATES = [
  import.meta.env.VITE_WODEAPP_PLATFORM_MCP_URL,
  WODEAPP_PLATFORM_URL,
  "http://localhost:3100/mainserver/mcp",
].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

function serverNameForKind(kind: WodeAppMcpKind) {
  return kind === "platform" ? WODEAPP_PLATFORM_SERVER : WODEAPP_PROJECT_SERVER;
}

function defaultUrlForKind(kind: WodeAppMcpKind) {
  return kind === "platform" ? WODEAPP_PLATFORM_URL : WODEAPP_PROJECT_URL;
}

function toolsUrlForMcpUrl(value: string) {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/$/, "");
    parsed.pathname = `${pathname}/tools`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function resolveReachableMcpUrl(candidates: string[]) {
  for (const candidate of candidates) {
    const toolsUrl = toolsUrlForMcpUrl(candidate);
    if (!toolsUrl) continue;
    try {
      const response = await fetch(toolsUrl, { cache: "no-store" });
      if (response.ok) return candidate;
    } catch {
      // Keep trying local fallbacks.
    }
  }
  return null;
}

function titleForKind(kind: WodeAppMcpKind) {
  return kind === "platform" ? "WodeApp Platform MCP" : "WodeApp Project MCP";
}

function descriptionForKind(kind: WodeAppMcpKind) {
  return kind === "platform"
    ? "Create Agent Apps and manage projects, pages, publishing, and explicit packaging."
    : "Project runtime tools for data, workflows, AI, media, and integrations.";
}

function configuredServer(ctx: ExtensionConfigContext, kind: WodeAppMcpKind) {
  const serverName = serverNameForKind(kind);
  return ctx.mcp?.servers.find((server) => server.name === serverName) ?? null;
}

function WodeAppMcpConfig(props: {
  kind: WodeAppMcpKind;
  ctx: ExtensionConfigContext;
}) {
  const { kind, ctx } = props;
  const serverName = serverNameForKind(kind);
  const existing = configuredServer(ctx, kind);
  const configuredUrl = typeof existing?.config.url === "string" ? existing.config.url : "";
  const connected = Boolean(existing);
  const connecting = ctx.mcp?.connectingName === titleForKind(kind);
  const [apiKey, setApiKey] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [url, setUrl] = useState(configuredUrl || defaultUrlForKind(kind));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isProject = kind === "project";
  const defaultUrl = defaultUrlForKind(kind);

  useEffect(() => {
    if (kind !== "platform" || configuredUrl || url !== defaultUrl) return;
    let cancelled = false;
    void resolveReachableMcpUrl(WODEAPP_PLATFORM_URL_CANDIDATES).then((resolved) => {
      if (!cancelled && resolved) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [configuredUrl, defaultUrl, kind, url]);

  const canSubmit = useMemo(() => {
    if (!ctx.mcp?.onConnect) return false;
    if (!url.trim()) return false;
    if (!apiKey.trim()) return false;
    if (isProject && !projectSlug.trim()) return false;
    return true;
  }, [apiKey, ctx.mcp, isProject, projectSlug, url]);

  const connect = async () => {
    if (!ctx.mcp?.onConnect || busy || connecting) return;
    setStatus(null);
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedKey = apiKey.trim();
    const trimmedSlug = projectSlug.trim();
    if (!trimmedUrl) {
      setError("Enter the MCP URL.");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("MCP URL must start with http:// or https://.");
      return;
    }
    if (!trimmedKey) {
      setError("Enter a WodeApp API key.");
      return;
    }
    if (isProject && !trimmedSlug) {
      setError("Enter the WodeApp project slug.");
      return;
    }

    const entry: McpDirectoryInfo = {
      id: serverName,
      name: titleForKind(kind),
      serverName,
      description: descriptionForKind(kind),
      type: "remote",
      url: trimmedUrl,
      oauth: false,
      kind: "extension",
      iconSrc: "/wodeapp-mark.png",
      timeout: WODEAPP_MCP_REQUEST_TIMEOUT_MS,
      headers: {
        "X-API-Key": trimmedKey,
        ...(isProject ? { "x-subdomain-project": trimmedSlug } : {}),
      },
    };

    setBusy(true);
    try {
      await ctx.mcp.onConnect(entry);
      await ctx.mcp.onRefresh();
      setApiKey("");
      setStatus(`${titleForKind(kind)} configured.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to configure WodeApp MCP.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{titleForKind(kind)}</CardTitle>
        <CardDescription>{descriptionForKind(kind)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              {serverName} is present in MCP config.
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={`wodeapp-${kind}-url`}>MCP URL</FieldLabel>
            <Input
              id={`wodeapp-${kind}-url`}
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder={defaultUrlForKind(kind)}
            />
            <FieldDescription>
              Use your self-hosted or WodeApp Cloud MCP endpoint.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`wodeapp-${kind}-api-key`}>WodeApp API key</FieldLabel>
            <Input
              id={`wodeapp-${kind}-api-key`}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="sk_live_..."
            />
          </Field>

          {isProject ? (
            <Field>
              <FieldLabel htmlFor="wodeapp-project-slug">Project slug</FieldLabel>
              <Input
                id="wodeapp-project-slug"
                value={projectSlug}
                onChange={(event) => setProjectSlug(event.currentTarget.value)}
                placeholder="your-project-slug"
              />
            </Field>
          ) : null}
        </FieldGroup>

        {status ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2 border-t border-border">
        <Button
          onClick={() => void connect()}
          disabled={!canSubmit || busy || connecting}
        >
          {busy || connecting ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          {connected ? "Update MCP" : "Connect MCP"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void ctx.mcp?.onRefresh()}
          disabled={busy || connecting || !ctx.mcp?.onRefresh}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </CardFooter>
    </Card>
  );
}

registerExtensionConfig("wodeapp.platformMcp.settings", (ctx) => (
  <WodeAppMcpConfig kind="platform" ctx={ctx} />
));

registerExtensionConfig("wodeapp.projectMcp.settings", (ctx) => (
  <WodeAppMcpConfig kind="project" ctx={ctx} />
));
