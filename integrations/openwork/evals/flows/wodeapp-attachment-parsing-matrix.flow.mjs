import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FILES = {
  image: { name: "matrix-image.png", mime: "image/png", code: "ORANGE-731" },
  pdf: { name: "matrix-document.pdf", mime: "application/pdf", code: "BLUE-842" },
  text: { name: "matrix-notes.txt", mime: "text/plain", code: "GREEN-953" },
  csv: { name: "matrix-table.csv", mime: "text/csv", code: "CYAN-617" },
  xlsx: {
    name: "matrix-workbook.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    code: "PURPLE-528",
  },
  pptx: {
    name: "matrix-slides.pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    code: "GOLD-406",
  },
  video: { name: "matrix-video.mp4", mime: "video/mp4", code: "RED-264" },
};

const CASES = [
  { id: "01", label: "single PNG image", files: ["image"] },
  { id: "02", label: "single PDF document", files: ["pdf"] },
  { id: "03", label: "single TXT document", files: ["text"] },
  { id: "04", label: "single CSV table", files: ["csv"] },
  { id: "05", label: "single XLSX workbook", files: ["xlsx"] },
  { id: "06", label: "single PPTX deck", files: ["pptx"] },
  { id: "07", label: "single MP4 video", files: ["video"] },
  { id: "08", label: "PNG and PDF combination", files: ["image", "pdf"] },
  {
    id: "09",
    label: "four-format supported attachment batch",
    files: ["image", "pdf", "text", "csv"],
    verifyReload: true,
  },
  {
    id: "10",
    label: "seven-format mixed attachment batch",
    files: ["image", "pdf", "text", "csv", "xlsx", "pptx", "video"],
    verifyReload: true,
  },
];

let fixturePayloads = null;

function selectedCases() {
  const requested = (process.env.WODEAPP_ATTACHMENT_MATRIX_CASES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (requested.length === 0) return CASES;
  return CASES.filter((testCase) => requested.includes(testCase.id));
}

function pdfEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createPdfBuffer(lines) {
  const textCommands = lines
    .map((line, index) => `${index === 0 ? "" : "0 -48 Td "}(${pdfEscape(line)}) Tj`)
    .join(" ");
  const stream = `BT /F1 24 Tf 72 700 Td ${textCommands} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function verificationSvg(title, code, color) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <rect width="1280" height="720" fill="#ffffff"/>
      <rect x="44" y="44" width="1192" height="632" rx="32" fill="${color}"/>
      <text x="640" y="245" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="#ffffff">${title}</text>
      <text x="640" y="405" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="112" font-weight="800" fill="#ffffff">${code}</text>
      <text x="640" y="520" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" fill="#ffffff">VERIFICATION CODE</text>
    </svg>
  `);
}

