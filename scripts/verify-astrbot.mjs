#!/usr/bin/env node
/**
 * AstrBot 冒烟检查。Key 只从环境变量读，不写盘、不打印。
 *
 *   ASTRBOT_BASE=http://127.0.0.1:6185
 *   ASTRBOT_API_KEY=abk_...
 *   npm run verify:astrbot
 */
const base = (process.env.ASTRBOT_BASE || 'http://127.0.0.1:6185').replace(/\/+$/, '');
const key = process.env.ASTRBOT_API_KEY || '';
if (!key) {
  console.error('缺少 ASTRBOT_API_KEY（只从环境变量读）。');
  process.exit(2);
}
const headers = { authorization: `Bearer ${key}` };
const pluginId = 'astrbot_plugin_world_journey';

async function get(path) {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.text() };
}

async function postJson(path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}

const plugins = await get('/api/v1/plugins');
if (plugins.status !== 200) {
  console.error(`[verify] /api/v1/plugins HTTP ${plugins.status}: ${plugins.body.slice(0, 200)}`);
  process.exit(1);
}
const list = JSON.parse(plugins.body).data || [];
const plugin = list.find((p) => p.root_dir_name === pluginId || p.name === pluginId);
if (!plugin) {
  console.error(`[verify] 插件未加载：${pluginId}`);
  process.exit(1);
}
console.log(`[verify] 插件已加载：${plugin.name} ${plugin.version} activated=${plugin.activated}`);

const reload = await postJson('/api/v1/plugins/reload', { plugin_id: pluginId });
console.log(`[verify] 重载：HTTP ${reload.status}`);
if (reload.status !== 200) console.log(reload.body.slice(0, 300));

const tools = await get('/api/v1/tools');
if (tools.status === 200) {
  const names = (JSON.parse(tools.body).data || []).map((t) => t.name);
  const journey = names.filter((n) => n.startsWith('journey_'));
  console.log(`[verify] journey 工具：${journey.join('、') || '（无）'}`);
} else {
  console.log(`[verify] /api/v1/tools 不可用（HTTP ${tools.status}），跳过；可在 WebUI 插件页确认工具。`);
}

const chat = await postJson('/api/v1/chat', { username: 'journey_verify', message: '/journey' });
console.log(`[verify] /journey：HTTP ${chat.status}`);
if (chat.status === 200) {
  const plain = [...chat.body.matchAll(/"type": "plain", "data": "((?:[^"\\]|\\.)*)"/g)]
    .map((m) => JSON.parse(`"${m[1]}"`))
    .filter(Boolean);
  console.log(plain[0] ? `[verify] 回复：${plain[0].slice(0, 160)}` : '[verify] 没有 plain 回复（可能被文转图了）。');
} else {
  console.log(chat.body.slice(0, 300));
}
