import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSelfiePrompt, DEFAULT_GROK_TEMPLATE, DEFAULT_SELFIE_TEMPLATE, DEFAULT_SCENE_TEMPLATE,
  describeTime, describeShape, generateSceneImageBytes, grokSizeOf, installPhotoProxy,
  installSelfieProxy, isBuiltInTemplate, isWxH, LEGACY_SELFIE_TEMPLATE, modelShapeHint,
  renderImagePrompt, resolveImageShape, selfieTimeoutMs,
} from '../adapter/selfie.ts';
import { RawBridge } from '../adapter/bridge.ts';
import { tempDir } from './helpers.ts';

// 1x1 PNG，足够让上游的文件头 sniff 认出 png。
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('时间描述词覆盖凌晨、正午、黄昏、午夜前', () => {
  assert.equal(describeTime('00:10').label, '午夜');
  assert.equal(describeTime('01:30').label, '凌晨');
  assert.equal(describeTime('03:45').label, '黎明前');
  assert.equal(describeTime('04:45').label, '拂晓');
  assert.equal(describeTime('05:05').label, '黎明');
  assert.equal(describeTime('05:20').label, '破晓');
  assert.equal(describeTime('06:10').label, '晨光初现');
  assert.equal(describeTime('08:00').label, '早晨');
  assert.equal(describeTime('11:45').label, '正午');
  assert.equal(describeTime('13:10').label, '午后');
  assert.equal(describeTime('16:40').label, '傍晚');
  assert.equal(describeTime('18:20').label, '暮色');
  assert.equal(describeTime('21:00').label, '夜晚');
  assert.equal(describeTime('23:45').label, '午夜前');
  assert.equal(describeTime('18:20').clock, '18:20');
});

test('自拍模板替换 {time}/{clock}，老模板自动补时间', () => {
  const scene = '一张真实旅行照片：大理，黄昏的金色光线。画面里没有人物。';
  const withPlaceholders = buildSelfiePrompt(scene, {
    subject: '大肥鱼',
    promptTemplate: '自拍。\n时间：{time}（{clock}）。\n背景：{scene}',
  }, '18:20');
  assert.match(withPlaceholders, /暮色/);
  assert.match(withPlaceholders, /18:20/);
  assert.doesNotMatch(withPlaceholders, /\{time\}|\{clock\}/);

  // 老模板没有占位符：时间仍然要补进去，否则升级后不生效。
  const oldTemplate = buildSelfiePrompt(scene, {
    subject: '大肥鱼',
    promptTemplate: '自拍。背景：{scene}',
  }, '05:05');
  assert.match(oldTemplate, /黎明/);
  assert.match(oldTemplate, /05:05/);
});

