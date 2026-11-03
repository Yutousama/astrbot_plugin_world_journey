/**
 * 大肥鱼环游世界 —— World 实现。
 *
 * ## 一句话架构
 *
 * 只存「出发时刻 + 目的地 + 交通方式」，每次醒来按真实时间**现算**她在哪。
 * 没有后台常驻进程、没有计时器累积的状态。所以电脑关三天再开，她已经到了、
 * 已经在目的地待了两天 —— 这不是补出来的幻象，是同一套算术算出来的。
 *
 * ## 为什么不用「每十分钟推一条事件」推进
 *
 * 那样 Core 一关就断，而且醒来时会堆一堆过期事件一起推，她一口气说十条昨天的事。
 * 现在只在**该说的那一个节点**推一条；中间错过的，正文里明说「中间几件事已经过去了」。
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, TriggerMode, BlobInput, EventEnvelope, WorldLamp,
} from 'cortico/core/types.ts';
import { JOURNEY_ID, journeyConfigGroups, type JourneyConfigSection } from './config.ts';
import { cityByName, cityById, CITIES, type City } from './geo/cities.ts';
import { distanceKm } from './geo/distance.ts';
import { modeById, type ModeId } from './geo/modes.ts';
import { localMoment, humanHours, localHour, shiftDateKey, tzOffsetLabel } from './clock.ts';
import { AmapWeather, feelOf, type Forecast } from './geo/amap.ts';
import { bodyFeeling, climateOfCity } from './geo/climate.ts';
import { bearingDeg } from './geo/distance.ts';
import { readNowPlaying, songLine, cityMentioned, type NowPlaying } from './music-peer.ts';
import { rollTrouble } from './easter.ts';
import { makeSchedule, scheduleText } from './plan/timetable.ts';
import { join } from 'node:path';
import { planDay, fmtHour, type DayPlan } from './plan/dayplan.ts';
import type { Pilgrim } from './geo/pilgrim.ts';
import { readPetVocab, actionsPrompt } from './pet-vocab.ts';
import { ActionWishes } from './action-wishes.ts';
import { rollLodging, withHotel, lodgingLabel, type Lodging } from './plan/lodging.ts';
import { HotelDirectory } from './geo/hotels.ts';
import {
  pickDestination, pickMode, buildJourney, progressOf, remainingRealHours, citiesOf,
  beatMarks, beatKey, sentProgress, beatGapText, BEAT_GAP_DEFAULT,
  type Journey,
} from './plan/journey.ts';
import { StateStore, initialState, type TripState } from './state.ts';
import { DiaryStore, type DiaryEntry } from './diary.ts';
import { TravelMemoryStore } from './travel-memory.ts';
import { shootPhoto, photoPrompt, photoTitle, spotFromBeat } from './photo.ts';
import { PhotoBook } from './photo-book.ts';
import { UiStore, hm, remainText, type UiSnapshot, type UiTimelineItem, type UiLeg } from './ui.ts';

/** 加载后的待命宽限。见 `depart()` 开头。 */
const BOOT_GRACE_MS = 2 * 60_000;
/** 坐过站的概率。一趟最多掷一次骰子。 */
const MISS_STOP_CHANCE = 0.035;
/** 坐过站之后要多花多少分钟（下车、发现、等返程）。 */
const MISS_STOP_EXTRA_MIN = 38;
const MISS_STOP_EXTRA_MAX = 72;

const ENV_PROMPT_FILE = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));
const PKG_VERSION = ((): string => {
  try {
    const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return p.version ?? 'unknown';
  } catch { return 'unknown'; }
})();

/**
 * 巡检间隔的上限（真实毫秒）。
 *
 * 但**不能固定**：240x 下 60 秒就是 4 小时世界时间，作息节点会被整段跳过。
 * 所以按倍速算，保证一次巡检跨过的世界时间不超过 15 分钟 ——
 * 见 `tickMs()`。
 */
const TICK_MAX_MS = 60_000;
/** 一次巡检最多跨过多少世界时间。15 分钟足够踩到任何相邻的作息节点。 */
const TICK_WORLD_BUDGET_MS = 15 * 60_000;
const TICK_MIN_MS = 3_000;
/** 一个地方待几天。骨架阶段 2-4 天，之后可以按城市大小调。 */
const STAY_DAYS_MIN = 2;
const STAY_DAYS_MAX = 4;
/** 每种新地点待几天就走的概率。留着不走的余量让「她某天不想动了」有地方发生。 */
const STAY_ONE_MORE = 0.15;
/** 这一站结束后，回家的概率（其余是去下一站）。 */
const GO_HOME_CHANCE = 0.2;

/**
 * 进了这个圈就一趟车到家，不再中途停。
 *
 * 五百公里大约是「一天能到」的距离。太大会让最后一段仍然像瞬移，
 * 太小会让她在离家几百公里的地方还要再停一站，反而啰嗦。
 */
const HOME_RADIUS_KM = 500;

/**
 * 每公里大致多少钱。只用来让「这趟花了多少」有个量级，不是票价表。
 *
 * 校准过几组：火车 500km ≈ 250 元（二等座对得上）、自驾 1240km ≈ 990 元
 * （油费加过路费）、飞机 5000km ≈ 7500 元（长途全价票对得上）、公交 300km ≈ 120 元。
 */
const FARE_PER_KM: Record<ModeId, number> = {
  walk: 0, bike: 0, scooter: 0.1, motorcycle: 0.3,
  car: 0.8, bus: 0.4, train: 0.5, ship: 0.7, plane: 1.5,
};

/** 一天三顿的大致开销。 */
const MEALS_PER_DAY = 95;
/** 预算剩余低于这个数，就开始过紧日子。 */
const TIGHT_THRESHOLD = 300;

/*
 * 钱袋子的四档。**按比例算，再压一个绝对下限。**
 *
 * 为什么按比例：预算是用户自己填的。旧代码写死「剩 300 就紧」——
 * 填两万预算的人要花到只剩三百才开始省，那时候已经不叫省了。
 *
 * 为什么还要绝对下限：填五百预算的人，10% 只有五十块，连一晚房钱都不够，
 * 那也该算见底。两个条件取谁都不满足才算「还没到」，宁可早一点省。
 */
const PURSE_TIGHT = { pct: 0.30, floor: 900 };
const PURSE_LOW = { pct: 0.10, floor: 420 };
const PURSE_EMPTY = { pct: 0.03, floor: 160 };

/** 钱只够走近处时的距离上限（公里）。大约是省内加邻省，一晚慢车能到。 */
const LOW_KM = 600;

/** 一份短工干几天。干完就带着攒下的钱走，不无限打下去。 */
const WORK_DAYS = 6;
/** 日薪是当天开销的几倍。1.6 = 干一天能攒下六成开销的钱。 */
const WORK_PAY_RATE = 1.6;
/**
 * 打工期间的开销比例。换宿管住、员工餐，比住酒店吃馆子便宜得多。
 *
 * 2026-11-02 模拟抓到的：不打折的时候「打工人住酒店吃馆子」，
 * 日薪永远追不上开销 —— 她在香格里拉连打了四次工，每次都不够攒出路费。
 */
const WORK_COST_RATE = 0.6;

/**
 * 同一趟最多打几次工。到数还是见底就该回家了。
 *
 * 4 这个数不是拍的：一份工六天 ≈ 攒出路费加三天住宿，四份就是「走一段、
 * 打一份」走完四程 —— 一次旅行里连着打五份工，那已经不是旅行了。
 */
const MAX_WORK_STINTS = 4;

/**
 * 短工的种类。只给**事实**，不给台词 —— 给了台词她会照着念。
 *
 * 都是「旅途中临时能干的活」：管饭、日结、不问来历。
 */
const GIGS = [
  '青旅换宿，管住管一顿饭',
  '小馆子帮厨，午饭晚饭两个饭点',
  '民宿前台顶夜班',
  '果园摘果，按筐算钱',
  '客栈打扫房间',
  '集市上帮人看摊',
];

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length) % list.length];

const TOOL_DECLS = [
  {
    name: 'journey_now',
    description:
      'Where she is right now: which city, which day of the trip, what she is doing at this hour, where she is staying tonight, and - if she is on the road - how far along she is. Use it when the person asks where she is, how the trip is going, or when you need her current situation before answering something about it.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['read'] as const,
    summary: { zh: '她现在在哪、第几天、这个点该做什么。', en: 'Where she is right now and what this hour is for.' },
  },
  {
    name: 'journey_diary_write',
    description:
      'Write the diary entry for a day of the trip, in her own voice. Call it once at the end of a local day, after the evening beats have happened. The entry is appended to the Markdown file for that month (one file per month, e.g. 2026-11.md), which follows the person across machines. Write what actually happened that day - the city, the road, what she ate, how the room was - not a summary of the extension.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        body: {
          type: 'string',
          description: 'The entry itself, first person, a few short paragraphs. Do not add a title; the date and city are already recorded.',
        },
        dateKey: {
          type: 'string',
          description: 'Local date to write for, YYYY-MM-DD. Leave it out to use the current local day at her location.',
        },
      },
      required: ['body'],
    },
    tags: ['write'] as const,
    summary: { zh: '写某一天的旅行日记，存成文件。', en: 'Writes the diary entry for a day of the trip.' },
  },
  {
    name: 'journey_diary_read',
    description:
      'Read back the diary. Three ways in, pick one: dateKey for a single day in full; month for the list of days in that month with a one-line gist each; days for the most recent N (max 60). Use month when the question reaches further back than the recent window - the diary can hold hundreds of days and the recent window is short on purpose.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dateKey: { type: 'string', description: 'One day in full, YYYY-MM-DD.' },
        month: { type: 'string', description: 'A month to list, YYYY-MM. Returns every day in it with a one-line gist.' },
        days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many recent days, newest last. Default 7.' },
      },
    },
    tags: ['read'] as const,
    summary: { zh: '读日记：某一天全文、某个月的目录、或最近几天。', en: 'Reads the diary: one day in full, a month of days, or the latest few.' },
  },
  {
    name: 'journey_stats',
    description:
      'The long view: how many days she has been travelling in total, how many cities she has reached, how many diary entries exist, and whether the diary folder is actually writable. Use it when the person asks how long she has been away or whether her memory is syncing.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['read'] as const,
    summary: { zh: '走了多少天、去过多少城、日记存在哪。', en: 'Total days, cities reached, and where the diary lives.' },
  },
  {
    name: 'journey_draw_to',
    description:
      'Record a place she now wants to go to because of something - a song that was playing, a line someone said, a photo she remembers. The place joins her wish list and weighs heavily next time she picks where to go. Use it when a song or a moment actually pulls her somewhere; do not use it to log every city she mentions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string', description: 'Which place, by name - 成都 / 拉萨 / 巴黎. Must be somewhere real.' },
        why: { type: 'string', description: 'One short line on what pulled her there. At most 50 characters.' },
      },
      required: ['city'],
    },
    tags: ['write'] as const,
    summary: { zh: '记下「因为某首歌想去某地」，下次挑地方时会优先。', en: 'Adds a place to her wish list after something pulled her there.' },
  },
] as const;

export interface JourneyWorldOptions {
  cfg: JourneyConfigSection;
  dataDir: string;
  botName: string;
  /**
   * 当前时刻。**只给测试用** —— 半年这条时间线没法靠等真实时间来验证，
   * 必须能把时钟推着走。生产环境不传，就用 `new Date()`。
   */
  now?: () => Date;
  /** 当前播放。**只给测试用** —— 生产环境读音乐扩展写的快照文件。 */
  nowPlaying?: () => NowPlaying | null;
}

export class JourneyWorld implements World {
  readonly id = JOURNEY_ID;
  private host: WorldHost | null = null;
  private log: Logger | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private st: TripState;
  private readonly store: StateStore;
  private readonly diary: DiaryStore;
  /** 跨设备那三样：去过、想去、花了多少。位置和路线不在这里，见 travel-memory.ts。 */
  private readonly travelMemory: TravelMemoryStore;
  private readonly weather: AmapWeather;
  private readonly opts: JourneyWorldOptions;
  /** 照片簿：她拍过哪些张。只存句柄，字节在宿主媒体库。 */
  private readonly photos: PhotoBook;
  /** 她想做、这套立绘还没有的动作。从宿主日志里捡，见 action-wishes.ts。 */
  private readonly wishes: ActionWishes;
  private wishTimer: ReturnType<typeof setInterval> | null = null;
  /** 真酒店名（高德地点库）。查不到就只说类别。 */
  private readonly hotels: HotelDirectory;
  /** 面板自己的小状态（引导看过没有）。和行程状态分开，互不影响。 */
  private readonly uiStore: UiStore;
  /**
   * 正在生图。
   *
   * 生图慢（十几秒到一分半），而巡检一分钟一次。没有这个闸，两次巡检都判定
   * 「今天还没拍」，就会同一张照片付两次钱。
   */
  private shooting = false;
  /** 上一次生图的结果，给指示灯用。 */
  private photoOutcome: 'never' | 'ok' | 'fail' = 'never';
  /**
   * 上一次没拍成的人话原因。成功一次清空。
   *
   * 只写日志不够：2026-11-01 用户在相册点「补一张」，界面什么反应都没有
   * （那天已经有一张，被判重静默跳过），他只能以为按钮坏了。
   */
  private photoError: string | null = null;
  /** 上一次看到的歌名。用来判断「换歌了」—— 同一个歌名不重复处理。 */
  private lastSongTitle: string | null = null;
  /** 当天的作息表。跨天重排；`staying` 之外为 null。 */
  private plan: DayPlan | null = null;
  /** 延后推第一次事件，避开 Core 的重启补投窗口（否则同一条会被投两遍）。 */
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  /** 巡检并发闸。见 `tick()` 里的说明 —— 少了它会重复推同一条事件。 */
  private ticking = false;
  /**
   * 这次加载是什么时候。
   *
   * 用来挡「刚被加载就出发」—— 用户装好扩展、改完配置重启、或者只是重启了应用，
   * 打开面板想看「她在家」的那一眼，看到的已经是「兰州 → 敦煌，0%」。
   * 2026-10-31 群里两个人同时抱怨过这件事。
   */
  private bootedAt = 0;

  constructor(opts: JourneyWorldOptions) {
    this.opts = opts;
    this.store = new StateStore(opts.dataDir);
    this.diary = new DiaryStore(opts.dataDir);
    this.travelMemory = new TravelMemoryStore(opts.dataDir);
    this.photos = new PhotoBook(opts.dataDir);
    this.wishes = new ActionWishes(opts.dataDir);
    this.hotels = new HotelDirectory(
      opts.cfg.amapKey,
      join(opts.dataDir, 'poi-cache.json'),
      (level, msg) => (level === 'warn' ? this.log?.warn(msg) : this.log?.info(msg)),
    );
    this.uiStore = new UiStore(opts.dataDir);
    this.weather = new AmapWeather(
      opts.cfg.amapKey,
      join(opts.dataDir, 'weather-cache.json'),
      (level, msg) => (level === 'warn' ? this.log?.warn(msg) : this.log?.info(msg)),
    );
    this.st = initialState('lanzhou');
  }

  private get cfg(): JourneyConfigSection { return this.opts.cfg; }

