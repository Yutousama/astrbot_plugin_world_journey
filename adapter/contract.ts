/**
 * 上游契约 —— 套壳对 raw 的最小假设。
 *
 * 生产只依赖公开面；私有 tick 不在这里（见 compat/private.ts）。上游更新后
 * 这个文件 + raw.ts 是最可能需要改的两处。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RawToolDecl {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly tags?: readonly string[];
  readonly summary?: { readonly zh: string; readonly en: string };
  readonly handler?: (args: unknown) => unknown;
}

export interface RawWebUi {
  readonly panels?: { readonly id: string }[];
  invoke(panel: string, method: string, args: unknown[]): Promise<unknown>;
  readonly [key: string]: unknown;
}

export interface RawWorldLike {
  start(host: unknown): Promise<void>;
  stop(): Promise<void>;
  tools(): RawToolDecl[];
  envPromptVars(): Record<string, string>;
  webUi(): RawWebUi;
}

export const REQUIRED_TOOL_NAMES = [
  'journey_now',
  'journey_diary_write',
  'journey_diary_read',
  'journey_stats',
  'journey_draw_to',
] as const;

export const REQUIRED_PROMPT_VARS = [
  'journey.version',
  'journey.status',
  'journey.now',
  'journey.withUser',
  'journey.beatGap',
  'journey.home',
  'journey.homeFeel',
  'journey.diary',
] as const;

/** 启动前的同步形状检查；失败信息要能直接指向上游改动。 */
export function assertRawWorldShape(world: unknown): asserts world is RawWorldLike {
  if (!world || typeof world !== 'object') throw new Error('raw JourneyWorld 没有构造出来');
  const w = world as Record<string, unknown>;
  for (const name of ['start', 'stop', 'tools', 'envPromptVars', 'webUi'] as const) {
    if (typeof w[name] !== 'function') {
      throw new Error(`上游 JourneyWorld.${name} 不见了；请检查 raw 更新并调整 adapter/raw.ts。`);
    }
  }
}

export function assertWebUiShape(ui: RawWebUi): void {
  if (!ui || typeof ui.invoke !== 'function') {
    throw new Error('上游 webUi().invoke 不见了；面板桥接需要更新 adapter/bridge.ts。');
  }
  const ids = new Set((ui.panels ?? []).map((p) => p?.id).filter(Boolean));
  for (const id of ['now', 'album']) {
    if (!ids.has(id)) throw new Error(`上游 webUi().panels 缺少「${id}」页；请调整 adapter/bridge.ts。`);
  }
}

export function assertToolNames(tools: RawToolDecl[]): void {
  const names = new Set(tools.map((t) => t.name));
  const missing = REQUIRED_TOOL_NAMES.filter((n) => !names.has(n));
  if (missing.length) {
    throw new Error(`上游工具缺少：${missing.join('、')}；请检查 raw/src/world.ts 的 TOOL_DECLS。`);
  }
}

export function assertPromptVars(vars: Record<string, string>): void {
  const missing = REQUIRED_PROMPT_VARS.filter((n) => typeof vars[n] !== 'string');
  if (missing.length) {
    throw new Error(`上游 envPromptVars 缺少：${missing.join('、')}；提示词渲染会失败。`);
  }
}

export interface UpstreamInfo {
  readonly version: string;
  readonly sha256?: string;
  readonly builtAt?: string;
}

/** 读取 raw/package.json 的版本；回退到构建时写入的 engine/upstream.json。 */
export function readUpstreamInfo(root = process.env.JOURNEY_RAW_DIR || join(process.cwd(), 'raw')): UpstreamInfo {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };
    if (typeof pkg.version === 'string') return { version: pkg.version };
  } catch {
    // 继续试构建产物。
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'upstream.json'),
    join(here, '..', 'upstream.json'),
    join(process.cwd(), 'plugin', 'astrbot_plugin_world_journey', 'engine', 'upstream.json'),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<UpstreamInfo>;
      if (typeof raw.version === 'string') return { version: raw.version, sha256: raw.sha256, builtAt: raw.builtAt };
    } catch {
      // 试下一个。
    }
  }
  return { version: 'unknown' };
}
