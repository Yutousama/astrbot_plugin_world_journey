/**
 * 天气 —— **只当尺子，不当剧本**。
 *
 * ## 它在这个扩展里只干三件事
 *
 * 1. 决定**能不能看日出**：阴雨雪天不排凌晨起床。
 * 2. 决定**夜里还出不出去**：下雨就不去岸边听水、不看星星。
 * 3. 给一句体感：几度、什么风。她说「今天风大」时有依据。
 *
 * **不做天气播报。** 「今日多云转晴，气温 15 到 27 度」这种话她一句都不该说 ——
 * 那是天气 App 的活。天气在这里是**处境的约束**，不是要念的内容。
 *
 * ## 两个源，一路兜底
 *
 * | 情况 | 走谁 |
 * |---|---|
 * | 国内 + 填了 key | 高德（分昼夜、中文天气名准） |
 * | 国外（任何情况） | Open-Meteo（高德不覆盖，试了白试） |
 * | 国内 + 没填 key / key 失效 | Open-Meteo |
 *
 * **留空不等于没有天气。** 这是 0.2.6 专门纠的一句：早先设置页写着「留空天气标为未知」，
 * 而代码早就在没 key 时走 Open-Meteo 了 —— 文案和实现对不上，用户以为不填就是坏的一半。
 * 现在两处统一：不填也有天气，只是昼夜共用一个预报值。
 *
 * ## 三条必须遵守的
 *
 * 1. **串行 + 间隔。** 个人 key 的 QPS 很低。实测连发九个请求就
 *    `CUQPS_HAS_EXCEEDED_THE_LIMIT`。所以所有请求排一条队，两次之间至少隔 1.1 秒。
 * 2. **同城同天只查一次。** 批量旅行会反复经过同一个城市；不缓存的话配额几天就烧完。
 * 3. **失败一律静默降级。** 没网、超限、城市查不到、日期超出预报窗口 —— 全都返回 null，
 *    上层当作「天气未知」，作息表照排（只是不排日出）。**不能因为查不到天气就不走了。**
 *    key 无效只降级不报错：下一次自动落到 Open-Meteo，旅行一步都不耽误。
 *
 * ## 密钥
 *
 * 只从配置读，**不写日志、不进日记、不进报错文案**。所以所有错误都只报错误码，
 * 不回显请求 URL。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isForeign, type City } from './cities.ts';

export interface Forecast {
  /** `YYYY-MM-DD`，当地日期。 */
  readonly dateKey: string;
  readonly dayWeather: string;
  readonly nightWeather: string;
  readonly dayTemp: number;
  readonly nightTemp: number;
  readonly dayWind: string;
  readonly dayPower: string;
}

interface CacheEntry {
  readonly cityName: string;
  readonly fetchedAt: number;
  readonly casts: readonly Forecast[];
}

/** 缓存多久重查一次（毫秒）。三小时——天气不会三小时内变出花来。 */
const CACHE_TTL_MS = 3 * 3_600_000;
/** 两次请求之间的最小间隔。个人 key 实测 9 连发就超限，给足余量。 */
const MIN_GAP_MS = 1_100;
/** 单次请求超时。天气查不到不值得让旅行等一下。 */
const TIMEOUT_MS = 6_000;

const WEATHER_URL = 'https://restapi.amap.com/v3/weather/weatherInfo';

export class AmapWeather {
  private cache = new Map<string, CacheEntry>();
  /** 串行队列：所有请求排一条线，保证不并发。 */
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private disabledReason: string | null = null;
  /** 「世界时间超出预报窗口」只提示一次，否则每次巡检都刷屏。 */
  private warnedOutOfRange = false;
  /**
   * 上一次查询落空，是因为日期在预报窗口外（而不是没网、没 key、接口挂了）。
   *
   * 单独立一个字段，是因为**这两种「没有天气」处置完全不同**：
   * 网络问题等一会儿自己会好；超过窗口只能靠把时间拉回来。
   * 以前两种情况在面板上都表现为「天气那一栏空着」，用户没法分辨。
   */
  private outOfRangeHit = false;
  /** 上一次查询的结果，给面板的指示灯用。`idle` = 还没查过。 */
  private lastOutcome: 'idle' | 'ok' | 'fail' = 'idle';
  /** 上一次走的是哪条路。 */
  private lastSource: 'amap' | 'open-meteo' = 'amap';

