/**
 * 住哪儿 —— 掷骰子，不是每次找最好的。
 *
 * 概率按需求定：普通 2-4 星约 60%，四星以上景观房约 40%，小破店不到 1%。
 * 但三者相加不能超过 100%，所以实际取 60 / 39.5 / 0.5 —— 小破店确实「<1%」，
 * 而且是真的会出现：**一个半年都在外面的人，不可能一次住差的都没有。**
 * 那晚的日记难看，才是这个功能有重量的地方。
 *
 * ## 店名从哪来
 *
 * **不手写。** 这个扩展的第一条硬约束是「不许编不存在的地方」—— 手写「天水 XX 大酒店」
 * 看着真实，但那家店只要不存在（改名、倒闭、我记错），她就把一个假地名当事实说出去。
 *
 * 所以真名走 `geo/hotels.ts` 查高德的地点库；查不到就退回**类别**
 * （快捷连锁 / 老式招待所 / 山景民宿），她自己会把它写成一个地方。
 * **宁可能说的少，不要说错的。**
 */

import { contradictsTier, pickHotel, type HotelPoi } from '../geo/hotels.ts';

/**
 * 四档。`luxury` 是 2026-11-06 加的 ——
 *
 * 一位用户来信：「舍不得我家小鱼吃苦……劝了好久才换了个好的酒店」。
 * 原来最高只到「景观房」，想让她住好一点，用户只能一遍遍劝。
 * 现在她自己会在手头宽的时候挑高档的，跟座位档一个道理。
 */
export type LodgingTier = 'budget' | 'view' | 'luxury' | 'dingy';

/**
 * 池子里的一项住处。
 *
 * `weight` 是**相对出现频率**，不给就是 1。2026-11-08 加的 —— 起因是
 * 「高档池四项等概率」：现实里住高档的人八成住标准间，只有极少数住套房，
 * 而均匀抽取让套房变成了常态（`pick` 实现没错，错的是频率假设）。
 */
type PoolItem = Omit<Lodging, 'tier'> & { readonly weight?: number };

export interface Lodging {
  readonly tier: LodgingTier;
  /** 类别，不是店名。写日记时可以直接用。 */
  readonly kind: string;
  /** 真实店名（高德查到的）。**查不到就没有** —— 那就只说类别。 */
  readonly name?: string;
  /** 真实地址，跟着店名一起来。可能为空串。 */
  readonly address?: string;
  /** 一晚大概多少钱（人民币）。给她一个「这回花得值不值」的锚。 */
  readonly price: number;
  /** 体感，给模型的判断依据。 */
  readonly feel: string;
  /**
   * 这家店真有的设施（`pool` / `gym` / `spa` / `bar` / `onsen`…）。
   *
   * 2026-11-09 加。有了它，晚上「在酒店干什么」就不用按档位猜了 ——
   * 按 `tier` 猜的话，五星档一律给泳池，可那家店可能只有健身房。
   */
  readonly amen?: readonly string[];
  /** 周边能去的地方（名字 + 公里）。晚上「出门转转」靠它判断远近。 */
  readonly around?: readonly { readonly n: string; readonly km: number }[];
}

/*
 * 普通档。
 *
 * ## 2026-11-08 上调两成（真实报价校准）
 *
 * 原价 220/130/160/150 是按「大概这个数」定的。用 TourMind 实采（入住 11-17 一晚、
 * 一间、人民币）对了一遍，发现**一线和低线都偏低两成**：
 *
 * | 城市 | 原来的中位 | 实采 2–3 星中位 |
 * |---|---|---|
 * | 北京（×2.0） | 320 | 约 400 |
 * | 上海（×2.1） | 340 | 约 380 |
 * | 天水（×0.56） | 90 | 115 |
 *
 * 两边同向偏低，说明是**基准**错了，不是城市系数错了 —— 系数只负责拉开城际差距，
 * 绝对高度由基准定。所以整体乘 1.2，系数一个不动。
 *
 * 另一个佐证：北京的快捷连锁（如家/汉庭）实价 350–450，原价 220×2=440 只覆盖最贵的
 * 那几家，普通门店够不着。
 */
const BUDGET: readonly PoolItem[] = [
  { kind: '快捷连锁', price: 260, feel: '干净、标准、窗外是对面楼的墙；洗澡水大，隔音一般。' },
  { kind: '老式招待所', price: 160, feel: '木头门、走廊尽头的公用开水房，服务员是本地口音；床硬，但安静。' },
  { kind: '家庭旅店', price: 195, feel: '老板一家住在一楼，会问你明天去哪；房间小，有个能晾衣服的窗台。' },
  { kind: '县城宾馆', price: 185, feel: '大堂很大、电梯很旧，早餐是稀饭咸菜和煮鸡蛋。' },
];

const VIEW: readonly PoolItem[] = [
  { kind: '山景房', price: 600, feel: '窗一推开就是山，早上有雾从谷里升上来；房价里有一半是那扇窗。' },
  { kind: '海景房', price: 1200, feel: '阳台正对海，夜里能一直听见浪；早上太阳从水面出来。' },
  { kind: '老城民宿', price: 520, feel: '院里有棵老树，房间是木结构，晚上能听见隔壁的脚步。' },
  { kind: '湖景客栈', price: 620, feel: '窗下就是水，早上有人划船过去；老板娘会煮一壶本地茶。' },
  { kind: '改造的老宅', price: 750, feel: '老砖墙留着，里面全换了；灯光暖，人一进去就不想出门。' },
];

