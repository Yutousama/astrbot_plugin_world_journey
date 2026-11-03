import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSimulation } from '../adapter/sim.ts';
import { T0, tempDir } from './helpers.ts';

test('3 天模拟跑通，事件覆盖出发/到达/跨天，无重复 key', async () => {
  const dir = tempDir();
  const report = await runSimulation({
    dataDir: dir,
    days: 3,
    speed: 24,
    seed: 7,
    from: T0,
    offline: true,
    echo: false,
  });
  assert.equal(report.upstreamVersion, '0.5.16');
  assert.ok(report.events > 0);
  assert.deepEqual(report.duplicateKeys, []);
  assert.ok(report.eventsByType['journey.depart'] >= 1);
  assert.ok(report.eventsByType['journey.arrive'] >= 1);
  assert.ok(report.citiesVisited >= 1);
  assert.ok(readFileSync(join(dir, 'sim-report.json'), 'utf8').includes('0.5.16'));
});

test('同一 seed / 起始时刻产生同一事件序列', async () => {
  const run = async () => {
    const dir = tempDir();
    await runSimulation({
      dataDir: dir,
      days: 2,
      speed: 24,
      seed: 3,
      from: T0,
      offline: true,
      echo: false,
    });
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const e = JSON.parse(line) as { type: string; key: string; text: string; trigger: string };
        return `${e.type}|${e.key}|${e.trigger}|${e.text}`;
      });
  };
  assert.deepEqual(await run(), await run());
});
