const { contextBridge, ipcRenderer } = require("electron");

const BROWSER_IMAGE_DROP_MIME = "application/x-openwork-browser-image";
const DIGITAL_ASSETS_API_PATH = "/runtime-server/api/v1/digital-assets";
const WODEAPP_DIGITAL_ASSET_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function installWodeAppDigitalAssetsApiBridge() {
  try {
    contextBridge.exposeInMainWorld("__WODEAPPX_DIGITAL_ASSETS_API__", {
      request(method, path, body) {
        const nextMethod = String(method || "GET").toUpperCase();
        if (!WODEAPP_DIGITAL_ASSET_METHODS.has(nextMethod)) {
          return Promise.resolve({
            ok: false,
            status: 405,
            body: { success: false, error: `Unsupported digital-assets method: ${nextMethod}` },
          });
        }
        return ipcRenderer.invoke("wodeapp:assets", "digitalAssetsRequest", {
          method: nextMethod,
          path: String(path || DIGITAL_ASSETS_API_PATH),
          body,
        });
      },
    });
  } catch {
    // The bridge may already be installed after a reload.
  }
}

function installWodeAppDigitalAssetsFetchBridge() {
  const source = `(() => {
    if (window.__wodeappxDigitalAssetsFetchInstalled) return;
    window.__wodeappxDigitalAssetsFetchInstalled = true;

    const apiPath = ${JSON.stringify(DIGITAL_ASSETS_API_PATH)};
    const nativeFetch = window.fetch.bind(window);

    function parseDigitalAssetsUrl(input) {
      try {
        const rawUrl = typeof input === "string" || input instanceof URL
          ? String(input)
          : input && typeof input.url === "string"
            ? input.url
            : "";
        const url = new URL(rawUrl || location.href, location.href);
        if (!url.pathname.startsWith(apiPath)) return null;
        const rest = url.pathname.slice(apiPath.length).replace(/^\\/+/, "");
        return {
          url,
          path: url.pathname + url.search,
          assetId: rest ? decodeURIComponent(rest.split("/")[0]) : "",
        };
      } catch {
        return null;
      }
    }

    function jsonResponse(body, status) {
      return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    async function readJsonBody(input, init) {
      const body = init && Object.prototype.hasOwnProperty.call(init, "body")
        ? init.body
        : input instanceof Request
          ? await input.clone().text().catch(() => "")
          : undefined;
      if (!body) return undefined;
      if (typeof body === "string") {
        try {
          return JSON.parse(body);
        } catch {
          return undefined;
        }
      }
      if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
        return body;
      }
      return undefined;
    }

    function responseAssets(value) {
      if (!value || typeof value !== "object") return [];
      const data = value.data && typeof value.data === "object" ? value.data : value;
      for (const key of ["assets", "items", "records", "list"]) {
        if (Array.isArray(data[key])) return data[key];
      }
      return [];
    }

    function mergeDigitalAssetBodies(remoteBody, localBody) {
      const remoteAssets = responseAssets(remoteBody);
      const localAssets = responseAssets(localBody);
      if (!localAssets.length) return remoteBody;
      const seen = new Set();
      const assets = [];
      for (const asset of [...localAssets, ...remoteAssets]) {
        const id = asset && typeof asset === "object" ? String(asset.id || "") : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        assets.push(asset);
      }
      const base = remoteBody && typeof remoteBody === "object" ? remoteBody : { success: true };
      const data = base.data && typeof base.data === "object" && !Array.isArray(base.data) ? base.data : {};
      return { ...base, success: true, data: { ...data, assets } };
    }

    window.fetch = async function(input, init) {
      const match = parseDigitalAssetsUrl(input);
      if (!match || !window.__WODEAPPX_DIGITAL_ASSETS_API__) {
        return nativeFetch(input, init);
      }

      const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();

      if (method === "GET" && !match.assetId) {
        const localPromise = window.__WODEAPPX_DIGITAL_ASSETS_API__.request("GET", match.path);
        try {
          const remote = await nativeFetch(input, init);
          if (remote.ok) {
            const remoteBody = await remote.clone().json().catch(() => null);
            const local = await localPromise.catch(() => null);
            if (local && local.ok && local.body) {
              return jsonResponse(mergeDigitalAssetBodies(remoteBody, local.body), remote.status);
            }
          }
          return remote;
        } catch {
          const local = await localPromise.catch(() => null);
          if (local && local.body) return jsonResponse(local.body, local.status || 200);
          throw new TypeError("Failed to fetch digital assets");
        }
      }

      if (match.assetId && match.assetId.startsWith("local-")) {
        const body = await readJsonBody(input, init);
        const local = await window.__WODEAPPX_DIGITAL_ASSETS_API__.request(method, match.path, body);
        return jsonResponse(local && local.body ? local.body : { success: false, error: "Digital asset request failed" }, local && local.status || 500);
      }

      try {
        const remote = await nativeFetch(input, init);
        if (remote.ok || method === "GET") return remote;
      } catch {
        // Fall through to the desktop local adapter.
      }

      const body = await readJsonBody(input, init);
      const local = await window.__WODEAPPX_DIGITAL_ASSETS_API__.request(method, match.path, body);
      return jsonResponse(local && local.body ? local.body : { success: false, error: "Digital asset request failed" }, local && local.status || 500);
    };
  })();`;

  const inject = () => {
    try {
      const script = document.createElement("script");
      script.textContent = source;
      (document.documentElement || document.head || document.body)?.appendChild(script);
      script.remove();
    } catch {
      // Best effort; the real runtime endpoint still works without the desktop adapter.
    }
  };

  if (document.documentElement || document.head || document.body) {
    inject();
  } else {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  }
}