/*
 * 高档。
 *
 * 价格按 2026-11-06 查的实价：高档品牌（万豪/希尔顿/洲际）一线 850–1500、
 * 二三线 550–1000；奢华（丽思/四季/安缦）1800–4000。这里取中间值，
 * 再乘城市价格指数 —— 所以县城不会出现「两千八一晚」。
 *
 * ## 2026-11-08 重定：价格下调 + 加权重（真实报价校准）
 *
 * 实采（TourMind，入住 11-17 一晚）对了一遍，两个问题：
 *
 * | 城市 | 原来的中位 | 实采五星中位 |
 * |---|---|---|
 * | 北京（×2.0） | 2360 | 1606 |
 * | 上海（×2.1） | 2480 | 1620 |
 * | 三亚（×2.2） | 2600 | 630 |
 *
 * **一是绝对价高了四五成**：真实五星在二线 550–800、一线 1500–2000，
 * 而原来池子的中位是「行政套房」的价（2200），不是「五星标准间」的价。
 *
 * **二是分布错了**：四项等概率，意味着她住高档的四次里有三次是
 * 高层城景/套房/温泉 —— 而现实中绝大多数人住的就是标准间。
 * 加了 `weight` 之后，标准间占一半，套房和温泉各占八分之一。
 *
 * 这个错误不容易在代码上看见：`pick` 均匀取一项是「实现正确」的，
 * 错的是**数据假设**（假设四类住处的出现频率相同）。
 *
 * 不写具体品牌名：写了「万豪」，而那个县城根本没有万豪，就是编。
 * 品牌留给高德查到的真名（`name` 字段），查不到时只说类别。
 */
const LUXURY: readonly PoolItem[] = [
  { kind: '五星级酒店', price: 780, weight: 4, feel: '大堂挑高，行李有人接；房间隔音好到听不见走廊，床垫陷下去半寸。' },
  { kind: '高层城景房', price: 980, weight: 2, feel: '三十层往上，整座城摊在窗下；夜里关灯看灯，比白天好看。' },
  { kind: '行政套房', price: 1800, weight: 1, feel: '里外两间，客厅有沙发和写字台；早餐在行政酒廊，人少、安静。' },
  { kind: '温泉度假酒店', price: 1350, weight: 1, feel: '房间里带私汤，水一直放着；泡完直接裹着浴衣睡，不想到处走。' },
];

const DINGY: readonly PoolItem[] = [
  { kind: '车站旁的小旅馆', price: 60, feel: '走廊灯一闪一闪，热水要等，窗外整夜有喇叭声。' },
  { kind: '通铺改的单间', price: 45, feel: '床单有别人的味道，门锁是挂锁，半夜有人敲门走错了。' },
];

/*
 * 国外那一套（2026-11-07 加，欧洲 37 城之后）。
 *
 * ## 为什么非分不可
 *
 * 上面四张池子全是**中国的住处**：快捷连锁、老式招待所、县城宾馆、
 * 湖景客栈、改造的老宅。这些词在中国都对，但她在柏林住进「县城宾馆」
 * 就是笑话 —— 而这不是小概率：`rollLodging` 对每座城都掷一次，
 * 出了国的每一天都在这四张池子里挑。
 *
 * ## 价格怎么定的
 *
 * 基础价按欧洲/北美的实际中位数往回折（除以当地 `priceIdx`），
 * 这样乘回去之后，柏林的一间连锁经济酒店落在五百多、一栋老牌大酒店
 * 落在两千上下 —— 和查到的实价对得上。
 *
 * ## 不写具体品牌
 *
 * 和国内那套一样：写了「宜必思」，而那个小镇没有宜必思，就是编。
 * 真名只从地图 POI 来（`name` 字段），查不到就只说类别。
 */
const BUDGET_ABROAD: readonly PoolItem[] = [
  { kind: '家庭旅馆', price: 550, feel: '一栋老公寓改的，钥匙挂在一块木牌上；楼梯窄，早餐在二楼，面包、黄油和煮蛋。' },
  { kind: '青年旅舍六人间', price: 220, feel: '上下铺，同屋的人半夜才回来；公共厨房的墙上贴着上一位住客留的便条，淋浴要排队。' },
  { kind: '连锁经济酒店', price: 650, feel: '房间小得刚好放下一张床，窗对着内院；前台 24 小时有人，干净得像样板间。' },
  { kind: '老楼里的单间', price: 480, feel: '电梯是那种要自己拉铁门的，走廊很暗；房间层高，天花板有石膏线，家具是旧的。' },
];

const VIEW_ABROAD: readonly PoolItem[] = [
  { kind: '老城景观房', price: 1050, feel: '窗对着广场或者教堂尖顶，早上被钟声叫醒；房间在老楼顶层，木梁露在外面。' },
  { kind: '湖景房', price: 1000, feel: '阳台正对湖面，早上有雾从水上起来；房间是浅色木头的，暖气很足。' },
  { kind: '海景房', price: 900, feel: '窗推开就是海，栏杆是铁的；夜里能一直听见浪，白天风大。' },
  { kind: '山景房', price: 900, feel: '窗对着雪线以上的岩壁，早上第一缕光正照在那上面；被子很厚。' },
];

const LUXURY_ABROAD: readonly PoolItem[] = [
  { kind: '老牌大酒店', price: 1650, feel: '大堂有大理石柱子和穿制服的门房，电梯是木头的；走廊安静，地毯厚得听不见脚步。' },
  { kind: '设计酒店', price: 1500, feel: '房里是定制家具和藏起来的灯带，浴缸就在窗边；前台给一张手绘的街区地图。' },
  { kind: '高层城景房', price: 1700, feel: '二十几层，整座城铺在窗下，夜里是一片橘黄的灯；隔音好到听不见街。' },
];