  /** 上次查询结果。**只反映"上一下"，不是健康检查** —— 没网时它也会是 fail。 */
  get outcome(): 'idle' | 'ok' | 'fail' { return this.lastOutcome; }

  get source(): 'amap' | 'open-meteo' { return this.lastSource; }

  /** 上一次落空是不是因为日期出了预报窗口。给面板解释「为什么这几天没天气」。 */
  get outOfRange(): boolean { return this.outOfRangeHit; }

  constructor(
    private key: string,
    private readonly cacheFile: string,
    private readonly log: (level: 'info' | 'warn', msg: string) => void = () => {},
  ) {
    this.loadCache();
  }

  /**
   * 世界时间跑到预报窗口外面了。
   *
   * 这不是错误，是高倍速的必然后果：24x 下真实六小时就等于世界六天，
   * 而天气预报只有四到十五天。跑到外面之后天气一律按未知处理。
   * 只提示一次，并在提示里告诉他怎么拿回天气。
   */
  private noteOutOfRange(): void {
    // **先置位。** 这是「本次查询」的事实，跟「只提示一次」的节流是两件事；
    // 两句写在一起，第二次超窗时标记就永远是 false，面板上又说不出原因了。
    this.outOfRangeHit = true;
    if (this.warnedOutOfRange) return;
    this.warnedOutOfRange = true;
    this.log('info', '世界时间已经超出天气预报的范围，天气按未知处理。把倍速调回 1x，或点面板上的「同步」，或等预报窗口追上来。');
  }

  /** 换 key 要能热生效。 */
  setKey(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.disabledReason = null;
  }

  /**
   * 高德**这条路**通不通：有 key 且没被判失效。
   *
   * 名字故意不叫 `enabled` —— 那个词让人以为「关掉就没有天气」，
   * 实际上不通只会落到 Open-Meteo。天气功能本身永远在线。
   */
  get amapReady(): boolean {
    return this.key.trim().length > 0 && !this.disabledReason;
  }

  /**
   * 某个城市某天的预报。查不到返回 null —— **调用方必须把 null 当成「未知」，
   * 不是「没有天气」。**
   */
  async forecast(city: City, dateKey: string): Promise<Forecast | null> {
    // 每查一次重新判定，别让上一次的「窗口外」结论黏在这儿误导面板。
    this.outOfRangeHit = false;
    // 国外一律走 Open-Meteo：高德不覆盖，试了也是白试，还浪费配额。
    const useAmap = !isForeign(city) && this.amapReady;
    this.lastSource = useAmap ? 'amap' : 'open-meteo';
    const got = await this.resolveForecast(city, dateKey, useAmap);
    this.lastOutcome = got ? 'ok' : 'fail';
    return got;
  }

