import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBridge, tempDir } from './helpers.ts';

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
