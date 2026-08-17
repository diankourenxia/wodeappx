/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Plug, RefreshCw, XCircle } from "lucide-react";

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

const BROWSERACT_SERVER = "browseract";
const BROWSERACT_TITLE = "BrowserAct MCP";
const BROWSERACT_DESCRIPTION = "Connect BrowserAct workflows exposed as MCP tools.";
const BROWSERACT_DASHBOARD_URL = "https://www.browseract.com/reception/integrations";
const BROWSERACT_DOCS_URL = "https://docs.browseract.com/";

function configuredServer(ctx: ExtensionConfigContext) {
  return ctx.mcp?.servers.find((server) => server.name === BROWSERACT_SERVER) ?? null;
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function BrowserActMcpConfig({ ctx }: { ctx: ExtensionConfigContext }) {
  const existing = configuredServer(ctx);
  const configuredUrl = typeof existing?.config.url === "string" ? existing.config.url : "";
  const connected = Boolean(existing);
  const connecting = ctx.mcp?.connectingName === BROWSERACT_TITLE;
  const [url, setUrl] = useState(configuredUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!ctx.mcp?.onConnect) return false;
    if (!url.trim()) return false;
    if (!apiKey.trim()) return false;
    return true;
  }, [apiKey, ctx.mcp, url]);

  const connect = async () => {
    if (!ctx.mcp?.onConnect || busy || connecting) return;
    setStatus(null);
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedUrl) {
      setError("Enter the BrowserAct MCP Server URL.");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("MCP URL must start with http:// or https://.");
      return;
    }
    if (!trimmedKey) {
      setError("Enter the BrowserAct MCP API key.");
      return;
    }

    const entry: McpDirectoryInfo = {
      id: BROWSERACT_SERVER,
      name: BROWSERACT_TITLE,
      serverName: BROWSERACT_SERVER,
      description: BROWSERACT_DESCRIPTION,
      type: "remote",
      url: trimmedUrl,
      oauth: false,
      kind: "extension",
      iconSlug: "googlechrome",
      timeout: 300_000,
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
      },
    };

    setBusy(true);
    try {
      await ctx.mcp.onConnect(entry);
      await ctx.mcp.onRefresh();
      setApiKey("");
      setStatus("BrowserAct MCP configured.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to configure BrowserAct MCP.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{BROWSERACT_TITLE}</CardTitle>
        <CardDescription>{BROWSERACT_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              {BROWSERACT_SERVER} is present in MCP config.
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="browseract-mcp-url">MCP Server URL</FieldLabel>
            <Input
              id="browseract-mcp-url"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder="Paste the BrowserAct MCP Server URL"
            />
            <FieldDescription>
              Copy this from BrowserAct Dashboard, under MCP Servers and Connect to Clients.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="browseract-mcp-api-key">BrowserAct MCP API key</FieldLabel>
            <Input
              id="browseract-mcp-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="Paste the BrowserAct MCP API key"
            />
          </Field>
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void ctx.mcp?.onRefresh()}
            disabled={busy || connecting || !ctx.mcp?.onRefresh}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => openExternalUrl(BROWSERACT_DASHBOARD_URL)}
          >
            <ExternalLink className="size-4" />
            Dashboard
          </Button>
          <Button
            variant="outline"
            onClick={() => openExternalUrl(BROWSERACT_DOCS_URL)}
          >
            <ExternalLink className="size-4" />
            Docs
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

registerExtensionConfig("browseract.mcp.settings", (ctx) => (
  <BrowserActMcpConfig ctx={ctx} />
));
