/** @jsxImportSource react */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, LogIn, RefreshCw, XCircle } from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const FEISHU_EXTENSION_ID = "feishu-agent-mcp";
const FEISHU_SERVER = "lark-mcp";
const FEISHU_TITLE = "Feishu";
const FEISHU_DESCRIPTION = "Authorize Feishu, then let agents use official OpenAPI MCP tools.";
const FEISHU_CREATE_APP_DOC_URL = "https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview";
const FEISHU_MCP_DOC_URL = "https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_installation";
const FEISHU_MCP_NPM_URL = "https://www.npmjs.com/package/@larksuiteoapi/lark-mcp";
const FEISHU_CN_DOMAIN = "https://open.feishu.cn";
const LARK_GLOBAL_DOMAIN = "https://open.larksuite.com";
const FEISHU_COMMERCE_TOOL_PRESET = "preset.default,preset.base.batch,preset.task.default,preset.calendar.default";

const DOMAIN_OPTIONS = [
  { value: FEISHU_CN_DOMAIN, label: "Feishu China" },
  { value: LARK_GLOBAL_DOMAIN, label: "Lark Global" },
];

const TOOL_PRESET_OPTIONS = [
  { value: FEISHU_COMMERCE_TOOL_PRESET, label: "电商运营：消息、文档、表格批量、任务与日历" },
  { value: "preset.default", label: "Default tools" },
  { value: "preset.light", label: "Light tools" },
  { value: "preset.im.default", label: "Messages" },
  { value: "preset.base.default", label: "Bitable" },
  { value: "preset.base.batch", label: "Bitable batch" },
  { value: "preset.doc.default", label: "Docs" },
  { value: "preset.task.default", label: "Tasks" },
  { value: "preset.calendar.default", label: "Calendar" },
];

const LANGUAGE_OPTIONS = [
  { value: "zh", label: "Chinese" },
  { value: "en", label: "English" },
];

type FeishuAuthStatus = {
  configured: boolean;
  authorized: boolean;
  integration: "lark-cli" | "lark-mcp" | "missing";
  missing: string[];
  credentialSource: "input" | "env" | "lark-cli" | "missing";
  profile: string;
  userName: string;
};

type FeishuLoginResult = {
  authorized: boolean;
  integration: "lark-cli" | "lark-mcp" | "missing";
  configPath: string;
  credentialSource: "input" | "env" | "lark-cli" | "missing";
  userName: string;
};

