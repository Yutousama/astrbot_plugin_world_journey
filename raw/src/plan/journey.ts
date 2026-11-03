/**
 * 选目的地、选交通方式、算出这一趟的真实时间。
 *
 * ## 两条不能靠提示词保证的规矩，落在权重里
 *
 * 1. **不能出现「步行去巴黎」。** 靠两种约束叠起来：交通方式自带距离上限（步行 40 km），
 *    以及枢纽条件（船必须先有码头）。所以这件事是**算不出来**的，不是「她答应不走」。
 * 2. **不能每次都去山城。** 目的地按距离分三档掷，档内再按「没去过的优先、
 *    和上一站路数不同的优先」加权。她会换地方，但不是随机的。
 *
 * ## 倍速只影响「多久醒一次」，不改行程本身
 *
 * 一路上要走的世界时间是 `durationWorldHours`，**它不会因为倍速变**。
 * 倍速只把这段时间折算成真实时间。所以 24x 下次日到达，日记里写的仍然是
 * 「走了十一个小时」—— 时间线本身是稳的。
 */
import type { City } from '../geo/cities.ts';
import { CITIES, cityById, isForeign } from '../geo/cities.ts';
import { distanceKm, waypoints, haulOf, bearingDeg, angleBetween } from '../geo/distance.ts';
import { climateOf, affinity } from '../geo/climate.ts';
import { MODES, modeById, hoursFor, reachable, type ModeId, type TravelMode } from '../geo/modes.ts';

export interface Journey {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly modeId: ModeId;
  readonly km: number;
  /** 这一趟要走多久（世界时间，小时）。**不含**倍速。 */
  readonly durationWorldHours: number;
  /** 上车时刻（真实 UTC ISO）。 */
  readonly departedAt: string;
  /** 到达时刻（真实 UTC ISO）。按出发时定的倍速算出来的。 */
  readonly arriveAt: string;
  /** 出发时的倍速。中途改倍速不影响这一段，下一段才生效。 */
  readonly speed: number;
  /** 直线路径上会经过的城市 id，用来给她一点「路过」的实感。 */
  readonly viaIds: readonly string[];
  readonly createdAt: string;
}

/** 目的地的距离档。比例是「多数时候不会走得太疯」。 */
const BANDS: readonly { name: string; min: number; max: number; w: number }[] = [
  { name: '周边', min: 0, max: 300, w: 0.30 },
  { name: '近', min: 300, max: 800, w: 0.28 },
  { name: '中', min: 800, max: 2500, w: 0.32 },
  { name: '远', min: 2500, max: 1e9, w: 0.10 },
];

/**
 * 刚走完一段长途之后，下一段该收一收。
 *
 * 2026-10-31 实测踩到：她走完 九寨沟 → 南宁（1800km）、接着 南宁 → 银川（2000km+），
 * 在地图上是个 Z 字。根因有两层，这是第一层 —— **只看「离我多远」，不看「上一段走了多远」**。
 * 真人长途旅行是「一段远的 + 几个近的」交替，不是连着横穿。
 *
 * ### 为什么要分出「周边」这一档
 *
 * 原来最细的一档是 0～800km。**八百公里在中国已经是大跳了** ——
 * 模拟里因此出现过 杭州 → 三亚 → 重庆 → 呼和浩特 这种连续绕圈：
 * 每一段都「不算折返」，连起来看就是在地图上画三角形。
 *
 * 分成四档之后，「到了一个新地方，先在附近转两个」才有地方发生。
 * 真实的长途旅行正是这个形状：**一段长的，然后在落脚点周围散开，再一段长的**。
 */
const LONG_HAUL_KM = 1400;
const SHORT_AFTER_LONG = [0.55, 0.30, 0.13, 0.02] as const;

/** 这一档的权重。上一段太长就把远档压下去。 */
function bandWeights(lastKm: number): readonly number[] {
  if (lastKm < LONG_HAUL_KM) return BANDS.map((b) => b.w);
  return SHORT_AFTER_LONG;
}

