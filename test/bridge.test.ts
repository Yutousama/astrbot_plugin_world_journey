import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOT_NAME, RawBridge, normalizeBotName } from '../adapter/bridge.ts';
import { makeBridge, tempDir, T0 } from './helpers.ts';

test('桥接门面：快照、工具、日记、出发、同步、照片失败原因', async () => {
  const dir = tempDir();
  const bridge = makeBridge(dir);
  await bridge.start();
  try {
    const snap = await bridge.snapshot();
    assert.equal(snap.mode, 'home');
    assert.equal(snap.place.name, '兰州');

    const now = bridge.now();
    assert.ok(now.includes('兰州'));
    assert.equal(now.includes('music_pick'), false);

    const prompt = bridge.prompt();
    assert.deepEqual(prompt.missing, []);
    assert.equal(prompt.text.includes('{{'), false);
    assert.equal(prompt.text.includes('journey.actions'), false);

    const names = bridge.tools().map((t) => t.name);
    for (const name of ['journey_now', 'journey_diary_write', 'journey_diary_read', 'journey_stats', 'journey_draw_to']) {
      assert.ok(names.includes(name), name);
    }

    const nowTool = await bridge.callTool('journey_now', {});
    assert.equal(nowTool.isError, undefined);
    assert.ok(nowTool.text.includes('兰州'));

    const draw = await bridge.callTool('journey_draw_to', { city: '成都', why: '一首歌' });
    assert.equal(draw.isError, undefined);
    assert.ok((await bridge.snapshot()).wishes.includes('成都'));

    const write = await bridge.callTool('journey_diary_write', { body: '今天在兰州走了很久。' });
    assert.equal(write.isError, undefined);
    const read = await bridge.callTool('journey_diary_read', { days: 7 });
    assert.ok(read.text.includes('今天在兰州走了很久。'));

    const depart = await bridge.depart();
    assert.equal(depart.ok, true);
    assert.ok((depart.text ?? '').includes('在路上'));
    assert.ok(bridge.events.recent(20).some((e) => e.type === 'journey.depart'));

    const sync = await bridge.sync();
    assert.equal(sync.ok, true);

    const photo = await bridge.photo();
    assert.equal(photo.ok, false);
    assert.ok((photo.reason ?? '').length > 0);

    const missingTool = await bridge.callTool('journey_nope', {});
    assert.equal(missingTool.isError, true);
  } finally {
    await bridge.stop();
  }
});

test('点头/回程桥接：没有在等批时明确拒绝；在路上能叫她回来', async () => {
  const dir = tempDir();
  const bridge = makeBridge(dir);
  await bridge.start();
  try {
    const empty = await bridge.askAnswer(true);
    assert.equal(empty.ok, false);
    assert.ok((empty.reason ?? '').includes('没有'));

    const depart = await bridge.depart();
    assert.equal(depart.ok, true);

    const back = await bridge.returnHome();
    assert.equal(back.ok, true);
    assert.ok(bridge.events.recent(30).some((e) => e.type === 'journey.depart'));

    // 能力实测：当前 raw 真有这些能力，health 应如实上报（壳的版本闸信这个）。
    const caps = bridge.capabilities();
    // 老三项（0.5.19 / 0.7.9 / 0.8.5）：指令 /journey_yes、/journey_back、/journey_photo 题材。
    for (const key of ['answerAsk', 'returnHome', 'photoSubject'] as const) {
      assert.equal(caps[key], true, `能力实测缺 ${key}`);
    }
    // 1.0.7 / 1.0.9：拍照的「怎么拍」与「她自己写的画面」。
    assert.equal(caps.photoFocus, true);
    assert.equal(caps.photoDescribe, true);
    // 1.x 新工具（1.0.6 / 1.0.8 / 1.0.10 / 1.6.18 / 1.8.0）+ 0.8.7 的租车。
    for (const key of ['planChange', 'hotelNight', 'spotRide', 'setSlot', 'eat', 'signpost', 'rentCar', 'rest'] as const) {
      assert.equal(caps[key], true, `能力实测缺 ${key}`);
    }
    // 1.11 起的「路上遇见的人」面板（/journey_mates 只读那一页的数据）。
    assert.equal(caps.matesPanel, true);
    assert.deepEqual(bridge.health().capabilities, caps);
  } finally {
    await bridge.stop();
  }
});