async function prepareFixtures() {
  if (fixturePayloads) return fixturePayloads;

  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "wodeappx-attachment-matrix-"));
  const fixturePaths = Object.fromEntries(
    Object.entries(FILES).map(([id, file]) => [id, path.join(fixtureDirectory, file.name)]),
  );
  const sharp = (await import("sharp")).default;
  const XLSX = await import("xlsx");
  const PptxGenJS = (await import("pptxgenjs")).default;

  await sharp(verificationSvg("IMAGE ATTACHMENT", FILES.image.code, "#d97706"))
    .png()
    .toFile(fixturePaths.image);

  await writeFile(
    fixturePaths.pdf,
    createPdfBuffer(["PDF ATTACHMENT", `Verification code: ${FILES.pdf.code}`]),
  );
  await writeFile(
    fixturePaths.text,
    `TEXT ATTACHMENT\nVerification code: ${FILES.text.code}\nThis code exists only inside this file.\n`,
    "utf8",
  );
  await writeFile(
    fixturePaths.csv,
    `record_type,verification_code,notes\nattachment-matrix,${FILES.csv.code},code exists only in the CSV\n`,
    "utf8",
  );

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Workbook attachment matrix"],
    ["Verification code", FILES.xlsx.code],
    ["Source", "XLSX cell content"],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Verification");
  XLSX.writeFile(workbook, fixturePaths.xlsx);

  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  const slide = presentation.addSlide();
  slide.background = { color: "2F5E46" };
  slide.addText("PRESENTATION ATTACHMENT", {
    x: 0.8,
    y: 1.0,
    w: 11.7,
    h: 0.7,
    fontFace: "Arial",
    fontSize: 30,
    bold: true,
    color: "FFFFFF",
    align: "center",
  });
  slide.addText(FILES.pptx.code, {
    x: 0.8,
    y: 2.2,
    w: 11.7,
    h: 1.2,
    fontFace: "Arial",
    fontSize: 54,
    bold: true,
    color: "F3C969",
    align: "center",
  });
  slide.addText("VERIFICATION CODE", {
    x: 0.8,
    y: 3.6,
    w: 11.7,
    h: 0.6,
    fontFace: "Arial",
    fontSize: 24,
    color: "FFFFFF",
    align: "center",
  });
  await presentation.writeFile({ fileName: fixturePaths.pptx });

  const videoFrame = path.join(fixtureDirectory, "matrix-video-frame.png");
  const videoAudio = path.join(fixtureDirectory, "matrix-video-audio.aiff");
  await sharp(verificationSvg("VIDEO ATTACHMENT", FILES.video.code, "#b91c1c"))
    .png()
    .toFile(videoFrame);
  await execFileAsync("/usr/bin/say", [
    "-v",
    "Samantha",
    "-r",
    "145",
    "-o",
    videoAudio,
    "Video attachment. The verification code is red dash two six four. Again, red dash two six four.",
  ]);
  await execFileAsync("/usr/local/bin/ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-framerate",
    "25",
    "-i",
    videoFrame,
    "-i",
    videoAudio,
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    fixturePaths.video,
  ]);

  fixturePayloads = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([id, file]) => [
        id,
        {
          ...file,
          base64: (await readFile(fixturePaths[id])).toString("base64"),
        },
      ]),
    ),
  );
  return fixturePayloads;
}

function promptForCase(testCase) {
  return [
    `[MATRIX-${testCase.id}] 请真实读取本轮全部附件。`,
    "找出每个文件本体中的 verification code，保持原有英文大写字母、连字符和数字。",
    testCase.files.length === 1
      ? "只输出该校验码，不要猜测，不要补充说明。"
      : "每行按“文件名 = 校验码”输出，不能漏掉任何文件，不要猜测。",
  ].join("");
}

async function pasteComposer(ctx, text, route) {
  return ctx.waitFor(
    `(() => {
      const currentRoute = window.__openworkControl?.snapshot().route || "";
      if (currentRoute !== ${JSON.stringify(route)}) {
        window.location.hash = "#" + ${JSON.stringify(route)};
        return null;
      }
      for (const dialog of document.querySelectorAll('[data-slot="dialog-content"]')) {
        if (!(dialog.textContent || "").includes("手机端")) continue;
        const close = dialog.querySelector('[data-slot="dialog-close"]');
        if (close instanceof HTMLElement) close.click();
      }
      const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!editor) return null;
      editor.focus();
      const data = new DataTransfer();
      data.setData("text/plain", ${JSON.stringify(text)});
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return { ok: true };
    })()`,
    { timeoutMs: 30_000, label: "active composer for matrix prompt" },
  );
}

async function attachFiles(ctx, fileIds, route) {
  const files = fileIds.map((id) => fixturePayloads[id]);
  return ctx.waitFor(
    `(() => {
      const currentRoute = window.__openworkControl?.snapshot().route || "";
      if (currentRoute !== ${JSON.stringify(route)}) {
        window.location.hash = "#" + ${JSON.stringify(route)};
        return null;
      }
      for (const dialog of document.querySelectorAll('[data-slot="dialog-content"]')) {
        if (!(dialog.textContent || "").includes("手机端")) continue;
        const close = dialog.querySelector('[data-slot="dialog-close"]');
        if (close instanceof HTMLElement) close.click();
      }
      const input = document.querySelector('input[type="file"][multiple]');
      if (!(input instanceof HTMLInputElement)) return null;
      const data = new DataTransfer();
      for (const fixture of ${JSON.stringify(files)}) {
        const binary = atob(fixture.base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        data.items.add(new File([bytes], fixture.name, {
          type: fixture.mime,
          lastModified: Date.now(),
        }));
      }
      const count = data.files.length;
      const names = Array.from(data.files, (file) => file.name);
      input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, count, names };
    })()`,
    { timeoutMs: 30_000, label: "active file input for attachment matrix" },
  );
}

