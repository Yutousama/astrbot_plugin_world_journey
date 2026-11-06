import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RawBridge } from '../adapter/bridge.ts';
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
