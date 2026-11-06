/**
 * 场景描述 —— 「她这一张要拍什么」的唯一来源。
 *
 * ## 为什么要有这个文件
 *
 * 上游 `raw/src/photo.ts` 的 `photoPrompt()` 才是**唯一**认得「画面风格」的地方：
 * 用户在插件里填的「画面风格」（`image_style`）由它拼进提示词。可套壳里原先只有
 * 上游自己的拍照路径会经过它 —— 主动汇报配图（`/api/report-image`）直接拿
 * 「汇报文本 + 此刻」去生图，画风配置一个字都不参与，于是同一个人设配了动漫风格，
 * 相册里是二次元、汇报里是真人照片。
 *
 * 这里把「拍照的场景描述」抽成一个两边都能调的函数：`bridge.photo()` 和
 * `bridge.reportImage()` 用的是同一个 prompt 来源，改上游的写法也不会再走偏。
 *
 * ## 为什么不改 raw
 *
 * `raw/` 是只读上游。这里**只做 import**：`photo.ts` 里没有任何 `import`，
 * 全是纯函数，加载它不发请求、不读文件、不碰全局。
 *
 * ## 已知的近似
 *
 * 上游 `spotNow()` 会翻遍当天**所有**已经过去的活动节点找最后一个有地名的；
 * UI 快照的 `timeline` 只带「最近一个过去的节点 + 未来四个」。所以「先吃饭、
 * 之后逛景点、此刻又在吃饭」这种少数情形里，这里拿不到景点名 —— 画面退化成
 * 「城市 + 光线」，不报错也不编一个地点出来。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawRoot, type UiSnapshot } from './raw.ts';

/** 上游 `PhotoScene` 的最小面：只声明套壳会填的字段。 */
export interface PhotoSceneLike {
  readonly city: string;
  readonly spot?: string;
  readonly hour: number;
  readonly weather?: string;
  readonly feel?: string;
  readonly style?: string;
  readonly onRoad?: boolean;
  readonly mode?: string;
}

export interface PhotoHelpers {
  readonly photoPrompt: (scene: PhotoSceneLike) => string;
  readonly spotFromBeat: (what: string) => string;
}

let cached: Promise<PhotoHelpers> | null = null;

/**
 * 动态加载上游的拍照纯函数。
 *
 * 和 `raw.ts` 一样的理由：不静态 import，上游更新后重启 sidecar 就生效。
 * 缓存一次；失败也缓存，避免每次汇报都撞一遍不存在的文件。
 */
export function loadPhotoHelpers(root = rawRoot()): Promise<PhotoHelpers> {
  if (cached) return cached;
  cached = importPhotoHelpers(root);
  return cached;
}

async function importPhotoHelpers(root: string): Promise<PhotoHelpers> {
  const path = join(root, 'src', 'photo.ts');
  if (!existsSync(path)) throw new Error(`上游缺少 ${path}，用不了场景描述`);
  const mod = await import(pathToFileURL(path).href) as Record<string, unknown>;
  const photoPrompt = mod.photoPrompt;
  const spotFromBeat = mod.spotFromBeat;
  if (typeof photoPrompt !== 'function' || typeof spotFromBeat !== 'function') {
    throw new Error('上游 photo.ts 没有导出 photoPrompt/spotFromBeat；请检查 raw 更新');
  }
  return {
    photoPrompt: photoPrompt as PhotoHelpers['photoPrompt'],
    spotFromBeat: spotFromBeat as PhotoHelpers['spotFromBeat'],
  };
}

/**
 * 按她此刻的状态拼一句场景描述 —— 和上游自动拍照、`/journey_photo` 补拍同一套事实。
 *
 * `style` 传用户的「画面风格」：留空时上游回落到「一张真实旅行照片」，
 * 填了（例如「动漫画风」）就当整句的前缀。这条路径**不**依赖自拍开关。
 */
export async function buildScenePrompt(snapshot: UiSnapshot, style: string): Promise<string> {
  const helpers = await loadPhotoHelpers();
  const hour = hourOf(snapshot.clock);
  const leg = asRecord(snapshot.leg);
  /*
   * 在路上拍的是**窗外**，城市取目的地：`hereId` 要到 `journey.arrive` 才更新，
   * 拿它去拍就成了「人往东跑了一下午，照片还站在原地晾衣服」。
   */
  const onRoad = snapshot.mode === 'traveling' && leg !== null;
  const place = asRecord(snapshot.place);
  const city = onRoad ? text(leg?.to) : text(place?.name);
  if (!city) throw new Error('快照里没有可用的城市名');
  const spot = onRoad ? '' : spotFromTimeline(snapshot, hour, helpers.spotFromBeat);
  const weather = text(snapshot.weather);
  const feeling = text(snapshot.feeling);
  return helpers.photoPrompt({
    city,
    ...(spot ? { spot } : {}),
    hour,
    ...(weather ? { weather } : {}),
    ...(feeling ? { feel: feeling } : {}),
    style,
    onRoad,
    ...(onRoad ? { mode: text(leg?.mode) } : {}),
  }).trim();
}

/** `HH:MM` → 小时；拿不到就当上午 10 点（只影响光线描述，不会让生图失败）。 */
function hourOf(clock: unknown): number {
  const m = /^(\d{1,2}):/.exec(text(clock));
  const hour = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 10;
}

/**
 * 此刻在哪个景点 —— 取「已经过去的活动节点里最后一个有具体地名的」。
 *
 * 只认 `kind === 'activity'`：吃饭、坐车那些节点没有地点，硬抠会把「早饭」画成地名。
 */
function spotFromTimeline(snapshot: UiSnapshot, hour: number, spotFromBeat: (what: string) => string): string {
  const items = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  let spot = '';
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    if (text(row.kind) !== 'activity') continue;
    if (row.past !== true && hourOf(row.at) > hour) continue;
    const candidate = spotFromBeat(text(row.what));
    if (candidate) spot = candidate;
  }
  return spot;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