  private async resolveForecast(city: City, dateKey: string, useAmap: boolean): Promise<Forecast | null> {
    // 没配 key 也走 Open-Meteo —— **不填高德也能有天气**，只是中文天气名靠映射。
    if (!useAmap) return this.viaOpenMeteo(city, dateKey);

    const hit = this.cache.get(city.id);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      const f = hit.casts.find((c) => c.dateKey === dateKey);
      if (f) return f;
      // 缓存里没有这一天（比如跨了预报窗口）——如果缓存还是很新的，就先不重查。
      if (Date.now() - hit.fetchedAt < 30 * 60_000) {
        // 缓存是新的、里面确实没这一天：那就是出了窗口，不是网络问题。
        this.noteOutOfRange();
        return null;
      }
    }
    const fresh = await this.fetchCity(city);
    if (!fresh) return null;
    return exactOrNull(fresh, dateKey, city, () => this.noteOutOfRange());
  }

  private fetchCity(city: City): Promise<readonly Forecast[] | null> {
    return this.throttle(async () => {
      const url = `${WEATHER_URL}?key=${encodeURIComponent(this.key)}`
        + `&city=${encodeURIComponent(city.name)}&extensions=all&output=JSON`;
      let payload: unknown;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          this.log('warn', `天气接口 HTTP ${res.status}，这次按未知处理。`);
          return null;
        }
        payload = await res.json();
      } catch (e) {
        // 网络问题不当成错误刷屏 —— 旅行不能因为查不到天气就停下。
        const name = e instanceof Error ? e.name : 'Error';
        this.log('warn', `天气接口没连上（${name}），这次按未知处理。`);
        return null;
      }

      const o = payload as {
        status?: string;
        info?: string;
        forecasts?: { casts?: unknown[] }[];
      };
      if (o.status !== '1') {
        const info = o.info ?? '未知错误';
        if (info.includes('CUQPS') || info.includes('LIMIT')) {
          this.log('warn', '天气接口触发限流，退避后再说，这次按未知处理。');
        } else if (info.includes('INVALID_USER_KEY') || info.includes('USERKEY')) {
          // key 错了就别再试了，否则每次巡检都刷一条。
          // 注意：这不是「天气停了」—— 之后会自动落到 Open-Meteo，天气照有。
          this.disabledReason = 'key 无效';
          this.log('warn', '高德 key 无效，改用 Open-Meteo（不填 key 的那条路），天气照常。');
        } else {
          this.log('warn', `天气接口返回 ${info}，这次按未知处理。`);
        }
        return null;
      }

      const casts = o.forecasts?.[0]?.casts;
      if (!Array.isArray(casts) || !casts.length) return null;
      const parsed: Forecast[] = [];
      for (const c of casts) {
        const r = c as Record<string, unknown>;
        const date = typeof r.date === 'string' ? r.date : null;
        if (!date) continue;
        parsed.push({
          dateKey: date,
          dayWeather: str(r.dayweather),
          nightWeather: str(r.nightweather),
          dayTemp: num(r.daytemp),
          nightTemp: num(r.nighttemp),
          dayWind: str(r.daywind),
          dayPower: str(r.daypower),
        });
      }
      if (!parsed.length) return null;
      this.cache.set(city.id, { cityName: city.name, fetchedAt: Date.now(), casts: parsed });
      this.saveCache();
      return parsed;
    });
  }

  /**
   * Open-Meteo 分支。缓存键加 `om:` 前缀，免得和高德的缓存串味 ——
   * 同一个城市如果先查高德后查 OM，两边的日期窗口和口径不同，
   * 混用会出现「今天晴天」和「今天小雨」并存。
   */
  private async viaOpenMeteo(city: City, dateKey: string): Promise<Forecast | null> {
    const key = `om:${city.id}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      const f = hit.casts.find((c) => c.dateKey === dateKey);
      if (f) return f;
      if (Date.now() - hit.fetchedAt < 30 * 60_000) {
        this.noteOutOfRange();
        return null;
      }
    }
    const casts = await this.throttle(async () => fetchOpenMeteo(city));
    if (!casts) return null;
    this.cache.set(key, { cityName: city.name, fetchedAt: Date.now(), casts });
    this.saveCache();
    return exactOrNull(casts, dateKey, city, () => this.noteOutOfRange());
  }

  /** 串行队列 + 最小间隔。 */
  private throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - this.lastCallAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      return fn();
    });
    // 队列不能因为一次失败就断掉。
    this.queue = run.catch(() => undefined);
    return run;
  }

  private loadCache(): void {
    if (!existsSync(this.cacheFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.cacheFile, 'utf8').replace(/^\uFEFF/, '')) as unknown;
      if (!raw || typeof raw !== 'object') return;
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const e = v as Partial<CacheEntry>;
        if (typeof e.fetchedAt !== 'number' || !Array.isArray(e.casts)) continue;
        this.cache.set(id, {
          cityName: typeof e.cityName === 'string' ? e.cityName : id,
          fetchedAt: e.fetchedAt,
          casts: e.casts as Forecast[],
        });
      }
    } catch { /* 缓存坏了就当没有，重查即可 */ }
  }

  private saveCache(): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      const obj: Record<string, CacheEntry> = {};
      for (const [id, e] of this.cache) obj[id] = e;
      writeFileSync(this.cacheFile, JSON.stringify(obj), 'utf8');
    } catch { /* 写不进去不影响旅行 */ }
  }
}

/**
 * 精确匹配那一天的预报，**匹配不到就是 null**。
 *
 * 曾经这里是 `?? fresh[0]` —— 拿预报的第一天顶替。那在高倍速下会变成灾难：
 * 世界时间跑得比真实快，几天就冲出预报窗口，于是「11 月 4 日」拿到的是
 * 「10 月 31 日」的天气，而且**一声不响**。她会说「今天多云」，
 * 而那个「今天」根本不存在。
 *
 * 用错日期的天气比没有天气更糟。宁可未知。
 */
function exactOrNull(
  casts: readonly Forecast[],
  dateKey: string,
  city: City,
  onOutOfRange: () => void,
): Forecast | null {
  const hit = casts.find((c) => c.dateKey === dateKey);
  if (hit) return hit;
  onOutOfRange();
  void city;
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 这天气算不算「出不了门」。雨雪雷暴雷阵雨都算。 */
export function isWet(w: string): boolean {
  return /雨|雪|雷|冰雹|冻雨/.test(w);
}

/** 这天气看不看得见东西。雾霾沙尘浮尘都算挡住。 */
export function isMurky(w: string): boolean {
  return /雾|霾|沙|尘|浮尘|扬沙/.test(w);
}

/** 给一句体感，**不是播报**。她要说的是冷热和风，不是天气现象的名字。 */
export function feelOf(f: Forecast | null): string {
  if (!f) return '';
  const t = f.nightTemp;
  const parts: string[] = [];
  if (t <= 0) parts.push('夜里到零下，手伸出来就僵');
  else if (t <= 8) parts.push('冷，得穿厚的');
  else if (t <= 16) parts.push('凉，一件外套刚好');
  else if (t <= 24) parts.push('不冷不热');
  else parts.push('热，走两步就出汗');
  if (/雨/.test(f.dayWeather)) parts.push('有雨，出门得带伞');
  else if (/雪/.test(f.dayWeather)) parts.push('下雪');
  else if (isMurky(f.dayWeather)) parts.push('天灰，看不清远处');
  if (/^[5-9]/.test(f.dayPower)) parts.push('风大');
  return parts.join('，');
}

/* ---------------- Open-Meteo：覆盖全球，不要 key ---------------- */

/**
 * WMO 天气码 → 中文。
 *
 * 为什么非要翻成中文：`isWet()` / `isMurky()` / `feelOf()` 都是按中文关键词判断的，
 * 直接塞数字进去，判不出来，也不会报错 —— 只是天气永远"看起来正常"。
 */
const WMO: Record<number, string> = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '毛毛雨', 55: '密毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴雨',
  85: '阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴强冰雹',
};

const wmoText = (code: unknown): string => {
  const n = Number(code);
  return WMO[n] ?? (Number.isFinite(n) ? '阴' : '');
};

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * 查 Open-Meteo。
 *
 * 不用 key、覆盖全球、按经纬度直查（我们的城市表本来就有坐标），
 * 还自带 `timezone=auto`。所以它是**国外城市和没配 key 时的统一兜底**。
 *
 * 免费额度是每月三十万次（非商业），这个扩展一天最多查几次，
 * 一辈子也用不完。但仍然走缓存：同一城市三小时内只查一次。
 */
export async function fetchOpenMeteo(city: City): Promise<readonly Forecast[] | null> {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: '4',
  });
  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'coopani-world-journey (desktop companion)' },
    });
    if (!res.ok) return null;
    const o = await res.json() as {
      daily?: {
        time?: string[]; weather_code?: number[];
        temperature_2m_max?: number[]; temperature_2m_min?: number[];
        precipitation_probability_max?: (number | null)[]; wind_speed_10m_max?: number[];
      };
    };
    const d = o.daily;
    if (!d?.time?.length) return null;
    const out: Forecast[] = [];
    for (let i = 0; i < d.time.length; i++) {
      const date = d.time[i];
      if (!date) continue;
      const code = d.weather_code?.[i];
      const dayText = wmoText(code);
      // Open-Meteo 的 daily 只有一个 weather_code，**不分昼夜**。
      // 所以夜间只能沿用白天那个值 —— 这是它的局限，不是我们偷懒。
      // 需要真正分昼夜的话得拉 hourly 再按 20:00-23:00 聚合，暂时不值这个复杂度。
      const nightText = dayText;
      out.push({
        dateKey: date,
        dayWeather: dayText,
        nightWeather: nightText,
        dayTemp: Math.round(Number(d.temperature_2m_max?.[i] ?? 0)),
        nightTemp: Math.round(Number(d.temperature_2m_min?.[i] ?? 0)),
        dayWind: Number(d.wind_speed_10m_max?.[i] ?? 0) >= 30 ? '大风' : '微风',
        dayPower: String(Math.round(Number(d.wind_speed_10m_max?.[i] ?? 0) / 5)),
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
