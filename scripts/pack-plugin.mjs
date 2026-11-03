#!/usr/bin/env node
/**
 * 打 AstrBot 插件 zip。zip 根就是插件内容（main.py/metadata.yaml/engine/...）。
 * Windows 用 Compress-Archive，其他平台用 zip。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const pluginDir = join(root, 'plugin', 'astrbot_plugin_world_journey');
const outDir = join(root, 'dist-astrbot');
const outFile = join(outDir, 'astrbot_plugin_world_journey.zip');
if (!existsSync(join(pluginDir, 'main.py'))) {
  console.error('找不到插件目录；先构建/确认 plugin/astrbot_plugin_world_journey。');
  process.exit(1);
}
rmSync(join(pluginDir, '__pycache__'), { recursive: true, force: true });
rmSync(join(pluginDir, 'data'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

let result;
if (process.platform === 'win32') {
  const ps = `Compress-Archive -Path '${pluginDir.replace(/'/g, "''")}\\*' -DestinationPath '${outFile.replace(/'/g, "''")}' -Force`;
  result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
} else {
  result = spawnSync('zip', ['-r', resolve(outFile), '.'], { cwd: pluginDir, stdio: 'inherit' });
}
if (result.status !== 0) {
  console.error('[pack] 打包失败');
  process.exit(result.status ?? 1);
}
console.log(`[pack] ${outFile}`);
