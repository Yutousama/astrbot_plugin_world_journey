#!/usr/bin/env node
/**
 * 上游检查：版本、逐文件 hash、静态契约。
 *
 * - 默认发现 raw 变化时退出 1（提醒：先看变更、跑测试，再 `--accept`）。
 * - `--accept` 只写根目录 upstream.lock.json，不写 raw。
 * - 静态检查只读 raw/src/world.ts 与 ENV_PROMPT.md。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileHashes, hashOfFiles, listFiles, readJson } from './lib/upstream.mjs';

const root = process.cwd();
const rawDir = join(root, 'raw');
const lockPath = join(root, 'upstream.lock.json');
const accept = process.argv.includes('--accept');

if (!existsSync(join(rawDir, 'package.json'))) {
  console.error('[upstream] 找不到 raw/package.json；raw/ 目录是不是被删了？');
  process.exit(1);
}

const pkg = readJson(join(rawDir, 'package.json'));
const version = typeof pkg.version === 'string' ? pkg.version : 'unknown';
const files = fileHashes(rawDir);
const sha256 = hashOfFiles(files);
const old = existsSync(lockPath) ? readJson(lockPath) : null;

let failed = false;
if (!old) {
  console.log('[upstream] 还没有 upstream.lock.json（首次基线）。');
  failed = true;
} else if (old.sha256 !== sha256 || old.version !== version) {
  console.log(`[upstream] 版本：${old.version ?? '?'} → ${version}`);
  console.log(`[upstream] 全量 hash 变化：${String(old.sha256 ?? '').slice(0, 12)}… → ${sha256.slice(0, 12)}…`);
  const oldFiles = old.files ?? {};
  const changed = [];
  for (const key of Object.keys(files)) {
    if (oldFiles[key] !== files[key]) changed.push(key);
  }
  for (const key of Object.keys(oldFiles)) {
    if (!(key in files)) changed.push(`${key} (deleted)`);
  }
  console.log(`[upstream] 变化文件 ${changed.length} 个：`);
  for (const key of changed.slice(0, 60)) console.log(`  - ${key}`);
  if (changed.length > 60) console.log(`  … 还有 ${changed.length - 60} 个`);
  failed = true;
} else {
  console.log(`[upstream] 与锁一致：${version}（${Object.keys(files).length} 个文件）`);
}

// 静态检查：只读，不改 raw。
const sourceFiles = listFiles(join(rawDir, 'src')).filter((p) => p.endsWith('.ts'));
const nonTypeImports = [];
for (const path of sourceFiles) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("from 'cortico/")) continue;
    // `import type { ... } from 'cortico/...'` 可能是多行；往回找 import 起始行。
    let start = i;
    while (start >= 0 && !/^\s*import\b/.test(lines[start])) start--;
    const importLine = start >= 0 ? lines[start] : line;
    if (/^\s*import\s+type\b/.test(importLine) || /\btype\b/.test(importLine)) continue;
    nonTypeImports.push(`${path.slice(root.length + 1)}: ${importLine.trim()} … ${line.trim()}`);
  }
}
if (nonTypeImports.length) {
  console.error('[upstream] 发现运行时 cortico import（构建会失败）：');
  for (const line of nonTypeImports) console.error(`  - ${line}`);
  failed = true;
} else {
  console.log('[upstream] 没有运行时 cortico import。');
}

const worldPath = join(rawDir, 'src', 'world.ts');
const world = existsSync(worldPath) ? readFileSync(worldPath, 'utf8') : '';
const required = [
  ['start', /async start\s*\(/],
  ['stop', /async stop\s*\(/],
  ['tools', /\btools\s*\(/],
  ['envPromptVars', /\benvPromptVars\s*\(/],
  ['webUi', /\bwebUi\s*\(/],
  ['invoke', /invoke\s*:/],
];
for (const [name, re] of required) {
  if (!re.test(world)) {
    console.error(`[upstream] world.ts 里找不到公开面「${name}」；可能需要更新 adapter/raw.ts。`);
    failed = true;
  }
}

const hostNames = new Set();
for (const m of world.matchAll(/\bhost\.([A-Za-z_]\w*)/g)) hostNames.add(m[1]);
const unknownHost = [...hostNames].filter((n) => n !== 'log' && n !== 'pushEvent');
if (unknownHost.length) {
  console.warn(`[upstream] host 调用出现新成员：${unknownHost.join('、')}（已用 no-op 警告兜底；必要时更新 adapter/host.ts）`);
} else {
  console.log('[upstream] host 调用仍在白名单：log / pushEvent。');
}

const promptPath = join(rawDir, 'ENV_PROMPT.md');
if (!existsSync(promptPath)) {
  console.error('[upstream] 找不到 raw/ENV_PROMPT.md；提示词适配会失败。');
  failed = true;
} else {
  const prompt = readFileSync(promptPath, 'utf8');
  if (!prompt.includes('### 身体怎么动')) {
    console.warn('[upstream] ENV_PROMPT.md 里没有「### 身体怎么动」；prompt.ts 的剥离逻辑需要确认。');
  }
  if (!prompt.includes('{{journey.now}}')) {
    console.warn('[upstream] ENV_PROMPT.md 里没有 {{journey.now}}；变量名可能变了。');
  }
}

console.log('');
console.log('最近 CHANGELOG：');
const changelog = readFileSync(join(rawDir, 'CHANGELOG.md'), 'utf8').split('\n').slice(0, 45);
console.log(changelog.join('\n'));

if (accept) {
  const lock = {
    package: typeof pkg.name === 'string' ? pkg.name : 'coopani-world-journey',
    version,
    sha256,
    fileCount: Object.keys(files).length,
    files,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`\n[upstream] 已写入 ${lockPath}`);
  process.exit(0);
}

if (failed) {
  console.error('\n[upstream] 未通过。确认上游变化后跑：npm test && npm run upstream:accept');
  process.exit(1);
}
