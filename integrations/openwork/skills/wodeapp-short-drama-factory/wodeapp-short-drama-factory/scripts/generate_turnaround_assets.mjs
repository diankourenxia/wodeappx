#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args["project-url"] || !args["project-header"]) {
  fail("Usage: WODEAPP_API_KEY=... node generate_turnaround_assets.mjs --input package-or-spec.json --project-url https://ai.wodeapp.cn --project-header ai --variants 3 --out-dir ./turnarounds");
}
const apiKey = process.env.WODEAPP_API_KEY;
if (!apiKey) fail("WODEAPP_API_KEY is required");

const inputPath = resolve(args.input);
const projectUrl = args["project-url"];
const projectHeader = args["project-header"];
const model = args.model || "doubao-seedream-5-0-260128";
const variants = Math.max(1, Number(args.variants || 3));
const outDir = resolve(args["out-dir"] || "turnarounds");
const force = Boolean(args.force);
const onlyNames = args.only
  ? new Set(String(args.only).split(",").map(item => item.trim()).filter(Boolean))
  : null;
const contactSheetPath = join(outDir, "turnaround-contact-sheet.png");
const reportJsonPath = join(outDir, "turnaround-assets-report.json");
const reportMdPath = join(outDir, "turnaround-assets-report.md");
const sharp = await loadSharp();

mkdirSync(outDir, { recursive: true });

const source = JSON.parse(readFileSync(inputPath, "utf8"));
const { characters, styleBible } = loadCharactersAndStyle(source);
const selectedCharacters = characters.filter(character => !onlyNames || onlyNames.has(character.name));
const existing = existsSync(reportJsonPath)
  ? JSON.parse(readFileSync(reportJsonPath, "utf8")).items || []
  : [];
const outputItems = [...existing];

