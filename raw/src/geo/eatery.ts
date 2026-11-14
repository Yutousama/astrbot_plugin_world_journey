/**
 * 真店名 —— **她特意去吃的那一顿，店名是查来的，不是编的**。
 *
 * ## 为什么不从静态表里出
 *
 * `cities.ts` 里那张 `FOODS` 是**菜名**（「重庆小面」「毛血旺」），一个城三样，
 * 185 座城全加起来 613 条。它回答得了「这一带吃什么」，回答不了「哪家」。
 *
 * 而「哪家」是这个项目最不能自己编的东西 —— 编错了，她就把一家不存在的店
 * 说给了用户（Discussion #586 之后立的规矩：事实必须查，判断才交给她）。
 *
 * ## 和酒店共用一套脾气
 *
 * 没 key、没网、超限、查不到 —— 一律返回 null，上层退回泛称「一家本地人排队的店」。
 * 结果按「城市 + 想吃什么」缓存七天：一家火锅店半年内不会换招牌，
 * 也没必要每天为同一顿午饭去撞一次接口。
 *
 * 境外不走这条路：高德查不到国外（酒店那边实测过 `东京 count = 0`），
 * 所以国外城市直接返回 null，让上层说泛称 —— **宁可能说的少，不要说错的**。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isForeign, type City } from './cities.ts';

export interface EateryPoi {
  readonly name: string;
  /** 高德给的地址。可能为空串。 */
  readonly address: string;
  /** 高德分类，形如 `餐饮服务;中餐厅;火锅店`。空 = 数据源没给。 */
  readonly type: string;
  /** 评分，如 `4.6`。查不到就是空串。 */
  readonly rating: string;
}

interface CacheEntry {
  readonly at: number;
  readonly items: readonly EateryPoi[];
}

/** 七天。店会关门换招牌，但不会七天一换。 */
const CACHE_TTL_MS = 7 * 86_400_000;
const TIMEOUT_MS = 6_000;
const POI_URL = 'https://restapi.amap.com/v3/place/text';
/** 一次拉 10 条，够挑三家了。 */
const PAGE_SIZE = 10;
/** 给她的候选取前三 —— 报一长串像是在念搜索结果。 */
const KEEP = 3;

/**
 * 关了的店不能让她去吃。
 *
 * 和酒店那边同一个理由：高德会把「XX 火锅（暂停营业）」原样返回，
 * 名字里就带着括号备注。不滤掉的话，她会一本正经地走进一家关了门的店。
 */
const CLOSED_WORDS = ['暂停营业', '已关闭', '停业', '装修中', '歇业'];

/**
 * 明显不是吃饭地方的。
 *
 * `types=050000` 是「餐饮服务」大类，但高德的分类并不干净：搜「重庆 火锅」
 * 会混进火锅底料店、食材批发。这几类一眼就不是坐下来吃的地方。
 */
const NOT_EATERY = ['超市', '便利店', '菜市场', '批发', '食材', '底料', '厨具', '餐具', '外卖配送'];

export class EateryDirectory {
  private cache = new Map<string, CacheEntry>();
  private disabled = false;

  constructor(
    private key: string,
    private readonly cacheFile: string,
    private readonly log: (level: 'info' | 'warn', msg: string) => void = () => {},
  ) {
    this.load();
  }

  /** 换 key 要能热生效。 */
  setKey(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.disabled = false;
  }

  get ready(): boolean {
    return this.key.trim().length > 0 && !this.disabled;
  }

