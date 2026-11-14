import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashOfFiles, fileHashes, readJson } from '../scripts/lib/upstream.mjs';
import { readUpstreamInfo } from '../adapter/contract.ts';

const root = process.cwd();

test('raw/ 与 upstream.lock.json 一致', () => {
  const pkg = readJson(join(root, 'raw', 'package.json')) as { version?: string };
  const lock = readJson(join(root, 'upstream.lock.json')) as {
    version?: string; sha256?: string; files?: Record<string, string>;
  };
  const files = fileHashes(join(root, 'raw')) as Record<string, string>;
  const hash = hashOfFiles(files) as string;
  assert.equal(lock.version, pkg.version, 'raw 版本变了；先跑 npm run upstream:check，再 accept');
  assert.equal(lock.sha256, hash, 'raw 内容变了；先跑 npm run upstream:check，再 accept');
  assert.equal(lock.files && Object.keys(lock.files).length, Object.keys(files).length);
});

test('raw 版本与 lock 一致，且带月文件/旅行记忆', () => {
  const pkg = readJson(join(root, 'raw', 'package.json')) as { version?: string };
  const lock = readJson(join(root, 'upstream.lock.json')) as { version?: string };
  assert.equal(pkg.version, lock.version, 'raw 版本与 lock 不一致；先跑 npm run upstream:check 再 accept');
  const world = readFileSync(join(root, 'raw', 'src', 'world.ts'), 'utf8');
  assert.ok(world.includes('TravelMemoryStore'));
  assert.ok(readFileSync(join(root, 'raw', 'src', 'diary.ts'), 'utf8').includes('readMonthFile'));
});

test('readUpstreamInfo 能读到版本', () => {
  const info = readUpstreamInfo();
  const pkg = readJson(join(root, 'raw', 'package.json')) as { version?: string };
  assert.equal(info.version, pkg.version);
});

/*
 * 下面三条把「上游 1.8.0 的公开面」钉在测试里。`npm run upstream:check` 只做静态
 * 扫描，这三条补的是它扫不到的那部分：**套壳真读到的名字还在不在**。
 * 上游哪天改名，这里先红，而不是等 sidecar 起不来或某个面板静默空掉。
 */

/** 从 world.ts 里抠出 `name: 'journey_xxx'` 的工具名清单（TOOL_DECLS 的字面量）。 */
function toolNames(world: string): string[] {
  return [...world.matchAll(/name:\s*'(journey_[a-z_]+)'/g)].map((m) => m[1]!);
}

test('上游工具清单：必需项与 1.x 新增项都还在', () => {
  const world = readFileSync(join(root, 'raw', 'src', 'world.ts'), 'utf8');
  const names = new Set(toolNames(world));
  // 套壳契约必需的 5 个（adapter/contract.ts REQUIRED_TOOL_NAMES）。
  for (const need of ['journey_now', 'journey_diary_write', 'journey_diary_read', 'journey_stats', 'journey_draw_to']) {
    assert.ok(names.has(need), `必需工具 ${need} 不见了`);
  }
  // 0.8.7 → 1.8.0 陆续加上的 8 个：壳层的指令与能力实测按名字认它们。
  for (const added of [
    'journey_rent_car', 'journey_plan_change', 'journey_hotel_night', 'journey_spot_ride',
    'journey_set_slot', 'journey_eat', 'journey_rest', 'journey_signpost',
  ]) {
    assert.ok(names.has(added), `1.x 工具 ${added} 不见了`);
  }
  assert.equal(names.size, 23, `工具数 ${names.size} 与 1.8.0 的 23 个不符；核对 describe.json 与 capabilities()`);
});

test('上游面板清单：契约要的 now/album 在，1.x 新增的 mates/settings 也在', () => {
  const world = readFileSync(join(root, 'raw', 'src', 'world.ts'), 'utf8');
  const panels = [...world.matchAll(/id:\s*'([a-z]+)',\s*title:/g)].map((m) => m[1]!);
  for (const need of ['now', 'album', 'diary']) {
    assert.ok(panels.includes(need), `面板 ${need} 不见了（adapter/contract.ts assertWebUiShape 会拦）`);
  }
  // mates = /journey_mates 的数据来源；settings 是 Coopani 专属，套壳明确不接（见 README）。
  assert.ok(panels.includes('mates'), 'mates 面板不见了，/journey_mates 的能力实测会假');
  assert.ok(panels.includes('settings'), 'settings 面板出现变化，确认套壳是否仍不接');
});

test('1.8.0 新增的数据表随包在场，且 photo.ts 仍导出套壳要的那两个函数', () => {
  // city-play / hotel-facts 用 `new URL('../../data/xx.json', import.meta.url)` 读，
  // 少一份文件上游会静默退回「没有这条数据」—— 看着像功能没生效，其实是被复制漏了。
  for (const data of ['data/city-play.json', 'data/hotel-facts.json']) {
    const text = readFileSync(join(root, 'raw', data), 'utf8');
    assert.ok(text.trimStart().startsWith('{'), `${data} 不像 JSON`);
  }
  const photo = readFileSync(join(root, 'raw', 'src', 'photo.ts'), 'utf8');
  assert.match(photo, /export function photoPrompt\(/);
  assert.match(photo, /export function spotFromBeat\(/);
  // adapter/photo-prompt.ts 反查目的地 city id 用的那张表。
  const cities = readFileSync(join(root, 'raw', 'src', 'geo', 'cities.ts'), 'utf8');
  assert.match(cities, /export function cityByName\(/);
});
