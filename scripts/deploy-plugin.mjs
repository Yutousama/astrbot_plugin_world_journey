#!/usr/bin/env node
/**
 * 把 plugin/astrbot_plugin_world_journey 部署到 AstrBot 的 data/plugins。
 * 只写目标目录，不碰 AstrBot 其他插件；不自动重启。
 *
 * 用法：
 *   npm run deploy -- --target "C:\...\core\data\plugins"
 *   npm run deploy -- --target "..." --link       # 开发用 junction
 *   npm run deploy -- --target "..." --force      # 覆盖已有同名目录
 */
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

function valueOf(args, key) {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const targetArg = valueOf(args, '--target');
if (!targetArg) {
  console.error('用法：npm run deploy -- --target "<AstrBot>/data/plugins" [--link] [--force]');
  process.exit(2);
}
const targetRoot = resolve(targetArg);
const pluginName = 'astrbot_plugin_world_journey';
const source = resolve('plugin', pluginName);
const target = join(targetRoot, pluginName);
const link = args.includes('--link');
const force = args.includes('--force');

if (!existsSync(source)) {
  console.error(`找不到插件源目录：${source}；先跑 npm run build。`);
  process.exit(1);
}
mkdirSync(targetRoot, { recursive: true });

if (existsSync(target)) {
  const st = lstatSync(target);
  const canReplace = force || st.isSymbolicLink();
  if (!canReplace) {
    console.error(`目标已存在：${target}；加 --force 才会覆盖。`);
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
}

if (link) {
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`[deploy] junction：${target} -> ${source}`);
} else {
  cpSync(source, target, { recursive: true });
  console.log(`[deploy] 已复制到 ${target}`);
}
console.log('[deploy] 接下来在 AstrBot WebUI 插件页重载，或调用 /api/v1/plugins/<id>/reload。');
console.log('[deploy] 配置在插件页填写；Node 需要 22.7+，找不到时配置 node_path。');
