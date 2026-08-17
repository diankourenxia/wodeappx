import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertPublicImageFetchUrl,
  createBoundedImagePreview,
  fetchRemoteImageBytes,
  isRemoteImageSource,
  normalizeRemoteImageUrl,
} from "./bounded-image-preview.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxAADCBYAG10BBdmDPA0AAAAASUVORK5CYII=",
  "base64",
);

describe("bounded-image-preview remote sources", () => {
  test("detects https and image-proxy refs", () => {
    expect(isRemoteImageSource("https://wodeapp.cn/runtime-server/api/image-proxy/abc")).toBe(true);
    expect(isRemoteImageSource("/runtime-server/api/image-proxy/abc")).toBe(true);
    expect(isRemoteImageSource("/image-proxy/abc")).toBe(true);
    expect(isRemoteImageSource("image-proxy/abc")).toBe(true);
    expect(isRemoteImageSource("/tmp/local.png")).toBe(false);
  });

  test("normalizes relative image-proxy paths against WODEAPP_ORIGIN", () => {
    expect(normalizeRemoteImageUrl("/image-proxy/abc", { WODEAPP_ORIGIN: "https://wodeapp.cn" }))
      .toBe("https://wodeapp.cn/runtime-server/api/image-proxy/abc");
    expect(normalizeRemoteImageUrl("runtime-server/api/image-proxy/abc", { WODEAPP_ORIGIN: "https://example.test" }))
      .toBe("https://example.test/runtime-server/api/image-proxy/abc");
  });

  test("blocks private hosts by default", () => {
    expect(() => assertPublicImageFetchUrl("https://127.0.0.1/a.png")).toThrow(/private|loopback/i);
    expect(() => assertPublicImageFetchUrl("http://wodeapp.cn/a.png")).toThrow(/HTTPS/i);
    expect(
      assertPublicImageFetchUrl("http://127.0.0.1/a.png", {
        OPENWORK_ALLOW_INSECURE_REMOTE_FETCH: "1",
        OPENWORK_ALLOW_PRIVATE_REMOTE_FETCH: "1",
      }).hostname,
    ).toBe("127.0.0.1");
  });

  test("follows redirects with host revalidation and returns bytes", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/proxy/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/img.png" },
        });
      }
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    const result = await fetchRemoteImageBytes("https://wodeapp.cn/proxy/start", { fetchImpl });
    expect(calls).toEqual([
      "https://wodeapp.cn/proxy/start",
      "https://cdn.example/img.png",
    ]);
    expect(result.finalUrl).toBe("https://cdn.example/img.png");
    expect(result.bytes.equals(TINY_PNG)).toBe(true);
  });

  test("createBoundedImagePreview accepts remote URL via fetchImpl", async () => {
    const fetchImpl = (async () => new Response(TINY_PNG, {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;
    const preview = await createBoundedImagePreview(
      "https://wodeapp.cn/runtime-server/api/image-proxy/demo",
      { fetchImpl, maxEdge: 256 },
    );
    expect(preview.sourceKind).toBe("remote");
    expect(preview.sourceWidth).toBe(2);
    expect(preview.sourceHeight).toBe(2);
    expect(preview.attachment.mime).toBe("image/jpeg");
    expect(preview.attachment.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  test("createBoundedImagePreview still supports local paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wodeappx-media-view-"));
    const path = join(directory, "tiny.png");
    await writeFile(path, TINY_PNG);
    try {
      const preview = await createBoundedImagePreview(path, { maxEdge: 256 });
      expect(preview.sourceKind).toBe("local");
      expect(preview.path).toBe(path);
      expect(preview.previewBytes).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