/**
 * 方向系数：顺着走加强，往回走压扁。
 *
 * 这是第二层根因，也是更关键的一层 —— **完全没有「往哪走」的概念**。
 * 一个没有方向的随机游走，在城市密集的地图上表现为「乱跳」：
 * 从四川往南到广西，再从广西往北回宁夏，每一段单独看都「合理」（都在中档距离），
 * 连起来看就是个折返跑。
 *
 * 真人旅行是有惯性的：既然往南走了，就再往南走几个地方；
 * 到了海边想回家，那是**决定回去**，不是又随机挑一个北方的城市。
 */
function dirFactor(angleDeg: number): number {
  if (angleDeg <= 55) return 1.6;   // 顺着
  if (angleDeg <= 100) return 1.0;  // 侧向，正常
  if (angleDeg <= 140) return 0.5;  // 侧后方：可以，但要有个理由
  return 0.12;                      // 基本是原路折返
}

/**
 * 什么才算「折返」。
 *
 * 140 度以上。**120～140 不算** —— 那是侧后方，是正常的路：
 * 到了南宁再往桂林（123°）、往昆明（136°）都很自然。
 * 拿 120 当界会把这半正常的走法也算成毛病。
 */

/** 夹角超过这个就当「往回走」，先从候选里剔掉 —— 剔空了再放开。 */
const U_TURN_DEG = 150;

/**
 * 挑一个目的地。
 *
 * `visited` 只用来做**加权**，不做硬性排除 —— 半年在外面，迟早要去重复的城市，
 * 那时候应该表现成「又来了一次，这次是冬天」，而不是「她突然不会去那儿了」。
 *
 * ### 三个约束，一个都不许写成硬规则
 *
 * 1. **方向**：顺着上一段的方向走（`heading`），不原路折返
 * 2. **节奏**：长段之后走短段（`lastKm`）
 * 3. **气候**：不合胃口的地方去得少（`home` 决定基准，见 climate.ts）
 *
 * 第 3 条尤其不能写成「不去湿热的地方」—— 半年在外面本来就是要见识不一样的地方，
 * 不习惯的表现应该是「去了以后难受、说得出来」，不是「永远不去」。
 * 所以它是权重，下限 0.42，不是门槛。
 */
