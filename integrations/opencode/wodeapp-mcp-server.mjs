#!/usr/bin/env node
/**
 * WodeApp 内置能力 MCP（本地 stdio，零依赖）
 *
 * opencode 以 `type:"local"` 方式 spawn 本脚本，给 agent 提供 wodeapp 原生工具。
 * 不需要单独起服务：工具直接调 wodeapp 云端 API（带用户 key），key/base 从环境变量读，
 * 由 OpenWork 引擎进程注入并被本子进程继承。
 *
 * 当前工具：
 *   - wodeapp_generate_image：生成商品主图/海报/素材图，返回图片 URL
 *
 * 环境变量：
 *   WODEAPP_AI_BASE   例如 https://wodeapp.cn/mainserver/api/ai/v1
 *   WODEAPP_RUNTIME_BASE 可选，例如 https://wodeapp.cn/runtime-server/api
 *   WODEAPP_API_KEY   用户的 wodeapp API Key
 *   WODEAPP_IMAGE_PATH   可选，默认 /images/generations
 *   WODEAPP_IMAGE_MODEL  可选，默认 openai/gpt-image-1（按你部署实际支持的图片模型调整）
 */
import readline from 'node:readline';

const AI_BASE = (process.env.WODEAPP_AI_BASE || '').replace(/\/+$/, '');
const RUNTIME_BASE = (process.env.WODEAPP_RUNTIME_BASE || deriveRuntimeBase(AI_BASE)).replace(/\/+$/, '');
const API_KEY = process.env.WODEAPP_API_KEY || '';
const IMAGE_PATH = process.env.WODEAPP_IMAGE_PATH || '/images/generations';
const IMAGE_MODEL = process.env.WODEAPP_IMAGE_MODEL || 'openai/gpt-image-1';

function deriveRuntimeBase(aiBase) {
  if (!aiBase) return '';
  try {
    const url = new URL(aiBase);
    return `${url.origin}/runtime-server/api`;
  } catch {
    return '';
  }
}

const TOOLS = [
  {
    name: 'wodeapp_generate_image',
    description:
      '用 WodeApp 生成图片（商品主图、海报、详情图、场景图、素材图等）。直接出图，返回图片 URL；不要用 HTML/CSS 代替。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '图片描述：主体、风格、场景、构图、光线、背景、用途等，尽量详细',
        },
        size: { type: 'string', description: '尺寸，如 1024x1024 / 1024x1536 / 1536x1024（可选）' },
        n: { type: 'number', description: '生成张数，默认 1（可选）' },
        imageUrl: { type: 'string', description: '参考图 URL（可选，用于图生图/参考图生成）' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图 URL 数组（可选，优先传聊天上传或数字资产里已有的 URL，不要要求用户重复上传）',
        },
      },
      required: ['prompt'],
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function collectReferenceImages(args) {
  const urls = [];
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) urls.push(trimmed);
  };
  push(args?.imageUrl);
  if (Array.isArray(args?.referenceImages)) {
    for (const url of args.referenceImages) push(url);
  }
  if (Array.isArray(args?.images)) {
    for (const item of args.images) push(typeof item === 'string' ? item : item?.url || item?.imageUrl);
  }
  return [...new Set(urls)];
}

function extractImageUrls(data) {
  if (Array.isArray(data?.data?.urls)) return data.data.urls.filter(Boolean);
  if (Array.isArray(data?.data?.images)) return data.data.images.map((d) => d?.url).filter(Boolean);
  if (data?.data?.url) return [data.data.url];
  if (Array.isArray(data?.urls)) return data.urls.filter(Boolean);
  if (data?.url) return [data.url];
  if (Array.isArray(data?.data)) {
    return data.data
      .map((d) => d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null))
      .filter(Boolean);
  }
  return [];
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY, Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`图片生成失败 HTTP ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 800);
  }
}

async function generateImage(args) {
  if (!AI_BASE && !RUNTIME_BASE) throw new Error('WODEAPP_AI_BASE/WODEAPP_RUNTIME_BASE 未配置（OpenWork 引擎未注入中转地址）');
  const refs = collectReferenceImages(args);
  if (refs.length && RUNTIME_BASE) {
    const data = await postJson(`${RUNTIME_BASE}/ai/image/generate`, {
      model: args?.model || IMAGE_MODEL,
      prompt: String(args?.prompt || '').trim(),
      n: Number(args?.n) > 0 ? Number(args.n) : 1,
      ...(args?.size ? { size: String(args.size) } : {}),
      imageUrl: refs.length === 1 ? refs[0] : refs,
    });
    const urls = extractImageUrls(data);
    if (urls.length) return `已基于参考图生成 ${urls.length} 张图片：\n${urls.join('\n')}`;
    return typeof data === 'string' ? data : JSON.stringify(data).slice(0, 800);
  }
  if (!AI_BASE) throw new Error('WODEAPP_AI_BASE 未配置，且当前请求没有可用的 runtime 参考图生成入口');

  const body = {
    model: IMAGE_MODEL,
    prompt: String(args?.prompt || '').trim(),
    n: Number(args?.n) > 0 ? Number(args.n) : 1,
  };
  if (args?.size) body.size = String(args.size);
  if (refs.length) body.imageUrl = refs.length === 1 ? refs[0] : refs;

  const data = await postJson(`${AI_BASE}${IMAGE_PATH}`, body);
  if (typeof data === 'string') return data;
  const urls = extractImageUrls(data);
  if (urls.length) return `已生成 ${urls.length} 张图片：\n${urls.join('\n')}`;
  return JSON.stringify(data).slice(0, 800);
}

async function handle(req) {
  const { id, method, params } = req || {};
  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'wodeapp', version: '1.0.0' },
          },
        };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        if (name !== 'wodeapp_generate_image') {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true } };
        }
        const out = await generateImage(args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: out }] } };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'notifications/initialized':
        return null; // 通知，无响应
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (err) {
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(err?.message || err) }], isError: true } };
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(req).then((resp) => {
    if (resp) send(resp);
  });
});