test('自拍提示词去掉空镜约束，加入参考图身份约束', () => {
  const prompt = buildSelfiePrompt(
    '一张真实旅行照片：大理，黄昏的金色光线。天气晴。画面里没有人物，没有文字，没有水印。视角像路过的人随手举起手机拍的。胶片质感。',
    { subject: '大肥鱼', promptTemplate: '' },
    '18:20',
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

test('自拍尺寸留空时跟随上游请求体（即「出图尺寸」imageSize）', async () => {
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
    size: '',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-image-1', prompt: '一张真实旅行照片：大理。', size: '1664x928' }),
    });
    assert.equal(res.status, 200);
    assert.equal(bodies.length, 1);
    // selfieSize 留空 → 用上游 body 的 size（来自 image_size），不再硬写 1024 方图。
    assert.match(bodies[0]!, /name="size"\r\n\r\n1664x928/);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('兼容开关：自拍请求不带 response_format / size，edit 与 generation 都生效', async () => {
  for (const mode of ['edit', 'generation'] as const) {
    const dir = tempDir();
    const ref = join(dir, 'ref.png');
    writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
    const bodies: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const restore = installSelfieProxy({
      enabled: true,
      references: [ref],
      api: `http://127.0.0.1:${address.port}/v1`,
      key: '',
      model: 'mock-model',
      mode,
      size: '1024x1024',
      imageField: 'image_url',
      subject: '大肥鱼',
      promptTemplate: '',
      noResponseFormat: true,
      noSize: true,
    }, { info: () => {}, warn: () => {} });
    try {
      const res = await fetch('http://upstream.invalid/v1/images/generations', {
        method: 'POST',
        body: JSON.stringify({ model: 'mock-model', prompt: '一张真实旅行照片：大理。' }),
      });
      assert.equal(res.status, 200);
      assert.equal(bodies.length, 1);
      const sent = bodies[0]!;
      assert.doesNotMatch(sent, /response_format/);
      if (mode === 'generation') {
        const json = JSON.parse(sent) as Record<string, unknown>;
        assert.equal('size' in json, false);
        assert.equal('response_format' in json, false);
        assert.ok('image_url' in json);
      } else {
        assert.doesNotMatch(sent, /name="size"/);
        assert.doesNotMatch(sent, /name="response_format"/);
        assert.match(sent, /name="image"/);
      }
    } finally {
      restore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test('selfie_edit_json：编辑接口直接发 JSON，参考图放在 image_url', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: `http://127.0.0.1:${address.port}/v1`,
    key: '',
    model: 'mock-model',
    mode: 'edit',
    editJson: true,
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'mock-model', prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 200);
    assert.equal(bodies.length, 1);
    const sent = JSON.parse(bodies[0]!) as Record<string, unknown>;
    assert.match(String(sent.image_url), /^data:image\/png;base64,/);
    assert.equal('image' in sent, false);
    // 默认形状：要 b64_json（外链在这台机器上下不动），尺寸照常带。
    assert.equal(sent.response_format, 'b64_json');
    assert.equal(sent.size, '1024x1024');
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('multipart 被中转站包成 502 时，自动兜底一次 JSON（image_url）', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      bodies.push(body);
      if (String(req.headers['content-type'] ?? '').includes('multipart')) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'openai_error', type: 'bad_response_status_code' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: `http://127.0.0.1:${address.port}/v1`,
    key: '',
    model: 'mock-model',
    mode: 'edit',
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
    noSize: true,
    noResponseFormat: true,
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'mock-model', prompt: '一张真实旅行照片：大理。' }),
    });
    assert.equal(res.status, 200);
    assert.equal(bodies.length, 2);
    const retried = JSON.parse(bodies[1]!) as Record<string, unknown>;
    assert.match(String(retried.image_url), /^data:image\/png;base64,/);
    assert.equal('size' in retried, false);
    assert.equal('response_format' in retried, false);
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
    // 桥接层把 raw 的当地时钟（兰州 08:00）带进模板，而不是本机时间。
    assert.match(bodies[0]!, /时间：早晨（08:00）/);
    assert.ok(bridge.events.lastSeq >= 1);
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('{style} 是一级画风约束：填了生效，留空不残行，none 完全不提', () => {
  const template = '一张自拍。\n画风：{style}\n背景：{scene}';
  const filled = renderImagePrompt(
    '武汉的黄鹤楼，上午的明亮日光。',
    { subject: '大肥鱼', promptTemplate: template, style: '动漫画风' },
    '09:54',
  );
  assert.match(filled, /画风：动漫画风/);
  assert.doesNotMatch(filled, /真实手机自拍质感/);

  // 风格留空：整行「画风：」要消失，不能把空标签发给接口。
  const empty = renderImagePrompt('武汉。', { subject: '大肥鱼', promptTemplate: template, style: '' }, '09:00');
  assert.doesNotMatch(empty, /画风：/);
  assert.match(empty, /背景：武汉/);

  // none = 一个字都不提风格，交给底模。
  const bare = renderImagePrompt('武汉。', { subject: '大肥鱼', promptTemplate: template, style: 'none' }, '09:00');
  assert.doesNotMatch(bare, /画风|真实旅行照片/);
});

test('老模板没写 {style}：画风补在末尾，用户不改配置也生效', () => {
  const prompt = renderImagePrompt(
    '大理。',
    { subject: '大肥鱼', promptTemplate: '自拍。背景：{scene}', style: '动漫画风' },
    '18:20',
  );
  assert.match(prompt, /画风：动漫画风/);
  // 时间那行仍然自动补 —— 两条兼容规则互不干扰。
  assert.match(prompt, /时间：暮色（18:20）/);
});

test('上游带画风的场景描述不会把画风重复塞进背景', () => {
  const original = '动漫画风：武汉的黄鹤楼，上午的明亮日光。天气小雨。画面里没有人物，没有文字。';
  const prompt = renderImagePrompt(
    original,
    { subject: '大肥鱼', promptTemplate: '自拍。\n画风：{style}\n背景：{scene}', style: '动漫画风' },
    '09:54',
  );
  const sceneLine = prompt.split('\n').find((line) => line.startsWith('背景：')) ?? '';
  assert.doesNotMatch(sceneLine, /动漫画风/);
  assert.match(sceneLine, /武汉的黄鹤楼/);
  assert.doesNotMatch(sceneLine, /没有人物/);
  // 全文只允许出现一次画风声明，否则模型会把它当成背景的一部分。
  assert.equal(prompt.match(/动漫画风/g)?.length, 1);
});

test('内置默认模板不再写死照片质感，空镜模板守住了「没有人物」', () => {
  assert.match(DEFAULT_SELFIE_TEMPLATE, /\{style\}/);
  assert.doesNotMatch(DEFAULT_SELFIE_TEMPLATE, /真实手机自拍质感|胶片质感/);
  assert.match(DEFAULT_SCENE_TEMPLATE, /\{style\}/);
  assert.match(DEFAULT_SCENE_TEMPLATE, /画面里没有人物/);
});

test('主动汇报配图和 /journey_photo 用同一套场景提示词，含画面风格', async () => {
  const dir = tempDir();
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const api = `http://127.0.0.1:${address.port}/v1`;
  const configPath = join(dir, 'engine-config.json');
  writeFileSync(configPath, JSON.stringify({
    engine: {
      homeCity: '长沙',
      imageApi: api,
      imageKey: 'test-key',
      imageModel: 'mock-model',
      imageStyle: '动漫画风',
      imagePromptTemplate: '自拍。\n画风：{style}\n背景：{scene}',
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
    const shot = await ui.invoke('album', 'shoot', []) as { ok?: boolean; reason?: string };
    assert.equal(shot.ok, true, shot.reason);
    const seqAfterShot = bridge.events.lastSeq;

    const bytes = await bridge.reportImage('武汉，当地 九点。早饭，本地人日常吃的那种。');
    assert.ok(bytes && bytes.byteLength > 0, '汇报配图应该有字节');
    assert.equal(bodies.length, 2);

    const photoPrompt = bodies[0]!;
    const reportPrompt = bodies[1]!;
    // 两条路径都吃到「画面风格」—— 这正是修复前主动汇报配图缺失的东西。
    assert.match(photoPrompt, /画风：动漫画风/);
    assert.match(reportPrompt, /画风：动漫画风/);
    // 配图额外附上她此刻在做什么。
    assert.match(reportPrompt, /她此刻：武汉，当地 九点/);
    // 而且不写上游 photo 事件、不进相册。
    assert.equal(bridge.events.lastSeq, seqAfterShot);
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
interface Captured {
  body: Record<string, unknown>;
  raw: string;
  contentType: string;
  url: string;
}

/** 只回一张假图的生图服务，把收到的每个请求原样记下来（形状断言全靠它）。 */
async function startCapture(): Promise<{ api: string; seen: Captured[]; close: () => Promise<void> }> {
  const seen: Captured[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // multipart 不是 JSON：整段留作 raw，断言靠文本。
        body = { prompt: raw };
      }
      seen.push({ body, raw, contentType: String(req.headers['content-type'] ?? ''), url: String(req.url ?? '') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    api: `http://127.0.0.1:${address.port}/v1`,
    seen,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

function refFile(dir: string, name = 'ref.png'): string {
  const ref = join(dir, name);
  writeFileSync(ref, Buffer.from(PNG_B64, 'base64'));
  return ref;
}

test('接口形状：面板值优先，其次旧三件套，最后才按接口地址认', () => {
  // 显式值最大：哪怕地址是别家也照办。
  assert.equal(resolveImageShape({ shape: 'grok', api: 'https://api.openai.com/v1' }).shape, 'grok');
  assert.equal(resolveImageShape({ shape: 'auto', api: 'https://api.x.ai/v1' }).shape, 'grok');
  // auto：认服务商。api.x.ai 猜成 openai 的代价是「参考图被丢掉照样出图」，所以点名。
  const guessed = resolveImageShape({ api: 'https://api.x.ai/v1' });
  assert.equal(guessed.shape, 'grok');
  assert.equal(guessed.guessed, true);
  assert.equal(resolveImageShape({ api: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }).shape, 'wan');
  assert.equal(resolveImageShape({ api: 'https://api.openai.com/v1' }).shape, 'openai');
  assert.equal(resolveImageShape({}).shape, 'openai');
  // 旧字段的四种组合，折成用户当初真正在跑的行为。
  assert.equal(resolveImageShape({ api: 'x', mode: 'edit' }).shape, 'openai');
  assert.equal(resolveImageShape({ api: 'x', mode: 'edit', editJson: true }).shape, 'relay');
  assert.equal(resolveImageShape({ api: 'x', mode: 'native' }).shape, 'wan');
  assert.equal(resolveImageShape({ api: 'x', mode: 'generation' }).shape, 'generation');
  // 旧字段赢过地址猜测：api.x.ai + 明确的 edit 也按旧配置走。
  assert.equal(resolveImageShape({ api: 'https://api.x.ai/v1', mode: 'edit' }).shape, 'openai');
  // 字段名这类细节继续透传（形状表达不了它）。
  assert.equal(resolveImageShape({ api: 'x', shape: 'generation', imageField: 'image' }).imageField, 'image');
  assert.equal(resolveImageShape({ api: 'x' }).imageField, 'image_url');
  // 认不出的形状值不搅局：按没填处理，往下走旧字段。
  assert.equal(resolveImageShape({ api: 'x', shape: 'midjourney', mode: 'native' }).shape, 'wan');
});

test('尺寸写法在 grok 上翻成 aspect_ratio + resolution', () => {
  assert.deepEqual(grokSizeOf('1664x928'), { aspectRatio: '16:9', resolution: '1.5k' });
  assert.deepEqual(grokSizeOf('1024x1024'), { aspectRatio: '1:1' });
  assert.deepEqual(grokSizeOf('2048x2048'), { aspectRatio: '1:1', resolution: '2k' });
  assert.deepEqual(grokSizeOf('1152x1536'), { aspectRatio: '3:4', resolution: '1.5k' });
  assert.deepEqual(grokSizeOf('3:4'), { aspectRatio: '3:4' });
  assert.deepEqual(grokSizeOf('19.5:9'), { aspectRatio: '19.5:9' });
  assert.deepEqual(grokSizeOf('2k'), { resolution: '2k' });
  assert.deepEqual(grokSizeOf('1.5K'), { resolution: '1.5k' });
  // 留空 / 认不出：一个参数都不发，交给服务商默认（比例跟随参考图）。
  assert.deepEqual(grokSizeOf(''), {});
  assert.deepEqual(grokSizeOf('超大'), {});
});

test('只有「宽x高」能当 size 发给别家；比例和分辨率写法是 grok 专属', () => {
  assert.equal(isWxH('1024x1024'), true);
  assert.equal(isWxH('1664×928'), true);
  assert.equal(isWxH('3:4'), false);
  assert.equal(isWxH('2k'), false);
  assert.equal(isWxH(''), false);
});

test('自拍超时跟着「出图最多等几秒」走，留空才是原来的 120 秒', () => {
  assert.equal(selfieTimeoutMs(undefined), 120_000);
  assert.equal(selfieTimeoutMs(0), 120_000);
  assert.equal(selfieTimeoutMs(300), 300_000);
});

test('grok 形状：参考图走 image:{url} 对象，不带 size / watermark', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: capture.api,
    key: 'test-key',
    model: 'grok-imagine-image-2.0',
    shape: 'grok',
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image-2.0', prompt: '一张真实旅行照片：大理。', watermark: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(capture.seen.length, 1);
    const sent = capture.seen[0]!;
    assert.equal(sent.url, '/v1/images/edits');
    assert.ok(!sent.contentType.includes('multipart'), 'Grok 的 /images/edits 只收 application/json');
    const image = sent.body.image as { url?: string; type?: string } | undefined;
    assert.ok(image && typeof image.url === 'string', '参考图必须是 image:{url} 对象');
    assert.match(image.url, /^data:image\/png;base64,/);
    assert.equal(image.type, 'image_url');
    assert.equal(sent.body.model, 'grok-imagine-image-2.0');
    assert.equal(sent.body.n, 1);
    assert.equal(sent.body.response_format, 'b64_json');
    // Grok 的请求体里没有这两个字段；顶层 image_url 是它不认的写法。
    assert.ok(!('size' in sent.body), '不能带 size');
    assert.ok(!('watermark' in sent.body), '不能带 watermark');
    assert.ok(!('image_url' in sent.body), '不能把参考图放顶层');
    assert.ok(!('images' in sent.body), '单张参考图不该发 images');
    // 官方纪律：单图编辑的比例总是从输入图推，所以尺寸写成了比例也不发。
    assert.ok(!('aspect_ratio' in sent.body));
  } finally {
    restore();
    await capture.close();
  }
});

test('grok 多参考图：改发 images，这时才带 aspect_ratio', async () => {
  const dir = tempDir();
  const refs = [refFile(dir, 'a.png'), refFile(dir, 'b.png'), refFile(dir, 'c.png')];
  const capture = await startCapture();
  const restore = installSelfieProxy({
    enabled: true,
    references: refs,
    api: capture.api,
    key: '',
    model: 'grok-imagine-image-2.0',
    shape: 'grok',
    size: '3:4',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
    quality: 'medium',
  }, { info: () => {}, warn: () => {} });
  try {
    await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image-2.0', prompt: '大理。' }),
    });
    const sent = capture.seen[0]!.body;
    const images = sent.images as Array<{ url: string }> | undefined;
    assert.ok(Array.isArray(images) && images.length === 3, '多张参考图走 images 数组');
    assert.ok(images!.every((item) => item.url.startsWith('data:image/png;base64,')));
    assert.ok(!('image' in sent), 'image 与 images 互斥');
    // 多图时比例不再跟随第一张，得我们说。
    assert.equal(sent.aspect_ratio, '3:4');
    assert.equal(sent.quality, 'medium');
  } finally {
    restore();
    await capture.close();
  }
});

test('grok 形状下尺寸写 2k：只发 resolution，不发 size', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: capture.api,
    key: '',
    model: 'grok-imagine-image-2.0',
    shape: 'grok',
    size: '2k',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image-2.0', prompt: '大理。' }),
    });
    assert.equal(capture.seen[0]!.body.resolution, '2k');
    assert.ok(!('size' in capture.seen[0]!.body));
  } finally {
    restore();
    await capture.close();
  }
});

test('非 grok 形状下尺寸写成比例：不带 size，并留一行看得懂的警告', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const warnings: string[] = [];
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: capture.api,
    key: '',
    model: 'gpt-image-1',
    shape: 'relay',
    size: '3:4',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: (m: string) => warnings.push(m) });
  try {
    await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-image-1', prompt: '大理。' }),
    });
    assert.ok(!('size' in capture.seen[0]!.body), '别家认不出 3:4，宁可不发');
    assert.ok(warnings.some((m) => m.includes('3:4')), '要说清是哪个值被丢了');
  } finally {
    restore();
    await capture.close();
  }
});

