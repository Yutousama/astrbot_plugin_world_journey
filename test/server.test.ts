import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../adapter/server.ts';
import { readJson } from '../scripts/lib/upstream.mjs';
import { makeBridge, tempDir } from './helpers.ts';

const LOCK_VERSION = (readJson(join(process.cwd(), 'upstream.lock.json')) as { version?: string }).version;

test('sidecar：鉴权、状态、工具、提示词、事件、动作、媒体、心跳', async () => {
  const dir = tempDir();
  const bridge = makeBridge(dir);
  await bridge.start();
  const server = await startServer({
    bridge,
    token: 'test-token',
    port: 0,
    announce: false,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: 'Bearer test-token' };
  const getJson = async (path: string, h: Record<string, string> = headers) => {
    const r = await fetch(base + path, { headers: h });
    return { status: r.status, body: await r.json() as any };
  };
  const postJson = async (path: string, body: unknown = {}) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() as any };
  };

  try {
    const unauth = await getJson('/api/health', {});
    assert.equal(unauth.status, 401);

    const health = await getJson('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.upstreamVersion, LOCK_VERSION);
    assert.ok(health.body.eventLogId);

    const status = await getJson('/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.mode, 'home');
    assert.equal(status.body.place.name, '兰州');
    assert.ok(status.body.now.includes('兰州'));

    const prompt = await fetch(base + '/api/prompt', { headers });
    assert.equal(prompt.status, 200);
    assert.equal((await prompt.text()).includes('{{'), false);

    const tools = await getJson('/api/tools');
    const names = (tools.body.tools as { name: string }[]).map((t) => t.name);
    assert.ok(names.includes('journey_now'));
    assert.ok(names.includes('journey_stats'));

    const tool = await postJson('/api/tools/journey_now');
    assert.equal(tool.status, 200);
    assert.ok(tool.body.text.includes('兰州'));

    const depart = await postJson('/api/depart');
    assert.equal(depart.status, 200);
    assert.equal(depart.body.ok, true);
    const events = await getJson('/api/events?after=0');
    assert.ok(events.body.events.some((e: { type: string }) => e.type === 'journey.depart'));

    const sync = await postJson('/api/sync');
    assert.equal(sync.status, 200);
    assert.equal(sync.body.ok, true);

    const photo = await postJson('/api/photo');
    assert.equal(photo.status, 409);
    assert.equal(photo.body.ok, false);

    const heartbeat = await postJson('/api/heartbeat');
    assert.equal(heartbeat.status, 200);

    const media = await fetch(base + '/media/..%2Fstate.json', { headers });
    assert.equal(media.status, 404);

    const notFound = await getJson('/api/nope');
    assert.equal(notFound.status, 404);
  } finally {
    await server.close();
    await bridge.stop();
  }
});

test('sidecar 拒绝非法 JSON 请求体', async () => {
  const dir = tempDir();
  const bridge = makeBridge(dir);
  await bridge.start();
  const server = await startServer({ bridge, token: 't', port: 0, announce: false });
  try {
    const r = await fetch(`http://127.0.0.1:${server.port}/api/tools/journey_now`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(r.status, 500);
  } finally {
    await server.close();
    await bridge.stop();
  }
});
