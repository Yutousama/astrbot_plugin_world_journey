#!/usr/bin/env node
/**
 * 构建 sidecar 与更新器。
 *
 * 重要：sidecar **不再把 raw 打包进去**。安装后的插件用 `plugin/raw/` 的上游源码
 * 运行时加载，所以更新源码只需换 `raw/` 并重启 sidecar，不用重新打包 adapter。
 * 跑 TS 的能力由两个来源提供：Node 22.7–25 自带 `--experimental-transform-types`；
 * Node 26 起该 flag 被移除，改用随包发布的 `engine/amaro` 转换器（见 bridge.py）。
 *
 * 产物：
 *   plugin/.../engine/sidecar.mjs   adapter 套壳（动态 import raw）
 *   plugin/.../engine/update.mjs    npm registry 更新器
 *   plugin/.../engine/amaro/        TS 转换器（Node 26+ 用；纯 WASM，无原生二进制）
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
const selfPkg = readJson(join(root, 'package.json'));
const selfVersion = typeof selfPkg.version === 'string' ? selfPkg.version : 'unknown';

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
  // 版本号只在构建时注入一次，避免 adapter 里再写死一份。
  define: { __BRIDGE_VERSION__: JSON.stringify(selfVersion) },
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

// Node 26 起没有内置 TS 转换（--experimental-transform-types 被移除），随包带一份 amaro。
// 它只在 import .ts 时现场转换，raw/ 仍是 TS，热更新和更新器都不受影响。
const amaroSrc = join(root, 'node_modules', 'amaro', 'dist');
const amaroDst = join(engineDir, 'amaro');
if (!existsSync(amaroSrc)) {
  rmSync(engineDir, { recursive: true, force: true });
  console.error('[build] 找不到 node_modules/amaro（先 npm install）；Node 26+ 会起不来。');
  process.exit(1);
}
cpSync(amaroSrc, amaroDst, { recursive: true });
// dist/LICENSE 是打包进去的 SWC（Apache-2.0）；amaro 本身是 MIT，单独再放一份。
const amaroLicense = join(root, 'node_modules', 'amaro', 'LICENSE.md');
if (existsSync(amaroLicense)) cpSync(amaroLicense, join(amaroDst, 'LICENSE-amaro.md'));
const amaroFiles = Object.keys(fileHashes(amaroDst)).length;
console.log(`[build] 转换器 engine/amaro：${amaroFiles} 个文件`);

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
    bridgeVersion: selfVersion,
  }, null, 2)}\n`,
  'utf8',
);

const sidecarSize = readFileSync(join(engineDir, 'sidecar.mjs')).length;
const updaterSize = readFileSync(join(engineDir, 'update.mjs')).length;
console.log(`[build] sidecar ${(sidecarSize / 1024).toFixed(1)} KB；update ${(updaterSize / 1024).toFixed(1)} KB`);
console.log(`[build] 上游源码副本 ${pluginRaw}`);
console.log(`[build] 上游 ${version}；raw hash 未变。`);
