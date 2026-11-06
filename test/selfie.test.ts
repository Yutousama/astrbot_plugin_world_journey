import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSelfiePrompt, DEFAULT_SELFIE_TEMPLATE, DEFAULT_SCENE_TEMPLATE,
  describeTime, installSelfieProxy, renderImagePrompt,
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
