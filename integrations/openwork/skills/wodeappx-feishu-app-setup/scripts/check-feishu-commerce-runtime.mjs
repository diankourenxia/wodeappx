#!/usr/bin/env node

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

const base = readArg('--base', 'http://127.0.0.1:4100/runtime-server/api').replace(/\/+$/, '');
const project = readArg('--project').trim();

async function request(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(`${path}: ${payload.error || `HTTP ${response.status}`}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request('/feishu-commerce/health');
assert(health.mode === 'demo' || health.mode === 'connected', 'health.mode 必须为 demo 或 connected');
assert(health.capabilities?.dashboard === true, '经营看板能力不可用');
assert(health.capabilities?.weeklyReport === true, '周报能力不可用');

const dashboard = await request('/feishu-commerce/dashboard');
assert(Array.isArray(dashboard.data?.metrics) && dashboard.data.metrics.length >= 4, '看板核心指标不足 4 个');
assert(Array.isArray(dashboard.data?.trend) && dashboard.data.trend.length >= 7, '看板趋势不足 7 天');
assert(Array.isArray(dashboard.data?.products) && dashboard.data.products.length > 0, '看板缺少商品数据');
assert(Array.isArray(dashboard.data?.anomalies) && dashboard.data.anomalies.length > 0, '看板缺少异常数据');

const weekly = await request('/feishu-commerce/reports/weekly', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ focus: 'runtime 接口验收' }),
});
assert(weekly.report?.summary, '周报缺少摘要');
assert(Array.isArray(weekly.report?.actions) && weekly.report.actions.length > 0, '周报缺少行动项');
assert(String(weekly.report?.markdown || '').includes('# '), '周报缺少 Markdown 标题');

let runtime = null;
if (project) {
  runtime = await request('/runtime/config', {
    headers: { 'x-subdomain-project': project },
  });
  const section = runtime.data?.pages?.[0]?.config?.sections?.[0];
  assert(runtime.data?.version >= 1, '项目尚未发布');
  assert(section?.type === 'FeishuCommerceWorkbench', '首页不是 FeishuCommerceWorkbench');
}

console.log(JSON.stringify({
  success: true,
  mode: health.mode,
  configured: health.configured,
  metrics: dashboard.data.metrics.length,
  trendDays: dashboard.data.trend.length,
  reportTitle: weekly.report.title,
  project: runtime ? {
    name: runtime.data.projectName,
    version: runtime.data.version,
    section: runtime.data.pages[0].config.sections[0].type,
  } : null,
}, null, 2));
