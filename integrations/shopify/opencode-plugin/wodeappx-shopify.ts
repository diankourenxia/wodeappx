import { tool } from "@opencode-ai/plugin";
import {
  DEFAULT_FEISHU_FIELD_MAP,
  mapShopifyProductToFeishuFields,
  mergeFeishuFieldMap,
  type JsonRecord,
} from "./shopify-feishu-sync";

const z = tool.schema;

const DEFAULT_WODEAPP_ORIGIN =
  (process.env.WODEAPP_ORIGIN || "https://wodeapp.cn").replace(/\/+$/, "");

const DEFAULT_RUNTIME_API_BASE =
  process.env.WODEAPPX_RUNTIME_API_BASE ||
  process.env.WODEAPP_RUNTIME_API_BASE ||
  `${DEFAULT_WODEAPP_ORIGIN}/runtime-server/api`;

const DEFAULT_STORE_DOMAIN =
  process.env.WODEAPPX_SHOPIFY_STORE ||
  process.env.SHOPIFY_STORE ||
  "";

const DEFAULT_MAIN_API_BASE =
  process.env.WODEAPPX_MAIN_API_BASE ||
  process.env.WODEAPP_MAIN_API_BASE ||
  `${DEFAULT_WODEAPP_ORIGIN}/mainserver/api`;

type ShopifyRequestArgs = {
  store?: string;
  apiBase?: string;
  timeoutMs?: number;
};

type ShopifyProductUpdate = {
  id: string;
  title?: string;
  vendor?: string;
  productType?: string;
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
};

type ShopifyProductCreate = {
  title: string;
  vendor?: string;
  productType?: string;
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
};

function normalizeStoreDomain(value: string | undefined): string {
  const raw = (value || DEFAULT_STORE_DOMAIN).trim().toLowerCase();
  if (!raw) return "";
  const withoutProtocol = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(withoutProtocol)) return withoutProtocol;
  if (/^[a-z0-9][a-z0-9-]*$/.test(withoutProtocol)) return `${withoutProtocol}.myshopify.com`;
  return "";
}

function runtimeApiBase(value: string | undefined): string {
  return (value || DEFAULT_RUNTIME_API_BASE).replace(/\/+$/, "");
}

function mainApiBase(value: string | undefined): string {
  return (value || DEFAULT_MAIN_API_BASE).replace(/\/+$/, "");
}

