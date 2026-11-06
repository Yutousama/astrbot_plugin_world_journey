import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { installPhotoProxy } from '../adapter/selfie.ts';
import { RawBridge } from '../adapter/bridge.ts';
import { tempDir } from './helpers.ts';

// 1x1 PNG，够让文件头 sniff 出 image/png。
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

test('第一个模型报错就换下一个，成功时把第二个模型的图交回上游', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      seen.push(body.model ?? '');
      if (body.model === 'first-model') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(jsonText({ error: { message: 'model not found' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(jsonText({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const proxy = installPhotoProxy(
    { models: ['first-model', 'second-model'], selfie: null },
    { info: () => {}, warn: () => {} },
  );
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonText({ model: 'first-model', prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json() as { data: Array<{ b64_json?: string }> };
    assert.equal(payload.data[0]?.b64_json, PNG_B64);
    assert.deepEqual(seen, ['first-model', 'second-model']);
  } finally {
    proxy.uninstall();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('所有模型都失败才把错误交回上游，错误里带每个模型的原因', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      seen.push(body.model ?? '');
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(jsonText({ error: { message: `no such model: ${body.model}` } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const proxy = installPhotoProxy(
    { models: ['m1', 'm2'], selfie: null },
    { info: () => {}, warn: () => {} },
  );
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonText({ model: 'm1', prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 502);
    const payload = await res.json() as { error?: { message?: string } };
    assert.match(payload.error?.message ?? '', /所有生图模型都失败了/);
    assert.match(payload.error?.message ?? '', /m1/);
    assert.match(payload.error?.message ?? '', /m2/);
    assert.deepEqual(seen, ['m1', 'm2']);
  } finally {
    proxy.uninstall();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('尺寸/字段不兼容的 400 不换模型，原样交给上游自己的重试阶梯', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      seen.push(body.model ?? '');
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(jsonText({ error: { message: 'invalid size: 1024x1024' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const proxy = installPhotoProxy(
    { models: ['m1', 'm2'], selfie: null },
    { info: () => {}, warn: () => {} },
  );
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonText({ model: 'm1', prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(seen, ['m1']);
  } finally {
    proxy.uninstall();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('没配模型列表（或只有一个）时完全不拦截', async () => {
  const before = globalThis.fetch;
  for (const models of [[], ['only-model']]) {
    const proxy = installPhotoProxy({ models, selfie: null }, { info: () => {}, warn: () => {} });
    try {
      assert.equal(globalThis.fetch, before);
    } finally {
      proxy.uninstall();
    }
  }
});

test('空镜套模板：没配降级列表也改写提示词，画风真的进去', async () => {
  const seen: Array<{ model?: string; prompt?: string }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; prompt?: string });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(jsonText({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const proxy = installPhotoProxy({
    models: [],
    selfie: null,
    scene: { enabled: true, promptTemplate: '画风：{style}\n{scene}\n时间：{time}（{clock}）。', style: '动漫画风' },
    clock: async () => '09:30',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonText({ model: 'only-model', prompt: '动漫画风：大理，上午的明亮日光。画面里没有人物。' }),
    });
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    // 模型还是上游选的那个，只有提示词被模板接管。
    assert.equal(seen[0]!.model, 'only-model');
    assert.match(seen[0]!.prompt!, /画风：动漫画风/);
    assert.match(seen[0]!.prompt!, /时间：上午（09:30）/);
    assert.match(seen[0]!.prompt!, /大理/);
    // 画风不重复：模板里说过一次，背景里不该再有。
    assert.equal(seen[0]!.prompt!.match(/动漫画风/g)?.length, 1);
  } finally {
    proxy.uninstall();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('空镜套模板关掉时完全不接管，上游原话直发', async () => {
  const before = globalThis.fetch;
  const proxy = installPhotoProxy({
    models: [],
    selfie: null,
    scene: { enabled: false, promptTemplate: '画风：{style}', style: '动漫画风' },
  }, { info: () => {}, warn: () => {} });
  try {
    assert.equal(globalThis.fetch, before);
  } finally {
    proxy.uninstall();
  }
});

test('RawBridge 关掉 imagePromptForScene 后，空镜不吃模板；开着才吃', async () => {
  for (const forScene of [true, false]) {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt?: string };
        seen.push(body.prompt ?? '');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(jsonText({ data: [{ b64_json: PNG_B64 }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const dir = tempDir();
    const configPath = join(dir, 'engine-config.json');
    writeFileSync(configPath, jsonText({
      engine: {
        homeCity: '长沙',
        imageApi: `http://127.0.0.1:${address.port}/v1`,
        imageKey: 'test-key',
        imageModel: 'mock-model',
        imageStyle: '动漫画风',
        imagePromptForScene: forScene,
      },
      wrapper: { offline: false },
    }), 'utf8');
    const bridge = new RawBridge({ dataDir: dir, configPath, now: () => new Date('2026-05-01T00:00:00.000Z') });
    try {
      await bridge.start();
      const ui = bridge.rawWorld.webUi() as unknown as {
        invoke: (panel: string, method: string, args: unknown[]) => Promise<unknown>;
      };
      const result = await ui.invoke('album', 'shoot', []) as { ok?: boolean; reason?: string };
      assert.equal(result.ok, true, result.reason);
      assert.equal(seen.length, 1);
      // 上游原话里没有「时间：」这一行 —— 它只可能来自套壳的模板。
      if (forScene) {
        assert.match(seen[0]!, /时间：/);
        assert.match(seen[0]!, /动漫画风/);
      } else {
        assert.doesNotMatch(seen[0]!, /时间：/);
        assert.match(seen[0]!, /^动漫画风：/);
      }
    } finally {
      await bridge.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test('RawBridge 从 imageModels 读列表，上游 album.shoot 真的自动降级', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      seen.push(body.model ?? '');
      if (body.model === 'bad-model') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(jsonText({ error: { message: 'model offline' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(jsonText({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const dir = tempDir();
  const configPath = join(dir, 'engine-config.json');
  writeFileSync(configPath, jsonText({
    engine: {
      imageApi: `http://127.0.0.1:${address.port}/v1`,
      imageKey: 'test-key',
      imageModel: 'bad-model',
      imageModels: ['bad-model', 'good-model'],
    },
    wrapper: { offline: false },
  }), 'utf8');
  const bridge = new RawBridge({ dataDir: dir, configPath, now: () => new Date('2026-05-01T00:00:00.000Z') });
  try {
    await bridge.start();
    const ui = bridge.rawWorld.webUi() as unknown as {
      invoke: (panel: string, method: string, args: unknown[]) => Promise<unknown>;
    };
    const result = await ui.invoke('album', 'shoot', []) as { ok?: boolean; reason?: string };
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(seen, ['bad-model', 'good-model']);
    assert.ok(bridge.events.lastSeq >= 1);
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
