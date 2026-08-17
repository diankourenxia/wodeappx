#!/usr/bin/env bun
/**
 * Isolate one local vendor key and probe/match (optional live ping).
 *
 *   bun wodeappx/scripts/isolate-vendor.ts --list
 *   bun wodeappx/scripts/isolate-vendor.ts volcano
 *   bun wodeappx/scripts/isolate-vendor.ts openrouter --invoke chat
 *   bun wodeappx/scripts/isolate-vendor.ts replicate --invoke image
 *   bun wodeappx/scripts/isolate-vendor.ts --all
 *
 * Default --invoke none (catalog only, no spend). Does not print API keys.
 */
import {
  listIsolatedVendorIds,
  runIsolatedVendor,
  runIsolatedVendors,
  type IsolateInvokeMode,
} from "../integrations/openwork/wodeapp/wodeapp-vendor-isolation.ts";

function parseArgs(argv: string[]) {
  const invokeRaw = argv.includes("--invoke") ? argv[argv.indexOf("--invoke") + 1] : "none";
  const invoke = (invokeRaw === "chat" || invokeRaw === "image" || invokeRaw === "none")
    ? invokeRaw
    : "none";
  const all = argv.includes("--all");
  const list = argv.includes("--list");
  const vendorIds = argv.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    if (argv[index - 1] === "--invoke") return false;
    return true;
  });
  return { invoke: invoke as IsolateInvokeMode, all, list, vendorIds };
}

function publicCatalog(report: Awaited<ReturnType<typeof runIsolatedVendor>>) {
  const catalog = report.catalog;
  return {
    ok: report.ok,
    vendorId: report.vendorId,
    probeStatus: report.probeStatus,
    error: report.error,
    families: catalog?.families,
    modelCount: catalog?.modelCount,
    match: {
      text: catalog?.match.text?.modelID || null,
      image: catalog?.match.image?.modelID || null,
      video: catalog?.match.video?.modelID || null,
    },
    invokeCandidates: {
      text: catalog?.invokeCandidates.text.slice(0, 6),
      image: catalog?.invokeCandidates.image.slice(0, 4),
      video: catalog?.invokeCandidates.video.slice(0, 4),
    },
    ping: report.ping && {
      kind: report.ping.kind,
      ok: report.ping.ok,
      status: report.ping.status,
      model: report.ping.model,
      hasContent: report.ping.hasContent,
      hasOutput: report.ping.hasOutput,
      err: report.ping.err,
    },
  };
}

const args = parseArgs(process.argv.slice(2));
const ids = await listIsolatedVendorIds();

if (args.list) {
  console.log(JSON.stringify({ vendors: ids }, null, 2));
  process.exit(0);
}

const targets = args.all || args.vendorIds.length === 0 ? ids : args.vendorIds;
if (targets.length === 0) {
  console.log(JSON.stringify({ ok: false, error: "no local vendor keys" }));
  process.exit(1);
}

const reports = await runIsolatedVendors(targets, { invoke: args.invoke });
const body = reports.map(publicCatalog);
console.log(JSON.stringify(args.invoke === "none" && body.length === 1 ? body[0] : body, null, 2));
process.exit(reports.every((item) => item.ok) ? 0 : 1);