  /** 她现在听到的歌。测试可以注入，生产环境读快照文件。 */
  private currentSong(): NowPlaying | null {
    return this.opts.nowPlaying ? this.opts.nowPlaying() : readNowPlaying(this.opts.dataDir);
  }

  /**
   * 真实时刻。**只用于事件时间戳和日志。**
   *
   * `opts.now` 是测试用的注入点；生产环境不传就是 `new Date()`。
   */
  private realNow(): Date { return this.opts.now ? this.opts.now() : new Date(); }

  /**
   * 世界时刻。**所有旅行相关的判断都用它**：现在几点、到没到站、待了几天。
   *
   * 换算方式见 `ClockBase` 的注释：世界时刻 = 基准世界时刻
   * + (真实时刻 - 基准真实时刻) × 倍速。倍速为 1 时它等于真实时刻。
   */
  private worldNow(): Date {
    const c = this.st.clock;
    const real = this.realNow();
    if (!c) return real;
    const elapsed = real.getTime() - Date.parse(c.realEpoch);
    return new Date(Date.parse(c.worldEpoch) + elapsed * c.speed);
  }

  /**
   * 时间倍速的合法值。
   *
   * 配置项写的是 `enum: [1, 4, 24]`，但宿主把 `number` 渲染成**自由输入框** ——
   * 2026-11-01 Mr.Q 截图里填进了 `-42`。负数不会让世界倒流（下面 `Math.max(0.1,…)`
   * 会把它钉成 0.1），但它会变成**龟速**：一天走十分之一天，她几乎不动。
   * 那既不是用户想要的，也不是「静默纠正」能解释过去的东西。
   *
   * 所以这里统一兜底：**非有限数、零、负数一律当 1**。
   * 上限压到 240 —— 巡检最短 3 秒一次，240x 下 3 秒等于世界 12 分钟，
   * 再高就会成片跨过作息节点，事件全变成「中间有 N 个点过去了」。
   */
  private speedNow(): number {
    const v = Number(this.cfg.speed);
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.min(240, v);
  }

  /**
   * 她的时间比用户快多少毫秒。正数 = 她跑在前面。
   *
   * **只给显示用。** 任何判断都不许拿它去推时间 —— 那等于把「面板上那行字」
   * 当成第二个真相。判断一律走 `worldNow()` / `realNow()`。
   */
  private clockDriftMs(): number {
    return this.worldNow().getTime() - this.realNow().getTime();
  }

  /**
   * 巡检间隔：让**世界时间**的推进量控制在 15 分钟内。
   *
   * 1x 下就是 60 秒（上限）；24x 下 37 秒；240x 下 3.75 秒。
   * 不这样做的话，高倍速下每次巡检都跨过好几个作息节点，
   * 事件全变成「中间有 N 个点已经过去了」。
   */
  private tickMs(): number {
    const speed = this.speedNow();
    const bySpeed = Math.round(TICK_WORLD_BUDGET_MS / speed);
    return Math.max(TICK_MIN_MS, Math.min(TICK_MAX_MS, bySpeed));
  }

  /** 按当前倍速重建定时器。倍速变了要叫一次。 */
  private retimer(): void {
    if (this.timer) clearInterval(this.timer);
    if (!this.host) { this.timer = null; return; }
    this.timer = setInterval(() => void this.tick(), this.tickMs());
    this.timer.unref?.();
  }

  /**
   * 维护时钟基准。每次巡检开头调一次。
   *
   * 两种情况要建基准：还没有基准（首次运行 / 旧版本状态升级）、
   * 或者用户改了倍速。后者必须**结算掉已经走过的那段再换挡**，
   * 不然 1x 切 24x 的那一刻，世界时间会直接跳过去两周。
   */
  private ensureClock(): void {
    const real = this.realNow();
    const speed = this.speedNow();
    const c = this.st.clock;
    if (!c) {
      this.st = { ...this.st, clock: { realEpoch: real.toISOString(), worldEpoch: real.toISOString(), speed } };
      // **必须落盘。** 不写的话下次重启会拿不到基准、再建一次，
      // 每次重启世界时间都从头算。
      this.persist();
      this.log?.info(`世界时钟已建立：${speed}x。`);
      return;
    }
    if (Math.abs(c.speed - speed) < 1e-9) {
      // 倍速没变，但如果是 1x，检查世界时间有没有飘到未来。
      if (speed === 1) {
        const drift = this.worldNow().getTime() - real.getTime();
        if (drift > 3_600_000) this.alignToReal(real, drift);
      }
      return;
    }
    const world = Date.parse(c.worldEpoch) + (real.getTime() - Date.parse(c.realEpoch)) * c.speed;
    this.st = {
      ...this.st,
      clock: { realEpoch: real.toISOString(), worldEpoch: new Date(world).toISOString(), speed },
    };
    // 同理必须落盘 —— 否则磁盘上留着旧基准和旧倍速，
    // 每次重启都从那个旧点重新结算一次，世界时间被反复往前推。
    // 2026-10-31 实测：日志打印了「已连续结算」，但 state.json 里的 speed 还是旧值。
    this.persist();
    // 间隔也要跟着换，否则高倍速下巡检粒度跟不上世界时间。
    this.retimer();
    this.log?.info(`倍速 ${c.speed}x → ${speed}x，世界时间已连续结算，巡检 ${this.tickMs()}ms 一次。`);
    return;
  }

  /**
   * 1x 下的自动对齐：世界时间不该比真实时间超前。
   *
   * ## 为什么需要这个
   *
   * 加速一次的代价是**永久的**。世界时刻是累积的：跑一段 240x 再调回 24x，
   * 世界时间就一直比真实超前几个小时到几天，而且此后只按等速前进 —— 领先量不会缩小。
   * 后果不是算错，是**天气全部拿不到**：预报只有四到十五天，她已经在窗口外面。
   *
   * 所以 1x 一到，就把世界时间拉回真实时间。1x 的语义就是「正常速度」，
   * 这时还飘在未来没有任何意义。
   *
   * ## 关键是**平移**，不是重置
   *
   * 直接把世界时钟对齐，会把正在走的那一段甩到"还没出发"的时刻，行程就卡住了。
   * 所以 leg 的两个时刻、停留起点、旅行起点全部按同一个偏移量平移 ——
   * **剩余时长一点不变**，只是日期变了。日记目录那边会做备份，不覆盖。
   */
  private alignToReal(real: Date, driftMs: number, speed = 1): void {
    const shift = -driftMs;
    const move = (iso: string | null): string | null => {
      if (!iso) return null;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? new Date(t + shift).toISOString() : null;
    };
    /**
     * 两个日期键：**不按「减几天」挪，直接按平移后的世界时间重算。**
     *
     * 减天数会在边界上错一天：`2026-10-31T00:00Z` 减 72 小时零 0.7 秒，
     * 落到 `10-27T23:59:59`，日期就成了 27 号 —— 看上去像凭空跳了一天。
     * （2026-10-31 在副本上实机验的时候就是这么露的。）
     *
     * 而且这两个键的语义本来就是「她这一天已经排过表 / 已经决定过走不走」，
     * 跟着新时钟走才是对的：同步之后她过的就是新日子的表。
     * 原来没有值就保持没有（在家时 `stayDateKey` 是 null，别给它编一个）。
     */
    const here = this.cityOrNull(this.st.hereId);
    const todayKey = here ? localMoment(real, here.tz).dateKey : null;
    const st = this.st;
    this.st = {
      ...st,
      clock: { realEpoch: real.toISOString(), worldEpoch: real.toISOString(), speed },
      leg: st.leg ? { ...st.leg, departedAt: move(st.leg.departedAt)!, arriveAt: move(st.leg.arriveAt)! } : null,
      stayStartedAt: move(st.stayStartedAt),
      tripStartedAt: move(st.tripStartedAt),
      // 休息期也在同一段时间轴上：不挪的话，同步之后她会凭空多歇几天或者根本不歇。
      restingUntil: move(st.restingUntil),
      stayDateKey: st.stayDateKey === null ? null : (todayKey ?? st.stayDateKey),
      decidedOn: st.decidedOn === null ? null : (todayKey ?? st.decidedOn),
      lastBeatKey: null,   // 日期变了，去重键要跟着作废
    };
    this.persist();
    const hours = Math.round(Math.abs(driftMs) / 3_600_000);
    this.log?.info(
      `世界时间比真实${driftMs >= 0 ? '超前' : '落后'} ${hours} 小时，已对齐到真实时间。`
      + `${st.leg ? '正在走的那一段剩余时长不变。' : ''}`
      + (speed === 1
        ? '天气恢复正常。'
        : `日期回到今天，预报窗口重新可用；但倍速还是 ${speed}x，过一阵还会再拉开。`),
    );
  }

  /* ---------------- 生命周期 ---------------- */

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.log = host.log;

    const home = this.resolveHome();
    const loaded = this.store.load(home.city.id);
    this.st = loaded.state;
    if (loaded.problem) host.log.warn(loaded.problem);
    this.bootedAt = this.realNow().getTime();

    /*
     * 出发地被改了 = 搬家。
     *
     * 原来它只影响「下一趟从哪走」和「回家回哪」，于是会看到自相矛盾的界面：
     * 城市写着兰州、副标题写着「从石家庄出发」、行程是兰州→敦煌 —— 三句话互相打架。
     *
     * 用户改这一项时的意思很直白：**我家在石家庄了。** 所以：
     *   - 她在家（没出门）→ 人跟着搬过去，这就是新的一趟的起点
     *   - 她在外面 → 人不动（她真在兰州），但回家的目标换成新家
     */
    if (this.st.homeId !== home.city.id) {
      const before = this.cityName(this.st.homeId);
      const atHome = this.st.phase === 'home';
      this.st = {
        ...this.st,
        homeId: home.city.id,
        hereId: atHome ? home.city.id : this.st.hereId,
        // 在家才算「这一趟还没开始」；在外面改家，这一趟照走。
        tripStartedAt: atHome ? null : this.st.tripStartedAt,
        // 这一趟的起点**要保留**：家搬了，但她是打兰州出来的，这不是一回事。
        // 老状态里没有这个字段，那就拿旧家补上 —— 她这一趟确实是打那儿出来的。
        tripHomeId: atHome ? null : (this.st.tripHomeId ?? this.st.homeId),
        tripVisited: atHome ? [] : this.st.tripVisited,
        // 旧家的休息期不该被搬到新家"接着歇完"。
        restingUntil: atHome ? null : this.st.restingUntil,
        // 方向感属于上一趟：换了家就是新的一趟。
        heading: atHome ? null : this.st.heading,
        lastKm: atHome ? 0 : this.st.lastKm,
        decidedOn: atHome ? null : this.st.decidedOn,
        stayDateKey: atHome ? null : this.st.stayDateKey,
      };
      host.log.info(`出发地 ${before} → ${home.city.name}${atHome
        ? '，她跟着搬过去了'
        : '；她还在外面，回家会回新家'}`);
    }

    const health = this.diary.configure(this.cfg.memoryDir);
    if (health.problem) host.log.warn(health.problem);
    else if (health.notice) host.log.info(health.notice);

    /*
     * 记忆跟日记住同一个文件夹 —— 用户填一次就够。
     * 用的是 diary 探测过可写的那个目录：日记写不进去的地方，记忆也一定写不进去。
     */
    this.travelMemory.configure(health.dir);
    const merged = this.travelMemory.merge(this.st);
    if (merged.grew) {
      host.log.info('接上了另一台机器上的旅行记忆：去过的地方、想去的地方、花的那笔账，都合进来了。');
    }
    this.st = merged.state;

    // **启动时强制写一遍。**
    //
    // 不写的话，`state.json` 的字段全看「上一次 persist 是什么时候」——
    // 她在家休息的时候，`ensureClock` 倍速没变就直接返回、`stayTick` 又被
    // `stillResting` 挡住，整个启动流程一次都不落盘。
    // 后果是：扩展升级加了新字段，文件里还是旧格式，看起来像功能没生效
    // （2026-10-31 我自己就看着空的 `heading` 找了一轮）。
    // 现在无论什么状态，启动后磁盘上一定是完整格式。
    this.persist();

    // 恢复当天作息表：重启不能把「今天已经排好的表」丢掉，否则会重推早上的事件。
    if (this.st.phase === 'staying') await this.rebuildPlan(this.worldNow());

    this.retimer();
    /*
     * 十分钟捡一次「被丢掉的动作」。
     *
     * 不用更密：这行只在她说了词表外的动作时才出现，十分钟的延迟无所谓；
     * 而日志文件可能几十 MB，扫得太勤不划算。
     */
    this.wishes.scan();
    this.wishTimer = setInterval(() => this.wishes.scan(), 10 * 60_000);
    this.wishTimer.unref?.();

    this.bootTimer = setTimeout(() => void this.tick(), 6000);
    this.bootTimer.unref?.();