for (const character of selectedCharacters) {
  for (let variant = 1; variant <= variants; variant++) {
    const localPath = join(outDir, `${slugify(character.name)}-turnaround-v${variant}.png`);
    const existingItem = outputItems.find(item => item.characterName === character.name && item.variant === variant);
    if (!force && existingItem?.assetUrl && existsSync(localPath)) {
      console.log(`[skip] ${character.name} v${variant}`);
      continue;
    }
    const prompt = buildTurnaroundPrompt(character, styleBible, variant);
    try {
      console.log(`[turnaround] generating ${character.name} v${variant} with ${model}`);
      const sourceUrl = await generateImage(prompt);
      console.log(`[turnaround] downloading ${character.name} v${variant}`);
      const buffer = await downloadImageBuffer(sourceUrl);
      writeFileSync(localPath, buffer);
      console.log(`[turnaround] uploading ${character.name} v${variant}`);
      const asset = await uploadAssetBuffer(buffer, `${character.name} turnaround v${variant} - Seedream 5.0.png`);
      upsert(outputItems, {
        characterId: character.id,
        characterName: character.name,
        variant,
        model,
        projectUrl,
        projectHeader,
        prompt,
        localPath,
        sourceUrl,
        assetId: asset.assetId || "",
        assetUrl: asset.url || "",
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[turnaround] failed ${character.name} v${variant}: ${message}`);
      upsert(outputItems, {
        characterId: character.id,
        characterName: character.name,
        variant,
        model,
        projectUrl,
        projectHeader,
        prompt,
        localPath: "",
        sourceUrl: "",
        assetId: "",
        assetUrl: "",
        generatedAt: new Date().toISOString(),
        error: message,
      });
    }
    writeReports(outputItems);
  }
}

await createContactSheet(outputItems);
writeReports(outputItems);
console.log(JSON.stringify({
  projectUrl,
  projectHeader,
  model,
  total: outputItems.length,
  uploaded: outputItems.filter(item => item.assetUrl).length,
  errors: outputItems.filter(item => item.error).length,
  contactSheet: contactSheetPath,
  report: reportMdPath,
}, null, 2));

function loadCharactersAndStyle(json) {
  if (json.workflowRun?.data?.ctxSnapshot) {
    const snapshot = JSON.parse(json.workflowRun.data.ctxSnapshot);
    const storyboard = snapshot.storyboard || {};
    const assets = storyboard.assets || {};
    return {
      characters: assets.characters || [],
      styleBible: storyboard.assetStyleBible || assets.styleBible || {},
    };
  }
  if (json.series && json.characters) {
    return {
      characters: json.characters,
      styleBible: json.series.styleBible || {},
    };
  }
  if (Array.isArray(json.characters)) {
    return {
      characters: json.characters,
      styleBible: json.styleBible || {},
    };
  }
  fail("Could not find characters in input. Expected WodeApp package, creative spec, or { characters: [] }.");
}

function buildTurnaroundPrompt(character, styleBible, variant) {
  const hardStyle = styleBible.hardStyleLock || "Live-action photorealistic human actor casting reference. Natural skin texture, real pores, realistic hands, practical wardrobe, actual camera photography.";
  const negativeStyle = styleBible.negativeStyle || "not anime, not manga, not illustration, not 3D render, not game concept art, not doll-like skin, no text, no logo, no watermark";
  const globalLook = Array.isArray(styleBible.globalLook) ? styleBible.globalLook.join(" ") : String(styleBible.globalLook || "");
  const isFemale = /woman|female|mother|heroine|女|母/i.test(`${character.role || ""} ${character.gender || ""}`) || ["Ella Hart", "Lena Hart"].includes(character.name);
  const genderLine = isFemale
    ? "Gender directive: unmistakably adult woman, grounded TV-drama casting, no teen-coded face, no doll-like beauty filter."
    : "Gender directive: unmistakably adult man, masculine adult facial bone structure, masculine body language, no feminine face, no androgynous idol styling, no makeup-heavy fantasy look.";
  const transformation = character.transformationBrief
    || transformedFormLine(character)
    || `Fourth figure shows transformed or power form: ${character.animalForm || "power form"}. Keep it realistic and production-friendly.`;
  return [
    `Create one wide 16:9 live-action costume-fitting contact sheet for ${character.name}.`,
    genderLine,
    globalLook ? `Series look: ${globalLook}` : "",
    "Unified setup: neutral charcoal-gray wet concrete studio, actual camera photography, realistic standing pose, 35mm or 50mm cinema lens, soft overhead key light, cool moon rim light, small warm practical edge light, real skin texture, fabric wrinkles, lens noise, slight human asymmetry, realistic hands.",
    `Hard style lock: ${hardStyle}`,
    castingLine(character),
    `Story role: ${character.role || ""}.`,
    "Sheet layout: four clean full-body photographed views on one neutral studio floor, evenly spaced, same scale, same lighting, no text labels. View 1 front human, view 2 side-profile human, view 3 back human, view 4 transformed / power form. The three human views must be the same person with identical face, hair, body, wardrobe, scars, jewelry, and animal markers.",
    transformation,
    "Human anatomy lock: normal human ears, normal human eyes, normal human hands, no pointed ears, no elf ears, no fantasy prosthetic ears.",
    "Animal form lock: full animal forms must be realistic animals with natural anatomy, not humanoid monsters, not armor, not mascot suits, not cartoons.",
    "Wardrobe remains premium TV drama styling, practical and shootable. Male shifters may show shoulders, forearms, collarbones, upper chest, and strong body shape where specified, but no explicit nudity. No armor, no cosplay pieces, no decorative fantasy shoulder pads.",
    `Negative style lock: ${negativeStyle}, not Pixar, not Unreal Engine, not Octane render, not CG character, not digital sculpture, not wax figure, not webnovel cover, not idol poster, not fantasy splash art.`,
    variantDirective(variant),
  ].filter(Boolean).join("\n");
}

function castingLine(character) {
  const fields = [
    character.age ? `adult age ${character.age}` : "clearly adult",
    character.ethnicity ? `ethnicity / casting background: ${character.ethnicity}` : "",
    character.skinTone ? `skin tone: ${character.skinTone}` : "",
    character.faceBody ? `face and body: ${character.faceBody}` : "",
    character.bodyType ? `body type: ${character.bodyType}` : "",
    character.hairEyes ? `hair / eyes: ${character.hairEyes}` : "",
    character.wardrobeSilhouette ? `wardrobe silhouette: ${character.wardrobeSilhouette}` : "",
    character.animalMarker ? `animal or power marker: ${character.animalMarker}` : "",
  ].filter(Boolean);
  return `Casting details: ${fields.join("; ")}.`;
}

function transformedFormLine(character) {
  const form = String(character.animalForm || "").toLowerCase();
  if (!form || form === "human") return "Fourth figure shows power/corruption state while remaining human; no animal body unless specified.";
  if (form.includes("wolf")) return `Fourth figure shows full transformed form: realistic large ${character.animalForm}, natural anatomy, same signature marks. No humanoid wolf.`;
  if (form.includes("panther") || form.includes("lion")) return `Fourth figure shows full transformed form: realistic ${character.animalForm}, natural cat anatomy, same signature marks. No humanoid cat.`;
  if (form.includes("bear")) return "Fourth figure shows full transformed form: realistic massive black bear, natural anatomy, same signature marks. No humanoid bear.";
  if (form.includes("eagle")) return "Fourth figure shows full transformed form: realistic great eagle, natural anatomy, same signature marks. No wings on human body.";
  if (form.includes("stag") || form.includes("elk")) return "Fourth figure shows full transformed form: realistic elk / stag, natural antlers only on animal form. No antlers on human body.";
  if (form.includes("bison") || form.includes("bull")) return "Fourth figure shows full transformed form: realistic powerful bison / bull, natural anatomy. No minotaur.";
  if (form.includes("raven") || form.includes("bird")) return "Fourth figure shows full transformed form: realistic large black raven, natural anatomy. No wings on human body.";
  return `Fourth figure shows full transformed form: realistic ${character.animalForm}, natural anatomy. No humanoid monster.`;
}

function variantDirective(variant) {
  const items = [
    "Variant A: cleanest grounded premium-TV costume fitting reference, restrained expression.",
    "Variant B: darker romance-thriller intensity, stronger body silhouette, still realistic and shootable.",
    "Variant C: most useful production design sheet, balanced lighting, clearest wardrobe and marker details.",
    "Variant D: closer face readability while preserving full-body turnaround.",
    "Variant E: rain-wet practical texture and tense adult romance energy.",
  ];
  return items[(variant - 1) % items.length];
}

async function generateImage(prompt) {
  const json = await postJson("/runtime-server/api/ai/image/generate", {
    prompt,
    model,
    size: "16:9",
    n: 1,
    sync: true,
  }, 540000);
  const url = json?.data?.url || json?.data?.urls?.[0] || json?.data?.images?.[0]?.url;
  if (!url) throw new Error("Image generation returned no URL");
  return absoluteUrl(url);
}

async function postJson(path, body, timeoutMs) {
  const res = await fetch(`${projectUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "x-subdomain-project": projectHeader,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok || json.success === false) throw new Error(`${path} HTTP ${res.status}: ${json.error || text.slice(0, 300)}`);
  return json;
}

async function downloadImageBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(absoluteUrl(url), { signal: AbortSignal.timeout(420000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw lastError;
}

async function uploadAssetBuffer(buffer, name) {
  const optimized = await sharp(buffer)
    .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 92 })
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([optimized], { type: "image/webp" }), name.replace(/\.[^.]+$/, ".webp"));
  form.append("name", name);
  const res = await fetch(`${projectUrl}/runtime-server/api/v1/assets/upload`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "x-subdomain-project": projectHeader,
    },
    body: form,
    signal: AbortSignal.timeout(420000),
  });
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok || json.success === false) throw new Error(`/assets/upload HTTP ${res.status}: ${json.error || text.slice(0, 300)}`);
  return json.data || {};
}

