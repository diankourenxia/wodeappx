# WodeAppX Shopify Connector

WodeAppX Shopify Connector is the Shopify app wrapper for connecting a merchant store to the WodeAppX product library runtime.

The first milestone is custom distribution for the owner's store. Public App Store distribution can come later after OAuth, token storage, webhooks, billing, and review requirements are stable.

## Storefront AI Chat (MVP)

Embedded Shopify storefront assistant that answers from merchant FAQ/product notes and bills replies through a WodeApp API key.

### Merchant setup

1. Open the public embedded app → **Storefront AI Chat**
   - URL: `/mainserver/api/shopify/storefront-chat/admin`
2. Paste a WodeApp API key (`sk_live_...`), fill FAQ knowledge, set handoff email, enable chat.
3. Copy the public widget token.
4. Deploy/push the theme app extension, then in the store theme editor enable **App embeds → WodeApp AI Chat** and paste the token.

### APIs

- `GET /mainserver/api/shopify/storefront-chat/admin` — merchant settings UI (Shopify session)
- `GET|PUT /mainserver/api/shopify/storefront-chat/settings` — save FAQ / API key / enable flag
- `POST /mainserver/api/shopify/storefront-chat/settings/rotate-token`
- `GET /mainserver/api/shopify/storefront-chat/widget-config?shop=&token=` — public widget bootstrap
- `POST /mainserver/api/shopify/storefront-chat/message` — public ask/answer

### Theme extension

- Path: `app/extensions/ai-storefront-chat`
- Do not hand-author a placeholder `uid`; the authenticated Shopify CLI link/deploy flow writes the app-scoped UID to `shopify.extension.toml`.
- After changing extension files: `shopify app deploy --path wodeappx/integrations/shopify/app` (or `shopify app dev` for preview)

### Notes

- Storefront traffic is rate-limited per shop + IP.
- Uninstall / shop redact deletes chat settings.
- The assistant must not invent prices/policies; uncertain answers request human handoff.
- Do not use Sendbird for this flow; the widget talks directly to WodeApp.

## Current Status

- Local runtime read path works through Shopify CLI:
  - `runtime-server` route: `/runtime-server/api/shopify-store/dashboard`
  - Store tested: `<your-store>.myshopify.com`
  - Product library import exercised successfully.
- Shopify Dev Dashboard app is linked locally:
  - Partner organization is configured in the Dashboard.
  - App name: `wodeappx`
  - Config file: `app/shopify.app.toml`

## Shopify App Shape

Current local app config requests the full authenticated Admin scope set that Shopify CLI accepts for owner testing.

Before external merchant distribution, reduce scopes to the minimum needed by the enabled WodeAppX features. Shopify can restrict scopes that do not have a legitimate app use case.

Write scopes should remain behind explicit confirmation UI in WodeAppX. Product, inventory, order, customer, theme, payment, and discount updates should never run as silent background actions.

Runtime endpoints in WodeApp:

- `POST /mainserver/api/shopify/connect/link`（WodeApp session / API Key 鉴权，签发短期连接 URL）
- `GET /mainserver/api/shopify/connect/start?shop=<store>.myshopify.com`
- `GET /mainserver/api/shopify/connect/callback`
- `GET /mainserver/api/shopify/connect/installed?shop=<store>.myshopify.com&ticket=<one-time-ticket>`（OAuth 完成页，不依赖登录 Cookie）
- `GET /mainserver/api/shopify/connections`
- `GET /mainserver/api/shopify/status`
- `POST /mainserver/api/shopify/graphql`
- `POST /mainserver/api/shopify/mcp`
- `POST /mainserver/api/shopify/webhooks/products`
- `POST /mainserver/api/shopify/webhooks/inventory`
- `POST /mainserver/api/shopify/webhooks/app-uninstalled`

Token storage requirements:

- Store access tokens server-side only.
- Encrypt tokens at rest.
- Associate each connection with WodeApp user ID and normalized `myshopifyDomain`.
- Do not expose Admin API tokens to WodeAppX desktop or runtime pages.

Required environment:

- `SHOPIFY_APP_CLIENT_ID`: App Client ID from the Shopify Dev Dashboard. Local fallback is the current linked `wodeappx` Client ID.
- `SHOPIFY_APP_CLIENT_SECRET`: App secret from the Shopify Dev Dashboard. Required for OAuth callback and token exchange.
- `SHOPIFY_APP_REDIRECT_URI`: Optional override. Default is `<PUBLIC_ORIGIN>/mainserver/api/shopify/connect/callback`.
- `SHOPIFY_APP_SCOPES`: Optional override for OAuth requested scopes. Keep it aligned with `app/shopify.app.toml`.
- `SHOPIFY_TOKEN_ENCRYPTION_KEY`: Optional dedicated key for encrypting Admin access tokens. If omitted, WodeApp falls back to app/JWT secrets.
- `SHOPIFY_API_VERSION`: Optional override. Default is `2026-07`.

