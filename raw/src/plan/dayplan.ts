/**
 * 当地的一天怎么过 —— **由代码排表，她只负责把表过成话。**
 *
 * 为什么要排表而不是让她自己想：作息是**可验证的事实**。她要是自己编，
 * 会出现「凌晨三点吃完午饭」「傍晚看日出」。排成表之后，每个节点的时刻都是算出来的，
 * 她只需要决定这一刻说什么。
 *
 * 三条硬规则直接落在代码里，不靠提示词约束：
 *   1. 饭点固定在早 7-8 / 午 12-13 / 晚 18-19。
 *   2. 晚 8 点后，**没有「只有夜里才能做的事」就回酒店**。
 *   3. 日出只能排在日出前 1-1.5 小时起（黄山夜爬就是这么来的），而且天亮得太晚的地方不排。
 */
import type { City } from '../geo/cities.ts';
import { pilgrimAt, type Pilgrim } from '../geo/pilgrim.ts';
import { localHour } from '../clock.ts';
import { sunTimes, sunriseWorthIt } from '../geo/sky.ts';
import { lodgingLabel, type Lodging } from './lodging.ts';
import { isWet, isMurky, feelOf, type Forecast } from '../geo/amap.ts';
import { cnHolidayOn } from './holidays.ts';

export type BeatKind =
  | 'arrive' | 'wake' | 'sunrise' | 'breakfast' | 'activity'
  | 'lunch' | 'dinner' | 'night' | 'hotel' | 'sleep' | 'depart';

/**
 * 「还在那儿」那句中段话的模板。
 *
 * 四条，按城市+日期+地点取模轮换。**不写「好看」「值得」这类评价** ——
 * 那是导游词；也不写具体景物 —— 同一个模板要能套在石窟和古城上。
 * 说的都是**逛这件事本身**：走了一半、比想的大、人变多了、脚酸了。
 */
const MID_LINES: readonly string[] = [
  '还在{spot}，走了这么久才转过一半',
  '{spot}比看着大，这会儿还在里头',
  '还在{spot}，人比刚进来的时候多了',
  '在{spot}里绕到第二圈，脚有点酸',
];

export interface Beat {
  /** 当地小数小时。 */
  readonly at: number;
  readonly kind: BeatKind;
  /** **事实**，不是台词。她照着这个说，别把这句本身当成要念的话。 */
  readonly what: string;
  /**
   * 这一处的地名（`清水寺`、`伏羲庙`）。只有 `activity` 有，而且可能为空。
   *
   * 2026-11-01 加的。原来拍照靠从 `what` 里反解地名（`下午，伏羲庙` 取逗号后面那段），
   * 可有的写法就是地名本身、没有逗号（`清水寺`），于是**取不到地名**，
   * 照片被拍成「下午的天水」。地名明明在一路传下来，不该到了这里再去猜。
   */
  readonly spot?: string;
  /**
   * 这一处待到几点（当地小数小时）。只有 `activity` 有。
   *
   * 2026-11-01 Mr.Q 指出的：原来 14:30 到了伏羲庙，一秒钟就参观完了 ——
   * 她 15:30 被问「你在干嘛」只能答「在等晚饭」。景点是一个**时间段**，
   * 不是时间轴上的一个点。加上这个字段之后：现状里能说「此刻在伏羲庙，
   * 待到五点三刻」，行程里也能在中间插一句。
   */
  readonly until?: number;
  /**
   * 这一处同时在哪些作品里出现过。**只有 `activity` 带得上，而且是有才有。**
   *
   * 2026-11-01 加的圣地巡礼。做成独立字段而不是塞进 `what`：
   * `what` 会原样进面板的时间轴（`uiTimeline` 直接读它），
   * 塞进去的结果是面板上每一项后面挂一长串书名号，挤得看不清。
   * 分成字段之后，面板照旧只显示「上午，清水寺」，
   * 提示词那边单独拿这一条去说 —— 两边各用各的。
   */
  readonly pilgrim?: Pilgrim;
}