async function createEmptySession(ctx) {
  const forcedRoute = (process.env.WODEAPP_ATTACHMENT_MATRIX_SESSION_ROUTE || "").trim();
  if (forcedRoute) {
    await ctx.navigateHash(forcedRoute);
    return forcedRoute;
  }

  const reusableRoute = await ctx.eval(`(() => {
    const route = window.__openworkControl?.snapshot().route || "";
    const composer = window.__openwork?.slice("composer");
    return /\\/session\\/ses_[A-Za-z0-9]+$/.test(route)
      && composer?.sessionId === route.split("/").at(-1)
      && composer?.draftLength === 0
      && composer?.attachments?.length === 0
      && document.querySelectorAll('[data-message-role]').length === 0
      && Boolean(document.querySelector('[contenteditable="true"]'))
      && Boolean(document.querySelector('input[type="file"][multiple]'))
      ? route
      : null;
  })()`);
  if (reusableRoute) return reusableRoute;

  const previousRoute = await ctx.eval("window.__openworkControl.snapshot().route");
  await ctx.waitFor(
    `(() => {
      const action = window.__openworkControl?.listActions()
        .find((item) => item.id === "session.create_task");
      return Boolean(action && !action.disabled);
    })()`,
    { timeoutMs: 30_000, label: "session.create_task available for attachment matrix case" },
  );
  await ctx.control("session.create_task");
  return ctx.waitFor(
    `(() => {
      const route = window.__openworkControl.snapshot().route || "";
      const composer = window.__openwork?.slice("composer");
      return route !== ${JSON.stringify(previousRoute)}
        && /\\/session\\/ses_[A-Za-z0-9]+$/.test(route)
        && composer?.sessionId === route.split("/").at(-1)
        && composer?.draftLength === 0
        && composer?.attachments?.length === 0
        && document.querySelectorAll('[data-message-role]').length === 0
        && Boolean(document.querySelector('input[type="file"][multiple]'))
        ? route
        : null;
    })()`,
    { timeoutMs: 30_000, label: "new empty session for attachment matrix case" },
  );
}

async function dismissMobileDialog(ctx) {
  await ctx.eval(`(() => {
    for (const dialog of document.querySelectorAll('[data-slot="dialog-content"]')) {
      if (!(dialog.textContent || "").includes("手机端")) continue;
      const close = dialog.querySelector('[data-slot="dialog-close"]');
      if (close instanceof HTMLElement) close.click();
    }
    return true;
  })()`);
}

async function ensureConversationSurface(ctx, route) {
  await ctx.navigateHash(route);
  await dismissMobileDialog(ctx);
  await ctx.waitFor(
    `(() => {
      const currentRoute = window.__openworkControl?.snapshot().route || "";
      const composer = window.__openwork?.slice("composer");
      return currentRoute === ${JSON.stringify(route)}
        && composer?.sessionId === ${JSON.stringify(route.split("/").at(-1))}
        && Boolean(document.querySelector('[contenteditable="true"]'))
        && Boolean(document.querySelector('input[type="file"][multiple]'));
    })()`,
    { timeoutMs: 30_000, label: "active conversation composer surface" },
  );
}

function completionExpression(route, prompt, names, codes) {
  return `(() => {
    const currentRoute = window.__openworkControl?.snapshot().route || "";
    if (currentRoute !== ${JSON.stringify(route)}) {
      window.location.hash = "#" + ${JSON.stringify(route)};
      return null;
    }
    const composer = window.__openwork?.slice("composer");
    const bodyText = document.body.innerText || "";
    const userMessage = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((element) => (element.textContent || "").includes(${JSON.stringify(prompt)}));
    const assistantText = Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
      .map((element) => element.textContent || "")
      .join("\\n");
    const failures = [
      "Cannot read",
      "does not support image input",
      "附件未能解析出可用内容",
      "附件太大",
      "请先登录",
      "请重新上传",
      "积分不足",
      "余额不足",
      "Something went wrong",
      "ERROR:",
    ].filter((text) => bodyText.includes(text) || assistantText.includes(text));
    const missingFiles = ${JSON.stringify(names)}.filter((name) => !(userMessage?.textContent || "").includes(name));
    const missingCodes = ${JSON.stringify(codes)}.filter((code) => !assistantText.includes(code));
    const sessionId = ${JSON.stringify(route.split("/").at(-1))};
    const sessionSurface = window.__openwork
      ?.slice("reactRenderWatchdog")
      ?.components
      ?.find((item) => item.name === "SessionSurface");
    const details = sessionSurface?.lastDetails;
    const settled = details?.sessionId === sessionId
      && details.liveStatus === "idle"
      && details.sessionActivityStatus === "idle"
      && details.chatStreaming === false
      && details.sending === false;
    if (failures.length > 0) {
      return { complete: true, ready: false, failures, missingFiles, missingCodes, assistantText, bodyText };
    }
    if (userMessage && settled && assistantText.trim()) {
      return {
        complete: true,
        ready: missingFiles.length === 0 && missingCodes.length === 0,
        failures,
        missingFiles,
        missingCodes,
        assistantText,
      };
    }
    return null;
  })()`;
}

