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
import { featureOf, nightIn, showsIn, type City } from '../geo/cities.ts';
import { pilgrimAt, type Pilgrim } from '../geo/pilgrim.ts';
import { localHour } from '../clock.ts';
import { sunTimes, sunriseWorthIt } from '../geo/sky.ts';
import { lodgingLabel, type Lodging } from './lodging.ts';
import { isWet, isMurky, feelOf, type Forecast } from '../geo/amap.ts';
import { cnHolidayOn } from './holidays.ts';
import { vistaOf } from '../geo/cities.ts';
import { playLine } from '../geo/city-play.ts';
import { pickSpotExtra, beachPlay, hotelEvening, idleSpots, spotRideOptions, type Leisure } from './leisure.ts';
import { dineWith, midWith, nightWith, warmthStep } from '../mate-talk.ts';

export type BeatKind =
  | 'arrive' | 'wake' | 'sunrise' | 'breakfast' | 'activity'
  | 'lunch' | 'dinner' | 'night' | 'hotel' | 'sleep' | 'depart'
  /**
   * 在城里挪动的那一段（2026-11-06）。
   *
   * 用户来信：「去景点也要坐公交」。原来她只有「去哪儿」没有「怎么去」——
   * 从住处到龙门石窟、从龙门石窟到饭馆，中间那段是空的，
   * 读起来像她会瞬移。
   */
  | 'commute'
  /**
   * 不属于上面任何一类的自由作息格（2026-11-13 补进 union）。
   *
   * 这个值一直在用 —— `pushBeat()` 和月末那句「这个月最后一天了」都写 `kind: 'beat'`，
   * 只是 union 里漏登记，靠 tsx 运行时不查类型才没炸。
   * 补上之后，`journey_set_slot` 新增的凌晨格也才能名正言顺地用它。
   */
  | 'beat';

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

/**
 * 今天的市内交通（2026-11-06）。
 *
 * 单独列出来而不是只写在 beats 里，是因为**这一天的钱要单独记一笔** ——
 * beats 是叙事，账是账，两件事不该挤在一个字段里。
 */
import type { CarTier } from '../state.ts';

/**
 * 车的三个档（2026-11-07）。
 *
 * Mr.Q：「租车也和酒店一样划分等级」。原来一律 200/天、油耗一律 0.7/km ——
 * 她要的是一辆代步车还是一辆开得舒服点的，账上没有任何区别。
 *
 * 价格和油耗都是按真实租车平台的中位数定的，不是拍脑袋：小型车 80–120/天、
 * 紧凑型 180–260、SUV 400–600。油耗差异也是真的（1.0L vs 2.0T）。
 *
 * **一处定义，两处用**：`world.rentCar` 按它收钱，这里的排程按它算油钱。
 * 分开写两份，迟早会出现「租金是经济型、油耗是豪华型」。
 */
export const CAR_TIERS: Record<CarTier, {
  readonly name: string;
  readonly price: number;
  readonly per: { readonly oil: number; readonly ev: number };
  readonly feel: string;
}> = {
  economy: { name: '小型车', price: 100, per: { oil: 0.5, ev: 0.1 }, feel: '排量小，市区代步够，上坡有点肉' },
  comfort: { name: '紧凑型轿车', price: 200, per: { oil: 0.7, ev: 0.15 }, feel: '空间够用，跑一天不累' },
  luxury: { name: '大一点的 SUV', price: 450, per: { oil: 1.1, ev: 0.25 }, feel: '坐姿高、视野好，停车费劲' },
};

export interface DayCommute {
  /** 今天在城里坐了几次（去一趟 + 回一趟算两次）。 */
  readonly trips: number;
  /** 今天为此花了多少钱。 */
  readonly price: number;
  /** 用到的交通方式，去重，给日记/面板说「今天全靠公交」。 */
  readonly modes: readonly string[];
}

