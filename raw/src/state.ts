/**
 * 行程状态 —— **只在本机**，永远不进同步盘。
 *
 * ## 为什么必须分开存
 *
 * 状态回答的是「她现在在哪」。两台机器共写这一份，后果不是报错，是**幻觉**：
 * 回家打开电脑，看到的是公司那台三天前的位置，还在把真正的位置盖掉。
 * 音乐扩展那边踩过同一个坑（两条机器共写「她以为你在听什么」），结论一样：
 *
 *   日记（发生过的事）→ 可以跟着人走
 *   行程（现在怎么样）→ 只在本机
 *
 * ## 写入一律原子
 *
 * 先写 `.tmp` 再 rename。断电或强杀落在中间时，读者看到的要么是旧文件、要么是新文件，
 * 不会看到半个 JSON。半截 JSON 的后果不是「丢了今天」，是**她突然不知道自己在哪**，
 * 然后从家里重新出发。
 */
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Journey } from './plan/journey.ts';
import { cityById } from './geo/cities.ts';
// 伙伴记忆跟着人走，和「去过 / 想去 / 花销」同一份文件。
import {
  normalizePets, normalizeTaste, emptyTaste,
  type PetsMap, type TasteMap,
} from './travel-memory.ts';

export type Phase = 'home' | 'traveling' | 'staying';

/**
 * 世界时钟基准。
 *
 * ## 为什么需要它
 *
 * 第一版把倍速只用在「路程时长」上（`到达 = 出发 + 时长/倍速`），于是 24x 下
 * 她坐车十七分钟就到了，然后在目的地按**真实时间**待两三天 —— 那个「加速」是假的，
 * 只让车跑得快而已。真正要压的是整个世界的时间流。
 *
 * 做法：世界时刻 = 基准世界时刻 + (真实时刻 - 基准真实时刻) × 倍速。
 * 所有旅行相关的计算（当地几点、是否到站、待了几天）全部用世界时刻，
 * 真实时刻只用于事件时间戳和日志。
 *
 * 改倍速时重设基准，且**保持世界时间连续** —— 否则 1x 切 24x 会让她瞬间跳过两周。
 */
export interface ClockBase {
  readonly realEpoch: string;
  readonly worldEpoch: string;
  readonly speed: number;
}

/**
 * 正在打的那份短工。
 *
 * 只在「记账开着 + 填了预算 + 钱快到见底」时才会出现。
 *
 * 为什么要这个东西：预算原来是**软约束** —— 它只影响住哪家、坐什么车，
 * 不影响总量。2026-11-02 用模拟跑 144 个世界天，预算 3000 花掉 16.9 万，
 * 因为她照样一趟趟坐跨洲航班。钱见底之后真实的背包客不会继续飞，
 * 会先省（住便宜、坐硬座），再停下干几天活，攒够了接着走。
 */
export interface WorkStay {
  /** 在哪儿干。**不跟着走** —— 换城市就没有「打零工」这回事了。 */
  readonly cityId: string;
  /** 开工那天（当地日期）。面板上「第几天」靠它算。 */
  readonly startedOn: string;
  /** 干到这个**世界时刻**（ISO）收工。到点自动结束，不需要再看钱。 */
  readonly until: string;
  /** 日薪（元）。跨天结算，直接从 spent 里扣。 */
  readonly pay: number;
  /** 干的什么活。开工那天定下，之后不再变 —— 不然每天换个说法就成了样板戏。 */
  readonly gig: string;
}

/**
 * 这一趟是怎么结束的。详见 `TripState.homeReason`。
 *
 * 单独提成类型，是因为它要被三处读到：事件正文、`journey_now`、以及
 * 「回家后马上又出门」那条判断 —— 各写各的字符串迟早会漂。
 */
export type HomeReason = 'done' | 'limit' | 'broke' | 'called';

const HOME_REASONS: readonly string[] = ['done', 'limit', 'broke', 'called'];

