import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../adapter/events.ts';
import { LocalMediaStore } from '../adapter/media.ts';
import { RawHost, withHostFallback } from '../adapter/host.ts';
import { tempDir } from './helpers.ts';

const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

test('媒体按内容去重，句柄就是文件名', () => {
  const dir = tempDir();
  const media = new LocalMediaStore(dir);
  const a = media.save({ bytes: PNG, mime: 'image/png', name: 'a.png' });
  const b = media.save({ bytes: PNG, mime: 'image/png', name: 'b.png' });
  assert.equal(a.handle, b.handle);
  assert.match(a.file, /^[0-9a-f]{16}\.png$/);
  assert.deepEqual([...media.read(a.file)!], [...PNG]);
  assert.equal(media.mimeOf(a.file), 'image/png');
  assert.equal(media.pathOf('..'), null);
  assert.equal(media.pathOf('../state.json'), null);
});

test('RawHost.pushEvent 把 blob 落盘并规范化事件', async () => {
  const dir = tempDir();
  const events = new EventLog(dir);
  const media = new LocalMediaStore(dir);
  const host = new RawHost({ dataDir: dir, events, media, echo: false });
  const result = await host.pushEvent({
    type: 'journey.photo',
    senderKey: 'photo-1',
    text: '她拍了张照片。',
    ts: '2026-05-01T00:00:00.000Z',
    blobs: [{ bytes: PNG, mime: 'image/png', name: 'x.png' }],
  }, { trigger: 'debounce' });
  assert.equal(result.blobs?.[0]?.handle, 'b2bbe763c7e1828c.png');
  const stored = events.recent(1)[0];
  assert.ok(stored);
  assert.equal(stored.type, 'journey.photo');
  assert.equal(stored.key, 'photo-1');
  assert.equal(stored.trigger, 'debounce');
  assert.equal(stored.photo?.file, 'b2bbe763c7e1828c.png');
  assert.ok(existsSync(join(dir, 'media', 'b2bbe763c7e1828c.png')));
  assert.ok(readFileSync(join(dir, 'events.jsonl'), 'utf8').includes('journey.photo'));
});

test('host 未知成员用 no-op 兜底而不是崩溃', () => {
  const dir = tempDir();
  const host = new RawHost({
    dataDir: dir,
    events: new EventLog(dir),
    media: new LocalMediaStore(dir),
    echo: false,
  });
  const proxied = withHostFallback(host) as unknown as Record<string, unknown>;
  assert.equal(typeof proxied.log, 'object');
  assert.equal(typeof proxied.pushEvent, 'function');
  assert.equal(typeof proxied.someNewUpstreamMethod, 'function');
});