test('ComfyUI 协议下自拍套壳整体停用：reportImage 直接返回 null，不出网', async () => {
  const dir = tempDir();
  const bridge = new RawBridge({
    dataDir: dir,
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
    initialOverrides: {
      selfieEnabled: true,
      imageProtocol: 'comfyui',
      imageApi: 'http://127.0.0.1:8188',
    } as never,
  });
  await bridge.start();
  try {
    // selfieEnabled=true 但协议是 comfyui 且没单独配 selfieApi —— 自拍/汇报配图应安静跳过。
    const image = await bridge.reportImage('她在大荔看黄河');
    assert.equal(image, null);
  } finally {
    await bridge.stop();
  }
});
test('接口形状：地址是 api.x.ai 却显式配成别的形状时 warn 一句', async () => {
  const dir = tempDir();
  const warnings: string[] = [];
  const bridge = new RawBridge({
    dataDir: dir,
    log: {
      info: () => {},
      warn: (m: string) => { warnings.push(m); },
      error: () => {},
      debug: () => {},
    },
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
    initialOverrides: {
      imageApi: 'https://api.x.ai/v1',
      imageKey: 'k',
      imageModel: 'grok-imagine-image-2.0',
      // auto 会自己认成 grok（那才是对的），所以这里要构造「人配错了」的情形：
      // 地址指向 x.ai，形状却被显式钉在 openai。
      imageShape: 'openai',
    } as never,
  });
  await bridge.start();
  try {
    // 不 warn 的话用户只会看到「出一张跟她无关的照片」，而日志里一路 HTTP 200。
    // 文案按**模型名**说话（域名在中转站场景下没意义），且只在形状被钉住时才 warn。
    assert.ok(
      warnings.some((m) => m.includes('Grok') && m.includes('形状被钉死')),
      warnings.join(' | '),
    );
  } finally {
    await bridge.stop();
  }
});

test('接口形状：auto 不吵 —— 降级链混用 grok 与 gpt-image 是正常配置', async () => {
  const dir = tempDir();
  const warnings: string[] = [];
  const bridge = new RawBridge({
    dataDir: dir,
    log: {
      info: () => {},
      warn: (m: string) => { warnings.push(m); },
      error: () => {},
      debug: () => {},
    },
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
    initialOverrides: {
      // 典型配置：中转站 + 两个 gpt-image 打头、grok 兜底。
      // auto 下每个模型各认各的形状，这种混用不该在启动时挨一条「形状不对」的警告。
      imageApi: 'https://relay.example.com/v1',
      imageKey: 'k',
      imageModels: ['gpt-image-2.6-flare', 'gpt-image-2.5-flare', 'grok-imagine-image'],
      selfieEnabled: true,
    } as never,
  });
  await bridge.start();
  try {
    assert.equal(warnings.filter((m) => m.includes('Grok')).length, 0, warnings.join(' | '));
  } finally {
    await bridge.stop();
  }
});

test('接口形状 auto 认对了就不吵：api.x.ai 直接当 grok，不出 warn', async () => {
  const dir = tempDir();
  const warnings: string[] = [];
  const bridge = new RawBridge({
    dataDir: dir,
    log: {
      info: () => {},
      warn: (m: string) => { warnings.push(m); },
      error: () => {},
      debug: () => {},
    },
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
    initialOverrides: {
      imageApi: 'https://api.x.ai/v1',
      imageKey: 'k',
      imageModel: 'grok-imagine-image-2.0',
    } as never,
  });
  await bridge.start();
  try {
    assert.equal(warnings.filter((m) => m.includes('api.x.ai')).length, 0, warnings.join(' | '));
  } finally {
    await bridge.stop();
  }
});

test('碰面池里的名字：配置传进来的就是上游那个 pet；空/超长/零宽都收成可比对的形状', async () => {
  const bridge = new RawBridge({
    dataDir: tempDir(),
    botName: '玄月的小银鱼',
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
  });
  await bridge.start();
  try {
    assert.equal(bridge.botName, '玄月的小银鱼');
    // 上游每个碰面请求的 pet 都取自构造参数（raw/src/world.ts:1835）。
    const world = bridge.rawWorld as unknown as { opts: { botName: string } };
    assert.equal(world.opts.botName, '玄月的小银鱼');
    assert.equal(bridge.health().botName, '玄月的小银鱼');
  } finally {
    await bridge.stop();
  }
});

test('没配名字时用内置默认名，绝不把空串递给上游', async () => {
  const bridge = new RawBridge({
    dataDir: tempDir(),
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
  });
  assert.equal(bridge.botName, DEFAULT_BOT_NAME);
  // 上游 meet.ts 里 `!clean(opt.pet)` 直接判「没配碰面服务器」，空名等于联机静默失效。
  assert.ok(bridge.botName.trim().length > 0);
});

test('名字清洗：控制字符与零宽剔干净、连续空白压一个、截到上游的 24 字', () => {
  const zwsp = String.fromCharCode(0x200B);
  const zwj = String.fromCharCode(0x200D);
  const soft = String.fromCharCode(0x00AD);
  assert.equal(normalizeBotName(''), DEFAULT_BOT_NAME);
  assert.equal(normalizeBotName('   '), DEFAULT_BOT_NAME);
  assert.equal(normalizeBotName(undefined), DEFAULT_BOT_NAME);
  assert.equal(normalizeBotName(`  克罗艾${zwsp}的小银鱼  `), '克罗艾的小银鱼');
  assert.equal(normalizeBotName(`astr${zwj}bot`), 'astrbot');
  assert.equal(normalizeBotName(`${soft}鱼`), '鱼');
  assert.equal(normalizeBotName('a\r\nb'), 'a b');
  assert.equal(normalizeBotName('一'.repeat(40)).length, 24);
});