export function pickDestination(args: {
  from: City;
  visited?: readonly string[];
  /** 想去的地方。因为某首歌、某段话生出来的念头 —— 权重给得很高。 */
  wishes?: readonly string[];
  /** 上一段的行进方向（度，0=正北）。`null` = 刚开始或刚离家，不约束方向。 */
  heading?: number | null;
  /** 上一段走了多少公里。用来让「长途之后走短途」。 */
  lastKm?: number;
  /** 出发地（家）。气候适配度以它为基准；不传就用 `from`，等于没有气候偏好。 */
  home?: City;
  /**
   * 回家路上：候选必须**比现在离它更近**。
   *
   * 2026-10-31 Mr.Q 指出「其实也合理如果从银川回兰州的话」——
   * 问题不在选点，在**回家原本是一步传送**：`hereId` 直接改成家，中间不经过任何城市。
   * 所以银川不是回程的一站，是随机选的另一个目的地，看着才怪。
   *
   * 传了这个参数，走的每一步都朝家逼近，回程就成了一条真实的路：
   * 有路上事件、有日记、有花费，而且途经的城市天然在「往家方向」上。
   */
  toward?: City;
  /**
   * 钱快见底时的走法：**只挑这个距离以内的下一站**。
   *
   * 不传 = 不限制。传了之后连「跨洲换一座城」都进不了候选，
   * 她只能在附近挪 —— 这正是「钱只够走近处」的意思。
   * 注意它只管距离，不管交通方式；能不能坐飞机由调用方另外决定。
   */
  maxKm?: number;
  rnd?: () => number;
}): { city: City; km: number; band: string } | null {
  const rnd = args.rnd ?? Math.random;
  const from = args.from;
  const visited = new Set(args.visited ?? []);
  const wishes = new Set(args.wishes ?? []);
  const heading = args.heading ?? null;
  const homeClimate = climateOf(args.home ?? from);

  // 每一档都先备好候选，再从按权重选中的那一档里挑。选中的档空了就顺延到别的档。
  let withDist = CITIES
    .filter((c) => c.id !== from.id)
    .map((c) => ({ c, km: distanceKm(from, c) }))
    .filter((x) => x.km >= 60)    // 60 公里以内不算「去旅行」
    /*
     * **到不了的地方不进候选。**
     *
     * 2026-11-01 Mr.Q 问「落地东京然后开车坐JR去大阪过京都，是否可行」——
     * 可行，而且本来就该这么走。问题在这儿：候选只看距离，不看能不能到，
     * 于是从上海能直接选中京都，然后 pickMode 只能硬凑一种交通方式。
     *
     * 加上这一条之后，从国外选不到京都（它没有机场），她必须先落到东京或大阪，
     * 再坐 JR 过去 —— **中转不需要新概念，她自己本来就是一段一段走的。**
     */
    .filter((x) => canTravel(from, x.c, x.km))
    /*
     * 钱不够就只走近处。
     *
     * 这一条放在**候选集**上，不是放在打分上：打分只能让它「更不容易被选中」，
     * 而钱只够走六百公里的时候，远处那些城市压根不该出现在选项里。
     */
    .filter((x) => !args.maxKm || x.km <= args.maxKm);

  if (!withDist.length) return null;

  // 回家路上：**只看「更近」是不够的**。
  //
  // 2026-10-31 模拟抓到 秦皇岛 → 贵阳：贵阳确实比秦皇岛离兰州近一点点，
  // 于是它通过了「更近 8%」的判据 —— 但方向完全不对，人在河北不该往贵州绕。
  // 所以两条一起卡：**方向朝着家**（夹角 ≤ 70°）且**距离明显更近**。
  // 只按距离筛，回程会变成一条歪歪扭扭的折线；只按方向筛，可能在原地绕圈。
  if (args.toward) {
    const target = args.toward;
    /*
     * **先问一句：从这儿直接回得去吗。**
     *
     * 京都那条暴露的：它没有机场，从京都到国内任何一座城市都不可达。
     * 这时候谈「离目标更近」没有意义 —— 日本境内没有哪座城比京都离兰州更近，
     * 三级收敛全部落空，退回按距离段随机，于是「回兰州」的第一站是札幌。
     *
     * 真实的走法是：新干线到东京，从东京飞。所以先挪到一座能飞的。
     * 19% 的容差是留给「东京和大阪都行」这种情况的，不硬选最近的那个。
     */
    if (!canTravel(from, target)) {
      const hubs = withDist.filter((x) => canTravel(x.c, target));
      if (hubs.length) {
        /*
         * 挑**离她自己最近**的枢纽，不是离目标最近的。
         *
         * 第一版按「离兰州最近」筛，结果留下了札幌 —— 从京都往北飞、
         * 到北纬 43 度，确实比东京更接近兰州的纬度。可现实里没人这么走：
         * 从京都去国际机场，最近的肯定是东京（新干线两小时一刻）或者大阪关西，
         * 而不是先飞八百公里去北海道。
         */
        const best = Math.min(...hubs.map((x) => x.km));
        withDist = hubs.filter((x) => x.km <= best * 1.15);
      }
    }
    const nowDist = distanceKm(from, target);
    const homeward = bearingDeg(from, target);
    const scored = withDist.map((x) => ({
      ...x,
      toTarget: distanceKm(x.c, target),
      aim: angleBetween(bearingDeg(from, x.c), homeward),
    }));
    // 三级收敛，**优先大步逼近**。
    //
    // 2026-10-31 模拟抓到 郑州 → 格尔木：格尔木比郑州离兰州近 11%，
    // 勉强通过「更近 8%」—— 但它在兰州的**西边**，等于绕过了家再往回折。
    // 回程应该一路逼近，不该在家门口划一道弧。
    //
    // 所以先找「明显更近」（≥25%）的；找不到再放宽到 8%；
    // 方向条件始终保留 —— 只在死角才退回纯距离。
    const step = (ratio: number) => scored.filter((x) => x.toTarget < nowDist * ratio && x.aim <= 70);
    const strict = step(0.75);
    const middle = step(0.92);
    const loose = scored.filter((x) => x.toTarget < nowDist * 0.92);
    if (strict.length) withDist = strict;
    else if (middle.length) withDist = middle;
    else if (loose.length) withDist = loose;
  }

  // 往回走的先剔掉。**想去的地方不剔** —— 「因为那首歌想去」本来就不讲道理，
  // 哪怕和当前方向相反也该去。剔空了（比如她卡在漠河）再放开，不能把人困死。
  if (heading !== null) {
    const forward = withDist.filter((x) => wishes.has(x.c.id)
      || angleBetween(bearingDeg(from, x.c), heading) <= U_TURN_DEG);
    if (forward.length) withDist = forward;
  }

  // 按动态权重选档。
  const weights = bandWeights(args.lastKm ?? 0);
  const order = BANDS.map((b, i) => ({ b, w: weights[i] ?? 0 })).sort((x, y) => y.w - x.w);
  const roll = rnd();
  let acc = 0;
  let band = order[0].b;
  const totalW = order.reduce((s2, x) => s2 + x.w, 0) || 1;
  for (const x of order) {
    acc += x.w / totalW;
    if (roll <= acc) { band = x.b; break; }
  }

  const inBand = (b: typeof band): typeof withDist =>
    withDist.filter((x) => x.km >= b.min && x.km < b.max);

  let pool = inBand(band);
  for (const x of order) {
    if (pool.length) break;
    pool = inBand(x.b);
    band = x.b;
  }
  if (!pool.length) pool = withDist;

  // 加权：方向 × 气候 × 去过没有 × 路数是否重复。
  const scored = pool.map((x) => {
    // 想去的地方：**跳过所有约束**，直接给一个压得住一切的分。
    // 原来只是 ×12，但它还要乘方向 0.12、气候 0.45 —— 12 × 0.12 × 0.45 = 0.65，
    // 输给一个普通的新城市（3 × 1.6 = 4.8）。「因为这首歌想去」被这些系数吃掉了。
    if (wishes.has(x.c.id)) return { ...x, w: 30 };

    let w = 1;
    if (heading !== null) w *= dirFactor(angleBetween(bearingDeg(from, x.c), heading));
    w *= affinity(homeClimate, climateOf(x.c));
    if (!visited.has(x.c.id)) w *= 3;
    const overlap = x.c.tags.filter((t) => from.tags.includes(t)).length;
    w *= 1 + Math.max(0, 2 - overlap) * 0.3;
    // 国外要过境，概率压低但保留 —— 半年里总该出去一趟。
    if (isForeign(x.c)) w *= 0.35;
    return { ...x, w };
  });
  const total = scored.reduce((s2, x) => s2 + x.w, 0);
  let t = rnd() * total;
  for (const x of scored) {
    t -= x.w;
    if (t <= 0) return { city: x.c, km: Math.round(x.km), band: band.name };
  }
  const last = scored[scored.length - 1];
  return { city: last.c, km: Math.round(last.km), band: band.name };
}