const DINGY_ABROAD: readonly PoolItem[] = [
  { kind: '车站旁的小旅馆', price: 300, feel: '楼梯上铺着磨破的地毯，走廊灯是声控的；窗外整夜有电车经过的声音。' },
  { kind: '地下室改的房间', price: 260, feel: '半地下的窗只露出人行道的高度，白天也要开灯；床垫塌下去一块。' },
];

/**
 * 这座城有什么地形。**决定「景观房」里哪些词能用。**
 *
 * 2026-11-07 加。原来是四张固定的池子，景观房四选一 ——
 * 于是柏林能开出「山景房」（窗外是阿尔卑斯那样的雪线岩壁），
 * 而柏林方圆一百公里最高的东西是电视塔。
 *
 * 这不是审美问题：**她住了，还会跟用户描述那扇窗**。
 * 用户去过柏林，一眼就知道没有那座山。
 */
export interface Terrain {
  readonly sea: boolean;
  readonly mountain: boolean;
  readonly lake: boolean;
}

/** 这一类房间要什么地形才成立。 */
function fitsTerrain(kind: string, t: Terrain | undefined): boolean {
  if (!t) return true;
  if (kind.includes('海景')) return t.sea;
  if (kind.includes('山景')) return t.mountain;
  if (kind.includes('湖景')) return t.lake;
  return true;
}

const SCENIC = /海景|山景|湖景/;

/**
 * 按「在不在中国」取四张池子，并按地形筛掉不成立的那几间。
 *
 * 判据交给调用方（它手上有 `country` 和城市数据），这个文件不认识城市表 ——
 * 住宿只关心「哪一套词更像话」。
 */
const poolsOf = (abroad: boolean, terrain?: Terrain) => {
  const base = abroad
    ? { budget: BUDGET_ABROAD, view: VIEW_ABROAD, luxury: LUXURY_ABROAD, dingy: DINGY_ABROAD }
    : { budget: BUDGET, view: VIEW, luxury: LUXURY, dingy: DINGY };
  if (!terrain) return base;
  const kept = base.view.filter((x) => fitsTerrain(x.kind, terrain));
  /*
   * 一间不剩的时候不能用空池子（`pick` 会取到 undefined）。
   * 退回「不带景观词」的那几间：老城民宿、改造的老宅、老城景观房。
   */
  const view = kept.length ? kept : base.view.filter((x) => !SCENIC.test(x.kind));
  return { ...base, view: view.length ? view : base.view };
};

/**
 * 国外的价格系数要压一档。
 *
 * ## 为什么不能直接乘 `priceIdx`
 *
 * `priceIdx` 是**相对国内的倍数**：纽约 11.1、巴黎 5.5、布拉格 2.0。
 * 国内的池子拿它乘是对的（国内基准价就是按国内中位定的）。
 * 但国外的池子**已经是当地实价（人民币）**了 —— 再乘一遍 5.5，
 * 巴黎一间家庭旅馆变成 1430 一晚、纽约的设计酒店变成 11100 一晚，
 * 比真实贵两三倍。这就是「双重计价」。
 *
 * ## 这条曲线怎么来的
 *
 * 用几个已知城市的真实价反推出来的相对倍数（以西欧 = 1.0）：
 * 布拉格 0.55、布达佩斯 0.5、莫斯科 0.6、东京 0.95、纽约 1.5、巴黎 1.0。
 * 线性拟合 `0.28 + 0.13 × priceIdx` 正好穿过这几个点：
 * 2.0 → 0.54、3.8 → 0.77、5.5 → 1.0、11.1 → 1.72（截到 1.6）。
 */
export function abroadFactor(priceIdx: number): number {
  return Math.max(0.32, Math.min(1.6, 0.28 + 0.13 * priceIdx));
}

/**
 * 按权重从池子里取一项。
 *
 * **全部权重都是默认值时，走老路径**（`floor(rnd × length)`）——
 * 一个数都不动，所以既有测试和海外那套实测校准完全不受影响。
 * 只有显式写了 `weight` 的池子（目前只有高档那一张）才按权重抽。
 */
const pick = <T extends { weight?: number }>(list: readonly T[], rnd: () => number): T => {
  const total = list.reduce((a, x) => a + (x.weight ?? 1), 0);
  if (total === list.length) return list[Math.floor(rnd() * list.length) % list.length]!;
  let r = rnd() * total;
  for (const x of list) {
    r -= (x.weight ?? 1);
    if (r <= 0) return x;
  }
  return list[list.length - 1]!;
};

/**
 * 按城市价格指数缩放。
 *
 * 取整到十位：小数位是噪音（「3612 元」不如「3610 元」读着像话）。
 * 下限 20 元，免得极端系数把小破店压成负数。
 */
const scaleNum = (price: number, idx: number): number =>
  idx === 1 ? price : Math.max(20, Math.round((price * idx) / 10) * 10);

/**
 * 小破店的价格地板。
 *
 * ## 为什么单给它一条地板（2026-11-08）
 *
 * 池子里的 60 / 45 是乘系数**之前**的价，乘完就出事：
 *
 * | 城市 | 系数 | 算出来 | 实际最低 |
 * |---|---|---|---|
 * | 天水 | 0.56 | **30 元** | 101 |
 * | 成都 | 1.0 | 60 元 | 99 |
 *
 * 三十块一晚的房间在 2026 年不存在 —— 那不是「住得差」，那是数据错了。
 *
 * ## 地板为什么是 85，不是 100
 *
 * 携程/Booking 上正规挂出来的最低价是 100 上下（青旅单间、车站小旅社）。
 * 但**站前那种不挂网的私人小旅馆确实更便宜**，六七十块是有的 ——
 * 用户自己说过「小宾馆估计只能在携程上搜，或者网上根本找不到」。
 * 所以地板定 85：比 OTA 最低略低一点，承认那部分线下房源存在，
 * 但不再出现两位数。
 *
 * 只作用于 `dingy` 这一档，其余档位本来就在它之上。
 */
