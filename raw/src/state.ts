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
   * 想去的地方（因为某首歌、某个念头）。挑目的地时权重更高。
   *
   * 和 `everVisited` 是两回事：那个是「去过」，这个是「想去」。
   * 去过之后从这儿删掉 —— 想头了就兑现了。
   */
  wishes: readonly string[];
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
    restingUntil: null,
    wishes: [],
    spent: 0,
    earned: 0,
    work: null,
    workStints: 0,
    heading: null,
    lastKm: 0,
    returning: false,
    lastBeatKey: null,
    roadMarks: [],
    stayDateKey: null,
    decidedOn: null,
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
      restingUntil: isoOrNull(r.restingUntil),
      wishes: Array.isArray(r.wishes)
        ? (r.wishes as unknown[]).filter((x): x is string => typeof x === 'string' && !!cityById(x))
        : [],
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
      lastBeatKey: typeof r.lastBeatKey === 'string' ? r.lastBeatKey : null,
      roadMarks: Array.isArray(r.roadMarks)
        ? (r.roadMarks as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      stayDateKey: typeof r.stayDateKey === 'string' ? r.stayDateKey : null,
      decidedOn: typeof r.decidedOn === 'string' ? r.decidedOn : null,
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