export interface DayPlan {
  readonly dateKey: string;
  readonly cityId: string;
  readonly beats: readonly Beat[];
  readonly lodging: Lodging;
  /** 当地日出/日落（小数小时）。极昼极夜时为 null —— 那天真的没有，不是没算出来。 */
  readonly sunriseHour: number | null;
  readonly sunsetHour: number | null;
  /** 这一天的性质，决定她说起来是什么口吻。 */
  readonly shape: 'arrival' | 'full' | 'last';
  /** 这地方今晚有没有「只有夜里才能做的事」。没有就是回酒店。 */
  readonly nightOption: string | null;
  /** 当天天气。`null` = 没配 key / 查不到 / 国外，一律当作未知，不编。 */
  readonly weather: Forecast | null;
}

/**
 * 夜里才成立的事。空 = 这天晚上没什么非做不可的，那就回酒店。
 *
 * **这里是查表，不是拼句子。** 以前按 `tags` 拼（有「古城」就写「在亮灯的老街上走」），
 * 结果每座城市都有一条、全是套话，还跟她白天去过的那条老街重复。
 * 2026-11-01 改成读 `City.night`：真在晚上才成立的事才填（夜市、看星星、赶海、夜游），
 * 没填就没有这一条 —— 晚上待在房间里也是旅行的一部分。
 */
function nightOptionOf(city: City): string | null {
  return city.night;
}

/**
 * 这一天是不是赶上了什么日子。
 *
 * 两层：**先看地方节庆，再看全国性的。**
 *
 * 地方那层（泼水节、雪顿节、那达慕）走的是傣历、藏历、牧区的习惯，年年挪，
 * 只按月比对，文案说「这个月」，说错也不算说错。
 *
 * 全国那层（春节、中秋、国庆）日期是确定的，交给 `cnHolidayOn` 用 ICU 的农历算 ——
 * 2026-11-02 Mr.Q 指出「春节也是中国国内的节日，国内的节日没算到节日里」，
 * 那之前她在国内任何一座城都不知道今天过年。
 *
 * **地方优先**：一座城真有自己的节，那才是她那天该撞上的事。
 */
function festivalOn(city: City, dateKey: string): { name: string; what: string } | null {
  const f = city.festival;
  if (f) {
    const month = Number(dateKey.slice(5, 7));
    if (Number.isFinite(month) && f.months.includes(month)) {
      return { name: f.name, what: f.what };
    }
  }
  return cnHolidayOn(city, dateKey);
}

/** 当地吃什么的**方向**（不是菜名表）。写死菜名她就会照着念，方向交给她自己写。 */
function foodHint(city: City): string {
  const t = city.tags;
  const has = (x: string): boolean => t.includes(x);
  if (has('海鲜') || has('海')) return '海里的东西，越简单越好';
  if (has('火锅')) return '热的东西，一锅煮';
  if (has('面食')) return '面，本地那一套';
  if (has('米粉') || has('米线') || has('螺蛳粉')) return '一碗粉';
  if (has('早茶')) return '早茶那一套，慢慢吃';
  if (has('辣')) return '辣得有点过分的那种';
  if (has('草原') || has('奶食') || has('牛羊')) return '肉和奶';
  if (has('寺庙') || has('素')) return '素的、清淡的';
  return '本地人日常吃的那种';
}

const round15 = (h: number): number => Math.round(h * 4) / 4;

/**
 * 白天去哪儿。
 *
 * 有真实地标就用真名（「莫高窟」「布达拉宫」），没有就用 tag 生成泛化说法
 * （「城外的山路上走一段」）—— **绝不编一个具体名字**。
 *
 * 上一版这里是「${city.name}城里的一处地方」这种占位，等于没给素材。
 * 结果她写日记时景是空的、吃是实的，整篇就塌成吃播。素材决定内容，不是文采。
 */