const DINGY_FLOOR = 85;

const withFloor = (tier: LodgingTier, price: number): number =>
  tier === 'dingy' ? Math.max(DINGY_FLOOR, price) : price;

/**
 * 掷一间房。
 *
 * 分界用 `0.600` / `0.995`：前者是需求给的 60%，后者让差店占 0.5%。
 * 别改成 0.99 —— 那样差店就变成 1%，越过了「<1%」这条线。
 *
 * `priceIdx` 是城市的价格指数（见 `cities.ts`）。**默认 1 时行为完全不变**，
 * 所以老测试不用改；只有传了城市的指数，价钱才会跟着城市走。
 */
export function rollLodging(
  rnd: () => number = Math.random,
  poor = false,
  priceIdx = 1,
  /**
   * 手头宽不宽（余钱 ÷ 一天的房钱，够住十天以上算宽）。
   *
   * 这是「她自己判断住哪档」的唯一环境输入，和座位档用的是同一套思路：
   * 宽的时候才舍得，不宽的时候住得下去就行。
   */
  rich = false,
  /** 在不在中国。`false` = 国内那套词（默认，老调用方不用改）。 */
  abroad = false,
  /**
   * 这座城有什么地形。不传 = 不筛（老调用方一个参数都不用改）。
   *
   * 传了之后，海景房要有海、山景房要有山、湖景房要有湖。
   */
  terrain?: Terrain,
): Lodging {
  const P = poolsOf(abroad, terrain);
  /* 国外的池子是当地实价，系数要压一档 —— 理由见 `abroadFactor`。 */
  const scale = abroad ? abroadFactor(priceIdx) : priceIdx;
  const r = rnd();
  const raw = ((): Lodging => {
    // 穷的时候不是不掷，是**换一支骰子**：景观房从四成压到两成，
    // 便宜房优先挑价低的，差店概率抬到 1%。
    // 这样「钱紧」表现为日子变窄，而不是突然住不起 —— 后者会让人觉得系统坏了。
    if (poor) {
      if (r < 0.790) {
        const cheap = [...P.budget].sort((a, b) => a.price - b.price);
        return { tier: 'budget', ...pick(cheap, rnd) };
      }
      if (r < 0.990) return { tier: 'view', ...pick(P.view, rnd) };
      return { tier: 'dingy', ...pick(P.dingy, rnd) };
    }
    /*
     * 宽裕：高档 18%、景观 42%、普通 39.5%、小破店 0.5%。
     *
     * 高档只给 18% 而不是「一定住最好的」—— 半年都在路上的人也会挑便宜的住几晚，
     * 那才像过日子。但 18% 已经足够让「住得好」成为常态的一部分，用户不用再劝。
     */
    if (rich) {
      // 宽裕：高档 18% / 景观 40% / 普通 41.5% / 小破店 0.5%
      if (r < 0.180) return { tier: 'luxury', ...pick(P.luxury, rnd) };
      if (r < 0.580) return { tier: 'view', ...pick(P.view, rnd) };
      if (r < 0.995) return { tier: 'budget', ...pick(P.budget, rnd) };
      return { tier: 'dingy', ...pick(P.dingy, rnd) };
    }
    /*
     * 普通：**普通房仍然是六成**（原设计的比例不动），高档那 4% 从景观房里匀出来 ——
     * 一个半年都在外面的人，多数日子住得普通，偶尔住一次好的，这才像真的。
     */
    if (r < 0.040) return { tier: 'luxury', ...pick(P.luxury, rnd) };
    if (r < 0.640) return { tier: 'budget', ...pick(P.budget, rnd) };
    if (r < 0.995) return { tier: 'view', ...pick(P.view, rnd) };
    return { tier: 'dingy', ...pick(P.dingy, rnd) };
  })();
  return { ...raw, price: withFloor(raw.tier, scaleNum(raw.price, scale)) };
}

/**
 * 真名的语义 → 更贴的类别。**档次不动，只换说法。**
 *
 * 档次对了不等于名实相符：实测「华威大酒店（老城民宿）」—— 两边都是高价档，
 * 但四星级商务酒店不是民宿，读者一眼就看出来假。同理「万达酒店（家庭旅店）」。
 *
 * 所以挂上真名之后，按名字把 kind/price/feel 一起换成配套的一条。
 * **tier 不从这儿来** —— 那是数据源说的，比名字可靠。
 */
const NAME_KINDS: readonly {
  readonly re: RegExp;
  readonly tier: LodgingTier;
  readonly kind: string;
  readonly price: number;
  readonly feel: string;
}[] = [
  /*
   * 中端连锁排在最前 —— 顺序有意义。
   *
   * 全季、亚朵、维也纳这些名字里也带「酒店」，会被下面那条通用的「酒店」规则命中；
   * 但它们的实际价格是三百多，跟快捷连锁的 220 不是一回事。先匹配到这条，
   * 名字和价钱才对得上。
   */
  {
    re: /全季|亚朵|桔子|维也纳|丽枫|麗枫|和颐|宜必思|智选假日|欢朋|美居|雅乐轩|星程|如家精选/,
    tier: 'budget',
    kind: '中端连锁',
    price: 320,
    feel: '大堂小而干净，前台会问要不要延到下午两点；房间是标准化的木色，床软硬刚好。',
  },
  {
    re: /大酒店|国际|商务|酒店/,
    tier: 'view',
    kind: '高档商务酒店',
    price: 560,
    feel: '大堂亮得有点冷，前台三个窗口都在办入住；房间大，床偏硬，早餐是自助。',
  },
  {
    // 「饭店」也算：中文里「XX 饭店」是旅馆的老叫法（实测天水「东安饭店」就是三星酒店）。
    re: /大酒店|国际|商务|酒店|宾馆|饭店/,
    tier: 'budget',
    kind: '连锁商务酒店',
    price: 240,
    feel: '房间小但干净，空调外机就在窗外；楼下是便利店，前台夜里只留一个人。',
  },
];