/** 存盘里读回来的原因要验一遍：认不出的就当没有，别让一个坏值一路传到日记里。 */
export const isHomeReason = (x: unknown): x is HomeReason =>
  typeof x === 'string' && HOME_REASONS.includes(x);

/**
 * 答应了谁的邀约 —— **这是一份承诺，不是一条消息**。
 *
 * ## 为什么要落盘
 *
 * 邀约这件事的语义是「我明天跟你一起去拉萨，在那儿待三天」。它不是一次对话，
 * 而是一个要持续好几天、跨好几个巡检、还可能跨一次重启的**安排**。
 * 只放在内存里，重启之后她照样自己挑目的地，「答应」这件事就凭空消失了 ——
 * 而用户那边记得清清楚楚。
 *
 * 和 `wishes` 的区别：`wishes` 是「我想去」，这个是「我说好了要去」。
 * 前者可以一直不兑现，后者有期限、有天数、有对象。
 *
 * ## 三个时刻
 *
 * ```
 * acceptedAt   接下来（本地时刻，世界时间轴）
 * arrivedAt    到那儿了 —— 从这一刻起算「待几天」
 * （没有字段） 天数待满就走，算的时候现算
 * ```
 *
 * `days` 从**到达**起算而不是从接下起算：接完可能还要坐两天车，
 * 那两天不该算进「一起待的三天」里。
 */
export interface Pledge {
  /** 要去的那座城。 */
  readonly cityId: string;
  /** 在那儿待几天。 */
  readonly days: number;
  /** 谁邀的。**只有名字** —— 服务端也没给更多。 */
  readonly withPet: string;
  /**
   * 一起走的所有人（含上面那个）。
   *
   * 2026-11-05 之前一条邀约只能成一对，所以只存一个名字就够。现在一条邀约可以让
   * 最多三只鱼接（`MAX_PARTY - 1`），于是这里是一个列表。
   *
   * **老数据没有这一段** —— 读的时候当「只有 `withPet` 一个人」，不要拿空数组去覆盖。
   */
  readonly withPets?: readonly string[];
  /** 那条邀约的编号。留在本地只是为了排查，不再回传。 */
  readonly inviteId: string;
  /** 接下这条的时刻（世界时刻 ISO）。过了期限还没到，就当没这回事。 */
  readonly acceptedAt: string;
  /** 到那儿的时刻（世界时刻 ISO）。`null` = 还在路上或还没动身。 */
  readonly arrivedAt: string | null;
}

/**
 * 她问出口、但还没等到回答的一件事。
 *
 * ## 为什么要有这个
 *
 * 开了「出门等点头」（`askBeforeDepart`）之后，原来 `tick()` 里只有一句
 * `if (askBeforeDepart) return` —— 她**一次都不会自己走**，而且什么都不说。
 * 用户看到的是「这条鱼在家躺了半个月」。开关的本意是「先问我」，不是「永远不走」，
 * 而「问」这个动作在原来的代码里根本不存在。
 *
 * ## 为什么要落盘
 *
 * 问出去之后可能隔一整夜才被看见。只放内存，宿主一重启这张单子就没了 ——
 * 她会重新问一遍，或者干脆不问。两种都像坏了。
 */
export interface Ask {
  /** `depart` = 自己想出门；`accept` = 想接别人的邀约。 */
  readonly kind: 'depart' | 'accept';
  /** 想去的那座城。 */
  readonly cityId: string;
  /** 待几天（只有 `accept` 有）。 */
  readonly days: number | null;
  /** 邀约编号（只有 `accept` 有，留着排查，不回传）。 */
  readonly inviteId: string | null;
  /** 对方的名字（只有 `accept` 有）。 */
  readonly withPet: string | null;
  /** 对方留的那句话（只有 `accept` 有）。 */
  readonly note: string | null;
  /** 问出去的时刻（世界时刻 ISO）。 */
  readonly askedAt: string;
}