Connect flow:

1. Log in to WodeApp.
2. Open `/mainserver/api/shopify/connect/start?shop=your-store.myshopify.com`.
3. Approve the app in Shopify.
4. WodeApp stores the encrypted offline Admin token and redirects back to `/shopify-store-manager`.

The OAuth callback is intentionally server-side. WodeAppX desktop and the browser runtime only see connection metadata, never the Admin API token.

When WodeAppX starts the flow with an API Key, it first calls `POST /connect/link`. After OAuth, the callback creates a short-lived, single-use install ticket and redirects to `/connect/installed`, so the browser can show a completion page without a WodeApp login Cookie. The ticket is deleted on successful use or expiry.

For frontend-controlled navigation, call:

```text
GET /mainserver/api/shopify/connect/start?shop=<store>.myshopify.com&format=json&returnTo=http://localhost:5176/shopify-store-manager
```

Then redirect the browser to the returned `authorizeUrl`.

Webhook handling:

- Product and inventory webhooks are verified and stored as runtime records for later sync jobs.
- `app/uninstalled` is verified and removes stored connections for that shop.

## Permission Lanes

There is no separate permanent "CLI app permission" that replaces Shopify app scopes.

Use three lanes:

- Shopify CLI developer login: lets the local developer account link, validate, and deploy app config. It does not define merchant store data access by itself.
- Shopify CLI store bridge: `shopify store auth --store <shop> --scopes <scopes>` grants this machine a local store-scoped token for development and owner testing. Current runtime-server Shopify reads use this lane through `shopify store execute`.
- Shopify app OAuth: `app/shopify.app.toml` defines the scopes a merchant grants when installing the app. This is the production path for WodeAppX built-in Shopify management.

Codex-style connector pattern to copy:

- A store switch/connect action owns the authorization step.
- Tool handlers declare narrow capabilities such as `get_shop_info`, `list_orders`, `create_discount`, `product_sync`, and `product_update`.
- Runtime calls tools through server-side tokens, not by exposing Admin API tokens to the page or desktop client.
- Mutating tools require explicit merchant confirmation and should keep an audit trail.

## WodeAppX OpenCode Plugin

For Shopify, prefer official MCP where it fits:

- Shopify Dev MCP: `npx -y @shopify/dev-mcp@latest`. Use it for docs, API guidance, schema introspection, and code generation. This is now enabled in `vendor/openwork/.opencode/opencode.json`.
- Shopify Storefront MCP: `https://<shop>.myshopify.com/api/mcp`. Use it for customer-facing catalog search, product lookup, cart, and store policy questions. It is per store, so WodeAppX should add it dynamically when a store is connected.
- Shopify Customer Account MCP: use it when customer-authenticated order/account flows are needed. It requires OAuth customer account setup.

These official MCP surfaces do not replace Admin OAuth for backend store management. Product uploads, product edits, inventory writes, discounts, themes, and protected order/customer data still need a merchant-authorized Admin path.

WodeAppX Admin MCP (one instance of the generic live-tool system):

- Endpoint: `POST /mainserver/api/shopify/mcp`
- Auth: WodeApp session, `Authorization: Bearer <token>`, or `X-API-Key: sk_live_...`
- Desktop mount: WodeApp account/provider sync writes a remote MCP entry named `wodeapp-shopify-admin` alongside `wodeapp-platform`. OpenCode keeps the live `tools/list` response as the schema truth source.
- Tools:
  - `shopify_connections_list`
  - `shopify_shop_info`
  - `shopify_products_list`
  - `shopify_orders_list`
  - `shopify_graphql`

`shopify_graphql` refuses mutations unless the caller passes `confirmed: true`.
The Shopify capability route enables both unprefixed and `wodeapp-shopify-admin_...` policy keys only for Shopify intents. Read queries may run directly; mutations must be described or previewed first and can set `confirmed:true` only after explicit merchant confirmation.

The connector is registered through the shared WodeApp-managed MCP registry,
and its tools are also discoverable through `wodeappx_search_tools`. Other
installed plugins and connected MCP servers use the same live OpenCode registry;
they do not require Shopify-specific routing code. See
`integrations/openwork/TOOL_DISCOVERY.md`.

Example MCP config:

- `config/opencode.shopify-mcp.example.jsonc`

Source plugin:

- `opencode-plugin/wodeappx-shopify.ts`

Installed location after applying WodeAppX integration:

- `vendor/openwork/.opencode/plugins/wodeappx-shopify.ts`

Enabled in:

- `vendor/openwork/.opencode/opencode.json`

Tools exposed to the Agent:

