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
 * `raw/` 是只读上游。这里**只做 import**。上游 1.6.x 之后 `photo.ts` 自己会 import
 * `geo/cities.ts`、`geo/spot-profile.ts`、`geo/season.ts`、`clock.ts` —— 全是本地数据表，
 * 加载它仍然不发请求、不读配置、不碰全局，只是比 0.8.6 那版重了些（`cities.ts` 250KB+）。
 *
 * ## 与上游对齐到哪一步（1.8.0 核对）
 *
 * 上游自动拍照走 `world.ts` 的 `photoSceneNow()` + `maybePhoto()`，喂给 `photoPrompt` 的
 * 字段是：`city / cityId / spot / onRoad / mode / hour / weather / feel / style / minimal /
 * cast / view / describe / subject / focus`。这里对齐其中**快照能算出来的那些**：
 *
 * - `cityId`（1.8.0 的视觉锚点、季节句、太阳高度都按 id 查）。在城里用快照的 `place.id`；
 *   在路上快照只给城市**名**（`leg.to`），所以多 import 一个上游的 `geo/cities.ts`
 *   用 `cityByName` 反查 id —— `photo.ts` 自己已经 import 那张表，不会多加载模块。
 *   查不到就留空：上游对「只有地名」的处理是退化成「只拍城市」，绝不编一个锚点出来。
 * - 在路上取哪座城：按 `leg.progress` **过半才算目的地**（上游 1.11 的修法；原来这里
 *   一律取目的地，于是「刚出成都两小时」的照片已经是戈壁滩）。
 * - `hour` 用**四舍五入**而不是截断（上游 `Math.round(decimal)`；18:40 上游按 19 点判光）。
 * - `minimal` / `cast`：来自配置，缺了就会出现「相册里按设置画人、汇报图里没有人」这种分裂。
 * - `view` / `subject` / `describe` / `focus`：这些是「他开口要求的」，只有 `/journey_photo`
 *   和工具那条路才有，自动拍照不传，这里也不猜。
 * - `month` / `day`：**故意不传**。`photoPrompt` 里是 `scene.month ?? 1`，而上游
 *   `maybePhoto` 自己也没传 —— 两边都按 1 月退化才一致，单给汇报图传真实月份会造出
 *   「同一时刻两种季节」的新问题。（上游这一处更像遗漏，值得给 Mr.Q 提 issue。）
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
  /** 1.6.x 起上游按 id 查视觉锚点 / 季节 / 太阳高度；只有地名时它会退化成「只拍城市」。 */
  readonly cityId?: string;
  readonly spot?: string;
  readonly hour: number;
  readonly weather?: string;
  readonly feel?: string;
  readonly style?: string;
  /** 极简提示词（上游 `imageMinimal`）：大模型认得这地方时砍掉城市锚点。 */
  readonly minimal?: boolean;
  /** 画面里出不出人（上游 `imageCast`）；留空 = 没有人。 */
  readonly cast?: string;
  readonly onRoad?: boolean;
  readonly mode?: string;
}

/** 拍照场景里跟配置走的那几项，由 `bridge` 传进来。 */
export interface SceneConfigOptions {
  readonly style?: string;
  readonly minimal?: boolean;
  readonly cast?: string;
}

export interface PhotoHelpers {
  readonly photoPrompt: (scene: PhotoSceneLike) => string;
  readonly spotFromBeat: (what: string) => string;
  /**
   * 城市名/id → 城市 id（上游 `geo/cities.ts` 的 `cityByName`，认名字、认 id、
   * 也认「北京市」「大峡谷国家公园」这类带后缀的写法）。
   *
   * 为什么套壳要自己查：在路上时快照只给目的地的**名字**（`leg.to`），
   * 而 1.8.0 的 `photoPrompt` 认的是 **id** —— 视觉锚点、季节句、太阳高度全靠它。
   * 查不到 id 就只能按「只有地名」退化：窗外那张会按 lat=0（赤道）判光，
   * 哈尔滨夏天的白夜和喀什 19 点的太阳都会算错。
   * 老版上游没有这个函数时这里是 undefined，行为回到「不传 cityId」，不报错。
   */
  readonly cityIdOf?: (nameOrId: string) => string;
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
  const cityIdOf = await loadCityIdLookup(root);
  return {
    photoPrompt: photoPrompt as PhotoHelpers['photoPrompt'],
    spotFromBeat: spotFromBeat as PhotoHelpers['spotFromBeat'],
    ...(cityIdOf ? { cityIdOf } : {}),
  };
}

/**
 * 尽力加载上游的城市名查找；**加载不到就返回 undefined**。
 *
 * 这条是「锦上添花」：`photo.ts` 自己已经 import 了 `geo/cities.ts`，所以这里不会
 * 额外多加载一份模块，只是多一个 import 点。真出错（旧版没这个导出、路径挪了）
 * 就让 cityId 缺席，绝不因为查 id 失败把整条汇报配图打挂。
 */