export interface TripState {
  readonly version: 1;
  /** 世界时钟基准。`null` = 还没建立，第一次巡检时建立。 */
  clock: ClockBase | null;
  /** 现在处在这一趟的哪一段。 */
  phase: Phase;
  /** 此刻所在的城市 id。`traveling` 时指的是**出发地**，真正的目的地看 `leg.toId`。 */
  hereId: string;
  /** 家。出发地永远是它，除非用户改了配置。 */
  homeId: string;
  /**
   * **这一趟**是从哪个家出发的。
   *
   * 和 `homeId` 分开，是因为用户可以在旅途中改家：家搬到石家庄了，但这一趟是
   * 从兰州出发的 —— 面板上「兰州 · 家石家庄 · 兰州→天水」如果不点破，
   * 读起来就是三个互相打架的地名。
   *
   * 在家时清空（这一趟还没开始）；出发时写入当时的家。
   */
  tripHomeId: string | null;
  /** 正在走的一段。`phase==='traveling'` 时非空。 */
  leg: Journey | null;
  /** 这一趟什么时候开始的（ISO）。`staying` 和 `traveling` 都有。 */
  tripStartedAt: string | null;
  /**
   * 到达**当前这个城市**的时刻（ISO）。
   *
   * 单独存它，是因为「在这儿待了几天」不能从 `tripStartedAt` 推 ——
   * 这一趟已经走了三个月、刚到新城市第二天，两个数一减会得出「待了九十天」。
   */
  stayStartedAt: string | null;
  /** 这一趟已经去过的城市 id，用来给「来时路过」「又来了」这类判断。 */
  tripVisited: readonly string[];
  /** 历史上待过的所有城市，只增不减。挑目的地时的「没去过优先」靠它。 */
  everVisited: readonly string[];
  /**
   * 去过、但**没逛完**的城市。
   *
   * 2026-11-05 Mr.Q：「这次逛过一个地点之后，如果没逛完所有景点她也许还想来」。
   * 判据是待的天数够不够把点名的景点走完（一天两格，见 `dayplan.ts` 的 `seq`）。
   * 逛完了就摘掉 —— 否则「没逛完」会永久贴着，她一辈子都在往回跑。
   */
  unfinished: readonly string[];
  /**
   * 想去的地方（因为某首歌、某个念头）。挑目的地时权重更高。
   *
   * 和 `everVisited` 是两回事：那个是「去过」，这个是「想去」。
   * 去过之后从这儿删掉 —— 想头了就兑现了。
   */
  wishes: readonly string[];
  /**
   * 接下的那份邀约。`null` = 没有约定。
   *
   * 见 `Pledge` 的注释：它是「说好了要去」，和「想去」不是一回事。
   */
  pledge: Pledge | null;
  /**
   * 累计花销（元）。记账关着时永远是 0。
   *
   * **不因打工而减少。** 2026-11-02 跑模拟发现：原来挣的钱直接从这里扣，
   * 预算 500 跑 48 天，最后显示「花销 0」—— 她明明住了几十晚、吃了上百顿，
   * 账面上却一分没花。那个数字是失真的。
   */
  spent: number;
  /** 打工挣的（元）。和花销分开记，判断钱够不够时用 `spent - earned`。 */
  earned: number;
  /**
   * 一起走过的人：次数、上次什么时候、她怎么看这个人。
   *
   * 跟人走（进 `travel-memory.json`），不是位置那类东西。key 是名字 ——
   * 他改了名就是两条记录，这是已知代价，见 `PetMemory`。
   */
  pets: PetsMap;
  /**
   * 口味：喜欢 / 不喜欢的地方、吃食、景色。
   *
   * 跟人走（进 `travel-memory.json`）。**不进 `state.json` 的快照对比** ——
   * 它和「去过 / 想去」一样属于记忆，不属于位置。
   */
  taste: TasteMap;
  /**
   * 正在打的短工。`null` = 没在打工。
   *
   * 只在本机有意义：它跟「现在在哪」是一类东西（位置），不是「去过哪」那类记忆。
   * 所以不进 `travel-memory.json`。
   */
  work: WorkStay | null;
  /**
   * 这一趟已经打过几次短工。回家清零。
   *
   * 2026-11-02 模拟跑出来的：144 个世界天打了 17 次工 —— 因为她永远不回家，
   * 钱花完就再打一份。那不叫旅行，叫在外地常年打工。
   * 给个上限：同一趟打到第 N 次还是见底，就该收摊回家了。
   */
  workStints: number;
  /** 回家后要休息到什么时候（ISO）。`home` 且未到点 = 正在休息。 */
  restingUntil: string | null;
  /**
   * 这一趟到家的时刻（世界时刻 ISO）。`null` = 老状态没记过，或者她没在家。
   *
   * ## 为什么要它
   *
   * 2026-11-06 的一份 bug 报告：`restingUntil` 是**到家那一瞬按当时的 `restDays`
   * 算好、盖死**的，之后把「在家歇几天」改成 0 也不重算 —— 用户只能干等到那个日期，
   * 连面板上「让她出发」都点不动，因为 `stillResting()` 拿的是那个旧戳。
   *
   * 现在休息期是**派生值**：`homeAt + 当前 cfg.restDays`。实时算，
   * 配置一改就生效，不需要「配置变更回调」那种容易漏的联动。
   * `restingUntil` 保留下来只作两件事：老状态的兜底、以及面板/文案的原始记录。
   */
  homeAt: string | null;
  /**
   * 她问出口、还等他点头的那一件事。`null` = 没有待批的事。
   *
   * 只有开了 `askBeforeDepart` 才会有值 —— 开关关着时她自己走，不需要问。
   */
  ask: Ask | null;
  /**
   * 上一回「他答了不好」的时刻（世界时刻 ISO）。
   *
   * 冷却用。没有它的话，一次回绝之后下一轮巡检（几十秒后）会再问一遍，
   * 而且问的还是同一座城 —— 那不叫征求意见，叫骚扰。
   */
  askNoAt: string | null;
  /**
   * 最后一条已经推过的作息节点，格式 `<dateKey>|<kind>|<at>`。
   *
   * 这个字段是**去重的唯一依据**：重启后不能把同一个「早饭」再推一遍。
   * 只放内存就是每次重启都重放一遍昨天。
   */
  lastBeatKey: string | null;
  /**
   * 上一段的行进方向（度，0 = 正北）。
   *
   * 没有它，选目的地就是纯随机游走 —— 2026-10-31 实测走出过
   * 九寨沟 → 南宁 → 银川 这种 Z 字路线，每一段单独看都「合理」（都在中档距离），
   * 连起来是个折返跑。真人旅行有惯性：既然往南走了，就再往南走几个地方。
   *
   * 回家时清空（新的一趟重新定方向），离家第一段不约束。
   */
  heading: number | null;
  /** 上一段走了多少公里。让「长途之后走短途」，而不是连着横穿。 */
  lastKm: number;
  /**
   * 正在回家的路上。
   *
   * 回家**不是一步传送**。决定回去之后，她会一站一站往家走，
   * 途中每站都算真的到过（有路上事件、有日记、有花费）。
   * 2026-10-31 之前 `hereId` 是直接改成家的，中间不经过任何城市 ——
   * 所以「南宁 → 银川」看着像回程，其实银川是随机挑的另一个目的地。
   */
  returning: boolean;
  /**
   * 这一趟是怎么收的。`null` = 还在路上，或者还没出过门。
   *
   * 2026-11-04 加的，起因是群里一条反馈：「『回家』和『被上限撵回家』得分得清，
   * 不然写日记的时候情绪是错的」。
   *
   * 原来两条路只在**事件正文**里差一句话（`forced ? '出门到上限了' : '这一趟到头了'`），
   * 而那句话只活在推送的那一刻。她晚上写日记时读不到它，`journey_now` 也不提 ——
   * 四种完全不同的收场就被写成了同一种情绪。
   *
   * 实际有四种，比反馈里说的还多两种：
   * - `done`   自己待够了 —— 满足，可以有点舍不得
   * - `limit`  出门到上限 —— 被掐断，不是她选的
   * - `broke`  打了太多次工钱还是不够 —— 比上限更狼狈，是撑不下去
   * - `called` 他叫她回来 —— 听他的话，不是她自己的决定
   */
  homeReason: HomeReason | null;
  /**
   * 正在回家的路上时，记着「为什么回」。
   *
   * 回家要走好几天，走到家那一天 `goHome` 才真正调用 —— 那时候手上已经没有
   * 「当初为什么决定回」这个信息了。不留这一笔，回程走完一律算成「待够了」，
   * 而他按着按钮叫回来的那趟会被写成「我自己想回来了」。**比没写更糟**。
   */
  returnReason: HomeReason | null;
  /**
   * 这一趟路上已经推过的节点（形如 `<legId>|0`、`<legId>|1`）。
   *
   * 单独存，不能借用 `lastBeatKey` —— 那个是单个值，路上节点和当地作息节点会互相覆盖，
   * 结果是「服务区」被推两遍或者「午饭」被吞掉。出发时清空。
   */
  roadMarks: readonly string[];
  /** 正在待的那一天（当地日期键）。跨天时要重排作息表。 */
  stayDateKey: string | null;
  /**
   * 「今天走不走」这件事在哪一天已经决定过了（当地日期键）。
   *
   * 决策点必须放在早上 —— 第一版挂在跨天那一刻，结果是**她总在凌晨零点收拾行李出发**。
   * 真人不会这么干，而且那个点他多半已经睡了，醒来看到一条半夜的「我上路了」很怪。
   */
  decidedOn: string | null;
  /**
   * 已经**提醒过她**的邀约 id（每条只提醒一次，最多留 50 条）。
   *
   * 2026-11-06 加的。原来她只在排表那一刻（每天第一次醒来 / 刚到一座城）才看到邀约列表，
   * 别人中午发的，她可能等到第二天早上才发现 —— 而邀约 24 小时就过期。
   */
  inviteSeen: readonly string[];
  /**
   * 今天推过几条邀约提醒。
   *
   * 推一条事件 = 她会开口说一句 = **一次模型调用**。所以要封顶（`INVITE_NOTICE_PER_DAY`），
   * 不能「有新的就推」。这个字段就是那个计数器。
   */
  inviteNotice: { day: string; n: number } | null;
}