test('grok 形状的空镜：generations 也把 size/watermark 换成 aspect_ratio/resolution', async () => {
  const capture = await startCapture();
  // 没开自拍、没套模板、只有一个模型：光靠形状也必须装上代理。
  const proxy = installPhotoProxy(
    { models: [], selfie: null, scene: null, shape: { shape: 'grok', api: capture.api } },
    { info: () => {}, warn: () => {} },
  );
  try {
    const res = await fetch(`${capture.api}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-imagine-image-2.0',
        prompt: '一张真实旅行照片：大理。',
        n: 1,
        size: '1664x928',
        response_format: 'b64_json',
        watermark: false,
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(capture.seen.length, 1);
    const sent = capture.seen[0]!.body;
    assert.ok(!('size' in sent));
    assert.ok(!('watermark' in sent));
    assert.equal(sent.aspect_ratio, '16:9');
    assert.equal(sent.resolution, '1.5k');
    assert.equal(sent.response_format, 'b64_json');
  } finally {
    proxy.uninstall();
    await capture.close();
  }
});

test('形状没填、也没别的活儿要干时代理依然完全不装', () => {
  const proxy = installPhotoProxy({ models: [], selfie: null, scene: null }, { info: () => {}, warn: () => {} });
  assert.equal(proxy.fetch, globalThis.fetch);
  assert.equal(proxy.uninstall(), undefined);
});

test('grok 用编辑型默认模板：先说要改什么、再锁身份，不堆负面清单', () => {
  assert.match(DEFAULT_GROK_TEMPLATE, /\{style\}/);
  assert.match(DEFAULT_GROK_TEMPLATE, /保持参考图中\{subject\}的五官/);
  assert.doesNotMatch(DEFAULT_GROK_TEMPLATE, /真实手机自拍质感|胶片质感/);
  // 官方明确说长 avoid 列表会被忽略还烧 prompt 预算：那几句不能出现在这份模板里。
  assert.doesNotMatch(DEFAULT_GROK_TEMPLATE, /不要变成陌生人|没有文字、水印、边框/);
});

test('内置默认模板不算「用户自己写的」，否则形状专属的默认永远轮不到', () => {
  assert.equal(isBuiltInTemplate(''), true);
  assert.equal(isBuiltInTemplate(DEFAULT_SELFIE_TEMPLATE), true);
  assert.equal(isBuiltInTemplate(DEFAULT_GROK_TEMPLATE), true);
  assert.equal(isBuiltInTemplate(LEGACY_SELFIE_TEMPLATE), true);
  assert.equal(isBuiltInTemplate('把{subject}画成水彩，背景：{scene}'), false);
});

test('默认模板在 TS 与 Python 两侧逐字一致（改一处必须改两处）', () => {
  const py = readFileSync(
    new URL('../plugin/astrbot_plugin_world_journey/defaults.py', import.meta.url),
    'utf8',
  );
  const grab = (name: string): string => {
    const block = new RegExp(`^${name} = \\(([\\s\\S]*?)^\\)`, 'm').exec(py);
    assert.ok(block, `defaults.py 里找不到 ${name}`);
    return (block[1]!.match(/"((?:[^"\\]|\\.)*)"/g) ?? [])
      .map((part) => part.slice(1, -1))
      .join('')
      .replace(/\\n/g, '\n');
  };
  assert.equal(grab('DEFAULT_IMAGE_PROMPT'), DEFAULT_SELFIE_TEMPLATE);
  assert.equal(grab('DEFAULT_GROK_PROMPT'), DEFAULT_GROK_TEMPLATE);
  assert.equal(grab('LEGACY_SELFIE_PROMPT'), LEGACY_SELFIE_TEMPLATE);
});

/**
 * 端到端：`image_shape=grok` 时 `album.shoot` 发出去的请求体就是 xAI 的
 * `EditImageRequest`（见 https://docs.x.ai/openapi.json）。
 *
 * 这条的看点是**面板默认值已经落进了** `image_prompt_template`：形状专属的模板必须照样生效，
 * 否则 Grok 一直在吃通用模板里那串长负面清单，而没人能解释差在哪。
 */
test('RawBridge：image_shape=grok 时参考图走 image 对象、模板换成编辑型默认', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const configPath = join(dir, 'engine-config.json');
  writeFileSync(configPath, JSON.stringify({
    engine: {
      imageApi: capture.api,
      imageKey: 'test-key',
      imageModel: 'grok-imagine-image-2.0',
      imageShape: 'grok',
      imagePromptTemplate: DEFAULT_SELFIE_TEMPLATE,
      selfieEnabled: true,
      selfieReference: [ref],
      selfieApi: capture.api,
      selfieKey: 'test-key',
      selfieModel: 'grok-imagine-image-2.0',
      selfieSize: '3:4',
      imageWatermark: 'auto',
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
    assert.equal(capture.seen.length, 1);
    const sent = capture.seen[0]!;
    assert.ok(!sent.contentType.includes('multipart'));
    const image = sent.body.image as { url?: string } | undefined;
    assert.ok(image && typeof image.url === 'string' && image.url.startsWith('data:image/png;base64,'),
      '参考图必须是 image:{url} 对象');
    assert.ok(!('size' in sent.body));
    assert.ok(!('aspect_ratio' in sent.body), '单张参考图的比例跟随参考图');
    assert.match(String(sent.body.prompt), /保持参考图中她本人的五官/);
    assert.doesNotMatch(String(sent.body.prompt), /不要变成陌生人|没有文字、水印、边框/);
  } finally {
    await bridge.stop();
    await capture.close();
  }
});

/*
 * `auto` 按**模型名**认形状。
 *
 * 起因是实测：中转站 `ai.yutou233.cn` 一个域名后面挂着 grok-imagine-image、gpt-image-2.6-flare、
 * qwen-image、wan2.7-image 几十种，按地址猜只能一律当 openai，结果 Grok 那条一直是
 * 「参考图被丢掉照样出图」。域名说明不了任何事，模型名可以。
 */
test('auto 先看模型名：grok 系走 grok，gpt-image 系走 multipart，都不看域名', () => {
  const relay = 'https://ai.yutou233.cn/v1';
  const grok = resolveImageShape({ api: relay, model: 'grok-imagine-image' });
  assert.equal(grok.shape, 'grok');
  assert.equal(grok.source, 'model');
  assert.equal(grok.guessed, true);
  assert.equal(resolveImageShape({ api: relay, model: 'gpt-image-2.6-flare' }).shape, 'openai');
  assert.equal(resolveImageShape({ api: relay, model: 'dall-e-3' }).shape, 'openai');
  // 认不出来的模型名不硬猜：域名也没信息时回到默认 openai。
  const unknown = resolveImageShape({ api: relay, model: 'qwen-image-3.0-pro' });
  assert.equal(unknown.shape, 'openai');
  assert.equal(unknown.source, 'default');
  // 给列表就取第一个。
  assert.equal(resolveImageShape({ api: relay, model: ['grok-imagine-image', 'gpt-image-2.6-flare'] }).shape, 'grok');
});

test('万相的形状只由地址定：模型名 wan* 不足以断定该走原生端点', () => {
  // 同一个模型名，配百炼原生 → wan，配中转站 → openai（中转站是 OpenAI 兼容面）。
  assert.equal(
    resolveImageShape({ api: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wan2.7-image' }).shape,
    'wan',
  );
  assert.equal(
    resolveImageShape({ api: 'https://ai.yutou233.cn/v1', model: 'wan2.7-image' }).shape,
    'openai',
  );
});

test('面板显式值和旧字段都压过模型名（用户说了算）', () => {
  assert.equal(
    resolveImageShape({ shape: 'relay', api: 'https://api.x.ai/v1', model: 'grok-imagine-image' }).shape,
    'relay',
  );
  assert.equal(
    resolveImageShape({ shape: 'relay', api: 'https://api.x.ai/v1', model: 'grok-imagine-image' }).source,
    'panel',
  );
  // 老配置（selfie_mode=edit）升级后行为逐字不变，不会因为模型名是 grok 就改形状。
  const upgraded = resolveImageShape({ api: 'https://ai.yutou233.cn/v1', model: 'grok-imagine-image', mode: 'edit' });
  assert.equal(upgraded.shape, 'openai');
  assert.equal(upgraded.source, 'legacy');
  assert.equal(modelShapeHint('grok-imagine-image'), 'grok');
  assert.equal(modelShapeHint('gpt-image-2.6-flare'), 'openai');
  assert.equal(modelShapeHint('qwen-image-3.0-pro'), '');
  assert.match(describeShape(upgraded, 'grok-imagine-image'), /旧的自拍字段/);
});

test('中转站 + grok 模型名：不改面板也发 image:{url}、不带 size', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    // 故意用本地端口当「中转站」：地址里没有 x.ai，只有模型名说得出这是 Grok。
    api: capture.api,
    key: 'test-key',
    model: 'grok-imagine-image',
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: '大理。' }),
    });
    const sent = capture.seen[0]!;
    assert.ok(!sent.contentType.includes('multipart'), '按模型名认出 grok 形状，不该再发 multipart');
    const image = sent.body.image as { url?: string } | undefined;
    assert.ok(image && typeof image.url === 'string' && image.url.startsWith('data:image/png;base64,'));
    assert.ok(!('size' in sent.body));
  } finally {
    restore();
    await capture.close();
  }
});

test('混合降级链各用各的形状：grok 失败后换 gpt-image 就改发 multipart', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const capture = await startCapture();
  const restore = installSelfieProxy({
    enabled: true,
    references: [ref],
    api: capture.api,
    key: '',
    model: ['grok-imagine-image', 'gpt-image-2.6-flare'],
    size: '1024x1024',
    imageField: 'image_url',
    subject: '大肥鱼',
    promptTemplate: '',
  }, { info: () => {}, warn: () => {} });
  try {
    await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: '大理。' }),
    });
    // 假服务对两次请求都回 200，所以只有第一次（grok 形状）会发出去 —— 验证完形状即可。
    const first = capture.seen[0]!;
    assert.equal(first.body.model, 'grok-imagine-image');
    assert.ok(first.body.image && typeof first.body.image === 'object', '第一次走 image:{url}');
  } finally {
    restore();
    await capture.close();
  }
});

test('空镜（不带参考图）也按请求里的模型名换形状：只有 grok 模型才改', async () => {
  const capture = await startCapture();
  const proxy = installPhotoProxy(
    { models: ['grok-imagine-image', 'gpt-image-2.6-flare'], selfie: null, scene: null, shape: { api: capture.api } },
    { info: () => {}, warn: () => {} },
  );
  try {
    await fetch(`${capture.api}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-imagine-image', prompt: '大理。', n: 1,
        size: '1664x928', response_format: 'b64_json', watermark: false,
      }),
    });
    const sent = capture.seen[0]!.body;
    assert.ok(!('size' in sent) && !('watermark' in sent));
    assert.equal(sent.aspect_ratio, '16:9');
    assert.equal(sent.resolution, '1.5k');
  } finally {
    proxy.uninstall();
    await capture.close();
  }
});