  /**
   * 「这座城，想吃这样东西，能去哪几家」。
   *
   * 查不到返回 null —— **调用方必须当成「没有真名可用」**，
   * 而不是「这地方没有火锅店」。
   */
  async find(city: City, dish: string): Promise<readonly EateryPoi[] | null> {
    // 国外高德一条都查不到（酒店那边实测），别浪费一次往返。
    if (isForeign(city)) return null;
    if (!this.ready) return null;

    const want = dish.trim();
    if (!want) return null;

    const key = `${city.id}|${want}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items.length ? hit.items : null;

    const items = await this.fetch(city, want);
    /*
     * 查不到也记一条空的。
     *
     * 不然「在敦煌想吃螺蛳粉」这种注定查不到的组合，每次都会去撞一次接口 ——
     * 七天缓存的用处就在于连失败也一起记住。
     */
    this.cache.set(key, { at: Date.now(), items: items ?? [] });
    this.save();
    return items;
  }

  private async fetch(city: City, dish: string): Promise<readonly EateryPoi[] | null> {
    /*
     * 关键词用「城市 + 想吃的」，`citylimit` 卡在本城。
     *
     * 2026-11-13 实测：`place/text` 查「重庆 火锅」→ `status 1 / count 600`，
     * 返回的是真店名（丁眼镜火锅总店、大彬火锅、春红火锅洪崖洞店），
     * 分类一律 `餐饮服务;中餐厅;火锅店`。这是能用的。
     */
    const params = new URLSearchParams({
      key: this.key,
      types: '050000',        // 餐饮服务
      keywords: `${city.name} ${dish}`,
      city: city.name,
      citylimit: 'true',      // 只要本城的，别把邻市也算进来
      offset: String(PAGE_SIZE),
      page: '1',
      extensions: 'all',      // 要 biz_ext 里的评分
      output: 'JSON',
    });

    let payload: unknown;
    try {
      const res = await fetch(`${POI_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.log('warn', `找店 HTTP ${res.status}，这次按没有处理。`);
        return null;
      }
      payload = await res.json();
    } catch {
      return null;   // 没网很正常，不刷屏
    }

    const o = payload as { status?: string; info?: string; pois?: unknown[] };
    if (o.status !== '1') {
      const info = o.info ?? '';
      if (info.includes('INVALID_USER_KEY') || info.includes('USERKEY')) {
        // key 错了就别再试，否则每次「去吃」都刷一条。
        this.disabled = true;
        this.log('warn', '高德 key 无效，店名改用泛称。');
      } else if (info.includes('CUQPS') || info.includes('LIMIT')) {
        this.log('warn', '找店触发限流，这次按没有处理。');
      }
      return null;
    }
    if (!Array.isArray(o.pois)) return null;

    const out: EateryPoi[] = [];
    for (const raw of o.pois) {
      const p = raw as { name?: unknown; address?: unknown; type?: unknown; biz_ext?: unknown };
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      // 空名、整段地址当名字的、明显不是店名的长句 —— 一律不要。
      if (!name || name.length > 30) continue;
      if (CLOSED_WORDS.some((w) => name.includes(w))) continue;
      if (NOT_EATERY.some((w) => name.includes(w))) continue;
      const ext = (p.biz_ext ?? {}) as { rating?: unknown };
      out.push({
        name,
        address: typeof p.address === 'string' ? p.address.trim() : '',
        type: typeof p.type === 'string' ? p.type.trim() : '',
        rating: typeof ext.rating === 'string' && ext.rating.trim() ? ext.rating.trim() : '',
      });
      if (out.length >= KEEP) break;
    }
    return out.length ? out : null;
  }

  private load(): void {
    if (!existsSync(this.cacheFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.cacheFile, 'utf8').replace(/^\uFEFF/, '')) as unknown;
      if (!raw || typeof raw !== 'object') return;
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const e = v as Partial<CacheEntry>;
        if (typeof e.at !== 'number' || !Array.isArray(e.items)) continue;
        this.cache.set(k, { at: e.at, items: e.items as EateryPoi[] });
      }
    } catch { /* 缓存坏了就当没有 */ }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      const obj: Record<string, CacheEntry> = {};
      for (const [k, e] of this.cache) obj[k] = e;
      const tmp = `${this.cacheFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      renameSync(tmp, this.cacheFile);
    } catch { /* 写不进去不影响旅行 */ }
  }
}