    host.log.info(`大肥鱼环游世界已启动 v${PKG_VERSION}：${this.st.phase}，在 ${this.cityName(this.st.hereId)}，日记 ${this.diary.current.dir}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.wishTimer) clearInterval(this.wishTimer);
    this.timer = null;
    this.bootTimer = null;
    this.wishTimer = null;
    this.host = null;
    this.log = null;
  }

  /* ---------------- 配置解析 ---------------- */

  /** 出发地。填了不认识的名字要**说出来**，别默默换成默认城市。 */
  private resolveHome(): { city: City; problem: string | null } {
    const raw = this.cfg.homeCity.trim();
    if (raw) {
      const c = cityByName(raw);
      if (c) return { city: c, problem: null };
      const fallback = cityByName('兰州') ?? CITIES[0];
      return { city: fallback, problem: `出发地「${raw}」不在内置城市表里，先按${fallback.name}算。` };
    }
    // 没配：用日记里最近出现过的城市；再不行用兰州（历史数据 + 常见起点）。
    const recent = this.diary.recentCities(1)[0];
    const fromDiary = recent ? cityById(recent) : null;
    if (fromDiary) return { city: fromDiary, problem: null };
    const c = cityByName('兰州') ?? CITIES[0];
    return { city: c, problem: `还没设「从哪儿出发」，先按${c.name}算。在设置里填一个城市名就改过来了。` };
  }

  private cityName(id: string): string {
    return cityById(id)?.name ?? id;
  }

  private cityOrNull(id: string): City | null {
    return cityById(id);
  }

  /* ---------------- 巡检 ---------------- */

  private async tick(): Promise<void> {
    if (!this.host) return;
    /**
     * 并发闸。
     *
     * `setInterval` 不管上一次跑完没有就会再叫一次。而一次 tick 里有 `await pushEvent`，
     * 宿主慢的时候完全可能超过 60 秒。两次 tick 叠在一起，两边都会读到同一个旧的
     * `lastBeatKey`，于是**同一条「午饭」被推两遍**。
     *
     * 2026-10-31 的三十天压缩模拟第一次抓到它（3 条重复），生产环境里表现是
     * 「她偶尔把同一件事说两遍」，而且日志上完全看不出问题。
     */
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.ensureClock();
      const now = this.worldNow();
      // 日记目录可能被用户热改（换同步盘），每次巡检顺便对一次。
      const health = this.diary.configure(this.cfg.memoryDir);
      if (health.problem && health.problem !== this.diary.current.problem) this.log?.warn(health.problem);
      // 记忆跟着日记的目录走：热改了同步盘，两边一起换，别只换一半。
      this.travelMemory.configure(health.dir);

      // 换歌时立刻反应，而不是等到出发那一刻。
      //
      // 原来只有两个采样点：`depart()` 和路上中间那个节点。用户放了歌，
      // 她可能几个小时都不提一句 —— 那不是没反应，是**根本没往这儿看**。
      // 现在每次巡检都看一眼，歌名带地名的当场进「想去」。
      //
      // **不推事件。** 音乐扩展自己就「换歌必说一句」，这边再推一条，
      // 桌宠会连着说两句同样的事。状态变了，她下次开口自然会用上。
      this.syncSongWish();

      if (this.st.phase === 'home') {
        if (this.stillResting(now)) return;
        // 他开了「出门等点头」：她就在家等着，一次都不自己走。
        // 手动那个按钮走 `panelInvoke`，跟这条无关 —— 所以这里什么都不用做。
        if (this.cfg.askBeforeDepart) return;
        await this.depart(now);
        return;
      }
      if (this.st.phase === 'traveling') {
        await this.travelTick(now);
        return;
      }
      await this.stayTick(now);
    } catch (e) {
      this.log?.warn(`巡游巡检出错：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.ticking = false;
    }
  }

  private stillResting(now: Date): boolean {
    const until = this.st.restingUntil;
    if (!until) return false;
    return now.getTime() < Date.parse(until);
  }

  /* ---------------- 出发 ---------------- */

  /**
   * 歌名里提到的城市，自动进「想去」。
   *
   * 这是**字面能确定**的那部分（《成都》《回到拉萨》），交给代码；
   * 「许巍该不该让人想起西安」那种联想交给 `journey_draw_to` 让她自己说。
   * 两条路分开，是因为硬编联想一定会编错，而字面匹配不会。
   */
  private maybeSongWish(np: NowPlaying | null): void {
    if (!np) return;
    const c = cityMentioned(np.title);
    if (!c || c.id === this.st.hereId) return;
    if (this.st.wishes.includes(c.id)) return;
    this.st = { ...this.st, wishes: [...this.st.wishes, c.id] };
    this.log?.info(`歌里提到${c.name}，记进想去的地方。`);
  }

  /**
   * 出发。
   *
   * `manual` = 他在面板上按了「让她出发」。手动那一下**跳过两个门禁**：
   * 加载宽限、以及 7–21 点的出门窗口。理由很简单 —— 他明确要求现在走，
   * 这时候再跟他说「现在不是出门的点」就是抬杠。
   */
  /**
   * 看一眼现在放的是什么，换了歌就处理一次。
   *
   * 只做「歌名里字面提到的城市」→ 进想去清单（`maybeSongWish` 里有去重）。
   * **不放事件、不催她说话** —— 理由写在 `tick()` 里的注释：
   * 音乐扩展负责「换歌必说一句」，这边负责「她心里多了一个想去的地方」。
   */
  private syncSongWish(): void {
    const np = this.currentSong();
    const title = np?.title ?? null;
    if (!title || title === this.lastSongTitle) return;
    this.lastSongTitle = title;
    this.maybeSongWish(np);
  }

  private async depart(now: Date, manual = false): Promise<void> {
    if (!manual) {
      // **刚加载完先待一会儿。**
      //
      // 不挡的话，World 一被挂上就出发：用户装好扩展、改完配置重启、甚至只是重启了
      // Coopani，抬眼看到的都是「她已经走了」。宽限不是休息期，只是「别在我刚按下
      // 那个按钮的下一秒就消失」。
      if (this.realNow().getTime() - this.bootedAt < BOOT_GRACE_MS) return;

      // 在家出发也要挑个像样的钟点。休息期到点的那一刻就是出发的时刻，
      // 而 `restingUntil` = 上次回家的时刻 + 休息天数，所以**上次几点到家，
      // 这次就几点出门** —— 原来只挡了「太早」，模拟里出现过晚上九点从家出发。
      //
      // 两头都要挡：7 点前不出门，21 点后也不出门。挡住的这一轮直接 return，
      // 下一轮巡检（几秒到一分钟之后）会重新判断，自然等到第二天早上。
      const boot = localMoment(now, this.cityOrNull(this.st.hereId)?.tz ?? this.resolveHome().city.tz).decimal;
      if (boot < 7 || boot >= 21) return;
    }

    const home = this.resolveHome().city;
    const from = this.cityOrNull(this.st.hereId) ?? home;

    this.maybeSongWish(this.currentSong());
    const picked = pickDestination({
      from,
      visited: this.st.everVisited,
      wishes: this.st.wishes,
      heading: this.st.heading,
      lastKm: this.st.lastKm,
      home,
      maxKm: this.nearOnly() ? LOW_KM : undefined,
    });
    if (!picked) {
      this.log?.warn('没有可去的地方，这一趟不出发。');
      return;
    }
    const to = picked.city;
    const mode = pickMode(from, to, picked.km, Math.random, this.isTight(), this.noFly(), this.affordMode(picked.km));
    if (!mode) {
      this.log?.warn(`${from.name} → ${to.name} 没有可用交通方式，换一个目的地。`);
      return;
    }

    const leg = buildJourney({ from, to, mode, km: picked.km, at: now, speed: this.speedNow() });
    // 记下这一趟是从哪个家出发的 —— 用户途中改家时，面板要靠它说清「人没跟家一起搬」。
    this.st = { ...this.st, tripHomeId: home.id };
    const tripVisited = this.st.tripVisited.includes(to.id)
      ? this.st.tripVisited
      : [...this.st.tripVisited, to.id];

    this.st = {
      ...this.st,
      phase: 'traveling',
      hereId: from.id,
      leg,
      tripStartedAt: this.st.tripStartedAt ?? now.toISOString(),
      tripVisited,
      lastBeatKey: null,
      roadMarks: [],
      stayDateKey: null,
      stayStartedAt: null,
      decidedOn: null,
    };
    this.plan = null;
    this.persist();

    const via = leg.viaIds.map((id) => this.cityName(id));
    const viaText = via.length
      ? `，路上会经过${via.slice(0, 4).join('、')}一带`
      : '';
    /*
     * 「火车」两个字后面接车次号，整件事立刻有了画面。
     *
     * 班次是**按线路和日期算出来的**（见 `timetable.ts`）：同一段路同一天固定，
     * 她今天说 G2028、晚上写日记还是 G2028。没有真实时刻表可用 —— 12306 不开放 ——
     * 但把车次、席别、站台写对，读的人不会觉得是编的。
     */
    const departLocal = localMoment(now, from.tz);
    const sched = makeSchedule(
      mode.id, from, to, departLocal.dateKey, leg.km, leg.durationWorldHours,
    );
    const how = scheduleText(mode.id, sched) || mode.name;
    await this.push(
      'journey.depart',
      `depart-${leg.id}`,
      `她出发了。${from.name}当地 ${fmtHour(departLocal.decimal)}，`
      + `${from.name} → ${to.name}，${how}，直线约 ${leg.km} 公里，`
      + `这一趟要走 ${humanHours(leg.durationWorldHours)}${viaText}。`
      + `\n${mode.feel}`
      + `\n（${to.name}那边这会儿是 ${this.localClock(now, to)}。到了自然就知道。）`
      + songLine(this.currentSong()),
      'flush',
    );
  }

  /* ---------------- 在路上 ---------------- */

  private async travelTick(now: Date): Promise<void> {
    const leg = this.st.leg;
    if (!leg) {
      // 数据坏了：停在原地，等下一轮重新安排。
      this.st = { ...this.st, phase: 'home' };
      this.persist();
      return;
    }
    if (now.getTime() >= Date.parse(leg.arriveAt)) {
      await this.arrive(now, leg);
      return;
    }
    // 先看有没有坐过站 —— 它会把到站时间往后推，后面的进度得用更新过的这一段算。
    await this.maybeMissStop(now, leg);
    const fresh = this.st.leg;
    if (fresh) await this.roadBeats(now, fresh);
  }

  /**
   * 坐过站。
   *
   * 只在最后一段（进度 82% 之后）掷一次骰子，机场不参与 —— 飞机没法坐过站。
   *
   * 处理方式是**把到站时间往后推**，不是把她挪到别的城市：
   * 位置必须始终是真的。她确实还在车上，只是要在下一站下车再折回来，
   * 多花四十来分钟。这样叙事和状态是一致的，也没有凭空多出一座城。
   *
   * 这不是需要用户出手的事（那是 `journey.trouble`），所以措辞是「丢人但常见」，
   * 不是求救。
   */
  private async maybeMissStop(now: Date, leg: Journey, chance = MISS_STOP_CHANCE): Promise<void> {
    if (leg.modeId !== 'train' && leg.modeId !== 'bus' && leg.modeId !== 'ship') return;
    const key = `${leg.id}|miss`;
    if (this.st.roadMarks.includes(key)) return;
    if (progressOf(leg, now) < 0.82) return;

    // 掷过就记下，不管中没中 —— 否则每次巡检都在同一个位置反复掷。
    this.st = { ...this.st, roadMarks: [...this.st.roadMarks, key] };
    if (Math.random() >= chance) {
      this.persist();
      return;
    }

    const extra = MISS_STOP_EXTRA_MIN
      + Math.round(Math.random() * (MISS_STOP_EXTRA_MAX - MISS_STOP_EXTRA_MIN));
    const arriveAt = new Date(Date.parse(leg.arriveAt) + extra * 60_000).toISOString();
    this.st = {
      ...this.st,
      leg: { ...leg, arriveAt, durationWorldHours: leg.durationWorldHours + extra / 60 },
    };
    this.persist();

    const { to } = citiesOf(leg);
    this.log?.info(`坐过站了：顺延 ${extra} 分钟。`);
    await this.push(
      'journey.mishap',
      `miss-${leg.id}`,
      `她坐过站了。本来该在${to?.name ?? leg.toId}下车，一走神没留意，反应过来车已经开了。`
      + `
只能在下一站下来再折回去，到站顺延 ${extra} 分钟 —— 她自己也觉得丢人，但这事谁都碰上过。`
      + `
（这不用他出手，别说成求救。）`,
      'flush',
    );
  }

  /**
   * 路上的节点。
   *
   * 之前「在路上」只有一个时长数字：出发一条、到达一条，中间十六个小时**全是空白**。
   * 但真实的长途旅行，记忆点恰恰在中间 —— 服务区那碗面、过站时醒的那一下、
   * 半夜还在开车只剩车灯。所以按行程进度插节点。
   *
   * 从 0.2.5 起「插几个」交给用户：设置页的「路上消息间隔」。
   * 算节点的活全在 `beatMarks()` 里，这个方法只管**发**。
   */
  private async roadBeats(now: Date, leg: Journey): Promise<void> {
    const { from, to } = citiesOf(leg);
    const mode = modeById(leg.modeId);
    if (!from || !to || !mode) return;

    const gap = Number.isFinite(this.cfg.beatGap) ? this.cfg.beatGap : BEAT_GAP_DEFAULT;
    const marks = beatMarks(leg.durationWorldHours, gap);
    if (!marks.length) return;

    const p = progressOf(leg, now);
    let due = -1;
    for (let i = 0; i < marks.length; i++) if (p >= marks[i]) due = i;
    if (due < 0) return;

    /*
     * 改间隔之后不补发身后那一段。
     *
     * 行程过半时把间隔从 2 改成 0.5，新节点表是 25/50/75 —— 前两个都在她身后了。
     * 不判断的话，她会在十分钟内把前半程的旧节点全部补一遍，听起来像卡带。
     */
    if (marks[due] <= sentProgress(this.st.roadMarks, leg.id)) return;

    const key = beatKey(leg.id, marks[due]);
    if (this.st.roadMarks.includes(key)) return;

    // 跨过多个只推最后一个，但全部标记为已处理 —— 否则下次还会补推。
    const done = [...this.st.roadMarks];
    for (let i = 0; i <= due; i++) {
      const k = beatKey(leg.id, marks[i]);
      if (!done.includes(k)) done.push(k);
    }
    this.st = { ...this.st, roadMarks: done };
    this.persist();

    const hour = localHour(now, from.tz);
    /*
     * 文案只有早/中/晚三档（`roadText` 按 idx 分），节点数不一定是三，
     * 所以这里要映射：
     * - 一个节点 → 落在半路，用中段（idx=1）
     * - 两个节点 → 早段 + 晚段
     * - 三个节点 → 直接对应
     */
    const idx = marks.length === 1 ? 1 : marks.length === 2 ? due * 2 : due;
    // 只在中间那个节点提歌 —— 每个节点都挂一句就成了报幕。
    const song = idx === 1 ? songLine(this.currentSong()) : '';
    // 剩余时间按**真实进度**算，不再用 idx 反推（短途用 idx=1 反推会差一截）。
    const text = roadText(mode.id, idx, leg, from, to, hour, p) + song;
    await this.push('journey.road', `road-${key}`, text, 'debounce');
  }

  private async arrive(now: Date, leg: Journey): Promise<void> {
    const { to } = citiesOf(leg);
    if (!to) {
      this.st = { ...this.st, phase: 'home', leg: null };
      this.persist();
      return;
    }
    const moment = localMoment(now, to.tz);
    const speed = this.speedNow();
    // 必须在更新 state 之前判「以前来过没有」—— 更新之后 everVisited 里一定有它。
    const beenBefore = this.st.everVisited.includes(to.id);

    const fromCity = this.cityOrNull(leg.fromId);
    this.st = {
      ...this.st,
      phase: 'staying',
      hereId: to.id,
      leg: null,
      stayStartedAt: now.toISOString(),
      stayDateKey: moment.dateKey,
      lastBeatKey: null,
      // 方向在**到站时**结算，不是出发时 —— 出发时 to 已经定了，但这一段的走向
      // 要等走完才算「上一段」。下一段选点就是靠这两个值决定往哪边继续。
      heading: fromCity ? bearingDeg(fromCity, to) : this.st.heading,
      lastKm: leg.km,
      everVisited: beenBefore ? this.st.everVisited : [...this.st.everVisited, to.id],
    };
    await this.rebuildPlan(now, 'arrival', moment.decimal, to);
    // 交通费在到站时结算 —— 票是出发前买的，但"花了多少"到站才成事实。
    const fare = leg.km * (FARE_PER_KM[leg.modeId] ?? 0);
    this.addSpent(fare);
    // 到了 = 那个念头兑现了，从「想去」里划掉。
    if (this.st.wishes.includes(to.id)) {
      this.st = { ...this.st, wishes: this.st.wishes.filter((x) => x !== to.id) };
    }
    this.persist();

    await this.push(
      'journey.arrive',
      `arrive-${leg.id}`,
      `到了。${to.name}，当地 ${fmtHour(moment.decimal)}。`
      + `这一趟 ${leg.km} 公里走了 ${humanHours(leg.durationWorldHours)}。`
      + `${beenBefore ? '这地方她以前来过，' : ''}${bodyFeeling(to, this.resolveHome().city)}`
      + `\n今晚住：${this.plan ? lodgingLabel(this.plan.lodging) : '还没定'}。`
      + weatherLine(this.plan?.weather ?? null)
      + `\n（倍速 ${speed}x，接下来按当地时间过日子。）`,
      'flush',
    );

    // 稀有的麻烦。千分之零点八，命中之后她自己办不完。
    const trouble = rollTrouble(to);
    if (trouble) {
      // 必须把「现在就开口」写进正文本身。
      //
      // 2026-10-31 实测：事件推到了、她也读了，然后**只写进日记，一个字都没说**。
      // 原因是那条彩蛋的措辞（「她想跟你说，但不知道怎么开口」）听起来像内心活动，
      // 她就把「不说」当成了正确的处理 —— 提示词里的「必须开口」没压住正文的语气。
      // 所以指令要贴在正文上，而不是离它十行远的规则区。
      await this.push(
        'journey.trouble',
        `trouble-${leg.id}`,
        `${trouble.text(to)}\n\n（**现在就开口说，不能只写进日记。** 这条是来找他帮忙的。）`,
        'flush',
      );
    }
  }

  /* ---------------- 在目的地 ---------------- */

  private async stayTick(now: Date): Promise<void> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here) {
      this.st = { ...this.st, phase: 'home', leg: null };
      this.persist();
      return;
    }
    const moment = localMoment(now, here.tz);

    // 跨天：只重排今天的表，**不在这里决定走不走**。
    // 原来「走不走」挂在这一刻，等于她每天都在凌晨零点收拾行李——
    // 真人不会这么干，而且他醒来只会看到一条半夜的「我上路了」。
    if (this.st.stayDateKey !== moment.dateKey) {
      const stayDays = this.stayDaysSoFar(now);
      // 跨天时把**前一天**的房费和饭钱一次结掉。
      // 用「前一天」的 plan（还没被覆盖），所以房型是那晚真住的那间。
      /*
       * 打工那几天按换宿算：住是店里给的，吃是员工餐。
       * 不折的话日薪追不上「住酒店吃馆子」的开销，那份工等于白干。
       */
      const dailyCost = (this.plan?.lodging.price ?? 0) + MEALS_PER_DAY;
      this.addSpent(this.st.work ? Math.round(dailyCost * WORK_COST_RATE) : dailyCost);
      // 还在打工就先结今天的工钱，再谈省不省 —— 顺序反了会算成「穷到换房」.
      if (this.st.work) this.earn(this.st.work.pay);
      // 钱紧的时候**换一家**。原来 `rebuildPlan` 里是 `this.plan?.lodging ?? roll()`，
      // 只要 plan 还在就永远复用第一天的房型 —— 结果预算早超了还在住「这几天最贵的一间」。
      // 正常情况不换（一个地方住几天本来就该是同一家），只有紧了才重新掷。
      if (this.isTight()) this.plan = null;
      this.st = {
        ...this.st,
        stayDateKey: moment.dateKey,
        lastBeatKey: null,
        decidedOn: null,   // 新的一天，重新给一次决策机会
      };
      await this.rebuildPlan(now, 'full', 0, here);
      this.persist();
      await this.push(
        'journey.day',
        `day-${moment.dateKey}-${here.id}`,
        `${here.name}的第 ${stayDays + 1} 天，当地 ${moment.dateKey}。`
        + (this.plan?.sunriseHour !== null && this.plan?.sunriseHour !== undefined
          ? `日出 ${fmtHour(this.plan.sunriseHour)}，日落 ${fmtHour(this.plan.sunsetHour ?? 0)}。`
          : '这一带今天没有正常的日出日落。'),
        'flush',
      );
      return;
    }

    // 决策点：当地早上八点到九点之间，一天只决定一次。
    // 放在早饭之后，这样「今天走不走」是在吃过饭、喘过气之后才想的。
    if (moment.decimal >= 8 && this.st.decidedOn !== moment.dateKey) {
      this.st = { ...this.st, decidedOn: moment.dateKey };
      this.persist();
      const startedDaysAgo = this.st.tripStartedAt
        ? (now.getTime() - Date.parse(this.st.tripStartedAt)) / 86_400_000
        : 0;
      const overMonths = startedDaysAgo / 30 >= this.cfg.maxTripMonths;
      const stayDays = this.stayDaysSoFar(now);

      // 回家路上：走得更急。每站住一晚就走，不看「待够没有」——
      // 赶路的人不会在途经的城市住三天。这个状态**不受出门月数限制**，
      // 否则到期那一刻会直接弹回家，前面走的几站全白算。
      if (this.st.returning) {
        if (stayDays >= 1) await this.goHome(now, here, false);
        return;
      }

      /*
       * 打工期间：今天不走。到点了才收工。
       *
       * 放在「回家路上」之后、「待够没有」之前：
       * 回家的路要一路走到底，不会在半路停下来打工；而只要还在打，
       * 待够没待够都不该放她走 —— 工钱还没结呢。
       */
      if (this.st.work) {
        if (now.getTime() >= Date.parse(this.st.work.until)) await this.endWork(now, here);
        return;
      }

      /*
       * 钱见底了：先找活，别继续往外走。
       *
       * 这一条替代的是「今天走不走」——钱只够明天一顿饭的时候，
       * 往前挪一座城不是勇敢，是把路走死。真实的背包客会先停下来挣。
       */
      if (this.purseStage() === 'empty') {
        /*
         * 这一趟已经打过够多次工了：钱还是不够，那就先回去。
         * 不加这一条的话她永远不回家 —— 模拟里 144 天打了 17 次工。
         */
        if (this.st.workStints >= MAX_WORK_STINTS) {
          await this.goHome(now, here, false);
          return;
        }
        await this.startWork(now, here);
        return;
      }

      const stayedLongEnough = stayDays >= STAY_DAYS_MIN
        && (stayDays >= STAY_DAYS_MAX || Math.random() > STAY_ONE_MORE);

      if (overMonths || (stayedLongEnough && Math.random() < GO_HOME_CHANCE)) {
        await this.goHome(now, here, overMonths);
        return;
      }
      if (stayedLongEnough) {
        await this.moveOn(now, here);
        return;
      }
    }

    if (!this.plan || this.plan.dateKey !== moment.dateKey) await this.rebuildPlan(now, 'full', 0, here);
    await this.advanceBeats(now, here, moment.decimal, moment.dateKey);
  }

  /** 在这个城市已经待了几天。按「到达这里的时刻」算，不按整趟旅行算。 */
  /**
   * 「到了个新地方，想不想找首歌听听」。
   *
   * ## 为什么只是一行字，不是事件
   *
   * 推事件会把它变成一条通知，而它本来只是走在街上忽然冒出来的一个念头。
   * 写在现状里，她可以不理 —— 这才是对的权重。
   *
   * ## 怎么放：能自己点，但要先问
   *
   * 网易云和 QQ 音乐的外部点播协议确实都被客户端关死了（「一起听歌」扩展
   * 2026-10-26 逐条实测：协议没注册、补了注册表也被主实例静默丢弃、COM 接口是空壳）。
   * 但那条路只是**省事的那条**，不是唯一的一条 —— 桌宠扩展的电脑操作
   * （截屏、点、输入）能直接开人家的播放器点播。
   *
   * 2026-11-01 Mr.Q 指出这一点时，这里原本写的是「你放不了」。
   * 那句话会让它干脆放弃尝试，是**能力描述写错**，不是保守。
   *
   * 所以现在的说法是：动得了电脑就自己点，动不了就请他点；**开别人的播放器之前先问一句**
   * —— 宿主那边本来也是这么要求的（`worlds.desktop-pet.cua.permission`）。
   *
   * 只在到达的头两天出现：连着住五天，第五天还提「刚到一个地方」就是傻的。
   */
  private songHint(now: Date): string {
    if (this.st.phase !== 'staying') return '';
    if (this.stayDaysSoFar(now) > 1) return '';
    return '刚到这儿。想听和这地方有关的歌就搜一首（装了一起听歌可用 music_pick），'
      + '搜到自己去放：动得了电脑就点开播放器放，动不了就请他点。'
      + '动别人的播放器之前先问一句。';
  }

  private stayDaysSoFar(now: Date): number {
    if (!this.st.stayStartedAt) return 0;
    const ms = now.getTime() - Date.parse(this.st.stayStartedAt);
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.floor(ms / 86_400_000);
  }

  /**
   * 这是在这一城的第几个「当天」（0 = 到的那天）。
   *
   * **按当地日期算，不按满 24 小时算。**
   *
   * 2026-11-02 自查抓到的：原来这里直接用 `stayDaysSoFar()`，而它是「过了几个 24 小时」——
   * 下午三点到，第二天早上七点跨天，才过 16 小时，算出来还是 0，
   * 于是 `dayIndex` 一直是 0，**第二天照样排同一批地标**。
   * 用户的观感就是「昨天去了玉泉观，今天又去玉泉观」；
   * 而这正是 2026-11-01 已经修过一次的那条线（群友说「第二天还是卢浮宫」）——
   * 当时只改了 `spotText` 的推算，没检查喂进去的 `dayIndex` 到底是不是 0。
   *
   * **`stayDaysSoFar` 不动。** 那个的语义是「住了几晚」，四舍五入到整晚是对的；
   * 用它判断「待够没有」没有错，错在拿它当「第几天」。
   */
  private stayDayIndex(now: Date): number {
    if (!this.st.stayStartedAt) return 0;
    const c = this.cityOrNull(this.st.hereId);
    if (!c) return 0;
    const from = localMoment(new Date(this.st.stayStartedAt), c.tz).dateKey;
    const to = localMoment(now, c.tz).dateKey;
    const diff = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0;
  }

  /** 排当天的作息表。`shape` 由调用方给 —— 到达日、完整日、最后一天。 */
  private async rebuildPlan(now: Date, shape: 'arrival' | 'full' | 'last' = 'full', startHour = 0, city?: City): Promise<void> {
    const c = city ?? this.cityOrNull(this.st.hereId);
    if (!c) return;
    const moment = localMoment(now, c.tz);
    /*
     * 住宿：**先掷档次，再查真名**。
     *
     * 两件事分开：档次是设计（六成普通、四成景观、半百分之一小破店），本地算；
     * 真名要联网，查不到就只说类别。所以没网、没 key、接口挂了，
     * 她今天住什么档次的房一点不受影响 —— 只是别指望她说出店名。
     */
    this.hotels.setKey(this.cfg.amapKey);
    const base = this.plan?.lodging ?? rollLodging(Math.random, this.isTight(), c.priceIdx);
    // 已经挂过真名的房型不必再查一次（同一个地方住几天就是同一家）。
    const pois = base.name ? null : await this.hotels.hotels(c);
    const lodging = withHotel(base, pois, Math.random, c.priceIdx);
    this.weather.setKey(this.cfg.amapKey);
    // 查不到就是 null —— 作息表照排，只是不排日出、不排夜间出门。
    const w = await this.weather.forecast(c, moment.dateKey).catch(() => null);
    this.plan = planDay({
      city: c,
      dateKey: moment.dateKey,
      shape,
      startHour,
      lodging,
      weather: w,
      /*
       * **第几天决定今天去哪儿。**
       * 到达当天是 0，第二天是 1 —— 直接拿停留天数当索引，
       * 每天换一批地标，不会连着两天排同一个（群友 2026-11-01 反馈的那个问题）。
       */
      dayIndex: this.stayDayIndex(now),
    });
  }

  /**
   * 把该说的那一个节点说出来。
   *
   * 关键在「漏掉几轮怎么办」：Core 关了一夜，醒来时可能已经有三个节点过期。
   * **只推最后一个**，并在正文里说明中间跳过了什么。一次推三条会把她变成报站机，
   * 而她本来该像人一样「哦，一觉睡到中午了」。
   */
  private async advanceBeats(now: Date, city: City, localNow: number, dateKey: string): Promise<void> {
    const plan = this.plan;
    if (!plan) return;
    const due = plan.beats.filter((b) => b.at <= localNow);
    if (!due.length) return;
    const last = due[due.length - 1];
    const key = `${dateKey}|${last.kind}|${last.at}`;
    if (key === this.st.lastBeatKey) return;

    const skipped = due.filter((b) => `${dateKey}|${b.kind}|${b.at}` !== this.st.lastBeatKey).length - 1;

    this.st = { ...this.st, lastBeatKey: key };
    this.persist();

    // 阈值给 5。
    //
    // 一两个点被跨过是正常的：巡检间隔虽按倍速自适应，但 `await pushEvent` 会等
    // 宿主把事件处理完，模型思考几秒到几十秒，这段时间世界时间照样在走。
    // 24x 下这通常只跳一两个；240x（测试用的极端值）下会跳四五个。
    // 提示得太勤，每条事件后面都挂一句「中间有 N 个点过去了」，反而成了噪音。
    const skippedNote = skipped >= 5
      ? `（中间跨过了 ${skipped} 个点，不用一条条补。）`
      : '';

    const text = beatText(city, plan, last.kind, last.at, last.what, last.pilgrim) + skippedNote;
    // 两类节点不单独叫醒她：
    //   `sleep` —— 每天都会发生的沉默时刻，说了也没意思；
    //   `arrive` —— 由 `journey.arrive` 事件负责，再推一遍就是同一件事说两遍。
    if (last.kind === 'sleep' || last.kind === 'arrive') return;
    const trigger: TriggerMode = last.kind === 'hotel' || last.kind === 'sunrise' ? 'flush' : 'debounce';
    await this.push('journey.beat', `beat-${dateKey}-${last.kind}-${last.at}`, text, trigger);

    // 拍一张：只在「出去逛」这个节点，一天一次。**不 await** ——
    // 生图要十几秒，等它会把这个巡检卡住，后面该推的节点全被推迟。
    if (last.kind === 'activity') {
      void this.maybePhoto(
        city, Math.round(localNow), dateKey,
        // 地名优先取 beat 上带着的；老状态里没有这个字段时再退回从文字里反解。
        last.spot ?? spotFromBeat(last.what),
        plan.weather,
      );
    }
  }

  /* ---------------- 照片 ---------------- */

  /**
   * 拍一张。
   *
   * ## 什么时候拍
   *
   * 只在「出去逛」那个节点 —— 一天一次，正好也是相册里一天一张。
   * 别的节点（早饭、回酒店）拍出来会是一堆重复的街道，
   * 而且**每张都要钱**，所以宁可少。
   *
   * ## 三条硬约束
   *
   * 1. 接口没配就不拍（`imageApi` 为空）。这是默认状态，也是绝大多数人的状态。
   * 2. 同一天同一个城市不重复拍 —— 高倍速下一分钟能过完一天，不去重会连拍十张。
   * 3. 只在当地天亮着的时候拍。半夜出去拍一张「漆黑的街」没有意义。
   *
   * 失败一律静默：接口挂了、超时了、额度没了，旅行一步都不停，
   * 也不该把报错糊到用户脸上 —— 只写一行日志。
   */
  /** 诊断用：接口地址只留到 host，别把 key 或整条路径打到界面上。 */
  private safeApi(raw: string): string {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}/…`;
    } catch {
      return '（不是合法 URL）';
    }
  }

  /**
   * 这个时刻她在哪一处 —— 取「已经过去的活动节点里最后一个有具体地名的」。
   *
   * 只认 `at <= hour` 的活动节点：下午两点半在伏羲庙，三点还在伏羲庙；
   * 五点已经回了酒店，这时候拍的该是酒店窗外，不是下午那处。
   */
  private spotNow(hour: number): string {
    const plan = this.plan;
    if (!plan) return '';
    let spot = '';
    for (const b of plan.beats) {
      if (b.kind !== 'activity' || b.at > hour) continue;
      const s = b.spot ?? spotFromBeat(b.what);
      if (s) spot = s;
    }
    return spot;
  }

  /**
   * 拍一张。**返回为什么没拍**，不再静默。
   *
   * 2026-11-01 收到一条反馈：地址、密钥、模型都填好了，点「补一张」没反应，
   * core.log 里没有任何记录，中转站也没看到请求。查下来是这里四个 `return`
   * 全是静默的，而 `shoot` 又是 `void` 不等待 —— 用户在界面上看到的只有「什么都没发生」。
   *
   * 现在每个跳过都带 reason，手动那条还会记一行日志。
   */
  private async maybePhoto(
    city: City, hour: number, dateKey: string, spot: string, weather: Forecast | null,
    replace = false,
  ): Promise<{ ok: boolean; reason?: string }> {
    /*
     * 跳过时给一句人话。**手动（replace）记 info，自动只记 debug** ——
     * 自动那条每十五分钟走一次，跳过是常态，记 info 会把日志刷满。
     */
    const skip = (reason: string): { ok: false; reason: string } => {
      if (replace) this.log?.info(`补拍没进行：${reason}`);
      else this.log?.debug(`自动拍照跳过：${reason}`);
      return { ok: false, reason };
    };

    if (this.shooting) return skip('上一张还没拍完');
    if (!this.cfg.imageApi.trim()) return skip('没有配生图接口');
    /*
     * 时间窗只管**自动**那条：她半夜不该自己掏相机。
     *
     * 2026-11-01 的反馈就卡在这一行 —— 用户点了「现在补一张」，可她当地过了二十点，
     * 于是被挡掉，一声不响。手动是明确意图，几点都该拍。
     */
    if (!replace && (hour < 7 || hour >= 20)) return skip(`她那边 ${hour} 点，不在拍照时段（7–20）`);
    /*
     * 「一天一张」是**自动**那条路的成本闸。手动补拍是明确意图，不该被它挡住 ——
     * 挡住的表现是点了没反应，比拍一张贵得多。所以 replace=true 时跳过判重，
     * 成功之后把当天那条旧记录摘掉。
     */
    if (!replace && this.photos.has(dateKey, city.id)) return skip('这一天这个城市已经拍过');

    // 标题要在 try 外面算好：catch 里要用它拼日志，写在里面就出作用域了。
    const title = photoTitle(city.name, spot, hour);
    this.shooting = true;
    try {
      const prompt = photoPrompt({
        city: city.name,
        spot,
        hour,
        weather: weather?.dayWeather,
        // 体感参与提示词：高原和湿热拍出来的调子不一样，那是她眼睛看到的东西。
        feel: bodyFeeling(city, this.resolveHome().city),
        // 风格交给用户：接本地模型的人要能盖掉「胶片质感」这种写实指令。
        style: this.cfg.imageStyle,
      });
      // 失败会抛错，由下面的 catch 记下原因 —— 用户配错了得能从日志里看出是哪一步。
      const shot = await shootPhoto({
        api: this.cfg.imageApi,
        key: this.cfg.imageKey,
        model: this.cfg.imageModel,
        prompt,
      });
      // 字节交给宿主：它算哈希、落 data/media/、回一个 log: 句柄。
      const env = await this.push(
        'journey.photo',
        `photo-${dateKey}-${city.id}`,
        `她拍了张照片：${title}。`,
        'debounce',
        [{
          bytes: shot.bytes,
          mime: shot.mime,
          name: `${city.id}-${dateKey}.png`,
          fallbackText: `（一张${title}的照片）`,
        }],
      );
      const handle = env?.blobs?.[0]?.handle;
      this.photoOutcome = handle ? 'ok' : 'fail';
      if (!handle) return { ok: false, reason: '宿主没返回图片句柄' };
      this.photoError = null;
      if (replace) this.photos.replaceDay(dateKey, city.id, handle);
      this.photos.add({
        handle,
        cityId: city.id,
        cityName: city.name,
        dateKey,
        title,
        spot,
        // 真实时刻排序：世界时间在高倍速下会跑到未来，按它排相册会乱。
        at: this.realNow().toISOString(),
      });
      return { ok: true };
    } catch (e) {
      // 不推事件、不停旅行：她照走。但**原因既要进日志也要进界面** ——
      // 只进日志的话，点按钮的人看到的就是「什么都没发生」。
      this.photoOutcome = 'fail';
      const why = e instanceof Error ? e.message : String(e);
      this.photoError = `这张没拍成（${title}）：${why}`;
      this.log?.warn(this.photoError);
      return { ok: false, reason: why };
    } finally {
      this.shooting = false;
    }
  }

  /* ---------------- 回家 / 换地方 ---------------- */

  private async goHome(now: Date, from: City, forced: boolean): Promise<void> {
    const home = this.resolveHome().city;
    const km = distanceKm(from, home);

    // 够近了就一趟车到家。五百公里差不多是一段能当天到的路。
    if (km < HOME_RADIUS_KM) {
      await this.settleHome(now, from, forced, km);
      return;
    }

    // 还远：**往回走，不瞬移**。
    //
    // 原来这里是直接把 hereId 改成家 —— 南宁回兰州两千里，一步就到，
    // 中间的城市一个都不算去过、没有路上事件、没有日记、没有花费。
    // 那一趟里如果出现「银川」，它是随机挑的另一个目的地，不是回程的一站。
    // 现在改成一路朝家走，途经的城市就真的在「往家方向」上了。
    this.st = { ...this.st, returning: true };
    this.persist();
    this.log?.info(`决定回家了，还差 ${Math.round(km)} 公里，一路往回走。`);
    await this.moveOn(now, from, { toward: home });
  }

  /** 真正到家：结掉这一趟，进休息期。 */
  private async settleHome(now: Date, from: City, forced: boolean, km: number): Promise<void> {
    const home = this.resolveHome().city;
    const mode = km < 30 ? null : pickMode(from, home, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km));
    const restUntil = new Date(now.getTime() + Math.max(0, this.cfg.restDays) * 86_400_000);
    const visited = this.st.everVisited.length;

    this.st = {
      ...this.st,
      phase: 'home',
      hereId: home.id,
      leg: null,
      tripStartedAt: null,
      tripVisited: [],
      workStints: 0,
      /*
       * 账也结清。**预算是「这一趟」的，不是一辈子的。**
       *
       * 2026-11-02 模拟抓到的口径冲突：打工次数按趟清零、花销却一路累计，
       * 于是 144 天跑出「净值 4562 / 预算 3000」—— 每趟都能再打四次工，
       * 预算就成了一个永远追不上的软目标。
       *
       * 回家 = 这一趟结束。下次出门带的是「重新算的这份预算」。
       */
      spent: 0,
      earned: 0,
      // 回到家 = 这一趟结束，方向作废。下次出门是**新的一趟**，
      // 不该被上一趟「往南走」的惯性带着继续往南。
      heading: null,
      lastKm: 0,
      returning: false,
      restingUntil: this.cfg.restDays > 0 ? restUntil.toISOString() : null,
      lastBeatKey: null,
      roadMarks: [],
      stayDateKey: null,
      stayStartedAt: null,
      decidedOn: null,
    };
    this.plan = null;
    this.persist();

    await this.push(
      'journey.home',
      `home-${now.getTime().toString(36)}`,
      forced
        ? `出门到上限了（${this.cfg.maxTripMonths} 个月），她回${home.name}了。这一趟去过 ${visited} 个地方。`
          + `\n先在家待 ${this.cfg.restDays} 天。`
        : `这一趟到头了。${from.name} → ${home.name}${mode ? `，坐${mode.name}` : ''}，回去了。`
          + `\n一路走回来，最后一程 ${Math.round(km)} 公里。`
          + `\n在家歇 ${this.cfg.restDays} 天再动。`,
      'flush',
    );
  }


  /** 去下一站。和 depart 的区别：不出家门，直接从当前城市走。 */
  private async moveOn(now: Date, from: City, opts: { toward?: City } = {}): Promise<void> {
    const home = this.resolveHome().city;
    const target = opts.toward ?? null;
    const picked = pickDestination({
      from,
      visited: this.st.everVisited,
      wishes: this.st.wishes,
      // 回家路上，方向由「家在哪」决定，不是上一段的惯性。
      heading: target ? bearingDeg(from, target) : this.st.heading,
      lastKm: this.st.lastKm,
      home,
      toward: target ?? undefined,
      // 钱只够走近处时，连「离家更近但隔着半个中国」的候选都不该出现。
      maxKm: this.nearOnly() ? LOW_KM : undefined,
    });
    if (!picked) {
      // 往回走却选不出地方（孤岛、城市表覆盖不到），那就别再拖，直接到家的算法兜底。
      if (target) await this.settleHome(now, from, false, distanceKm(from, target));
      return;
    }
    const to = picked.city;
    const mode = pickMode(from, to, picked.km, Math.random, this.isTight(), this.noFly(), this.affordMode(picked.km));
    if (!mode) {
      if (target) await this.settleHome(now, from, false, distanceKm(from, target));
      return;
    }
    const leg = buildJourney({ from, to, mode, km: picked.km, at: now, speed: this.speedNow() });

    this.st = {
      ...this.st,
      phase: 'traveling',
      leg,
      tripVisited: this.st.tripVisited.includes(to.id) ? this.st.tripVisited : [...this.st.tripVisited, to.id],
      lastBeatKey: null,
      roadMarks: [],
      stayDateKey: null,
      stayStartedAt: null,
      decidedOn: null,
    };
    this.plan = null;
    this.persist();

    await this.push(
      'journey.depart',
      `depart-${leg.id}`,
      // 回程和普通换城市的语气不一样：一个是「想再走走」，一个是「往回走了」。
      target
        ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，往${home.name}的方向走。`
          + `下一站${to.name}，${mode.name}，${leg.km} 公里，${humanHours(leg.durationWorldHours)}。`
          + `\n离家还有 ${Math.round(distanceKm(to, home))} 公里。`
        : `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，在这儿待够了，动身。`
          + `去${to.name}，${mode.name}，${leg.km} 公里，${humanHours(leg.durationWorldHours)}。`,
      'flush',
    );
  }

  /* ---------------- 输出 ---------------- */

  /**
   * 推一条事件。`blobs` 是随事件走的附件（照片），字节由宿主落进 `data/media/`，
   * 事件里只留 `log:` 句柄 —— 返回的信封里能拿到句柄。
   */
  private async push(
    type: string,
    senderKey: string,
    text: string,
    trigger: TriggerMode,
    blobs?: BlobInput[],
  ): Promise<EventEnvelope | null> {
    const host = this.host;
    if (!host) return null;
    return await host.pushEvent({
      type,
      source: this.id,
      senderKey,
      // 事件时间戳用真实时刻：宿主用它排序和补投，跟世界时间不是一条轴。
      ts: this.realNow().toISOString(),
      text,
      ...(blobs && blobs.length ? { blobs } : {}),
    }, { trigger });
  }

  /**
   * 记一笔。
   *
   * **按天和按行程结算，不按事件结算。** 事件会跳（高倍速下、或者宿主忙），
   * 按「早饭那条推了就扣 15 块」的做法会让账目随倍速变化 —— 同样的旅行，
   * 24x 下比 1x 少花一半钱，这种账没法看。
   */
  /**
   * 钱见底了，在当地找份短工。
   *
   * 这一步替代的是「继续往外走」，**不是停下来不活**。
   * 她照旧过日子，只是这几天过的是干活、吃饭、睡觉，不是看景点。
   */
  private async startWork(now: Date, here: City): Promise<void> {
    const local = localMoment(now, here.tz);
    const perDay = (this.plan?.lodging.price ?? 150) + MEALS_PER_DAY;
    const pay = Math.round(perDay * WORK_PAY_RATE);
    const gig = GIGS[Math.floor(Math.random() * GIGS.length)] as string;
    const until = new Date(now.getTime() + WORK_DAYS * 86_400_000).toISOString();
    this.st = {
      ...this.st,
      work: { cityId: here.id, startedOn: local.dateKey, until, pay, gig },
      workStints: this.st.workStints + 1,
    };
    this.persist();
    await this.push(
      'journey.work',
      `work-start-${here.id}-${local.dateKey}`,
      `${here.name}，钱只够再走一小段了。在这儿找了份短工 —— ${gig}，一天 ${pay} 块，先干 ${WORK_DAYS} 天，攒够下一段的路费再走。`
      + (this.cfg.withUser ? '\n\n（跟他说一声，别让他以为你不动了。）' : ''),
      'flush',
    );
  }

  /** 干满了，收工接着走。 */
  private async endWork(now: Date, here: City): Promise<void> {
    if (!this.st.work) return;
    this.st = { ...this.st, work: null };
    this.persist();
    const local = localMoment(now, here.tz);
    await this.push(
      'journey.work',
      `work-end-${here.id}-${local.dateKey}`,
      `${WORK_DAYS} 天干完了，攒下的够走下一段。手还是酸的，但能接着走了。`,
      'flush',
    );
  }

  private addSpent(n: number): void {
    if (!this.cfg.moneyEnabled || !(n > 0)) return;
    this.st = { ...this.st, spent: this.st.spent + Math.round(n) };
  }

  /** 现在手头紧不紧。记账关着或没设预算，永远不紧。 */
  /**
   * 钱袋子的档位。
   *
   * `ok` 正常走 / `tight` 住便宜的坐慢车 / `low` 只走近处且不坐飞机 / `empty` 停下打工。
   * 记账关着、预算填 0（不限），永远是 `ok` —— 没记账就别替用户省钱。
   */
  private purseStage(): 'ok' | 'tight' | 'low' | 'empty' {
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return 'ok';
    // 净值 = 花掉的 - 挣到的。打工收入不该让「已经花了多少」这个数字变小。
    const left = this.cfg.budget - (this.st.spent - this.st.earned);
    const under = (t: { pct: number; floor: number }): boolean =>
      left < Math.max(this.cfg.budget * t.pct, t.floor);
    if (under(PURSE_EMPTY)) return 'empty';
    if (under(PURSE_LOW)) return 'low';
    if (under(PURSE_TIGHT)) return 'tight';
    return 'ok';
  }

  /** 任何一档不宽裕都算「紧」：住宿降级、慢车优先。 */
  private isTight(): boolean {
    return this.purseStage() !== 'ok';
  }

  /**
   * 钱只够走近处了：候选卡在 LOW_KM 以内。
   *
   * 和「不坐飞机」分开两个判据：见底才限距离，但**只要开始紧就不该买机票** ——
   * 一张跨洲票够她打两次工。144 天模拟里就是这样：打工回血到「紧」档，
   * 概率压过之后还是中了机票，一次几千，直接又见底。
   */
  private nearOnly(): boolean {
    const st = this.purseStage();
    return st === 'low' || st === 'empty';
  }

  /**
   * 不坐飞机。紧、见底、空了都算。
   *
   * **回家路上例外**：在国外没钱了还不让买票，她会永远卡在那座城市回不来。
   */
  private noFly(): boolean {
    if (this.st.returning) return false;
    return this.purseStage() !== 'ok';
  }

  /** 这一段的票价。和 `addSpent` 用的是同一个算式，别让两处算出差。 */
  private fareOf(modeId: string, km: number): number {
    return km * (FARE_PER_KM[modeId as ModeId] ?? 0);
  }

  /**
   * 买得起哪种票。
   *
   * 上限是**剩余预算的一半**（至少 200 块）：留一半给到了之后住和吃。
   * 一条路费吃掉全部余钱，到了那儿第一晚就没着落 —— 那不叫出发，那叫赌。
   *
   * 回家路上例外：卡票钱她就永远回不来。只要还剩钱就按「买得起」算，
   * 真的一分不剩就不限制 —— 记账认了，人得回去。
   */
  private affordMode(km: number): ((m: TravelMode) => boolean) | undefined {
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return undefined;
    const left = this.cfg.budget - (this.st.spent - this.st.earned);
    if (this.st.returning) {
      return left > 0 ? (m) => this.fareOf(m.id, km) <= left : undefined;
    }
    const cap = Math.max(200, left * 0.5);
    return (m) => this.fareOf(m.id, km) <= cap;
  }

  /**
   * 挣了一笔。
   *
   * **分开记，不从 `spent` 里扣。** 第一版直接减 `spent`，理由是「这趟的账就是净花掉多少」——
   * 跑模拟才发现那个理由站不住：预算 500 跑 48 天，面板显示「花销 0」，
   * 而她明明住了几十晚、吃了上百顿。**花销是事实，不该被收入抹掉。**
   *
   * 判断钱够不够的地方一律用 `spent - earned` 这个净值。
   */
  private earn(n: number): void {
    if (!this.cfg.moneyEnabled || !(n > 0)) return;
    this.st = { ...this.st, earned: this.st.earned + Math.round(n) };
  }

  /** 钱那一行。记账关着时返回空串 —— 不记就别提。 */
  private moneyLine(): string {
    if (!this.cfg.moneyEnabled) return '';
    const { spent, earned } = this.st;
    const tail = earned > 0 ? `，打工挣了 ${earned} 块` : '';
    if (this.cfg.budget <= 0) return `这一趟已经花了 ${spent} 块${tail}。`;
    // 还剩多少按净值算：挣的钱确实能花。
    const left = this.cfg.budget - (spent - earned);
    if (left <= 0) return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget} 已经花超了。`;
    if (left < TIGHT_THRESHOLD) return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget}，只剩 ${left} 块，得省着来。`;
    return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget}，还剩 ${left} 块。`;
  }

  private persist(): void {
    const err = this.store.save(this.st);
    if (err) this.log?.warn(err);
    /*
     * 记忆单独一份文件。
     *
     * 挂在 persist 后面而不是另设定时器：状态变了记忆才可能变，
     * 两个写点分开就会有一段「记忆落后于状态」的窗口 —— 那段时间换机器，丢的就是这几天。
     */
    const bad = this.travelMemory.save({
      everVisited: this.st.everVisited,
      wishes: this.st.wishes,
      spent: this.st.spent,
      earned: this.st.earned,
    });
    if (bad) this.log?.warn(bad);
  }

  private localClock(at: Date, city: City): string {
    const m = localMoment(at, city.tz);
    return `${m.dateKey} ${fmtHour(m.decimal)}`;
  }

  /* ---------------- 工具 ---------------- */

  tools(): ToolDef[] {
    const decl = TOOL_DECLS;
    return [
      {
        name: decl[0].name,
        description: decl[0].description,
        parameters: decl[0].parameters,
        tags: [...decl[0].tags],
        handler: async () => ({ text: this.nowSummary() }),
      },
      {
        name: decl[1].name,
        description: decl[1].description,
        parameters: decl[1].parameters,
        tags: [...decl[1].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { body?: string; dateKey?: string };
          return this.writeDiary(a.body ?? '', a.dateKey);
        },
      },
      {
        name: decl[2].name,
        description: decl[2].description,
        parameters: decl[2].parameters,
        tags: [...decl[2].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { days?: number; month?: string; dateKey?: string };
          /*
           * 三种问法：dateKey 精确到一天 → month 一个月的目录 → days 最近 N 天。
           *
           * 2026-11-02 加的：原来只有 days，上限 60。模拟里跑到 141 天时抽查最早那天和跨年那天，
           * **两天都读不回来** —— 不是写丢了，是窗口外根本没有。
           * 日记是唯一不会有第二份的记忆，读不到就等于没有。
           */
          const one = String(a.dateKey ?? '').trim();
          if (one) {
            const e = this.diary.read(one.slice(0, 10));
            if (!e) return { text: `日记里没有 ${one.slice(0, 10)} 这天。` };
            return { text: `${e.dateKey} · ${e.cityName}\n${e.body}` };
          }
          const mon = String(a.month ?? '').trim();
          if (mon) {
            const list = this.diary.month(mon.slice(0, 7));
            if (!list.length) return { text: `${mon.slice(0, 7)} 这个月没有日记。` };
            return {
              text: `${mon.slice(0, 7)} 共 ${list.length} 天：\n`
                + list.map((e) => `${e.dateKey} · ${e.cityName} · ${gist(e.body)}`).join('\n')
                + '\n（要看某一天的全文，用 dateKey 取。）',
            };
          }
          const days = Number(a.days ?? 7);
          const entries = this.diary.recent(Math.max(1, Math.min(60, days)));
          if (!entries.length) return { text: '日记还是空的，一天都还没写。' };
          return {
            text: entries
              .map((e) => `${e.dateKey} · ${e.cityName}\n${e.body}`)
              .join('\n\n---\n\n')
              + (this.diary.count() > entries.length
                ? `\n\n（这里只是最近 ${entries.length} 天，一共写了 ${this.diary.count()} 天。更早的按月看：month=YYYY-MM。）`
                : ''),
          };
        },
      },
      {
        name: decl[3].name,
        description: decl[3].description,
        parameters: decl[3].parameters,
        tags: [...decl[3].tags],
        handler: async () => ({ text: this.statsSummary() }),
      },
      {
        name: decl[4].name,
        description: decl[4].description,
        parameters: decl[4].parameters,
        tags: [...decl[4].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { city?: string; why?: string };
          return this.addWish(a.city ?? '', a.why);
        },
      },
    ];
  }

  private nowSummary(): string {
    const now = this.worldNow();
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return '她现在的城市认不出来了，等下一轮重新安排。';

    if (this.st.phase === 'traveling' && this.st.leg) {
      const leg = this.st.leg;
      const { from, to } = citiesOf(leg);
      const mode = modeById(leg.modeId);
      const progress = Math.round(progressOf(leg, now) * 100);
      // 直接用世界时间相减。原来是用「真实剩余 × 出发时的倍速」反算，
      // 用户中途改倍速就会算错 —— 而倍速恰恰是最常被改的那个旋钮。
      const remainWorld = Math.max(0, (Date.parse(leg.arriveAt) - now.getTime()) / 3_600_000);
      return [
        `在路上。${from?.name ?? leg.fromId} → ${to?.name ?? leg.toId}，${mode?.name ?? leg.modeId}。`,
        `${leg.km} 公里，这一趟 ${humanHours(leg.durationWorldHours)}，已经走了 ${progress}%。`,
        `还剩约 ${humanHours(remainWorld)}的世界时间。`,
        leg.viaIds.length ? `路上经过：${leg.viaIds.map((id) => this.cityName(id)).join('、')}。` : '',
      ].filter(Boolean).join('\n');
    }

    if (this.st.phase === 'home') {
      const until = this.st.restingUntil;
      const rest = until && now.getTime() < Date.parse(until)
        ? `在家休息，到 ${until.slice(0, 10)} 再出门。`
        : '在家，随时可以动身。';
      return `${here.name}。${rest}\n${this.st.everVisited.length ? `这一趟已经去过 ${this.st.everVisited.length} 个地方。` : ''}\n家里这样：${bodyFeeling(here, here)}`;
    }

    const moment = localMoment(now, here.tz);
    const plan = this.plan;
    /*
     * 「下一个点」要跳过景点里的中段话（`activity` 且没有 `until`）——
     * 那不是「接下来去哪儿」，只是「还在那儿」。混进来会读成
     * 「下一个点：四点一刻 还在伏羲庙」，像在报行程。
     */
    const next = plan?.beats.find(
      (b) => b.at > moment.decimal && !(b.kind === 'activity' && b.until === undefined),
    );
    /*
     * 正在进行的活动（有 until，且此刻落在区间里）。
     * 只认带 `until` 的那条：中段插话的节点没有 until，拿它当「正在」会算出一个零点。
     */
    const nowAt = plan?.beats.findLast(
      (b) => b.kind === 'activity' && b.until !== undefined
        && b.at <= moment.decimal && moment.decimal < b.until,
    );
    return [
      `在 ${here.name}，当地 ${moment.dateKey} ${fmtHour(moment.decimal)}（${partWord(moment.part)}）。`,
      // 体感以「家」为参照：她是从兰州出来的鱼，到湿热的南方和回西北，
      // 身体的第一反应不是一回事。这句话让她随时说得出「受不受得了」。
      `身体感觉：${bodyFeeling(here, this.resolveHome().city)}`,
      plan ? `今晚住：${plan.lodging.kind}，${plan.lodging.price} 块左右。${plan.lodging.feel}` : '',
      weatherLine(plan?.weather ?? null),
      plan?.sunriseHour !== null && plan?.sunriseHour !== undefined
        ? `日出 ${fmtHour(plan.sunriseHour)}，日落 ${fmtHour(plan.sunsetHour ?? 0)}。`
        : '',
      /*
       * **她现在就在某个地方待着。**
       *
       * 2026-11-01 Mr.Q 说「14:30 逛伏羲庙是个时间段，不是到了那一秒就参观完了」——
       * 原来这里只有「下一个点」，她 15:30 被问「你在干嘛」只能答「等晚饭」。
       */
      nowAt
        ? `此刻在${nowAt.spot ?? '外面逛'}，算着待到 ${fmtHour(nowAt.until ?? 0)}。`
        : '',
      next ? `下一个点：${fmtHour(next.at)} ${next.what}。` : '今天的点都过完了，该睡了。',
      /*
       * 今天排上的地方，哪些在作品里出现过。
       *
       * 只报**已经排进行程**的那几处，不报「这座城理论上还有哪些」——
       * 后者等于把导游书塞给她，而这一行的用处是「等一下要去的地方还有另一层意思」。
       * 空数组时 `join` 前已被 `filter(Boolean)` 滤掉，不会出现空行。
       */
      plan ? todayPilgrimLines(plan).join('\n') : '',
      plan?.nightOption ? `这边晚上能做的：${plan.nightOption}。` : '这边晚上没什么非做不可的事。',
      this.songHint(now),
      this.st.wishes.length ? `想去还没去的：${this.st.wishes.map((id) => this.cityName(id)).join('、')}。` : '',
    ].filter(Boolean).join('\n');
  }

  private writeDiary(body: string, dateKey?: string): { text: string; isError?: boolean } {
    const text = body.trim();
    if (!text) return { text: '正文是空的，没写。', isError: true };
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.resolveHome().city.id);
    if (!here) return { text: '连自己在哪个城市都不知道，先不写。', isError: true };
    const now = this.worldNow();
    const key = (dateKey ?? localMoment(now, here.tz).dateKey).slice(0, 10);
    const entry: DiaryEntry = {
      dateKey: key,
      cityId: here.id,
      cityName: here.name,
      lodging: this.plan?.lodging.kind,
      body: text,
    };
    const r = this.diary.write(entry);
    if (r.problem) return { text: `日记只存到本机了：${r.problem}`, isError: true };
    return { text: `写好了，${key} 这天，存在 ${r.path}。` };
  }

  private addWish(name: string, why?: string): { text: string; isError?: boolean } {
    const c = cityByName(name.trim());
    if (!c) {
      return {
        text: `内置城市表里没有「${name.trim()}」。换个说法，或者给个近一点的大城市 —— 编一个不存在的地方没意义。`,
        isError: true,
      };
    }
    if (c.id === this.st.hereId) return { text: `已经在这儿了，不用记。` };
    const had = this.st.wishes.includes(c.id);
    if (!had) {
      this.st = { ...this.st, wishes: [...this.st.wishes, c.id] };
      this.persist();
    }
    const list = this.st.wishes.map((id) => this.cityName(id)).join('、') || '空';
    return { text: `${had ? '本来就在' : '记下了'}：${c.name}${why ? `（${why}）` : ''}。想去的地方：${list}。` };
  }

  private statsSummary(): string {
    const h = this.diary.current;
    const entries = this.diary.count();
    return [
      `去过 ${this.st.everVisited.length} 个地方，日记 ${entries} 天。`,
      this.st.tripStartedAt
        // 用世界时刻算 —— 这是「她过了多少天」，不是「真实时间过了多少天」。
        // 24x 下真实一小时就是世界一天，用真实时间会得出「刚出发却已经三天」。
        ? `这一趟从 ${this.st.tripStartedAt.slice(0, 10)} 开始，已经 ${Math.max(1, Math.round((this.worldNow().getTime() - Date.parse(this.st.tripStartedAt)) / 86_400_000))} 天。`
        : '现在没在旅行。',
      this.moneyLine(),
      `日记目录：${h.dir}`,
      h.problem ? `⚠ ${h.problem}` : h.notice ? `ℹ ${h.notice}` : '目录可写。',
      /*
       * 她想做、这套立绘还没有的动作。
       *
       * 放在这里而不是提示词里：这是**给用户看的账**，不是给她看的指令。
       * 提示词里已经有「词表外的也能写」，她知道就行；攒了哪些，人得看得见。
       */
      this.wishes.summary(),
    ].filter(Boolean).join('\n');
  }

  /* ---------------- 提示词 ---------------- */

  /**
   * 当前立绘的词表。
   *
   * **不缓存。** 一个几百 KB 的 JSON，读一次不到一毫秒，而调用它的地方
   * （前缀重建、设置页、stats）一天也就几十次。缓存换来的那点时间，
   * 抵不过「用户换了立绘、缓存还在」这种错 —— 而那表现为她的动作一个个失效。
   */
  private petVocab(): ReturnType<typeof readPetVocab> {
    const value = readPetVocab(this.opts.dataDir);
    if (value.source === 'fallback') this.log?.warn(`动作词表用了兜底：${value.note}`);
    return value;
  }

  envPromptVars(): Record<string, string> {
    const now = this.worldNow();
    const here = this.cityOrNull(this.st.hereId);
    const phase =
      this.st.phase === 'traveling' ? '在路上'
      : this.st.phase === 'home' ? (this.stillResting(now) ? '在家休息' : '在家待命')
      : '在目的地';
    return {
      'journey.version': PKG_VERSION,
      'journey.status': `${phase}｜${here?.name ?? this.st.hereId}`,
      'journey.now': this.nowSummary(),
      'journey.withUser': this.cfg.withUser ? '同行（叙事上说「我们」）' : '只有她一个人',
      // 路上的密度是他设的：关掉时她得知道「这一路没人叫我是正常的」，不然会自己编话填进来。
      'journey.beatGap': beatGapText(this.cfg.beatGap),
      // 出发地是配置项（用户能改），而「她是哪儿的鱼」也**由它决定** ——
      // 代码里的体感一直是以家为基准算的（`affinity` / `bodyFeeling`），
      // 所以提示词里不能写死一个城市：那只对开发者的机器成立，对别人就是撒谎。
      'journey.home': this.resolveHome().city.name,
      // 家**本身**是什么样，不跟谁比 —— 拿 `bodyFeeling(home, home)` 会得到「跟家里一个味道」这种废话。
      'journey.homeFeel': climateOfCity(this.resolveHome().city),
      'journey.diary': this.diary.current.dir,
      /*
       * 动作清单**现读**当前立绘的词表，不写死在提示词里。
       *
       * 写死的代价 2026-11-01 已经付过一次：提示词给的是英文 id，她说中文，
       * 于是自己造了个「拍拍」，宿主静默丢掉 —— 只有脸变、人不动、不报错。
       * 换立绘、宿主升级、词表增删，写死的那份都会立刻过期，而过期的表现一模一样。
       */
      'journey.actions': actionsPrompt(this.petVocab()),
    };
  }

  /**
   * 设置页头部的两个徽章。
   *
   * 用户打开设置页，第一个想知道的是「她现在到底在哪儿」——
   * 这件事在配置项里一个字都没有，得翻日志才有。放两个徽章在这儿，
   * 不用点任何东西就知道她此刻在做什么。
   *
   * 只放两个：徽章多了就不是信息，是装饰。
   */
  private settingBadges(): Array<{ label: string; value: string; tone?: 'on' | 'off' | 'plain' }> {
    const st = this.st;
    if (!st) return [];
    let where: string;
    if (st.phase === 'traveling' && st.leg) {
      const to = this.cityOrNull(st.leg.toId);
      where = to ? `在去${to.name}的路上` : '在路上';
    } else {
      const here = this.cityOrNull(st.hereId);
      if (!here) where = '不知道在哪';
      else if (st.phase === 'home') {
        where = this.stillResting(this.worldNow()) ? `在${here.name}歇着` : `在${here.name}待命`;
      } else where = `在${here.name}`;
    }
    const badges: Array<{ label: string; value: string; tone?: 'on' | 'off' | 'plain' }> = [
      { label: '现在', value: where, tone: 'plain' },
    ];
    if (st.everVisited.length) {
      badges.push({ label: '去过', value: `${st.everVisited.length} 个地方`, tone: 'plain' });
    }
    if (this.cfg.moneyEnabled && st.spent > 0) {
      badges.push({ label: '花销', value: `${st.spent} 元`, tone: 'plain' });
    }
    return badges;
  }

  webUi(): WorldWebUiDecl {
    return {
      label: '大肥鱼环游世界',
      badges: this.settingBadges(),
      /**
       * 四条链路指示灯。
       *
       * 这个扩展有一半的能力是「读别人的东西」或「调别人的接口」：天气、日记目录、
       * 生图、听歌联动。它们**坏起来都是静默的** —— 2026-10-31 听歌联动断了七个小时，
       * 用户是靠「好像没了（」发现的。灯是给这件事的答案：一眼能看出哪条断了。
       */
      lamps: this.worldLamps(),
      /**
       * 两个页签。
       *
       * `now` 不是「设置」，是**她此刻**。用户打开这个世界，第一个想知道的是
       * 「她在哪儿、那边几点、接下来会做什么」—— 这三件事原来一条都没有，
       * 只能去问她或者翻日志。
       *
       * `album` 是照片。她不拍自己（理由见 `photo.ts`），所以相册里全是空镜，
       * 一天一张，按城市和光分。
       */
      panels: [
        { id: 'now', title: '她此刻', description: '她在哪、那边几点、接下来会发生什么。' },
        { id: 'album', title: '照片', description: '她路上拍的那些，一天一张。' },
      ],
      invoke: (panel, method, args) => this.panelInvoke(panel, method, args),
      config: journeyConfigGroups(),
      promptDocs: [{
        key: `worlds.${JOURNEY_ID}.envPrompt`,
        title: '大肥鱼环游世界提示词',
        description: '她怎么用这个扩展：看路、过日子、写日记。',
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: [
          { name: 'journey.version', description: '扩展版本。' },
          { name: 'journey.status', description: '当前状态与所在城市。' },
          { name: 'journey.now', description: '她现在在哪、这个点该做什么。' },
          { name: 'journey.withUser', description: '宠物主是否同行。' },
          { name: 'journey.beatGap', description: '路上的话有多密（0 = 一路安静）。' },
          { name: 'journey.home', description: '出发地。**也是她的身体基准** —— 她是打这儿长起来的。' },
          { name: 'journey.homeFeel', description: '家那边的体感（干湿、风、海拔、温差），由城市数据算出来。' },
          { name: 'journey.diary', description: '日记目录。' },
          { name: 'journey.actions', description: '当前这套立绘认识的动作名（从 figure.json 现读）。' },
        ],
      }],
    };
  }

  /* ---------------- 指示灯 ---------------- */

  /**
   * 四条链路的状态。
   *
   * 宿主的灯每 500ms 轮询一次，所以这里必须极轻 —— 只读内存里的标记，
   * 听歌那条因为要读文件，加了 2 秒缓存（否则每 500ms 做六次 statSync）。
   *
   * **注意灯不是健康检查。** 它说的是「上一次发生了什么」：
   * 天气没网时也会是红，照片没配接口是灰而不是红（那不是故障，是没启用）。
   */
  private npCache: { at: number; value: NowPlaying | null } | null = null;

  private worldLamps(): WorldLamp[] {
    const srcName = this.weather.source === 'amap' ? '高德' : 'Open-Meteo';
    const wOutcome = this.weather.outcome;
    // 超前多少天。只用于把话说具体（「快了 6 天」比「超窗了」有用）。
    const driftDays = Math.floor(this.clockDriftMs() / 86_400_000);
    const weather: WorldLamp =
      // **超窗排在最前面判。** 它和「没网」在数据上长得一样（都是没天气），
      // 但只有这一种能说清原因，也只有这一种有按钮能修 —— 混进「没查到」里，
      // 用户会去检查网络，然后再也回不来。
      this.weather.outOfRange
        ? {
            label: '天气',
            state: 'error',
            hint: `她的日期已经超出预报窗口${driftDays > 0 ? `（快了 ${driftDays} 天）` : ''}，点「同步」拉回来`,
          }
        : wOutcome === 'ok' ? { label: '天气', state: 'online', hint: `上次查到了（${srcName}）` }
          : wOutcome === 'fail' ? { label: '天气', state: 'error', hint: `上次没查到（${srcName}），先去日志里看那一行` }
            : { label: '天气', state: 'offline', hint: `还没查过，用的是${srcName}` };

    const health = this.diary.current;
    const diary: WorldLamp = health.problem
      ? { label: '日记', state: 'error', hint: health.problem }
      : { label: '日记', state: 'online', hint: health.dir };

    // 没配生图接口是「没启用」，不是故障 —— 用灰点，别用红点吓人。
    const photo: WorldLamp = !this.cfg.imageApi.trim()
      ? { label: '照片', state: 'offline', hint: '没配生图接口，只写字不拍照' }
      : this.photoOutcome === 'ok'
        ? { label: '照片', state: 'online', hint: '上一次拍成了' }
        : this.photoOutcome === 'fail'
          ? { label: '照片', state: 'error', hint: '上一次没拍成，日志里搜「没拍成」' }
          : { label: '照片', state: 'offline', hint: '配好了，还没拍过' };

    // 走 `realNow()`，不用 `Date.now()` —— 这个项目里时间是唯一入口，有测试守着。
    const now = this.realNow().getTime();
    if (!this.npCache || now - this.npCache.at > 2_000) {
      this.npCache = { at: now, value: this.currentSong() };
    }
    const np = this.npCache.value;
    const music: WorldLamp = np
      ? { label: '听歌', state: 'online', hint: `在放《${np.title}》` }
      : { label: '听歌', state: 'offline', hint: '没在放歌，或者没装「一起听歌」。这一条断了就不会有歌', };

    return [weather, diary, photo, music];
  }

  /* ---------------- 面板 ---------------- */

  /**
   * 面板的方法入口。
   *
   * 只有读、两个引导开关、一个「让她出发」和一个「把她的钟拉回我这边」。
   * 面板不给「让她现在就去某地」这种按钮 —— 那种事该她自己在对话里被说服，
   * 不该有人在设置页点一下就替她决定去哪。
   */
  private async panelInvoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel === 'now') {
      if (method === 'snapshot') return this.uiSnapshot();
      if (method === 'dismissGuide') {
        this.uiStore.markGuideSeen(this.realNow());
        return this.uiSnapshot();
      }
      if (method === 'replayGuide') {
        this.uiStore.resetGuide();
        return this.uiSnapshot();
      }
      /**
       * 一键同步：把她的钟拉回到用户此刻。
       *
       * **倍速不动。** 按钮的语义只有「现在对齐」，不是「改回正常速度」——
       * 后者是设置项里那个 1x，两个动作混在一起，用户会不知道自己改了什么。
       * 代价是 24x 下对齐完一分钟又拉开 23 分钟，这一点在面板文案里明说。
       */
      if (method === 'syncClock') {
        const real = this.realNow();
        const drift = this.worldNow().getTime() - real.getTime();
        // 一秒以内不值得动：平移一整段状态，只为了让那行字从「0 秒」变成「0 秒」，
        // 风险远大于收益。
        if (Math.abs(drift) >= 1000) {
          // **用时钟上已经生效的倍速，不是配置里那个。** 同步只管对齐时间，
          // 不管节奏；用户刚改完配置还没走到下一轮巡检时，替他把节奏一起改了
          // 就等于这个按钮偷偷多干了一件事。
          const speed = Math.max(0.1, this.st.clock?.speed ?? this.speedNow());
          this.alignToReal(real, drift, speed);
          // 日期变了，手上那张作息表是旧日子的 —— 重排一次，顺手把天气也重新查了。
          if (this.st.phase === 'staying') await this.rebuildPlan(this.worldNow());
        }
        return this.uiSnapshot();
      }
      if (method === 'depart') {
        // 他按了「让她出发」。这里**不检查开关** —— 按钮只在开关打开时才出现，
        // 但真要绕过前端发这个请求也不该被静默吞掉：直接告诉他为什么不行。
        if (this.st.phase !== 'home') throw new Error('她已经在外面了');
        const now = this.worldNow();
        if (this.stillResting(now)) throw new Error('她还在休息，还没到能走的日子');
        await this.depart(now, true);
        // 出发可能因为「没有可去的地方」之类失败，把最新状态交回去让面板自己判断。
        return this.uiSnapshot();
      }
    }
    if (panel === 'album') {
      if (method === 'list') {
        const snap = this.uiSnapshot();
        // 把媒体目录一起带回去：相册页要显示它，用户才知道去哪个文件夹翻原图。
        return { photos: snap.photos, dir: snap.photoDir, error: snap.photoError };
      }
      if (method === 'shoot') {
        const api = this.cfg.imageApi.trim();
        if (!api) throw new Error('还没配生图接口');
        const city = this.cityOrNull(this.st.hereId);
        if (!city) throw new Error('现在不知道她在哪');
        const moment = localMoment(this.worldNow(), city.tz);
        const hour = Math.round(moment.decimal);
        /*
         * **等他拍完再回话。**
         *
         * 2026-11-01 之前这里是 `void` —— 点下去立刻返回「已排队」，然后
         * maybePhoto 里四个静默 return 一个都不吭声。用户那边看到的是
         * 「按下去没反应，日志没有，上游也没有请求」，只能猜。
         *
         * 顺带把诊断一起带回去：他没地方看这几个值，只能瞎猜。
         */
        const res = await this.maybePhoto(
          city, hour, moment.dateKey, this.spotNow(moment.decimal),
          this.plan?.weather ?? null,
          // 他点的是「补一张」，那就换一张，不判重。
          true,
        );
        return {
          ok: res.ok,
          reason: res.reason ?? null,
          diag: {
            api: this.safeApi(api),
            model: this.cfg.imageModel.trim() || '（用默认）',
            hasKey: Boolean(this.cfg.imageKey.trim()),
            localHour: hour,
          },
        };
      }
      throw new Error('未知的照片操作');
    }
    void args;
    throw new Error(`未知面板：${panel}`);
  }

  /** 面板那一份数据。**只搬，不算** —— 见 `ui.ts` 顶部。 */
  private uiSnapshot(): UiSnapshot {
    const now = this.worldNow();
    const here = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    const home = this.resolveHome().city;
    const moment = localMoment(now, here.tz);
    const mode: UiSnapshot['mode'] = this.st.phase;

    // 行程卡：只有真在路上才有。
    let leg: UiLeg | null = null;
    if (this.st.phase === 'traveling' && this.st.leg) {
      const L = this.st.leg;
      const { from, to } = citiesOf(L);
      const m = modeById(L.modeId);
      const leftHours = Math.max(0, (Date.parse(L.arriveAt) - now.getTime()) / 3_600_000);
      // 班次是算出来的（同线路同日固定），面板上跟出发事件里说的是同一趟车。
      const sched = from && to
        ? makeSchedule(L.modeId, from, to, localMoment(new Date(L.departedAt), from.tz).dateKey, L.km, L.durationWorldHours)
        : null;
      leg = {
        from: from?.name ?? L.fromId,
        to: to?.name ?? L.toId,
        mode: m?.name ?? L.modeId,
        code: scheduleText(L.modeId, sched),
        km: L.km,
        hours: L.durationWorldHours,
        progress: Math.round(Math.max(0, Math.min(1, progressOf(L, now))) * 100),
        left: remainText(leftHours),
        eta: hm(localMoment(new Date(L.arriveAt), to?.tz ?? here.tz).decimal),
      };
    }

    return {
      dateKey: moment.dateKey,
      clock: hm(moment.decimal),
      tzLabel: tzOffsetLabel(here.tz, now),
      mode,
      place: {
        id: here.id,
        name: here.name,
        region: here.region,
        tz: here.tz,
        lat: here.lat,
        lon: here.lon,
      },
      feeling: bodyFeeling(here, home),
      weather: this.plan ? weatherLine(this.plan.weather) : '',
      leg,
      lodging: this.st.phase === 'staying' && this.plan
        ? {
          kind: this.plan.lodging.kind,
          price: this.plan.lodging.price,
          name: this.plan.lodging.name ?? '',
          address: this.plan.lodging.address ?? '',
        }
        : null,
      sunrise: this.st.phase === 'staying'
        && this.plan?.sunriseHour !== null && this.plan?.sunriseHour !== undefined
        ? hm(this.plan.sunriseHour)
        : null,
      timeline: this.uiTimeline(moment.decimal, mode),
      trip: {
        days: this.st.tripStartedAt
          ? Math.max(1, Math.round((now.getTime() - Date.parse(this.st.tripStartedAt)) / 86_400_000))
          : 0,
        visited: this.st.everVisited.length,
        spent: this.st.spent,
        budget: this.cfg.budget,
        moneyOn: this.cfg.moneyEnabled,
      },
      diary: {
        dir: this.diary.current.dir,
        days: this.diary.count(),
        problem: this.diary.current.problem,
      },
      work: this.st.work
        ? {
          city: this.cityName(this.st.work.cityId),
          gig: this.st.work.gig,
          pay: this.st.work.pay,
          daysLeft: Math.max(0, Math.ceil((Date.parse(this.st.work.until) - now.getTime()) / 86_400_000)),
        }
        : null,
      photos: this.photos.list().slice(0, 60).map((p) => ({
        handle: p.handle, title: p.title, city: p.cityName, dateKey: p.dateKey,
        // 句柄形如 `log:ab12.jpg`，去掉前缀就是媒体库里的真实文件名。
        file: p.handle.replace(/^[a-z]+:/i, ''),
      })),
      /*
       * 照片字节在宿主的媒体库里，宿主没给「在资源管理器里打开」的 API。
       * 所以把目录直接摆出来 —— 用户复制这一行就能自己去翻。
       */
      photoDir: join(this.opts.dataDir, 'media'),
      photoError: this.photoError,
      music: (() => {
        const np = this.currentSong();
        return np ? { title: np.title, artist: np.artist } : null;
      })(),
      askBeforeDepart: this.cfg.askBeforeDepart,
      canDepart: this.st.phase === 'home' && !this.stillResting(now),
      restUntil: this.st.phase === 'home' && this.stillResting(now) && this.st.restingUntil
        ? this.st.restingUntil.slice(5, 10)
        : null,
      wishes: this.st.wishes.map((id) => this.cityName(id)),
      home: home.name,
      // 这一趟出发时的家；还没出发就是现在的家。
      tripHome: this.cityName(this.st.tripHomeId ?? this.st.homeId),
      homeChanged: !!this.st.tripHomeId && this.st.tripHomeId !== this.st.homeId,
      speed: this.speedNow(),
      clockDriftMs: this.clockDriftMs(),
      weatherOutOfRange: this.weather.outOfRange,
      guideSeen: this.uiStore.guideSeen,
      version: PKG_VERSION,
      feedbackEmail: this.cfg.feedbackEmail.trim(),
    };
  }

  /**
   * 「接下来会发生什么」。
   *
   * 这是这个面板**最值钱的一条**，也是和同类扩展最大的区别：
   * 它们告诉你「能不能用」，这里告诉你**她下一件事大概什么时候来**。
   *
   * 数据全部来自已有的作息表和行程，这里只排序、起名、截断。
   * 在路上的时候，第一项永远是「到站」—— 那一刻比任何作息节点都重要。
   */
  private uiTimeline(localNow: number, mode: UiSnapshot['mode']): UiTimelineItem[] {
    const out: UiTimelineItem[] = [];
    const here = this.cityOrNull(this.st.hereId);

    if (mode === 'traveling' && this.st.leg) {
      const L = this.st.leg;
      const { to } = citiesOf(L);
      out.push({
        at: hm(localMoment(new Date(L.arriveAt), to?.tz ?? here?.tz ?? 'Asia/Shanghai').decimal),
        what: `到${to?.name ?? L.toId}`,
        kind: 'arrive',
        past: false,
      });
      return out;
    }

    const plan = this.plan;
    if (!plan) return out;
    /*
     * 先放**刚过去的那一个**，灰掉。
     *
     * 时间轴只列未来的时候，看起来像一张待办清单；带上一条身后的，
     * 才像「今天已经走到这儿了」—— 用户扫一眼就知道她刚才在做什么。
     */
    const idx = plan.beats.findIndex((b) => b.at > localNow);
    const before = idx > 0 ? plan.beats[idx - 1] : null;
    if (before) out.push({ at: hm(before.at), what: before.what, kind: before.kind, past: true });
    for (const b of plan.beats.filter((b) => b.at > localNow).slice(0, 4)) {
      out.push({ at: hm(b.at), what: b.what, kind: b.kind, past: false });
    }
    return out;
  }
}

/* ---------------- 对外自描述 ---------------- */

/** 给市场卡片和诊断看的全量清单。`events` 必须与源码里 push 的类型一一对应。 */
export const JOURNEY_DESCRIBE = {
  tools: TOOL_DECLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    tags: [...t.tags],
    summary: t.summary,
  })),
  events: [
    {
      type: 'journey.depart',
      description: { zh: '动身了，说明去哪、坐什么、要走多久、路上会经过哪一带。', en: 'She set off: destination, mode, duration, and the region she passes through.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.arrive',
      description: { zh: '到站了，当地时间几点、这段走了多久、今晚住哪。', en: 'She arrived: local time, how long the leg took, where she stays tonight.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.day',
      description: { zh: '在目的地的第 N 天早上，附当天日出日落。', en: 'A new local day at the destination, with sunrise and sunset.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.beat',
      description: { zh: '当地的一个作息节点：起床、早饭、出门、午饭、回酒店、夜里。', en: 'A local beat: waking, meals, going out, back to the hotel, the evening.' },
      trigger: 'debounce' as const,
    },
    /*
     * 2026-11-01 补：这两条 describe.json 里一直有，运行时的表里没有。
     * 后果是每次拍照宿主都警告「事件 type 不在 describe.events 里，照常推送」——
     * 推是照推，但它意味着这张表没有被当成唯一来源，两边会越走越远。
     */
    {
      type: 'journey.photo',
      description: { zh: '她路上拍的一张风景照：只有景，没有她自己。附在事件后面。', en: 'A scenery photo she took on the road. Scenery only, never herself. Attached to the event.' },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.mishap',
      description: { zh: '小意外：坐过站了。到站时间顺延，不用用户出手。', en: 'A small mishap: she missed her stop. Arrival is pushed back; no action needed.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.road',
      description: {
        zh: '路上的一段：服务区、过站、餐车、甲板、夜里的车灯。四小时以内的行程不发。',
        en: 'A stretch on the road: a service area, a station passing by, the dining car, the deck, headlights at night. Not sent for trips under four hours.',
      },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.trouble',
      description: {
        zh: '稀有的麻烦（不到千分之一）：证件丢了、高反、车冻住、走错方向。她自己办不完，需要用户出手。',
        en: 'A rare trouble (under one in a thousand): lost papers, altitude sickness, a frozen car, the wrong road. She cannot handle it alone and needs the person to step in.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.work',
      description: {
        zh: '钱见底了，在当地找了份短工，或者干满收工。只在她填了预算、记账开着时才会出现。',
        en: 'Money ran low and she took a short job nearby, or finished it. Only happens when a budget is set and spending is tracked.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.home',
      description: { zh: '回家了，说清是待够了自己回来的，还是到了上限被迫回的。', en: 'She is home, saying whether the trip simply ended or hit the limit.' },
      trigger: 'flush' as const,
    },
  ],
};

/* ---------------- 文案：给事实，不给台词 ---------------- */

/**
 * 天气那一行。**只给体感和数字，不给天气播报。**
 *
 * 写「晴转多云，15~27℃」她会照着念；写「热，走两步就出汗」她才会说人话。
 * 查不到天气就返回空串 —— 不要写「天气未知」，那也是在念一个字段。
 */
/**
 * 一段正文压成一句摘要 —— 按月列目录时每天只占一行。
 *
 * 取到第一个句号为止，再按字数硬截：她一句话常常就二三十字，
 * 不截的话一个月的目录能有两千字，那就不是目录了。
 */
function gist(body: string, max = 34): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const first = flat.split(/[。！？.!?]/)[0] ?? flat;
  return first.length <= max ? first : `${first.slice(0, max)}…`;
}

function weatherLine(w: Forecast | null): string {
  if (!w) return '';
  const feel = feelOf(w);
  return `\n天气：${w.dayWeather}，${feel ? `夜里 ${w.nightTemp}℃，${feel}` : `夜里 ${w.nightTemp}℃`}。`;
}

function partWord(p: string): string {
  const map: Record<string, string> = {
    late: '后半夜', dawn: '天没亮', morning: '上午', noon: '中午',
    afternoon: '下午', evening: '傍晚', night: '夜里',
  };
  return map[p] ?? p;
}

/**
 * 路上那一段发生什么。
 *
 * **按交通方式写，不按城市写** —— 同样是二十五趴，在火车上和在船上完全是两回事。
 * 内容只给事实和数量，不给成句台词：写「可以说：这风吹得人想哭」，
 * 她就会连着三天念同一句。
 *
 * 夜里的节点会换一套说法 —— 半夜的服务区和下午的服务区，不是同一个地方。
 */
function roadText(
  modeId: string, idx: number, leg: Journey, from: City, to: City, hour: number, progress = 0,
): string {
  const night = hour >= 21 || hour < 6;
  // 按调用方给的真实进度算剩余，而不是拿 idx 反推 —— 短途只有一个节点（idx=1），
  // 反推出来的「还有三小时」和实际剩一小时会差得很远。
  const left = Math.max(0, Math.round(leg.durationWorldHours * (1 - progress)));
  const tail = left > 0 ? `还有大约 ${left} 小时。` : '';
  const route = `${from.name} → ${to.name}`;

  switch (modeId) {
    case 'car':
    case 'motorcycle':
      if (idx === 0) return night
        ? `服务区，加油。夜里只有两三家还开着，热食柜是空的。${route}，${tail}`
        : `服务区，加油。油价比出发时贵几毛，买了瓶水和一包饼干。${route}，${tail}`;
      if (idx === 1) return night
        ? `又在服务区停了一下，洗了把脸。镜子里眼睛是红的。${tail}`
        : `服务区吃饭。快餐窗口排了几个人，菜是温的。${tail}`;
      return night
        ? `还在开。路上只剩车灯，对面偶尔来一辆。腰开始酸。${tail}`
        : `天开始变了颜色。路边的牌子换成了一个没听过的地方名。${tail}`;

    case 'train':
      if (idx === 0) return night
        ? `过站，停了两分钟。站台上没人上车，广播念了一串站名。`
        : `过了一个大站，下去一批人，上来一批人。车厢里的口音变了。`;
      if (idx === 1) return night
        ? `车厢灯调暗了。邻座的呼吸声很匀，窗外只剩偶尔的一盏灯。${tail}`
        : `去餐车。盒饭三十块，米饭有点硬，汤是免费的。${tail}`;
      return night
        ? `醒了一次，不知道停在哪儿。看了看表，还能再睡一会儿。`
        : `窗外的地貌已经换了。刚才还是平原，现在开始有坡。${tail}`;

    case 'bus':
      if (idx === 0) return `中途停了一个站，上来几个人，行李塞在过道上。`;
      if (idx === 1) return night
        ? `服务区，二十分钟。下车的人都在抽烟，空气里全是那个味道。${tail}`
        : `服务区，二十分钟。买了碗泡面，蹲在花坛边上吃完。${tail}`;
      return night
        ? `车里只剩几盏小灯。有人打呼，司机没开广播。${tail}`
        : `快到了。前排的人开始收拾东西，有人站起来又坐下。${tail}`;

    case 'ship':
      if (idx === 0) return `出了港，岸上的灯缩成一条线。风比刚才大，站不太稳。`;
      if (idx === 1) return night
        ? `夜里在甲板上。水是黑的，船的声音从脚底下一直传上来。${tail}`
        : `船上吃饭。菜偏咸，米饭管够。窗外一直是同一个水平线。${tail}`;
      return night
        ? `天还没亮，甲板上已经有人在等。风冷得站不住。`
        : `快到岸了。能看见岸上的房子和一条上坡的路。${tail}`;

    case 'plane':
      if (idx === 0) return `起飞后平稳了。遮光板拉开，下面是云，什么也看不见。`;
      if (idx === 1) return `发餐。铝箔盒里的菜温的，面包是凉的。${tail}`;
      return `开始下降。耳朵有压力，咽了一下才好。窗外能看见地面了。${tail}`;

    case 'walk':
      if (idx === 0) return `走了四分之一。鞋里进了点土，坐在路边倒了倒。`;
      if (idx === 1) return `水喝掉一半。前面还是个坡，看不见顶。${tail}`;
      return night ? `天黑了，只能借着最后一点光走。` : `腿开始不听使唤，一步比一步慢。${tail}`;

    case 'bike':
    case 'scooter':
      if (idx === 0) return `停在路边歇了一会儿。手被风吹得发麻。`;
      if (idx === 1) return night
        ? `路灯一盏一盏过。电量掉得比预想快。${tail}`
        : `找了家小店买水。老板问去哪儿，说了个地名，他点点头。${tail}`;
      return `快到了。路边开始有人和房子。${tail}`;

    default:
      return `还在路上。${tail}`;
  }
}

/**
 * 把一个作息节点说成事实。
 *
 * **这里只写事实和数量，不写成句的台词。** 写「可以说：这风吹得人想哭」，
 * 她就会一字不差地念出来，连着三天都念同一句。
 */
/**
 * 巡礼那半句。**放在 `what` 之后单独拼，不并进去** —— `what` 是排程事实，
 * 这一句是「这地方还有另一个身份」，两件事分开她才分得清哪句能改哪句不能。
 */
/** 今天行程里挂得上作品的几处，一句话一条。没有就是空数组。 */
function todayPilgrimLines(plan: DayPlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of plan.beats) {
    if (b.kind !== 'activity' || !b.pilgrim) continue;
    if (seen.has(b.pilgrim.spot)) continue;
    seen.add(b.pilgrim.spot);
    out.push(pilgrimNote(b.pilgrim));
  }
  return out;
}

function pilgrimNote(p: Pilgrim): string {
  return `这地方也出现在：${p.works.map((w) => `《${w.title}》——${w.scene}`).join('；')}`;
}

function beatText(
  city: City, plan: DayPlan, kind: string, at: number, what: string, pilgrim?: Pilgrim,
): string {
  const head = `${city.name}，当地 ${fmtHour(at)}。`;
  // 统一在这里收句号，并压掉重复标点。
  //
  // 酒店的体感（`lodging.feel`）本身是整句、自带句号，拼上「价格」那句就会变成
  // 「…煮鸡蛋。。180 块一晚」。收尾只去一个还不够 —— 2026-10-31 实测在日记事件里
  // 真出现过双句号。所以先合并再收尾。
  const tidy = (body: string): string =>
    `${head}${body.replace(/。{2,}/g, '。').replace(/[。\s]+$/, '')}。`;

  switch (kind) {
    case 'sunrise':
      return tidy(`看日出，天还没全亮，人不多${plan.sunriseHour !== null ? `。当地日出 ${fmtHour(plan.sunriseHour)}` : ''}`);
    case 'hotel':
      // 酒店那句的 what 里已经写了房型和体感，这里只补价格，别再说一遍房型。
      return tidy(`${what}。${plan.lodging.price} 块一晚`);
    case 'sleep':
    case 'wake':
    case 'breakfast':
    case 'lunch':
    case 'dinner':
    case 'activity':
      return tidy(pilgrim ? `${what}。${pilgrimNote(pilgrim)}` : what);
    case 'night':
    case 'arrive':
    default:
      return tidy(what);
  }
}
