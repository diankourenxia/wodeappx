import assert from "node:assert/strict";
import test from "node:test";

import {
  joinPublicAssetUrl,
  rewriteUpdaterYml,
  updaterYmlVersion,
} from "./rewrite-updater-yml.mjs";

const SAMPLE = `version: 1.0.0
files:
  - url: wodeappx-win-x64-1.0.0.exe
    sha512: abc
    size: 198480619
  - url: wodeappx-win-x64-1.0.0.exe.blockmap
    sha512: def
    size: 123
path: wodeappx-win-x64-1.0.0.exe
sha512: abc
releaseDate: '2026-08-17T06:43:51.307Z'
`;

test("joins relative updater assets onto the public download base", () => {
  const out = rewriteUpdaterYml(SAMPLE, {
    publicBase: "https://wodeapp.cn/downloads/wodeappx/",
  });
  assert.match(out, /url: https:\/\/wodeapp\.cn\/downloads\/wodeappx\/wodeappx-win-x64-1\.0\.0\.exe$/m);
  assert.match(out, /url: https:\/\/wodeapp\.cn\/downloads\/wodeappx\/wodeappx-win-x64-1\.0\.0\.exe\.blockmap$/m);
  assert.match(out, /path: https:\/\/wodeapp\.cn\/downloads\/wodeappx\/wodeappx-win-x64-1\.0\.0\.exe$/m);
  assert.equal(updaterYmlVersion(out), "1.0.0");
});

test("leaves already-absolute urls alone", () => {
  const raw = "version: 1.0.1\npath: https://example.com/a.exe\n";
  assert.equal(
    rewriteUpdaterYml(raw, { publicBase: "https://wodeapp.cn/downloads/wodeappx" }),
    raw,
  );
  assert.equal(joinPublicAssetUrl("https://cdn.example/x", "https://other/a.exe"), "https://other/a.exe");
});