/**
 * 挑交通方式。
 *
 * 权重不是「越快越好」，而是**按距离段调整「什么才像人话」**：
 * 八十公里骑电瓶车很自然，八百公里就是找死；两千公里以上除了飞机没有别的选择。
 * 有码头又有水的地方，给轮船留一个不低也不高的概率 —— 她确实会想坐船。
 */
/**
 * 这两个国家之间有没有陆路。
 *
 * ## 为什么需要这一层
 *
 * 交通方式原来只按「距离上限 + 两端有没有枢纽」筛，**不看国界也不看海**。
 * 于是 2026-11-01 实测：上海 → 京都 1395 公里，三百次抽样里
 * 192 次火车、85 次自驾、23 次长途汽车 —— **一次飞机都没有**。
 * 她会开着车穿过东海。
 *
 * 表里只列有陆路连接的国家对，没列到的都当作不接壤。
 * 这是判定的全部依据，所以漏一个国家不会报错，只会让那条线不通 ——
 * 往保守的方向错，比反过来安全：宁可让她飞过去，也不要让她开车过海。
 */
const LAND_NEIGHBORS: Record<string, readonly string[]> = {
  // 中国的十四个陆上邻国
  CN: ['KP', 'MN', 'RU', 'KZ', 'KG', 'TJ', 'AF', 'PK', 'IN', 'NP', 'BT', 'MM', 'LA', 'VN'],
  JP: [],                              // 岛国
  KR: ['KP'],                          // 朝鲜半岛，与表内其他国家都不接壤
  TH: ['MM', 'LA', 'KH', 'MY'],
  SG: ['MY'],                          // 柔佛长堤
  VN: ['CN', 'LA', 'KH'],
  FR: ['BE', 'DE', 'IT', 'ES', 'CH', 'LU', 'AD', 'MC'],
  GB: ['FR'],                          // 英法海底隧道，所以伦敦到巴黎有火车
  IT: ['FR', 'CH', 'AT', 'SI', 'SM', 'VA'],
  RU: ['CN', 'MN', 'KZ', 'FI', 'NO', 'EE', 'LV', 'LT', 'PL', 'BY', 'UA', 'GE', 'AZ'],
  US: ['CA', 'MX'],
  BR: ['AR', 'UY', 'PY', 'BO', 'PE', 'CO', 'VE', 'GY', 'SR'],
  // 第二批：阿根廷挨着巴西/智利/玻利维亚/巴拉圭/乌拉圭；加拿大和墨西哥都只跟美国接壤
  AR: ['CL', 'BO', 'PY', 'BR', 'UY'],
  CA: ['US'],
  MX: ['US'],
  AU: [],                              // 不与任何国家接壤
  NZ: [],
  AE: ['SA', 'OM'],
  TR: ['GE', 'AM', 'IR', 'IQ', 'SY', 'GR', 'BG'],
};