/**
 * 说的时候用哪个名字。
 *
 * 有真名就用真名，但**类别不能丢** —— 「住进汉庭酒店」看不出档次，
 * 而档次恰恰是那晚的全部意义（住到景观房还是小破店，是两种旅行）。
 */
export function lodgingLabel(l: Lodging): string {
  return l.name ? `${l.name}（${l.kind}）` : l.kind;
}

export type LodgingWant = 'cheaper' | 'nicer' | 'any';

/**
 * 换一家。
 *
 * 2026-11-05 Mr.Q：「换酒店直接两种模式都打开吧，用户让肥鱼换，肥鱼可以换」。
 *
 * 之前只有一种情况会换房：**记账开着、钱紧了**，日切时把 plan 清掉重掷
 * （见 `world.ts` 里那段注释）。没开记账时 `isTight()` 永远是 false，
 * 于是她一辈子不换房 —— 用户跟她说「换一家」，她没有任何通道能办到这件事。
 *
 * 这里单独给一个动作，两种模式都走得通。三条约束：
 *
 * 1. **一定换到不同的一家。** 掷回同一间房，等于让用户白说一遍。
 * 2. `cheaper` / `nicer` 是**方向**，不是保证。便宜的房子就那几家，
 *    挑不出更便宜的就同级换一家，然后如实说「这已经是最便宜的那档」。
 * 3. 指定方向时**不掷骰子决定档次**。用户说「换便宜点」，结果掷出景观房，
 *    那是没听懂话 —— 比不换更糟。
 */
export function rerollLodging(
  cur: Lodging,
  rnd: () => number = Math.random,
  poor = false,
  priceIdx = 1,
  want: LodgingWant = 'any',
  /** 手头宽 —— 影响「换好点」能换到哪一档，也影响随机的骰子。 */
  rich = false,
  /** 在不在中国 —— 换房也要换对那套词，不然「换便宜点」会换出「县城宾馆」。 */
  abroad = false,
  /** 地形。换房同样不能换出「窗外没有的那座山」。 */
  terrain?: Terrain,
): Lodging {
  const P = poolsOf(abroad, terrain);
  const scale = abroad ? abroadFactor(priceIdx) : priceIdx;
  const poolOf = (t: LodgingTier): readonly Omit<Lodging, 'tier'>[] =>
    t === 'luxury' ? P.luxury : t === 'budget' ? P.budget : t === 'view' ? P.view : P.dingy;

  /** 同一档里换一家，优先挑和现在不同的那一间。 */
  const sibling = (t: LodgingTier): Lodging => {
    const list = poolOf(t);
    const fresh = list.filter((x) => x.kind !== cur.kind);
    const raw = pick(fresh.length ? fresh : list, rnd);
    return { tier: t, ...raw, price: withFloor(t, scaleNum(raw.price, scale)) };
  };

  if (want === 'cheaper') {
    /*
     * 只在「普通房」里往便宜的挑。
     * 不往小破店推 —— 那是另一件事（那是没钱了，不是「换个便宜点的」）。
     */
    const cheaper = P.budget.filter((x) => scaleNum(x.price, scale) < cur.price);
    if (cheaper.length) {
      const raw = cheaper[Math.floor(rnd() * cheaper.length) % cheaper.length]!;
      return { tier: 'budget', ...raw, price: scaleNum(raw.price, scale) };
    }
    /*
     * 挑不出更便宜的。这时候**宁可不换**。
     *
     * 第一版在这里换了一家同档的，结果「老式招待所 130」被换成了「县城宾馆 180」——
     * 用户说的是「换便宜点」，涨价的「换」比不换更糟。同级里还有更便宜或同价的才换，
     * 否则原样返回，由调用方说清「这一档已经到底了」。
     */
    const same = P.budget
      .filter((x) => x.kind !== cur.kind && scaleNum(x.price, scale) <= cur.price);
    if (cur.tier === 'budget' && same.length) {
      const raw = same[Math.floor(rnd() * same.length) % same.length]!;
      return { tier: 'budget', ...raw, price: scaleNum(raw.price, scale) };
    }
    return cur;
  }

  if (want === 'nicer') {
    /*
     * 「换好点」原来最多只能换到景观房 —— 用户的原话是「劝了好久才换了个好的酒店」，
     * 而那一档本来就是他能换到的天花板。2026-11-06 把高档也接进来：
     * 先看高档池里有没有比现在贵的，有就给；没有再退景观房。
     */
    const nicer = P.luxury.filter((x) => scaleNum(x.price, scale) > cur.price);
    if (nicer.length && (rich || cur.tier === 'view' || cur.tier === 'budget')) {
      const raw = nicer[Math.floor(rnd() * nicer.length) % nicer.length]!;
      return { tier: 'luxury', ...raw, price: scaleNum(raw.price, scale) };
    }
    const view = P.view.filter((x) => scaleNum(x.price, scale) > cur.price);
    if (view.length) {
      const raw = view[Math.floor(rnd() * view.length) % view.length]!;
      return { tier: 'view', ...raw, price: scaleNum(raw.price, scale) };
    }
    return sibling('view');
  }

  // any：按「钱紧不紧」重新掷，但不许掷回同一间
  for (let i = 0; i < 6; i++) {
    const next = rollLodging(rnd, poor, priceIdx, rich, abroad);
    if (next.kind !== cur.kind) return next;
  }
  return sibling(cur.tier === 'view' ? 'view' : 'budget');
}

