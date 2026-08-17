#!/usr/bin/env node
/**
 * 构建 web 版（浏览器直开，无 Electron）。
 * 产物与桌面版同源：先应用 wodeappx 品牌 + wodeapp-cloud 集成 patch，再 vite build。
 *
 * 用法:
 *   node scripts/build-web.mjs
 *
 * 环境变量（构建期注入，见 apps/app 的 openwork-deployment.ts / providers.tsx）:
 *   VITE_OPENWORK_URL     openwork-server 地址（必填，如 https://agentx.wodeapp.cn/api）
 *   VITE_OPENWORK_TOKEN   openwork-server bearer token（可选；不传则由用户在界面里填）
 *
 * 产物: vendor/openwork/apps/app/dist/
 *
 * 部署要求（web 版前提）:
 *   1. openwork-server 以 --cors <web 域名> 启动，宿主机 PATH 有 opencode
 *      （或传 --opencode-base-url），opencode 全局配置里已有 wodeapp provider
 *      （web 端 applyProvider 是 no-op，同步由部署侧负责）。
 *   2. 若 web 域名 ≠ wodeapp.cn 平台域名，mainserver 需对该域名放开 CORS
 *      （登录 / credits / mcp 探活都是浏览器直连平台 API）。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDir = path.join(root, "vendor/openwork/apps/app");
const distDir = path.join(appDir, "dist");

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    console.error(`失败: ${command} ${args.join(" ")} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

if (!process.env.VITE_OPENWORK_URL) {
  console.warn(
    "警告: 未设置 VITE_OPENWORK_URL，构建产物将不预置 openwork-server 地址，" +
      "用户需在界面里手动填写（Create remote workspace）。",
  );
}

// 1. 品牌 + 集成 patch（幂等）
run(process.execPath, [path.join(__dirname, "apply-openwork-integration.mjs")]);
run(process.execPath, [path.join(__dirname, "apply-wodeapp-cloud-integration.mjs")]);

// 2. vite build（web 部署模式）
run("pnpm", ["--dir", appDir, "build:web"], {
  env: { VITE_OPENWORK_DEPLOYMENT: "web" },
});

if (!existsSync(path.join(distDir, "index.html"))) {
  console.error(`构建产物缺失: ${distDir}/index.html`);
  process.exit(1);
}
console.log(`\nweb 构建完成: ${path.relative(root, distDir)}`);
console.log("部署: 静态托管 dist/（BrowserRouter 需要 history fallback → 全部路由回落 index.html）");
