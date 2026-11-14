/**
 * 真酒店名 —— **查来的，不是编的**。
 *
 * ## 为什么不手写一张表
 *
 * 这个扩展的第一条硬约束是「不许编不存在的地方」。手写「天水 XX 大酒店」看着真实，
 * 但只要那家店不存在（改名了、倒闭了、我记错了），她就把一个假地名当事实说出去了 ——
 * 那是这个项目里最不能犯的错，比「县城宾馆」这种泛称糟得多。
 *
 * 所以走高德的地点库（`place/text`，`types=100000` 住宿服务）。查得到就用真名 + 真地址，
 * 查不到就退回原来的类别描述 —— **宁可能说的少，不要说错的。**
 *
 * ## 和天气共用一套脾气
 *
 * 没 key、没网、超限、城市查不到 —— 一律返回 null，上层照常旅行。
 * 结果按城市缓存七天：一个地方的酒店半年内不会有本质变化，没必要天天查。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isForeign, type City } from './cities.ts';

/** 档次线索。**没有这个字段 ≠ 普通档** —— 那是「数据源没说」。 */
export type TierHint = 'luxury' | 'view' | 'budget' | 'dingy';

export interface HotelPoi {
  readonly name: string;
  /** 高德给的地址。可能为空串。OSM 不给，所以国外基本是空。 */
  readonly address: string;
  /** 人均/起价（元）。查不到就是 null。两个源都给不了。 */
  readonly cost: number | null;
  /** 评分，如 `4.6`。查不到就是空串。 */
  readonly rating: string;
  /**
   * 这家店属于哪一档。`undefined` = 数据源没表态。
   *
   * **必须和 `undefined` 区分开**：老版本没有这个字段，一律走名字猜；
   * 有了它之后，`tier` 说「view」的店绝不会被塞进 budget 档 —— 这正是
   * 「万达酒店（家庭旅店）」那个错配的根源。
   */
  readonly tier?: TierHint;
  /*
   * 下面三项只有本地真实数据才有（`hotel-facts.ts`），高德那条路给不了。
   * 都是可选的：查不到就是没有，不是「没有设施」。
   */
  /** 真实星级（1–5）。TourMind 给的挂牌星级，不是按名字猜的。 */
  readonly star?: number;
  /** 设施，中文短名（`泳池`、`餐厅`）。空 = 这家店没有这一项，或者查不到。 */
  readonly amen?: readonly string[];
  /** 周边能去的地方，带公里数。这就是用户要的「周遭环境」。 */
  readonly around?: readonly { readonly n: string; readonly km: number }[];
}

interface CacheEntry {
  /** 缓存格式版本。不匹配就整个丢掉重查 —— 老条目没有 `tier`。 */
  readonly v?: number;
  readonly at: number;
  readonly items: readonly HotelPoi[];
}

/**
 * 缓存格式版本。**不匹配就整个丢掉重查。**
 *
 * - 2（0.4.1）：带 `tier` 字段
 * - 3（0.4.2）：品牌表扩到 90 个 —— 缓存里存的是**旧表算出来的结果**，
 *   不升版本号的话，升级后七天内她还会按旧表分档，看着像没生效。
 */
const CACHE_VERSION = 3;

/** 七天。酒店会换牌，但不会七天一换。 */
const CACHE_TTL_MS = 7 * 86_400_000;
const TIMEOUT_MS = 6_000;
const POI_URL = 'https://restapi.amap.com/v3/place/text';
/** 一次拉 25 条，够按档次挑了。 */
const PAGE_SIZE = 25;

/**
 * 状态不合格的：关了的店不能让她住。
 *
 * 高德会把「丽都国际大酒店(暂停营业)」原样返回，名字里就带着括号备注。
 * 不滤掉的话，她会一本正经地住进一家已经关门的酒店 —— 那比不写店名荒唐。
 */
const CLOSED_WORDS = ['暂停营业', '已关闭', '停业', '装修中', '歇业'];
/**
 * 明显不是住处的。
 *
 * `types=100000` 是「住宿服务」大类，但高德的分类并不干净：实测搜敦煌会返回
 * 「驼铃餐厅」。真正的酒店叫「XX 饭店」是常见的（那是旅馆的老叫法），
 * 所以只滤「餐厅/咖啡/洗浴」这类一眼不是住的地方。
 */
const NOT_LODGING = ['餐厅', '咖啡', '酒馆', 'KTV', '歌厅', '洗浴', '足疗', '按摩', '超市', '便利店', '停车场', '加油站'];

/**
 * 高档品牌。**数据源没给星级时的第二条腿。**
 *
 * 高德有一半的店 `type` 是泛值（「住宿服务;宾馆酒店;宾馆酒店」），万达酒店就是其中一个。
 * 光看泛值分不出四星还是招待所，但「万达」这两个字本身带档次信息 —— 品牌是免费的先验。
 *
 * ## 收录原则：只放**歧义低**的名字
 *
 * 不放通用词。「假日」「花园」「东方」「广场」这类一律不收 —— 一家县城小旅馆
 * 完全可以自封「假日宾馆」，收了它就会被判成四星，那比不判更糟。
 * 「半岛」「四季」也只收完整四字（「半岛酒店」「四季酒店」），光两个字是地理词。
 */