/*
 * **挂了真名之后，只能说房间里的事。**（2026-11-09 Mr.Q 截图）
 *
 * 面板上写着「汝阳轩源大酒店（温泉度假酒店）· 1350」，还有
 * 「房间里带私汤，水一直放着」「在池子里游了二十分钟」。他上携程一查：
 * 二钻、92 块、五种基础房型、设施清单里只有餐厅和停车场。
 *
 * 根因不是选店选错，是**类别描述被当成了这家店的介绍**：
 * 「温泉度假酒店」本来是「她今晚住的这一类地方」，一旦前面挂上真实店名，
 * 每个字都变成对那家店的承诺。而它到底有没有温泉，我们根本不知道。
 *
 * 所以挂了真名就换成这套：**只描述房间内部**（床、隔音、热水、窗），
 * 公共设施一概不提 —— 这些换到任何一家同档酒店都成立。
 *
 * 顺带解决另一件事：Mr.Q「酒店描述就这么几句话，有点单调」。原来一档一句，
 * 住三天就是同一句话念三遍。这里每档四句，按种子挑。
 */
const ROOM_FEEL: Record<'luxury' | 'view' | 'budget' | 'dingy', readonly string[]> = {
  /*
   * **2026-11-09 全部重写：只描述，不评价。**
   *
   * 原来 dingy 那组写的是「床单上有一块洗不掉的印子」「门锁是那种老式插销，
   * 走廊的灯有一半不亮」—— 不挂名时这是「这类地方」的想象，没问题；
   * 可一旦前面挂上真店名（「天水皇冠假日酒店」），**这就是在说人家床单脏**。
   *
   * 判据：**挂在真名后面的每个字，都是对那家店的指控或背书。**
   * 所以只留「房间多大、几扇窗、热水快不快」这类可观测且中性的描述。
   * 好与差由价格和设施说，不由形容词说。
   */
  luxury: [
    '房间大，床垫偏软；窗帘厚，拉上就全黑。',
    '进门一条过道，行李摊开不挡路；夜里空调声音很轻。',
    '窗子占了半面墙，桌上摆着两只玻璃杯，水壶是保温的。',
    '地毯厚，走过去听不见脚步；热水要放一会儿才来。',
  ],
  view: [
    '窗户比想象的大，坐在床边就能看见外面。',
    '窗帘是两层的，白纱拉上之后光变柔；床头有一盏可以调亮的灯。',
    '房间朝里，看不到什么景，但安静；洗漱台面宽。',
    '床对着窗，早上睁眼就是那一片；隔音一般，走廊有人说话能听见。',
  ],
  budget: [
    '干净，床单是刚换的；热水来得快。',
    '房间不大，箱子靠墙立着；窗户能开一条缝。',
    '床偏硬，被子叠得方正；电视挂在墙上，遥控器在床头柜里。',
    '卫生间做了干湿分开，排水有点慢；插座在书桌底下，要弯腰找。',
  ],
  dingy: [
    '房间小，箱子摊开就转不开身。',
    '窗户对着天井，白天也得开灯。',
    '设施简单：一张床一张桌，插座只有两个，都在床头。',
    '浴室是淋浴头直接挂在墙上，没有隔断，水会溅到外面。',
  ],
};

/* ---------------------------------------------------------------- 真实数据 → 人话 */
/*
 * 上面那张 `ROOM_FEEL` 是**没数据时的兜底**：只说房间内部，不承诺公共设施。
 *
 * 现在有了 TourMind 的真数据（`data/hotel-facts.json`，177 城 / 1710 家），
 * 公共设施和周边可以**按事实说**了 —— 用户要的正是这个：
 * 「现在酒店的描述就这么几句话，有点单调了，可以让子agent去网上搜搜
 *  相关酒店的周遭环境。」
 *
 * 但话只能说数据支持的那部分：这家店没有泳池，就是没写，不是「大概有」。
 */

/*
 * ## 设施优先级（2026-11-09）
 *
 * 第一版直接从「有文案的设施」里随机挑，结果**十条里有八条是「整层无烟」** ——
 * 因为 `nosmoke` 在数据里最常见（几乎所有中高档店都标），
 * 而且「整层无烟」这句话对住客没有信息量。
 *
 * 判据：**只说得上一句的才说**。泳池、温泉、桑拿、健身房是「为什么住这家」，
 * 无烟、前台、行李寄存是「默认应该有」—— 后者说了等于没说。
 *
 * 所以按稀有度分三档，先挑最稀有的那一档里有的。
 */
const AMEN_WEIGHT: Record<string, number> = {
  pool: 3, onsen: 3, spa: 3, gym: 3,
  bar: 2, restaurant: 2, shuttle: 2, pet: 2, meeting: 2,
  parking: 1, laundry: 1, luggage: 1, front24: 1, nosmoke: 1,
};

/** 设施 → 一句人话。键和抓取脚本里的 `flags` 一致。 */
const AMEN_LINES: Record<string, readonly string[]> = {
  pool: ['楼下有泳池，早上没什么人。', '泳池在负一层，水是温的，游了两圈就上来了。'],
  onsen: ['能泡温泉，晚上泡到手指起皱。'],
  spa: ['有桑拿房，蒸完出来一身轻。'],
  gym: ['健身房在楼上，器材不多但够用。'],
  restaurant: ['早餐在一层，粥和面都有。', '楼下就是餐厅，晚上懒得出去就在这儿吃。'],
  bar: ['顶层有个小酒吧，晚上有人弹琴。'],
  parking: ['门口能停车。'],
  shuttle: ['前台能叫车去机场。'],
  laundry: ['能洗衣，第二天就干了。'],
  front24: ['前台整夜有人。'],
  luggage: ['行李寄在前台，出门不用拎着。'],
  meeting: ['楼上有个会议室，白天有人在那儿开会。'],
  nosmoke: ['整层无烟，走廊闻不到烟味。'],
  pet: ['这家能带宠物，大堂里就有人牵着狗。'],
};