async function sendCase(ctx, testCase) {
  const prompt = promptForCase(testCase);
  const fixtures = testCase.files.map((id) => fixturePayloads[id]);
  const names = fixtures.map((file) => file.name);
  const codes = fixtures.map((file) => file.code);
  const route = await createEmptySession(ctx);
  await ensureConversationSurface(ctx, route);

  const pasted = await pasteComposer(ctx, prompt, route);
  ctx.assert(pasted?.ok, `Could not type ${testCase.label}: ${pasted?.reason ?? "unknown"}`);
  const attached = await attachFiles(ctx, testCase.files, route);
  ctx.assert(attached?.ok, `Could not attach ${testCase.label}: ${attached?.reason ?? "unknown"}`);
  ctx.assert(attached.count === fixtures.length, `Expected ${fixtures.length} attachments, got ${attached.count}`);
  const committed = await ctx.waitFor(
    `(() => {
      const composer = window.__openwork?.slice("composer");
      const names = composer?.attachments?.map((item) => item.name) || [];
      const bodyText = document.body.innerText || "";
      const rejected = ${JSON.stringify(names)}.filter((name) =>
        bodyText.includes(name + " has a format the model can't read"),
      );
      if (rejected.length > 0) return { ready: false, rejected };
      return composer?.draft?.includes(${JSON.stringify(`[MATRIX-${testCase.id}]`)})
        && ${JSON.stringify(names)}.every((name) => names.includes(name))
        ? { ready: true, rejected: [] }
        : null;
    })()`,
    { timeoutMs: 20_000, label: `${testCase.label} committed to composer` },
  );
  ctx.assert(
    committed.ready === true,
    `${testCase.label} was rejected before send: ${committed.rejected.join(", ")}`,
  );

  const clicked = await ctx.waitFor(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .filter((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return !candidate.disabled
          && rect.width > 0
          && rect.height > 0
          && (candidate.textContent || "").includes("发送");
      })
      .at(-1);
    if (!button) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 20_000, label: `enabled Send button for ${testCase.label}` });
  ctx.assert(clicked === true, `Visible Send button was unavailable for ${testCase.label}`);
  await ctx.navigateHash(route);

  const state = await ctx.waitFor(completionExpression(route, prompt, names, codes), {
    timeoutMs: testCase.files.includes("video") ? 300_000 : 180_000,
    label: `${testCase.label} parsed codes and persisted placeholders`,
  });
  ctx.assert(state.failures.length === 0, `${testCase.label} surfaced errors: ${state.failures.join(", ")}`);
  ctx.assert(state.missingFiles.length === 0, `${testCase.label} lost placeholders: ${state.missingFiles.join(", ")}`);
  ctx.assert(
    state.missingCodes.length === 0,
    `${testCase.label} did not parse codes ${state.missingCodes.join(", ")}; reply: ${state.assistantText}`,
  );
  ctx.assert(state.ready === true, `${testCase.label} did not reach a complete verified state`);
  ctx.log(`${testCase.label}: ${state.assistantText}`);
  await dismissMobileDialog(ctx);

  if (testCase.verifyReload) {
    await ctx.eval("(() => { window.location.reload(); return true; })()");
    await ctx.waitFor("Boolean(window.__openworkControl && window.__openwork)", {
      timeoutMs: 60_000,
      label: "app after mixed-batch reload",
    });
    await ctx.navigateHash(route);
    const reloaded = await ctx.waitFor(completionExpression(route, prompt, names, codes), {
      timeoutMs: 60_000,
      label: "reloaded mixed-batch response and placeholders",
    });
    ctx.assert(reloaded.ready === true, `Reload lost mixed-batch evidence: ${JSON.stringify(reloaded)}`);
  }

  return { prompt, names, codes, route, assistantText: state.assistantText };
}

