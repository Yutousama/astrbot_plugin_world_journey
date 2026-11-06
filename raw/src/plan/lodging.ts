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

import { pickHotel, type HotelPoi } from '../geo/hotels.ts';

/**
 * 四档。`luxury` 是 2026-11-06 加的 ——
 *
 * 一位用户来信：「舍不得我家小鱼吃苦……劝了好久才换了个好的酒店」。
 * 原来最高只到「景观房」，想让她住好一点，用户只能一遍遍劝。
 * 现在她自己会在手头宽的时候挑高档的，跟座位档一个道理。
 */
export type LodgingTier = 'budget' | 'view' | 'luxury' | 'dingy';

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
}

const BUDGET: readonly Omit<Lodging, 'tier'>[] = [
  { kind: '快捷连锁', price: 220, feel: '干净、标准、窗外是对面楼的墙；洗澡水大，隔音一般。' },
  { kind: '老式招待所', price: 130, feel: '木头门、走廊尽头的公用开水房，服务员是本地口音；床硬，但安静。' },
  { kind: '家庭旅店', price: 160, feel: '老板一家住在一楼，会问你明天去哪；房间小，有个能晾衣服的窗台。' },
  { kind: '县城宾馆', price: 180, feel: '大堂很大、电梯很旧，早餐是稀饭咸菜和煮鸡蛋。' },
];

const VIEW: readonly Omit<Lodging, 'tier'>[] = [
  { kind: '山景房', price: 680, feel: '窗一推开就是山，早上有雾从谷里升上来；房价里有一半是那扇窗。' },
  { kind: '海景房', price: 900, feel: '阳台正对海，夜里能一直听见浪；早上太阳从水面出来。' },
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
 * 不写具体品牌名：写了「万豪」，而那个县城根本没有万豪，就是编。
 * 品牌留给高德查到的真名（`name` 字段），查不到时只说类别。
 */
const LUXURY: readonly Omit<Lodging, 'tier'>[] = [
  { kind: '五星级酒店', price: 980, feel: '大堂挑高，行李有人接；房间隔音好到听不见走廊，床垫陷下去半寸。' },
  { kind: '高层城景房', price: 1180, feel: '三十层往上，整座城摊在窗下；夜里关灯看灯，比白天好看。' },
  { kind: '行政套房', price: 2200, feel: '里外两间，客厅有沙发和写字台；早餐在行政酒廊，人少、安静。' },
  { kind: '温泉度假酒店', price: 1680, feel: '房间里带私汤，水一直放着；泡完直接裹着浴衣睡，不想到处走。' },
];

const DINGY: readonly Omit<Lodging, 'tier'>[] = [
  { kind: '车站旁的小旅馆', price: 60, feel: '走廊灯一闪一闪，热水要等，窗外整夜有喇叭声。' },
  { kind: '通铺改的单间', price: 45, feel: '床单有别人的味道，门锁是挂锁，半夜有人敲门走错了。' },
];

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length) % list.length];

/**
 * 按城市价格指数缩放。
 *
 * 取整到十位：小数位是噪音（「3612 元」不如「3610 元」读着像话）。
 * 下限 20 元，免得极端系数把小破店压成负数。
 */