const LUX_BRANDS = [
  // —— 万豪系 ——
  '丽思卡尔顿', '瑞吉', 'JW万豪', '万豪', '喜来登', '威斯汀', '艾美', 'W酒店',
  '万丽', '傲途格', '万怡', '福朋',
  // —— 希尔顿系 ——
  '华尔道夫', '康莱德', '希尔顿', '逸林',
  // —— 洲际系 ——
  '洲际', '皇冠假日', '英迪格', '华邑', '金普顿', '六善',
  // —— 雅高系 ——
  '索菲特', '费尔蒙', '铂尔曼', '莱佛士', '美爵',
  // —— 凯悦系 ——
  '柏悦', '君悦', '凯悦', '安达仕',
  // —— 其他国际 ——
  '香格里拉', '文华东方', '半岛酒店', '四季酒店', '悦榕', '安缦', '朗廷',
  '温德姆', '华美达', '诺富特',
  // —— 国内 ——
  '开元名都', '金陵饭店', '白天鹅', '锦江饭店', '昆仑饭店', '建国饭店', '南苑饭店',
  '万达嘉华', '万达文华', '万达瑞华', '万达', '花间堂', '松赞',
  '美仑国际', '施柏阁', '禧玥',
  /*
   * —— 国际连锁的**英文名** ——
   *
   * 这组是补漏的：国外城市走 OSM，返回的名字是英文（`Park Hyatt Tokyo`、
   * `Raffles Singapore`），中文品牌表一个都匹配不上 —— 2026-10-31 实测，
   * 东京那 84 家真店名**全部判不出档次**，白拿了一堆数据用不上。
   *
   * 只收专有度高的。`Regent`、`Imperial`、`Aman`、`Grand`、`Plaza`
   * 这类通用词或太短的词不收 —— 世界各地都有本地酒店叫这些名字。
   */
  'hyatt', 'marriott', 'sheraton', 'westin', 'st. regis', 'st regis', 'ritz',
  'four seasons', 'peninsula', 'mandarin oriental', 'shangri-la', 'shangri la',
  'kempinski', 'belmond', 'raffles', 'sofitel', 'pullman', 'fairmont',
  'banyan tree', 'rosewood', 'langham', 'conrad', 'waldorf',
  'intercontinental', 'crowne plaza', 'courtyard',
];

/**
 * 便宜连锁。认得出来就别让它冒充景观房。
 *
 * 经济型和标榜「干净便宜」的中端都在这一组 —— 它们的共同点是**标准化、不靠景**，
 * 跟「景观房」是两回事。中端的类别和价格由 `NAME_KINDS` 单独校正。
 */
const CHEAP_BRANDS = [
  // —— 华住系 ——
  '汉庭', '海友', '怡莱', '全季', '桔子', '星程', '美仑', '亚朵',
  // —— 锦江系 ——
  '锦江之星', '7天', '七天', '维也纳', '丽枫', '麗枫', '喆啡', '希岸', '白玉兰',
  // —— 首旅如家系 ——
  '如家', '莫泰', '和颐', '云上四季',
  // —— 其他国内 ——
  '格林豪泰', '格林东方', '格美', '青皮树', '城市便捷', '宜尚', '柏曼', '隐沫',
  '尚客优', '骏怡', '都市118', '99旅馆', '布丁', '精途', '速8', '速八',
  // —— 国际中端与经济型（英文名，配国外城市） ——
  // `holiday inn express` 要完整匹配：Holiday Inn 本体是四星，只有 Express 那条是经济型。
  'ibis', 'novotel', 'mercure', 'premier inn', 'travelodge', 'best western',
  'motel one', 'easyhotel', 'super 8', 'apa hotel', 'toyoko', 'comfort inn',
  'holiday inn express', 'days inn', 'quality inn',
];

/**
 * 高德 `type` 里的星级。
 *
 * 实测（2026-10-31，天水 25 家）这个字段有真东西：
 * `住宿服务;宾馆酒店;四星级宾馆`、`…;三星级宾馆`、`…;经济型连锁酒店`、`住宿服务;旅馆招待所;旅馆招待所`。
 * 但约一半是泛值 `宾馆酒店;宾馆酒店` —— 那说明高德没标，返回 null 让名字去兜。
 *
 * 多段用 `|` 拼（一家店同时属于住宿和餐饮），取第一段判。
 */