export default {
  id: "wodeapp-attachment-parsing-matrix",
  title: "Real attachment parsing across individual and mixed file types",
  spec: "WodeAppX live attachment-intelligence matrix with secret codes stored only inside generated fixtures",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    await ctx.eval("(() => { window.location.reload(); return true; })()");
    await ctx.waitFor("Boolean(window.__openworkControl && window.__openwork)", {
      timeoutMs: 60_000,
      label: "fresh app before attachment matrix",
    });
    const state = await ctx.waitFor(
      `(() => {
        const control = window.__openworkControl;
        const route = control.snapshot().route;
        if (${JSON.stringify(Boolean((process.env.WODEAPP_ATTACHMENT_MATRIX_SESSION_ROUTE || "").trim()))}) return "ready";
        if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
        const composer = window.__openwork?.slice("composer");
        const hasReusableEmptySession = /\\/session\\/ses_[A-Za-z0-9]+$/.test(route)
          && composer?.sessionId === route.split("/").at(-1)
          && composer?.draftLength === 0
          && composer?.attachments?.length === 0
          && document.querySelectorAll('[data-message-role]').length === 0
          && Boolean(document.querySelector('[contenteditable="true"]'));
        if (hasReusableEmptySession) return "ready";
        const action = control.listActions().find((item) => item.id === "session.create_task");
        if (action && !action.disabled) return "ready";
        return null;
      })()`,
      { timeoutMs: 30_000, label: "session.create_task enabled" },
    );
    if (state === "blocked") return "Profile is not onboarded; this flow requires a workspace.";
    await prepareFixtures();
    return null;
  },
  steps: [
    {
      name: "Every individual and mixed fixture is parsed from its real file content",
      run: async (ctx) => {
        const results = [];
        for (const testCase of selectedCases()) {
          const claim = `${testCase.label} returns every secret code and keeps every attachment placeholder`;
          try {
            let evidence;
            await ctx.prove(claim, {
              action: async () => {
                evidence = await sendCase(ctx, testCase);
              },
              assert: async () => {
                for (const code of evidence.codes) {
                  ctx.recordEvidence({
                    type: "assertion",
                    status: "passed",
                    assertion: `${testCase.label} model reply contains secret code ${code}`,
                  });
                }
                for (const name of evidence.names) {
                  ctx.recordEvidence({
                    type: "assertion",
                    status: "passed",
                    assertion: `${testCase.label} user turn preserves placeholder ${name}`,
                  });
                }
              },
              screenshot: {
                name: `${testCase.id}-${testCase.label}`,
                requireText: [`[MATRIX-${testCase.id}]`, ...evidence?.names ?? [], ...evidence?.codes ?? []],
                rejectText: [
                  "Cannot read",
                  "does not support image input",
                  "附件未能解析出可用内容",
                  "Something went wrong",
                  "ERROR:",
                ],
                hashIncludes: evidence?.route,
              },
            });
            results.push({ id: testCase.id, label: testCase.label, status: "passed" });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ id: testCase.id, label: testCase.label, status: "failed", error: message });
            ctx.recordEvidence({
              type: "assertion",
              status: "failed",
              assertion: `${testCase.label}: ${message}`,
            });
            await ctx.screenshot(`${testCase.id}-${testCase.label}-failure`, {
              claim,
              requireText: [`[MATRIX-${testCase.id}]`],
              allowInvalid: true,
            }).catch(() => undefined);
            await ctx.eval("(() => { window.location.reload(); return true; })()");
            await ctx.waitFor("Boolean(window.__openworkControl && window.__openwork)", {
              timeoutMs: 60_000,
              label: `fresh app after failed ${testCase.label}`,
            });
          }
        }

        ctx.log(`Attachment parsing matrix results: ${JSON.stringify(results)}`);
        const failures = results.filter((result) => result.status === "failed");
        ctx.assert(
          failures.length === 0,
          `Attachment parsing matrix failures: ${failures.map((item) => `${item.label}: ${item.error}`).join(" | ")}`,
        );
      },
    },
  ],
};
