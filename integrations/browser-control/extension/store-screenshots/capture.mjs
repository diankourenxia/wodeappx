/**
 * Generate Chrome Web Store screenshots (1280×800 PNG, no alpha).
 *
 * Usage: node wodeappx/integrations/browser-control/extension/store-screenshots/capture.mjs
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const screenshotDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(screenshotDir, '..');
const outputDir = join(extensionDir, 'store-assets', 'screenshots');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SCREENS = [
  { demo: 'empty', file: '01-chat-sidepanel-1280x800.png' },
  { demo: 'summary', file: '02-page-summary-1280x800.png' },
  { demo: 'form', file: '03-form-assistant-1280x800.png' },
  { demo: 'result', file: '04-task-complete-1280x800.png' },
  { demo: 'settings', file: '05-connection-settings-1280x800.png' },
];

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const requested = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const relativePath = requested === '/' || requested === '/demo.html'
        ? 'store-screenshots/demo.html'
        : requested.replace(/^\/+/, '');
      const filePath = normalize(join(extensionDir, relativePath));
      if (!filePath.startsWith(extensionDir) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/demo.html` });
    });
  });
}

async function main() {
  if (!existsSync(chromePath)) throw new Error(`Google Chrome not found at ${chromePath}`);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const { server, url } = await startServer();

  try {
    for (const { demo, file } of SCREENS) {
      const outPath = join(outputDir, file);
      const profileDir = mkdtempSync(join(tmpdir(), 'wodeappx-store-shots-'));
      if (existsSync(outPath)) rmSync(outPath);
      await new Promise((resolve, reject) => {
        const child = spawn(chromePath, [
          '--headless=new',
          '--disable-background-networking',
          '--disable-component-update',
          '--hide-scrollbars',
          '--no-first-run',
          '--run-all-compositor-stages-before-draw',
          '--force-device-scale-factor=1',
          '--virtual-time-budget=1200',
          '--window-size=1280,800',
          `--user-data-dir=${profileDir}`,
          `--screenshot=${outPath}`,
          `${url}?demo=${demo}`,
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let captured = false;
        const poll = setInterval(() => {
          if (!captured && existsSync(outPath)) {
            captured = true;
            setTimeout(() => child.kill('SIGTERM'), 300);
          }
        }, 100);
        const timeout = setTimeout(() => child.kill('SIGTERM'), 15000);
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => {
          clearInterval(poll);
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          clearInterval(poll);
          clearTimeout(timeout);
          if (existsSync(outPath)) resolve();
          else reject(new Error(stderr || `Chrome exited with code ${code}`));
        });
      });
      rmSync(profileDir, { recursive: true, force: true });
      console.log(`Wrote ${outPath}`);
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
