import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSimulation } from '../adapter/sim.ts';
import { pauseTimers } from '../adapter/compat/private.ts';
import { readJson } from '../scripts/lib/upstream.mjs';
import { T0, makeBridge, tempDir } from './helpers.ts';

const LOCK_VERSION = (readJson(join(process.cwd(), 'upstream.lock.json')) as { version?: string }).version;

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
  assert.equal(report.upstreamVersion, LOCK_VERSION);
  assert.ok(report.events > 0);
  assert.deepEqual(report.duplicateKeys, []);
  assert.ok(report.eventsByType['journey.depart'] >= 1);
  assert.ok(report.eventsByType['journey.arrive'] >= 1);
  assert.ok(report.citiesVisited >= 1);
  assert.ok(readFileSync(join(dir, 'sim-report.json'), 'utf8').includes(LOCK_VERSION ?? ''));
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

/*
 * 上游 1.x 把定时器换了血：`wishTimer`（想去扫描）随 1.6.19 的功能删除一起没了，
 * 换成 `heartTimer`（20 分钟位置心跳）、`versionTimer`（3 小时 npm 对账）、
 * `reportRetryTimer`（上报失败退避）。`compat/private.ts` 漏停任何一个，模拟就会
 * 在真实时间里偷偷跑心跳/版本检查 —— 表现是「测试跑完进程还不退」或「CI 多打 npm」。
 *
 * 这条按**对象上真实存在的 `*Timer` 字段**逐个查，而不是只查我们名单里那几个：
 * 上游以后再加定时器，这里会自动红，不用先知道名字。
 */
test('pauseTimers 停掉上游挂上的每一个定时器；offline 不留外网成功痕迹', async () => {
  const dir = tempDir();
  const bridge = makeBridge(dir);
  await bridge.start();
  try {
    const world = bridge.rawWorld as unknown as Record<string, unknown>;
    // 大小写都要认：上游的巡检定时器就叫 `timer`，其余是 `heartTimer` / `versionTimer`…
    const timerKeys = Object.keys(world).filter((k) => /timer$/i.test(k));
    assert.ok(timerKeys.includes('timer'), '上游的巡检定时器 timer 不见了，私有兼容层要重新对一遍');
    assert.ok(timerKeys.length >= 3, `只看到 ${timerKeys.join('、')}，和 1.8.0 的定时器清单不符`);

    pauseTimers(world);
    const stillLive = timerKeys.filter((k) => world[k]);
    assert.deepEqual(stillLive, [], `这些定时器没被停掉：${stillLive.join('、')}；补 adapter/compat/private.ts 的 TIMER_KEYS`);

    // 版本检查只在「真查成功」时落盘；offline 的 fetch 必抛，所以文件不该存在。
    assert.equal(existsSync(join(dir, 'version-check.json')), false, '离线模拟里不该有成功的 npm 版本查询落盘');
  } finally {
    await bridge.stop();
  }
});