/** 两个国家之间能不能走地面。同国恒真。 */
export function landLinked(a: string, b: string): boolean {
  if (a === b) return true;
  return LAND_NEIGHBORS[a]?.includes(b) === true || LAND_NEIGHBORS[b]?.includes(a) === true;
}

/**
 * 只能走地面的那几种。跨海的国家之间，这些一律不可选 —— 剩下飞机和船。
 *
 * 港澳按 CN 处理（本来就是 CN），所以深圳到香港还能走过去。
 */
const GROUND_MODES: ReadonlySet<string> = new Set([
  'walk', 'bike', 'scooter', 'motorcycle', 'car', 'bus', 'train',
]);

/**
 * 这一对城市之间，哪些交通方式真的能用。
 *
 * 抽出来是因为**判断「能不能去」和「挑哪种去」用的是同一套规则**。
 * 2026-11-01 之前只有 pickMode 在用，于是 `pickDestination` 从候选里
 * 挑出一座根本到不了的城市 —— 比如「从上海直接去京都」。
 */
function usableModes(from: City, to: City, km: number): TravelMode[] {
  return MODES.filter((m) => {
    if (!reachable(m, km)) return false;
    if (m.needs === 'port' && !(from.port && to.port)) return false;
    if (m.needs === 'air' && !(from.air && to.air)) return false;
    if (m.needs === 'rail' && !(from.rail && to.rail)) return false;
    /*
     * 地面交通不能跨海。2026-11-01 之前没有这一条，于是「上海坐火车去京都」
     * 是常态选择 —— 1395 公里在火车的四千公里上限之内，权重还最高。
     * 国界不看、海也不看，算出来的是一个不存在的地方。
     */
    if (GROUND_MODES.has(m.id) && !landLinked(from.country, to.country)) return false;
    return true;
  });
}

