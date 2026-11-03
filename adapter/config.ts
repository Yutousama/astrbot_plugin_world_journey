/**
 * 引擎配置 —— 默认值永远来自 raw（异步加载后传入）。
 *
 * 插件只写 `{ "engine": {...} }` 覆盖项；默认值由上游 `JOURNEY_DEFAULTS()` 提供，
 * 上游新增字段时套壳无需改代码。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { JourneyConfigSection } from './raw.ts';

export interface EngineConfigFile {
  readonly engine?: Partial<JourneyConfigSection>;
  readonly wrapper?: { readonly offline?: boolean };
}

export interface LoadedEngineConfig {
  readonly cfg: JourneyConfigSection;
  readonly offline: boolean;
  readonly path: string;
  readonly notes: string[];
}

export function configPathFor(dataDir: string): string {
  return join(dataDir, 'engine-config.json');
}

/** 读配置；文件不在/坏了都回退 raw 默认值。 */
export function loadEngineConfig(
  dataDir: string,
  path = configPathFor(dataDir),
  defaults: JourneyConfigSection,
): LoadedEngineConfig {
  const notes: string[] = [];
  if (!existsSync(path)) {
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown;
  } catch (e) {
    notes.push(`engine-config.json 读不出来，先用 raw 默认值（原文件没动）：${e instanceof Error ? e.message : String(e)}`);
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('engine-config.json 不是对象，先用 raw 默认值。');
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  const o = raw as Record<string, unknown>;
  const section = (o.engine && typeof o.engine === 'object' && !Array.isArray(o.engine))
    ? o.engine as Record<string, unknown>
    : o;
  const cfg = { ...defaults, ...(section as Partial<JourneyConfigSection>) };
  const wrapper = (o.wrapper && typeof o.wrapper === 'object' && !Array.isArray(o.wrapper))
    ? o.wrapper as Record<string, unknown>
    : {};
  return {
    cfg,
    offline: wrapper.offline === true,
    path,
    notes,
  };
}

/** 把新配置合并进现有 cfg；去掉的字段回到 raw 默认值。 */
export function applyEngineConfig(
  cfg: JourneyConfigSection,
  next: JourneyConfigSection,
  defaults: JourneyConfigSection,
): void {
  for (const key of Object.keys(cfg)) {
    if (!(key in next)) (cfg as unknown as Record<string, unknown>)[key] = (defaults as unknown as Record<string, unknown>)[key];
  }
  Object.assign(cfg, next);
}

/** 文件 mtime 监听；返回新配置，没变返回 null。 */
export class ConfigWatcher {
  private mtime = 0;

  constructor(
    readonly path: string,
    private readonly defaults: JourneyConfigSection,
  ) {
    this.mtime = mtimeOf(path);
  }

  read(): LoadedEngineConfig | null {
    const m = mtimeOf(this.path);
    if (m === this.mtime) return null;
    this.mtime = m;
    return loadEngineConfig(dirname(this.path), this.path, this.defaults);
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