- `wodeappx_shopify_auth_hint`: returns the local `shopify store auth` command for a store.
- `wodeappx_shopify_status`: verifies only the runtime/Shopify CLI store bridge.
- `shopify_connections_list`: verifies the separate mainserver Shopify Admin OAuth connection used by `shopify_graphql`.
- `wodeappx_shopify_dashboard`: reads store, products, orders, locations, and low-stock summary.
- `wodeappx_shopify_products`: lists recent products with variants and inventory.
- `wodeappx_shopify_orders`: lists recent orders and customer journey hints.
- `wodeappx_shopify_product_create_preview`: prepares a product creation draft without mutating the store.
- `wodeappx_shopify_product_create_apply`: creates a product only when `confirmed:true`.
- `wodeappx_shopify_product_update_preview`: prepares product updates without mutating the store.
- `wodeappx_shopify_product_update_apply`: applies product updates only when `confirmed:true`.
- `wodeappx_shopify_feishu_link_status`: checks Shopify readability + Feishu bitable target readiness.
- `wodeappx_shopify_feishu_sync_preview`: previews Shopify products mapped into Feishu bitable fields (read-only).
- `wodeappx_shopify_feishu_sync_apply`: upserts products into Feishu bitable only when `confirmed:true`.

### Shopify → Feishu quick link

One-time setup outside WodeAppX:

1. Install/connect the existing WodeAppX Shopify app (or local CLI store auth).
2. Create a Feishu enterprise app with bitable read/write, publish it, and configure `FEISHU_APP_ID` / `FEISHU_APP_SECRET` on runtime-server.
3. Create a Feishu bitable with columns matching the default map (or pass `fieldMap`):

| Feishu column | Shopify source |
|---|---|
| Shopify ID | product id (upsert key) |
| Handle | handle |
| 标题 | title |
| 状态 | status |
| Vendor | vendor |
| 类型 | productType |
| 价格 | min variant price |
| 库存 | totalInventory |
| 主图 | imageUrl |
| Tags | tags |
| 链接 | onlineStoreUrl |
| 更新时间 | updatedAt |

Optional env defaults:

- `WODEAPPX_SHOPIFY_STORE=your-store.myshopify.com`
- `WODEAPP_ORIGIN=https://wodeapp.cn`
- `WODEAPPX_RUNTIME_API_BASE=<origin>/runtime-server/api`（本地 runtime 时显式覆盖）
- `WODEAPPX_MAIN_API_BASE=<origin>/mainserver/api`
- `WODEAPPX_FEISHU_BITABLE_APP_TOKEN=...`
- `WODEAPPX_FEISHU_BITABLE_TABLE_ID=...`

Agent flow:

1. `wodeappx_shopify_feishu_link_status`
2. `wodeappx_shopify_feishu_sync_preview`
3. User confirms
4. `wodeappx_shopify_feishu_sync_apply` with `confirmed:true`

The plugin intentionally calls the local WodeApp runtime Shopify bridge and Feishu bitable routes instead of storing Shopify/Feishu tokens in OpenCode plugin files.

## Create Or Link The Shopify App

If no app exists yet, create one through Shopify CLI:

```bash
shopify app init --name wodeappx-shopify-connector --path wodeappx/integrations/shopify/app --template none --package-manager pnpm
```

If an app already exists in the Shopify Dev Dashboard, link it instead:

```bash
SHOPIFY_ORGANIZATION_ID=<organization-id> wodeappx/integrations/shopify/scripts/create-or-link-shopify-app.sh
```

To avoid interactive prompts entirely, copy the Client ID from Shopify Dev Dashboard and pass it directly:

```bash
SHOPIFY_CLIENT_ID=<client-id> wodeappx/integrations/shopify/scripts/create-or-link-shopify-app.sh
```

The numeric organization ID in the Dev Dashboard URL is not the same as the Client ID. The current linked Client ID is stored in `app/shopify.app.toml`.

If the account has multiple Partner organizations, keep separate configs or link commands for each organization. For the current `wodeappx` app, the Dashboard URL used during setup was under organization ID `150137963`.

After editing the app config, validate it:

```bash
shopify app config validate --json --path wodeappx/integrations/shopify/app
```

Deploy the app configuration only after the WodeApp OAuth endpoints are implemented and reachable:
OAuth endpoints now exist in `server/src/routes/shopify.ts`. Deploy only after `SHOPIFY_APP_CLIENT_SECRET` and the production callback URL are configured on the server.

```bash
shopify app deploy --path wodeappx/integrations/shopify/app
```

## Distribution

Start with custom distribution:

- Good for connecting this store first.
- Does not require public App Store review.
- Lets us validate product sync and write-back workflows before broader release.

Move to public distribution only when the connector is ready for multiple merchants. Shopify distribution method cannot be changed after selection, so use a separate production app when needed.

References:

- https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files
- https://shopify.dev/docs/apps/launch/distribution
- https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
