/**
 * 唯一的 raw 导入点。
 *
 * 注意这里**不是静态 import**：安装后的插件把上游源码放在 `plugin/raw/`，通过
 * `JOURNEY_RAW_DIR` 指向它；更新源码后只要重启 sidecar，不需要重新打包 adapter。
 * Node 22.7+ 的 `--experimental-transform-types` 负责把上游 TS 跑起来。
 *
 * 类型仍然从仓库 `raw/src` 静态 import（仅 type，构建时擦除），用来约束 adapter。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { JourneyConfigSection } from '../raw/src/config.ts';
import type { JourneyWorld as JourneyWorldType } from '../raw/src/world.ts';
import type { UiLeg, UiPhoto, UiSnapshot, UiTimelineItem } from '../raw/src/ui.ts';

export interface RawModule {
  readonly JourneyWorld: new (opts: {
    cfg: JourneyConfigSection;
    dataDir: string;
    botName: string;
    now?: () => Date;
    nowPlaying?: () => { title: string; artist: string; at: number } | null;
  }) => JourneyWorldType;
  readonly JOURNEY_DEFAULTS: () => JourneyConfigSection;
  readonly JOURNEY_ID: string;
}

/** 上游源码根目录。插件通过环境变量指向 `plugin/raw`。 */
export function rawRoot(): string {
  const fromEnv = process.env.JOURNEY_RAW_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'raw'),
    join(here, '..', '..', 'raw'),
    join(process.cwd(), 'raw'),
  ];
  for (const path of candidates) {
    if (existsSync(join(path, 'src', 'world.ts'))) return path;
  }
  return candidates[0]!;
}

export async function loadRaw(root = rawRoot()): Promise<RawModule> {
  const worldPath = join(root, 'src', 'world.ts');
  const configPath = join(root, 'src', 'config.ts');
  if (!existsSync(worldPath) || !existsSync(configPath)) {
    throw new Error(`上游源码不完整：找不到 ${worldPath} 或 ${configPath}`);
  }
  const worldUrl = pathToFileURL(worldPath).href;
  const configUrl = pathToFileURL(configPath).href;
  const [world, config] = await Promise.all([import(worldUrl), import(configUrl)]) as [
    { JourneyWorld?: unknown },
    { JOURNEY_DEFAULTS?: unknown; JOURNEY_ID?: unknown },
  ];
  if (typeof world.JourneyWorld !== 'function') {
    throw new Error(`上游 ${worldPath} 没有导出 JourneyWorld；请检查 raw 更新。`);
  }
  if (typeof config.JOURNEY_DEFAULTS !== 'function') {
    throw new Error(`上游 ${configPath} 没有导出 JOURNEY_DEFAULTS；请检查 raw 更新。`);
  }
  return {
    JourneyWorld: world.JourneyWorld as RawModule['JourneyWorld'],
    JOURNEY_DEFAULTS: config.JOURNEY_DEFAULTS as RawModule['JOURNEY_DEFAULTS'],
    JOURNEY_ID: typeof config.JOURNEY_ID === 'string' ? config.JOURNEY_ID : 'journey',
  };
}

export type { JourneyConfigSection, JourneyWorldType, UiLeg, UiPhoto, UiSnapshot, UiTimelineItem };
