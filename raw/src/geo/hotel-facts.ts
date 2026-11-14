/*
 * 真实酒店数据（2026-11-09）。
 *
 * ## 这是什么
 *
 * `data/hotel-facts.json` 是用 `tools/fetch-hotel-facts.mjs` 从 TourMind 拉下来的
 * 真店数据：星级、真实房价、结构化设施、周边景点（带距离）。
 *
 * ## 为什么要它
 *
 * 之前所有酒店信息都是**猜**的：档位看名字里有没有「大酒店」「国际」，
 * 设施按模板写「温泉度假酒店·带私汤」。用户去携程一查，二钻、92 块、
 * 只有餐厅和停车场 —— 两次返工都栽在这上面。
 *
 * Mr.Q 2026-11-09：「你就让子agent去查查 185 座城市的酒店呗，
 * 把它有什么设施、活动都全部查清楚嘛，以后别再返工了。」
 *
 * ## 覆盖率（实测，1052 家）
 *
 * | 档 | 有真实设施 |
 * |---|---|
 * | 5 星 | 87% |
 * | 4 星 | 64% |
 * | 3 星 | 51% |
 * | 2 星 | 26% |
 *
 * **二钻低不是缺陷，是事实** —— 小旅馆本来就没有泳池温泉。
 * 所以「查不到」和「确实没有」在处理上是一回事：不写公共设施，只说房间内部。
 */

import { readFileSync } from 'node:fs';
import type { HotelPoi } from './hotels.ts';

/** 一城一条。字段名和抓取脚本的输出对齐，改脚本时这里要一起改。 */
interface HotelFact {
  readonly id: string;
  readonly name: string;
  readonly star: number;
  readonly price: number;
  readonly addr: string;
  readonly flags: readonly string[];
  readonly amen: readonly string[];
  readonly around: readonly { readonly n: string; readonly km: number }[];
}

interface CityFacts {
  readonly regionId: string;
  readonly regionName: string;
  readonly poolSize: number;
  /**
   * 全城搜到的店（只有名字/星级/价，没有详情）。
   *
   * **分位要用它的价格算，不是用 `hotels`。**
   * 2026-11-09 踩：一开始拿「已采详情的 13 家」算分位，
   * 西安最贵的那家恰好没采到，于是 306 元的智选假日被划进豪华档 ——
   * 因为在那 13 家里它就是最贵的。分档的参照系应该是**这一城的全部店**。
   */
  readonly pool?: readonly { readonly price: number }[];
  readonly hotels: readonly HotelFact[];
}

let cache: Record<string, CityFacts> | null = null;

function load(): Record<string, CityFacts> {
  if (cache) return cache;
  try {
    const raw = readFileSync(new URL('../../data/hotel-facts.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { cities?: Record<string, CityFacts> };
    cache = parsed.cities ?? {};
  } catch {
    /*
     * 文件不在就当没有 —— 老版本装上来、或者用户删了数据文件，
     * 都应该退回到「不挂真名」的行为，而不是崩掉。
     */
    cache = {};
  }
  return cache;
}

/*
 * ## 分档为什么按价格，不按星级（2026-11-09，实测之后改的）
 *
 * 一开始照 `star_rating` 分：5 星 luxury、4 星 view、3 星 budget、≤2 星 dingy。
 * 采完 1710 家一看，**星级字段有大量错标**：
 *
 * | 店 | 上游标 | 真实价 |
 * |---|---|---|
 * | 纽约市中心希尔顿康拉德 | **0 星** | 13677 |
 * | 福州速住酒店 | **5 星** | 111 |
 * | 索拉利亚西铁酒店银座东京 | 1 星 | 1826 |
 *
 * 按星级分的结果是「1826 元的银座酒店住进小破店档，描述里写箱子摊不开」——
 * 用户一眼就看出假。
 *
 * 档位的语义本来也不是「挂牌几星」，是**「这一晚在本地算什么水平」**。
 * 所以改成同城价格分位：最便宜的四分之一是 dingy，往上依次 budget / view / luxury。
 *
 * 星级只在价格缺失时兜底（有价就按价）。
 */
function tierFromPrices(prices: readonly number[]): (price: number) => 'luxury' | 'view' | 'budget' | 'dingy' | undefined {
  const sorted = [...prices].sort((a, b) => a - b);
  if (!sorted.length) return () => undefined;
  const q = (p: number) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]!;
  const q25 = q(0.25);
  const q50 = q(0.5);
  const q75 = q(0.75);
  return (price) => {
    if (!(price > 0)) return undefined;
    if (price <= q25) return 'dingy';
    if (price <= q50) return 'budget';
    if (price <= q75) return 'view';
    return 'luxury';
  };
}

/** 没价格时退回星级 —— 聊胜于无，比不分档强。 */
function tierOfStar(star: number): 'luxury' | 'view' | 'budget' | 'dingy' | undefined {
  if (star >= 5) return 'luxury';
  if (star === 4) return 'view';
  if (star === 3) return 'budget';
  if (star >= 1) return 'dingy';
  return undefined;
}

/**
 * 这座城市有哪些真店。
 *
 * 返回 `HotelPoi` 的形状（`pickHotel` 直接能吃），但**多带三样东西**：
 * `star`（真星级）、`amen`（设施）、`around`（周边）。
 * 这三样是本地数据独有的，高德那条路给不了。
 */
export function factsFor(cityId: string): HotelPoi[] {
  const city = load()[cityId];
  if (!city?.hotels?.length) return [];
  const rows = city.hotels.filter((h) => h.name);
  /*
   * **分位只按「能挑的这几家」算，不按全池。**（2026-11-09 第二次改，方向相反）
   *
   * 先用全池 20 家算过一次，理由是「参照系该是全城」。结果是**某些档挑不出店**：
   * 天水池子 20 家按分位切成四段，可我们只采了 10 家的详情，
   * 落到某一段的一家都没有 —— `pickHotel` 返回 null，那一档永远不挂真名。
   *
   * 分位的作用是「在这一批店里分出四档」，前提是**这一批就是候选集**。
   * 采样偏差（西安最贵那家没采到，306 就被当豪华）改用 `withHotel` 里的
   * 价格比值窗口兜底 —— 那儿的判据是「真价 vs 这一档该花多少」，
   * 比在数据层做二次修正直接。
   */
  const tierOf = tierFromPrices(rows.map((h) => h.price).filter((p) => p > 0));
  const out: HotelPoi[] = [];
  for (const h of rows) {
    out.push({
      name: h.name,
      address: h.addr || '',
      /* 有价就是真价（TourMind 的 `min_price`）。0 表示没查到，不能当「免费」。 */
      cost: h.price > 0 ? h.price : null,
      rating: '',
      tier: tierOf(h.price) ?? tierOfStar(h.star),
      star: h.star,
      /*
       * **这里的 `amen` 是英文 key（`pool` / `onsen` / `restaurant`），不是中文标签。**
       *
       * 2026-11-09 踩：抓取脚本存了两份 —— `flags` 是 key，`amen` 是中文标签（`泳池`）。
       * 我一开始接的是中文那份，而 `AMEN_LINES` 的键是英文，于是一个都匹配不上，
       * 结果**所有描述里永远不出现设施**，测试却是绿的（因为测的是「不要提没有的」）。
       * 判据：接了数据之后要**读一遍输出**，别只看断言。
       */
      amen: h.flags ?? [],
      around: h.around,
    });
  }
  return out;
}

/** 这座城有没有真实数据。给 UI 和测试用。 */
export function hasFacts(cityId: string): boolean {
  return (load()[cityId]?.hotels?.length ?? 0) > 0;
}