const scaleNum = (price: number, idx: number): number =>
  idx === 1 ? price : Math.max(20, Math.round((price * idx) / 10) * 10);

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
): Lodging {
  const r = rnd();
  const raw = ((): Lodging => {
    // 穷的时候不是不掷，是**换一支骰子**：景观房从四成压到两成，
    // 便宜房优先挑价低的，差店概率抬到 1%。
    // 这样「钱紧」表现为日子变窄，而不是突然住不起 —— 后者会让人觉得系统坏了。
    if (poor) {
      if (r < 0.790) {
        const cheap = [...BUDGET].sort((a, b) => a.price - b.price);
        return { tier: 'budget', ...pick(cheap, rnd) };
      }
      if (r < 0.990) return { tier: 'view', ...pick(VIEW, rnd) };
      return { tier: 'dingy', ...pick(DINGY, rnd) };
    }
    /*
     * 宽裕：高档 18%、景观 42%、普通 39.5%、小破店 0.5%。
     *
     * 高档只给 18% 而不是「一定住最好的」—— 半年都在路上的人也会挑便宜的住几晚，
     * 那才像过日子。但 18% 已经足够让「住得好」成为常态的一部分，用户不用再劝。
     */
    if (rich) {
      // 宽裕：高档 18% / 景观 40% / 普通 41.5% / 小破店 0.5%
      if (r < 0.180) return { tier: 'luxury', ...pick(LUXURY, rnd) };
      if (r < 0.580) return { tier: 'view', ...pick(VIEW, rnd) };
      if (r < 0.995) return { tier: 'budget', ...pick(BUDGET, rnd) };
      return { tier: 'dingy', ...pick(DINGY, rnd) };
    }
    /*
     * 普通：**普通房仍然是六成**（原设计的比例不动），高档那 4% 从景观房里匀出来 ——
     * 一个半年都在外面的人，多数日子住得普通，偶尔住一次好的，这才像真的。
     */
    if (r < 0.040) return { tier: 'luxury', ...pick(LUXURY, rnd) };
    if (r < 0.640) return { tier: 'budget', ...pick(BUDGET, rnd) };
    if (r < 0.995) return { tier: 'view', ...pick(VIEW, rnd) };
    return { tier: 'dingy', ...pick(DINGY, rnd) };
  })();
  return { ...raw, price: scaleNum(raw.price, priceIdx) };
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
): Lodging {
  const poolOf = (t: LodgingTier): readonly Omit<Lodging, 'tier'>[] =>
    t === 'luxury' ? LUXURY : t === 'budget' ? BUDGET : t === 'view' ? VIEW : DINGY;

  /** 同一档里换一家，优先挑和现在不同的那一间。 */
  const sibling = (t: LodgingTier): Lodging => {
    const list = poolOf(t);
    const fresh = list.filter((x) => x.kind !== cur.kind);
    const raw = pick(fresh.length ? fresh : list, rnd);
    return { tier: t, ...raw, price: scaleNum(raw.price, priceIdx) };
  };

  if (want === 'cheaper') {
    /*
     * 只在「普通房」里往便宜的挑。
     * 不往小破店推 —— 那是另一件事（那是没钱了，不是「换个便宜点的」）。
     */
    const cheaper = BUDGET.filter((x) => scaleNum(x.price, priceIdx) < cur.price);
    if (cheaper.length) {
      const raw = cheaper[Math.floor(rnd() * cheaper.length) % cheaper.length]!;
      return { tier: 'budget', ...raw, price: scaleNum(raw.price, priceIdx) };
    }
    /*
     * 挑不出更便宜的。这时候**宁可不换**。
     *
     * 第一版在这里换了一家同档的，结果「老式招待所 130」被换成了「县城宾馆 180」——
     * 用户说的是「换便宜点」，涨价的「换」比不换更糟。同级里还有更便宜或同价的才换，
     * 否则原样返回，由调用方说清「这一档已经到底了」。
     */
    const same = BUDGET
      .filter((x) => x.kind !== cur.kind && scaleNum(x.price, priceIdx) <= cur.price);
    if (cur.tier === 'budget' && same.length) {
      const raw = same[Math.floor(rnd() * same.length) % same.length]!;
      return { tier: 'budget', ...raw, price: scaleNum(raw.price, priceIdx) };
    }
    return cur;
  }

  if (want === 'nicer') {
    /*
     * 「换好点」原来最多只能换到景观房 —— 用户的原话是「劝了好久才换了个好的酒店」，
     * 而那一档本来就是他能换到的天花板。2026-11-06 把高档也接进来：
     * 先看高档池里有没有比现在贵的，有就给；没有再退景观房。
     */
    const nicer = LUXURY.filter((x) => scaleNum(x.price, priceIdx) > cur.price);
    if (nicer.length && (rich || cur.tier === 'view' || cur.tier === 'budget')) {
      const raw = nicer[Math.floor(rnd() * nicer.length) % nicer.length]!;
      return { tier: 'luxury', ...raw, price: scaleNum(raw.price, priceIdx) };
    }
    const view = VIEW.filter((x) => scaleNum(x.price, priceIdx) > cur.price);
    if (view.length) {
      const raw = view[Math.floor(rnd() * view.length) % view.length]!;
      return { tier: 'view', ...raw, price: scaleNum(raw.price, priceIdx) };
    }
    return sibling('view');
  }

  // any：按「钱紧不紧」重新掷，但不许掷回同一间
  for (let i = 0; i < 6; i++) {
    const next = rollLodging(rnd, poor, priceIdx, rich);
    if (next.kind !== cur.kind) return next;
  }
  return sibling(cur.tier === 'view' ? 'view' : 'budget');
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
  // 类别跟着名字走：档次对但说法不对，一样是假。
  const semantic = NAME_KINDS.find((k) => k.tier === base.tier && k.re.test(pick.name));
  if (semantic) {
    return {
      tier: base.tier,
      kind: semantic.kind,
      /*
       * 用**表里的原始价 × 城市系数**，不是 `base.price × 系数`。
       * `base.price` 已经被 `rollLodging` 缩过一次了，再乘一遍会翻倍 ——
       * 纽约那档会直接从 7500 变成 80000。
       */
      price: scaleNum(semantic.price, priceIdx),
      feel: semantic.feel,
      name: pick.name,
      address: pick.address ?? '',
    };
  }
  return { ...base, name: pick.name, address: pick.address ?? '' };
}