export function tierFromAmapType(type: string): TierHint | null {
  const tierOfSeg = (seg: string): TierHint | null => {
    if (!seg) return null;
    // 五星和「豪华」单列一档（2026-11-06）：高德写得很清楚，别把五星揉进「景观房」。
    if (/五星|豪华/.test(seg)) return 'luxury';
    if (/四星/.test(seg)) return 'view';
    if (/三星/.test(seg)) return 'budget';
    // 经济型连锁（如家、汉庭那种）是普通档，不是小破店 —— 别把干净的连锁店说成招待所。
    if (/经济型/.test(seg)) return 'budget';
    if (/二星|一星/.test(seg)) return 'dingy';
    if (/连锁/.test(seg)) return 'budget';
    if (/招待所|旅馆/.test(seg)) return 'dingy';
    return null;
  };
  /*
   * 一家店可能同时属于好几个类目（`住宿服务;旅馆招待所;…|住宿服务;宾馆酒店;…`），
   * 只看第一段会漏判 —— 实测「天水泰和茂快捷宾馆」第一段是招待所、第二段是宾馆，
   * 名字里还写着「快捷」。所以**每段都判，判出来的互相打架时取中间档**。
   */
  const segs = String(type || '')
    .split('|')
    .map(tierOfSeg)
    .filter((x): x is TierHint => x !== null);
  if (!segs.length) return null;
  return segs.every((s) => s === segs[0]) ? (segs[0] as TierHint) : 'budget';
}

/**
 * 从名字猜档次。**只在数据源没表态时用，而且只认高置信度的词。**
 *
 * 故意**不把「酒店」「宾馆」当 budget 信号** —— 四星级酒店大半也叫「XX 大酒店」，
 * 拿这两个词去猜等于把档次抹平。品牌、特色词（山庄/海景/客栈）、
 * 「招待所」这类才真的带信息。
 */
export function tierFromName(name: string): TierHint | null {
  const raw = String(name || '');
  if (!raw) return null;
  /*
   * **大小写不敏感。** 国外城市走 OSM，返回的是英文名，而且大小写不统一
   * （`Park Hyatt Tokyo` 和 `APA HOTEL SHINJUKU` 都可能出现）。
   * `includes` 区分大小写会白漏一半。中文不受影响 —— `toLowerCase` 对汉字是空操作。
   */
  const n = raw.toLowerCase();
  const hit = (words: readonly string[]): boolean => words.some((b) => n.includes(b.toLowerCase()));
  /*
   * 国际品牌一律当高档（2026-11-06）。
   *
   * 严格说这里混了两层：丽思/瑞吉/华尔道夫是真奢华，福朋/万怡/逸林是中端。
   * 但**名字只能证明「这是个连锁品牌」**，证明不了房价；而把它们拆开需要每家店的真实报价，
   * 现在没有。宁可整体算高档（房价区间本来就宽），也不要按猜的去细分。
   */
  if (hit(LUX_BRANDS)) return 'luxury';
  if (hit(CHEAP_BRANDS)) return 'budget';
  /*
   * 「快捷」「连锁」本身就说明是标准化的小酒店 —— 它们既不是招待所也不是景观房。
   * 实测「天水泰和茂快捷宾馆」的 type 第一段是「旅馆招待所」，
   * 光看分类会把它当小破店，但招牌上写着快捷宾馆。
   */
  if (/快捷|连锁/.test(n)) return 'budget';
  // 「客栈」在丽江是文艺民宿，不是小破店 —— 归高档那一路，不归招待所。
  if (/度假|山庄|庄园|温泉|海景|湖景|观景|客栈|民宿|精品/.test(n)) return 'view';
  if (/招待所|旅社|青旅|青年旅舍|车马店|旅馆/.test(n)) return 'dingy';
  return null;
}

/**
 * 把两路证据合起来。**这一步不做，前面两个函数各自都对，合起来还是会出错。**
 *
 * 三种情况：
 * - 只有一路有结论 → 用它；
 * - 两路一致 → 用它；
 * - **两路打架** → 取中间档 `budget`。典型例子：高德把「天水大酒店」标成「旅馆招待所」
 *   （分类滞后，店挂的是大招牌但设施老旧），名字里的「大酒店」和分类对不上。
 *   这种时候既不能当小破店，也不能当景观房，中间档最不失礼。
 */
export function resolveTier(amapType: string, name: string): TierHint | undefined {
  const byType = tierFromAmapType(amapType);
  const byName = tierFromName(name);
  if (byType && byName) return byType === byName ? byType : 'budget';
  /*
   * 分类说小破店、招牌却挂着「大酒店/国际」——高德这种滞后很常见
   * （店翻新了、换牌子了，分类没跟着改）。实测「天水大酒店」的 type 就是
   * 「旅馆招待所」。当小破店失礼，当景观房离谱，中间档最稳。
   */
  if (byType === 'dingy' && /大酒店|国际|商务/.test(name)) return 'budget';
  return byType ?? byName ?? undefined;
}

/**
 * OSM 的 `tourism` 分类。
 *
 * 比高德干净：它至少有 `guest_house`（家庭旅店）和 `hostel` 这种真正的类型，
 * 不像高德一半店都叫「宾馆酒店」。代价是**没有星级** —— `stars` 标签覆盖率极低，
 * 所以 `tourism=hotel` 一律按普通档算，宁可保守也不把古堡说成快捷酒店。
 */