export function spotText(city: City, index: number, dayIndex = 0): string {
  /*
   * **`dayIndex` 是「在这个城市的第几天」，不传就是第一天。**
   *
   * 2026-11-01 群友反馈「第二天还是卢浮宫」—— 根因是调用处写死了两个固定索引，
   * `index % spots.length` 那个取模从来没生效过，每天排的都是同一批。
   *
   * 现在的规则：**一天用掉两个名额，用完了就不再点名**。
   * 重复一个具体地标比说泛一点糟得多：她说过「不会讲重复的事」，
   * 真撞上就会干脆不吭声，那半天就空了。
   *
   * ## 顺序就是类型（2026-11-01 Mr.Q：一个城要 5 个，还要集市、吃、玩）
   *
   * `city.spots` 里每一城的条目**按这个顺序排**，所以不需要额外的字段：
   *
   * ```
   * 0-1  最标志性的两处地标   → 第一天 上午 / 下午
   * 2    第三个地标           → 第二天 上午
   * 3    市集、老街、庙会     → 第二天 下午
   * 4    第四个去处           → 第三天 上午
   * 5    公园 / 乐园 / 沙滩   → 第三天 下午
   * ```
   *
   * 于是住三天正好走过「看地标 → 赶集 → 再走两处」，不会连着两天都在看庙。
   * 一城现在是 6-7 条，第 4 天起退回泛化说法 —— 那是价格：再多就得开始编了。
   *
   * **这里一格吃食都没有，是故意的。** 2026-11-01 前后放过「一碗牛肉面」这类，
   * 排到第 3 天上午就成了「吃一早上」—— Mr.Q 连着说了两次。一天里本就有早饭午饭晚饭，
   * 夜里还有夜市（`City.night`），再让一顿面独吞一个上午，那天就少去一个地方。
   * 吃归 `foodHint()` 和 `night`，不归 spots。
   */
  const seq = dayIndex * 2 + index;
  // 按 `slots` 取，不按 `spots` 取 —— 标了（2 天）的地点在这里占四格。
  const spot = city.slots[seq];
  if (spot) return spot;
  const pool = genericSpots(city);
  return pool[seq % pool.length] as string;
}

/**
 * 泛化说法的池子，**按贴合度排序**。
 *
 * 只取第一条的话，一个城市住三天会排出三句一模一样的「城里随便走走」——
 * 不点名了，但重复本身还在。所以按序号轮着取。
 */
function genericSpots(city: City): string[] {
  const t = city.tags;
  const has = (x: string): boolean => t.includes(x);
  const out: string[] = [];
  if (has('山') || has('峡谷') || has('石柱')) out.push('城外的山路上走一段');
  if (has('海') || has('海岛')) out.push('海边坐着看水');
  if (has('高原') || has('雪山')) out.push('高处视野开的那一段');
  if (has('湖') || has('水') || has('江') || has('河') || has('三峡')) out.push('沿着水边走');
  if (has('古城') || has('古都') || has('老城')) out.push('老城那几条街');
  if (has('草原')) out.push('草原上往外走一段');
  if (has('沙漠') || has('戈壁') || has('丹霞')) out.push('出城看那片地形');
  if (has('寺庙') || has('石窟')) out.push('附近那处老庙子');
  if (has('园林') || has('江南') || has('水乡')) out.push('有院子和水的那一片');
  // 兜底三条：不管什么城市都能用，而且彼此不重样。
  out.push('城里随便走走', '街边坐一会儿', '往城外走一段');
  return [...new Set(out)];
}

/**
 * 排一天。
 *
 * `startHour`：到达日传到达的当地时刻；完整日传 0。
 * `shape`：`arrival` 只有半天，`full` 是完整一天，`last` 是第二天要走的最后一天。
 */