async function loadCityIdLookup(root: string): Promise<((nameOrId: string) => string) | undefined> {
  try {
    const path = join(root, 'src', 'geo', 'cities.ts');
    if (!existsSync(path)) return undefined;
    const mod = await import(pathToFileURL(path).href) as Record<string, unknown>;
    const byName = mod.cityByName;
    if (typeof byName !== 'function') return undefined;
    return (nameOrId: string): string => {
      const key = nameOrId.trim();
      if (!key) return '';
      try {
        const city = (byName as (name: string) => { id?: unknown } | null)(key);
        return typeof city?.id === 'string' ? city.id : '';
      } catch {
        return '';
      }
    };
  } catch {
    return undefined;
  }
}

/**
 * 按她此刻的状态拼一句场景描述 —— 和上游自动拍照、`/journey_photo` 补拍同一套事实。
 *
 * `style` 传用户的「画面风格」：留空时上游回落到「一张真实旅行照片」，
 * 填了（例如「动漫画风」）就当整句的前缀。这条路径**不**依赖自拍开关。
 * `minimal` / `cast` 同理是配置项：不传就会变成「相册按设置出图、汇报图不按设置」。
 */
export async function buildScenePrompt(
  snapshot: UiSnapshot,
  styleOrOptions: string | SceneConfigOptions,
  maybeOptions?: SceneConfigOptions,
): Promise<string> {
  const options: SceneConfigOptions = typeof styleOrOptions === 'string'
    ? { ...(maybeOptions ?? {}), style: styleOrOptions }
    : styleOrOptions;
  const helpers = await loadPhotoHelpers();
  const hour = hourOf(snapshot.clock);
  const leg = asRecord(snapshot.leg);
  const place = asRecord(snapshot.place);
  /*
   * 在路上拍的是**窗外**，可 `hereId` 要到 `journey.arrive` 才更新 —— 直接拿它拍
   * 就成了「人往东跑了一下午，照片还站在原地晾衣服」。但一路按目的地也不对：
   * 上游 1.11 为此改成**过半才算到对面那一带**（「才从成都出发几个小时，窗外就成沙漠」）。
   * 这里读快照 `leg.progress` 用同一条判据。
   *
   * 注意刻度：上游 `uiSnapshot()` 给的是**百分数**（`Math.round(progress * 100)`，
   * `world.ts` 里那句），不是 0–1。两种都认，免得以后上游换了写法又悄悄错一半。
   */
  const onRoad = snapshot.mode === 'traveling' && leg !== null;
  const pastHalf = onRoad && progressPastHalf(leg?.progress);
  // 过半之前，画面里的是脚下这座城（快照的 place 就是她出发时那座城市）。
  const useDest = onRoad && pastHalf;
  const city = useDest ? text(leg?.to) || text(place?.name) : text(place?.name);
  if (!city) throw new Error('快照里没有可用的城市名');
  /*
   * 城市 id：在城里 / 过半之前用快照的 `place.id`；过半之后要换成目的地，
   * 而快照在路上只给目的地的**名字**，于是用上游的 `cityByName` 反查（查不到就留空，
   * 上游会按「只有地名」处理，绝不编一个锚点出来）。
   */
  const cityId = useDest ? (helpers.cityIdOf?.(text(leg?.to)) ?? '') : text(place?.id);
  const spot = onRoad ? '' : spotFromTimeline(snapshot, hour, helpers.spotFromBeat);
  const weather = text(snapshot.weather);
  const feeling = text(snapshot.feeling);
  return helpers.photoPrompt({
    city,
    ...(cityId ? { cityId } : {}),
    ...(spot ? { spot } : {}),
    hour,
    ...(weather ? { weather } : {}),
    ...(feeling ? { feel: feeling } : {}),
    ...(options.style ? { style: options.style } : {}),
    ...(options.minimal === true ? { minimal: true } : {}),
    ...(options.cast ? { cast: options.cast } : {}),
    onRoad,
    ...(onRoad ? { mode: text(leg?.mode) } : {}),
  }).trim();
}

/**
 * `HH:MM` → 小时。
 *
 * **四舍五入**而不是取整点：上游 `photoSceneNow()` 用的是 `Math.round(decimal)`，
 * 18:40 那边算 19 点、我们截断成 18 点的话，日落前后的光照档位会整段错开。
 * 拿不到就当上午 10 点（只影响光线描述，不会让生图失败）。
 */
function hourOf(clock: unknown): number {
  const m = /^(\d{1,2})[:：](\d{1,2})$/.exec(text(clock));
  if (!m) {
    const bare = Number(text(clock));
    return Number.isFinite(bare) && bare >= 0 && bare <= 23 ? Math.round(bare) : 10;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return 10;
  return Math.min(23, Math.round(hour + minute / 60));
}

/** 数字字段：不是数字 / NaN 一律当没有。 */
function number(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * 这趟路走过半程没有。
 *
 * 上游 `uiSnapshot()` 的 `leg.progress` 是**百分数**（`Math.round(progress * 100)`）；
 * 这里顺手认 0–1 的写法（`0.5 <= p <= 1`），这样以后上游换刻度也不会错一半 ——
 * 但 `1` 这个值两种解释都有，按百分数当 1%（还没过半）处理：宁晚勿早，
 * 出发刚半小时就把窗外写成目的地，正是上游 1.11 修掉的那个 bug。
 */
function progressPastHalf(value: unknown): boolean {
  const p = number(value);
  if (p === null) return false;
  return p >= 50 || (p >= 0.5 && p < 1);
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