/*
 * 周边那一项上游给的是英文名（`Tianfu Square`、`People's Park`），
 * 直接塞进中文句子会变成半截外语。所以只取**类别 + 走多久**，不点名。
 *
 * 点名的代价：得给几千个英文地名配中文，配错比不配更糟。
 */
const NEAR_KINDS: readonly (readonly [RegExp, string])[] = [
  [/square|plaza/i, '广场'],
  [/park|garden/i, '公园'],
  [/museum|gallery/i, '博物馆'],
  [/mall|shopping|market|department/i, '商场'],
  [/station|terminal|airport/i, '车站'],
  [/temple|shrine|church|cathedral|mosque/i, '寺庙教堂'],
  [/university|college|school/i, '学校'],
  [/street|road|avenue|lane/i, '街'],
  [/lake|river|canal|harbour|harbor/i, '水边'],
  [/tower|tower\.?$/i, '塔'],
];

const pickOne = <T,>(arr: readonly T[], rnd: () => number): T =>
  arr[Math.floor(Math.abs(rnd()) * arr.length) % arr.length] as T;

/**
 * 有真实数据时，`feel` 说什么。
 *
 * 三句话的结构：**房间内部（永远有）+ 一项设施（有才说）+ 一句周边（有才说）**。
 * 不堆砌 —— 四句以上读起来是在读说明书，不像住过。
 */
export function realFeel(
  hotel: { readonly amen?: readonly string[]; readonly around?: readonly { readonly n: string; readonly km: number }[] },
  tier: 'luxury' | 'view' | 'budget' | 'dingy',
  rnd: () => number = Math.random,
): string {
  const out: string[] = [pickOne(ROOM_FEEL[tier], rnd)];

  /*
   * 设施：只挑一项，且**先挑稀有的那一档**。
   *
   * 挑两项会变成清单；不按权重挑就会天天说「整层无烟」（见 `AMEN_WEIGHT` 上面那段）。
   */
  const facs = (hotel.amen ?? []).filter((k) => AMEN_LINES[k]);
  if (facs.length) {
    const top = Math.max(...facs.map((k) => AMEN_WEIGHT[k] ?? 1));
    const best = facs.filter((k) => (AMEN_WEIGHT[k] ?? 1) === top);
    out.push(pickOne(AMEN_LINES[pickOne(best, rnd)]!, rnd));
  }

  /*
   * 周边：取最近的那一处，只说类别和大概走多久。
   *
   * 分四段，不是按「好看」分，是按**走路能不能到**分：
   * 六百米以内是「拐个弯」，一公里半以内是「走十来分钟」，
   * 三公里以内得坐车，再远就是「这一带偏」。
   */
  const near = (hotel.around ?? [])[0];
  if (near) {
    const kind = NEAR_KINDS.find(([re]) => re.test(near.n))?.[1] ?? '';
    if (near.km <= 0.6) out.push(kind ? `出门拐个弯就是${kind}。` : '出门就是热闹的地方。');
    else if (near.km <= 1.5) out.push(kind ? `走十来分钟有个${kind}。` : '走十来分钟有一片商业区。');
    else if (near.km <= 3) out.push('离热闹的地方有段距离，得坐两站车。');
    else out.push('这一带偏，晚上出门没什么可逛的。');
  }
  return out.join('');
}

/**
 * 类别名里去掉「设施承诺」。
 *
 * 「温泉度假酒店」→「度假酒店」：温泉不是每个度假酒店都有，
 * 挂了真名就不能再写进类别里。
 */
function plainKind(kind: string): string {
  return kind.replace(/温泉|泳池|私汤|SPA|水疗|行政/g, '').trim() || kind;
}

/**
 * 把查到的真酒店挂上去。查不到就原样返回 —— **绝不编一个**。
 *
 * 这一步单独拿出来，是因为「掷档次」和「起名字」是两件事：
 * 前者是纯随机的设计，后者依赖网络。分开之后，没网也不影响她今天住什么档次的房。
 */