/**
 * 从这儿能不能到那儿。
 *
 * **选目的地的时候必须先问这一句。** 不然会选出一座走不到的城市，
 * 然后在下游卡住 —— 表现不是报错，是她站在原地不动，或者凭空传送。
 */
export function canTravel(from: City, to: City, km = distanceKm(from, to)): boolean {
  return usableModes(from, to, km).length > 0;
}

export function pickMode(
  from: City,
  to: City,
  km: number,
  rnd: () => number = Math.random,
  /** 手头紧：飞机这种一次吃掉大半预算的方式会被大幅压权。 */
  poor = false,
  /**
   * 钱只够走近处时连飞机都不坐：**直接不给**，不是压权。
   *
   * 压权只是「更不容易被选中」，一百次里还会中几次 —— 而一张机票就能把
   * 最后那点钱吃光，那不是概率问题。
   */
  noFly = false,
  /**
   * 这一趟买不买得起。返回 false 的方式直接从候选里去掉。
   *
   * 2026-11-02 模拟抓到的：预算 3000 的她能飞到乌斯怀亚 ——
   * 因为「能不能买得起这张票」从来没被问过。压权、禁飞机都只管**方式**，
   * 没人管**这张票多少钱**。结果一张跨洲票把她打穿，她在南美打了四份工，
   * 最后一路花八万回家。
   *
   * 不传 = 不限制（没记账、或者预算填了 0）。
   */
  afford?: (m: TravelMode) => boolean,
): TravelMode | null {
  const all = usableModes(from, to, km);
  const allowed = noFly ? all.filter((m) => m.id !== 'plane') : all;
  const usable = afford ? allowed.filter((m) => afford(m)) : allowed;
  // 禁了飞机之后可能一趟都走不了（海岛、跨国）。那就交给调用方处理，
  // 别退回去给飞机 —— 给出去就是明知道没钱还买票。
  if (!usable.length) return null;

  const haul = haulOf(km);
  const score = (m: TravelMode): number => {
    // 距离越远，慢速方式越不可能。用速度做一个连续衰减，而不是分段写死。
    const slowness = Math.min(1, 40 / m.kmh);
    let w = 1;

    if (haul === 'short') {
      // 短途：越「日常」越好。步行/自行车/电瓶车/公交 是生活，飞机是折腾。
      if (m.id === 'walk') w = km <= 15 ? 6 : km <= 35 ? 1.5 : 0.05;
      else if (m.id === 'bike') w = 5;
      else if (m.id === 'scooter') w = 4;
      else if (m.id === 'bus') w = 3;
      else if (m.id === 'car') w = 2.5;
      else if (m.id === 'train') w = 3;
      else if (m.id === 'motorcycle') w = 1.5;
      else if (m.id === 'plane') w = 0.15;
      else if (m.id === 'ship') w = km >= 60 ? 1.2 : 0.2;
    } else if (haul === 'medium') {
      if (m.id === 'train') w = 8;
      else if (m.id === 'car') w = 4;
      else if (m.id === 'bus') w = 2;
      else if (m.id === 'motorcycle') w = 1.5;
      else if (m.id === 'plane') w = 0.8;
      else if (m.id === 'ship') w = 1.5;
      else w = 0.05;
    } else if (haul === 'long') {
      if (m.id === 'train') w = 5;
      else if (m.id === 'plane') w = 5;
      else if (m.id === 'car') w = 1.2;
      else if (m.id === 'ship') w = 1.4;
      else w = 0.02;
    } else {
      // 跨洲：飞机是唯一像话的。船留给「有游轮航线」的浪漫，概率很低。
      if (m.id === 'plane') w = 20;
      else if (m.id === 'ship') w = 0.4;
      else w = 0;
    }
    // 手头紧：飞机压到原来的一成。不是禁掉 —— 跨洲还是只能飞，
    // 但国内这段距离她会开始算「这钱值不值」。
    if (poor && m.id === 'plane') w *= 0.1;
    // 慢得离谱的再压一道，防止短途段里出现「摩托车横穿八百公里」。
    return w * (1 - slowness * 0.35);
  };

  const weighted = usable.map((m) => ({ m, w: score(m) })).filter((x) => x.w > 0);
  if (!weighted.length) return usable.sort((a, b) => hoursFor(a, km) - hoursFor(b, km))[0];

  const total = weighted.reduce((s, x) => s + x.w, 0);
  let t = rnd() * total;
  for (const x of weighted) {
    t -= x.w;
    if (t <= 0) return x.m;
  }
  return weighted[weighted.length - 1].m;
}