function resolveWodeappApiKey(explicit: string | undefined): string {
  return (
    explicit ||
    process.env.WODEAPPX_API_KEY ||
    process.env.WODEAPP_API_KEY ||
    ""
  ).trim();
}

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildAuthCommand(store: string): string {
  return [
    "shopify store auth",
    `--store ${store}`,
    "--scopes read_products,write_products,read_inventory,write_inventory,read_orders,write_orders,read_customers,write_customers,read_discounts,write_discounts",
  ].join(" ");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestShopifyRuntime(
  path: string,
  args: ShopifyRequestArgs,
  init?: RequestInit,
): Promise<JsonRecord> {
  const store = normalizeStoreDomain(args.store);
  if (!store) {
    return {
      ok: false,
      error: "缺少有效的 Shopify 店铺域名，例如 your-store.myshopify.com。",
    };
  }

  const url = new URL(`${runtimeApiBase(args.apiBase)}/shopify-store${path}`);
  url.searchParams.set("store", store);

  const timeoutMs = args.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        "content-type": "application/json",
      },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) {
      return {
        ok: false,
        status: response.status,
        store,
        error: json?.error || `Shopify runtime request failed: ${response.status}`,
        authCommand: buildAuthCommand(store),
      };
    }
    return {
      ok: true,
      store,
      ...json,
    };
  } catch (error) {
    return {
      ok: false,
      store,
      error: error instanceof Error ? error.message : String(error),
      authCommand: buildAuthCommand(store),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestMainserverConnectLink(args: {
  apiBase?: string;
  apiKey?: string;
  shop: string;
  returnTo?: string;
  timeoutMs?: number;
}): Promise<JsonRecord> {
  const apiKey = resolveWodeappApiKey(args.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      shop: args.shop,
      error:
        "缺少 WodeApp API Key。请设置环境变量 WODEAPPX_API_KEY(或 WODEAPP_API_KEY),或在 WodeApp Studio 的 /api-skills 页生成 Key 后传入。",
    };
  }

  const url = `${mainApiBase(args.apiBase)}/shopify/connect/link`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 60_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        shop: args.shop,
        returnTo: args.returnTo,
      }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) {
      return {
        ok: false,
        shop: args.shop,
        status: response.status,
        error: json?.error || `mainserver /shopify/connect/link 失败: ${response.status}`,
      };
    }
    return {
      ok: true,
      shop: args.shop,
      connectUrl: typeof json.connectUrl === "string" ? json.connectUrl : "",
      expiresAt: typeof json.expiresAt === "string" ? json.expiresAt : "",
    };
  } catch (error) {
    return {
      ok: false,
      shop: args.shop,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function compactDashboard(value: JsonRecord, productLimit: number, orderLimit: number) {
  const data = isRecord(value.data) ? value.data : {};
  const products = Array.isArray(data.products) ? data.products.slice(0, productLimit) : [];
  const orders = Array.isArray(data.orders) ? data.orders.slice(0, orderLimit) : [];

  return {
    ...value,
    data: {
      ...data,
      products,
      orders,
    },
  };
}

const requestArgs = {
  store: z.string().optional().describe("Shopify store domain, for example your-store.myshopify.com. Falls back to WODEAPPX_SHOPIFY_STORE."),
  apiBase: z.string().optional().describe("WodeApp runtime API base. Defaults to WODEAPPX_RUNTIME_API_BASE / WODEAPP_RUNTIME_API_BASE, then WODEAPP_ORIGIN."),
  timeoutMs: z.number().optional().describe("Request timeout in milliseconds. Defaults to 90000."),
};

const productStatus = z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]);

const productCreateArgs = {
  ...requestArgs,
  title: z.string().describe("Product title."),
  vendor: z.string().optional().describe("Product vendor."),
  productType: z.string().optional().describe("Product type."),
  status: productStatus.optional().describe("Shopify product status. Defaults to DRAFT in the runtime."),
};

const productUpdateSchema = z.object({
  id: z.string().describe("Product GID or numeric ID."),
  title: z.string().optional().describe("New title."),
  vendor: z.string().optional().describe("New vendor."),
  productType: z.string().optional().describe("New product type."),
  status: productStatus.optional().describe("New Shopify product status."),
});

async function previewCreateProduct(args: ShopifyRequestArgs & ShopifyProductCreate) {
  return requestShopifyRuntime("/products", args, {
    method: "POST",
    body: JSON.stringify({
      title: args.title,
      vendor: args.vendor,
      productType: args.productType,
      status: args.status,
      confirmed: false,
    }),
  });
}

async function applyCreateProduct(args: ShopifyRequestArgs & ShopifyProductCreate & { confirmed?: boolean }) {
  if (args.confirmed !== true) {
    return {
      ok: false,
      error: "confirmed:true is required before creating a Shopify product.",
    };
  }
  return requestShopifyRuntime("/products", args, {
    method: "POST",
    body: JSON.stringify({
      title: args.title,
      vendor: args.vendor,
      productType: args.productType,
      status: args.status,
      confirmed: true,
    }),
  });
}

async function previewProductUpdates(args: ShopifyRequestArgs & { updates: ShopifyProductUpdate[] }) {
  return requestShopifyRuntime("/products/bulk-update", args, {
    method: "POST",
    body: JSON.stringify({ updates: args.updates, confirmed: false }),
  });
}

