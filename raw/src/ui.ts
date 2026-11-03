/**
 * 面板数据 —— 页签看到的那一份「她现在怎么样」。
 *
 * ## 为什么单独一个文件
 *
 * `world.ts` 已经够长了，而这一坨的职责很窄：把散在状态、作息表、照片簿里的东西
 * **整理成前端能直接画的样子**。纯数据，不碰网络，测试可以直接喂假数据验形状。
 *
 * ## 一条原则：这里不新算事实
 *
 * 时间轴上的每一项、进度、剩余时长，全部来自已经在跑的那套算术
 * （`plan.beats`、`progressOf`、`localMoment`）。面板只负责把它们排好序、起好人话名字。
 * 面板上出现一个别处算不出来的数字，就意味着两份真相 —— 那种错最难查。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 时间轴上的一条。`kind` 给前端挑颜色，不给它猜语义。 */
export interface UiTimelineItem {
  /** 当地时刻，`19:49`。 */
  readonly at: string;
  readonly what: string;
  readonly kind: string;
  /** 已经在身后的节点，灰掉。 */
  readonly past: boolean;
}

export interface UiLeg {
  readonly from: string;
  readonly to: string;
  readonly mode: string;
  /** 车次/航班号连同席别，如「G2028 次，二等座，5 站台」。自驾是空串。 */
  readonly code: string;
  readonly km: number;
  readonly hours: number;
  /** 0–100。 */
  readonly progress: number;
  /** 「还有 1 小时 20 分」这种话，已经算好。 */
  readonly left: string;
  /** 到站时的**当地**时刻。 */
  readonly eta: string;
}

export interface UiPhoto {
  readonly handle: string;
  readonly title: string;
  readonly city: string;
  readonly dateKey: string;
  /**
   * 媒体库里那个文件名（句柄去掉 `log:` 之类的前缀）。
   *
   * 2026-11-01 群友问「照片页能不能点开文件位置」。宿主没给外部打开文件的 API，
   * 所以这里是**让他能自己找到**：相册上显示文件名，配一个复制按钮，
   * 粘到资源管理器里就能定位。比编一个「打开」按钮诚实。
   */
  readonly file: string;
}

export interface UiSnapshot {
  /** 她那边的日期与时刻。**不是用户这边的。** */
  readonly dateKey: string;
  readonly clock: string;
  /**
   * 她那边的时区，`UTC+9` 这种。
   *
   * 2026-11-02 换掉面板上那句「比你快 1 天 21 小时」：那句只在世界时钟漂移时
   * 才有意义，平时读起来像界面算错了。时区是稳定信息，扫一眼就知道她那边几点、和你差几个钟头。
   */
  readonly tzLabel: string;
  readonly mode: 'home' | 'traveling' | 'staying';
  readonly place: {
    readonly id: string;
    readonly name: string;
    readonly region: string;
    readonly tz: string;
    readonly lat: number;
    readonly lon: number;
  };
  /** 她在这儿的身体感觉。一句话。 */
  readonly feeling: string;
  readonly weather: string;
  readonly leg: UiLeg | null;
  /** 今晚住哪。她不在目的地时是 null。 */
  readonly lodging: {
    readonly kind: string;
    readonly price: number;
    /** 高德查到的真店名。空串 = 没查到，只说类别。 */
    readonly name: string;
    readonly address: string;
  } | null;
  /** 日出时刻，`06:42`。看不到日出就是 null。 */
  readonly sunrise: string | null;
  readonly timeline: readonly UiTimelineItem[];
  readonly trip: {
    readonly days: number;
    readonly visited: number;
    readonly spent: number;
    readonly budget: number;
    readonly moneyOn: boolean;
  };
  /** 出发地认不出来时的说明。 = 正常。 */
  readonly homeProblem: string | null;
  readonly diary: {
    /** 有没有指到同步盘。true 时面板底部显示路径，让用户能确认设置生效。 */
    readonly shared: boolean;
    readonly dir: string; readonly days: number; readonly problem: string | null;
  };
  /**
   * 正在打的短工。`null` = 没在打工。
   *
   * 面板上要能一眼看出来，否则用户看到的只是「她三天没动」——
   * 那读起来像坏了，而不像在攒路费。
   */
  /** 正在往回走。面板据此把「叫她回来」换成「正在回来」，不让连点。 */
  readonly returning: boolean;
  readonly work: {
    readonly city: string;
    readonly gig: string;
    readonly pay: number;
    /** 还差几天收工。0 = 今天就完。 */
    readonly daysLeft: number;
  } | null;
  readonly photos: readonly UiPhoto[];
  /** 照片字节所在的目录。相册页顶部显示它，方便用户直接去翻。 */
  readonly photoDir: string;
  /**
   * 上一次没拍成的原因（余额不足、密钥错、超时）。成功一次就清掉。
   *
   * 2026-11-01：用户点了「补一张」，什么也没发生 —— 失败只进日志，
   * 相册里一片空白，人只能以为按钮坏了。日志是给开发看的，界面得给人看。
   */
  readonly photoError: string | null;
  /** 想去还没去的地方。歌里提到的会进这儿，所以它也是联动的一个证据。 */
  readonly wishes: readonly string[];

