#!/usr/bin/env node
/**
 * M2 blackbox: desktop
 * attach BIFF8 .xls + 11 JPG → send product-import prompt → require extract then product_save.
 *
 * Safe attachment-only smoke (default; never sends):
 *   node scripts/wodeappx-local-xls-product-import-blackbox.mjs --port 9823 --dry-run
 *
 * Explicit live-write usage:
 *   WODEAPPX_ALLOW_LIVE_PRODUCT_WRITE=1 node --import ./scripts/vendor-xlsx-register.mjs \
 *     scripts/wodeappx-local-xls-product-import-blackbox.mjs --port 9823
 *
 * Or run via:
 *   cd vendor/openwork/apps/server && bun ../../../../scripts/wodeappx-local-xls-product-import-blackbox.mjs ...
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XLSX = require(path.join(repoRoot, "vendor/openwork/apps/server/node_modules/xlsx"));
const { createCanvas } = require(
  path.join(repoRoot, "vendor/openwork/apps/server/node_modules/@napi-rs/canvas"),
);

const PROMPT = "这是一次 E2E 测试，请将保存的商品名称加上【E2E测试】前缀。解析并且总结商品信息，存到商品库，我后续要用来生成视频详情图等";
const SHEETS = [
  ["精油短袜", "SOCK-ANKLE-731"],
  ["精油商务中筒袜", "SOCK-BUSINESS-842"],
  ["精油中筒袜", "SOCK-MID-953"],
];

function parseArgs(argv) {
  const options = {
    port: 9823,
    timeoutMs: 420_000,
    allowWrite: process.env.WODEAPPX_ALLOW_LIVE_PRODUCT_WRITE === "1",
    observeSessionId: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--allow-write") options.allowWrite = true;
    else if (arg === "--dry-run") options.allowWrite = false;
    else if (arg === "--observe-session") options.observeSessionId = String(argv[++i] || "").trim();
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSession(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page =
    targets.find((target) => target.type === "page" && /WodeAppX|我的AppX|WodeAppX|OpenWork/.test(target.title || "")) ??
    targets.find((target) => target.type === "page");
  if (!page) throw new Error(`No page target on port ${port}`);
  if (!version.webSocketDebuggerUrl) throw new Error("Missing browser webSocketDebuggerUrl");

  let nextId = 0;
  const pending = new Map();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (!payload.id || !pending.has(payload.id)) return;
    const entry = pending.get(payload.id);
    pending.delete(payload.id);
    clearTimeout(entry.timer);
    if (payload.error) entry.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
    else entry.resolve(payload.result);
  });

  function request(method, params = {}, timeoutMs = 20_000, sessionId) {
    const id = ++nextId;
    const body = { id, method, params };
    if (sessionId) body.sessionId = sessionId;
    ws.send(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  const attached = await request("Target.attachToTarget", { targetId: page.id, flatten: true });
  const sessionId = attached.sessionId;
  if (!sessionId) throw new Error("Failed to attach to page target");
  await request("Runtime.enable", {}, 20_000, sessionId);
  await request("DOM.enable", {}, 20_000, sessionId);
  await request("Page.enable", {}, 20_000, sessionId);

  async function evaluate(expression, timeoutMs = 20_000) {
    const result = await request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  return {
    ws,
    page,
    sessionId,
    request,
    evaluate,
    close: () => ws.close(),
  };
}

function makeMinimalJpeg(label) {
  const canvas = createCanvas(320, 320);
  const context = canvas.getContext("2d");
  const index = Number(label.replace(/\D/g, "")) || 1;
  context.fillStyle = `hsl(${(index * 31) % 360} 55% 88%)`;
  context.fillRect(0, 0, 320, 320);
  context.fillStyle = "#162033";
  context.font = "bold 42px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 160, 160);
  return canvas.toBuffer("image/jpeg");
}

async function createFixtures(root) {
  const workbook = XLSX.utils.book_new();
  for (const [name, code] of SHEETS) {
    const rows = [
      ["字段", "值"],
      ["产品线", name],
      ["校验码", code],
      ["画幅", "9:16"],
      ["分辨率", "1080p"],
      ["帧率", "60"],
      ["字幕", "是"],
      ["格式", "MP4"],
      ["宣传语", "柔软舒适一整天"],
      ["硬参数", "精油含量 1.2%"],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const xlsPath = path.join(root, "wodeappx-local-xls-product-import.xls");
  writeFileSync(xlsPath, XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
  const imagePaths = [];
  for (let index = 1; index <= 11; index += 1) {
    const label = `IMG-${String(index).padStart(2, "0")}`;
    const imagePath = path.join(root, `${label}.jpg`);
    writeFileSync(imagePath, makeMinimalJpeg(label));
    imagePaths.push(imagePath);
  }
  return { xlsPath, imagePaths, allPaths: [xlsPath, ...imagePaths] };
}

async function waitFor(evaluate, expression, { timeoutMs, label }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createNewSession(session) {
  const before = await session.evaluate("window.__openworkControl?.snapshot?.()?.route || ''");
  await session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll("button, a, [role='button']")];
    const btn = nodes.find((node) => (node.textContent || "").trim() === "新建对话");
    if (!btn) throw new Error("新建对话 button missing");
    btn.click();
    return true;
  })()`);
  return waitFor(
    session.evaluate,
    `(() => {
      const route = window.__openworkControl?.snapshot?.()?.route || "";
      const composer = window.__openwork?.slice("composer");
      return route
        && route !== ${JSON.stringify(before)}
        && /\\/session\\/ses_[A-Za-z0-9]+$/.test(route)
        && composer?.sessionId === route.split("/").at(-1)
        && (composer?.attachments?.length || 0) === 0
        && Boolean(document.querySelector('[contenteditable="true"]'))
        && Boolean(document.querySelector('input[type="file"][multiple]'))
        ? route
        : null;
    })()`,
    { timeoutMs: 30_000, label: "new empty session" },
  );
}

async function attachFixtureFiles(session, fixtures) {
  const attachmentSnapshot = async () => session.evaluate(`(() => {
    const composer = window.__openwork?.slice("composer");
    const attachments = Array.isArray(composer?.attachments) ? composer.attachments : [];
    return {
      count: attachments.length,
      items: attachments.map((attachment) => ({
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        size: attachment.size,
        fileName: attachment.file?.name || "",
        filePath: attachment.file?.path || "",
      })),
    };
  })()`);

  const waitForCommittedAttachments = async (timeoutMs) => {
    try {
      return await waitFor(
        session.evaluate,
        `(() => {
          const composer = window.__openwork?.slice("composer");
          const attachments = Array.isArray(composer?.attachments) ? composer.attachments : [];
          return attachments.length === 12 ? {
            count: attachments.length,
            items: attachments.map((attachment) => ({
              name: attachment.name,
              kind: attachment.kind,
              mimeType: attachment.mimeType,
              size: attachment.size,
              fileName: attachment.file?.name || "",
              filePath: attachment.file?.path || "",
            })),
          } : null;
        })()`,
        { timeoutMs, label: "12 attachments committed" },
      );
    } catch {
      return null;
    }
  };

  // Prefer the native CDP upload path. React intentionally resets input.value
  // after onChange, so input.files === 0 after this call is expected and is not
  // evidence of failure. The composer attachment store is the source of truth.
  const { root } = await session.request("DOM.getDocument", { depth: 0 }, 20_000, session.sessionId);
  const { nodeId } = await session.request("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"][multiple]',
  }, 20_000, session.sessionId);
  if (!nodeId) throw new Error("Composer file input not found");
  await session.request("DOM.setFileInputFiles", {
    nodeId,
    files: fixtures.allPaths,
  }, 30_000, session.sessionId);

  const nativeSnapshot = await waitForCommittedAttachments(20_000);
  if (nativeSnapshot) {
    return {
      mode: "cdp-native-paths",
      ...nativeSnapshot,
    };
  }

  const afterNative = await attachmentSnapshot();
  if (afterNative.count > 0) {
    throw new Error(`Native attachment upload committed only ${afterNative.count} of 12 files`);
  }

  // Fallback for Electron builds that ignore DOM.setFileInputFiles. Build
  // actual decodable File objects in-page and stamp the real local path.
  const files = [
    {
      name: path.basename(fixtures.xlsPath),
      mime: "application/vnd.ms-excel",
      path: fixtures.xlsPath,
      base64: (await readFile(fixtures.xlsPath)).toString("base64"),
    },
    ...await Promise.all(fixtures.imagePaths.map(async (imagePath) => ({
      name: path.basename(imagePath),
      mime: "image/jpeg",
      path: imagePath,
      base64: (await readFile(imagePath)).toString("base64"),
    }))),
  ];

  const attached = await session.evaluate(`(() => {
    const input = document.querySelector('input[type="file"][multiple]');
    if (!(input instanceof HTMLInputElement)) return { ok: false, reason: "file-input-missing" };
    const transfer = new DataTransfer();
    for (const fixture of ${JSON.stringify(files)}) {
      const binary = atob(fixture.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const file = new File([bytes], fixture.name, {
        type: fixture.mime,
        lastModified: Date.now(),
      });
      try {
        Object.defineProperty(file, "path", { value: fixture.path, configurable: true });
      } catch {
        file.path = fixture.path;
      }
      transfer.items.add(file);
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: true,
      count: transfer.files.length,
      names: Array.from(transfer.files, (file) => file.name),
      paths: Array.from(transfer.files, (file) => file.path || null),
    };
  })()`, 60_000);

  if (!attached?.ok) throw new Error(`Could not attach fixtures: ${attached?.reason || "unknown"}`);
  if (attached.count !== files.length) {
    throw new Error(`Expected ${files.length} attached files, got ${attached.count}`);
  }
  const fallbackSnapshot = await waitForCommittedAttachments(30_000);
  if (!fallbackSnapshot) {
    const current = await attachmentSnapshot();
    throw new Error(`In-page attachment fallback committed ${current.count} of 12 files`);
  }
  return {
    mode: "in-page-file-fallback",
    transferCount: attached.count,
    ...fallbackSnapshot,
  };
}

async function clearFixtureAttachments(session) {
  for (let index = 0; index < 12; index += 1) {
    const before = await session.evaluate(
      `(window.__openwork?.slice("composer")?.attachments?.length || 0)`,
    );
    if (!before) return true;
    const clicked = await session.evaluate(`(() => {
      const button = [...document.querySelectorAll('button[title="Remove"], button[aria-label="Remove"]')]
        .find((candidate) => candidate instanceof HTMLButtonElement);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) return false;
    await waitFor(
      session.evaluate,
      `(window.__openwork?.slice("composer")?.attachments?.length || 0) < ${before}`,
      { timeoutMs: 5_000, label: "attachment cleanup" },
    );
  }
  return (await session.evaluate(
    `(window.__openwork?.slice("composer")?.attachments?.length || 0)`,
  )) === 0;
}

async function pasteAndSend(session, text) {
  await session.evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || document.querySelector('[contenteditable="true"]');
    if (!editor) throw new Error("composer missing");
    editor.focus();
    const data = new DataTransfer();
    data.setData("text/plain", ${JSON.stringify(text)});
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    return true;
  })()`);
  await sleep(800);
  const sent = await session.evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const send = buttons.find((button) => /发送|Send/i.test((button.textContent || "").trim())
      || /send/i.test(button.getAttribute("aria-label") || ""));
    if (!send) return { ok: false, reason: "send-button-missing" };
    send.click();
    return { ok: true };
  })()`);
  if (!sent?.ok) throw new Error(`Could not click send: ${sent?.reason || "unknown"}`);
}

function summarizeEvidence(bodyText) {
  const extractCalled = /openwork_file_extract_text/i.test(bodyText);
  const productSaveCalled = /wodeapp_product_save/i.test(bodyText);
  const sheetHits = SHEETS.filter(([, code]) => bodyText.includes(code));
  const verified = /verified['"\s:=]*true/i.test(bodyText);
  const assetId = bodyText.match(/assetId['"\s:=]+([a-zA-Z0-9_-]{8,})/i)?.[1] || "";
  const imageCountMatch = bodyText.match(/productImageCount['"\s:=]+(\d+)/i);
  const productImageCount = imageCountMatch ? Number(imageCountMatch[1]) : null;
  const expectedCount = /expectedImageCount['"\s:=]+11/i.test(bodyText);
  return {
    extractCalled,
    productSaveCalled,
    sheetHitCount: sheetHits.length,
    sheetHits: sheetHits.map(([name, code]) => ({ name, code })),
    verified,
    assetId,
    productImageCount,
    expectedCount,
  };
}

async function readSessionEvidence(session, route) {
  const match = /^\/workspace\/([^/]+)\/session\/([^/]+)$/.exec(route);
  if (!match) {
    return { apiOk: false, error: `Could not parse workspace/session route: ${route}` };
  }
  const [, workspaceId, sessionId] = match;
  return session.evaluate(`(async () => {
    try {
      const routeState = window.__openwork?.slice("route") || {};
      const baseUrl = typeof routeState.baseUrl === "string" ? routeState.baseUrl.replace(/\\/$/, "") : "";
      const token = window.localStorage.getItem("openwork.server.token") || "";
      const hostToken = window.localStorage.getItem("openwork.server.hostToken") || "";
      if (!baseUrl || !token) {
        return { apiOk: false, error: "OpenWork server connection is unavailable in the renderer." };
      }
      const response = await fetch(
        baseUrl
          + "/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}"
          + "/snapshot?limit=200",
        {
          headers: {
            Authorization: "Bearer " + token,
            "X-OpenWork-Host-Token": hostToken,
          },
        },
      );
      if (!response.ok) {
        return { apiOk: false, error: "Session snapshot returned HTTP " + response.status };
      }
      const payload = await response.json();
      const item = payload?.item || {};
      const messages = Array.isArray(item.messages) ? item.messages : [];
      const tools = messages.flatMap((message) =>
        (Array.isArray(message?.parts) ? message.parts : [])
          .filter((part) => part?.type === "tool")
          .map((part) => ({
            tool: part.tool,
            status: part.state?.status || null,
            input: part.state?.input || {},
            output: part.state?.output ?? null,
            error: part.state?.error ?? null,
          })),
      );
      const extractOutputs = tools
        .filter((entry) => entry.tool === "openwork_file_extract_text" && entry.status === "completed")
        .map((entry) => typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output || {}))
        .join("\\n");
      const sheetDefinitions = ${JSON.stringify(SHEETS)};
      const sheetHits = sheetDefinitions
        .filter(([name, code]) => extractOutputs.includes(name) && extractOutputs.includes(code))
        .map(([name, code]) => ({ name, code }));
      const parseOutput = (value) => {
        if (value && typeof value === "object") return value;
        if (typeof value !== "string") return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      };
      const saveResults = tools
        .filter((entry) => entry.tool === "wodeapp_product_save")
        .map((entry) => {
          const parsed = parseOutput(entry.output);
          const result = parsed?.result || parsed || {};
          const outputText = typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output || {});
          const assetIdMatch = outputText.match(/"assetId"\\s*:\\s*"([^"]+)"/);
          const imageCountMatch = outputText.match(/"productImageCount"\\s*:\\s*(\\d+)/);
          const inputImages = Array.isArray(entry.input?.productImages) ? entry.input.productImages : [];
          const sourceImages = Array.isArray(entry.input?.sourceProductImages)
            ? entry.input.sourceProductImages
            : [];
          return {
            name: typeof entry.input?.name === "string" ? entry.input.name : null,
            status: entry.status,
            verified: result.verified === true || /"verified"\\s*:\\s*true/.test(outputText),
            assetId: typeof result.assetId === "string" ? result.assetId : assetIdMatch?.[1] || "",
            productImageCount:
              typeof result.productImageCount === "number"
                ? result.productImageCount
                : imageCountMatch
                  ? Number(imageCountMatch[1])
                  : null,
            inputImageCount: inputImages.length,
            sourceImageCount: sourceImages.length,
            expectedImageCount: entry.input?.expectedImageCount ?? null,
            sourceMatchesProduct: JSON.stringify(inputImages) === JSON.stringify(sourceImages),
            error: entry.error,
          };
        });
      const forbiddenCalls = tools
        .filter((entry) =>
          entry.tool === "openwork_attachment_context_read"
          || String(entry.tool || "").startsWith("openwork_pdf_"))
        .map((entry) => entry.tool);
      const allSavesVerified =
        saveResults.length > 0
        && saveResults.every((entry) =>
          entry.status === "completed"
          && entry.verified
          && Boolean(entry.assetId)
          && entry.productImageCount === 11
          && entry.inputImageCount === 11
          && entry.sourceImageCount === 11
          && entry.expectedImageCount === 11
          && entry.sourceMatchesProduct);
      const lastMessage = messages.at(-1);
      const finalText = (Array.isArray(lastMessage?.parts) ? lastMessage.parts : [])
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\\n");
      return {
        apiOk: true,
        sessionId: ${JSON.stringify(sessionId)},
        sessionStatus: item.status?.type || "unknown",
        messageCount: messages.length,
        toolCount: tools.length,
        toolNames: tools.map((entry) => entry.tool),
        extractCalled: tools.some((entry) => entry.tool === "openwork_file_extract_text"),
        extractSourceConfirmed: extractOutputs.includes("xls:sheetjs-biff8"),
        productSaveAllowed: extractOutputs.includes('"productSaveAllowed": true'),
        sheetHitCount: sheetHits.length,
        sheetHits,
        productSaveCalled: saveResults.length > 0,
        saveResults,
        allSavesVerified,
        forbiddenCalls,
        finalFinish: lastMessage?.info?.finish || null,
        finalText: finalText.slice(-3000),
      };
    } catch (error) {
      return {
        apiOk: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })()`, 30_000);
}

function passesLiveEvidence(evidence) {
  return Boolean(
    evidence.apiOk
    && evidence.sessionStatus === "idle"
    && evidence.extractCalled
    && evidence.extractSourceConfirmed
    && evidence.productSaveAllowed
    && evidence.sheetHitCount === 3
    && evidence.productSaveCalled
    && evidence.allSavesVerified
    && evidence.forbiddenCalls.length === 0
    && evidence.toolCount <= 20
    && evidence.finalFinish === "stop"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.observeSessionId) {
    const report = {
      ok: false,
      verdict: "INCONCLUSIVE",
      port: options.port,
      mode: "observe-session",
      sessionId: options.observeSessionId,
      sendAttempted: false,
      liveProductWriteAttempted: false,
      evidence: {},
    };
    const session = await connectSession(options.port);
    report.targetTitle = session.page.title;
    try {
      report.scripts = await session.evaluate(
        `([...document.scripts].map((script) => script.getAttribute("src")).filter(Boolean))`,
      );
      const workspaceId = await session.evaluate(
        `(window.__openwork?.slice("route")?.selectedWorkspaceId || "")`,
      );
      if (!workspaceId) throw new Error("Could not resolve selected workspace for observation");
      report.route = `/workspace/${workspaceId}/session/${options.observeSessionId}`;
      report.evidence = await readSessionEvidence(session, report.route);
      report.ok = passesLiveEvidence(report.evidence);
      report.verdict = report.ok
        ? "PASS"
        : report.evidence.apiOk && report.evidence.sessionStatus === "idle"
          ? "FAIL"
          : "INCONCLUSIVE";
    } finally {
      session.close();
    }
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "wodeappx-xls-import-"));
  const report = {
    ok: false,
    verdict: "INCONCLUSIVE",
    port: options.port,
    fixtureRoot,
    prompt: PROMPT,
    mode: options.allowWrite ? "live-write" : "dry-run",
    sendAttempted: false,
    liveProductWriteAttempted: false,
    evidence: {},
  };

  try {
    const fixtures = await createFixtures(fixtureRoot);
    report.fixtures = {
      xlsPath: fixtures.xlsPath,
      imageCount: fixtures.imagePaths.length,
    };

    const session = await connectSession(options.port);
    report.targetTitle = session.page.title;
    try {
      report.scripts = await session.evaluate(`([...document.scripts].map((s) => s.getAttribute("src")).filter(Boolean))`);
      report.route = await createNewSession(session);
      report.attachments = await attachFixtureFiles(session, fixtures);

      if (!options.allowWrite) {
        report.cleaned = await clearFixtureAttachments(session);
        report.ok = report.attachments.count === 12 && report.cleaned === true;
        report.verdict = report.ok ? "DRY_RUN_PASS" : "FAIL";
        report.reason = report.ok
          ? "12 real local files reached the composer attachment store; send and product write were not attempted."
          : "Attachments reached the composer but cleanup failed.";
      } else {
        report.sendAttempted = true;
        report.liveProductWriteAttempted = true;
        await pasteAndSend(session, PROMPT);

        const deadline = Date.now() + options.timeoutMs;
        while (Date.now() < deadline) {
          const lastBody = await session.evaluate(`(document.body?.innerText || "")`);
          const snapshotEvidence = await readSessionEvidence(session, report.route);
          const evidence = snapshotEvidence.apiOk
            ? snapshotEvidence
            : {
                ...summarizeEvidence(lastBody),
                apiOk: false,
                snapshotError: snapshotEvidence.error,
              };
          report.evidence = evidence;
          report.bodyExcerpt = lastBody.slice(-2500);

          if (evidence.apiOk && evidence.sessionStatus === "idle") {
            report.ok = passesLiveEvidence(evidence);
            report.verdict = report.ok ? "PASS" : "FAIL";
            break;
          }
          if (
            !evidence.apiOk
            && evidence.extractCalled
            && evidence.productSaveCalled
            && evidence.sheetHitCount === 3
            && evidence.verified
            && evidence.assetId
            && evidence.productImageCount === 11
          ) {
            report.ok = true;
            report.verdict = "PASS";
            break;
          }
          await sleep(2000);
        }

        if (!report.ok) {
          const evidence = report.evidence || {};
          if (evidence.apiOk && evidence.sessionStatus !== "idle") {
            report.verdict = "INCONCLUSIVE";
            report.reason = `timeout waiting for session idle (last status: ${evidence.sessionStatus})`;
          } else if (!evidence.extractCalled) {
            report.verdict = evidence.apiOk ? "FAIL" : "INCONCLUSIVE";
            report.reason = "openwork_file_extract_text was not observed";
          } else if (evidence.apiOk && !evidence.extractSourceConfirmed) {
            report.verdict = "FAIL";
            report.reason = "extract ran without xls:sheetjs-biff8 evidence";
          } else if (evidence.sheetHitCount < 3) {
            report.verdict = "FAIL";
            report.reason = "extract ran but sheet verification codes were incomplete";
          } else if (!evidence.productSaveCalled) {
            report.verdict = "FAIL";
            report.reason = "xls extracted but product_save did not run";
          } else if (evidence.apiOk && evidence.forbiddenCalls?.length > 0) {
            report.verdict = "FAIL";
            report.reason = `forbidden attachment/PDF calls observed: ${evidence.forbiddenCalls.join(", ")}`;
          } else if (evidence.apiOk && !evidence.allSavesVerified) {
            report.verdict = "FAIL";
            report.reason = "not every product_save returned verified/assetId/productImageCount=11 with matching source images";
          } else if (!evidence.apiOk && !(evidence.verified && evidence.assetId && evidence.productImageCount === 11)) {
            report.verdict = "FAIL";
            report.reason = "product_save ran but verified/assetId/productImageCount=11 were not proven";
          }
        }
      }
    } finally {
      session.close();
    }
  } finally {
    if (report.ok) {
      await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
      report.fixtureRoot = null;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verdict: "INCONCLUSIVE", error: error.message }, null, 2));
  process.exit(1);
});
