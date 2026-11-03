import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRaw } from '../adapter/raw.ts';
import { applyEngineConfig, loadEngineConfig } from '../adapter/config.ts';
import { tempDir } from './helpers.ts';

async function defaults() {
  return (await loadRaw()).JOURNEY_DEFAULTS();
}

test('没有配置时使用 raw 默认值', async () => {
  const dir = tempDir();
  const base = await defaults();
  const loaded = loadEngineConfig(dir, join(dir, 'engine-config.json'), base);
  assert.equal(loaded.cfg.homeCity, base.homeCity);
  assert.equal(loaded.cfg.speed, 1);
  assert.equal(loaded.offline, false);
});

test('engine 覆盖项 + wrapper 开关', async () => {
  const dir = tempDir();
  const path = join(dir, 'engine-config.json');
  writeFileSync(path, JSON.stringify({
    engine: { homeCity: '成都', speed: 4, memoryDir: '/tmp/x', futureField: 'keep-me' },
    wrapper: { offline: true },
  }), 'utf8');
  const loaded = loadEngineConfig(dir, path, await defaults());
  assert.equal(loaded.cfg.homeCity, '成都');
  assert.equal(loaded.cfg.speed, 4);
  assert.equal(loaded.offline, true);
  assert.equal((loaded.cfg as unknown as Record<string, unknown>).futureField, 'keep-me');
});

test('坏 JSON 回退默认值，不覆盖原文件', async () => {
  const dir = tempDir();
  const path = join(dir, 'engine-config.json');
  writeFileSync(path, '{ bad', 'utf8');
  const loaded = loadEngineConfig(dir, path, await defaults());
  assert.equal(loaded.cfg.homeCity, '');
  assert.ok(loaded.notes.some((n) => n.includes('读不出来')));
});

test('applyEngineConfig 删除的字段回到 raw 默认值', async () => {
  const base = await defaults();
  const cfg = { ...base, homeCity: '成都', speed: 4 };
  const next = { ...base, speed: 2 };
  applyEngineConfig(cfg, next, base);
  assert.equal(cfg.homeCity, base.homeCity);
  assert.equal(cfg.speed, 2);
});