  /** 配置里的家。 */
  /**
   * 她此刻听到的歌（如果装了「一起听歌」并且正在放）。
   *
   * 单独拿出来显示，是因为**联动坏掉时一点动静都没有**：Music 扩展换了快照路径，
   * 这边读到空、当作「没在听歌」，于是 7 个小时没人发现。面板上有一行字，
   * 用户一眼就知道这条线通不通。
   */
  readonly music: { readonly title: string; readonly artist: string } | null;

  /** 「出门等他点头」开着没有。 */
  readonly askBeforeDepart: boolean;
  /** 现在能手动让她出发吗（在家、而且不在休息期）。 */
  readonly canDepart: boolean;
  /** 还在休息的话，歇到哪天（`11-03`）。按钮锁着时要说明为什么。 */
  readonly restUntil: string | null;

  readonly home: string;
  /**
   * 这一趟是从哪个家出发的。
   *
   * 改过出发地之后它会和 `home` 不一样 —— 她还在外面，人没跟着搬，但以后回的是新家。
   */
  readonly tripHome: string;
  /** 家搬了、这一趟的起点没变。面板靠它多写一句解释。 */
  readonly homeChanged: boolean;
  readonly speed: number;
  /**
   * 她的钟比用户快多少毫秒。正数 = 她跑在前面。
   *
   * 面板上那行「比你快 3 天 4 小时」由它算。**给毫秒，不给格式化好的字** ——
   * 这句话要分中英文，那是前端的事；后端只搬事实。
   */
  readonly clockDriftMs: number;
  /**
   * 这几天没有天气，是因为她的日期跑出了预报窗口。
   *
   * 单占一个布尔，不跟 `weather` 的空串混着：空串说不出是没网还是超窗，
   * 而这两件事的处置完全相反 —— 一个等一会儿就好，一个只能把时间拉回来。
   */
  readonly weatherOutOfRange: boolean;
  /** 新手引导看过没有。没看过就顶在最上面。 */
  readonly guideSeen: boolean;
  /**
   * 扩展版本，`0.5.2` 这种。
   *
   * 面板上本来不显示版本，但反馈信里必须有 —— 没有版本号的 bug 单，
   * 第一件事就是回头问「你装的哪版」。
   */
  readonly version: string;
  /**
   * 反馈收件地址。**空串 = 面板上不显示那一栏**，不是显示一个空的输入框。
   *
   * 留空是默认状态：这个扩展谁装都行，收件人由装的人自己填。
   */
  readonly feedbackEmail: string;
}

/** 引导只看一次。清掉它（换浏览器、重装）会再看一遍，不是坏事。 */
export const GUIDE_VERSION = 1;

/**
 * 面板上的时刻：`19:49`。
 *
 * **不要用提示词那个 `fmtHour()`** —— 它返回「十九点四十九分」，那是她嘴里念出来的话。
 * 面板上要的是能一眼扫过去的数字。这两个场景以前共用一个函数，
 * 结果时间轴一列全是「二十一点十三分」，读起来像小说。
 */
export function hm(decimal: number): string {
  const h = Math.max(0, Math.min(23.999, decimal));
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  // 23:59 + 进位会变成 24:00，夹回 23:59。
  const hh = m === 60 ? Math.min(23, whole + 1) : whole;
  const mm = m === 60 ? 59 : m;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 面板上的剩余时长：`1 小时 19 分`。比「1 个半小时」适合放在进度条旁边。 */
export function remainText(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${Math.max(0, m)} 分`;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

interface UiFile {
  guideSeenAt: string | null;
  guideVersion: number;
}

/** 面板自己的小状态。和行程状态分开存 —— 看没看过引导不影响她在哪。 */
export class UiStore {
  private readonly file: string;
  private data: UiFile = { guideSeenAt: null, guideVersion: 0 };

  constructor(dir: string) {
    this.file = join(dir, 'ui.json');
    this.load();
  }

  /** 看过引导没有。版本变了要重新看（引导内容改过就得再讲一遍）。 */
  get guideSeen(): boolean {
    return !!this.data.guideSeenAt && this.data.guideVersion === GUIDE_VERSION;
  }

  markGuideSeen(now = new Date()): void {
    this.data = { guideSeenAt: now.toISOString(), guideVersion: GUIDE_VERSION };
    this.save();
  }

  /** 重新放一遍引导。面板上那个「再看一次」会用。 */
  resetGuide(): void {
    this.data = { guideSeenAt: null, guideVersion: 0 };
    this.save();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')) as Partial<UiFile>;
      this.data = {
        guideSeenAt: typeof raw.guideSeenAt === 'string' ? raw.guideSeenAt : null,
        guideVersion: typeof raw.guideVersion === 'number' ? raw.guideVersion : 0,
      };
    } catch { /* 坏了就当没看过，重新讲一遍引导，没什么损失 */ }
  }

  private save(): void {
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch { /* 存不下就下次再讲一遍 */ }
  }
}