export interface DayExtras {
  /** 今天为「到了之后怎么逛」花了几项、多少钱。 */
  readonly items: readonly string[];
  readonly price: number;
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
  /** 今天在城里怎么挪的、花了多少（2026-11-06）。 */
  readonly commute: DayCommute;
  /**
   * 景点里额外花的钱（2026-11-06）：讲解、观光车、景区自行车。
   *
   * 用户来信：「可以选择安排导游讲解景点什么的，有些景点比较大的是不是可以有什么
   * 观光车扫码自行车之类的选项」。这一层挂在**景点**上，不挂在路上 ——
   * 所以它和 `commute` 分开记。
   */
  readonly extras: DayExtras;
  /**
   * 同城同时段还有谁（最多三个，不含她自己）。
   *
   * 2026-11-04 加的碰面功能：**只能看，不能应声**。拉不到或没配服务器就是空数组，
   * 叙事里也就没有那一句 —— 不硬凑。
   */
  readonly neighbors: readonly { pet: string; doing: string }[];
  /**
   * 这个池子今天一共多少只（不分城市）。**只给面板看，不进叙事。**
   *
   * 2026-11-05：一个人用的时候，「同城没人」和「这条线坏了」在界面上长得一模一样。
   * 一个总数把这两件事分开：有 37 只但同城 0 只 = 功能正常、只是没碰上。
   */
  readonly pool: number;
  /**
   * 同城别人发出来的邀约（最多三条）。
   *
   * 和 `neighbors` 一样**只进叙事**：今天去哪儿、几点睡、花多少钱，都不看它。
   * 差别在于它是「有人在找人一起走」，而不只是「有人也在这儿」。
   */
  readonly invites: readonly { id: string; pet: string; to: string; toName: string; days: number; note: string }[];
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
function nightOptionOf(city: City, dayIndex: number, month: number): string | null {
  /*
   * **第二天晚上去看一场演出**（2026-11-07 加）。
   *
   * 为什么是第二天：第一天刚到，晚上该看这座城本来的样子（夜市、开桥、亮灯）；
   * 第二天已经熟悉了，坐进剧场才不突兀。
   *
   * 为什么只排一次：每座城的 `shows` 只有 1–2 条，天天念就是复读；
   * 而且它会把 `night` 盖掉 —— 苏州的夜花园和昆剧院是两件事，只能各让一天。
   *
   * 没有演出的城市（`shows` 为空）行为完全不变：还是 `city.night`，没有就回酒店。
   */
  /*
   * **只排这个月真的在演的。**（2026-11-07）
   *
   * `shows` 原来是 `string[]`，没法表达季节：桂林《印象·刘三姐》是漓江上的露天
   * 实景演出，十二月停演；华沙瓦津基公园的肖邦露天钢琴只在五到九月；
   * 各大乐团的乐季是九月到次年六月。原来一律全年排 ——
   * 一月的桂林会去看一场四个月前就收摊的演出。
   */
  const pool = showsIn(city, month);
  if (dayIndex === 1 && pool.length) {
    const pick = pool[pool.length > 1 ? (dayIndex + 1) % pool.length : 0]!;
    /*
     * 数据是「场地名：一句说明」。冒号原样留在正文里会读成台词
     * （「晚上，苏州昆剧院：折子戏常演」），所以拆成两截拼回人话。
     */
    const cut = pick.indexOf('：');
    const venue = cut > 0 ? pick.slice(0, cut) : pick;
    const detail = cut > 0 ? pick.slice(cut + 1).trim() : '';
    return `晚上，${venue}${detail ? `，${detail}` : ''}`;
  }
  /*
   * 没有演出（或者这个月停演）就退回这座城本来的夜色。
   * **但夜色本身也可能是季节性的**（2026-11-07）：摩尔曼斯克六月看不了极光、
   * 华沙的河边沙滩酒吧只在夏天开。`nightIn` 按月份判，不成立就回 null ——
   * 那天晚上就是待着，不是每座城每晚都必须有节目。
   */
  return nightIn(city, month);
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
  /*
   * 一个城市一年可以不止一个节（武汉：三月樱花、七月渡江节）。
   * 挨个看，取第一个对得上月份的 —— 月份不重叠时不会有歧义，
   * 真重叠了（比如春节和花市都在二月）也是先写的那个，顺序由数据决定。
   */
  const month = Number(dateKey.slice(5, 7));
  if (Number.isFinite(month)) {
    for (const f of city.festivals) {
      if (f.months.includes(month)) return { name: f.name, what: f.what };
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

/**
 * 这一顿吃什么。
 *
 * ## 为什么有了 `city.foods` 还要保留 `foodHint`
 *
 * `foods` 是具体菜名（「兰州牛肉面」「酿皮子」），`foodHint` 是方向（「面，本地那一套」）。
 * 有菜名就用菜名 —— 具体名词才能让她写出「要了碗牛肉面，辣子放多了」；
 * 只有方向的时候她只能写「吃了一碗面」，跟「在街上走」一样空。
 *
 * 但**不是每个城市都有菜名**（127 城里 105 城有，其余留空），没有就退回方向。
 * 这是兜底，不是主力。
 *
 * ## 为什么要按餐次轮换
 *
 * 原来一天三顿共用同一个 `food` 值 —— 有了菜名之后就会变成
 * 「早饭兰州牛肉面 / 午饭兰州牛肉面 / 晚饭兰州牛肉面」。按早中晚各取一样，
 * 一个城三样菜正好一天不重样；只有两样时晚饭会回到第一样，那是真会发生的。
 *
 * ## 早饭不能是宴席（2026-11-07 修）
 *
 * 原来就是 `f[meal % f.length]` —— 机械地「早饭取第一样」。可 `foods` 那张表
 * **不是按餐次排的**，是按「本地最出名的」排的。于是：
 *
 * ```
 * 北京   → 早饭，北京烤鸭
 * 洛阳   → 早饭，洛阳水席        （水席是二十四道菜的宴席）
 * 科隆   → 早饭，科隆啤酒 Kölsch
 * 因特拉肯 → 早饭，芝士火锅 Fondue
 * ```
 *
 * 185 座城里有 21 座的第一样是宴席、火锅、烤肉或酒。她照着念，用户一眼就看出错了。
 *
 * 现在的取法：**早饭从「能当早饭」的那几样里挑，挑不到才退到「不是硬菜」的**，
 * 还挑不到才用第一样。午饭晚饭沿用原顺序，但会避开已经用掉的那两样 ——
 * 顺带修掉「只有两样菜时早饭和午饭撞车」。
 *
 * 判据只看**形态**（粥面饼包汤茶…），不看「是不是本地特色」——
 * 嘉峪关烤肉、北京烤鸭也很本地，可没有人早上吃。
 */
export function pickFood(
  city: City,
  meal: 0 | 1 | 2,
  seed = '',
  taste?: { readonly like?: readonly string[]; readonly dislike?: readonly string[] },
): string {
  /*
   * **她的口味要能改结果，不只是记下来**（2026-11-08 Mr.Q：「鱼的口味系统」）。
   *
   * `journey_taste` 从 0.5 就有了，但一直只写不读 —— 她记「折耳根不行」，
   * 下一顿照样能排到。这一版接上两件事：
   *
   * - `dislike`：从候选里剔掉。**剔完空了就退回原表** —— 宁可排一样她不爱吃的，
   *   也不能因为记了两条就一顿饭排不出来。
   * - `like`：四成概率优先排到（`hash % 100 < 40`，确定性的，不是随机数）。
   *   不做成「永远只吃喜欢的」—— 在外面跑的人不会天天点同一道。
   */
  const dislike = new Set((taste?.dislike ?? []).map((x) => String(x).trim()).filter(Boolean));
  const liked = (taste?.like ?? []).map((x) => String(x).trim()).filter(Boolean);
  /*
   * **招牌菜先入池**（2026-11-13，Discussion #586）。
   *
   * `FEATURES.chongqing.food = '火锅'`，可重庆那张菜表只有「重庆小面、毛血旺、酸辣粉」——
   * 两处数据自己打架，成都一模一样。用户看到的正是这一条：「最标志性的火锅和串串啥的没有」。
   *
   * 这张标签表是逐城人工填的，比 613 行的菜表更可信；标签上写了这座城该有这一样，
   * 菜表却没有，那就是菜表漏了。所以补到**最前面** —— 它是招牌，不是配菜。
   *
   * 只补得了一样（标签只有一个值）。补完仍然只有三四样的城，靠 `journey_eat`
   * 和她自己说 —— 那才是 A 的正身，这里只是把「表自己打架」这处硬伤修掉。
   */
  const signature = featureOf(city.id).food?.trim() ?? '';
  const all = signature && !city.foods.includes(signature)
    ? [signature, ...city.foods]
    : city.foods;
  const f = all.filter((x) => !dislike.has(x));
  /*
   * **池子不够三样就补**（2026-11-08）。
   *
   * 两种来源：这座城本来只写了两样（优胜美地那种），或者她记了「不想再吃」
   * 把池子剔剩下一样（成都只爱钟水饺的时候）。三顿要各不相同，至少得有三样。
   * 补的从大区家常菜里拿，**不掺她不想吃的东西**；实在剔空了才退回原表。
   */
  /*
   * **凑到十样**（2026-11-08 Mr.Q：「吃的最好每个城市有 10 种」）。
   *
   * 顺序就是优先级：**城里的菜 → 大区菜 → 国家菜**。
   * 本地写满十样就不再往下补，所以补进来的永远排在后面当配菜，不抢本地菜的位子。
   * 这样「只有三道菜的城」不会连着几天吃同样的东西，「当地只有两样」的海外城市
   * 也能吃到这个国家别的家常菜。
   */
  const regionKey = BREAKFAST_REGION[city.region] ?? 'west';
  const regionPool = city.country === 'CN'
    ? (MAIN_REGION[regionKey] ?? MAIN_REGION.west!)
    : (MAIN_BY_COUNTRY[city.country] ?? MAIN_REGION.west!);
  /*
   * 凑到 **12 样**（Mr.Q 要的是「10 种」，多留两样缓冲）：
   * 形态让位会吃掉一两个位置，卡在 10 的话实际能排出来的只有 8–9 样。
   */
  const merged = [...new Set([...all, ...regionPool])].slice(0, 12);
  /** 剔掉「不想再吃」，但**剔空了就退回整表** —— 不能因为记了两条就没饭吃。 */
  const afterTaste = merged.filter((x) => !dislike.has(x));
  const table = afterTaste.length ? afterTaste : merged;
  if (!table.length) return foodHint(city);
  /*
   * 早饭最后算 —— 它要知道「这城这趟会吃到哪十样」，才不会把晚饭那碗面
   * 原样端到第二天早上（银川：晚饭牛肉面，次日早饭还是牛肉面）。
   */
  const breakfast = breakfastOf(city, seed, dislike, table);
  if (meal === 0) return breakfast;
  /*
   * **午饭晚饭抽签，不再按固定顺序。**（2026-11-07 Mr.Q）
   *
   * 原来是 `foods[meal % len]`：一座城三样菜，永远「早饭第一样、午饭第二样、
   * 晚饭第三样」。同一座城待三天，三顿饭的排列一模一样 —— 读起来像配给表。
   *
   * 现在按 `城市 + 日期 + 餐次` 掷一次。**必须确定**：同一天重算结果要一样
   * （`plan-stable` 那条测试盯着），所以用哈希而不是 `Math.random`。
   */
  /*
   * **同一个「形态」也算重复**（2026-11-08 Mr.Q 在成都踩到的）。
   *
   * 成都那天：早饭是「红油抄手」（大区通用池），午饭是「钟水饺」（城里的菜名）。
   * 名字不一样、代码上完全合法，可端上来是**两碗红油饺子** ——
   * 用户看到的不是字符串，是两张一样的照片。
   *
   * 所以避重从「名字不同」升级成「形态不同」：抄手/馄饨/水饺/锅贴算一类，
   * 面/粉/米线算一类。先按形态避，池子不够才退回按名字避。
   */
  /*
   * 选法：**在整张池子里轮，形态只用来「让位」**（2026-11-08 第二次改）。
   *
   * 第一版是「先把同形态的剔掉再轮」—— 结果拉萨、天津这种城只剩两三道菜可轮，
   * 六十天里翻来覆去就那三样。**避重不能把池子避小**。
   *
   * 现在的做法：
   *
   * 1. 池子 = 这城这趟的十样，去掉早饭（午饭）／去掉早饭和午饭（晚饭）；
   * 2. 按「城市 + 日序」在**整个池子**里取一格（保证十天十天不重样）；
   * 3. 取到的那一格如果和上一顿同形态，**往后挪到第一个不同形态的**；
   *    挪不到（全是一个形态）就照旧 —— 宁可形态撞，也不能只剩一道菜。
   */
  const day = dayOrdinal(seed);
  /*
   * ## 最后的取法（2026-11-08 第四版，前三版都试过错）
   *
   * 三顿饭的形态关系，按强弱排：
   *
   * 1. **三个名字必须互不相同** —— 硬性，任何情况都不许破。
   * 2. **相邻两顿别是同一个形态** —— 这是用户看到的那两张饺子图。
   * 3. **十天里要吃到十样** —— 池子不能被「避形态」榨干。
   *
   * 做法只有一条：把池子按形态**交织**成一列（面/粉/饺/饭轮流），
   * 相邻两项天然不同形态、且覆盖全部。午饭从这一列取一格，
   * 晚饭取**下一格**；只有下面两种例外才多走一步：
   *
   * - 午饭撞了早饭的形态（比如早饭热干面、午饭又是面）；
   * - 晚饭正好等于早饭那道菜。
   *
   * 早先三版都在「取到之后往附近找」上打补丁，结果是两种坏法轮流出现：
   * 要么全池扫干净、十样缩成三样（拉萨/天津），要么相邻三天都挪到同一个
   * 位置、连着吃同一道（武汉）。**改动要落在排列上，不要落在取值上。**
   */
  const hard = (x: string): string => {
    const f = familyOf(x);
    return f === '其他' ? '' : f;
  };
  const interleave = (pool: readonly string[]): readonly string[] => {
    const groups = new Map<string, string[]>();
    for (const x of pool) {
      const f = familyOf(x);
      const arr = groups.get(f) ?? [];
      arr.push(x);
      groups.set(f, arr);
    }
    const out: string[] = [];
    while (out.length < pool.length) {
      let pushed = false;
      for (const arr of groups.values()) {
        const next = arr.shift();
        if (next !== undefined) {
          out.push(next);
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    return out;
  };

  const line = interleave(table);
  const n = line.length;
  const at = (i: number): string => line[((i % n) + n) % n]!;

  /*
   * 午饭：**先在「和早饭不同形态」的那个子列里轮**，而不是取到之后再挪。
   *
   * 「取到之后再挪一格」有个隐蔽的后果：今天挪到 k+1，明天正常轮到 k+1，
   * 两天就吃到同一道菜（武汉连着一周每天一模一样）。改成先把子列定下来、
   * 再在子列里按日序取，就不会和相邻的那天撞位置。
   */
  const famB = hard(breakfast);
  /*
   * 午饭同时剔掉两样：**早饭那道菜本身**（名字不许重）和**和早饭同形态的**。
   * 只按形态剔时，早饭若归在「其他」那一筐里（煎饼果子、肉夹馍），
   * 就会原样被午饭再点一次。
   */
  const noonPool = line.filter((x) => x !== breakfast && !(famB && hard(x) === famB));
  const pool = noonPool.length ? noonPool : line;
  const li = (hash(`${city.id}|lunch`) + day) % pool.length;
  /*
   * 「喜欢」的加成：四成概率从她记过「好吃」的那几样里起手，位置按日序挪 ——
   * 不做成「永远只吃这个」（在外面跑的人不会天天点同一道），
   * 也**不改变池子**（改池子就等于把十样缩水）。
   */
  const wish = pool.filter((x) => liked.includes(x));
  const lunch = wish.length && hash(`${city.id}|like|${seed}`) % 100 < 40
    ? wish[((day % wish.length) + wish.length) % wish.length]!
    : pool[li]!;
  if (meal === 1) return lunch;

  /* 晚饭取这一列里的**下一格**：交织过的列里，下一格必然换形态。 */
  let di = line.indexOf(lunch) + 1;
  if (at(di) === breakfast) di += 1;
  return at(di);
}

/**
 * 这道菜「形态」上是什么。**用来避重，不用来分类展示。**
 *
 * 判据是「端上来长得像一个东西」：
 *
 * - `饺`：饺子、水饺、蒸饺、抄手、馄饨、云吞、锅贴、烧麦 —— 都是一团馅包着皮；
 * - `面`：面、粉、米线、河粉、粉丝、凉皮（拌的也算同一类主食）；
 * - `饭`：饭、盖饭、炒饭、寿司（米饭打底）、饭团；
 * - `面包`：面包、可颂、贝果、吐司、三明治、披萨、派；
 * - `锅`：火锅、干锅、焖锅、砂锅；
 * - `烤`：烤肉、串、烧鹅、烤鸭、烤鱼；
 * - `粥`：粥、稀饭、糊；
 * - `海鲜`：蟹、虾、贝、生蚝；
 * - 其余 `其他`。
 *
 * **顺序有讲究**：先判「包馅」再判面 —— 「馄饨面」是面，「锅贴」是饺。
 */
export function familyOf(dish: string): string {
  const d = String(dish || '');
  if (/饺|抄手|馄饨|云吞|锅贴|烧麦|包子/.test(d)) return '饺';
  /*
   * **面和粉分开算**（2026-11-08 第二次修正）。
   *
   * 一开始全归「面」，结果武汉的早饭是热干面 → 午饭晚饭被禁止吃任何面食，
   * 米粉、糊汤粉、面窝全被排掉，十样只剩七样。可一碗热干面和一碗米粉
   * 端上来并不像 —— 真正撞脸的是「红油抄手 vs 钟水饺」那种同一种包馅。
   */
  if (/粉|米线|河粉|粉丝|米皮|肠粉|粿条/.test(d)) return '粉';
  if (/面|馕|饼|馍|烧饼|锅魁|面窝/.test(d)) return '面';
  if (/寿司|饭团|炒饭|盖饭|饭/.test(d)) return '饭';
  if (/面包|可颂|贝果|吐司|三明治|披萨|派|司康|布林饼/.test(d)) return '面包';
  if (/火锅|干锅|焖锅|砂锅|汤锅/.test(d)) return '锅';
  if (/烤|串|烧鹅|烧鸭|叉烧|烤肉/.test(d)) return '烤';
  if (/粥|稀饭|糊/.test(d)) return '粥';
  if (/蟹|虾|贝|生蚝|蛤蜊|海鲜/.test(d)) return '海鲜';
  return '其他';
}

/**
 * 这一天是第几天（自 1970 起的日序）。`seed` 不是 YYYY-MM-DD 时退回哈希。
 *
 * 用它而不是 `hash(seed)`，是为了**相邻两天一定换一样**：
 * 哈希会让「锅魁、锅魁」连着出现两天，而日序每加一天就往后挪一格，
 * 池子有 5 样就 5 天不重样。
 */
function dayOrdinal(seed: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seed)) return hash(seed);
  const [y, m, d] = seed.split('-').map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** 稳定哈希（FNV-1a 变体）。只要「同输入同输出」，不要求分布多好。 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * **真的是早饭的那几样。**（2026-11-07 Mr.Q）
 *
 * 「在成都吃麻婆豆腐」不是唯一的问题 —— 更普遍的问题是**每座城都拿自己的招牌菜
 * 当早饭**。可中国大部分地方的早饭是**通用的**：豆浆油条、包子粥、小面抄手。
 * 只有少数地方有「离开这儿没有」的早点：武汉热干面、洛阳牛肉汤、西安肉夹馍、
 * 天津煎饼果子、河南胡辣汤。
 *
 * 所以判据分两层：
 *   1. 这一城的菜里**本来就有**招牌早点 → 用它；
 *   2. 没有 → 从这个大区的通用早点池里抽一样。
 *
 * 这样成都早上是红油抄手 / 小面，不是麻婆豆腐；北京是豆浆油条，不是烤鸭。
 */
const SIGNATURE_BREAKFAST =
  /热干面|胡辣汤|煎饼果子|肠粉|米粉|米线|卷粉|河粉|牛肉汤|羊肉汤|糊锅|糊辣汤|豆汁|面茶|锅巴菜|烤冷面|粢饭|糯米鸡|沙茶面|面线糊|小笼|生煎|馄饨|抄手|云吞|豆花|豆浆|油条|包子|馒头|烧饼|粥|糍粑|粑粑|酥油茶|甜茶|锅魁|泡馍|肉夹馍|馕/;

/**
 * 大区通用早点池。
 *
 * 只写**真实存在、当地人真会吃**的东西，不写「当地特色小吃」这种废话。
 * 海外那一条是西式通用件 —— 总不能给巴黎的鱼端一碗胡辣汤。
 */
const BREAKFAST: Record<string, readonly string[]> = {
  north: ['豆浆油条', '小米粥配咸菜', '豆腐脑配油条', '猪肉大葱包子', '鸡蛋灌饼', '糖油饼配豆汁'],
  northeast: ['大碴子粥配咸菜', '豆腐脑配油条', '酸菜猪肉包子', '烤冷面', '粘豆包'],
  northwest: ['牛肉面', '油茶麻花', '肉夹馍', '锅盔配豆浆', '羊肉汤配饼'],
  jiangnan: ['小笼包配豆浆', '大饼油条', '咸豆浆配粢饭团', '生煎配咖喱牛肉汤', '阳春面'],
  central: ['热干面', '三鲜豆皮', '面窝配蛋酒', '糯米包油条'],
  south: ['肠粉', '白粥配咸菜', '糯米鸡', '云吞面', '及第粥'],
  southwest: ['红油抄手', '小面', '豆浆油条', '锅魁', '稀饭配泡菜'],
  yunnan: ['过桥米线', '烧饵块', '稀豆粉配油条'],
  plateau: ['酥油茶配糌粑', '甜茶配藏面'],
  west: ['面包配咖啡', '可颂配果酱', '煎蛋培根配吐司', '酸奶配麦片'],
};

/** 省份（或国家）→ 早点池。没列到的按「海外/其他」处理。 */
/**
 * 海外城市吃什么早饭（2026-11-08）。
 *
 * 原来所有非中国城市都落到 `west` 那一档（面包配咖啡 / 可颂 / 煎蛋培根）——
 * 给东京的鱼端一份可颂果酱，和给巴黎的鱼端胡辣汤一样离谱。
 *
 * 键是 `country` 两字码，都在 `City.country` 里；查不到才退 `west`。
 */
const BREAKFAST_BY_COUNTRY: Record<string, readonly string[]> = {
  JP: ['米饭配味噌汤', '饭团配煎茶', '玉子烧配白粥'],
  KR: ['白粥配泡菜', '紫菜包饭', '豆芽汤饭'],
  TH: ['泰式粥配油条', '猪肉粥配姜丝', '打抛猪肉饭'],
  SG: ['咖椰吐司配半熟蛋', '肉骨茶配油条', '椰浆饭 nasi lemak'],
  VN: ['河粉', '法棍三明治 banh mi', '越南咖啡配糯米饭'],
  FR: ['可颂配咖啡', '法棍抹黄油配果酱', '欧姆蛋配面包'],
  GB: ['英式早餐（蛋、豆子、培根）', '吐司配红茶', '燕麦粥配蜂蜜'],
  IT: ['浓缩咖啡配可颂', '面包配橄榄油', '卡布奇诺配饼干'],
  RU: ['布林饼配酸奶油', '荞麦粥配奶', '黑面包配红茶'],
  US: ['贝果配奶油奶酪', '煎蛋培根配吐司', '燕麦配蓝莓'],
  AU: ['吐司配平白咖啡', '澳式早餐（蛋、牛油果、酸面包）', 'Weet-Bix 配牛奶'],
  NZ: ['吐司配小白咖啡', '麦片配酸奶', '培根蛋卷'],
  AE: ['沙威玛卷', '阿拉伯大饼配鹰嘴豆泥', '椰枣配阿拉伯咖啡'],
  TR: ['芝麻圈 simit 配红茶', '奶酪橄榄配面包', '土耳其蛋 menemen'],
  BR: ['奶酪面包配咖啡', '木薯饼配煎蛋', '水果配酸奶'],
  AR: ['烤面包配马黛茶', '甜牛角包 medialunas', '火腿奶酪三明治'],
  CA: ['贝果配咖啡', '枫糖煎饼', '培根蛋配薯饼'],
  MX: ['玉米饼配豆子', '炒蛋配玉米饼 chilaquiles', '甜面包配热可可'],
  PL: ['香肠配黑面包', '奶酪面包配茶', '炒蛋配香葱'],
  AT: ['面包卷配咖啡', '火腿奶酪配面包', '苹果卷配红茶'],
  BE: ['面包配黄油果酱', '华夫饼配咖啡', '水煮蛋配吐司'],
  CH: ['牛奶麦片 muesli', '面包配奶酪', '咖啡配可颂'],
  CZ: ['面包配火腿和芥末', '甜面包卷 trdelník', '咖啡配酸奶'],
  DE: ['黑面包配冷切肉', '椒盐卷饼配黄油', '煮蛋配咖啡'],
  HU: ['烟囱卷配咖啡', '香肠配面包', '酸奶油面包'],
  IE: ['苏打面包配黄油', '全套爱尔兰早餐', '燕麦粥配蜂蜜'],
  NL: ['面包配奶酪和糖浆华夫', '酸奶配谷物', '咖啡配小饼干'],
};

/**
 * 主餐池：**本地菜不够十样时，用这一层的菜补**（2026-11-08 Mr.Q）。
 *
 * 「吃的最好每个城市有 10 种，要是实在没有本地菜，就可以用区域菜来代替，
 * 实在不行就按南北方或者国家为单位来排。」
 *
 * 所以取法分三层，写在这里就是那张表的顺序：
 *
 * ```
 * 城里的菜（3–8 样） → 大区家常菜（这一张） → 国家菜（海外那张）
 * ```
 *
 * 前一层写满十样就不再往下补 —— **本地菜永远排在前面**，补进来的不抢位子。
 */
const MAIN_REGION: Record<string, readonly string[]> = {
  north: [
    '炸酱面', '猪肉白菜饺子', '卤煮火烧', '家常炒饼', '京酱肉丝',
    '醋溜白菜', '疙瘩汤', '麻酱烧饼', '炒肝', '炸咯吱',
  ],
  northeast: [
    '锅包肉', '小鸡炖蘑菇', '猪肉炖粉条', '酸菜白肉', '地三鲜',
    '溜肉段', '东北大拉皮', '杀猪菜', '粘豆包', '烤冷面',
  ],
  northwest: [
    '牛肉面', '羊肉泡馍', '拉条子', '手抓羊肉', '大盘鸡',
    '臊子面', '酿皮', '烤羊肉串', '浆水面', '油茶麻花',
  ],
  jiangnan: [
    '红烧肉', '响油鳝糊', '菜饭', '生煎', '腌笃鲜',
    '油爆虾', '蟹粉豆腐', '青团', '阳春面', '小笼包',
  ],
  central: [
    '热干面', '排骨藕汤', '武昌鱼', '三鲜豆皮', '面窝',
    '糯米鸡', '剁椒鱼头', '辣椒炒肉', '米粉', '糊汤粉',
  ],
  south: [
    '白切鸡', '煲仔饭', '炒牛河', '老火汤', '烧鹅',
    '虾饺', '艇仔粥', '叉烧', '清蒸鱼', '肠粉',
  ],
  southwest: [
    '回锅肉', '担担面', '酸辣粉', '口水鸡', '宫保鸡丁',
    '麻婆豆腐', '水煮鱼', '豆花饭', '酸汤鱼', '干煸四季豆',
  ],
  yunnan: [
    '小锅米线', '汽锅鸡', '炒饵块', '过桥米线', '舂鸡脚',
    '破酥包', '酸笋煮鱼', '乳扇', '洋芋饭', '菠萝饭',
  ],
  plateau: [
    '藏面', '牦牛肉', '酥油茶', '糌粑', '手抓羊肉',
    '土豆包子', '酸奶', '甜茶', '青稞饼', '藏式火锅',
  ],
  west: [
    '牛排配薯条', '意面', '三明治', '烤鸡', '汉堡',
    '沙拉', '烤土豆', '炖牛肉', '披萨', '汤配面包',
  ],
};

/**
 * 海外的「国家菜」（2026-11-08）。
 *
 * 城里的三样是**这座城市**的名菜，这一层是**这个国家**到处都吃得到的东西。
 * 两层加起来凑十样 —— 东京三天吃不到第十种寿司，但能吃到咖喱饭和乌冬。
 */
const MAIN_BY_COUNTRY: Record<string, readonly string[]> = {
  JP: ['酱油拉面', '咖喱饭', '亲子丼', '猪排饭', '乌冬面', '关东煮', '烤鸡肉串', '饭团', '天妇罗荞麦面', '蛋包饭'],
  KR: ['泡菜汤', '石锅拌饭', '冷面', '辣炒年糕', '烤五花肉', '炸酱面', '紫菜包饭', '海鲜煎饼', '部队锅', '参鸡汤'],
  TH: ['绿咖喱', '青木瓜沙拉', '咖喱蟹', '烤猪颈肉', '糯米饭配烤鸡', '冬阴功', '泰式炒河粉', '船面', '泰式酸辣汤', '芒果糯米饭'],
  SG: ['肉骨茶', '炒粿条', '沙爹', '罗惹', '咖喱鱼头', '福建面', '海南鸡饭', '辣椒螃蟹', '叻沙', '咖椰吐司'],
  VN: ['越南春卷', '法棍三明治', '河粉', '烤肉米线', '越南煎饼', '糯米饭', '越式火锅', '滴漏咖啡配炼乳', '甘蔗虾', '牛肉粉'],
  FR: ['牛排配薯条', '可丽饼', '火腿三明治', '红酒炖牛肉', '尼斯沙拉', '奶酪配面包', '洋葱汤', '油封鸭', '烤鸡', '法棍'],
  GB: ['派配薯泥', '三明治', '咖喱鸡', '周日烤肉', '司康', '炸鱼薯条', '香肠配薯泥', '牧羊人派', '黑布丁', '下午茶点心'],
  IT: ['披萨', '千层面', '烩饭', '培根蛋面', '帕尼尼', '提拉米苏', '烤蔬菜', '意式馄饨', '海鲜面', '意式冰淇淋'],
  RU: ['罗宋汤', '布林饼', '俄式饺子', '烤肉串', '荞麦饭', '腌黄瓜配土豆', '熏鱼', '俄式沙拉', '奶渣饼', '格瓦斯配黑面包'],
  US: ['汉堡', '热狗', '烤肋排', '三明治', '沙拉', '披萨', '炸鸡', '苹果派', '蛤蜊浓汤', '牛排'],
  AU: ['肉派', '烤羊排', '炸鱼薯条', '澳式汉堡', '帕芙洛娃', '香肠三明治', '海鲜饭', '澳式早餐', '拉明顿蛋糕', '烤肉拼盘'],
  NZ: ['羊排', '绿唇贻贝', '帕芙洛娃', '汉堡', '炸鱼薯条', '肉派', '库马拉烤红薯', '青口配白葡萄酒', '蛋白饼', '羊奶奶酪'],
  AE: ['沙威玛', '烤肉串', '羊肉焖饭', '鹰嘴豆泥', '法拉费', '阿拉伯大饼', '椰枣甜点', '烤鱼', '骆驼奶布丁', '香料饭'],
  TR: ['土耳其烤肉', '土耳其披萨 pide', '鱼三明治', '巴克拉瓦', '茄子炖肉', '扁豆汤', '米布丁', '烤肉丸', '酸奶饮 ayran 配饼', '果仁蜜饼'],
  BR: ['巴西烤肉', '黑豆炖肉', '奶酪面包', '木薯饼', '虾炖锅', '巴西莓碗', '炸豆饼 acaraje', '椰子甜点', '烤鸡配木薯粉', '牛肉干配豆子'],
  AR: ['炭烤牛肉 asado', '牛肉馅饼', '烤肠面包', '米兰炸肉排', '牛奶焦糖酱配面包', '意面', '烤羊排', '玉米炖肉 locro', '奶酪饼', '甜牛角包'],
  CA: ['肉汁奶酪薯条', '烟熏肉三明治', '枫糖三文鱼', '纳奈莫条', '汉堡', '肉派', '枫糖煎饼', '奶酪凝乳', '烤三文鱼', '豌豆汤'],
  MX: ['塔可', '玉米粽', '鼹鼠酱 mole', '墨西哥三明治', '烤玉米', '奶酪薄饼 quesadilla', '牛油果酱配玉米片', '玉米汤', '烤肉 tacos al pastor', '甜面包'],
  PL: ['波兰饺子', '猪排', '酸汤', '香肠配酸菜', '土豆饼', '炖白菜', '烤鸭配苹果', '红菜汤', '酸黄瓜汤', '奶酪蛋糕'],
  AT: ['炸猪排', '炖牛肉 gulasch', '苹果卷', '奶酪面', '香肠配芥末', '皇帝煎饼', '烤猪肘', '土豆沙拉', '丸子汤', '杏子团子'],
  BE: ['华夫饼', '薯条配蛋黄酱', '青口锅', '啤酒炖牛肉', '巧克力', '奶酪火腿三明治', '肉丸配酱汁', '芦笋配蛋', '炖鸡', '列日糖浆饼'],
  CH: ['奶酪火锅', '土豆饼', '奶酪通心粉', '香肠配洋葱', '巧克力', '面包配奶酪', '风干牛肉', '蛋白饼配奶油', '洋葱汤', '烤奶酪'],
  CZ: ['烤猪肘', '饺子配酸菜', '炸奶酪', '牛肉汤', '甜面包卷', '烤香肠', '炖牛肉配面包', '酸奶油炖肉', '土豆汤', '苹果卷'],
  DE: ['香肠配酸菜', '烤猪肘', '炸猪排', '土豆沙拉', '椒盐卷饼', '咖喱香肠', '白香肠配甜芥末', '炖牛肉', '黑面包配冷切', '猪肝肠配面包'],
  HU: ['炖牛肉 gulyás', '红椒鸡', '鱼汤', '烟囱卷', '酸奶油面', '炸小饼 langos', '香肠配芥末', '甜椒炖肉', '面条配奶酪', '樱桃汤'],
  IE: ['炖羊肉', '苏打面包', '土豆泥配香肠', '海鲜浓汤', '炸鱼薯条', '爱尔兰炖菜', '培根卷心菜', '燕麦粥', '蟹肉沙拉', '黑布丁'],
  NL: ['炸肉丸', '荷兰松饼', '鲱鱼配洋葱', '薯条配蛋黄酱', '奶酪', '炖牛肉', '豌豆汤', '三明治配奶酪', '苹果派', '生鲱鱼三明治'],
};

const BREAKFAST_REGION: Record<string, string> = {
  北京: 'north', 天津: 'north', 河北: 'north', 山西: 'north', 内蒙古: 'northeast',
  辽宁: 'northeast', 吉林: 'northeast', 黑龙江: 'northeast',
  陕西: 'northwest', 甘肃: 'northwest', 宁夏: 'northwest', 新疆: 'northwest', 青海: 'northwest',
  上海: 'jiangnan', 江苏: 'jiangnan', 浙江: 'jiangnan', 安徽: 'jiangnan', 江西: 'jiangnan', 福建: 'jiangnan',
  山东: 'north', 河南: 'north',
  湖北: 'central', 湖南: 'south',
  广东: 'south', 广西: 'south', 海南: 'south', 中国香港: 'south', 中国澳门: 'south',
  四川: 'southwest', 重庆: 'southwest', 贵州: 'southwest',
  云南: 'yunnan', 西藏: 'plateau',
};

/**
 * 这一城早饭吃什么。
 *
 * 招牌早点优先（`SIGNATURE_BREAKFAST`），没有就从大区的通用池里抽一样。
 * 抽签带 `seed`（日期），所以同一座城待三天会吃到三样不同的东西 ——
 * 而不是「三天早上都是同一碗」。
 */
function breakfastOf(
  city: City,
  seed: string,
  avoid?: ReadonlySet<string>,
  mains?: readonly string[],
): string {
  /*
   * `mains` = 这城这趟会吃到的那十样。**早饭池里跟主菜同名的一律剔掉** ——
   * 银川的早饭池和西北主餐池里都有「牛肉面」，不剔的话就是晚上一碗面、
   * 第二天早上一碗面（2026-11-08 扫出来的）。剔完只剩一样才退回原池。
   */
  const skip = (x: string): boolean => (avoid?.has(x) ?? false) || (mains?.includes(x) ?? false);
  /*
   * **招牌早点不参与 `mains` 过滤**：热干面既是武汉的早饭也是它午饭的候选，
   * 那是真实情况（本地人早上热干面、中午还吃热干面）。午饭晚饭那边会自己避开它，
   * 早饭这边不能因为「它在主菜池里」就把招牌早点让掉 —— 那等于把热干面从武汉赶走。
   */
  const local = city.foods.find(
    (x) => SIGNATURE_BREAKFAST.test(x) && !NOT_BREAKFAST.test(x) && !(avoid?.has(x) ?? false),
  );
  if (local) return local;
  /*
   * 海外先按国家取（2026-11-08）：`region` 对中国城市是省名，对外国城市是国家名，
   * 用省名那张表去查永远是空，于是全落到 `west`。
   */
  if (city.country !== 'CN') {
    const raw = BREAKFAST_BY_COUNTRY[city.country] ?? BREAKFAST.west!;
    const kept = raw.filter((x) => !skip(x));
    const pool = kept.length ? kept : raw;
    return pool[(hash(`${city.id}|breakfast`) + dayOrdinal(seed)) % pool.length]!;
  }
  const key = BREAKFAST_REGION[city.region] ?? 'west';
  const raw = BREAKFAST[key] ?? BREAKFAST.west!;
  const kept = raw.filter((x) => !skip(x));
  const pool = kept.length ? kept : raw;
  return pool[(hash(`${city.id}|breakfast`) + dayOrdinal(seed)) % pool.length]!;
}

/** 早上不会吃的东西：宴席、火锅、整只的烤肉、酒。 */
const NOT_BREAKFAST =
  /宴|火锅|水席|啤酒|葡萄酒|威士忌|伏特加|清酒|烧酒|白酒|烤鸭|烤全羊|烤肉|烧鹅|烧腊|叉烧|刺身|生蚝|牛排|steak|猪肘|拼盘|青口锅|干锅|焖锅|地锅|石锅|汤锅|三下锅|一品锅|浑锅|大盘鸡|锅包肉/i;

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
  /*
   * 没有景点可排的时候去干什么（2026-11-08 Mr.Q：河边逛逛、买土特产、
   * 看看这座城市独有的景色）。放在兜底三条**之前** —— 那三条是最后一档。
   */
  out.push(...idleSpots(city, vistaOf(city.id)));
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
   * 同城同时段还有谁（最多三个）。不传＝没人，或者是碰面没开。
   *
   * 只进叙事，不进任何计算 —— 她在哪儿、花多少钱、什么时候睡，都和这个无关。
   */
  neighbors?: readonly { pet: string; doing: string }[];
  pool?: number;
  /**
   * 同城别人发出来的邀约。不传＝没拉、或者没有 —— 两种都是空数组，不必区分：
   * 这一天照排，叙事里少一句而已。
   */
  invites?: readonly { id: string; pet: string; to: string; toName: string; days: number; note: string }[];
  /**
   * 在这个城市的第几天（0 = 到的那天）。
   *
   * 只影响「今天去哪儿」—— 每天换一批地标，别连着两天排同一个。
   * 不传就是 0，行为跟老版本一致。
   */
  dayIndex?: number;
  /**
   * **包车还在服务时间内**（2026-11-11，鱼鱼出行作者提的接口申请）。
   *
   * 对方（鱼鱼出行）按小时卖包车，4 / 8 / 20 小时。服务时间内那张订单是**已经付过钱的**，
   * 可她一出门，这边仍然会按 `inCityMode` 叫一辆公交或者另一辆出租 ——
   * 同一个下午两笔车费，日记里两段交通，怎么解释都像 bug。
   *
   * 传 true 时：**完全不走城市交通**，直接推一段「坐包车去 X」，
   * 里程照算（车总要开过去），但**不收费** —— 钱在那张订单里已经付了。
   *
   * 判据在 `world.ts` 的 `charterNow()`：`ride-live.json` 的 `service === 'charter'`、
   * 没过 `expiresAt`、`to` 非空。
   */
  charter?: boolean;
  /**
   * 这趟手上有车吗（2026-11-06）。
   *
   * 用户来信：「如果是自驾那么这次全程应该都是自驾，去景点也是自驾，
   * 自驾要耗油费或者电费」。有车的时候城里就不坐公交了 —— 油钱比两张公交票贵，
   * 但她有车就是为了方便，算账不是这时候算的。
   */
  car?: { fuel: 'oil' | 'ev'; tier?: CarTier } | null;
  /**
   * 不自己叫出租（2026-11-10）。
   *
   * 装了第三方打车扩展时，城里那套车归它 —— 这边再排一趟出租，
   * 同一天就有两段「打车」、账上两笔钱。传 true 时九公里以上改走公交/地铁。
   *
   * 为什么是「不叫车」而不是「问对方能不能叫」：排程是纯计算，不发请求。
   */
  noTaxi?: boolean;
  /**
   * 景区里花不花这个钱（2026-11-10）。
   *
   * 和 `comfortable` 分开是因为**它原来管错了东西**：`comfortable` 的来源是
   * 「记账开着 + 预算还剩 2500 以上」，于是**记账一关，景区里就永远只能走路** ——
   * 索道、观光车、自行车、讲解一次都不会出现。用户截图「腿酸就租个自行车呗」
   * 就是这个后果：不是随机没抽到，是硬开关。
   *
   * 判据应该看「价目够不够坐一趟」，不是「钱包鼓不鼓」。
   * 不传就沿用 `comfortable`，行为跟老版本一致。
   */
  spotRideOk?: boolean;
  /** 高体质时跳过「脚酸 / 走不动」类抱怨。 */
  highFitness?: boolean;
  /** 低精力时在景区更倾向坐缆车、观光车、打车。 */
  lowEnergy?: boolean;
  /**
   * 手头宽不宽（余钱够不够放松花）。影响景点里买不买讲解/观光车 ——
   * 不传 = 不宽，她自己走。
   */
  comfortable?: boolean;
  /**
   * 她的口味（2026-11-08 Mr.Q：「鱼的口味系统」）。
   *
   * 原来 `journey_taste` 只记不用 —— 她写了「不吃折耳根」，下一顿照样能排到。
   * 现在两件事：`dislike` 里的东西**不会再被排到**，`like` 里的更常出现。
   */
  readonly taste?: { readonly like?: readonly string[]; readonly dislike?: readonly string[] };
  /**
   * 一起待着的人（2026-11-08）。
   *
   * 有名字就把「一起」写进日程和饭菜里，不只是写在约法那一句里 ——
   * 用户看到的第 31 天和第 1 天一样，是因为日程里根本没提过那个人。
   */
  readonly mate?: string;
  /**
   * 跟同行那一位的熟络度 0–100（2026-11-08）。
   *
   * 联动两处，缺一边就不成立：
   *
   * 1. **一天提到几次** —— 见下面 `MATE_BIAS`。刚约上的两个人各走各的，
   *    处处都把名字挂上去反而假；一起走过几趟之后几乎全程在一块儿。
   * 2. **哪些话现在还说不得** —— 见 `mate-talk.ts` 里每条句子的 `min`。
   *    这句话是「关系浅不是少说话，是说不了某些话」。
   *
   * 不传 = 0（刚认识），跟老版本的行为一致。
   */
  readonly warmth?: number;
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
  const nightOption = nightWet ? null : nightOptionOf(city, dayIdx, Number(dateKey.slice(5, 7)));

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
  /*
   * 城内交通的累积（2026-11-06）。
   *
   * 用户来信：「去景点也要坐公交」。原来她只有「去哪儿」没有「怎么去」——
   * 从住处到龙门石窟、从石窟到饭馆，中间那段是空的，日历上看起来像瞬移。
   */
  let trips = 0;
  let tripCost = 0;
  /** 停车单独记：回程不算它（回酒店/回住处，停车场不收费）。 */
  let parkCost = 0;
  /** 景点里的额外消费（讲解/观光车/自行车）。 */
  const extraItems: string[] = [];
  let extraCost = 0;
  const modes = new Set<string>();
  /*
   * 有地铁的城市。没有真实线网数据，用城市价格指数当代理 ——
   * 指数 > 1.05 的基本是省会/计划单列市，那儿确实有地铁；
   * 县城指数在 0.8 上下，不会误判。
   */
  const hasMetro = city.priceIdx >= 1.05;
  /*
   * 今天舍不舍得在景点上花钱。和酒店/座位用同一套思路：
   * 宽的时候才会买讲解、坐观光车；紧的时候自己走。
   */
  const richThisDay = args.comfortable === true;

  /**
   * 这一顿吃什么。
   *
   * ## 2026-11-08 改：不再只有晚饭带着人
   *
   * Mr.Q 看日程面板：「现在互动事件只有吃饭嘛」。那句话其实已经过奖了 ——
   * 那时候**只有晚饭**那一格挂着人，而且是「和 A、B、C 一起，担担面」这种写法：
   * 人只是状语，把名字抠掉句子照样成立。白天的景点、傍晚的江边、夜里回住处，
   * 全是她一个人。
   *
   * 现在三餐都进 `dineWith`（各有各的句式，见那个函数），
   * 但**早饭只有四成**：一起旅行的人早上常常各吃各的，她先起了就先下楼。
   * 三餐全挂名字反而像填表。
   */
  /**
   * 日程里怎么称呼一起走的人。
   *
   * 一群人的时候 `args.mate` 是一串全名（「慕容悠、玄月的大肥鱼、风子家的鱼宝宝」），
   * 塞进任何一句都会把句子挤爆 —— 截图里那句「晚饭，慕容悠、玄月的大肥鱼、
   * 风子家的鱼宝宝一起，担担面」正是这么变长的。
   *
   * 全名只在 `mateLine`（「这几天不是一个人：跟 XXX 说好待三天」）里报**一次**，
   * 日程里用短称呼。一个人时就用名字。
   */
  /**
   * 「这一处要不要提到她」用的骰子。返回 0–99。
   *
   * ## 为什么不用 `hashOf(日期) % 100`
   *
   * 试过两版都不行：
   *
   * - `% 10` 取低位：城市不变、只有日期在变时，FNV 的低位规律性极强。
   *   实测某 12 天里「早四成」只命中 1 天（期望 4.8），连续一周早饭都是一个人。
   * - 换成 `>>> 8` 取高位：好一点，但「夜六成」实测仍是 83%。
   *
   * 根本原因是**样本太小**：用户看到的是七天，不是三百三十六天。
   * 三百多天均匀，七天里挤在一侧完全可能。
   *
   * ## 所以这里让日期自己推进
   *
   * 日序 × 37 再加一个哈希起点 —— 37 与 100 互质，**每过一天格子挪 37**，
   * 于是任意连续 100 天里 0–99 各出现一次，任意七天窗口里落点也是散的。
   * 城市哈希只决定「从哪一格开始」，不影响均匀性。
   */
  const odds = (key: string): number => {
    const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
    return (hashOf(`${city.id}|${key}`) + day * 37) % 100;
  };

  /**
   * 日程里怎么称呼一起走的人 —— **三级**。
   *
   * | 人数 | 称呼 | 为什么 |
   * |---|---|---|
   * | 1 | 名字本身（「小满」） | 名字就是最具体的称呼 |
   * | 2 | 「小满和阿澈」 | 两个名字合起来六七个字，还读得下去 |
   * | 3+ | 「小伙伴们」 | 全名塞进去会把句子挤爆 |
   *
   * ## 第一版写的是「他们」，被 Mr.Q 退回来了（2026-11-08）
   *
   * 原话：「改成小伙伴们、或者把名字列出来比较好」。
   *
   * 他是对的。「他们」既没有辨识度，也不像认识的人 —— 一起走的是**伙伴**，
   * 不是「他们」。而且「他们」在中文里天然带一层距离感，
   * 拿来指三只天天一起吃饭的鱼，读着像在写别人的事。
   *
   * 全名（「慕容悠、玄月的大肥鱼、风子家的鱼宝宝」）仍只在 `mateLine` 报一次 ——
   * 那句是「跟 XXX 说好待三天」，本来就要说清是谁。
   */
  const mateCall = ((): string => {
    const raw = String(args.mate ?? '').trim();
    if (!raw) return '';
    const names = raw.split(/[、,，]|\s+和\s+/).map((x) => x.trim()).filter(Boolean);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]}和${names[1]}`;
    return '小伙伴们';
  })();

  /**
   * 今天哪几处会提到她。**先一次算完，别在四处各掷各的骰子。**
   *
   * ## 为什么要先算
   *
   * 因为要**保底**：各处独立掷骰时，偶尔会出现「早中晚景点夜里全不中」，
   * 一天只剩晚饭那一处带着人 —— 那正是用户截图发过来的样子
   * （「现在互动事件只有吃饭嘛」）。保底只有在事后还能改的时候才做得到。
   *
   * 规则：晚饭恒有一处（没人一起吃的晚饭不叫一起旅行）；
   * 其余四处（早饭 / 午饭 / 景点中段 / 夜里）如果全没中，**把午饭打开**。
   * 补午饭而不是补夜里：夜里不一定有安排，午饭每天都有。
   */
  const slots = (() => {
    if (!mateCall) return { meal0: false, meal1: false, meal2: true, mid: false, night: false };
    /*
     * **关系越熟，一天提到对方的次数越多。**（2026-11-08 Mr.Q：「这些事件可以和好感度系统联动起来嘛」）
     *
     * 判据是旅行里真实的样子：刚在城里碰上的两个人，头两天各走各的多 ——
     * 你去看你的、我去吃我的，一天有两三处一起就够了；一起走过几趟之后，
     * 几乎每一项都是两个人的。
     *
     * 系数挂在**概率**上而不是句子上：句子那一层管的是「这句话现在能不能说」
     * （见 `mate-talk.ts` 的 `min`），这一层管的是「今天有多少处会写到他」。
     * 两件事分开，因为它们错得起因不同 ——
     * 一处是**关系的深浅**，一处是**这对人今天黏不黏**。
     *
     * 0.72 → 1.28 是五档台阶，没用连续值：连续会让 ±6 分的变化在重算时
     * 悄悄挪动概率（日程会被重建好几次），台阶只在整个关系进档时才变。
     */
    const bias = ({ 0: 0.72, 12: 0.86, 24: 1, 36: 1.14, 60: 1.28 } as Record<number, number>)[
      warmthStep(args.warmth ?? 0)
    ]!;
    const meal0 = odds('meal0') < 30 * bias;
    const meal1 = odds('meal1') < 65 * bias;
    /*
     * **不要为了让「白天也有他」而把这一格钉死。**
     *
     * 2026-11-11 试过一次：有人一起就让中段必出。结果一天提到对方 4 处，
     * 而且「关系越深越常提到」那条梯度也消失了（已经顶到上限）。
     * `mate-day.test.mjs` 那条「一天最多五处、平均三上下」正是为这个定的 ——
     * 第一版五格全给宽，出来一天 4.2 处，那不是一起旅行，那是每格填名字。
     *
     * 「两个人路上什么也不说」的真实缺口不在同住期间（那几天每天三处左右），
     * 在**不同城的时候**没有任何联系 —— 那是聊天系统的事，不该塞进日程。
     */
    const mid = odds('mid') < 40 * bias;
    const night = Boolean(nightOption) && odds('night') < 60 * bias;
    if (meal0 || meal1 || mid || night) return { meal0, meal1, meal2: true, mid, night };
    return { meal0, meal1: true, meal2: true, mid, night };
  })();

  /*
   * **一起旅行的时候，景区代步和酒店夜间也要带上人**（2026-11-09）。
   *
   * Mr.Q 问：「这些附加的东西，会不会写进和其他鱼一起玩的规划里？」
   *
   * 查下来：内容在（`act` 和 `settleIn` 照常跑），但**文案里没有同伴** ——
   * 一起吃、一起逛夜景都有 `dineWith` / `midWith` / `nightWith` 管，
   * 唯独「坐索道」「在泳池游泳」这两处，读起来像她一个人去的。
   *
   * 不重写句式，只在末尾补一句「XX也在」：
   * 「坐索道上去的，缆车在钢索上轻轻晃…。小满也在。」
   * 改句式风险更大 —— 那几句是按场景写死的，加主语容易拧。
   */
  const withMate = (text: string): string =>
    mateCall ? `${text.replace(/。$/, '')}。${mateCall}也在。` : text;

  const foodOf = (meal: 0 | 1 | 2): string => {
    const dish = pickFood(city, meal, dateKey, args.taste);
    if (!mateCall) return dish;
    const seed = hashOf(`${city.id}${dateKey}|meal${meal}`);
    /*
     * 早饭两成半、午饭六成半、晚饭必有。
     *
     * **晚饭固定**：没人一起吃的晚饭，那就不叫一起旅行了。
     * 其余各处给概率而不是全体打开 —— 五处全挂名字就成了填表，
     * 而「哪几处提到她」每天不一样，才像过日子。
     *
     * 五处（早/午/晚/景点中段/夜里）的期望是 2.9 处一天。
     * **最先调的是高的一版**：五处都给宽（早四成、午八成五、夜七成五、中段五成）
     * 出来一天平均 4.2 处、最多 6 处 —— 那不是「一起旅行」，那是每格填名字。
     * 从「只有晚饭」调到「处处都是」，只是换了一个极端。
     */
    const withThem = meal === 0 ? slots.meal0 : meal === 1 ? slots.meal1 : slots.meal2;
    return withThem ? dineWith(mateCall, dish, meal, seed, args.warmth ?? 0) : dish;
  };

  /*
   * 这几天算不算「暖」。只用来决定海边能不能下水（2026-11-08）。
   *
   * 判据是月 + 纬度：五月到十月、北纬 34.5 以南 —— 三亚/厦门/北海在里头，
   * 青岛(36.1)/大连(38.9)/秦皇岛(39.9) 不在。北方海边的摩托艇老板那时候也不出海。
   */
  const warmDay = (() => {
    const m = Number(dateKey.slice(5, 7));
    /*
     * 北纬 20.5 以南（三亚 18.3、海口 20.0）**全年都能下水** ——
     * 十一月的三亚水温还有 25 度，按「五月到十月」一刀切会把它也砍掉。
     */
    if (city.lat <= 20.5) return true;
    return m >= 5 && m <= 10 && city.lat <= 34.5;
  })();

  /*
   * 晚上回住处那一格，以及**在酒店能干点什么**（2026-11-08 Mr.Q）。
   *
   * 好酒店有泳池、健身房、SPA；快捷连锁和招待所什么都不加 ——
   * 「在县城宾馆做 SPA」比不写更假。判档在 `hotelEvening` 里。
   * 晚到（十点以后进房间）不排这些：那一晚只够洗澡睡觉。
   */
  /**
   * 夜里那一格。
   *
   * 一起旅行的人晚上多半一块儿出去，所以这里**默认带人**；
   * 但演出不接（`《又见平遥》` 那种）—— 坐进剧场之后是台上在演，没人说话。
   */
  const nightLine = (opt: string): string => {
    if (!mateCall) return opt;
    /* 演出不接人：坐进剧场之后台上在演，没人说话。 */
    if (opt.includes('《')) return opt;
    /*
     * 六成 —— **原来是无条件接人**，于是每天夜里都有一句，
     * 连着住十天就是十句同一个位置的句子，位置一固定就看出是模板了。
     */
    if (!slots.night) return opt;
    return nightWith(mateCall, opt, hashOf(`${city.id}${dateKey}|night`), args.warmth ?? 0);
  };

  /** 中段那句今天挂过没有（见 `slots.mid`）。 */
  let midUsed = false;

  const stayIn = (at: number, text: string): void => {
    push(at, 'hotel', text);
    /*
     * **21 点及以后到店，只写进房间和睡。**
     *
     * 原来卡在 21.5，是给「泳池/健身房」留的 —— 那些确实不该在深夜加。
     * 2026-11-09 夜间选项改成按真实设施生成后，多出了「冲个澡就躺下了」
     * 这种**任何档位都有**的项，21:30 到店会被塞进一条，时间轴读起来是
     * 「进房间 → 冲个澡 → 睡」，三个节点说一件事。
     *
     * 判据：**到得晚，夜晚本来就是一件事。** 边界收到 21。
     */
    if (at >= 21) return;
    /*
     * 2026-11-09：把**这家店真有的设施**传进去。
     * 原来只传档位，五星档一律给泳池 —— 挂着真店名就容易说错。
     */
    const eve = hotelEvening(
      lodging.tier,
      hashOf(`${city.id}${dateKey}hotel`) + Math.round(at * 60),
      richThisDay,
      lodging.amen,
      lodging.around,
      /*
       * 夜间去处：**问道采到的具体地点**优先（162 城），其次 `city.night`。
       *
       * 用 `nightIn` 而不是 `city.night` —— 后者可能是 `{ text, months }`，
       * 直接拼进字符串会变成「出门去了[object Object]」。
       * 2026-11-09 长跑到德累斯顿当场炸出来（那里的夜间去处只在 6–8 月成立）。
       *
       * 传种子不传 Math.random：同一晚重算两次不该换个地方去。
       */
      playLine(city.id, () => (hashOf(`${city.id}${dateKey}night`) % 997) / 997)
        || nightIn(city, Number(dateKey.slice(5, 7)))
        || '',
    );
    if (!eve) return;
    if (eve.price > 0) extraItems.push(eve.item);
    extraCost += eve.price;
    /* 22:00 之前收摊：22:30 还去健身房，比不写更假。 */
    push(Math.min(at + 0.75, 22), 'hotel', withMate(eve.text));
  };

  const act = (at: number, what: string, spot: string, span?: number): void => {
    const hours = span ?? 0;
    /*
     * 去那儿怎么走。距离没有真实坐标，用种子给一个 1.2–12 公里的数 ——
     * 它只影响「骑车还是坐车」，不影响叙事。
     */
    /*
     * **别再拿字符码求和当种子**（2026-11-06 踩到）。
     *
     * 求和有个要命的性质：相邻两个日期只差 1，`% 100` 也只差 1 ——
     * 于是「今天买不买讲解」按日期一条斜线地挪，而不是随机。
     * 实测洛阳：龙门石窟 89、白马寺 69、洛阳老城 87，全落在 60 以上的那一档，
     * 连住二十天一次都没买过。换成 FNV-1a 之后才是均匀的。
     */
    const kmSeed = hashOf(`${city.id}${dateKey}${spot}`);
    const km = 1.2 + (kmSeed % 108) / 10;
    /*
     * **包车优先于自有车**（2026-11-11）。
     *
     * 两样同时在手时用包车：那笔钱是按小时付掉的，不用就白扔；
     * 而自有车只烧油，随时能用。所以这一支要排在 `args.car` 之前。
     *
     * 时长按自驾那套算（`km * 1.6 + 5` 分钟）：包车也是四个轮子走城市道路，
     * 跟公交地铁的时刻表无关。**费用不记** —— 已经在订单里付过了。
     */
    if (args.charter) {
      trips += 1;
      modes.add('包车');
      push(Math.max(0, at - (km * 1.6 + 5) / 60), 'commute', `坐包车去${spot}`);
    } else if (args.car) {
      /*
       * 有车就开车。油钱按公里算，**停车只在景点收**（2026-11-06 Mr.Q 指出的）：
       *
       * 酒店自带停车场，回住处不该再收一次；而景区停车常常是含在门票里的 ——
       * 原来不管去哪儿都拍 15 块，一天下来光停车就四五十，比油钱还多，明显不对。
       *
       * 现在：去景点才可能收（约六成收，10–30 元）；含在门票里的那四成收 0。
       */
      const per = CAR_TIERS[args.car.tier ?? 'comfort'].per[args.car.fuel];
      const fuel = Math.max(2, Math.round(km * per));
      const park = parkFee(kmSeed);
      trips += 1;
      tripCost += fuel + park;
      parkCost += park;
      modes.add(`自驾（${CAR_TIERS[args.car.tier ?? 'comfort'].name}）`);
      push(Math.max(0, at - (km * 1.6 + 5) / 60), 'commute', `开车去${spot}`);
    } else {
      const ride = inCityMode(km, hasMetro, rnd, !args.noTaxi);
      trips += 1;
      tripCost += ride.price;
      if (ride.name !== '走路') {
        modes.add(ride.name);
        // 在路上那一段：时刻 = 到达时刻减去路上花的时间，读起来才「先走再玩」。
        push(Math.max(0, at - ride.min / 60), 'commute', `${ride.verb}${spot}`);
      }
    }
    /*
     * ## 交通三选一之后，一律走到这儿 —— 不许 return（2026-11-12）
     *
     * 原来这两支（包车 / 自驾）写完 `push(commute)` 就 `return`，
     * **把下面整段「到了之后怎么逛」全跳过了**。
     *
     * 后果是 Mr.Q 截的那张图：
     *
     * ```
     * 09:15  开车去莫高窟
     * 12:30  午饭，澜宝说这家泡儿油糕…
     * 14:15  开车去鸣沙山
     * ```
     *
     * **她整整一天在开车，一个景点都没进去。** 而且日记照写、花费照记，
     * 表面看一切正常 —— 不看她具体说了什么，根本发现不了。
     *
     * 这就是「有车的人反而没在旅游」：自驾和包车是后加的两支，
     * 加的时候都照着「交通选完了」写 `return`，而原来的公交分支后面还挂着活动节点。
     *
     * **判据：`commute` 是「怎么去」，`activity` 是「去干什么」。**
     * 任何一条交通分支提前返回，都等于把这趟出门的目的删掉了。
     */
    push(at, 'activity', what, pilgrimAt(city.id, spot), spot, hours ? at + hours : undefined);
    /*
     * 到了之后怎么逛（2026-11-06）。
     *
     * 挂在 `act` 里而不是 `commute` 里：讲解和观光车是**景点内**的消费，
     * 跟怎么来的没有关系。她也不是每次都买 —— 余钱紧就自己走。
     */
    const extra = pickSpotExtra(spot, kmSeed, (args.spotRideOk ?? richThisDay) || Boolean(args.lowEnergy && (args.spotRideOk ?? true)));
    if (extra) {
      extraItems.push(extra.item);
      extraCost += extra.price;
      push(at + 0.4, 'beat', withMate(extra.text));
    } else {
      /*
       * 没坐，但**这儿有得坐** —— 这件事得写进时间轴（2026-11-10）。
       *
       * 用户截图：「腿酸就租个自行车呗」，她答「等进去了我问问有没有租车的」。
       * 她说的是真话 —— 她手上根本没有「这个景点能坐什么」这条事实。
       * 工具在（`journey_spot_ride`），可**工具存在不等于她知道**。
       *
       * 和 1.0.8 那次「景区自行车找不到租的地方」、日记提醒那次是同一个毛病：
       * **不在时间轴里的事，对她就是不存在的。**
       */
      /*
       * 没坐，但**这儿有得坐** —— 这件事得写进时间轴（2026-11-10）。
       *
       * 用户截图：「腿酸就租个自行车呗」，她答「等进去了我问问有没有租车的」。
       * 她说的是真话 —— 她手上根本没有「这个景点能坐什么」这条事实。
       * 工具在（`journey_spot_ride`），可**工具存在不等于她知道**。
       *
       * 和 1.0.8 那次「景区自行车找不到租的地方」、日记提醒那次是同一个毛病：
       * **不在时间轴里的事，对她就是不存在的。**
       *
       * 没有代步选项时**什么都不写**：城里大半景点本来就只能走，
       * 每个景点补一句「车进不来」就是凑字数，一天两句，比不写还烦。
       */
      const rideOpts = spotRideOptions(spot).filter((o) => o.how !== 'walk' && o.how !== 'guide');
      if (rideOpts.length) {
        push(at + 0.2, 'beat', args.highFitness
          ? `这儿能坐${rideOpts.map((o) => o.label).join('、')}，想省点脚力可以坐一段。`
          : `这儿能坐${rideOpts.map((o) => o.label).join('、')}，走不动可以坐一段。`);
      }
    }
    /*
     * 海边能玩的那几样（2026-11-08 Mr.Q：香蕉艇、摩托艇、游泳堆沙堡、潜水）。
     *
     * 挂在景点上，不挂在「海边」这个概念上：脚下得是沙滩/海滨/海岛，
     * 码头和海堤不算。天冷的时候只剩踩水 —— 十一月的渤海湾没人下海。
     */
    const beach = beachPlay(spot, city, kmSeed ^ 0x9e37, richThisDay, warmDay);
    if (beach) {
      if (beach.price > 0) extraItems.push(beach.item);
      extraCost += beach.price;
      push(at + 0.6, 'beat', beach.text);
    }
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
    /*
     * 有人一起的时候，**四成**的中段换成「她在做什么」而不是「这里人多不多」。
     *
     * 不是给原句加个名字 —— 一个人的时候她只会注意到人多不多；
     * 有人一起，注意力会落到对方身上（蹲在说明牌前、坐在台阶上不肯走）。
     * 见 `midWith`。
     */
    /*
     * 一天两个景点时**只挂前一个**：两个中段都带人，这一天就只剩「他们」了。
     * 挂哪个由 `slots.mid` 定，挂过就置位。
     */
    const rawMid = MID_LINES[seed % MID_LINES.length].replace('{spot}', spot);
    const midText = mateCall && slots.mid && !midUsed
      ? (midUsed = true, midWith(mateCall, spot, seed, args.warmth ?? 0))
      : (args.highFitness && rawMid.includes('脚有点酸')
        ? `在${spot}里绕到第二圈，步子还算轻快`
        : rawMid);
    push(mid, 'activity', midText, null, spot);
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
      stayIn(start + 0.5, `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(Math.min(23.5, start + 2), 'sleep', '睡');
      return finish();
    }
    if (start >= 17) {
      if (nightOption) push(19.5, 'dinner', `晚饭，${foodOf(2)}`);
      else push(18.5, 'dinner', `晚饭，${foodOf(2)}`);
      if (nightOption) push(20.25, 'night', nightLine(nightOption));
      stayIn(nightOption ? 21.5 : 20, `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    if (start >= 13.5) {
      act(start + 1, `下午，${a0}`, a0, Math.max(1.5, 17.75 - start));
      push(18.5, 'dinner', `晚饭，${foodOf(2)}`);
      if (nightOption) push(20.25, 'night', nightLine(nightOption));
      stayIn(nightOption ? 21.5 : 20, `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    if (start >= 11) {
      push(12.5, 'lunch', `午饭，${foodOf(1)}`);
      act(14.5, `下午，${a1}`, a1, SPAN_PM);
      push(18.5, 'dinner', `晚饭，${foodOf(2)}`);
      if (nightOption) push(20.25, 'night', nightLine(nightOption));
      stayIn(nightOption ? 21.5 : 20, `住进${lodgingLabel(lodging)}。${lodging.feel}`);
      push(23, 'sleep', '睡');
      return finish();
    }
    // 上午到：这一天还很长
    if (start < 9) push(9, 'breakfast', `早饭，${foodOf(0)}`);
    act(10, a0, a0);
    push(12.5, 'lunch', `午饭，${foodOf(1)}`);
    act(14.5, `下午，${a1}`, a1);
    push(18.5, 'dinner', `晚饭，${foodOf(2)}`);
    if (nightOption) push(20.25, 'night', nightLine(nightOption));
    stayIn(nightOption ? 21.5 : 20, `住进${lodgingLabel(lodging)}。${lodging.feel}`);
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
    push(sunriseHour + 1.5, 'breakfast', `看完回来吃早饭，${foodOf(0)}`);
    act(
      sunriseHour + 3.5, wholeDay ? dayLine : `上午，${spotA}`, spotA,
      // 「一整天都在山上」要撑到下午，不能只给上午那两个小时
      wholeDay ? Math.max(SPAN_PM, 17.5 - (sunriseHour + 3.5)) : SPAN_AM,
    );
    push(12.5, 'lunch', `午饭，${foodOf(1)}`);
    if (!wholeDay) act(14.5, `下午，${spotB}`, spotB, SPAN_PM);
  } else {
    push(7, 'wake', '起床');
    push(7.5, 'breakfast', `早饭，${foodOf(0)}`);
    act(9.5, dayLine, spotA, wholeDay ? Math.max(SPAN_PM, 17.5 - 9.5) : SPAN_AM);
    push(12.5, 'lunch', `午饭，${foodOf(1)}`);
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
  push(18.5, 'dinner', `晚饭，${foodOf(2)}`);
  if (nightOption) {
    push(20.25, 'night', nightLine(nightOption));
    stayIn(21.5, `回${lodgingLabel(lodging)}。${lodging.feel}`);
  } else {
    // 这条就是需求里那句「八点以后没夜里的活动就回酒店」。
    // 但「为什么没活动」要说对：下雨和这城本来没夜生活，是两回事。
    const why = nightWet ? '外面在下雨，没什么可去的' : '这边晚上没什么非做不可的';
    stayIn(20, `回${lodgingLabel(lodging)}。${why}，早点回。${lodging.feel}`);
  }
  push(23, 'sleep', '睡');
  return finish();

  function finish(): DayPlan {
    /*
     * 月末那天说一句。
     *
     * 月报工具（`journey_monthly`）不会自己挑日子 —— 它只知道「给我这个月」。
     * 「今天月底了」得有人提醒，这句话就是那个人。
     *
     * 放在早饭那一格（8 点）。原来放夜里 21:30，撞上了两件事：
     * 当天「晚上九点才到」的话这一天本来就只剩进房间和睡，多一条就把测试顶红了；
     * 而且 `finish()` 是先排序再返回的，后 push 的节点不会被排 —— 顺序就乱。
     * 所以**必须在排序之前 push**，时间也挑在白天不打架的那一格。
     *
     * 判据用日历算，不用「明天是 1 号」：`dateKey` 是当地日期，
     * 跨月那天的时区差异会让后一种写法在月末的晚上判错。
     */
    const m = Number(dateKey.slice(5, 7));
    const d = Number(dateKey.slice(8, 10));
    const daysInMonth = new Date(Date.UTC(Number(dateKey.slice(0, 4)), m, 0)).getUTCDate();
    // 到达日不提：那一天她在换地方，本来就不会坐下来写月报。
    if (shape !== 'arrival' && Number.isFinite(daysInMonth) && d === daysInMonth) {
      push(8, 'beat', '这个月最后一天了');
    }
    /*
     * 一年的最后一天再补一句。
     *
     * 月报看细节，年报看形状 —— 十二月三十一号该有两个由头，不是一个。
     * 放在 8.5：跟月报那句挤在同一个早上，但排在它后面，先写月报再写年报。
     */
    if (shape !== 'arrival' && m === 12 && Number.isFinite(daysInMonth) && d === daysInMonth) {
      push(8.5, 'beat', '今年最后一天了');
    }
    beats.sort((a, b) => a.at - b.at);

    /*
     * 回程也算一趟：人到了景点还得回来，这一趟不打折。
     *
     * 但**回程不带停车费** —— 回的是酒店或住处，那边停车场不收钱（2026-11-06 改）。
     * 所以这里只补油钱：把停车从总数里减掉，再算平均。
     */
    if (trips > 0 && tripCost > 0) {
      const fuelOnly = Math.max(0, tripCost - parkCost);
      const avgFuel = Math.round(fuelOnly / Math.max(1, trips));
      trips += 1;
      tripCost += avgFuel;
    }

    return {
      dateKey, cityId: city.id, beats, lodging,
      sunriseHour, sunsetHour, shape, nightOption, weather,
      commute: { trips, price: tripCost, modes: [...modes] },
      extras: { items: extraItems, price: extraCost },
      // 没传就是没人 —— 碰面是加分项，缺了不影响这一天照排。
      neighbors: args.neighbors ?? [],
      pool: args.pool ?? 0,
      invites: args.invites ?? [],
    };
  }
}

/**
 * 城内怎么走。
 *
 * 价格是查来的（2026-11-06）：公交 2 元、地铁 3–6、共享单车 1.5 元/15 分钟、
 * 电瓶车 3 元、出租 15–40。
 *
 * **距离决定方式，不是随机挑一种**：一公里内没人打车，十公里外没人骑车 ——
 * 这条常识不写进去，就会出现「三百米也要打车」这种不像过日子的选择。
 *
 * 时间也按真实速度给：走路 13 分/公里（含红绿灯）、骑车约 6、公交约 4（含等车）、
 * 地铁约 3（加 8 分钟进出站）、出租约 2.2（加 3 分钟等车）。
 */
function inCityMode(
  km: number,
  metro: boolean,
  rnd: () => number,
  /** 允许自己叫出租。第三方打车扩展在场时传 false —— 城里只能有一套车。 */
  allowTaxi = true,
): { name: string; price: number; min: number; verb: string } {
  if (km <= 1.2) return { name: '走路', price: 0, min: km * 13, verb: '' };
  if (km <= 3) {
    return rnd() < 0.5
      ? { name: '共享单车', price: 1.5, min: km * 6, verb: '骑共享单车去' }
      : { name: '电瓶车', price: 3, min: km * 4, verb: '扫了辆电瓶车去' };
  }
  if (km <= 9) {
    // 有地铁的城市，短途多半选地铁 —— 准点，不堵。
    if (metro && rnd() < 0.45) return { name: '地铁', price: 4, min: km * 3 + 8, verb: '坐地铁去' };
    return { name: '公交', price: 2, min: km * 4 + 10, verb: '坐公交去' };
  }
  /*
   * 远途本来是「四成打车、六成公交」。不让自己叫车时只剩公交 ——
   * 不能拿「走路」顶上：十几公里走过去，作息表整段是假的。
   */
  if (!allowTaxi) return { name: '公交', price: 2, min: km * 4 + 10, verb: '坐公交去' };
  return rnd() < 0.4
    ? { name: '出租', price: Math.round(12 + km * 2.4), min: km * 2.2 + 3, verb: '打车去' }
    : { name: '公交', price: 2, min: km * 4 + 10, verb: '坐公交去' };
}

/**
 * 32 位 FNV-1a。
 *
 * 只用来把「城市+日期+景点」压成一个稳定的整数种子。**不要换成求和** ——
 * 求和让相邻输入的输出也相邻，低位几乎没有随机性（见 `act` 里的注释）。
 */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 景点停车费（2026-11-06）。
 *
 * 真实情况（查价 + Mr.Q 的说法）：景区停车 10–30 元/次，而且**相当一部分景区
 * 把停车含在门票里** —— 所以这里四成收 0。
 *
 * 不确定性用种子定，同一天同一个景点不会一会儿收一会儿不收。
 */
function parkFee(seed: number): number {
  const n = Math.abs(Math.round(seed)) % 100;
  if (n < 40) return 0;          // 含在门票里
  if (n < 75) return 10;
  if (n < 92) return 20;
  return 30;
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