async function applyProductUpdates(args: ShopifyRequestArgs & { updates: ShopifyProductUpdate[]; confirmed?: boolean }) {
  if (args.confirmed !== true) {
    return {
      ok: false,
      error: "confirmed:true is required before updating Shopify products.",
    };
  }
  return requestShopifyRuntime("/products/bulk-update", args, {
    method: "POST",
    body: JSON.stringify({ updates: args.updates, confirmed: true }),
  });
}

type FeishuSyncArgs = ShopifyRequestArgs & {
  appToken?: string;
  tableId?: string;
  limit?: number;
  shopifyIdField?: string;
  fieldMap?: Record<string, string>;
};

function feishuApiBase(value: string | undefined): string {
  return `${runtimeApiBase(value)}/feishu`;
}

function resolveFeishuTokens(args: FeishuSyncArgs): { appToken: string; tableId: string } {
  return {
    appToken: String(args.appToken || process.env.WODEAPPX_FEISHU_BITABLE_APP_TOKEN || "").trim(),
    tableId: String(args.tableId || process.env.WODEAPPX_FEISHU_BITABLE_TABLE_ID || "").trim(),
  };
}

async function requestFeishuRuntime(
  path: string,
  args: ShopifyRequestArgs,
  init?: RequestInit,
): Promise<JsonRecord> {
  const url = `${feishuApiBase(args.apiBase)}${path}`;
  const timeoutMs = args.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        "content-type": "application/json",
      },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) {
      return {
        ok: false,
        status: response.status,
        error: json?.error || `Feishu runtime request failed: ${response.status}`,
        data: json,
      };
    }
    return { ok: true, ...json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadShopifyProducts(args: FeishuSyncArgs): Promise<JsonRecord> {
  const result = await requestShopifyRuntime("/dashboard", args);
  if (result.ok === false) return result;
  const data = isRecord(result.data) ? result.data : {};
  const products = Array.isArray(data.products) ? data.products.slice(0, args.limit ?? 50) : [];
  return {
    ok: true,
    store: result.store || data.store,
    products,
  };
}

function extractFeishuRecords(payload: JsonRecord): JsonRecord[] {
  const data = isRecord(payload.data) ? payload.data : payload;
  const nested = isRecord(data.data) ? data.data : data;
  if (Array.isArray(nested.items)) return nested.items.filter(isRecord);
  if (Array.isArray(nested.records)) return nested.records.filter(isRecord);
  return [];
}

async function findFeishuRecordIdByShopifyId(
  args: FeishuSyncArgs,
  appToken: string,
  tableId: string,
  shopifyIdField: string,
  shopifyId: string,
): Promise<{ recordId?: string; error?: string }> {
  if (!shopifyId) return {};
  const search = await requestFeishuRuntime(
    `/bitable/${encodeURIComponent(appToken)}/${encodeURIComponent(tableId)}/search`,
    args,
    {
      method: "POST",
      body: JSON.stringify({
        pageSize: 10,
        filter: {
          conjunction: "and",
          conditions: [
            {
              field_name: shopifyIdField,
              operator: "is",
              value: [shopifyId],
            },
          ],
        },
      }),
    },
  );
  if (search.ok === false) {
    return { error: String(search.error || "Feishu search failed") };
  }
  const records = extractFeishuRecords(search);
  const first = records[0];
  const recordId = first ? String(first.record_id || first.recordId || "") : "";
  return recordId ? { recordId } : {};
}

async function syncProductsToFeishu(args: FeishuSyncArgs & { confirmed?: boolean; previewOnly?: boolean }) {
  const { appToken, tableId } = resolveFeishuTokens(args);
  if (!appToken || !tableId) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      error: "缺少飞书多维表 appToken/tableId。可传参或设置 WODEAPPX_FEISHU_BITABLE_APP_TOKEN / WODEAPPX_FEISHU_BITABLE_TABLE_ID。",
      data: { code: "FEISHU_BITABLE_TARGET_MISSING" },
    };
  }

  const loaded = await loadShopifyProducts(args);
  if (loaded.ok === false) return loaded;

  const products = Array.isArray(loaded.products) ? loaded.products.filter(isRecord) : [];
  const fieldMap = mergeFeishuFieldMap(args.fieldMap);
  const shopifyIdField = String(args.shopifyIdField || fieldMap.shopifyId || "Shopify ID").trim();
  const planned = products.map((product) => ({
    shopifyId: String(product.id || product.shortId || ""),
    title: String(product.title || ""),
    handle: String(product.handle || ""),
    fields: mapShopifyProductToFeishuFields(product, fieldMap),
  }));

  if (args.previewOnly || args.confirmed !== true) {
    return {
      ok: true,
      executor: "local",
      stage: "shopify_feishu_sync_preview",
      store: loaded.store,
      appToken,
      tableId,
      shopifyIdField,
      fieldMap,
      count: planned.length,
      sample: planned.slice(0, 5),
      note: args.confirmed === true
        ? undefined
        : "Preview only. Call sync_apply with confirmed:true after explicit user confirmation.",
      nextActions: ["wodeappx_shopify_feishu_sync_apply"],
    };
  }

  const created: string[] = [];
  const updated: string[] = [];
  const failed: Array<{ shopifyId: string; title: string; error: string }> = [];
  let searchUnsupported = false;

  for (const item of planned) {
    try {
      let recordId = "";
      if (!searchUnsupported && item.shopifyId) {
        const found = await findFeishuRecordIdByShopifyId(args, appToken, tableId, shopifyIdField, item.shopifyId);
        if (found.error) {
          searchUnsupported = true;
        } else if (found.recordId) {
          recordId = found.recordId;
        }
      }

      if (recordId) {
        const update = await requestFeishuRuntime(
          `/bitable/${encodeURIComponent(appToken)}/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
          args,
          {
            method: "PUT",
            body: JSON.stringify({ fields: item.fields }),
          },
        );
        if (update.ok === false) {
          failed.push({ shopifyId: item.shopifyId, title: item.title, error: String(update.error || "update failed") });
          continue;
        }
        updated.push(item.shopifyId || item.handle || item.title);
        continue;
      }

      const create = await requestFeishuRuntime(
        `/bitable/${encodeURIComponent(appToken)}/${encodeURIComponent(tableId)}/records`,
        args,
        {
          method: "POST",
          body: JSON.stringify({ fields: item.fields }),
        },
      );
      if (create.ok === false) {
        failed.push({ shopifyId: item.shopifyId, title: item.title, error: String(create.error || "create failed") });
        continue;
      }
      created.push(item.shopifyId || item.handle || item.title);
    } catch (error) {
      failed.push({
        shopifyId: item.shopifyId,
        title: item.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "success" : created.length + updated.length > 0 ? "partial_success" : "failed",
    executor: "local",
    stage: "shopify_feishu_sync_apply",
    store: loaded.store,
    appToken,
    tableId,
    shopifyIdField,
    count: planned.length,
    created: created.length,
    updated: updated.length,
    failed: failed.length,
    failedItems: failed.slice(0, 20),
    warnings: searchUnsupported
      ? ["Feishu search by Shopify ID was unavailable; records were created without upsert matching."]
      : [],
    nextActions: failed.length ? ["retry_failed_rows", "check_feishu_field_names"] : [],
  };
}

export default async () => ({
  tool: {
    wodeappx_shopify_auth_hint: tool({
      description: "Return the local Shopify CLI store authorization command for the requested store. This does not open a browser or run the command.",
      args: requestArgs,
      async execute(args: ShopifyRequestArgs) {
        const store = normalizeStoreDomain(args.store);
        if (!store) {
          return asJsonText({ ok: false, error: "缺少有效的 Shopify 店铺域名。" });
        }
        return asJsonText({
          ok: true,
          store,
          command: buildAuthCommand(store),
          note: "Run this once on the machine that hosts WodeAppX runtime-server when local Shopify CLI access expires.",
        });
      },
    }),
    wodeappx_shopify_connect_store: tool({
      description:
        "从 WodeAppX 端发起一个新的 Shopify Admin OAuth 授权:调用 mainserver /shopify/connect/link 拿到一次性票据 URL,然后用真实 Chrome(用户已登录 Shopify 时直接放行)或内置浏览器打开。商户在浏览器里完成 Shopify 授权后,会自动跳到「Shopify 店铺已连接」静态页(无需 WodeApp 登录 cookie),再调 Shopify Admin MCP 的 shopify_connections_list 确认 OAuth 连接成功。",
      args: {
        store: z
          .string()
          .describe("Shopify 店铺域名,例如 your-store.myshopify.com。"),
        apiBase: z
          .string()
          .optional()
          .describe("WodeApp mainserver base URL。默认读 WODEAPPX_MAIN_API_BASE / WODEAPP_MAIN_API_BASE，再由 WODEAPP_ORIGIN 派生。"),
        apiKey: z
          .string()
          .optional()
          .describe("WodeApp API Key。默认读 WODEAPPX_API_KEY / WODEAPP_API_KEY。可在 WodeApp Studio 的 /api-skills 页生成。"),
        browser: z
          .string()
          .optional()
          .describe(
            "推荐 real-chrome(调用 openwork_chrome_open_url,用用户真实 Chrome,可能已登录 Shopify 直接放行);builtin(调用 openwork_browser_open_url,内置隔离浏览器,商户需手动登录 Shopify);none(不自动打开,只返回 connectUrl 让你后续手动处理)。",
          ),
        returnTo: z
          .string()
          .optional()
          .describe("授权完成后回跳 URL(可选,默认回 /shopify-store-manager)。"),
        timeoutMs: z
          .number()
          .optional()
          .describe("请求超时毫秒,默认 60000。"),
      },
      async execute(args: {
        store: string;
        apiBase?: string;
        apiKey?: string;
        browser?: string;
        returnTo?: string;
        timeoutMs?: number;
      }) {
        const store = normalizeStoreDomain(args.store);
        if (!store) {
          return asJsonText({
            ok: false,
            error: "缺少有效的 Shopify 店铺域名,例如 your-store.myshopify.com。",
          });
        }

        const result = await requestMainserverConnectLink({
          apiBase: args.apiBase,
          apiKey: args.apiKey,
          shop: store,
          returnTo: args.returnTo,
          timeoutMs: args.timeoutMs,
        });

        if (!result.ok || !result.connectUrl) {
          return asJsonText({
            ...result,
            hint:
              "如果提示 401,请确认 WodeApp API Key 是该 WodeApp 账号的有效 Key(X-API-Key 头传递)。",
          });
        }

        const browser = (args.browser || "real-chrome").toLowerCase();
        const nextAction =
          browser === "real-chrome"
            ? `调用 openwork_chrome_open_url({"url": "${result.connectUrl}"}) 在用户真实 Chrome 里打开授权页(若已登录 Shopify 通常直接放行)。`
            : browser === "builtin"
            ? `调用 openwork_browser_open_url({"url": "${result.connectUrl}"}) 在 WodeAppX 内置隔离浏览器里打开(商户需要在此浏览器里手动登录 Shopify 账号)。`
            : null;

        return asJsonText({
          ...result,
          browser,
          nextAction,
          hint:
            "请在打开的浏览器里完成 Shopify OAuth 授权(点 Install)。完成后会自动跳到「Shopify 店铺已连接」静态页(无需 WodeApp 登录 cookie);如未自动跳,说明 URL 已过期或被替换。授权完成后用 shopify_connections_list 验证 Admin OAuth;不要用 wodeappx_shopify_status 代替,后者只检查 runtime/CLI 店铺桥。",
          followUpTools: ["shopify_connections_list", "wodeappx_shopify_dashboard"],
        });
      },
    }),
    wodeappx_shopify_status: tool({
      description: "Read Shopify store status through the WodeAppX runtime/CLI store bridge. This does not verify the separate mainserver Shopify Admin OAuth connection; use shopify_connections_list for that.",
      args: requestArgs,
      async execute(args: ShopifyRequestArgs) {
        return asJsonText(await requestShopifyRuntime("/status", args));
      },
    }),
    wodeappx_shopify_dashboard: tool({
      description: "Read Shopify store dashboard data: shop info, recent products, recent orders, locations, low-stock summary, and basic analytics.",
      args: {
        ...requestArgs,
        productLimit: z.number().optional().describe("Maximum products to return in the tool result. Defaults to 20."),
        orderLimit: z.number().optional().describe("Maximum orders to return in the tool result. Defaults to 10."),
        lowStockThreshold: z.number().optional().describe("Low-stock threshold passed to the runtime. Defaults to runtime behavior."),
      },
      async execute(args: ShopifyRequestArgs & { productLimit?: number; orderLimit?: number; lowStockThreshold?: number }) {
        const result = await requestShopifyRuntime(
          args.lowStockThreshold === undefined ? "/dashboard" : `/dashboard?lowStockThreshold=${encodeURIComponent(String(args.lowStockThreshold))}`,
          args,
        );
        return asJsonText(compactDashboard(result, args.productLimit ?? 20, args.orderLimit ?? 10));
      },
    }),
    wodeappx_shopify_products: tool({
      description: "List recent Shopify products with IDs, handles, prices, inventory, images, options, and variants.",
      args: {
        ...requestArgs,
        limit: z.number().optional().describe("Maximum products to return. Defaults to 30."),
      },
      async execute(args: ShopifyRequestArgs & { limit?: number }) {
        const result = await requestShopifyRuntime("/dashboard", args);
        const data = isRecord(result.data) ? result.data : {};
        const products = Array.isArray(data.products) ? data.products.slice(0, args.limit ?? 30) : [];
        return asJsonText({
          ...result,
          data: {
            store: data.store,
            products,
          },
        });
      },
    }),
    wodeappx_shopify_orders: tool({
      description: "List recent Shopify orders with totals, statuses, line items, customer display names, and customer journey hints.",
      args: {
        ...requestArgs,
        limit: z.number().optional().describe("Maximum orders to return. Defaults to 20."),
      },
      async execute(args: ShopifyRequestArgs & { limit?: number }) {
        const result = await requestShopifyRuntime("/dashboard", args);
        const data = isRecord(result.data) ? result.data : {};
        const orders = Array.isArray(data.orders) ? data.orders.slice(0, args.limit ?? 20) : [];
        return asJsonText({
          ...result,
          data: {
            store: data.store,
            orders,
          },
        });
      },
    }),
    wodeappx_shopify_product_create_preview: tool({
      description: "Preview creating a Shopify product. Does not mutate the store.",
      args: productCreateArgs,
      async execute(args: ShopifyRequestArgs & ShopifyProductCreate) {
        return asJsonText(await previewCreateProduct(args));
      },
    }),
    wodeappx_shopify_product_create_apply: tool({
      description: "Create a Shopify product after explicit user confirmation. Requires confirmed:true.",
      args: {
        ...productCreateArgs,
        confirmed: z.boolean().describe("Must be true after explicit user confirmation."),
      },
      async execute(args: ShopifyRequestArgs & ShopifyProductCreate & { confirmed?: boolean }) {
        return asJsonText(await applyCreateProduct(args));
      },
    }),
    wodeappx_shopify_product_update_preview: tool({
      description: "Preview batch Shopify product updates. Does not mutate the store.",
      args: {
        ...requestArgs,
        updates: z.array(productUpdateSchema).describe("Product update drafts."),
      },
      async execute(args: ShopifyRequestArgs & { updates: ShopifyProductUpdate[] }) {
        return asJsonText(await previewProductUpdates(args));
      },
    }),
    wodeappx_shopify_product_update_apply: tool({
      description: "Apply batch Shopify product updates after explicit user confirmation. Requires confirmed:true.",
      args: {
        ...requestArgs,
        updates: z.array(productUpdateSchema).describe("Product update drafts."),
        confirmed: z.boolean().describe("Must be true after explicit user confirmation."),
      },
      async execute(args: ShopifyRequestArgs & { updates: ShopifyProductUpdate[]; confirmed?: boolean }) {
        return asJsonText(await applyProductUpdates(args));
      },
    }),
    wodeappx_shopify_feishu_link_status: tool({
      description: "Check Shopify store readability and Feishu bitable target readiness for product sync. Does not write data.",
      args: {
        ...requestArgs,
        appToken: z.string().optional().describe("Feishu bitable app_token. Falls back to WODEAPPX_FEISHU_BITABLE_APP_TOKEN."),
        tableId: z.string().optional().describe("Feishu bitable table_id. Falls back to WODEAPPX_FEISHU_BITABLE_TABLE_ID."),
      },
      async execute(args: FeishuSyncArgs) {
        const storeStatus = await requestShopifyRuntime("/status", args);
        const { appToken, tableId } = resolveFeishuTokens(args);
        const feishuConfigured = Boolean(appToken && tableId);
        let tables: JsonRecord | null = null;
        if (appToken) {
          tables = await requestFeishuRuntime(`/bitable/${encodeURIComponent(appToken)}/tables`, args);
        }
        return asJsonText({
          ok: storeStatus.ok !== false && feishuConfigured && tables?.ok !== false,
          executor: "local",
          stage: "shopify_feishu_link_status",
          shopify: storeStatus,
          feishu: {
            appToken: appToken ? `${appToken.slice(0, 4)}…` : "",
            tableId: tableId || "",
            configured: feishuConfigured,
            tables,
          },
          fieldMap: DEFAULT_FEISHU_FIELD_MAP,
          nextActions: feishuConfigured
            ? ["wodeappx_shopify_feishu_sync_preview"]
            : ["set_feishu_bitable_target"],
        });
      },
    }),
    wodeappx_shopify_feishu_sync_preview: tool({
      description: "Preview syncing Shopify products into a Feishu bitable. Read-only; does not create or update Feishu records.",
      args: {
        ...requestArgs,
        appToken: z.string().optional().describe("Feishu bitable app_token."),
        tableId: z.string().optional().describe("Feishu bitable table_id."),
        limit: z.number().optional().describe("Max Shopify products to preview. Defaults to 50."),
        shopifyIdField: z.string().optional().describe("Feishu column used as upsert key. Defaults to 'Shopify ID'."),
        fieldMap: z.record(z.string(), z.string()).optional().describe("Override default Shopify→Feishu field mapping."),
      },
      async execute(args: FeishuSyncArgs) {
        return asJsonText(await syncProductsToFeishu({ ...args, previewOnly: true }));
      },
    }),
    wodeappx_shopify_feishu_sync_apply: tool({
      description: "Upsert Shopify products into Feishu bitable after explicit user confirmation. Requires confirmed:true. Upserts by Shopify ID when searchable.",
      args: {
        ...requestArgs,
        appToken: z.string().optional().describe("Feishu bitable app_token."),
        tableId: z.string().optional().describe("Feishu bitable table_id."),
        limit: z.number().optional().describe("Max Shopify products to sync. Defaults to 50."),
        shopifyIdField: z.string().optional().describe("Feishu column used as upsert key. Defaults to 'Shopify ID'."),
        fieldMap: z.record(z.string(), z.string()).optional().describe("Override default Shopify→Feishu field mapping."),
        confirmed: z.boolean().describe("Must be true after explicit user confirmation."),
      },
      async execute(args: FeishuSyncArgs & { confirmed?: boolean }) {
        return asJsonText(await syncProductsToFeishu(args));
      },
    }),
  },
});
