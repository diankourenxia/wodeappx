import { describe, expect, test } from "bun:test";

import {
  httpUrlFromCode,
  localFilePathMatchesTarget,
  localFileReferenceFromCode,
  localFileReferenceKind,
  pickBestLocalFilePathMatch,
} from "../markdown/local-file-reference";

describe("markdown local file references", () => {
  test("recognizes lone https URLs wrapped as code", () => {
    expect(httpUrlFromCode("https://example.wodeapp.cn/?shareDoc=pvs_demo"))
      .toBe("https://example.wodeapp.cn/?shareDoc=pvs_demo");
    expect(httpUrlFromCode("<https://example.com/a>")).toBe("https://example.com/a");
    expect(httpUrlFromCode("https://example.com/a\nhttps://example.com/b")).toBeNull();
    expect(httpUrlFromCode("open https://example.com")).toBeNull();
    expect(httpUrlFromCode("pvs_demo_id")).toBeNull();
  });

  test("recognizes rendered media filenames and local paths", () => {
    expect(localFileReferenceFromCode("alphaegg-s1-video_2026-07-16_13-27-14.mp4"))
      .toBe("alphaegg-s1-video_2026-07-16_13-27-14.mp4");
    expect(localFileReferenceFromCode("outputs/final video.mp4"))
      .toBe("outputs/final video.mp4");
    expect(localFileReferenceFromCode("~/Desktop/skyscreen-output/中国人寿天幕裸眼3D_2260x252.mp4"))
      .toBe("~/Desktop/skyscreen-output/中国人寿天幕裸眼3D_2260x252.mp4");
  });

  test("recognizes absolute and home directories", () => {
    expect(localFileReferenceFromCode("/var/folders/z1/tmp/opencode/project"))
      .toBe("/var/folders/z1/tmp/opencode/project");
    expect(localFileReferenceFromCode("~/Desktop/skyscreen-output/"))
      .toBe("~/Desktop/skyscreen-output");
    expect(localFileReferenceKind("/var/folders/z1/tmp/opencode/project")).toBe("directory");
    expect(localFileReferenceKind("~/Desktop/a.mp4")).toBe("file");
  });

  test("does not turn ordinary inline code or remote URLs into file buttons", () => {
    expect(localFileReferenceFromCode("const value = 1")).toBeNull();
    expect(localFileReferenceFromCode("https://example.com/video.mp4")).toBeNull();
    expect(localFileReferenceFromCode("npx hyperframes render 文件名.html")).toBeNull();
    expect(localFileReferenceFromCode("~/Desktop/skyscreen-output/中国人寿天幕裸眼3D_2260x2...")).toBeNull();
  });

  test("matches bare filename chips to full artifact paths", () => {
    expect(localFilePathMatchesTarget(
      "taiping-led-wall-6780x756.mp4",
      "/Users/me/Downloads/taiping-led-wall-6780x756.mp4",
    )).toBe(true);
    expect(localFilePathMatchesTarget(
      "taiping-led-wall-6780x756.mp4",
      "~/Desktop/wodeapp/taiping-led-wall-6780x756.mp4",
    )).toBe(true);
    expect(localFilePathMatchesTarget(
      "taiping-led-wall-6780x756.mp4",
      "/Users/me/Downloads/other.mp4",
    )).toBe(false);
  });

  test("prefers absolute artifact paths when resolving bare chips", () => {
    const best = pickBestLocalFilePathMatch("demo.mp4", [
      { value: "demo.mp4", confidence: 90 },
      { value: "outputs/demo.mp4", confidence: 80 },
      { value: "/Users/me/Downloads/demo.mp4", confidence: 70 },
    ]);
    expect(best?.value).toBe("/Users/me/Downloads/demo.mp4");
  });
});