/**
 * 造一段行程。
 *
 * **`at` 是世界时刻，`arriveAt` 也是世界时刻 —— 两者之差就是这个时长的世界时间，
 * 与倍速无关。** 倍速决定「世界时间跑多快」，不决定「这段路要走多久」。
 *
 * 第一版把倍速直接除在这里（`到达 = 出发 + 时长/倍速`），结果是 24x 下她十七分钟就
 * 到站，然后在目的地按真实时间住两三天 —— 车跑快了，但人没走快。现在不是了。
 */
export function buildJourney(args: {
  from: City;
  to: City;
  mode: TravelMode;
  km: number;
  at: Date;
  /** 出发时的倍速，只记录下来做诊断用，不参与时长计算。 */
  speed: number;
  rnd?: () => number;
}): Journey {
  const { from, to, mode, km, at, speed } = args;
  const durationWorldHours = Math.round(hoursFor(mode, km) * 10) / 10;
  const arriveAt = new Date(at.getTime() + durationWorldHours * 3_600_000);
  const corridor = mode.id === 'plane' ? 250 : mode.id === 'walk' ? 15 : 90;
  const via = waypoints(from, to, corridor).map((c) => c.id);
  return {
    id: `${at.getTime().toString(36)}-${to.id}`,
    fromId: from.id,
    toId: to.id,
    modeId: mode.id,
    km,
    durationWorldHours,
    departedAt: at.toISOString(),
    arriveAt: arriveAt.toISOString(),
    speed,
    viaIds: via,
    createdAt: at.toISOString(),
  };
}

/** 这一段走到哪了。0 = 刚上车，1 = 到站。 */
export function progressOf(j: Journey, now: Date): number {
  const a = Date.parse(j.departedAt);
  const b = Date.parse(j.arriveAt);
  if (!(b > a)) return 1;
  return Math.max(0, Math.min(1, (now.getTime() - a) / (b - a)));
}

/** 这一段的世界时间还剩多少小时（按当前倍速折算成真实小时）。 */
export function remainingRealHours(j: Journey, now: Date): number {
  const b = Date.parse(j.arriveAt);
  return Math.max(0, (b - now.getTime()) / 3_600_000);
}

/** 把 id 翻回城市。任何一个不认识的都返回 null，让上层去决定怎么说。 */
export function citiesOf(j: Journey): { from: City | null; to: City | null } {
  return { from: cityById(j.fromId), to: cityById(j.toId) };
}

/* ---------------- 路上的节点 ---------------- */

/** 用户没设间隔时的默认值（小时）。等价于原来写死的「短途一个、长途三个」。 */
export const BEAT_GAP_DEFAULT = 2;
/** 低于这个时长这一趟不算「在路上」，一个中途节点都不插。 */
export const BEAT_MIN_HOURS = 1.5;
/**
 * 一趟最多几个路上节点 —— **按行程长短分档**。
 *
 * 2026-11-03 Mr.Q：「长途 10 条、中程 6 条、短途 3 条」。
 *
 * 原来是一个固定上限（先是 3，后来 6）—— 短途和长途被同一个数管着：
 * 短途给 6 条显得絮叨，长途给 6 条又不够。分成三档才和「这趟有多长」对上。
 *
 * 阈值取 8 小时（半天）和 30 小时（一天多）。
 *
 * 文案档位没跟着加：调用方把节点归一化成「第一段 / 中间 / 最后一段」，
 * 中间那种可以重复，因为「还在路上」本来就该重复。
 */