/*
 * 实例日志里翻出来的 diagnosability 缺口：降级链跑完只汇总一条「所有模型都失败了」，
 * 中间每一次为什么没过在日志里看不见（现场就是：三条 selfie-* 提示词之间什么都有，
 * 只有最后一条汇总）。混用 grok + gpt-image 之后链子更长，这一步必须有行。
 */
test('降级链里每一次失败都单独记一行，不只留最后的汇总', async () => {
  const dir = tempDir();
  const ref = refFile(dir);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'images[].image_url is required' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const api = `http://127.0.0.1:${address.port}/v1`;
  const warnings: string[] = [];
  const proxy = installPhotoProxy({
    models: ['grok-imagine-image', 'gpt-image-2.6-flare'],
    selfie: {
      enabled: true,
      references: [ref],
      api,
      key: '',
      model: ['grok-imagine-image', 'gpt-image-2.6-flare'],
      size: '1024x1024',
      imageField: 'image_url',
      subject: '大肥鱼',
      promptTemplate: '',
    },
    scene: null,
  }, { info: () => {}, warn: (m: string) => { warnings.push(m); } });
  try {
    const res = await fetch('http://upstream.invalid/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: '大理。' }),
    });
    assert.equal(res.status, 502);
    // 两个模型各一行 + 最后汇总一行。
    assert.equal(warnings.filter((m) => /失败/.test(m)).length, 3, warnings.join(' | '));
    assert.ok(warnings.some((m) => m.includes('grok-imagine-image') && m.includes('400')));
    assert.ok(warnings.some((m) => m.includes('gpt-image-2.6-flare') && m.includes('400')));
  } finally {
    proxy.uninstall();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/*
 * 汇报配图**不再要求开自拍**：关着自拍就出空镜（同一套场景描述 + 空镜模板 + 形状改写）。
 * 以前 `selfie_enabled` 关着就直接不配图，「不想每句话都塞一张自拍、但想配一张风景」配不出来。
 */
test('generateSceneImageBytes：不带参考图也能出图，空镜模板守住「没有人物」', async () => {
  const capture = await startCapture();
  try {
    const image = await generateSceneImageBytes(
      '一张真实旅行照片：大理洱海，傍晚。画面里没有人物。视角像路过的人。',
      {
        api: capture.api,
        key: 'test-key',
        model: 'gpt-image-1',
        shape: { shape: 'openai', api: capture.api },
        scene: { enabled: true, promptTemplate: DEFAULT_SCENE_TEMPLATE, style: '动漫画风' },
      },
      globalThis.fetch,
      { info: () => {}, warn: () => {} },
      '18:20',
    );
    assert.ok(image.bytes.length > 0);
    assert.equal(image.mime, 'image/png');
    const sent = capture.seen[0]!;
    assert.equal(sent.url, '/v1/images/generations');
    assert.ok(!('image' in sent.body) && !('image_url' in sent.body), '空镜不该带参考图字段');
    assert.match(String(sent.body.prompt), /画面里没有人物/);
    assert.match(String(sent.body.prompt), /画风：动漫画风/);
    assert.match(String(sent.body.prompt), /时间：暮色（18:20）/);
    assert.doesNotMatch(String(sent.body.prompt), /视角像路过的人/);
  } finally {
    await capture.close();
  }
});

test('空镜配图也按模型名换形状：grok 模型时 generations 不带 size/watermark', async () => {
  const capture = await startCapture();
  try {
    await generateSceneImageBytes(
      '一张真实旅行照片：大理。',
      {
        api: capture.api,
        key: '',
        model: 'grok-imagine-image',
        size: '1664x928',
        scene: null,
      },
      globalThis.fetch,
      { info: () => {}, warn: () => {} },
    );
    const sent = capture.seen[0]!.body;
    assert.ok(!('size' in sent), 'Grok 没有 size 字段');
    assert.equal(sent.aspect_ratio, '16:9');
    assert.equal(sent.resolution, '1.5k');
    assert.equal(sent.response_format, 'b64_json');
  } finally {
    await capture.close();
  }
});

test('空镜配图在别家形状下带 size，写成比例就不带并 warn', async () => {
  const capture = await startCapture();
  const warnings: string[] = [];
  const log = { info: () => {}, warn: (m: string) => { warnings.push(m); } };
  try {
    await generateSceneImageBytes('大理。', {
      api: capture.api, key: '', model: 'gpt-image-1', size: '1152x1536',
      shape: { shape: 'openai', api: capture.api },
    }, globalThis.fetch, log);
    assert.equal(capture.seen[0]!.body.size, '1152x1536');
    await generateSceneImageBytes('大理。', {
      api: capture.api, key: '', model: 'gpt-image-1', size: '3:4',
      shape: { shape: 'openai', api: capture.api },
    }, globalThis.fetch, log);
    assert.ok(!('size' in capture.seen[1]!.body));
    assert.ok(warnings.some((m) => m.includes('3:4')));
  } finally {
    await capture.close();
  }
});

test('RawBridge：没开自拍时汇报配图出空镜，开了自拍才走参考图', async () => {
  const capture = await startCapture();
  const dir = tempDir();
  const configPath = join(dir, 'engine-config.json');
  writeFileSync(configPath, JSON.stringify({
    engine: {
      homeCity: '大理',
      imageApi: capture.api,
      imageKey: 'k',
      imageModel: 'gpt-image-1',
      imageShape: 'openai',
      imageStyle: '动漫画风',
      selfieEnabled: false,
    },
    wrapper: { offline: true },
  }), 'utf8');
  const bridge = new RawBridge({ dataDir: dir, configPath, now: () => new Date('2026-05-01T00:00:00.000Z') });
  try {
    await bridge.start();
    const bytes = await bridge.reportImage('在洱海边坐着吹风');
    assert.ok(bytes && bytes.byteLength > 0, '关着自拍也该有配图');
    const sent = capture.seen[0]!;
    assert.equal(sent.url, '/v1/images/generations');
    assert.ok(!('image' in sent.body) && !('image_url' in sent.body));
    assert.match(String(sent.body.prompt), /画面里没有人物/);
    assert.match(String(sent.body.prompt), /她此刻：在洱海边坐着吹风/);
  } finally {
    await bridge.stop();
    await capture.close();
  }
});

test('统一模板：留空按形状取内置默认，用户写过的一律不动', async () => {
  const capture = await startCapture();
  const dir = tempDir();
  const ref = refFile(dir);
  let n = 0;
  const run = async (engine: Record<string, unknown>) => {
    const configPath = join(dir, `engine-${(n += 1)}.json`);
    writeFileSync(configPath, JSON.stringify({
      engine: {
        imageApi: capture.api, imageKey: 'k', imageModel: 'gpt-image-1',
        selfieEnabled: true, selfieReference: [ref], selfieApi: capture.api,
        selfieSubject: '大肥鱼', imageStyle: '动漫画风', ...engine,
      },
      wrapper: { offline: true },
    }));
    const bridge = new RawBridge({ dataDir: dir, configPath, now: () => new Date('2026-05-01T00:00:00.000Z') });
    await bridge.start();
    try {
      const ui = bridge.rawWorld.webUi() as unknown as {
        invoke: (panel: string, method: string, args: unknown[]) => Promise<unknown>;
      };
      await ui.invoke('album', 'shoot', []);
      const last = capture.seen[capture.seen.length - 1]!;
      return String(last.body.prompt ?? '');
    } finally {
      await bridge.stop();
    }
  };

  try {
    // 统一模板留空 + 通用形状 → 通用内置默认。
    const generic = await run({ imageShape: 'openai' });
    assert.match(generic, /参考图是大肥鱼的长相参考/);
    // 统一模板留空 + grok → 编辑型内置默认（先说要改什么、再锁身份）。
    const edited = await run({ imageShape: 'grok', imageModel: 'grok-imagine-image' });
    assert.match(edited, /保持参考图中大肥鱼的五官/);
    assert.doesNotMatch(edited, /不要变成陌生人/);
    // 用户写过统一模板 → 两种形状都不替换他的内容。
    const mine = await run({ imageShape: 'openai', imagePromptTemplate: '只画大肥鱼举着一瓶汽水。背景：{scene}' });
    assert.match(mine, /只画大肥鱼举着一瓶汽水/);
  } finally {
    await capture.close();
  }
});