export function planDay(args: {
  city: City;
  dateKey: string;
  shape: 'arrival' | 'full' | 'last';
  /** 到达日从几点开始算（当地小数小时）；非到达日忽略。 */
  startHour?: number;
  lodging: Lodging;
  rnd?: () => number;
  /** 当天天气。拿不到就传 null —— 不能因为没天气就不排作息表。 */
  weather?: Forecast | null;
  /**
   * 在这个城市的第几天（0 = 到的那天）。
   *
   * 只影响「今天去哪儿」—— 每天换一批地标，别连着两天排同一个。
   * 不传就是 0，行为跟老版本一致。
   */
  dayIndex?: number;
}): DayPlan {
  const { city, dateKey, shape, lodging } = args;
  const rnd = args.rnd ?? Math.random;
  const dayIdx = args.dayIndex ?? 0;

  const dayUtc = new Date(`${dateKey}T12:00:00Z`);
  const sun = sunTimes(city.lat, city.lon, dayUtc);
  const sunriseHour = sun ? round15(localHour(sun.sunriseUtc, city.tz)) : null;
  const sunsetHour = sun ? round15(localHour(sun.sunsetUtc, city.tz)) : null;
  const weather = args.weather ?? null;
  // 白天天气管「能不能看日出」，夜间天气管「晚上出不出门」——**两个不是一回事**。
  // 2026-10-31 实测踩到：九寨沟那天「白天多云 / 夜间小雨」，用白天天气判断夜间活动，
  // 会让她在下雨的晚上出去看星星。
  const wet = weather ? isWet(weather.dayWeather) : false;
  const murky = weather ? isMurky(weather.dayWeather) : false;
  const nightWet = weather ? isWet(weather.nightWeather) : false;
  const nightOption = nightWet ? null : nightOptionOf(city);
  const food = foodHint(city);

  const beats: Beat[] = [];
  const push = (
    at: number, kind: BeatKind, what: string, pilgrim?: Pilgrim | null, spot?: string,
    until?: number,
  ): void => {
    beats.push({
      at: round15(at), kind, what,
      ...(pilgrim ? { pilgrim } : {}),
      ...(spot ? { spot } : {}),
      ...(until ? { until: round15(until) } : {}),
    });
  };
  /**
   * 排一个「去哪儿」的节点。
   *
   * `spot` 是**纯地名**（`spotText` 去掉「下午，」这类前缀之后的东西），
   * 拿它去查巡礼。查不到就什么都不挂 —— 泛化说法（「城里随便走走」）永远查不到，
   * 那是对的：编出来的说法不该有作品的另一个身份。
   */
  /*
   * 逛一个地方要多久。
   *
   * 不是随手定的：上午那处离午饭两个多小时，下午那处离晚饭三个多小时。
   * 这两段是一天里最长的两片时间，不给它们厚度，她就有一半时间「无所事事」——
   * 2026-11-01 实测：14:30 到 18:30 四小时里一条节拍都没有，用户以为她坏了。
   */
  const SPAN_AM = 2.25;
  const SPAN_PM = 3.25;

  /**
   * 排一个「去哪儿」的节点，并给它一段持续时间。
   *
   * `span` 有值时会在这段时间的中段再插一条**同地点的**节拍（「还在那儿」），
   * 让下午三点半的她有话可说，而不是只剩一句「等晚饭」。
   * 那条也带 `spot`，但巡礼按地名去重，不会重复报同一部作品。
   */
  const act = (at: number, what: string, spot: string, span?: number): void => {
    const hours = span ?? 0;
    push(at, 'activity', what, pilgrimAt(city.id, spot), spot, hours ? at + hours : undefined);
    if (hours < 1.5) return;
    /*
     * 中段那句。**同一个景点不放两句**：一天两个景点各有一句已经够了，
     * 再加「出来的时候」就成了解说词。模板按城市+日期+地点轮换，
     * 同城住几天也不会天天同一句。
     */
    let mid = at + hours * 0.55;
    /*
     * 避开已经排上的节点。一整天在同一个地方（黄山）时，中段会正好落在午饭上：
     * 那就往前挪 —— 往后挪会越过午饭，「还在山上」和「在吃午饭」同时成立就穿帮了。
     */
    for (let i = 0; i < 4 && beats.some((b) => Math.abs(b.at - mid) < 0.6); i++) {
      mid -= 0.5;
      if (mid <= at + 0.5) break;
    }
    if (mid <= at + 0.5) return;
    const seed = Math.abs([...`${city.id}${dateKey}${spot}`].reduce((n, c) => n + c.charCodeAt(0), 0));
    push(mid, 'activity', MID_LINES[seed % MID_LINES.length].replace('{spot}', spot), null, spot);
  };

  // ---- 到达日：从落地那一刻接着排，不补已经过去的时间 ----
  if (shape === 'arrival') {
    const start = Math.max(0, args.startHour ?? 12);
    // 到达日不管从几点落地，用到的都是这两个位置。提前取一次，
    // 免得四个分支里各写一遍 `spotText`，巡礼也就只在一处挂。
    const a0 = spotText(city, 0, dayIdx);
    const a1 = spotText(city, 1, dayIdx);
    // 到达这件事由 `journey.arrive` 事件负责说，这里的 beat 不再重复它。
    // （2026-10-31 模拟里发现：两句「到 天水 了」连着出现，就是这里撞的。）
    push(start, 'arrive', `走出站，${shapeWord(city)}`);

    if (start >= 20) {
      // 八点以后到，只够进房间。这一晚没有别的。
      push(start + 0.5, 'hotel', `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(Math.min(23.5, start + 2), 'sleep', '睡');
      return finish();
    }
    if (start >= 17) {
      if (nightOption) push(19.5, 'dinner', `晚饭，${food}`);
      else push(18.5, 'dinner', `晚饭，${food}`);
      if (nightOption) push(20.25, 'night', nightOption);
      push(nightOption ? 21.5 : 20, 'hotel', `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    if (start >= 13.5) {
      act(start + 1, `下午，${a0}`, a0, Math.max(1.5, 17.75 - start));
      push(18.5, 'dinner', `晚饭，${food}`);
      if (nightOption) push(20.25, 'night', nightOption);
      push(nightOption ? 21.5 : 20, 'hotel', `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    if (start >= 11) {
      push(12.5, 'lunch', `午饭，${food}`);
      act(14.5, `下午，${a1}`, a1, SPAN_PM);
      push(18.5, 'dinner', `晚饭，${food}`);
      if (nightOption) push(20.25, 'night', nightOption);
      push(nightOption ? 21.5 : 20, 'hotel', `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    // 上午到：这一天还很长
    if (start < 9) push(9, 'breakfast', `早饭，${food}`);
    act(10, a0, a0);
    push(12.5, 'lunch', `午饭，${food}`);
    act(14.5, `下午，${a1}`, a1);
    push(18.5, 'dinner', `晚饭，${food}`);
    if (nightOption) push(20.25, 'night', nightOption);
    push(nightOption ? 21.5 : 20, 'hotel', `住进${lodgingLabel(lodging)}。${lodging.feel}`);
    push(23, 'sleep', '睡');
    return finish();
  }

  // ---- 完整的一天 ----
  // 雨、雪、雾霾沙尘都不排日出 —— 起大早扑空是真实会发生的，但没必要主动安排。
  const canSunrise = sunriseHour !== null && sunriseWorthIt(sunriseHour)
    && sunriseIsPlausible(city) && !wet && !murky;
  /*
   * **同一天两格是同一个地方，就只排一条。**
   *
   * 黄山标了（2 天），展开后连着四格都是「黄山风景区」。要是照常排两条，
   * 她会上午说「去黄山风景区」、下午再说一遍「下午，黄山风景区」——
   * 那是爬山，不是逛两个景点。
   *
   * 第二天接着还是这里的话，说法换成「还在」，别连着两天说同一句话。
   */
  const spotA = spotText(city, 0, dayIdx);
  const spotB = spotText(city, 1, dayIdx);
  const wholeDay = spotA === spotB;
  const continuing = wholeDay && dayIdx > 0 && spotText(city, 0, dayIdx - 1) === spotA;
  const dayLine = wholeDay
    ? (continuing ? `还在${spotA}，今天换条路走` : `一整天都在${spotA}`)
    : spotA;

  if (canSunrise && sunriseHour !== null) {
    push(sunriseHour - 1.5, 'wake', `天没亮就起，为了赶日出（当地日出 ${fmtHour(sunriseHour)}）`);
    push(sunriseHour - 0.25, 'sunrise', `日出。${shape === 'last' ? '最后一天，专门为这个起的' : ''}`.trim());
    push(sunriseHour + 1.5, 'breakfast', `看完回来吃早饭，${food}`);
    act(
      sunriseHour + 3.5, wholeDay ? dayLine : `上午，${spotA}`, spotA,
      // 「一整天都在山上」要撑到下午，不能只给上午那两个小时
      wholeDay ? Math.max(SPAN_PM, 17.5 - (sunriseHour + 3.5)) : SPAN_AM,
    );
    push(12.5, 'lunch', `午饭，${food}`);
    if (!wholeDay) act(14.5, `下午，${spotB}`, spotB, SPAN_PM);
  } else {
    push(7, 'wake', '起床');
    push(7.5, 'breakfast', `早饭，${food}`);
    act(9.5, dayLine, spotA, wholeDay ? Math.max(SPAN_PM, 17.5 - 9.5) : SPAN_AM);
    push(12.5, 'lunch', `午饭，${food}`);
    if (!wholeDay) act(14.5, `下午，${spotB}`, spotB, SPAN_PM);
  }
  /*
   * 赶上当地的时节就单独说一句。
   *
   * 只在「整天在城里」这天排 —— 到达日和离开日时间不够，硬塞进去像是为了提而提。
   * 位置放在下午活动之后、晚饭之前：那时候天还亮着，节日多半正在街面上。
   */
  const fest = festivalOn(city, dateKey);
  if (fest) push(16.75, 'activity', `赶上${fest.name}。${fest.what}`);
  push(18.5, 'dinner', `晚饭，${food}`);
  if (nightOption) {
    push(20.25, 'night', nightOption);
    push(21.5, 'hotel', `回${lodgingLabel(lodging)}。${lodging.feel}`);
  } else {
    // 这条就是需求里那句「八点以后没夜里的活动就回酒店」。
    // 但「为什么没活动」要说对：下雨和这城本来没夜生活，是两回事。
    const why = nightWet ? '外面在下雨，没什么可去的' : '这边晚上没什么非做不可的';
    push(20, 'hotel', `回${lodgingLabel(lodging)}。${why}，早点回。${lodging.feel}`);
  }
  push(23, 'sleep', '睡');
  return finish();

  function finish(): DayPlan {
    beats.sort((a, b) => a.at - b.at);
    return {
      dateKey, cityId: city.id, beats, lodging,
      sunriseHour, sunsetHour, shape, nightOption, weather,
    };
  }
}

/** 这地方值不值得为日出起大早。海边和高原值得；纯城市不值得（楼挡着）。 */
function sunriseIsPlausible(city: City): boolean {
  const t = city.tags;
  const good = ['山', '泰山', '云海', '海', '海岛', '沙漠', '戈壁', '草原', '高原', '雪山', '日出', '峡谷', '石柱'];
  return t.some((x) => good.includes(x));
}

/** 「到了这儿是什么感觉」—— 供给事实，不是台词。 */
function shapeWord(city: City): string {
  const t = city.tags;
  if (t.includes('海') || t.includes('海岛')) return '空气里有咸味';
  if (t.includes('高原')) return '呼吸比平时费一点劲';
  if (t.includes('沙漠') || t.includes('戈壁')) return '干，嘴唇立刻就感觉得到';
  if (t.includes('山') || t.includes('峡谷')) return '四周一下就变窄了';
  if (t.includes('草原')) return '视野一下变得很大';
  if (t.includes('古城') || t.includes('古都')) return '脚下的地换了颜色';
  return '走出站的时候风的方向变了';
}

/** 3.5 → 「三点半」。用在事实描述里，避免出现「03:30」这种机器读数。 */
export function fmtHour(h: number): string {
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  const hourText = `${cnNum(whole)}点`;
  if (m === 0) return hourText;
  if (m === 30) return `${hourText}半`;
  // 分钟也要中文 —— 「七点15分」这种东西写进日记，一眼就露馅。
  return `${hourText}${cnNum(m)}分`;
}

/** 0-59 的中文写法。 */
function cnNum(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n === 10) return '十';
  if (n < 20) return `十${d[n - 10]}`;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${d[t]}十${o ? d[o] : ''}`;
}