export function withHotel(
  base: Lodging,
  pois: readonly HotelPoi[] | null,
  rnd: () => number = Math.random,
  priceIdx = 1,
  /** 在不在中国 —— 国外要按当地实价算，别把系数乘两遍。 */
  abroad = false,
): Lodging {
  if (!pois || !pois.length) return base;
  const pick = pickHotel(pois, base.tier, rnd);
  if (!pick) return base;
  /*
   * 最后一道防线：真名和档次打架时，宁可不挂名字。
   *
   * `pickHotel` 已经按档筛过了，理论上走不到这儿 —— 但这个错太刺眼，
   * 一旦漏出去就是「万达酒店（家庭旅店）」那种场面。多一行判断，成本几乎为零。
   */
  if (pick.tier && pick.tier !== base.tier) return base;
  /*
   * 名字自己就在反驳这个档次 —— 不挂。
   *
   * 2026-11-07 用户那两张截图：「东晨宾馆（滦河桥路店）（五星级酒店）980」，
   * 而店里挂的房价是 61 元一晚。`pickHotel` 已经按反向词表筛过一遍，
   * 这里是第二道 —— 一个「宾馆」绝不该出现在五星级房型后面。
   */
  if (contradictsTier(pick.name, base.tier)) return base;
  /*
   * ## 这里曾经有一道价格窗口，删了（2026-11-09）
   *
   * 加它的动机是「天水景观档挂出 ¥109 的高档商务酒店」。可那个判断本身就错了：
   * **在天水，109 就是中上价位。** 拿全国标准看觉得便宜，
   * 但档位的语义是「这一晚在**本地**算什么水平」—— 分位算的正是这个。
   *
   * 而且窗口拿**真价**去比**游戏价**（`base.price`），两者不是一个量纲：
   * 东京这一档「该花 1160」，真店要 10066，比值 8.7 —— 窗口把整个东京的真店全挡了。
   *
   * 判据：**只有同一量纲的数才能比大小。** 真价和真价比，游戏价和游戏价比。
   */
  // 类别跟着名字走：档次对但说法不对，一样是假。
  const semantic = NAME_KINDS.find((k) => k.tier === base.tier && k.re.test(pick.name));
  /*
   * 挂上真名之后，`feel` 一律换成「房间内」那一套（见 `ROOM_FEEL`）。
   *
   * 原来这里用的是 `semantic.feel` —— 那是为**这一类**地方写的，
   * 里面常带公共设施（「大堂挑高，行李有人接」「早餐在行政酒廊」）。
   * 现在前面挂着真店名，这些就成了对那家店的承诺，而我们并不知道。
   */
  /*
   * 有真实设施/周边就说真的，没有就退回「只说房间内」。
   *
   * 判据不是「这家店有没有数据」，是**这一句有没有东西可说** ——
   * 上游对二钻宾馆常常什么都查不到，那本来也是事实（它确实没有泳池）。
   */
  const roomFeel = (tier: 'luxury' | 'view' | 'budget' | 'dingy'): string =>
    (pick.amen?.length || pick.around?.length) ? realFeel(pick, tier, rnd) : pickOne(ROOM_FEEL[tier], rnd);
  /*
   * ## 真价怎么换算成游戏里的钱（2026-11-09）
   *
   * 直接显示真价不行：游戏里东京这一档「该花 170」，而真店要 11548 ——
   * 一晚住掉半年预算，经济系统当场崩。
   *
   * 但也不能不用真价（那又回到「所有店一个价」）。
   *
   * 所以按**同城真价中位数**做比例换算：
   *
   *     displayPrice = 这一档该花的钱 × (这家店的真价 / 全城中位真价)
   *
   * 效果：经济水平还是游戏内的，但**贵贱关系是真的**。
   * 东京四季会是普通店的 5 倍，天水的速8 是普通店的 0.9 倍。
   */
  const priceOf = (hotel: HotelPoi | undefined): number | null => {
    if (!hotel?.cost || hotel.cost <= 0) return null;
    const costs = (list: readonly HotelPoi[]): number[] =>
      list.map((x) => x.cost).filter((c): c is number => typeof c === 'number' && c > 0);
    const mid = (xs: readonly number[]): number | null => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? null) : null;
    };

    /*
     * 基准用**同档**真店的中位数，不是全城。
     *
     * 用全城时：成都豪华档的门徒酒店（真价 464）对着全城中位 166 算，
     * 倍数是 2.8，再乘上这一档该花的 970 —— 显示 2733，比真价贵六倍。
     *
     * 同档中位才对：它是这一档的「标准价」，贵的才往上涨。
     */
    const sameTier = costs(pois.filter((x) => x.tier === base.tier));
    const median = mid(sameTier) ?? mid(costs(pois));
    if (!median || !(base.price > 0)) return Math.round(hotel.cost);
    const scaled = base.price * (hotel.cost / median);
    /* 上下各夹一道：最贵不到这一档基准的 2.5 倍，最便宜不低于 0.5 倍 */
    return Math.round(Math.min(Math.max(scaled, base.price * 0.5), base.price * 2.5));
  };
  if (semantic) {
    return {
      tier: base.tier,
      kind: plainKind(semantic.kind),
      /*
       * 价格优先级：**真价 > 表里的原始价 × 城市系数 > `base.price`**。
       *
       * 2026-11-09 加了第一档。原来只有后两档，结果同一家店的价格
       * 会跟着档位系数漂 —— 换房时「换了店但价格一模一样」，
       * 因为两次都落在表里那个数上。
       *
       * 真价（TourMind 的 `min_price`）是**单晚人民币实价**，不再乘系数；
       * 乘了就等于把真实数据又揉回推测。
       *
       * 注意别用 `base.price × 系数`：`base.price` 已经被 `rollLodging` 缩过一次，
       * 再乘一遍会翻倍 —— 纽约那档会直接从 7500 变成 80000。
       */
      price: priceOf(pick) ?? scaleNum(semantic.price, abroad ? abroadFactor(priceIdx) : priceIdx),
      feel: roomFeel(base.tier),
      name: pick.name,
      address: pick.address ?? '',
      ...(pick.amen?.length ? { amen: pick.amen } : {}),
      ...(pick.around?.length ? { around: pick.around } : {}),
    };
  }
  /*
   * 没有语义匹配，直接沿用 `base` 的类别 —— 但**类别里的设施词要摘掉**，
   * `feel` 也换成房间内的。否则「温泉度假酒店 + 私汤」就这么挂到了二钻宾馆头上。
   */
  return {
    ...base,
    kind: plainKind(base.kind),
    feel: roomFeel(base.tier),
    name: pick.name,
    address: pick.address ?? '',
    ...(priceOf(pick) !== null ? { price: priceOf(pick)! } : {}),
    ...(pick.amen?.length ? { amen: pick.amen } : {}),
    ...(pick.around?.length ? { around: pick.around } : {}),
  };
}
