#!/usr/bin/env node
/**
 * 构建 sidecar 与更新器。
 *
 * 重要：sidecar **不再把 raw 打包进去**。安装后的插件用 `plugin/raw/` 的上游源码
 * 运行时加载（Node 的 --experimental-transform-types），所以更新源码只需换 `raw/`
 * 并重启 sidecar，不用重新打包 adapter。
 *
 * 产物：
 *   plugin/.../engine/sidecar.mjs   adapter 套壳（动态 import raw）
 *   plugin/.../engine/update.mjs    npm registry 更新器
 *   plugin/.../raw/                 上游源码副本（运行时加载/更新目标）
 *   plugin/.../engine/upstream.json 版本/hash
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileHashes, hashOfFiles, readJson } from './lib/upstream.mjs';

const root = process.cwd();
const rawDir = join(root, 'raw');
const pluginDir = join(root, 'plugin', 'astrbot_plugin_world_journey');
const engineDir = join(pluginDir, 'engine');
const pluginRaw = join(pluginDir, 'raw');
const pkg = readJson(join(rawDir, 'package.json'));
const version = typeof pkg.version === 'string' ? pkg.version : 'unknown';

const before = fileHashes(rawDir);
const beforeHash = hashOfFiles(before);
console.log(`[build] 上游 ${version}，${Object.keys(before).length} 个文件，hash ${beforeHash.slice(0, 12)}…`);

for (const dir of [pluginDir, engineDir]) mkdirSync(dir, { recursive: true });
rmSync(engineDir, { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });

const baseOptions = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'inline',
  logLevel: 'info',
  absWorkingDir: root,
};
try {
  await build({
    ...baseOptions,
    entryPoints: [join(root, 'adapter', 'cli.ts')],
    outfile: join(engineDir, 'sidecar.mjs'),
  });
  await build({
    ...baseOptions,
    entryPoints: [join(root, 'adapter', 'update.ts')],
    outfile: join(engineDir, 'update.mjs'),
  });
} catch (e) {
  console.error('[build] esbuild 失败：', e instanceof Error ? e.message : e);
  process.exit(1);
}

// 上游源码副本：运行时由 JOURNEY_RAW_DIR 指向这里；更新器也替换这里。
rmSync(pluginRaw, { recursive: true, force: true });
cpSync(rawDir, pluginRaw, { recursive: true });
// 更新器/诊断也会读插件根这份；保留一份 ENV_PROMPT 方便人工查看。
cpSync(join(rawDir, 'ENV_PROMPT.md'), join(pluginDir, 'ENV_PROMPT.md'));
cpSync(join(rawDir, 'ENV_PROMPT.md'), join(root, 'ENV_PROMPT.md'));
rmSync(join(pluginDir, 'package.json'), { force: true });
const notice = join(root, 'THIRD_PARTY_NOTICES.md');
if (existsSync(notice)) cpSync(notice, join(pluginDir, 'THIRD_PARTY_NOTICES.md'));

const after = fileHashes(rawDir);
const afterHash = hashOfFiles(after);
if (afterHash !== beforeHash) {
  rmSync(engineDir, { recursive: true, force: true });
  rmSync(pluginRaw, { recursive: true, force: true });
  console.error('[build] raw/ 在构建过程中被改动；已删除产物。raw 必须只读。');
  process.exit(1);
}

writeFileSync(
  join(engineDir, 'upstream.json'),
  `${JSON.stringify({
    package: typeof pkg.name === 'string' ? pkg.name : 'coopani-world-journey',
    version,
    sha256: beforeHash,
    fileCount: Object.keys(before).length,
    builtAt: new Date().toISOString(),
    bridgeVersion: '1.0.2',
  }, null, 2)}\n`,
  'utf8',
);

const sidecarSize = readFileSync(join(engineDir, 'sidecar.mjs')).length;
const updaterSize = readFileSync(join(engineDir, 'update.mjs')).length;
console.log(`[build] sidecar ${(sidecarSize / 1024).toFixed(1)} KB；update ${(updaterSize / 1024).toFixed(1)} KB`);
console.log(`[build] 上游源码副本 ${pluginRaw}`);
console.log(`[build] 上游 ${version}；raw hash 未变。`);