export function tierFromOsm(type: string): TierHint | null {
  switch (String(type || '')) {
    case 'resort':
    case 'holiday_resort':
    case 'chalet':
      return 'view';
    case 'guest_house':
    case 'bed_and_breakfast':
      return 'budget';
    case 'hostel':
    case 'alpine_hut':
    case 'shelter':
      return 'dingy';
    /*
     * `hotel` / `apartment` / `motel` 故意返回 null。
     *
     * OSM 没有星级（`stars` 标签命中率极低），一个 `tourism=hotel` 可能是五星也可能是
     * 前台只有一个人的小旅馆。硬按「普通档」处理，结果是**国外永远住不到景观房**
     * ——2026-10-31 实测东京 84 家全是 hotel/hostel，`view` 档一家都没有。
     * 留 null 让它参与名字规则（Grand / Palace / 海景那种），至少有机会。
     */
    default:
      return null;
  }
}

/** OSM 的地点检索。免密钥，和国外天气走 Open-Meteo 是同一个思路。 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** 官方使用政策要求带 UA，且**不超过 1 次/秒**。 */
const NOMINATIM_UA = 'coopani-world-journey (desktop companion)';
const NOMINATIM_GAP_MS = 1_100;
/** 视野框半径（度）。0.09 度约 10 公里，够盖住市中心。 */
const OSM_BOX_PAD = 0.09;
/** 分三次查：只查 `hotel` 会漏掉青旅和家庭旅馆。 */
const OSM_QUERIES = ['hotel', 'hostel', 'guest house'] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class HotelDirectory {
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
   * 某个城市的酒店候选。查不到返回 null —— **调用方必须当成「没有真名可用」，
   * 而不是「这个地方没有酒店」。**
   */
  async hotels(city: City): Promise<readonly HotelPoi[] | null> {
    /*
     * 国外走 OSM，国内走高德。
     *
     * 2026-10-31 实测：高德查「东京」的酒店 `count = 0` —— 境外一条都没有，
     * 所以国外城市在这之前一直只说类别（「老城民宿」），从没拿过真店名。
     *
     * 换 OSM 不是因为它质量更好，是因为它**不用密钥、全球覆盖、带类型标签**，
     * 和这个项目里国外天气走 Open-Meteo 是同一个取舍。
     */
    if (isForeign(city)) return this.osmHotels(city);

    if (!this.ready) return null;
    const hit = this.cache.get(city.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.items.length) return hit.items;

    const items = await this.fetch(city);
    if (!items || !items.length) {
      // 查不到就先记一个空的，免得每次排作息表都去撞一次接口。
      this.cache.set(city.id, { at: Date.now(), items: [] });
      this.save();
      return null;
    }
    this.cache.set(city.id, { at: Date.now(), items });
    this.save();
    return items;
  }

  /**
   * OSM 的那条路。
   *
   * 三个约束决定了它长这样：
   * 1. 官方政策是 **1 次/秒**，所以三个关键词之间硬等 1.1 秒 —— 一次查一城要三秒多。
   *    有七天缓存兜着，一天最多也就几个城市新查。
   * 2. 它**不是「全城酒店清单」接口**，是地名搜索：只能拿到「搜 hotel 命中的前 30 个」。
   *    覆盖率不如高德的分类枚举，但真名 + 类型是真的。
   * 3. Overpass（能按 tag 枚举全城）实测端点常年过载 —— 主站 502、两个镜像 45 秒超时，
   *    所以不用它。
   */
  private async osmHotels(city: City): Promise<readonly HotelPoi[] | null> {
    const key = `osm:${city.id}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items.length ? hit.items : null;

    const pad = OSM_BOX_PAD;
    // viewbox 的顺序是 left,top,right,bottom —— 也就是 经度小,纬度大,经度大,纬度小。
    const box = `${city.lon - pad},${city.lat + pad},${city.lon + pad},${city.lat - pad}`;
    const out: HotelPoi[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < OSM_QUERIES.length; i++) {
      if (i > 0) await sleep(NOMINATIM_GAP_MS);
      const url = `${NOMINATIM_URL}?q=${encodeURIComponent(OSM_QUERIES[i])}`
        // limit 给到 50（官方上限）：这是相关性排序，不是按档次枚举，
        // 前 30 条经常只有本地商务酒店，高档那几家排不进来。
        + `&viewbox=${box}&bounded=1&format=json&limit=50`;
      let arr: unknown;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': NOMINATIM_UA },
        });
        if (!res.ok) continue;
        arr = await res.json();
      } catch {
        continue;   // 某一档查不到不影响另外两档
      }
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        const x = raw as { class?: unknown; type?: unknown; name?: unknown };
        // 只要住宿点。`class` 不是 tourism 的（街道、餐厅、地名）一律不要。
        if (x.class !== 'tourism') continue;
        const name = typeof x.name === 'string' ? x.name.trim() : '';
        if (!name || name.length > 40 || seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          address: '',            // OSM 不给门牌，别硬拼一个
          cost: null,             // 价格两个源都没有
          rating: '',             // OSM 没有评分体系
          /*
           * **分类判不出就交给名字。** 这行原来只写了 `tierFromOsm(type)`，
           * 于是 OSM 返回的全是 `tourism=hotel`（分不出档次）→ 一律 undefined，
           * 英文品牌表加进去也接不上 —— 2026-10-31 当场发现的。
           */
          tier: tierFromOsm(String(x.type ?? '')) ?? tierFromName(name) ?? undefined,
        });
      }
    }

    this.cache.set(key, { at: Date.now(), items: out });
    this.save();
    return out.length ? out : null;
  }

  private async fetch(city: City): Promise<HotelPoi[] | null> {
    const params = new URLSearchParams({
      key: this.key,
      types: '100000',        // 住宿服务
      city: city.name,
      citylimit: 'true',      // 只要本城的，别把邻市也算进来
      offset: String(PAGE_SIZE),
      page: '1',
      extensions: 'all',      // 要 biz_ext 里的评分/价格
      output: 'JSON',
    });
    let payload: unknown;
    try {
      const res = await fetch(`${POI_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.log('warn', `酒店查询 HTTP ${res.status}，这次按没有处理。`);
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
        // key 错了就别再试，否则每次排作息都刷一条。
        this.disabled = true;
        this.log('warn', '高德 key 无效，酒店名改用类别描述。');
      } else if (info.includes('CUQPS') || info.includes('LIMIT')) {
        this.log('warn', '酒店查询触发限流，这次按没有处理。');
      }
      return null;
    }
    if (!Array.isArray(o.pois)) return null;

    const out: HotelPoi[] = [];
    for (const raw of o.pois) {
      const p = raw as { name?: unknown; address?: unknown; biz_ext?: unknown; type?: unknown };
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name || name.length > 40) continue;
      if (CLOSED_WORDS.some((w) => name.includes(w))) continue;
      if (NOT_LODGING.some((w) => name.includes(w))) continue;
      const ext = (p.biz_ext ?? {}) as { cost?: unknown; rating?: unknown };
      const cost = Number(ext.cost);
      const amapType = typeof p.type === 'string' ? p.type : '';
      out.push({
        name,
        address: typeof p.address === 'string' ? p.address.trim() : '',
        cost: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : null,
        rating: typeof ext.rating === 'string' && ext.rating.trim() ? ext.rating.trim() : '',
        // 星级优先，少了再用品牌猜，两路打架取中间 —— 见 `resolveTier`。
        tier: resolveTier(amapType, name),
      });
    }
    return out.length ? out : null;
  }

  private load(): void {
    if (!existsSync(this.cacheFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.cacheFile, 'utf8').replace(/^\uFEFF/, '')) as unknown;
      if (!raw || typeof raw !== 'object') return;
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const e = v as Partial<CacheEntry>;
        if (typeof e.at !== 'number' || !Array.isArray(e.items)) continue;
        // 老格式（没有版本号）= 没有 tier，丢掉重查一次。
        if (e.v !== CACHE_VERSION) continue;
        this.cache.set(id, { v: CACHE_VERSION, at: e.at, items: e.items as HotelPoi[] });
      }
    } catch { /* 缓存坏了就当没有 */ }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      const obj: Record<string, CacheEntry> = {};
      for (const [id, e] of this.cache) obj[id] = { v: CACHE_VERSION, ...e };
      const tmp = `${this.cacheFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      renameSync(tmp, this.cacheFile);
    } catch { /* 写不进去不影响旅行 */ }
  }
}

/**
 * 每个档次**不可能**出现的名字。看名字就能否掉的那种。
 *
 * 这张表是 2026-11-07 那两张截图逼出来的：面板上写着
 * 「东晨宾馆（滦河桥路店）（五星级酒店）980」，而那家店 61 块一晚。
 *
 * 只放硬词：「宾馆」「招待所」「公寓」不可能是五星；
 * 「五星」「国际」「大酒店」也不可能是家庭旅店。
 * 模棱两可的（「酒店」「饭店」「中心」）两边都不放 —— 那是要靠别的判据的。
 */
/** 五星档的正向词。 */
/*
 * 奢华档的名字证据（2026-11-09 收紧）。
 *
 * ## 原来这里有「大酒店」和「国际」，两个都不能要
 *
 * Mr.Q 的截图：洛阳那一晚挂的是「汝阳轩源大酒店（温泉度假酒店）· 1350」，
 * 房间里还「带私汤」、楼下游了二十分钟泳。他去携程查同一家店：
 * **二钻、2020 年开业、经济双床房 92 块一晚、30 条点评。**
 *
 * 根因就在这两个词上：中国县城的二钻宾馆十个里八个叫「XX 大酒店」，
 * 还有一堆叫「XX 国际大酒店」—— 它们不区分档次，只区分命名习惯。
 * 把它们当奢华信号，等于把一大把廉价店塞进五星档，然后配上
 * 「温泉度假酒店」这一类名和私汤、泳池这些设施。
 *
 * 现在的判据：**只认真正指向「贵」的词**（星级、豪华、总统、行政套房），
 * 品牌走 `LUX_BRANDS` 那条单独的路。县城「大酒店」不再有任何加成。
 */
const LUXURY_WORDS = ['五星', '豪华', '总统', '行政', '套房', '公馆', '府邸'];

/*
 * **弱信号：见过真五星，也见过二钻。**（2026-11-09）
 *
 * | 名字 | 实际 | 说明 |
 * |---|---|---|
 * | 承德兆丰国际酒店 | 真五星，520 | 「国际」在这里是对的 |
 * | 承德嘉和国际饭店 | 真五星，300 | 同上 |
 * | 汝阳轩源大酒店 | **二钻，92** | 「大酒店」在这里是骗人的 |
 *
 * 光看名字分不出来 —— 所以这两个词**不能单独当证据**，
 * 只在「有真实价格且够贵」时才算数。没价格就退回强词表。
 */
const LUXURY_WEAK = ['国际', '大酒店', '皇冠', '凯宾斯基'];

/**
 * 景观档的正向词。
 *
 * **必须是「这家店沾景观」的证据**，不能只是「一家酒店」——
 * 温泉、度假、山庄、庄园、民宿、客栈、观景、海景、湖景、私汤……
 */
const VIEW_WORDS = [
  '民宿', '客栈', '度假', '山庄', '庄园', '温泉', '景观', '观景', '精品',
  '海景', '湖景', '山景', '私汤', '林海', '木屋', '营地',
];

const TIER_BLOCK: Record<'luxury' | 'budget' | 'view' | 'dingy', readonly string[]> = {
  luxury: [
    '宾馆', '招待所', '旅馆', '旅社', '旅店', '公寓', '招待', '小院', '农家',
    /*
     * **经济连锁不能进五星档。**（2026-11-07）
     *
     * 成都那一池子里，五星档只挑出了一家：`OYO七里香大酒店(站北东街店)`。
     * OYO 是印度的经济型连锁，命中的是「大酒店」三个字 ——
     * 一个「大酒店」的后缀说明不了档次，品牌才说明。
     */
    'OYO', '7天', '七天', '如家', '汉庭', '布丁', '城市便捷', '99优选', '格林豪泰',
    '尚客优', '派酒店', '轻住', '速8', '莫泰', '锦江之星', '宜必思', '青旅', '青年旅舍',
  ],
  view: [
    /*
     * 「宾馆」也不进景观档（2026-11-07）。成都的 `太成宾馆` 被高德标成
     * 舒适型/景观，于是「景观房」后面挂着「太成宾馆」—— 数据错了，名字要能挡。
     * 极少数「XX 国宾馆」级别的会被误伤，那种时候宁可只说类别。
     */
    '宾馆', '招待所', '旅社', '旅馆', '公寓', '农家', '快捷', '连锁', '青年旅舍',
    'OYO', '7天', '七天', '如家', '汉庭', '布丁', '城市便捷', '99优选', '格林豪泰',
    '尚客优', '派酒店', '轻住', '速8', '莫泰', '锦江之星', '宜必思',
  ],
  dingy: ['国际', '大酒店', '五星', '豪华', '山庄', '度假', '精品', '客栈', '民宿', '庄园'],
  budget: ['五星', '豪华', '国际', '大酒店', '总统', '行政', '度假', '山庄', '庄园', '精品', '温泉'],
};

/**
 * 剥掉分店名，只留主名。
 *
 * `东晨宾馆（瀑河桥路店）` → `东晨宾馆`
 * `如家快捷酒店(承德避暑山庄店)` → `如家快捷酒店`
 * `维也纳国际酒店 - 火车站店` → `维也纳国际酒店`
 *
 * 括号和破折号后面跟的是**地名**，不是住宿类型。不剥掉的话，
 * 「避暑山庄店」会让一家快捷酒店命中「山庄」这个度假关键词。
 */
function stemOf(name: string): string {
  return name
    .replace(/[（(][^）)]*[)）]/g, '')
    .replace(/\s*[-—·]\s*[^-—·]*$/, '')
    /*
     * **POI 常常指向酒店的附属设施，不是酒店本身。**（2026-11-07）
     *
     * 成都那一池子里就有「金河宾馆大堂」「博瑞花园酒店宴会厅」——
     * 「大堂」进了便宜档（看着像宾馆，其实是一栋楼的门厅），
     * 「宴会厅」进了景观档（「花园」两字命中了景观关键词）。
     * 这些后缀一律先摘掉，剩下的主名才是这家店。
     */
    .replace(/(大堂|宴会厅|多功能厅|会议厅|餐厅|停车场|前台|售票处|汤泉|水疗|足浴|洗衣)$/g, '')
    .trim();
}

/** 这个名字是不是**明确不属于**这一档。`withHotel` 用它做最后一道闸。 */
export function contradictsTier(name: string, tier: 'luxury' | 'budget' | 'view' | 'dingy'): boolean {
  const stem = stemOf(name);
  return TIER_BLOCK[tier].some((w) => stem.includes(w));
}

/**
 * 按档次挑一家。**纯函数**，测试直接喂数组。
 *
 * 档次和名字对得上才有真实感：「海景房」配一家叫「XX 大酒店」的照样得是景观房，
 * 而 budget 配「XX 度假山庄」就很怪。所以先按关键词缩范围，再按价格排。
 * 一个都对不上就退回随机 —— 真名本身已经比类别强了。
 */
export function pickHotel(
  items: readonly HotelPoi[],
  tier: 'luxury' | 'budget' | 'view' | 'dingy',
  rnd: () => number = Math.random,
): HotelPoi | null {
  /*
   * **先把「不是酒店」的 POI 剔掉。**（2026-11-07）
   *
   * 高德会把酒店的**附属设施**也当 POI 返回：`金河宾馆大堂`、`博瑞花园酒店宴会厅`。
   * 前者进了便宜档（看着像宾馆），后者进了景观档（数据源把它标成高档，名字里又有「花园」）。
   * 让一只鱼「住进大堂」「住进宴会厅」，比住错档次还显眼。
   *
   * 判据只看结尾那几个字 —— 一个真酒店不会叫「XX 酒店停车场」。
   */
  /* 判据看**原始名字**：`stemOf` 已经把「大堂」这种后缀摘掉了，拿它去测永远测不出来。 */
  const whole = items.filter((h) => !/(大堂|宴会厅|多功能厅|会议厅|餐厅|停车场|前台|售票处|汤泉|水疗|足浴|洗衣)$/.test(String(h.name ?? '').trim()));
  if (!whole.length) return null;
  items = whole;
  /*
   * **关键词只看主名，不看括号里的分店名。**（2026-11-07）
   *
   * 起因：承德的「如家快捷酒店(承德避暑山庄店)」被挑进了 `view` 档，
   * 显示成「高档商务酒店 560」—— 因为名字里有「山庄」两个字，
   * 而 `view` 的关键词表把「山庄」当成度假山庄。
   * 那不是住宿类型，是地名。
   *
   * 括号里的部分（`（瀑河桥路店）`、`(避暑山庄店)`、`- 分店`）一律先剥掉再匹配。
   */
  const has = (s: string, words: readonly string[]): boolean => {
    const stem = stemOf(s);
    return words.some((w) => stem.includes(w));
  };
  const words =
    tier === 'luxury' ? [...LUXURY_WORDS, ...LUX_BRANDS]
    : tier === 'view' ? VIEW_WORDS
    : tier === 'dingy' ? ['旅馆', '旅社', '招待所', '旅店', '公寓']
    : ['连锁', '快捷', '酒店', '宾馆', '饭店', '大厦'];
  /*
   * **反向词表：名字里带这些，就一定不是这一档。**（2026-11-07）
   *
   * 起因是用户发来两张截图：她在承德，面板上写着
   * 「东晨宾馆（滦河桥路店）（五星级酒店）980」，而那家店的实际房价是 61 元。
   *
   * 根因在下面 ③ 之前那句兜底：高德没表态的店一律可以捞，
   * 于是一家「宾馆」被挂到了 `luxury` 档的类别上，价格也跟着那档走。
   * 名字是最硬的事实 —— **先按名字排除，再按名字认领。**
   */
  const blocked = TIER_BLOCK[tier];

  /*
   * ① 数据源明确说了「就是这一档」的，优先，而且**不再看名字**。
   *
   * 这是 2026-10-31 那个「天水万达酒店（家庭旅店）」的直接修法：
   * 高德的 type 里写着四星级，就该一直待在 view 档，
   * 而不是因为名字里有个「酒店」就被拽去跟家庭旅店配对。
   */
  /*
   * 数据源说了档次，但**名字自己就在反驳**的那几家也不要。
   *
   * 成都实测：`太成宾馆` 被高德标成了「舒适型/景观」，于是「景观房」那一档
   * 挂出一家「太成宾馆」。数据优先是对的，但「宾馆」和「景观房」凑在一起，
   * 用户第一眼就是不对 —— 数据错了要能被名字挡住。
   */
  const exact = items.filter((h) => {
    if (h.tier !== tier) return false;
    if (has(h.name, blocked)) return false;
    /*
     * **景观档必须真的沾景观。**（2026-11-07）
     *
     * 携程核实：高德把 `万峰酒店`（经济型，¥118，住宅楼里的公寓式酒店）、
     * `绿洲大酒店`（市区 4 钻商务）都标成了「景观」，于是「景观房」后面挂着
     * 一家市中心商务酒店。名字里没有温泉/度假/山庄/民宿/海景这类词，
     * 就不是景观房 —— 宁可不挂名字。
     */
    /*
     * **有真实价格时，不再强求景观词。**（2026-11-09）
     *
     * 原来这条是无条件的：名字里没有景观/度假/山庄/海景，就不许进景观档。
     * 它当时防的是高德乱标 —— `万峰酒店`（经济型 ¥118）被标成「景观」。
     *
     * 但现在档次是**同城价格分位**算出来的（见 `hotel-facts.ts`），不是数据源标的。
     * 成都实测：分位落在中上的四家是「维也纳酒店」「丽橙酒店·逸」「如家商旅」——
     * 全都是连锁商务，一个景观词都没有，于是**整个景观档一个都挑不出来**。
     *
     * 判据：**有价格就用价格，没价格才用名字兜底。** 价格是硬的，名字是软的。
     */
    if (tier === 'view' && !(typeof h.cost === 'number' && h.cost > 0) && !has(h.name, VIEW_WORDS)) return false;
    /*
     * 五星档三道闸（2026-11-09 补齐，原来只有价格下限一道）。
     *
     * 起因见 `LUXURY_WORDS` 上面那段：高德没给价格的店会绕过价格下限，
     * 于是一家二钻宾馆（数据源标成高档）顺利进了五星档。
     *
     * 现在的规则：
     * - 有价格且不到 300 → 不是五星；
     * - 有价格且够 300 → 认（真金白银比名字可靠）；
     * - **没价格** → 名字必须有奢华痕迹（星级词或品牌），否则不挂。
     *   宁可这一晚只说「高档商务酒店」，也不让「XX 大酒店」冒充。
     */
    if (tier === 'luxury') {
      const priced = typeof h.cost === 'number' && h.cost > 0;
      if (priced && h.cost < 300) return false;
      if (!priced && !has(h.name, LUXURY_WORDS) && !has(h.name, LUX_BRANDS)) return false;
    }
    return true;
  });
  if (exact.length) return pickFromPool(exact, tier, rnd);

  /*
   * ② 数据源没表态的（高德一半的店、OSM 的多数店），按名字猜 —— 老逻辑。
   */
  const silent = items.filter((h) => !h.tier && !has(h.name, blocked));
  /*
   * **五星档的名字匹配分强弱**（2026-11-09）。
   *
   * 强词（星级、豪华、总统套房）和品牌自己就能证明；
   * 「国际」「大酒店」只在**报得出价、且够贵**的时候才算 ——
   * 否则「汝阳轩源大酒店」（二钻 92 块）就会被当成五星。
   */
  let matched = tier === 'luxury'
    ? silent.filter((h) => has(h.name, LUXURY_WORDS)
        || has(h.name, LUX_BRANDS)
        || (has(h.name, LUXURY_WEAK) && typeof h.cost === 'number' && h.cost >= 300))
    : silent.filter((h) => has(h.name, words));
  /*
   * 一个都对不上时的兜底。
   *
   * `dingy` 不能随手抓一个 —— 实测丽江会挑到「古城城南旧事客栈」，
   * 那不叫小破店，那叫文艺。所以兜底时先排掉明显不像便宜店的词，
   * 排空了才退回全部（宁可挑错，不能挑不到）。
   */
  if (!matched.length && tier === 'dingy') {
    const fancy = ['国际', '大酒店', '山庄', '度假', '精品', '客栈', '民宿', '公寓', '庄园'];
    /* 同样只看主名 ——「承德宾馆（避暑山庄店）」不是度假山庄。 */
    matched = silent.filter((h) => !fancy.some((w) => stemOf(h.name).includes(w)));
  }
  if (matched.length) return pickFromPool(matched, tier, rnd);
  /*
   * 兜底只留给 `budget`。
   *
   * 「宾馆 / 饭店 / 大厦」这类名字在任何城市都是一大把，随便抓一个当
   * 「快捷连锁」说不算错。反过来，`luxury` 随手抓一个就是
   * 「东晨宾馆（五星级酒店）」—— 那不是不具体，那是错的。
   */
  if (tier === 'budget' && silent.length) return pickFromPool(silent, tier, rnd);

  /*
   * ③ 全都明确是别的档次 —— **不硬配，返回 null。**
   *
   * 这条是这次改动的核心。以前这里 `return 全部` 兜底，结果是
   * 「四星级万达酒店」被配给「家庭旅店」。现在的取舍是：
   * **宁可这一晚只说类别（「快捷连锁」），也不让真名和档次打架。**
   * 一个城市全是高档店时，她那一晚就只说「家庭旅店」——
   * 那至少是自洽的，而不自洽比不具体糟得多。
   */
  return null;
}

/** 从已经筛好的池子里挑一家：贵的档次挑贵的，其余挑便宜的；同价随机。 */
function pickFromPool(
  pool: readonly HotelPoi[],
  tier: 'luxury' | 'budget' | 'view' | 'dingy',
  rnd: () => number,
): HotelPoi {
  const sorted = [...pool].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
  if (tier === 'view' || tier === 'luxury') {
    /*
     * 挑贵的，**但不是永远挑最贵那一家**。
     *
     * 一个城市里的高档店常常只有两三家，每次都取第一名，她就会连着几晚
     * 住同一间房 —— 在同一个城市住几天是同一家（那是合理的），
     * 但跨城市/第二趟还撞上同一家就很假。所以在最贵的三家里随机。
     */
    const top = sorted.slice(Math.max(0, sorted.length - 3));
    return top[Math.floor(rnd() * top.length) % top.length] as HotelPoi;
  }
  const n = Math.max(1, Math.min(sorted.length, 6));
  return sorted[Math.floor(rnd() * n) % n] as HotelPoi;
}