function configuredServer(ctx: ExtensionConfigContext) {
  return ctx.mcp?.servers.find((server) => server.name === FEISHU_EXTENSION_ID || server.name === FEISHU_SERVER) ?? null;
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function envString(environment: Record<string, string> | undefined, key: string) {
  const value = environment?.[key];
  return typeof value === "string" ? value : "";
}

function commandArg(command: string[] | undefined, flag: string) {
  const index = command?.indexOf(flag) ?? -1;
  if (index < 0) return "";
  const value = command?.[index + 1];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFeishuAuthStatus(value: unknown): FeishuAuthStatus | null {
  if (!isRecord(value)) return null;
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((item): item is string => typeof item === "string")
    : [];
  const source = value.credentialSource === "input" || value.credentialSource === "env" || value.credentialSource === "lark-cli" || value.credentialSource === "missing"
    ? value.credentialSource
    : "missing";
  return {
    configured: value.configured === true,
    authorized: value.authorized === true,
    integration: value.integration === "lark-cli" || value.integration === "lark-mcp"
      ? value.integration
      : "missing",
    missing,
    credentialSource: source,
    profile: typeof value.profile === "string" ? value.profile.trim() : "",
    userName: typeof value.userName === "string" ? value.userName.trim() : "",
  };
}

function normalizeFeishuLoginResult(value: unknown): FeishuLoginResult {
  if (!isRecord(value)) {
    return {
      authorized: false,
      integration: "missing",
      configPath: "",
      credentialSource: "missing",
      userName: "",
    };
  }
  const source = value.credentialSource === "input" || value.credentialSource === "env" || value.credentialSource === "lark-cli" || value.credentialSource === "missing"
    ? value.credentialSource
    : "missing";
  return {
    authorized: value.authorized === true,
    integration: value.integration === "lark-cli" || value.integration === "lark-mcp"
      ? value.integration
      : "missing",
    configPath: typeof value.configPath === "string" ? value.configPath : "",
    credentialSource: source,
    userName: typeof value.userName === "string" ? value.userName.trim() : "",
  };
}

function SelectControl(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      id={props.id}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-1 text-sm text-foreground shadow-xs/5 outline-none transition-[border-color,box-shadow,background-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </select>
  );
}

function FeishuMcpConfig({ ctx }: { ctx: ExtensionConfigContext }) {
  const existing = configuredServer(ctx);
  const existingEnvironment = existing?.config.environment;
  const existingCommand = existing?.config.command;
  const existingAppId = envString(existingEnvironment, "APP_ID");
  const existingAppSecret = envString(existingEnvironment, "APP_SECRET");
  const connected = Boolean(existing);
  const connecting = ctx.mcp?.connectingName === FEISHU_TITLE || ctx.mcp?.connectingName === "Feishu Agent MCP";
  const [appId, setAppId] = useState(existingAppId);
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState(envString(existingEnvironment, "LARK_DOMAIN") || commandArg(existingCommand, "-d") || FEISHU_CN_DOMAIN);
  const [tools, setTools] = useState(envString(existingEnvironment, "LARK_TOOLS") || commandArg(existingCommand, "-t") || FEISHU_COMMERCE_TOOL_PRESET);
  const [language, setLanguage] = useState(commandArg(existingCommand, "-l") || "zh");
  const [callbackPort, setCallbackPort] = useState(commandArg(existingCommand, "-p") || "3000");
  const [authStatus, setAuthStatus] = useState<FeishuAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveAppId = appId.trim() || existingAppId;
  const effectiveAppSecret = appSecret.trim() || existingAppSecret;
  const localCredentialsReady = Boolean(effectiveAppId.trim() && effectiveAppSecret.trim());
  const managedCredentialsReady = authStatus?.configured === true;
  const cliConnected = authStatus?.authorized === true && authStatus.integration === "lark-cli";

  useEffect(() => {
    if (!ctx.openworkServerClient) return;
    let cancelled = false;
    void ctx.openworkServerClient.callExtensionAction({
      extensionId: FEISHU_EXTENSION_ID,
      action: "status",
      args: {},
    }).then((result) => {
      if (!cancelled) setAuthStatus(normalizeFeishuAuthStatus(result.result));
    }).catch(() => {
      if (!cancelled) setAuthStatus(null);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.openworkServerClient]);

  const callbackPortNumber = useMemo(() => {
    const parsed = Number(callbackPort.trim() || "3000");
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
  }, [callbackPort]);

  const canAuthorize = useMemo(() => {
    if (cliConnected) return false;
    if (!ctx.openworkServerClient) return false;
    if (!ctx.mcp?.onConnect) return false;
    if (!localCredentialsReady && !managedCredentialsReady) return false;
    if (!domain.trim()) return false;
    if (!tools.trim()) return false;
    if (!callbackPortNumber) return false;
    return true;
  }, [callbackPortNumber, cliConnected, ctx.mcp, ctx.openworkServerClient, domain, localCredentialsReady, managedCredentialsReady, tools]);

  const authorize = async () => {
    if (!ctx.openworkServerClient || !ctx.mcp?.onConnect || busy || connecting) return;
    setStatus(null);
    setError(null);

    const trimmedAppId = effectiveAppId.trim();
    const trimmedSecret = effectiveAppSecret.trim();
    const trimmedDomain = domain.trim();
    const trimmedTools = tools.trim();
    const port = callbackPortNumber;

    if (!trimmedAppId && !managedCredentialsReady) {
      setError("Enter the Feishu or Lark App ID.");
      return;
    }
    if (!trimmedSecret && !managedCredentialsReady) {
      setError("Enter the Feishu or Lark App Secret.");
      return;
    }
    if (!/^https:\/\//i.test(trimmedDomain)) {
      setError("Open platform domain must start with https://.");
      return;
    }
    if (!trimmedTools) {
      setError("Choose a tool preset.");
      return;
    }
    if (!port) {
      setError("Callback port must be between 1 and 65535.");
      return;
    }

    setBusy(true);
    try {
      const loginResponse = await ctx.openworkServerClient.callExtensionAction({
        extensionId: FEISHU_EXTENSION_ID,
        action: "login",
        args: {
          ...(trimmedAppId ? { appId: trimmedAppId } : {}),
          ...(trimmedSecret ? { appSecret: trimmedSecret } : {}),
          domain: trimmedDomain,
          tools: trimmedTools,
          language,
          callbackPort: port,
        },
      });
      const login = normalizeFeishuLoginResult(loginResponse.result);
      if (login.authorized && login.integration === "lark-cli") {
        setStatus(login.userName
          ? `Feishu CLI is connected as ${login.userName}.`
          : "Feishu CLI is connected.");
        return;
      }
      if (!login.authorized || !login.configPath) {
        throw new Error("Feishu authorized, but lark-mcp config was not created.");
      }
      const command = [
        "npx",
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "--config",
        login.configPath,
      ];

      const entry: McpDirectoryInfo = {
        id: FEISHU_EXTENSION_ID,
        name: FEISHU_TITLE,
        serverName: FEISHU_SERVER,
        description: FEISHU_DESCRIPTION,
        type: "local",
        command,
        oauth: false,
        kind: "extension",
        iconSrc: "/wodeapp-mark.png",
        timeout: 300_000,
      };

      await ctx.mcp.onConnect(entry);
      await ctx.mcp.onRefresh();
      setAppSecret("");
      setStatus(login.credentialSource === "env"
        ? "Feishu authorization completed with built-in credentials. WodeAppX connected lark-mcp in user-token mode."
        : "Feishu authorization completed. WodeAppX connected lark-mcp in user-token mode.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authorize Feishu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{FEISHU_TITLE}</CardTitle>
        <CardDescription>{FEISHU_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cliConnected ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Feishu CLI is connected</AlertTitle>
            <AlertDescription>
              {authStatus?.userName
                ? `Authorized as ${authStatus.userName}${authStatus.profile ? ` using profile ${authStatus.profile}` : ""}.`
                : "The official Feishu CLI user authorization is ready."}
            </AlertDescription>
          </Alert>
        ) : connected ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Feishu MCP is configured</AlertTitle>
            <AlertDescription>
              {FEISHU_SERVER} is present. Re-authorize when the Feishu account, permissions, or app credentials change.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning">
            <LogIn />
            <AlertTitle>Authorize Feishu in your browser</AlertTitle>
            <AlertDescription>
              {managedCredentialsReady
                ? "Click authorize. WodeAppX will open Feishu authorization and connect the MCP for agent conversations."
                : "Add Feishu app credentials once, then WodeAppX will open Feishu authorization and connect the MCP for agent conversations."}
            </AlertDescription>
          </Alert>
        )}

        {!cliConnected ? <FieldGroup className="gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="feishu-app-id">App ID</FieldLabel>
              <Input
                id="feishu-app-id"
                value={appId}
                onChange={(event) => setAppId(event.currentTarget.value)}
                placeholder={managedCredentialsReady ? "Using built-in credentials" : "cli_..."}
              />
              <FieldDescription>
                {managedCredentialsReady
                  ? "Leave blank to use the built-in Feishu app credentials."
                  : "The Feishu app must allow the redirect URL shown below."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="feishu-app-secret">App Secret</FieldLabel>
              <Input
                id="feishu-app-secret"
                type="password"
                value={appSecret}
                onChange={(event) => setAppSecret(event.currentTarget.value)}
                placeholder={managedCredentialsReady ? "Using built-in credentials" : connected ? "Leave blank to keep current secret" : "Paste the App Secret"}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="feishu-domain">Open platform</FieldLabel>
              <SelectControl id="feishu-domain" value={domain} onChange={setDomain}>
                {DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field>
              <FieldLabel htmlFor="feishu-tools">Tool preset</FieldLabel>
              <SelectControl id="feishu-tools" value={tools} onChange={setTools}>
                {TOOL_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field>
              <FieldLabel htmlFor="feishu-language">Tool language</FieldLabel>
              <SelectControl id="feishu-language" value={language} onChange={setLanguage}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectControl>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="feishu-callback-port">OAuth callback</FieldLabel>
            <Input
              id="feishu-callback-port"
              value={callbackPort}
              onChange={(event) => setCallbackPort(event.currentTarget.value)}
              inputMode="numeric"
              placeholder="3000"
            />
            <FieldDescription>
              Add http://localhost:{callbackPortNumber ?? 3000}/callback to the Feishu app OAuth redirect URLs.
            </FieldDescription>
          </Field>
        </FieldGroup> : null}

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
          onClick={() => void authorize()}
          disabled={!canAuthorize || busy || connecting}
        >
          {busy || connecting ? <Loader2 className="size-4 animate-spin" /> : cliConnected ? <CheckCircle2 className="size-4" /> : <LogIn className="size-4" />}
          {cliConnected ? "Feishu CLI connected" : connected ? "Re-authorize Feishu" : "Authorize with Feishu"}
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
            onClick={() => openExternalUrl(FEISHU_CREATE_APP_DOC_URL)}
          >
            <ExternalLink className="size-4" />
            App guide
          </Button>
          <Button
            variant="outline"
            onClick={() => openExternalUrl(FEISHU_MCP_DOC_URL)}
          >
            <ExternalLink className="size-4" />
            MCP docs
          </Button>
          <Button
            variant="outline"
            onClick={() => openExternalUrl(FEISHU_MCP_NPM_URL)}
          >
            <ExternalLink className="size-4" />
            Package
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

registerExtensionConfig("feishu.agentMcp.settings", (ctx) => (
  <FeishuMcpConfig ctx={ctx} />
));
