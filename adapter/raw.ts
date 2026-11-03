/**
 * 唯一的 raw 导入点。
 *
 * 注意这里**不是静态 import**：安装后的插件把上游源码放在 `plugin/raw/`，通过
 * `JOURNEY_RAW_DIR` 指向它；更新源码后只要重启 sidecar，不需要重新打包 adapter。
 * 跑 TS 的能力由 Node 自带 flag 或随包的 `engine/amaro` 提供（见 bridge.py）。
 *
 * 类型只描述套壳用到的公开面，**刻意不 import raw/src/*.ts**：raw 是只读上游，
 * 它自己的类型严格度不该挡住我们的 typecheck（0.5.26 里就有一处上游的 strict 报错）。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RawWorldLike } from './contract.ts';

/** 上游 `JourneyWorld` 的最小结构（真实方法见 contract.ts 的 RawWorldLike）。 */
export type JourneyWorldType = RawWorldLike;
/** 上游配置对象：字段由上游定义，套壳只做透传。 */
export type JourneyConfigSection = Record<string, unknown>;
/** 照片项：套壳只读 title，其余原样透传给 Python。 */
export interface UiPhoto {
  readonly title?: string;
  readonly [key: string]: unknown;
}
/** 路线项：原样透传。 */
export type UiLeg = Record<string, unknown>;
export type UiTimelineItem = Record<string, unknown>;
/** UI 快照：只声明套壳实际读取的字段，其余透传。 */
export interface UiSnapshot {
  readonly dateKey: string;
  readonly clock: string;
  readonly mode: string;
  readonly place: { readonly name: string; readonly [key: string]: unknown };
  readonly trip: { readonly visited: number; readonly [key: string]: unknown };
  readonly diary: { readonly days: number; readonly [key: string]: unknown };
  readonly photos: readonly UiPhoto[];
  readonly wishes: readonly string[];
  readonly [key: string]: unknown;
}

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