function installProductVisualTaskUrlGuard() {
  const source = `(() => {
    if (window.__openworkPvTaskUrlGuardInstalled) return;
    window.__openworkPvTaskUrlGuardInstalled = true;

    function isPvTaskUrl(value) {
      try {
        const url = new URL(String(value || location.href), location.href);
        const docId = url.searchParams.get("shareDoc") || "";
        return url.pathname === "/product-visual" && /^pvi_/i.test(docId);
      } catch {
        return false;
      }
    }

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function(state, title, nextUrl) {
      if (isPvTaskUrl(location.href)) {
        try {
          const next = new URL(String(nextUrl || location.href), location.href);
          if (!next.searchParams.has("shareDoc")) return undefined;
        } catch {
          // Fall through to native behavior.
        }
      }
      return originalReplaceState(state, title, nextUrl);
    };
  })();`;

  const inject = () => {
    try {
      const script = document.createElement("script");
      script.textContent = source;
      (document.documentElement || document.head || document.body)?.appendChild(script);
      script.remove();
    } catch {
      // Best effort: remote runtime-apps also carry the source-side fix once deployed.
    }
  };

  if (document.documentElement || document.head || document.body) {
    inject();
  } else {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  }
}

function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw;
  try {
    const resolved = new URL(raw, document.baseURI || window.location.href);
    if (resolved.protocol === "http:" || resolved.protocol === "https:" || resolved.protocol === "file:") {
      return resolved.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function imageUrlFromStyle(element) {
  if (!(element instanceof HTMLElement)) return "";
  const inline = element.style?.backgroundImage || "";
  const computed = inline || window.getComputedStyle(element).backgroundImage || "";
  const match = computed.match(/url\((['"]?)(.*?)\1\)/i);
  return normalizeImageUrl(match?.[2] || "");
}

function imageUrlFromElement(element) {
  if (!(element instanceof Element)) return "";
  if (element instanceof HTMLImageElement) {
    return normalizeImageUrl(element.currentSrc || element.src);
  }

  const datasetUrl = element instanceof HTMLElement
    ? element.dataset?.wodeappImageUrl ||
      element.dataset?.imageUrl ||
      element.dataset?.assetUrl ||
      element.dataset?.src ||
      element.dataset?.url ||
      ""
    : "";
  const fromDataset = normalizeImageUrl(datasetUrl);
  if (fromDataset) return fromDataset;

  if (element instanceof SVGImageElement) {
    return normalizeImageUrl(element.href?.baseVal || "");
  }

  return imageUrlFromStyle(element);
}

function imageLabelFromElement(element) {
  if (!(element instanceof Element)) return "";
  return (
    element.getAttribute("alt") ||
    element.getAttribute("title") ||
    element.getAttribute("aria-label") ||
    element.closest("[aria-label]")?.getAttribute("aria-label") ||
    document.title ||
    "browser image"
  ).trim();
}

function isInteractiveTarget(element) {
  if (!(element instanceof Element)) return false;
  return Boolean(
    element.closest("button,a,input,textarea,select,summary,[role='button'],[contenteditable='true']")
  );
}

function findImageCandidate(target, { ignoreInteractive = false } = {}) {
  if (!(target instanceof Element)) return null;
  if (ignoreInteractive && isInteractiveTarget(target) && !(target instanceof HTMLImageElement)) {
    return null;
  }

  let current = target;
  for (let depth = 0; current && depth < 7; depth += 1) {
    const url = imageUrlFromElement(current);
    if (url) {
      return {
        url,
        label: imageLabelFromElement(current),
        pageUrl: window.location.href,
      };
    }

    const nested = current.querySelector?.("img");
    if (nested instanceof HTMLImageElement) {
      const nestedUrl = imageUrlFromElement(nested);
      if (nestedUrl) {
        return {
          url: nestedUrl,
          label: imageLabelFromElement(nested),
          pageUrl: window.location.href,
        };
      }
    }

    current = current.parentElement;
  }

  return null;
}

function installBrowserImageComposerBridge() {
  window.addEventListener("contextmenu", (event) => {
    const candidate = findImageCandidate(event.target);
    if (!candidate) return;
    event.preventDefault();
    ipcRenderer.send("openwork:browser:image-context-menu", {
      ...candidate,
      point: { x: event.clientX, y: event.clientY },
    });
  }, { capture: true });

  window.addEventListener("dragstart", (event) => {
    const candidate = findImageCandidate(event.target, { ignoreInteractive: true });
    if (!candidate || !event.dataTransfer) return;
    const payload = JSON.stringify(candidate);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(BROWSER_IMAGE_DROP_MIME, payload);
    event.dataTransfer.setData("text/uri-list", candidate.url);
    event.dataTransfer.setData("text/plain", candidate.url);
  }, { capture: true });
}

function dismissMenuOverlay() {
  ipcRenderer.send("openwork:menu-overlay:dismiss");
}

function installDismissListeners() {
  window.addEventListener("pointerdown", dismissMenuOverlay, { capture: true });
  window.addEventListener("wheel", dismissMenuOverlay, { capture: true, passive: true });
  window.addEventListener("keydown", dismissMenuOverlay, { capture: true });
}

installWodeAppDigitalAssetsApiBridge();
installWodeAppDigitalAssetsFetchBridge();

if (document.readyState === "loading") {
  installProductVisualTaskUrlGuard();
  document.addEventListener("DOMContentLoaded", installBrowserImageComposerBridge, { once: true });
  document.addEventListener("DOMContentLoaded", installDismissListeners, { once: true });
} else {
  installProductVisualTaskUrlGuard();
  installBrowserImageComposerBridge();
  installDismissListeners();
}

