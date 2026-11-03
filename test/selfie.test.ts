import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSelfiePrompt, installSelfieProxy } from '../adapter/selfie.ts';
import { RawBridge } from '../adapter/bridge.ts';
import { tempDir } from './helpers.ts';

// 1x1 PNG，足够让上游的文件头 sniff 认出 png。
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('自拍提示词去掉空镜约束，加入参考图身份约束', () => {
  const prompt = buildSelfiePrompt(
    '一张真实旅行照片：大理，黄昏的金色光线。天气晴。画面里没有人物，没有文字，没有水印。视角像路过的人随手举起手机拍的。胶片质感。',
    { subject: '大肥鱼', promptTemplate: '' },
  );
  assert.match(prompt, /自拍/);
  assert.match(prompt, /大肥鱼/);
  assert.match(prompt, /参考图/);
  assert.doesNotMatch(prompt, /没有人物/);
  assert.doesNotMatch(prompt, /路过的人/);
});

test('自拍代理把上游 text-to-image 换成带参考图的 edits，并返回上游格式', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/v1/images/edits') {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const api = `http://127.0.0.1:${address.port}/v1`;
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api,
    key: 'test-key',
    model: 'gpt-image-1',
    mode: 'edit',
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-image-1', prompt: '一张真实旅行照片：大理。画面里没有人物。' }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json() as { data: Array<{ b64_json?: string }> };
    assert.equal(payload.data[0]?.b64_json, PNG_B64);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0]!, /name="image"/);
    assert.match(bodies[0]!, /参考图/);
    assert.match(bodies[0]!, /大肥鱼/);
    assert.doesNotMatch(bodies[0]!, /没有人物/);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('native 模式把 data URL 放进万相 input.messages，并解析 output.choices 图片', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/api/v1/services/aigc/multimodal-generation/generation') {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          output: { choices: [{ message: { content: [{ image: 'https://example.test/out.png' }] } }] },
        }));
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const api = `http://127.0.0.1:${address.port}/compatible-mode/v1`;
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api,
    key: 'test-key',
    model: 'wan2.7-image',
    mode: 'native',
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ prompt: '一张真实旅行照片：大理。画面里没有人物。' }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json() as { data: Array<{ url?: string }> };
    assert.equal(payload.data[0]?.url, 'https://example.test/out.png');
    const sent = JSON.parse(bodies[0]!) as {
      input?: { messages?: Array<{ content?: Array<{ image?: string; text?: string }> }> };
      parameters?: { size?: string };
    };
    assert.equal(sent.parameters?.size, '1K');
    assert.match(sent.input?.messages?.[0]?.content?.[0]?.image ?? '', /^data:image\/png;base64,/);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('自拍开启但没有参考图时照片失败，不退回空镜', async () => {
  const restore = installSelfieProxy({
    enabled: true,
    references: [],
    api: 'http://127.0.0.1:1/v1',
    key: '',
    model: '',
    mode: 'edit',
    size: '',
    imageField: 'image_url',
    subject: '',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 502);
    const payload = await res.json() as { error?: { message?: string } };
    assert.match(payload.error?.message ?? '', /参考图/);
  } finally {
    restore();
  }
});

test('RawBridge 配置 selfieEnabled 后，上游 album.shoot 真的走参考图接口', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/v1/images/edits') {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const api = `http://127.0.0.1:${address.port}/v1`;
  const configPath = join(dir, 'engine-config.json');
  writeFileSync(configPath, JSON.stringify({
    engine: {
      imageApi: api,
      imageKey: 'test-key',
      imageModel: 'mock-model',
      selfieEnabled: true,
      selfieReference: [ref],
      selfieApi: api,
      selfieKey: 'test-key',
      selfieModel: 'mock-model',
      selfieMode: 'edit',
      selfieSubject: '大肥鱼',
      selfieSize: '1024x1024',
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
    assert.equal(bodies.length, 1);
    assert.match(bodies[0]!, /自拍/);
    assert.match(bodies[0]!, /参考图/);
    assert.ok(bridge.events.lastSeq >= 1);
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