export function maxMarksFor(durationHours: number): number {
  if (durationHours < 8) return 3;
  if (durationHours < 30) return 6;
  return 10;
}

/**
 * 路上那几个节点落在整段行程的哪个进度上。
 *
 * 输入两个数：这一趟多长、用户想要的反馈间隔。输出进度百分比数组，
 * `roadBeats` 拿它和真实进度比 —— **能算的都放这里算**，world 那边只管发。
 *
 * 三条硬规则：
 * 1. `gap <= 0` → 一个都不发。用户明确不想在路上被打断，那就只在出发和到站开口。
 * 2. 行程不到 1.5 小时 → 一个都不发。这不是间隔问题，是这趟本来就不是「在路上」。
 *    门槛**不跟着间隔走**：间隔调到 8 小时时，三小时的行程仍然该有一个中途消息，
 *    否则等于顺手把短途全静音了。
 * 3. 条数上限按行程长短分档（见 maxMarksFor）：短途 3、中程 6、长途 10。
 *
 * 节点均匀铺在 1/(n+1) … n/(n+1) —— **不贴头也不贴尾**：
 * 刚出发的那条跟「出发了」那条撞车，快到站的那条跟「到了」撞车。
 */
export function beatMarks(durationHours: number, gapHours: number): number[] {
  const gap = Number.isFinite(gapHours) ? gapHours : BEAT_GAP_DEFAULT;
  if (!(gap > 0)) return [];
  if (!(durationHours >= BEAT_MIN_HOURS)) return [];
  const n = Math.min(maxMarksFor(durationHours), Math.max(1, Math.round(durationHours / gap)));
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
}

/**
 * 间隔的人话版本，给提示词用。
 *
 * 她得知道自己这一路大概多密：调到 0 时如果真的一个节点都没有，
 * 那是他设的，不是失联 —— 不知道这件事，她就会自己编一句话把空白填上。
 */
export function beatGapText(gapHours: number): string {
  const gap = Number.isFinite(gapHours) ? gapHours : BEAT_GAP_DEFAULT;
  if (!(gap > 0)) return '关（一路上不会有中途消息，只在出发和到站开口）';
  return gap < 1 ? `大约每 ${Math.round(gap * 60)} 分钟一句` : `大约每 ${gap} 小时一句`;
}

/**
 * 这个节点在某趟行程里的**去重标识**。
 *
 * 用进度而不是序号：0.2.5 之后间隔是用户可调的，同一趟车他可能中途把 2 小时改成 0.5，
 * 序号 0 在两种间隔下指的是完全不同的两处 —— 拿序号做 key，改完设置要么漏发要么重发。
 * 进度是这一段路的物理位置，跟设置无关。
 */
export function beatKey(legId: string, mark: number): string {
  return `${legId}|p${Math.round(mark * 100)}`;
}

/**
 * 这一趟已经发到哪儿了（最靠后的那个节点进度，没有就 -1）。
 *
 * 用途只有一个：改间隔之后**不补发已经走过去的那一段**。
 * 行程过半时把间隔从 2 改成 0.5，新节点表是 25/50/75 —— 25 和 50 在她身后了，
 * 只有 75 该说话。没有这个判断，她会在十分钟内把前半程的旧节点全补一遍。
 *
 * 认不出格式的 key 一律忽略（旧版本用序号做 key，换格式后自然作废）。
 */
export function sentProgress(marks: readonly string[], legId: string): number {
  const pre = `${legId}|p`;
  let max = -1;
  for (const k of marks) {
    if (!k.startsWith(pre)) continue;
    const v = Number(k.slice(pre.length)) / 100;
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/** 只有测试和诊断会用到，但放在这里比在每个调用点重写一遍好。 */
export function describeJourney(j: Journey): string {
  const { from, to } = citiesOf(j);
  const mode = modeById(j.modeId);
  return `${from?.name ?? j.fromId} → ${to?.name ?? j.toId}，${mode?.name ?? j.modeId}，${j.km} 公里，${j.durationWorldHours} 小时`;
}
