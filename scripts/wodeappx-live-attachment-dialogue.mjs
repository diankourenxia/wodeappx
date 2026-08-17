#!/usr/bin/env node
/**
 * Live multi-turn dialogue send against the running WodeAppX desktop window (CDP).
 * Creates a new session, attaches mixed image+txt+pdf fixtures, sends T1, waits for reply,
 * then sends T2/T3 follow-ups and records evidence.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.WODEAPPX_CDP_PORT || 9823);
const FIXTURE_DIR = join(tmpdir(), "wodeappx-live-attach-fixtures");
const REPORT_PATH = join(tmpdir(), `wodeappx-live-dialogue-${Date.now()}.json`);

function tinyPdf(label) {
  const content = `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`;
  const objs = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body));
    body += o;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

function ensureFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const brief = join(FIXTURE_DIR, "product-brief.txt");
  const pdf = join(FIXTURE_DIR, "product-quote.pdf");
  const jpg = join(FIXTURE_DIR, "bag.jpg");
  writeFileSync(
    brief,
    "产品名称：摩飞四代多功能锅\n卖点：煎烤蒸煮一体\n目标：输出种草短视频脚本\n",
    "utf8",
  );
  writeFileSync(pdf, tinyPdf("WodeApp Quote PDF MR-POT-4"));
  // Minimal JPEG
  writeFileSync(jpg, Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, ...Array(64).fill(8), 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x03, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
    0x3f, 0x00, 0x7f, 0xff, 0xd9,
  ]));
  return { brief, pdf, jpg };
}

async function connect(port) {
  if (typeof WebSocket !== "function") {
    throw new Error("Need Node with global WebSocket");
  }
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === "page" && /localhost:5174|session\//.test(t.url || ""))
    || list.find((t) => t.type === "page" && /WodeAppX|小灵通|OpenWork|WodeApp/i.test(t.title || ""));
  if (!page?.webSocketDebuggerUrl) throw new Error(`No desktop page on CDP ${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (msg) => {
    const data = JSON.parse(String(msg.data));
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }
    if (data.method) {
      events.push({
        at: Date.now(),
        method: data.method,
        params: data.params,
      });
    }
  });
  async function send(method, params = {}) {
    const id = nextId++;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "evaluate failed");
    }
    return result.result?.value;
  }
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("DOM.enable");
  return { ws, send, evaluate, events, page };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function clickButtonByText(evaluate, text) {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button, a, [role="button"]')];
    const target = buttons.find((el) => ((el.innerText || el.textContent || "").trim() === ${JSON.stringify(text)}));
    if (!target) return { ok: false, reason: "not-found" };
    target.click();
    return { ok: true, text: ${JSON.stringify(text)} };
  })()`);
}

async function typeIntoComposer(evaluate, send, text) {
  const focused = await evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return false;
    editor.focus();
    return true;
  })()`);
  if (!focused) throw new Error("composer not found");
  // Clear
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 4, windowsVirtualKeyCode: 65, code: "KeyA", key: "a" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, windowsVirtualKeyCode: 65, code: "KeyA", key: "a" });
  await send("Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 8, code: "Backspace", key: "Backspace" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 8, code: "Backspace", key: "Backspace" });
  // Insert text via execCommand for reliability with contenteditable
  await evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    editor.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, ${JSON.stringify(text)});
    return editor.innerText;
  })()`);
}

async function attachFiles(send, evaluate, paths) {
  // Prefer native file input if present
  const inputInfo = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return inputs.map((el, index) => ({
      index,
      id: el.id || "",
      accept: el.accept || "",
      multiple: el.multiple,
    }));
  })()`);
  if (inputInfo?.length) {
    const { root } = await send("DOM.getDocument", { depth: 1 });
    const { nodeIds } = await send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });
    if (nodeIds?.length) {
      await send("DOM.setFileInputFiles", {
        nodeId: nodeIds[0],
        files: paths,
      });
      return { method: "DOM.setFileInputFiles", inputCount: inputInfo.length, paths };
    }
  }

  // Fallback: synthesize FileList onto a hidden input and dispatch change
  const payload = paths.map((p) => ({
    path: p,
    name: p.split("/").pop(),
    mime: p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".txt") ? "text/plain" : "image/jpeg",
    base64: readFileSync(p).toString("base64"),
  }));
  const injected = await evaluate(`(async () => {
    const filesMeta = ${JSON.stringify(payload)};
    const dt = new DataTransfer();
    for (const item of filesMeta) {
      const bin = atob(item.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], item.name, { type: item.mime });
      try { Object.defineProperty(file, "path", { value: item.path }); } catch {}
      dt.items.add(file);
    }
    let input = document.querySelector('input[type="file"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
    }
    Object.defineProperty(input, "files", { configurable: true, value: dt.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Also try drop on composer
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor) {
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      editor.dispatchEvent(drop);
    }
    return {
      fileCount: dt.files.length,
      names: [...dt.files].map((f) => f.name),
      hasNativeInput: Boolean(document.querySelector('input[type="file"]')),
    };
  })()`);
  return { method: "DataTransfer+change/drop", ...injected };
}

async function clickSend(evaluate) {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const send = buttons.find((b) => {
      const t = (b.innerText || b.textContent || "").trim();
      return t === "发送" || t === "Send";
    });
    if (!send) return { ok: false };
    if (send.disabled) return { ok: false, reason: "disabled" };
    send.click();
    return { ok: true };
  })()`);
}

async function snapshot(evaluate) {
  return evaluate(`(() => {
    const body = document.body?.innerText || "";
    const toolish = [...document.querySelectorAll('[data-tool], .tool, [class*="tool"]')]
      .slice(0, 20)
      .map((el) => (el.innerText || el.textContent || "").trim().slice(0, 120))
      .filter(Boolean);
    return {
      href: location.href,
      bodyTail: body.slice(-3500),
      hasStop: [...document.querySelectorAll("button")].some((b) => ((b.innerText || "").trim() === "Stop")),
      hasPdfToolHint: /openwork_pdf_extract_text|提取 PDF|PDF 文本|product-quote\\.pdf|摩飞/.test(body),
      hasMorfei: /摩飞/.test(body),
      hasSock: /纽莱|袜子|礼袋/.test(body),
      hasForbidLocal: /不要再调用 openwork_file_search|不要扫描工作区/.test(body),
      toolish,
    };
  })()`);
}

async function waitForIdleOrReply(evaluate, { timeoutMs = 120000, sinceText = "" } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot(evaluate);
    const grew = (last.bodyTail || "").length > (sinceText || "").length + 40;
    const busy = last.hasStop;
    if (!busy && grew) return { ok: true, timedOut: false, snapshot: last };
    await sleep(1500);
  }
  return { ok: false, timedOut: true, snapshot: last };
}

async function main() {
  const fixtures = ensureFixtures();
  const report = {
    port: PORT,
    startedAt: new Date().toISOString(),
    fixtures,
    steps: [],
  };
  const { ws, send, evaluate, events, page } = await connect(PORT);
  report.target = { id: page.id, url: page.url, title: page.title };

  // New session
  let created = await clickButtonByText(evaluate, "新建对话");
  if (!created?.ok) created = await clickButtonByText(evaluate, "New session");
  report.steps.push({ step: "new-session", ...created });
  await sleep(1500);

  // Attach files
  const attach = await attachFiles(send, evaluate, [fixtures.jpg, fixtures.brief, fixtures.pdf]);
  report.steps.push({ step: "attach-files", ...attach });
  await sleep(800);

  const t1 = "请分别说明这三个附件：图片、product-brief.txt、product-quote.pdf 各自写的是什么。优先用本地 PDF/文件工具读取，不要说无法解析就放弃。";
  await typeIntoComposer(evaluate, send, t1);
  const beforeSend = await snapshot(evaluate);
  report.steps.push({ step: "typed-t1", composerPreview: beforeSend.bodyTail.slice(-500) });

  const sent = await clickSend(evaluate);
  report.steps.push({ step: "send-t1", ...sent });
  if (!sent?.ok) throw new Error(`Send failed: ${JSON.stringify(sent)}`);

  const t1Wait = await waitForIdleOrReply(evaluate, { timeoutMs: 150000, sinceText: beforeSend.bodyTail });
  report.steps.push({
    step: "wait-t1",
    timedOut: t1Wait.timedOut,
    hasMorfei: t1Wait.snapshot?.hasMorfei,
    hasPdfToolHint: t1Wait.snapshot?.hasPdfToolHint,
    hasForbidLocal: t1Wait.snapshot?.hasForbidLocal,
    bodyTail: t1Wait.snapshot?.bodyTail?.slice(-1200),
  });

  // Turn 2
  await sleep(2000);
  const t2 = "报价 PDF 里有什么关键信息？不要让我重新上传。";
  await typeIntoComposer(evaluate, send, t2);
  const beforeT2 = await snapshot(evaluate);
  const sent2 = await clickSend(evaluate);
  report.steps.push({ step: "send-t2", ...sent2 });
  const t2Wait = await waitForIdleOrReply(evaluate, { timeoutMs: 120000, sinceText: beforeT2.bodyTail });
  report.steps.push({
    step: "wait-t2",
    timedOut: t2Wait.timedOut,
    bodyTail: t2Wait.snapshot?.bodyTail?.slice(-1200),
  });

  // Turn 3
  await sleep(2000);
  const t3 = "brief 里的产品名是袜子还是锅？只回答产品名。";
  await typeIntoComposer(evaluate, send, t3);
  const beforeT3 = await snapshot(evaluate);
  const sent3 = await clickSend(evaluate);
  report.steps.push({ step: "send-t3", ...sent3 });
  const t3Wait = await waitForIdleOrReply(evaluate, { timeoutMs: 120000, sinceText: beforeT3.bodyTail });
  report.steps.push({
    step: "wait-t3",
    timedOut: t3Wait.timedOut,
    hasMorfei: t3Wait.snapshot?.hasMorfei,
    bodyTail: t3Wait.snapshot?.bodyTail?.slice(-1200),
  });

  const networkHints = events
    .filter((e) => e.method === "Network.requestWillBeSent")
    .map((e) => e.params?.request?.url)
    .filter((u) => u && /attachment|pdf|chat|completion|opencode/i.test(u))
    .slice(-30);

  report.finishedAt = new Date().toISOString();
  report.networkHints = networkHints;
  report.verdict = (() => {
    if (!sent?.ok) return "FAIL";
    if (t1Wait.timedOut && t2Wait.timedOut && t3Wait.timedOut) return "INCONCLUSIVE";
    if (t3Wait.snapshot?.hasMorfei || t1Wait.snapshot?.hasMorfei) return "PASS";
    if (attach?.fileCount > 0 || attach?.paths) return "INCONCLUSIVE";
    return "INCONCLUSIVE";
  })();

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath: REPORT_PATH, verdict: report.verdict, steps: report.steps.map((s) => s.step) }, null, 2));
  console.log("---BODY_T3_TAIL---");
  console.log(t3Wait.snapshot?.bodyTail?.slice(-800) || "");
  ws.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2));
  process.exit(1);
});
