import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      reject(new Error("Unsupported WodeApp request protocol"));
      return;
    }
    const requestImpl = target.protocol === "http:" ? httpRequest : httpsRequest;
    const request = requestImpl(target, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          request.destroy(new Error("WodeApp response is too large"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const status = response.statusCode || 0;
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ ok: status >= 200 && status < 300, status, json, text });
      });
    });
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
    const timeout = setTimeout(() => request.destroy(new Error("WodeApp request timed out")), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.on("close", () => clearTimeout(timeout));
    if (typeof options.body === "string" && options.body) request.write(options.body);
    request.end();
  });
}

try {
  const input = await readInput();
  const result = await requestJson(input.url, input.options);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({
    workerError: error instanceof Error ? error.message : "WodeApp request failed",
  }));
}