export function initialState(homeId: string): TripState {
  return {
    version: 1,
    clock: null,
    phase: 'home',
    hereId: homeId,
    homeId,
    tripHomeId: null,
    leg: null,
    tripStartedAt: null,
    stayStartedAt: null,
    tripVisited: [],
    everVisited: [],
    unfinished: [],
    restingUntil: null,
    // 老状态里没有这一格：没有就退回 `restingUntil` 那条盖章的记录（见 `stillResting`）。
    homeAt: null,
    // 老状态里没有这两个字段，读不到就是「没有待批的事、也没被回绝过」。
    ask: null,
    askNoAt: null,
    wishes: [],
    pledge: null,
    spent: 0,
    earned: 0,
    pets: {},
    taste: emptyTaste(),
    work: null,
    workStints: 0,
    heading: null,
    lastKm: 0,
    returning: false,
    homeReason: null,
    returnReason: null,
    lastBeatKey: null,
    roadMarks: [],
    stayDateKey: null,
    decidedOn: null,
    car: null,
    inviteSeen: [],
    inviteNotice: null,
  };
}

export class StateStore {
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, 'state.json');
  }

  /**
   * 读。文件不在、读坏了、版本不对、字段荒谬 —— 一律回到初始状态**并且说出来**。
   *
   * 这里最要紧的是最后一条：**不认识的字段当没看见，但认识而荒谬的值必须拒绝**。
   * 一个 `hereId` 指到不存在的城市，会让她整天说「我在 undefined」。
   */
  load(homeId: string): { state: TripState; problem: string | null } {
    const base = initialState(homeId);
    // 传入的出发地本身不认识就没法工作了。这里必须**喊出来**：
    // 上一个版本因为收下了 undefined，一路静默到 start() 末尾才炸，
    // 报错位置离真正的原因隔了四十行。
    if (!cityById(homeId)) {
      return { state: base, problem: `出发地「${String(homeId)}」认不出来，行程按空白开始。` };
    }
    if (!existsSync(this.file)) return { state: base, problem: null };
    let raw: unknown;
    try {
      // 必须去 BOM：用户拿记事本 / PowerShell 的 `Set-Content -Encoding utf8` 存过一遍，
      // 文件头就会多个 U+FEFF，而 JSON.parse 直接抛错。
      // 2026-10-31 实测踩到：我自己写的重置脚本就带了 BOM，日志里变成
      // 「行程状态文件读不出来」—— 用户手动改一下也会这样，行程当场清零。
      const text = readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
      raw = JSON.parse(text);
    } catch {
      return { state: base, problem: '行程状态文件读不出来，已从家里重新开始。' };
    }
    if (!raw || typeof raw !== 'object') {
      return { state: base, problem: '行程状态文件不是对象，已重新开始。' };
    }
    const r = raw as Record<string, unknown>;
    if (r.version !== 1) {
      return { state: base, problem: `行程状态版本不认识（${String(r.version)}），已重新开始。` };
    }

    const here = typeof r.hereId === 'string' ? cityById(r.hereId) : null;
    if (!here) {
      return { state: base, problem: '行程状态里的城市认不出来了，已从家里重新开始。' };
    }
    const home = typeof r.homeId === 'string' && cityById(r.homeId) ? r.homeId : homeId;

    const phase: Phase =
      r.phase === 'traveling' || r.phase === 'staying' ? r.phase : 'home';

    // 在路上的那一段必须自洽：城市认得出、时间能解析、到达晚于出发。
    // 不自洽就当没在走 —— 停在半路的行程比没有行程更难解释。
    let leg: Journey | null = null;
    if (phase === 'traveling' && r.leg && typeof r.leg === 'object') {
      const L = r.leg as Record<string, unknown>;
      const ok =
        typeof L.fromId === 'string' && cityById(L.fromId)
        && typeof L.toId === 'string' && cityById(L.toId)
        && typeof L.departedAt === 'string' && Number.isFinite(Date.parse(L.departedAt))
        && typeof L.arriveAt === 'string' && Date.parse(L.arriveAt) > Date.parse(L.departedAt);
      if (ok) leg = L as unknown as Journey;
    }

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!cityById(x)) : [];

    const state: TripState = {
      version: 1,
      clock: parseClock(r.clock),
      phase: leg ? 'traveling' : phase === 'traveling' ? 'home' : phase,
      hereId: here.id,
      homeId: home,
      // 老状态里没有这个字段：那就当这一趟从当前的家出发。
      tripHomeId: typeof r.tripHomeId === 'string' && cityById(r.tripHomeId) ? r.tripHomeId : null,
      leg,
      tripStartedAt: isoOrNull(r.tripStartedAt),
      stayStartedAt: isoOrNull(r.stayStartedAt),
      tripVisited: arr(r.tripVisited),
      everVisited: arr(r.everVisited),
      unfinished: arr(r.unfinished),
      // 老状态里没有这一段：`normalizePets` 收到 undefined 就返回空表。
      pets: normalizePets(r.pets),
      // 老状态里没有这一段：`normalizeTaste` 收到 undefined 返回空表。
      taste: normalizeTaste((r as Record<string, unknown>).taste),
      restingUntil: isoOrNull(r.restingUntil),
      homeAt: isoOrNull(r.homeAt),
      /*
       * 待批的那件事。老状态里没有 —— 读不到就是没有，不是坏了。
       * 逐字段验，理由和 `pledge` 一样：一座认不出来的城会让面板上那句
       * 「想去 X」变成「想去 undefined」，而按钮还是能点。
       */
      ask: (() => {
        const a = r.ask;
        if (!a || typeof a !== 'object') return null;
        const o = a as Record<string, unknown>;
        if (o.kind !== 'depart' && o.kind !== 'accept') return null;
        if (typeof o.cityId !== 'string' || !cityById(o.cityId)) return null;
        if (typeof o.askedAt !== 'string' || !Number.isFinite(Date.parse(o.askedAt))) return null;
        return {
          kind: o.kind,
          cityId: o.cityId,
          days: Number.isFinite(Number(o.days)) ? Math.min(14, Math.max(1, Math.round(Number(o.days)))) : null,
          inviteId: typeof o.inviteId === 'string' ? o.inviteId.slice(0, 64) : null,
          withPet: typeof o.withPet === 'string' ? o.withPet.slice(0, 24) : null,
          note: typeof o.note === 'string' ? o.note.slice(0, 60) : null,
          askedAt: o.askedAt,
        };
      })(),
      askNoAt: isoOrNull(r.askNoAt),
      wishes: Array.isArray(r.wishes)
        ? (r.wishes as unknown[]).filter((x): x is string => typeof x === 'string' && !!cityById(x))
        : [],
      /*
       * 承诺。老状态里没有这个字段 —— 读不到就是「没有约定」，不是坏了。
       * 逐字段验而不是整个信：一个 `cityId` 认不出来的承诺，会让她天天
       * 朝一座不存在的城市走（`moveOn` 里强制目的地那条分支），而且不报错。
       */
      pledge: (() => {
        const p = r.pledge;
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        if (typeof o.cityId !== 'string' || !cityById(o.cityId)) return null;
        if (typeof o.acceptedAt !== 'string' || !Number.isFinite(Date.parse(o.acceptedAt))) return null;
        const arrived = typeof o.arrivedAt === 'string' && Number.isFinite(Date.parse(o.arrivedAt))
          ? o.arrivedAt
          : null;
        return {
          cityId: o.cityId,
          days: Number.isFinite(Number(o.days)) ? Math.min(30, Math.max(1, Math.round(Number(o.days)))) : 1,
          withPet: typeof o.withPet === 'string' ? o.withPet.slice(0, 24) : '一只鱼',
          // 没有就是老数据：undefined，由 `whoOf` 退回单人口径。
          withPets: Array.isArray(o.withPets)
            ? o.withPets.filter((x): x is string => typeof x === 'string' && !!x)
                .slice(0, 3).map((x) => x.slice(0, 24))
            : undefined,
          inviteId: typeof o.inviteId === 'string' ? o.inviteId.slice(0, 32) : '',
          acceptedAt: o.acceptedAt,
          arrivedAt: arrived,
        };
      })(),
      spent: Number.isFinite(Number(r.spent)) && Number(r.spent) >= 0 ? Math.round(Number(r.spent)) : 0,
      earned: Number.isFinite(Number(r.earned)) && Number(r.earned) >= 0
        ? Math.round(Number(r.earned))
        : 0,
      /*
       * 短工。老状态里没有这个字段 —— 读不到就 null，不是「坏了」。
       * 逐字段校验而不是整个信：一个 until 写坏了的 work，会让她永远在打工、永远不完工。
       */
      work: (() => {
        const w = r.work;
        if (!w || typeof w !== 'object') return null;
        const o = w as Record<string, unknown>;
        if (typeof o.cityId !== 'string' || !cityById(o.cityId)) return null;
        if (typeof o.until !== 'string' || !Number.isFinite(Date.parse(o.until))) return null;
        if (!Number.isFinite(Number(o.pay))) return null;
        return {
          cityId: o.cityId,
          startedOn: typeof o.startedOn === 'string' ? o.startedOn : '',
          until: o.until,
          pay: Math.max(0, Math.round(Number(o.pay))),
          gig: typeof o.gig === 'string' && o.gig ? o.gig : '短工',
        };
      })(),
      workStints: Number.isFinite(Number(r.workStints)) && Number(r.workStints) > 0
        ? Math.round(Number(r.workStints))
        : 0,      // **必须判类型，不能只判 Number.isFinite(Number(x))** ——
      // `Number(null)` 是 0、`Number('')` 也是 0，于是「没有方向」被读成「正北」，
      // 她从家出发第一段就只能往北挑。这个坑 2026-10-31 在真机上一次就撞上了：
      // state.json 里 heading 是 null，读出来变成了 0。
      heading: typeof r.heading === 'number' && Number.isFinite(r.heading) ? r.heading : null,
      lastKm: Number.isFinite(Number(r.lastKm)) && Number(r.lastKm) >= 0 ? Number(r.lastKm) : 0,
      returning: r.returning === true,
      // 老状态里没有这两个字段 —— 读不到就是「不知道」，不是「待够了」。
      homeReason: isHomeReason(r.homeReason) ? r.homeReason : null,
      returnReason: isHomeReason(r.returnReason) ? r.returnReason : null,
      lastBeatKey: typeof r.lastBeatKey === 'string' ? r.lastBeatKey : null,
      roadMarks: Array.isArray(r.roadMarks)
        ? (r.roadMarks as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      stayDateKey: typeof r.stayDateKey === 'string' ? r.stayDateKey : null,
      decidedOn: typeof r.decidedOn === 'string' ? r.decidedOn : null,
      // 老状态里没有这一格：当她手上没车。
      car: (() => {
        const v = r.car;
        if (!v || typeof v !== 'object') return null;
        const o = v as Record<string, unknown>;
        const fuel = o.fuel === 'ev' ? 'ev' : o.fuel === 'oil' ? 'oil' : null;
        if (!fuel) return null;
        return {
          fuel,
          days: Math.max(0, Math.round(Number(o.days) || 0)),
          km: Math.max(0, Math.round(Number(o.km) || 0)),
        };
      })(),
      // 老状态里没有这两格：当她还没被提醒过任何邀约。
      inviteSeen: Array.isArray(r.inviteSeen)
        ? r.inviteSeen.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 50)
        : [],
      inviteNotice: (() => {
        const v = r.inviteNotice;
        if (!v || typeof v !== 'object') return null;
        const o = v as Record<string, unknown>;
        const n = Number(o.n);
        return typeof o.day === 'string' && Number.isFinite(n) ? { day: o.day, n } : null;
      })(),
    };
    const problem = phase === 'traveling' && !leg
      ? '上次的行程数据不完整，已停在原地重新安排。'
      : null;
    return { state, problem };
  }

  save(state: TripState): string | null {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      renameSync(tmp, this.file);
      return null;
    } catch (e) {
      return `行程状态写不进去：${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

/** 时钟基准的合理性校验：三个字段都在、倍速为正、两个时刻能解析。 */
function parseClock(v: unknown): ClockBase | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.realEpoch !== 'string' || !Number.isFinite(Date.parse(c.realEpoch))) return null;
  if (typeof c.worldEpoch !== 'string' || !Number.isFinite(Date.parse(c.worldEpoch))) return null;
  const speed = Number(c.speed);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 10_000) return null;
  return { realEpoch: c.realEpoch, worldEpoch: c.worldEpoch, speed };
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v : null;
}