async function createContactSheet(items) {
  const valid = items.filter(item => item.localPath && existsSync(item.localPath));
  if (!valid.length) return;
  const thumbW = 420;
  const thumbH = 236;
  const labelH = 54;
  const gap = 18;
  const columns = 3;
  const rows = Math.ceil(valid.length / columns);
  const width = columns * thumbW + (columns + 1) * gap;
  const height = rows * (thumbH + labelH) + (rows + 1) * gap;
  const composites = [];
  for (let index = 0; index < valid.length; index++) {
    const item = valid[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + col * (thumbW + gap);
    const y = gap + row * (thumbH + labelH + gap);
    const image = await sharp(item.localPath).resize(thumbW, thumbH, { fit: "cover" }).png().toBuffer();
    const label = Buffer.from(`
      <svg width="${thumbW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#101418"/>
        <text x="14" y="24" font-size="18" font-family="Arial, Helvetica, sans-serif" fill="#f5f2ea">${escapeXml(item.characterName)} v${item.variant}</text>
        <text x="14" y="44" font-size="12" font-family="Arial, Helvetica, sans-serif" fill="#9fb0bd">${escapeXml(item.assetUrl || "")}</text>
      </svg>
    `);
    composites.push({ input: image, left: x, top: y });
    composites.push({ input: label, left: x, top: y + thumbH });
  }
  await sharp({ create: { width, height, channels: 4, background: "#0b0f12" } })
    .composite(composites)
    .png()
    .toFile(contactSheetPath);
}

function writeReports(items) {
  writeFileSync(reportJsonPath, JSON.stringify({ projectUrl, projectHeader, model, contactSheet: contactSheetPath, items }, null, 2), "utf8");
  const lines = [
    "# Character Turnaround Assets",
    "",
    `Project: ${projectUrl}`,
    `Model: ${model}`,
    `Generated: ${new Date().toISOString()}`,
    "",
  ];
  for (const item of items) {
    lines.push(`## ${item.characterName} v${item.variant}`, "", `- Local: ${item.localPath || ""}`, `- Asset URL: ${item.assetUrl || ""}`, item.error ? `- Error: ${item.error}` : "", "");
  }
  lines.push("## Contact Sheet", "", contactSheetPath);
  writeFileSync(reportMdPath, lines.filter(line => line !== "").join("\n"), "utf8");
}

function upsert(items, record) {
  const index = items.findIndex(item => item.characterName === record.characterName && item.variant === record.variant);
  if (index >= 0) items.splice(index, 1, record);
  else items.push(record);
}

function absoluteUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return new URL(url, projectUrl).toString();
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
    else parsed[arg.slice(2)] = argv[index + 1]?.startsWith("--") ? true : argv[++index];
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    try {
      const requireFromCwd = createRequire(join(process.cwd(), "package.json"));
      return requireFromCwd("sharp");
    } catch {
      fail("The generate_turnaround_assets script requires sharp. Run it from a WodeApp repo with dependencies installed, or install sharp in the current project.");
    }
  }
}
