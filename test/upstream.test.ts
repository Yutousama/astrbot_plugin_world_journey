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
