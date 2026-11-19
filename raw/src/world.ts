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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, TriggerMode, BlobInput, EventEnvelope, WorldLamp,
} from 'cortico/core/types.ts';
import { JOURNEY_ID, journeyConfigGroups, type JourneyConfigSection } from './config.ts';
import { cityByName, cityById, CITIES, terrainOf, type City } from './geo/cities.ts';
import { spotKindLine } from './geo/spot-profile.ts';
import { distanceKm } from './geo/distance.ts';
import { modeById, hoursFor, type ModeId, type TravelMode, type SeatGrade } from './geo/modes.ts';
import { localMoment, humanHours, localHour, shiftDateKey, tzOffsetLabel, utcFromLocal } from './clock.ts';
import { AmapWeather, feelOf, type Forecast } from './geo/amap.ts';
import { bodyFeeling, climateOfCity } from './geo/climate.ts';
import { bearingDeg } from './geo/distance.ts';
import { readNowPlaying, songLine, cityMentioned, type NowPlaying } from './music-peer.ts';
import { rollTrouble } from './easter.ts';
import { makeSchedule, scheduleText } from './plan/timetable.ts';
import { join, dirname, resolve } from 'node:path';
import { planDay, fmtHour, pickFood, CAR_TIERS, type DayPlan, type BeatKind } from './plan/dayplan.ts';
import { banterWith, bondWith, partWith, stayWith, travelWith } from './mate-talk.ts';
import type { Pilgrim } from './geo/pilgrim.ts';
import { actionsPrompt } from './pet-vocab.ts';
import { VersionCheck } from './version-check.ts';
import { AMAP_KEY_NAME, IMAGE_KEY_NAME, adoptKey, readKey, type KeyPorts } from './secrets.ts';
import {
  rollLodging, rerollLodging, withHotel, lodgingLabel,
  type Lodging, type LodgingWant,
} from './plan/lodging.ts';
import { HotelDirectory } from './geo/hotels.ts';
import { EateryDirectory } from './geo/eatery.ts';
import {
  pickDestination, pickMode, canTravel, usableModesFor, buildJourney, progressOf, remainingRealHours, citiesOf,
  beatMarks, beatKey, sentProgress, beatGapText, BEAT_GAP_DEFAULT, pickGrade,
  type Journey,
} from './plan/journey.ts';
import {
  slotOf, findNeighbors, neighborLine, knownNeighborLine, reportPresence,
  reportFootprint, reportSignpost, fetchStatus, paceGap,
  putCard, fetchCards, EMPTY_BOARD,
  putProfile, fetchProfiles, EMPTY_PROFILE_BOARD, normalizeMeetUrl, explainNet,
  sendInvite, listInvites, myTakenInvites, acceptInvite, inviteLine,
  type MeetOptions,
} from './meet.ts';
import { factsFor } from './geo/hotel-facts.ts';
import { nightIn } from './geo/cities.ts';
import { playLine } from './geo/city-play.ts';
import { hotelNightOptions, spotRideOptions } from './plan/leisure.ts';
import { StateStore, initialState, type TripState, type HomeReason, type Pledge, type Ask, type CarTier, type PlanPatch } from './state.ts';
import {
  PENDING_DIR, PENDING_WARN_FILES, PUBLIC_FILE, LIVE_FILE,
  readPending, settle, publicSnapshot, rideParagraph, parseLive,
  type LiveRide, type RideNotice,
} from './bridge.ts';
import { DiaryStore, type DiaryEntry } from './diary.ts';
import {
  TravelMemoryStore, metPet, setPetImpression, setTaste, tasteSummary, emptyTaste,
  TASTE_KINDS, warmWord, type PetsMap, type TasteKind,
} from './travel-memory.ts';
import {
  monthlyReport, monthTitle, citiesOfMonth,
  pickPosters, posterPrompt, yearlyHtml, type MonthlyPoster, type MonthlyPhoto, type MonthlyEntry,
  type YearlyTaste,
} from './monthly.ts';
import { shootPhoto, photoPrompt, photoTitle, spotFromBeat, skyOf, nightNegative, shotIsNight, imagePixelSize, type SkyView, type PhotoSubject } from './photo.ts';
import { shootComfy, parseSize } from './comfy.ts';
import { resolveImageBackend, presetDefaults } from './image-backend.ts';
import { cropBottom, WATERMARK_CROP_RATIO } from './png-crop.ts';
import { PhotoBook, type PhotoRecord } from './photo-book.ts';
import { PartyLog } from './party-log.ts';
import { UiStore, hm, remainText, type UiSnapshot, type UiTimelineItem, type UiLeg } from './ui.ts';

import {
  BOOT_GRACE_MS, STATUS_PROBE_MS, INVITE_NOTICE_PER_DAY,
  MISS_STOP_CHANCE, MISS_STOP_EXTRA_MIN, MISS_STOP_EXTRA_MAX,
  PLEDGE_TRAVEL_WINDOW_MS, MEET_WAIT_WINDOW_MS, ASK_TTL_MS, ASK_COOLDOWN_MS,
  ENV_PROMPT_FILE, PKG_VERSION, TICK_MAX_MS, TICK_WORLD_BUDGET_MS, TICK_MIN_MS,
  HEARTBEAT_MS, SEEN_SAVE_MS, REPORT_RETRY_MS, STAY_DAYS_MIN, STAY_DAYS_MAX,
  DECIDE_HOUR, STAY_ONE_MORE, GO_HOME_CHANCE, HOME_RADIUS_KM, NOW_TAIL,
  FARE_PER_KM, TRAIN_FAST, TRAIN_SLOW, MEALS_PER_DAY, TIGHT_THRESHOLD,
  PURSE_TIGHT, PURSE_LOW, PURSE_EMPTY, LOW_KM, WORK_DAYS, WORK_PAY_RATE,
  WORK_COST_RATE, MAX_WORK_STINTS, GIGS, SLOT_WORDS, NIGHT_CFG,
  POSTER_SIZE, MAKE_COVERS,
} from './constants.ts';
export * from './constants.ts';
import { TOOL_DECLS, JOURNEY_DESCRIBE } from './describe.ts';
export { TOOL_DECLS, JOURNEY_DESCRIBE };
import {
  decisionCrossedWhileAway, trainUnit, pick, seedOf, parseClock, parseSlotKind,
  slotClock, slotBrief, coverLine, whoOf, namesIn, impressionAsk, festivalCities,
  photoProtocolOf, shouldCropWatermark, gist, homeReasonText, weatherLine,
  partWord, seededRandom, modeIdOf, roadText, matchSpot, todayPilgrimLines,
  pilgrimNote, beatText,
} from './helpers.ts';
export * from './helpers.ts';

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
  /**
   * 宿主的密钥口子（`ctx.secret` / `ctx.storeSecret`）。见 `secrets.ts`。
   *
   * 可选：测试里没有宿主，不传时读取只认配置项、写入直接放弃 ——
   * 也就是「搬家这件事不发生」，绝不因此让 World 起不来。
   */
  keys?: KeyPorts;
  /** 把迁移结果写回配置（清掉已经搬进 .env 的那一份）。不传就只在内存里生效。 */
  persist?: (patch: { amapKey?: string; imageKey?: string }) => void;
}

import { socialMethods } from './world-social.ts';
import { photoMethods } from './world-photo.ts';
import { planMethods } from './world-plan.ts';
import { purseMethods } from './world-purse.ts';
import { webUiMethods } from './world-webui.ts';

export class JourneyWorld implements World {
  [key: string]: any;
  readonly id = JOURNEY_ID;

  private host: WorldHost | null = null;

  private log: Logger | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;

  private st: TripState;

  /**
   * 车费桥（2026-11-10）：这一轮巡检扫到、还没结算完的车费。
   *
   * **只在内存里。** `persist()` 投影公开快照时要用它，而 `persist()` 每轮被调几十次 ——
   * 如果那里去 `readdir`，等于把目录 IO 塞进写路径。所以扫描只在 `settleRides()` 里做一次，
   * 结果存这儿。正常情况下它是 0（扫完当场就结），只在结算出错的路径上有值。
   */
  private unsettledRideFare = 0;

  /** 首页卡的读取缓存。`ride-live.json` 一秒内问几次都只读一次盘（面板轮询很密）。 */
  private liveCache: { at: number; value: LiveRide | null } = { at: 0, value: null };

  private readonly store: StateStore;

  private readonly diary: DiaryStore;

  /** 跨设备那三样：去过、想去、花了多少。位置和路线不在这里，见 travel-memory.ts。 */
  private readonly travelMemory: TravelMemoryStore;

  private readonly weather: AmapWeather;

  /**
   * **在家那天的天气**（2026-11-17）。
   *
   * 原来天气只挂在 `rebuildPlan` 上，而排表只在「在别的城停留」或「抵达/赶路」时发生。
   * 回家之后一次都不查 —— `nowSummary` 里天气那行依赖 `plan?.weather`，plan 是 null，
   * 整行消失。于是「不填高德也有 Open-Meteo 兜底」这句话在家的场景下完全不成立：
   * 兜底没坏，是**压根没触发查询**。
   *
   * 家也是城（`resolveHome()`），也有经纬度，也配查天气。这个字段就是那一份。
   * 只为「今天」服务，日期一变就重查，跟排表的 plan 互不相干。
   */
  private homeWeather: { dateKey: string; cityId: string; w: Forecast | null } | null = null;
  /** 上一回家那边天气的真实时刻。半小时一查，别拿网络请求当心跳。 */
  private homeWeatherAt = 0;

  private readonly opts: JourneyWorldOptions;

  /** 照片簿：她拍过哪些张。只存句柄，字节在宿主媒体库。 */
  private readonly photos: PhotoBook;

  private readonly partyLog: PartyLog;

  /**
   * 版本对账（2026-11-08）。
   *
   * 面板要显示「她是哪一版、最新是哪一版」—— 报障时第一句话总是「我这是不是最新版」，
   * 两边都靠猜。查询放在 Core 这头，因为面板是个沙箱帧，发不了外面的请求。
   */
  private readonly versionCheck: VersionCheck;

  /**
   * 位置心跳（2026-11-10）。
   *
   * 上报原来只挂在三个时机上：启动、到站/重排日程、手动同步钟。于是**一条整天
   * 待在一个城里不动的鱼，池子里会看不见她**。2026-11-10 Mr.Q 问「我的鱼有两只，
   * 何来一只在线」—— 查下来他这台的记录停在昨晚，因为今早那次上报撞在服务端故障
   * 窗口里丢了，之后日程没重建，就再没第二次机会。
   *
   * 上报是 upsert（同一 uid + 日期 + 时段覆盖），心跳**不会让行数涨**，
   * 只多几次写入。这是「在线」这个词能不能成立的前提。
   */
  private heartTimer: ReturnType<typeof setInterval> | null = null;

  /** 连续上报失败次数。成功一次立刻归零。 */
  private reportFails = 0;
  /** 最近一次查碰面服务器是否连上：null = 未配或未查，true = 连上，false = 断连。 */
  public lastMeetOk: boolean | null = null;

  /** 失败后排的那一次重试。和心跳并存，谁先到谁报。 */
  private reportRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** 六小时对一次 npm 上的版本（2026-11-08）。 */
  private versionTimer: ReturnType<typeof setInterval> | null = null;

  /** 真酒店名（高德地点库）。查不到就只说类别。 */
  private readonly hotels: HotelDirectory;

  /** 真店名（高德地点库）。**只在她特意去吃时查** —— 平时报菜名就够了。 */
  private readonly eateries: EateryDirectory;

  /** 面板自己的小状态（引导看过没有）。和行程状态分开，互不影响。 */
  private readonly uiStore: UiStore;

  /**
   * 正在生图。
   *
   * 生图慢（十几秒到一分半），而巡检一分钟一次。没有这个闸，两次巡检都判定
   * 「今天还没拍」，就会同一张照片付两次钱。
   */
  private shooting = false;

  /** 「尺寸被抬到合规值」这类说明只说一遍。 */
  private imageSizeNoted = false;

  /**
   * 推过的 `senderKey`。**同一个 key 只许推一次**，见 `push()` 上的说明。
   *
   * 只放内存：重启后约定已经结清，不会重新走到「该散伙」那一步。
   */
  private pushedKeys = new Set<string>();

  /** 上一次生图的结果，给指示灯用。 */
  private photoOutcome: 'never' | 'ok' | 'fail' = 'never';

  /**
   * 上一次没拍成的人话原因。成功一次清空。
   *
   * 只写日志不够：2026-11-01 用户在相册点「补一张」，界面什么反应都没有
   * （那天已经有一张，被判重静默跳过），他只能以为按钮坏了。
   */
  private photoError: string | null = null;

  /** 出发地认不出来时那句话。启动时算一次，面板上显示出来。 */
  private homeProblem: string | null = null;

  /** 上一次看到的歌名。用来判断「换歌了」—— 同一个歌名不重复处理。 */
  private lastSongTitle: string | null = null;

  /** 当天的作息表。跨天重排；`staying` 之外为 null。 */
  private plan: DayPlan | null = null;

  /** 延后推第一次事件，避开 Core 的重启补投窗口（否则同一条会被投两遍）。 */
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  /** 巡检并发闸。见 `tick()` 里的说明 —— 少了它会重复推同一条事件。 */
  private ticking = false;

  /**
   * 这一轮巡检开始时算出来的「他离开了多久」（真实毫秒）。
   *
   * 只在 `tick()` 里算一次，`advanceBeats` 消费。用实例字段而不是参数，
   * 是因为 `advanceBeats` 从 `stayTick` 里调，那条链上的签名已经很深了。
   */
  private awayMs = 0;

  /**
   * 这一拍之所以「今天不判发车」，是因为**离线期间跨过了当地的决定点**（2026-11-15）。
   *
   * 为什么用实例字段而不是直接写进 `st.decidedOn`：
   * `stayTick` 的「新的一天」分支会把 `decidedOn` 一律重置成 `null`
   * （本意是「新的一天重新给一次决策机会」），写在它之前会被那一行当场覆盖掉。
   * 而 `awayMs` 到 `awayNote` 那一段就被清零了，等 `stayTick` 再读已经是 0。
   * 所以只在 `tick()` 里算一次、存在这儿，由「新的一天」那个分支去读。
   */
  private awayCrossedDecide = false;

  /** 上一次把 `lastSeenAt` 落进磁盘的真实毫秒。只用于节流，本身不落盘。 */
  private lastSeenSavedMs = 0;

  /**
   * 「碰面服务器」那一栏读不出来时，原因留在这儿（2026-11-13）。
   *
   * `meetOptions()` 返回 null 有两种情况：没填，和填了但读不成网址。
   * 这两种对用户的修法完全不同 —— 前者去填，后者去改 —— 所以不能都报「没配」。
   * 空串 = 没填或没问题。
   */
  private meetUrlError = '';

  /** 归一化时动过什么（补了 https:// 之类）。原样可用时为空。 */
  private meetUrlFixed = '';

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
    /*
     * 同行记录（2026-11-11）：只回答「我参与过哪几趟」，好让面板找回服务端那张卡。
     * 放在 dataDir 而不是 memoryDir —— uid 按机器分，卡也是按那个 uid 留的，
     * 换台机器本来就没有「我」这一半，同步过去只会多一批取不到的 id。
     */
    this.partyLog = new PartyLog(opts.dataDir);
    this.versionCheck = new VersionCheck({ dataDir: opts.dataDir, current: PKG_VERSION });
    /*
     * 密钥在构造时就要定一次：三个客户端都拿它当构造参数。
     * 这里**只读不搬** —— 搬那步在 `start()` 里，因为那儿才有 log 能说清搬没搬。
     * 读取本身已经是「.env 优先、配置兜底」，所以第一次跑的老用户照常能用。
     */
    const amapKey = readKey(opts.keys ?? {}, AMAP_KEY_NAME, opts.cfg.amapKey);
    this.hotels = new HotelDirectory(
      amapKey,
      join(opts.dataDir, 'poi-cache.json'),
      (level, msg) => (level === 'warn' ? this.log?.warn(msg) : this.log?.info(msg)),
    );
    /*
     * 店名和酒店各存一份缓存：一个是往哪儿睡，一个是往哪儿吃，
     * 缓存键也不同（酒店按城，吃饭按「城 + 想吃什么」）—— 混在一张表里查不干净。
     */
    this.eateries = new EateryDirectory(
      amapKey,
      join(opts.dataDir, 'eatery-cache.json'),
      (level, msg) => (level === 'warn' ? this.log?.warn(msg) : this.log?.info(msg)),
    );
    this.uiStore = new UiStore(opts.dataDir);
    this.weather = new AmapWeather(
      amapKey,
      join(opts.dataDir, 'weather-cache.json'),
      (level, msg) => (level === 'warn' ? this.log?.warn(msg) : this.log?.info(msg)),
    );
    this.st = initialState('lanzhou');
  }


  private get cfg(): JourneyConfigSection { return this.opts.cfg; }


  /** 高德密钥：`.env` 优先，配置兜底。见 `secrets.ts`。 */
  private amapKey(): string {
    return readKey(this.opts.keys ?? {}, AMAP_KEY_NAME, this.cfg.amapKey);
  }


  /** 生图密钥。同上。 */
  private imageKey(): string {
    return readKey(this.opts.keys ?? {}, IMAGE_KEY_NAME, this.cfg.imageKey);
  }


  /**
   * 把配置里的密钥搬进部署的 `.env`，然后清掉配置里那份（2026-11-13）。
   *
   * 为什么值得动：`config.json` 是给人看、给人备份、给人贴出来问的文件，
   * key 躺在里面等于每次求助都附带一份。宿主的 `storeSecret` 写的是
   * `botDir/.env`，0600、原子替换、不进任何配置接口。
   *
   * 放在 `start()` 而不是构造函数里，只为一件事：**这里才有 log**。
   * 设置页里的 key 突然空了，人得能在运行日志里看到「它被搬到哪儿去了」。
   */
  private adoptKeys(): void {
    const ports = this.opts.keys;
    if (!ports) return;

    const log = {
      info: (msg: string) => { this.log?.info(msg); },
      warn: (msg: string) => { this.log?.warn(msg); },
    };
    const nextAmap = adoptKey(ports, AMAP_KEY_NAME, this.cfg.amapKey, log);
    const nextImage = adoptKey(ports, IMAGE_KEY_NAME, this.cfg.imageKey, log);
    const patch: { amapKey?: string; imageKey?: string } = {};
    if (nextAmap !== this.cfg.amapKey) patch.amapKey = nextAmap;
    if (nextImage !== this.cfg.imageKey) patch.imageKey = nextImage;
    /*
     * 判「有没有要改的」必须用 `undefined`，不能用真假 ——
     * 搬成功时返回的就是空串，而空串是假值。用 `if (patch.amapKey)`
     * 就会把「清空这一动作」整个丢掉，key 留在 config.json 里，等于没搬。
     */
    if (patch.amapKey === undefined && patch.imageKey === undefined) return;

    /*
     * `cfg` 是活引用，改完设置页下一次读到的就是空；`persist` 才让它落进
     * `config.json` —— 不落盘的话重启一次 key 又回到配置里，等于白搬。
     */
    if (patch.amapKey !== undefined) this.cfg.amapKey = patch.amapKey;
    if (patch.imageKey !== undefined) this.cfg.imageKey = patch.imageKey;
    this.opts.persist?.(patch);

    // 三个客户端在构造时拿的是旧值，搬完要重新注入
    this.hotels.setKey(this.amapKey());
    this.eateries.setKey(this.amapKey());
    this.weather.setKey(this.amapKey());
  }


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
   * 她在不在睡 —— 读 life 广播的 `asleepUntil`（2026-11-15）。
   *
   * ## 三个边界
   *
   * 1. **用真实时间比**：`stayTick` 拿到的 `now` 是世界时钟，倍速下跑到未来，
   *    拿它比会一行代码就判成「早醒了」。
   * 2. **没有 life / 没有文件 / 格式坏了，一律当醒着**。判错的方向要是安全的：
   *    少睡一次只是她多走一天，反过来是「世界停在那里等她」。
   * 3. **只读不写**：`life-state.json` 和 `life-public.json` 都是她写的，
   *    这边碰一下就是双写。
   */
  private asleepUntil(): number {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      const t = Date.parse(String(raw?.asleepUntil ?? ''));
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }


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
      // 到家时刻也是这条时间轴上的一个点 —— 不挪的话，同步之后休息期会凭空变长或变短。
      homeAt: move(st.homeAt),
      // 待批单子和它的冷却也在同一条时间轴上，同一偏移量平移。
      ask: st.ask ? { ...st.ask, askedAt: move(st.ask.askedAt)! } : null,
      askNoAt: move(st.askNoAt),
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
    // 密钥搬家（#659 第二条）。要 log 就绪，所以放在这一句之后。
    this.adoptKeys();

    const home = this.resolveHome();
    /*
     * 出发地认不出来，要**说出来**。
     *
     * 2026-11-03 一位读者来信：「我尝试加了城市（常熟），发现城市里面没有这个城市，
     * 于是它默认设置成了兰州」。查下来：`resolveHome()` 早就准备好了这句话，
     * 但**没有一个调用点读过 `problem`** —— 全都只用 `.city`。
     * 结果是设置里写着常熟、面板上写着兰州，中间一句解释都没有。
     */
    if (home.problem) {
      host.log.warn(home.problem);
      this.homeProblem = home.problem;
    }
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
        // 到家时刻同理：家都换了，旧家的休息期没有意义。
        homeAt: atHome ? null : this.st.homeAt,
        // 待批的那张单子也一起作废：它问的是「从旧家出发去某地」，
        // 家都换了，再点「好」就是让她从新家走向一个旧计划。
        ask: atHome ? null : this.st.ask,
        askNoAt: atHome ? null : this.st.askNoAt,
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

    /*
     * 恢复当天作息表：重启不能把「今天已经排好的表」丢掉，否则会重推早上的事件。
     *
     * 位置上报放在 finally 里：2026-11-05 用户改了桌宠名字，管理面板上一直是旧的。
     * 查下来上报只挂在 `rebuildPlan` 末尾，排表一旦抛错（查酒店、查天气、拉邻居，
     * 任何一环），上报就跟着一起没了 —— 而且是静默的，`void reportPresence(...)`
     * 连返回值都没人看。位置和作息是两件事：排不出今天干什么，
     * 不代表别人不该知道她在哪。
     */
    try {
      if (this.st.phase === 'staying') await this.rebuildPlan(this.worldNow());
    } finally {
      await this.reportHere();
    }

    this.retimer();
    /*
     * 位置心跳：20 分钟一次。
     *
     * `reportHere()` 自己会判断 `phase !== 'staying'` 就返回 —— 在路上不报。
     * 这是有意的：presence 的主键带 city，跨城途中她没有「所在的城」，
     * 硬塞出发地或目的地会让邻居和邀约按错城市匹配。
     */
    this.heartTimer = setInterval(() => void this.reportHere(), HEARTBEAT_MS);
    this.heartTimer.unref?.();

    this.bootTimer = setTimeout(() => void this.tick(), 6000);
    this.bootTimer.unref?.();

    host.log.info(`大肥鱼环游世界已启动 v${PKG_VERSION}：${this.st.phase}，在 ${this.cityName(this.st.hereId)}，日记 ${this.diary.current.dir}`);
    /*
     * 顺手问一句 npm 上最新是哪一版。**不 await** —— 启动不该等一个网络请求；
     * 查不到就当不知道，面板只显示自己的版本。
     */
    /*
     * 用 `startupRefresh` 而不是 `refresh` —— 后者按 TTL 跳过，
     * 于是「下午查过、晚上发了新版」这种情况永远不提醒（2026-11-08 实测）。
     */
    void this.versionCheck.startupRefresh().then((v) => {
      /* 用 `this.log?.` 而不是闭包里的 `host` —— 这次查询可能在 stop() 之后才回来。 */
      if (v.outdated) this.log?.info(`有新版本：本机 ${v.current}，npm 上 ${v.latest}`);
    });
    /*
     * 之后每三小时对一次账（TTL 同一个值）。挂 `unref` ——
     * 这条定时器不该让进程活着，她哪天不跑了就该退出。
     */
    this.versionTimer = setInterval(() => { void this.versionCheck.refresh(); }, 3 * 3_600_000);
    this.versionTimer.unref?.();
  }


  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.heartTimer) clearInterval(this.heartTimer);
    if (this.reportRetryTimer) clearTimeout(this.reportRetryTimer);
    if (this.versionTimer) clearInterval(this.versionTimer);
    this.timer = null;
    this.bootTimer = null;
    this.heartTimer = null;
    this.reportRetryTimer = null;
    this.versionTimer = null;
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


  /** 这一段跨不跨国。票价按这个加价，所以要和 `fareOf` 一起看。 */
  private legCrossBorder(leg: Journey): boolean {
    const a = this.cityOrNull(leg.fromId);
    const b = this.cityOrNull(leg.toId);
    if (!a || !b) return false;
    return a.country !== b.country;
  }

  /**
   * 买票 —— **出发那一刻就付**（2026-11-16）。
   *
   * 原来在到站时结算，注释理由是「票是出发前买的，但花了多少到站才成事实」。
   * 那句话在没有改签的世界里自洽；加上退票就崩了 —— 旧票从没记过账，
   * 退的时候没得退，账面上只剩一笔凭空多出来的钱。
   *
   * 顺带修好一个老漏洞：她坐了一段被中途打断的腿（他叫回家、或者改签），
   * 到站结算永远等不到，这一趟的票钱就**从来没扣过**。
   *
   * 返回带 `fare` 的腿 —— 那张票的凭据，退票按它退。
   */
  private buyTicket(leg: Journey): Journey {
    // 取整之后才记账：`addSpent` 内部也会 `Math.round`，凭据必须等于**实扣的钱**，
    // 否则退票按未取整的价退，一趟改签能差出一块钱（2026-11-16 测试抓到 0.4）。
    const fare = Math.round(this.fareOfLeg(leg, this.legCrossBorder(leg)));
    if (fare > 0) this.addSpent(fare, '路费');
    return { ...leg, fare };
  }


  private cityName(id: string): string {
    return cityById(id)?.name ?? id;
  }


  private cityOrNull(id: string): City | null {
    return cityById(id);
  }


  /* ---------------- 池子总数 ---------------- */

  /** 最近一次取到的「今天池子里多少只」。见 `probeStatus`。 */
  private poolProbe: { at: number; value: number; taken: number } | null = null;


  /* ---------------- 巡检 ---------------- */

  /**
   * 家那边今天的天气（2026-11-17 加）。
   *
   * **只有 `phase === 'home'` 才走这条** —— 出门之后天气由当天的作息表带
   * （`plan.weather`），两边都查会多打一倍请求，而停留时那份还更准（按目的地的城）。
   *
   * 失败静默：查不到就是没有天气，她少一句「今天有点冷」，日子照过。
   * 不因为一个天气接口把巡检打成半瘫。
   */
  private async refreshHomeWeather(now: Date): Promise<void> {
    if (this.plan) return;
    const city = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    const m = localMoment(now, city.tz);
    /* 只有今天这一份且真的查到了（w 非空）才跳过；失败的 null 不锁死全天，3 分钟后可重试。 */
    if (this.homeWeather?.w && this.homeWeather.dateKey === m.dateKey && this.homeWeather.cityId === city.id) return;
    const realMs = this.realNow().getTime();
    const cooldown = this.homeWeather?.w === null ? 3 * 60_000 : 30 * 60_000;
    if (realMs - this.homeWeatherAt < cooldown) return;
    this.homeWeatherAt = realMs;
    this.weather.setKey(this.amapKey());
    const w = await this.weather.forecast(city, m.dateKey).catch(() => null);
    this.homeWeather = { dateKey: m.dateKey, cityId: city.id, w };
  }

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
      /*
       * **他离开了多久** —— 基准是**上一次巡检**（2026-11-13 改）。
       *
       * 原来拿 `lastTickAt`（「上一次她真的说过话」）当基准，而它只在触发这条提示时
       * 才写回，平时说话不写 —— 于是 `现在 − lastTickAt` 量的是**距上次触发多久**，
       * 不是他离开多久。表现就是每 6 小时准点报一次「你回来了」，人一直在电脑前。
       * 读者在 Discussion #586 报的正是这个，日志里四次触发间隔 6h00m03s–6h00m56s。
       *
       * 现在用 `lastSeenAt`：**这一轮巡检跑过就记一笔**，所以 Core 在跑时差值永远是
       * 几分钟；只有进程真的停摆（关掉应用、合盖休眠、被挂起）才会变大。
       * 停摆是我们唯一能诚实观测到的东西 —— 见 `state.ts` 里那段说明。
       *
       * 顺序要紧：**先按旧值算差值，再把这一轮记进去**，反了就永远是 0。
       */
      const realNowMs = this.realNow().getTime();
      const seenAt = this.st.lastSeenAt ? Date.parse(this.st.lastSeenAt) : Number.NaN;
      this.awayMs = Number.isFinite(seenAt) ? Math.max(0, realNowMs - seenAt) : 0;
      // 每拍重算，别让上一拍的结论漏到这一拍（见 `awayCrossedDecide` 的声明）。
      this.awayCrossedDecide = false;
      this.markSeen(realNowMs);
      const now = this.worldNow();
      /*
       * 车费结算放在**三个 phase 分支之前**。
       *
       * 三个分支各有 `return`，写进任何一支都会有另一支的人永远不结算 ——
       * 而「在家打个车」恰恰是最常见的场景。
       */
      this.settleRides();
      this.prunePledge(now);
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
      /*
       * **离线跨过了当天的发车决策点 —— 这一拍不补判。**（2026-11-15，用户来信）
       *
       * 反馈原样：她在大连第 3 天，12:17 刚查完 `journey_now`，12:18 说「大连才第三天，
       * 我还没待够」，同一分钟后台上车去了秦皇岛 —— 日志里写着「他离开了 13 小时」。
       *
       * 根因不是「发车不看日程」（日程和发车本来就是两套东西：一个是今天的作息，
       * 一个是这一站住几天）。根因是**决定权的时间归属错了**：发车判定属于
       * 「当地早上八点、她在场的那一拍」，而那 13 小时里没人做出这个决定。
       * 开机后补算，等于把「她不在时该发生的事」塞进她刚回来的这一分钟 ——
       * 于是她一边说没待够，后台一边买票，两句话自相矛盾。
       *
       * 做法只改一件事：跨过去了就是跨过去了，**今天不补判**。
       * 她照常过今天的日程，明天早上八点重新判 —— 想走的话明天还是走。
       * 不改状态机、不加持久化字段（`decidedOn` 本来就是这个语义：「这天已经判过了」），
       * 只在巡检里算一个当拍有效的标记，交给 `stayTick` 的新一天分支去读。
       *
       * **不动世界时间。** 锚回开机时刻看着更「合理」，实际会让她的人生断档：
       * 他关一晚电脑，她的世界就停一晚，那她已经过去的十三个小时成了假的。
       * 世界时间连续是这套东西的地基，问题从来不在时间会走，在于走的时候没人替她做决定。
       */
      if (this.st.phase === 'staying' && this.awayMs > 0) {
        const here = this.cityOrNull(this.st.hereId);
        const today = here ? localMoment(now, here.tz) : null;
        if (here && today && this.st.decidedOn !== today.dateKey) {
          const speed = Math.max(0.1, this.cfg.speed || 1);
          const before = new Date(now.getTime() - this.awayMs * speed);
          if (decisionCrossedWhileAway(before, now, here.tz)) {
            /*
             * 真正的落地在 `stayTick` 的「新的一天」分支 —— 那里决定 `decidedOn`
             * 是重置成 `null`（照常给一次机会）还是直接记成今天（今天不判）。
             * 这里只算、只说。为什么不能在这儿写：那一行会把值覆盖掉，
             * 而 `awayMs` 到下面 `awayNote` 就被清零了，等不到 `stayTick` 再来读。
             */
            this.awayCrossedDecide = true;
            this.log?.info(
              `离线 ${Math.round(this.awayMs / 60_000)} 分钟，跨过了当地 ${DECIDE_HOUR} 点的发车决策点`
              + ` —— 今天不补判，留在${here.name}。`,
            );
          }
        }
      }
      /*
       * **「你不在的这段时间」**（2026-11-11）。
       *
       * 放在 phase 分支之前：她可能在城里待着，也可能正在路上 —— 两种都要说，
       * 所以不能挂在 `advanceBeats`（只有 stay 会走到那儿）上。
       *
       * 推一条独立事件，不堆十条。旧版本那种「一起涌出来」是队列积压的副作用，
       * 不是设计；`world.ts` 开头写着为什么后来改掉了。
       *
       * 推完清掉 `awayMs` —— 一段离开只说一次。
       * `lastSeenAt` 不用在这儿动：上面 `markSeen()` 已经把它推到当前时刻了。
       */
      if (this.awayMs >= 6 * 3_600_000) {
        const note = this.awayNote();
        if (note) {
          const hours = Math.round(this.awayMs / 3_600_000);
          this.log?.info(`他离开了 ${hours} 小时，说一句这段时间的事。`);
          await this.push('journey.beat', `away-${hours}-${now.toISOString().slice(0, 13)}`, note, 'flush');
        }
        /*
         * 一段离开只说一次。`lastSeenAt` 在上面已经推到当前时刻了，
         * 这里只清内存值 —— 否则同一轮里后面再读一次 `awayMs` 还会当成离线。
         */
        this.awayMs = 0;
      }
      /*
       * 这里原来还有一段「`lastTickAt` 为空时补一个」——2026-11-13 删掉了。
       * 它的注释写着「下面这两个分支之外的路径也要记『她刚说过话』」，
       * 但代码只做了「从来没有时初始化」，从来没在她说真话时更新过 ——
       * 说明与实现不一致，正是那个「每 6 小时准点报一次」的直接来源。
       * 现在 `markSeen()` 每轮巡检都记，这一整块没有存在必要了。
       */

      /*
       * 池子总数：每次巡检都问一句（内部有 20 分钟缓存，绝大多数时候立刻返回）。
       *
       * 原来只在「不在城里停留」时才补 —— 因为 staying 那条路会由 `rebuildPlan` 顺带取。
       * 可那次取数是**当天第一次排表**时的事：一条鱼早上 6 点定了行程，`plan.pool` 就一直是 15，
       * 到了中午池子涨到 24 她还显示 15（2026-11-06 Mr.Q 两台机器一个 25 一个 15 就是这么来的）。
       */
      // 一个请求两样：池子总数 + 谁在找伴（60 分钟闸，绝大多数轮次立刻返回）。
      await this.probeStatus(now);

      /*
       * 家那边的天气（2026-11-17）。**放在 home 分支之前** —— 那一支里有好几处 `return`
       * （休息期、在睡），写进去就会被它们整段跳过，于是「她在家躺了三天没天气」。
       * 方法内部只在 `phase === 'home'` 时才真去查，别的 phase 立刻返回。
       */
      await this.refreshHomeWeather(now);

      if (this.st.phase === 'home') {
        if (this.stillResting(now)) return;
        /* 她在睡 —— 在家也不出门（也不弹「让我出门吧」），等醒了再说。 */
        if (this.asleepUntil() > this.realNow().getTime()) return;
        /*
         * 他开了「出门等点头」：她**不许自己走，但要开口问**。
         *
         * 原来这里只有一句 `return` —— 那条鱼从此再没动过，而且一句话都不说。
         * 开关的本意是「先问我」，不是「永远别走」；而「问」这个动作原来根本不存在，
         * 于是他看到的是「她在家躺了半个月」，只会以为扩展坏了。
         */
        if (this.cfg.askBeforeDepart) {
          await this.askToDepart(now);
          return;
        }
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


  /**
   * 这一趟的休息期到哪一刻结束。`null` = 没有休息期（不在家 / 天数为 0 / 老状态没记）。
   *
   * ## 为什么是算出来的，不是存下来的
   *
   * 2026-11-06 的一份 bug 报告（「逐光的光道虫」，v0.7.5）：
   *
   * > 「这个扩展在某次回来之后就定死了 11 月 7 号才能出发，间隔改 0 也没法让它手动出门」
   *
   * 查下来确实如此，而且比报告说的还硬一点 —— `restingUntil` 是**到家那一瞬**
   * 用当时的 `restDays` 算好、盖死在 `state.json` 里的。之后把「在家歇几天」
   * 改成 0，没有任何代码会去改它，而 `stillResting()` 是唯一判据：
   * 定时巡检被它挡、面板上「让她出发」也被它挡，用户点了只看到一句
   * 「她还在休息，还没到能走的日子」，而设置里明明写着 0。
   *
   * 现在改成派生值：**到家时刻 + 当前配置**。配置一改就生效，
   * 不需要去接「配置变更」那种容易漏掉一个入口的回调。
   *
   * `homeAt` 是 0.7.9 之后才有的字段；老状态没有它就退回那条盖章的记录，
   * 行为与升级前一致（不会因为升级就把人家的休息期清零）。
   */
  private restEndsAt(): Date | null {
    const days = Math.max(0, this.cfg.restDays);
    if (days <= 0) return null;
    const since = this.st.homeAt;
    if (since) {
      const t = Date.parse(since);
      if (Number.isFinite(t)) return new Date(t + days * 86_400_000);
    }
    const until = this.st.restingUntil;
    if (!until) return null;
    const u = Date.parse(until);
    return Number.isFinite(u) ? new Date(u) : null;
  }


  private stillResting(now: Date): boolean {
    const end = this.restEndsAt();
    return !!end && now.getTime() < end.getTime();
  }


  /**
   * 休息期到哪天，按**她那边的**日期算（`11-07`）。
   *
   * 原来面板显示的是 `restingUntil.slice(5, 10)` —— 那是 UTC 日期。
   * 宁波 UTC+8、晚上八点以后到家的话，UTC 已经跨到前一天，面板会少说一天。
   */
  private restDayLabel(): string | null {
    const end = this.restEndsAt();
    if (!end) return null;
    const tz = this.cityOrNull(this.st.hereId)?.tz ?? this.resolveHome().city.tz;
    return localMoment(end, tz).dateKey.slice(5);
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


  private async depart(
    now: Date,
    manual = false,
    /**
     * 明确指定的目的地 / 交通方式（`journey_go_to` 传进来）。
     *
     * 不传就是老样子：她自己挑去哪、掷骰子决定怎么去。
     * 传了就不许被 `pickDestination` / `pickMode` 覆盖 —— 用户点名要坐高铁，
     * 结果安排她蹬自行车，就是这个反馈的原始现场。
     */
    opts: { to?: City; mode?: TravelMode } = {},
  ): Promise<void> {
    if (!manual) {
      // **刚加载完先待一会儿。**
      //
      // 不挡的话，World 一被挂上就出发：用户装好扩展、改完配置重启、甚至只是重启了
      // Coopani，抬眼看到的都是「她已经走了」。宽限不是休息期，只是「别在我刚按下
      // 那个按钮的下一秒就消失」。
      if (this.realNow().getTime() - this.bootedAt < BOOT_GRACE_MS) return;

      // 在家出发也要挑个像样的钟点。休息期到点的那一刻就是出发的时刻，
      // 而休息期 = 到家的时刻 + 休息天数（`restEndsAt`），所以**上次几点到家，
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
    let to: City;
    let km: number;
    /*
     * **手上有一份还没到期的约定，就去那座城。**
     *
     * 2026-11-06 加的。原来只有「接了邀约那一瞬间正好在城里、由 `moveOn` 带走」
     * 这一条路能兑现约定；而 `journey_accept` 现在允许**在家**接（见那里的说明），
     * 从家出发走的是这个 `depart` —— 没有这一条，她会答应人家去成都，
     * 第二天早上却按自己的口味去了乌鲁木齐，而且没有任何一处报错。
     */
    const pledged = opts.to ? null : this.activePledge(now);
    /*
     * 赴约的第一段是**见面城**，不是最终那座城（2026-11-07）。
     * 原来直接取 `pledged.cityId` —— 加了见面城之后，那等于跳过会合点直奔目的地，
     * 「一起走」就成了各走各的。
     */
    const pledgedCity = pledged ? cityById(this.pledgeStop(pledged)) : null;
    if (opts.to) {
      to = opts.to;
      km = Math.round(distanceKm(from, to));
    } else if (pledgedCity) {
      to = pledgedCity;
      km = Math.round(distanceKm(from, pledgedCity));
      this.log?.info(`手上有约：往${pledgedCity.name}走（${this.whoOfPledge(pledged!)}）。`);
    } else {
      const picked = this.pickNextLeg(from);
      if (!picked) {
        this.log?.warn('没有可去的地方，这一趟不出发。');
        return;
      }
      to = picked.city;
      km = picked.km;
    }
    const mode = opts.mode
      // 约定里点过走法就照它 —— 那是他自己说的「买机票吧」，不该被掷骰子盖掉。
      // 他这次又点了名（`opts.to`）但没再说方式时，`pledged` 是 null，要靠 `pledgeFor` 找回来。
      ?? this.pledgedMode(pledged ?? this.pledgeFor(to), from, to, km)
      ?? pickMode(from, to, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km, 0.5, from.country !== to.country, { from, to }), !this.cfg.hasLicense, this.effectiveLifeEnergy());
    if (!mode) {
      /*
       * **「没有可用交通方式」和「买不起」是两件事，原来都说成前一句。**
       *
       * 2026-11-05 的 money 档抓到一条：`兰州 → 迪拜 没有可用交通方式，换一个目的地`。
       * 迪拜有机场、飞机飞得到 —— 真实原因是余钱只够这一趟的一半，买不起那张票。
       * 级别也不该是 warn：路是通的，只是今天不走，明天钱够了就走。
       * 写成 warn，日志里会跟「城市表里根本没有路」这种真问题混在一起。
       */
      if (!canTravel(from, to)) {
        this.log?.warn(`${from.name} → ${to.name} 没有可用交通方式，换一个目的地。`);
      } else {
        this.log?.info(`买不起去${to.name}的票（${km} 公里），这一轮不出发。`);
      }
      return;
    }

    const grade = this.pickSeatFor(mode.id, km, this.legCrossBorder({ fromId: from.id, toId: to.id } as Journey));
    const leg = this.buyTicket(buildJourney({ from, to, mode, km, at: now, speed: this.speedNow(), grade }));
    // 记下这一趟是从哪个家出发的 —— 用户途中改家时，面板要靠它说清「人没跟家一起搬」。
    this.st = { ...this.st, tripHomeId: home.id };
    /*
     * **自驾 = 这趟有车了**（2026-11-06）。
     *
     * 用户来信：「如果是自驾那么这次全程应该都是自驾，去景点也是自驾」。
     * 所以车不是「一段路的交通方式」，是跟着她走的东西 —— 记进 state，
     * 之后每天排日程时（`planDay` 的 `car`）就开车去景点，油钱按公里。
     *
     * 从家出发开的是自己的车（不花钱）；在外面出发要租 —— 日租 200，
     * 按三天算一笔，还车时不该退的那部分就当折旧。
     */
    if (mode.id === 'car' && !this.st.car) {
      const fromHome = from.id === home.id;
      const fuel: 'oil' | 'ev' = Math.random() < 0.4 ? 'ev' : 'oil';
      if (!fromHome && this.cfg.moneyEnabled) {
        this.addSpent(600);
      }
      this.st = { ...this.st, car: { fuel, days: fromHome ? 0 : 3, km: 0 } };
    }
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
      // 人都离开这座城了，昨天宣布的那一趟自然作废。
      announceDepartOn: null,
      announceCityId: null,
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
      /*
       * 事件正文不用「她」自称（2026-11-16 读者报告，见 world-photo.ts 的 journey.photo）。
       * 这条事件经 external_event_frame 投递，那一区的语义是「别人的话」——
       * 里面出现「她」，模型会拿它当第三方，同一段 reasoning 里人称来回跳。
       */
      `出发了。${from.name}当地 ${fmtHour(departLocal.decimal)}，`
      + `${from.name} → ${to.name}，${how}，直线约 ${leg.km} 公里，`
      + `这一趟要走 ${humanHours(leg.durationWorldHours)}${viaText}。`
      + `\n${mode.feel}`
      + `\n（${to.name}那边这会儿是 ${this.localClock(now, to)}。到了自然就知道。）`
      /*
       * **一起去的那一趟，车上不止一个人。**（2026-11-07 Mr.Q）
       *
       * 判据：已经跟人在见面城碰上了（`meetArrivedAt` 有值）、还没到约定的目的地
       * （`arrivedAt` 为空）、而且这一趟正是从见面城出发的。三条缺一条都不说 ——
       * 人还没见着就说「挨着坐」，那是替她编。
       */
      + (this.st.pledge && !this.st.pledge.arrivedAt && this.st.pledge.meetCityId === from.id
        && this.st.pledge.meetArrivedAt
          ? `\n${travelWith(this.whoOfPledge(this.st.pledge), mode.name, seedOf(`${leg.id}|go`), this.warmthOf(this.st.pledge))}`
          : '')
      + songLine(this.currentSong()),
      'flush',
    );
  }


  /* ---------------- 等他点头 ---------------- */

  /**
   * 想出门，但开关要求先问 —— 那就问。
   *
   * ## 为什么必须落成一条可见的东西
   *
   * 「征求意见」如果只在她脑子里，用户永远不知道她在等。所以这里做的是
   * **写一张待批单**（`st.ask`）+ 推一条消息。面板读到这张单，就在「她此刻」
   * 顶上画一张卡片和两个按钮（好 / 不好）。
   *
   * ## 三个不变量
   *
   * 1. **同一时刻只有一张单。** 已经有了就不重复问 —— 催第二遍不叫礼貌。
   * 2. **问出去的东西会过期。** 挂过 20 小时就当作没人答，进冷却，不常驻面板。
   * 3. **被回绝之后要冷一天。** 否则下一轮巡检立刻重问，还问同一座城。
   */
  private async askToDepart(now: Date): Promise<void> {
    const cur = this.st.ask;
    if (cur) {
      const age = now.getTime() - Date.parse(cur.askedAt);
      if (Number.isFinite(age) && age < ASK_TTL_MS) return;
      // 过期 = 一直没人理。按被回绝处理：清单、进冷却，别在面板上留一块化石。
      this.st = { ...this.st, ask: null, askNoAt: now.toISOString() };
      this.persist();
      this.log?.info('她问的那件事一直没回音，按没人答处理。');
      return;
    }
    if (this.st.askNoAt) {
      const since = now.getTime() - Date.parse(this.st.askNoAt);
      if (Number.isFinite(since) && since < ASK_COOLDOWN_MS) return;
    }

    const from = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    /*
     * 只在她那边的**白天**问。
     *
     * 凌晨三点弹一张「让我出门吧」的卡片，对他来说是打扰，对她来说是没常识。
     * 挡住的这一轮直接 return，下一轮巡检自然等到早上 —— 和 `depart` 那个
     * 7–21 点的窗口是同一个道理，只是这里连问都不该在半夜问。
     */
    const hour = localMoment(now, from.tz).decimal;
    if (hour < 7 || hour >= 21) return;

    /*
     * **手上有约定，问的就是约定的那一站**（2026-11-12，Discussion #586）。
     *
     * 原来这里无条件 `pickNextLeg` —— 她约好了去 B，面板却推来一座系统自己挑的 C。
     * 他一点「好」，`answerAsk` 把 C 当指定目的地传进 `depart`，
     * 而 `depart` 第一行是 `opts.to ? null : activePledge()`：**约定被整个丢掉**。
     *
     * 用户看到的就是「约好了人，上了车却去了别处，到了只能自己慢慢找」。
     * `depart` 自己那条路（不传 `to`）一直是认约定的，漏的只有「等点头」这一支。
     */
    const pledged = this.activePledge(now);
    const pledgedCity = pledged ? cityById(this.pledgeStop(pledged)) : null;
    const picked = pledgedCity
      ? { city: pledgedCity, km: Math.round(distanceKm(from, pledgedCity)) }
      : this.pickNextLeg(from);
    if (!picked) {
      this.log?.warn('没有可去的地方，这一轮连问都不用问。');
      return;
    }

    const ask: Ask = {
      kind: 'depart',
      cityId: picked.city.id,
      days: null,
      inviteId: null,
      withPet: null,
      note: null,
      askedAt: now.toISOString(),
    };
    this.st = { ...this.st, ask };
    this.persist();

    /* 赴约和「想出门」不是一件事，措辞分开 —— 他要批的也不一样。 */
    const why = pledged
      ? `要去赴约（跟${this.whoOfPledge(pledged)}约在${this.cityName(this.pledgeStop(pledged))}）`
      : '想出门';
    await this.push(
      'journey.ask',
      `ask-${ask.askedAt}`,
      `${why}，在等他点头：从${from.name}去${picked.city.name}，直线约 ${picked.km} 公里。`
      + '\n（他开了「出门等点头」，所以她不会自己走。面板上那张卡片有两个按钮。）',
      'flush',
    );
    this.log?.info(`问了一句能不能去${picked.city.name}，等回答。`);
  }


  /**
   * 他答了。`true` = 好，`false` = 不好。
   *
   * 这是面板上那两个按钮唯一的入口 —— 不是工具，因为**这个判断该由他做**，
   * 不该让模型替他点。答「好」之后走 `manual`，跳过出门窗口和加载宽限：
   * 他按下去的那一秒，就是「现在走」的意思。
   */
  private async answerAsk(ok: boolean): Promise<void> {
    const a = this.st.ask;
    if (!a) return;
    const now = this.worldNow();

    if (!ok) {
      this.st = { ...this.st, ask: null, askNoAt: now.toISOString() };
      this.persist();
      const where = this.cityName(a.cityId);
      await this.push(
        'journey.ask',
        `ask-no-${a.askedAt}`,
        `他答了「不好」：${where}这一趟先不去。`
        + '\n（不是被拒绝，是这会儿不走。过一天她可能还会再问一次，也可能换个地方问。）',
        'flush',
      );
      return;
    }

    this.st = { ...this.st, ask: null, askNoAt: null };
    this.persist();

    if (a.kind === 'depart') {
      const city = cityById(a.cityId);
      if (!city) {
        this.log?.warn(`他说好，但「${a.cityId}」认不出来，这一趟走不成。`);
        return;
      }
      await this.depart(now, true, { to: city });
      return;
    }
    // 接别人的邀约：真的去服务端接下，接完照样立刻往那座城走。
    if (a.inviteId) await this.takeInvite(a.inviteId, true);
  }


  /**
   * 她下一步会去哪。**纯判断，不改状态。**
   *
   * 抽出来是因为有两个调用点：真的出发（`depart`），和「问他想不想让我走」
   * （`askToDepart`）。两处各写一份参数，迟早会漂 —— 到时候她问的是成都、
   * 点「好」之后却去了西宁，用户会以为是按钮坏了。
   */
  private pickNextLeg(from: City): { city: City; km: number } | null {
    return pickDestination({
      from,
      visited: this.st.everVisited,
      wishes: this.st.wishes,
      heading: this.st.heading,
      lastKm: this.st.lastKm,
      home: this.resolveHome().city,
      maxKm: this.nearOnly() ? Math.min(LOW_KM, this.purseRangeKm()) : this.purseRangeKm(),
      // 「再来一次」的两个理由：这一个月的节，和上回没逛完。
      unfinishedIds: this.st.unfinished,
      festivalIds: festivalCities(Number(localMoment(this.worldNow(), from.tz).dateKey.slice(5, 7))),
    });
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
      `坐过站了。本来该在${to?.name ?? leg.toId}下车，一走神没留意，反应过来车已经开了。`
      + `
只能在下一站下来再折回去，到站顺延 ${extra} 分钟 —— 自己也觉得丢人，但这事谁都碰上过。`
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
    /*
     * 文案只有三段（早 / 中 / 晚），节点数最多六个 —— 所以归一化：
     * 第一个算早段，最后一个算晚段，中间全算中段。
     * 「还在路上」本来就该重复，不需要给每段单独写词。
     */
    const idx = marks.length === 1 ? 1
      : due === 0 ? 0
      : due === marks.length - 1 ? 2
      : 1;
    // 只在中间那个节点提歌 —— 每个节点都挂一句就成了报幕。
    const song = idx === 1 ? songLine(this.currentSong()) : '';
    // 剩余时间按**真实进度**算，不再用 idx 反推（短途用 idx=1 反推会差一截）。
    const text = roadText(mode.id, idx, leg, from, to, hour, p) + song;
    await this.push('journey.road', `road-${key}`, text, 'debounce');

    /*
     * 路上也拍一张。
     *
     * 2026-11-03 一位读者来信：「生成的图片一直都是几个出发的城市中的图片，
     * 不会显示火车、乡间的照片」—— 因为拍照只挂在「出去逛」那个节点上。
     *
     * 只在中段拍（`idx === 1`）：一次行程最多一张，不然长途会连拍好几张。
     * 不 await —— 生图要十几秒，等它会把后面该推的节点全推迟。
     */
    if (idx === 1) {
      void this.maybePhoto(
        to, hour, localMoment(now, to.tz).dateKey, '', null, false, true, mode.name,
      );
    }
  }


  private applyLegArrivalToLife(leg: Journey, tz: string): void {
    const fitnessDelta = leg.modeId === 'walk'
      ? Math.min(3, Math.max(1, Math.round(leg.km / 12)))
      : leg.modeId === 'bike'
        ? Math.min(2.5, Math.max(0.8, Math.round(leg.km / 40)))
        : 0;

    const depMs = Date.parse(leg.departedAt);
    const arrMs = Date.parse(leg.arriveAt);
    let overnight = false;
    if (Number.isFinite(depMs) && Number.isFinite(arrMs) && arrMs - depMs >= 6 * 3_600_000) {
      for (let t = depMs + 3_600_000; t < arrMs; t += 3_600_000) {
        const h = localMoment(new Date(t), tz).hour;
        if (h >= 0 && h < 5) { overnight = true; break; }
      }
    }

    let vitalsDelta: Partial<Record<'food' | 'energy' | 'clean' | 'fun' | 'social', number>> | undefined;
    let moodlet: { text: string; kind: 'good' | 'bad'; hours: number } | undefined;
    if (overnight) {
      const g = leg.grade?.id ?? '';
      if (leg.modeId === 'bus' && g === 'sleeper-bus') {
        vitalsDelta = { energy: -8 };
        moodlet = { text: '卧铺大巴窄得翻不了身，睡得不算踏实', kind: 'bad', hours: 4 };
      } else if (leg.modeId === 'bus' && g === 'comfort') {
        vitalsDelta = { energy: -12 };
        moodlet = { text: '长途大巴航空座靠着睡了一宿，有点乏', kind: 'bad', hours: 4 };
      } else if (leg.modeId === 'bus') {
        vitalsDelta = { energy: -18 };
        moodlet = { text: '大巴硬坐了一宿，腰背发僵', kind: 'bad', hours: 5 };
      } else if (leg.modeId === 'train' && g === 'second') {
        vitalsDelta = { energy: -14 };
        moodlet = { text: '火车二等座熬了一夜，脖子有点酸', kind: 'bad', hours: 4 };
      } else if (leg.modeId === 'train' && g === 'first') {
        vitalsDelta = { energy: -8 };
      } else if (leg.modeId === 'train' && g === 'hard-sleeper') {
        vitalsDelta = { energy: -5 };
      } else if (leg.modeId === 'train' && g === 'deluxe-sleeper') {
        vitalsDelta = { energy: 6, clean: 10 };
        moodlet = { text: '高级软卧独立间睡了个安稳觉，下车神清气爽', kind: 'good', hours: 4 };
      } else if (leg.modeId === 'plane' && g === 'economy') {
        vitalsDelta = { energy: -10 };
        moodlet = { text: '红眼经济舱没怎么睡好，有点困倦', kind: 'bad', hours: 4 };
      } else if (leg.modeId === 'plane' && g === 'business-class') {
        vitalsDelta = { energy: 4 };
        moodlet = { text: '公务舱平躺睡了一觉，下飞机精神不错', kind: 'good', hours: 4 };
      } else if (leg.modeId === 'ship') {
        vitalsDelta = { energy: -3 };
      }
    }

    if (fitnessDelta > 0 || vitalsDelta || moodlet) {
      this.queueLifeEffect(`抵达（${leg.modeId}）`, {
        ...(fitnessDelta > 0 ? { fitnessDelta } : {}),
        ...(vitalsDelta ? { vitalsDelta } : {}),
        ...(moodlet ? { moodlet } : {}),
      });
    }
  }

  private async arrive(now: Date, leg: Journey): Promise<void> {
    const { to } = citiesOf(leg);
    if (!to) {
      this.st = { ...this.st, phase: 'home', leg: null };
      this.persist();
      return;
    }
    const moment = localMoment(now, to.tz);
    this.applyLegArrivalToLife(leg, to.tz);
    const speed = this.speedNow();
    // 必须在更新 state 之前判「以前来过没有」—— 更新之后 everVisited 里一定有它。
    const beenBefore = this.st.everVisited.includes(to.id);

    const fromCity = this.cityOrNull(leg.fromId);
    /*
     * 赴约的那一趟到了没有。
     *
     * `arrivedAt` 从这一刻起算「待几天」—— 接下邀约之后可能还坐了两天车，
     * 那两天不该算进「一起待的三天」。到了别的地方就把约定清掉：
     * 那是她半路改了主意，硬留着只会在 `journey_now` 里挂一句做不到的话。
     */
    const pledgeOf = this.st.pledge;
    /*
     * **落地这座城可能是见面城，也可能是一起走的那座**（2026-11-07）。
     *
     * 原来只有一种判据（`cityId === to.id`），加了见面城之后它会把每一次
     * 「到成都碰头」都判成「走岔了，约定作废」—— 而且是一条不报错的作废。
     */
    const atDest = pledgeOf && pledgeOf.cityId === to.id ? pledgeOf : null;
    const atMeet = pledgeOf && pledgeOf.meetCityId === to.id && pledgeOf.cityId !== to.id
      ? pledgeOf
      : null;
    const pledged = atDest ?? atMeet;
    const stray = pledgeOf && !atDest && !atMeet ? pledgeOf : null;
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
      /*
       * 到见面城只记 `meetArrivedAt`，**不动 `arrivedAt`** ——
       * 「一起待 N 天」从到了一起走的那座城才开始算，
       * 在成都等的那三天不该被算进「在稻城待的三天」。
       */
      pledge: atDest
        ? { ...atDest, arrivedAt: atDest.arrivedAt ?? now.toISOString() }
        : atMeet
          ? { ...atMeet, meetArrivedAt: atMeet.meetArrivedAt ?? now.toISOString() }
          : null,
    };
    /*
     * 到站这一笔（2026-11-08）：到见面城不算，**真的一起走到了才算**。
     * 熟络度只在这一刻涨 —— 「约好了但没见成」不该算关系。
     *
     * 2026-11-11 改成**按人逐个记**。原来传的是 `whoOfPledge(...)`，
     * 那是一个给人看的拼接串（「小满、小汐、阿澈」）：
     * 单人时凑巧等于人名，看不出问题；三个人一起走到站，记忆里会多出一个
     * 叫这串名字的假人，而真正的三个人一个都没记上。见 `namesIn`。
     */
    if (atDest) for (const who of namesIn(atDest)) this.rememberPet(who, 6);
    /*
     * **约定作废必须说出来**（2026-11-16 读者报告）。
     * 原来只有一行 `log.info` —— 面板照旧挂着那句话，模型也当她还在守约，
     * 直到下一次她跟人提起才发现那趟早没了。用户看不到日志，等于静默丢约定。
     */
    if (stray) {
      const gone = this.cityName(stray.cityId);
      this.log?.info(`到了${to.name}，手上那份去${gone}的约定作废。`);
      await this.push(
        'journey.pledge',
        `pledge-stray-${stray.inviteId}`,
        `到了${to.name}，和${this.whoOfPledge(stray)}约好去${gone}那趟作废了。`,
        'debounce',
      );
    }
    await this.rebuildPlan(now, 'arrival', moment.decimal, to);
    /*
     * 票钱**在出发时已经付了**（`buyTicket`，2026-11-16）。
     *
     * 这里只剩一种情况要动账：**老存档**。`fare` 是这一版才有的字段，
     * 升级前就上路的那条腿没有它 —— 不补的话，那一趟等于白坐。
     * 判据只能是 `leg.fare === undefined`，不能用 `0`：走路、骑车的票钱真是 0，
     * 那样会在每次免费走一程时都判成「老数据」，然后按算式补扣一笔不该有的钱。
     *
     * 算式必须和 `fareOf` 一致（座位档一起算）—— 原来这里自己乘一遍单价，
     * 从改价那天起就和「买不买得起」用的数不一样了。
     */
    if (leg.fare === undefined) {
      this.addSpent(this.fareOfLeg(leg, this.legCrossBorder(leg)), '路费');
    }
    // 到了 = 那个念头兑现了，从「想去」里划掉。
    if (this.st.wishes.includes(to.id)) {
      this.st = { ...this.st, wishes: this.st.wishes.filter((x) => x !== to.id) };
    }
    this.persist();

    /*
     * 足迹：到站才记一笔（2026-11-14）。
     *
     * 本地那份是 `everVisited`（城市 id 数组），只在这台机器上；
     * 这一笔是云端备份 —— 换电脑、清缓存之后，她还认得自己走过的地方。
     *
     * **不 await、不重试**：这是履历，不是行程的一部分。让它挡住行程推进，
     * 一次网络抖动就会把她卡在站台上；而失败了下次到站还会再记。
     */
    void reportFootprint(this.meetOptions(), to.id);

    /*
     * 到站那一刻就把「这一带还有谁」说出来，不等第二天早上那句 `journey.day`。
     *
     * 2026-11-05 Mr.Q：「新功能从哪看？我找不到啊」。原来同城信息只在排当天表的正文里带一句，
     * 而到站这一条才是用户**真的会读**的那一条 —— 落地、放下包、看一眼四周。
     * 上面几行的 `rebuildPlan` 已经跑过了，邻居和同城邀约都在 `this.plan` 里，不用额外请求。
     */
    const social = [
      neighborLine(this.plan?.neighbors ?? []),
      /*
       * 熟面孔（2026-11-11）。邮件原话：「散了就是真的散了 —— 没有人知道下次
       * 在哪个城市还能撞见谁」。原来这条链是这样的：记忆里明明存着
       * 「跟小满走过 2 次 / 熟络度 18 / 印象『话不多，但半夜肯陪我找药店』」，
       * 到站那一刻却说「小满也在这儿」，跟对陌生人一模一样。
       *
       * 只挂到站这一条，不挂每日事件 —— 理由见 `knownNeighborLine` 的注释。
       */
      knownNeighborLine(this.plan?.neighbors ?? [], this.st.pets ?? {}),
      inviteLine(this.plan?.invites ?? []),
    ].filter(Boolean).join('\n');

    await this.push(
      'journey.arrive',
      `arrive-${leg.id}`,
      `到了。${to.name}，当地 ${fmtHour(moment.decimal)}。`
      + `这一趟 ${leg.km} 公里走了 ${humanHours(leg.durationWorldHours)}。`
      + `${beenBefore ? '这地方以前来过，' : ''}${bodyFeeling(to, this.resolveHome().city)}`
      /*
       * 赴约到了：这一趟不是随便来的，得说出来是冲着谁来的。
       *
       * 两个阶段分开说（2026-11-07）：到了见面城是「等人」，到了目的地才是「一起过」。
       * 用同一句话会让她在成都就说「我们要在这儿待三天」—— 而那是稻城的事。
       */
      + (atDest
        ? `\n这是跟${this.whoOfPledge(atDest)}说好一起来的地方，` + `在这儿待 ${atDest.days} 天。`
        : atMeet
          // 上面几行的 `rebuildPlan` 已经把同城邻居拉过了，直接用手上这份，不再多问一次服务端。
          ? (() => {
              const mates = (atMeet.withPets ?? [atMeet.withPet]).map((x) => x.trim());
              const who = (this.plan?.neighbors ?? [])
                .filter((n) => mates.includes(n.pet.trim())).map((n) => this.nameOf(n.pet));
              return `\n到${to.name}了 —— 跟${this.whoOfPledge(atMeet)}约在这儿碰头，`
                + (who.length
                  ? `人已经在城里了（${who.join('、')}），待会儿碰上了就一起往${this.cityName(atMeet.cityId)}走。`
                  : `人还没露面。先在这儿等着，等到了一起去${this.cityName(atMeet.cityId)}。`);
            })()
          : '')
      + `\n今晚住：${this.plan ? lodgingLabel(this.plan.lodging) : '还没定'}。`
      /*
       * 一起住店：同一家店，但不是同一间房。
       *
       * 只写「房间关系」—— 酒店本身已经由 `lodgingLabel` 说了，
       * 这里再描述一遍房型就是重复，而重复会让用户觉得是模板。
       */
      + (atDest ? stayWith(this.whoOfPledge(atDest), seedOf(`${leg.id}|stay`), this.warmthOf(atDest)) : '')
      + weatherLine(this.plan?.weather ?? null)
      + (social ? `\n${social}` : '')
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
      /*
       * 房钱 + 饭钱 + **今天在城里的车钱**（2026-11-06）。
       *
       * 市内交通那几块钱原来根本没进账 —— 公交两块、地铁四块，
       * 一天两趟也就十来块，但那是她真的花掉的钱。不记就是白坐。
       */
      const dailyCost = (this.plan?.lodging.price ?? 0)
        + MEALS_PER_DAY
        + (this.plan?.commute.price ?? 0)
        + (this.plan?.extras.price ?? 0);
      this.addSpent(this.st.work ? Math.round(dailyCost * WORK_COST_RATE) : dailyCost, '住宿和三餐');
      // 还在打工就先结今天的工钱，再谈省不省 —— 顺序反了会算成「穷到换房」.
      if (this.st.work) this.earn(this.st.work.pay);
      // 钱紧的时候**换一家**。原来 `rebuildPlan` 里是 `this.plan?.lodging ?? roll()`，
      // 只要 plan 还在就永远复用第一天的房型 —— 结果预算早超了还在住「这几天最贵的一间」。
      // 正常情况不换（一个地方住几天本来就该是同一家），只有紧了才重新掷。
      if (this.isTight()) this.plan = null;
      /*
       * 租的车走一天（2026-11-06）。
       *
       * `days` 这个字段从 0.7.22 就写在 state 里，**却从来没被读过** ——
       * 「租三天」永远不到期，等于异地出发那 600 块买了个无限期。
       * 现在它真的会走：自己的车 `days === 0`（不递减），租的车到期自动还。
       *
       * 还车要**说出来**。静默清掉的话，她第二天会发现城里几个点突然要走过去，
       * 而手上没有任何解释 —— 到时候只能编一个。
       */
      let carBack = '';
      if (this.st.car && this.st.car.days > 0) {
        const left = this.st.car.days - 1;
        if (left > 0) {
          this.st = { ...this.st, car: { ...this.st.car, days: left } };
        } else {
          carBack = `租的车到期了，还回去。在${here.name}城里接下来靠公交和两条腿`
            + '（想再开就说一声，再去租）。';
          this.st = { ...this.st, car: null };
        }
      }
      this.st = {
        ...this.st,
        stayDateKey: moment.dateKey,
        lastBeatKey: null,
        /*
         * 新的一天重新给一次决策机会 —— **除非这一天是在他关机的时候过去的**。
         * 那种情况这个决定点已经不在了，补判等于「开机即发车」，
         * 而她那会儿正在说「我还没待够」。判据见 `tick()` 里的 `awayCrossedDecide`。
         */
        decidedOn: (this.awayCrossedDecide && !this.st.work) ? moment.dateKey : null,
      };
      await this.rebuildPlan(now, 'full', 0, here);
      this.persist();
      if (carBack) {
        await this.push(
          'journey.car',
          `car-return-${moment.dateKey}-${here.id}`,
          carBack,
          'flush',
        );
      }
      /*
       * 这几天是不是跟人一起过（2026-11-06 加）。
       *
       * 原来只有到达那一条说「跟XX说好来的，待 N 天」，之后的 `journey.day`
       * 一个字不提 —— 于是那 N 天里她真的会忘。Mr.Q 的原话：「日记肯定要体现啊」，
       * 而她写日记时手上没有任何「今天和谁在一起」的事实，只能写风景。
       *
       * 只在 `arrivedAt` 有值（人已经到了）且城对得上时说。人还在路上说这句
       * 就是替她提前见面。
       */
      const mate = this.mateLine(this.st.pledge, here.id, stayDays);

      await this.push(
        'journey.day',
        `day-${moment.dateKey}-${here.id}`,
        /*
         * **带上时刻**（2026-11-07）。
         *
         * 原来只写「当地 2026-11-07」，不说几点。而 `journey.day` 是在当地
         * 刚过零点那一刻推的 —— 用户那边可能还是 23:5x，她看到日期突然变成
         * 第二天，只能拿上下文里的旧时间去对，于是得出「日期跳了」的错觉，
         * 甚至怀疑时区（Mr.Q 当天就问「时区出问题了？」）。
         *
         * 宿主**不给她当前时间**（`/api/prompts/prefix` 里没有任何时间戳），
         * 所以这条事件是她唯一的机会。
         */
        `${here.name}的第 ${stayDays + 1} 天，当地 ${moment.dateKey}`
        + `${moment.decimal < 0.2 ? '，刚过零点' : `，${fmtHour(moment.decimal)}`}。`
        // 一起过的那几天：每天提一次，别指望她记得一周前那条到达通知。
        + (mate ? `\n${mate}` : '')
        // 这一带还有谁。没有就是空串，不占地方。
        + (neighborLine(this.plan?.neighbors ?? []) ?? '')
        + (inviteLine(this.plan?.invites ?? []) ?? '')
        + (this.plan?.sunriseHour !== null && this.plan?.sunriseHour !== undefined
          ? `日出 ${fmtHour(this.plan.sunriseHour)}，日落 ${fmtHour(this.plan.sunsetHour ?? 0)}。`
          : '这一带今天没有正常的日出日落。'),
        'flush',
      );
      return;
    }

    // 决策点：当地早上八点到九点之间，一天只决定一次。
    // 放在早饭之后，这样「今天走不走」是在吃过饭、喘过气之后才想的。
    if (moment.decimal >= DECIDE_HOUR && this.st.decidedOn !== moment.dateKey) {
      /*
       * **她在睡 —— 今天不决定。**（2026-11-15 Mr.Q：「睡眠时禁止 journey 的出发」）
       *
       * ## 位置：`decidedOn` 赋值**之前**
       *
       * 第一版写在 `if (this.st.work)` 前面，看着也对，但端到端一跑就露馅：
       * 那句话在 `decidedOn = 今天` **之后**，于是她睡着那天把「今天已经判过」
       * 白白写掉了 —— 醒来当天再也走不了，要白等一整天。
       *
       * 端到端实测（`/tmp/e2e-sleep.mjs`）：睡着时 `decidedOn` 被置成当天，
       * 八小时后窗口清空、再 tick，人还在原地，`announceDepartOn` 是 null。
       *
       * 现在的顺序：先问她醒着没有，醒着才占今天的决策额度。
       *
       * 为什么不是放进 `moveOn()`：那只拦得住「出发」，拦不住「睡着还在打工」。
       */
      if (this.asleepUntil() > this.realNow().getTime()) return;

      this.st = { ...this.st, decidedOn: moment.dateKey };
      this.persist();
      const startedDaysAgo = this.st.tripStartedAt
        ? (now.getTime() - Date.parse(this.st.tripStartedAt)) / 86_400_000
        : 0;
      // 按周算：一周七天，和设置项的单位对上（2026-11-04 由「月」改成「周」）。
      const overWeeks = startedDaysAgo / 7 >= this.cfg.maxTripWeeks;
      const stayDays = this.stayDaysSoFar(now);

      /*
       * 打工期间：今天不走。到点了才收工。
       *
       * **顺序挪到「回家路上」之前了**（2026-11-15）。
       *
       * 原来写在后面，理由是「回家的路要一路走到底，不会在半路停下来打工」。
       * 可 Mr.Q 那天定的是「钱不够你坐大巴也行，打工也行，瞬移也太出戏了」——
       * 不让打工，回程买不起票就只有两条假路：瞬移，或者钉在原地每天试一次。
       * 后者更糟：钱一分不涨，她会在同一座城里一直「准备回家」。
       *
       * 现在回程也会停一天打工，挣到路费再走。工钱还没结的时候谁都别放她走。
       */
      if (this.st.work) {
        if (now.getTime() >= Date.parse(this.st.work.until)) await this.endWork(now, here);
        return;
      }

      // 回家路上：走得更急。每站住一晚就走，不看「待够没有」——
      // 赶路的人不会在途经的城市住三天。这个状态**不受出门月数限制**，
      // 否则到期那一刻会直接弹回家，前面走的几站全白算。
      if (this.st.returning) {
        /*
         * 回程走完 —— 但「当初为什么回」是几天前定的事，得从 `returnReason` 里捞。
         * 走到家这一刻手上已经没有这个信息，不留这一笔就一律算成「待够了」。
         */
        if (stayDays >= 1) await this.goHome(now, here, this.st.returnReason ?? 'called');
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
          // 打过这么多次工还是见底 —— 这是「撑不下去」，不是「待够了」。
          await this.goHome(now, here, 'broke');
          return;
        }
        await this.startWork(now, here);
        return;
      }

      const stayedLongEnough = stayDays >= STAY_DAYS_MIN
        && (stayDays >= STAY_DAYS_MAX || Math.random() > STAY_ONE_MORE);

      /*
       * 手上有一份答应了要去的约定。
       *
       * 两件事：**还没到就动身**，**到了就按天数待着**。
       * 待满之后直接走人 —— 不走 `stayedLongEnough` 那套随机：
       * 约定了三天就是三天，第三天早上收拾东西，这件事本身没有掷骰子的余地。
       */
      const pledge = this.activePledge(now);
      if (pledge) {
        /*
         * **在见面城等人**（2026-11-07，Mr.Q：「继续等」）。
         *
         * 判据是「同城今天有没有他们」—— 这个系统里两个人之间没有消息通道，
         * 只有「谁在哪座城」这张表。看见了就一起走，看不见就再等一天。
         *
         * 放在「动身」那一支**之前**：不然她到了成都当天就会往下走，
         * 所谓「见面」就只是路过。
         *
         * 等不下去的那一头交给 `MEET_WAIT_WINDOW_MS` + `prunePledge`：
         * 三天见不着人，算这趟没成，她自己接着走（并且说出为什么）。
         */
        if (pledge.meetCityId && !pledge.arrivedAt && pledge.meetArrivedAt) {
          const mates = await this.matesHere(pledge, here, now);
          if (!mates.names.length) {
            /*
             * **查不成和没人要分开说**（2026-11-17，zzy1053 报的）。
             *
             * 原来这两种情况返回的东西一模一样，他 11-16 全天断连，
             * 早上那次判定被当成「人没露面」—— 他自己翻日志都分不出来。
             * 现在至少日志里留一句，用户按时间对得上。
             */
            if (!mates.ok) {
              this.log?.warn(`在${here.name}没查成碰面名单（碰面服务器连不上），今天先不动。`);
            }
            return;   // 人还没露面（或者没查成），今天不动
          }
          this.log?.info(`在${here.name}见着${mates.names.join('、')}了，一起往${this.cityName(pledge.cityId)}走。`);
          await this.moveOn(now, here);
          return;
        }
        if (here.id !== this.pledgeStop(pledge)) {
          // `moveOn` 会把目的地定成约定的下一站，这里只负责「今天该动身了」。
          await this.moveOn(now, here);
          return;
        }
        if (this.pledgeDone(now, pledge)) {
          /*
           * 天数满了：走。**约定先不清** —— 交给 `moveOn` 在真正动身那一刻结掉，
           * 出发那句话才说得出「跟谁说好的几天到了」。
           * 买不起票走不成时它还在，明天接着试。
           */
          /*
           * **散伙要单独说一句**（2026-11-12）。
           *
           * 原来这件事只藏在 `journey.depart` 的一句从句里（「跟某某说好的 3 天到了，动身」）——
           * 说完就上车了，听上去像「合同到期」，不像「跟人道别」。
           * Mr.Q：「旅游完了再解散……怎么从来没见过」。
           *
           * 放在 `moveOn` **之前**：那一刻 `pledge` 还在，说得出跟谁；
           * 进了 `moveOn` 它就结掉了，之后再想说话手里已经没人名。
           */
          await this.push(
            'journey.part',
            `part-${pledge.inviteId}-${pledge.arrivedAt}`,
            `跟${this.whoOfPledge(pledge)}在${here.name}待满 ${pledge.days} 天，今天各走各的。`
            + `\n${partWith(this.whoOfPledge(pledge), seedOf(`${pledge.inviteId}|part`), this.warmthOf(pledge))}`
            + `\n（这一段到此为止 —— 接下来自己往下走，对方走对方的。）`,
            'flush',
          );
          /*
           * 约守完了，但出门已经到上限 —— **直接往回走，不再挑下一站。**
           *
           * 2026-11-15 Mr.Q 定的顺序：「守完这趟约再不去下个地方，直接往回赶。」
           * 所以这里不走 `moveOn(afterPledge)`（那是「接着玩下一站」），
           * 而是交给 `goHome('limit')` 收尾。
           */
          if (overWeeks) {
            await this.goHome(now, here, 'limit');
            return;
          }
          await this.moveOn(now, here, { afterPledge: pledge });
          return;
        }
        // 天数没满：今天不走，等它满。
        return;
      }

      /*
       * 出门到上限了 —— **但排在赴约之后**。
       *
       * 2026-11-15 Mr.Q 定的顺序：「在外面接了别人的约，我设的时间到了，
       * 也该以守约为准，守完这趟再往回赶。」
       *
       * 原来这条压在赴约之前，于是她 13:17 在佛山住下、13:18 就被上限掐回家，
       * 顺手把还在进行中的约定作废 —— 房钱白花，约也没守成。
       *
       * 没有约的时候它仍然是硬上限：一触发就回家，和「回家路上」同一个性质。
       */
      if (overWeeks) {
        await this.goHome(now, here, 'limit');
        return;
      }

      /*
       * **昨天说好的那一趟：今天执行，不再掷骰子。**（2026-11-15）
       *
       * 说了就走。否则「宣布」成了空话 —— 她会在同一座城里天天宣布、天天不走，
       * 用户看到的是一句永远不兑现的预告，比原来更难受。
       *
       * 放在「待够没有」之前：这一趟昨天已经判过了，今天只是履行。
       * 也放在回家那两支之前：说好了去 X，第二天不能改口回家。
       */
      if (this.st.announceDepartOn) {
        const dest = this.st.announceCityId ? this.cityOrNull(this.st.announceCityId) : null;
        this.st = { ...this.st, announceDepartOn: null, announceCityId: null };
        await this.moveOn(now, here, dest ? { to: dest } : {});
        return;
      }

      if (stayedLongEnough && Math.random() < GO_HOME_CHANCE) {
        await this.goHome(now, here, 'done');
        return;
      }
      if (stayedLongEnough) {
        /*
         * 掷中了，但**今天不走** —— 先说一句，明天早上再动身。
         * 用户来信里那句「她没有被问过，也没有机会说不」，改的就是这一行。
         */
        await this.announceDepart(now, here);
        return;
      }
    }

    if (!this.plan || this.plan.dateKey !== moment.dateKey) await this.rebuildPlan(now, 'full', 0, here);
    await this.advanceBeats(now, here, moment.decimal, moment.dateKey);
  }


  /* ---------------- 回家 / 换地方 ---------------- */

  /**
   * 让他把她叫回来。**面板按钮和聊天里的「回来吧」共用这一段。**
   *
   * **2026-11-15 改：叫回来是当场买票飞回，不再一站一站走。**
   *
   * Mr.Q：「叫回也应该是当场坐飞机回来（钱不够允许她借钱，回来报销）。」
   * 跟另外三种收场不是一回事 —— 上限、钱、待够都是她自己的节奏，走回去是给她留一段路；
   * 被叫回来是「有人在等」，路上不该再耗几天。
   *
   * 打工中途叫回来：工先撂下。工钱是按天结过的，不会少，只是没干满。
   */
  private async beginReturn(now: Date): Promise<{ ok: boolean; text: string }> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { ok: false, text: '不知道她此刻在哪，叫不回来' };
    if (this.st.phase === 'home') return { ok: false, text: '她已经在家了' };
    if (this.st.returning) return { ok: false, text: '她已经在往回走了' };
    const home = this.resolveHome().city;
    const km = Math.round(distanceKm(here, home));
    if (this.st.work) this.st = { ...this.st, work: null };
    /*
     * 他叫她回来，那份约定就得让位。
     *
     * 不意味着「答应了的事可以不算」—— 是他开口了，那比一个陌生人的邀约重要。
     * 留着它只会在面板上挂一句永远做不到的话，而 `moveOn` 在回程时本来也不看它。
     */
    if (this.st.pledge) {
      this.dropPledge(now, `你叫我回来，跟${this.whoOfPledge(this.st.pledge)}说好的那趟只能算了。`);
    }
    /*
     * 记下「是他叫回来的」。回家要走几天，走到家那天靠这一笔才知道原因 ——
     * 不留它，回程最后那次 `goHome` 只能按「待够了」记，日记里就成了她自己想回来。
     */
    this.st = { ...this.st, returnReason: 'called' };
    await this.goHome(now, here, 'called');
    /*
     * 两种结果，回执要分开说。
     *
     * 一般是「往回走」——一站一站来。但**有些地方走不出去**：海岛、边远城市，
     * 出岛只有飞机、而钱又不让坐飞机， 选不出路就会兜底直接到家。
     * 那种情况下还说「往回走了」，第二天他一看她在兰州，会觉得这个按钮在骗人。
     */
    if (this.st.phase === 'home') {
      return { ok: true, text: `好，回${home.name}了。这一趟到这儿。` };
    }
    return { ok: true, text: `好，往回走了。现在在${here.name}，离家 ${km} 公里。` };
  }


  private async goHome(now: Date, from: City, reason: HomeReason): Promise<void> {
    const home = this.resolveHome().city;
    const km = distanceKm(from, home);

    /*
     * **回家这件事压过一切约定。**
     *
     * 不管是待够了、到上限、钱撑不住还是他叫回来，人只要开始往回走，
     * 那份「答应了去某地」的安排就不成立了。不清掉的话，`journey_now` 会在
     * 回程那一路上挂着「答应了小满去拉萨，还没到」—— 她照着念，用户当场就穿帮。
     */
    if (this.st.pledge) {
      const name = this.cityName(this.st.pledge.cityId);
      // 走 `dropPledge` 而不是直接清 —— 它负责给对岸留那句话（2026-11-15）。
      this.dropPledge(now, `开始往回走了，去${name}那趟去不成了。`);
    }

    /*
     * **他叫她回来 —— 当场买最近一班飞回，不走回程。**（2026-11-15）
     *
     * Mr.Q：「叫回也应该是当场坐飞机回来（钱不够允许她借钱，回来报销）。」
     *
     * 「钱不够也飞」现在的落法是**不传 `afford`**：票照买。
     * 真正的欠账要等「life 与 journey 共用一本账」的口径定下来才写得进去，
     * 这一版只保证这一趟飞得回来 —— 别让她因为差两百块滞留在一千公里外。
     */
    if (reason === 'called') {
      if (this.st.car) this.st = { ...this.st, car: null };
      /*
       * **方式也一起定下来，别让 `settleHome` 再掷一次骰子**（2026-11-18，用户报的）。
       *
       * 原来这里只传了 `flyRegardless: true` —— 那只免票价，不管方式。
       * 于是「有人等着」的场景可能抽到轮渡/大巴，和她「他叫回 = 当天航班」的规则打架。
       */
      const fast = this.fastHomeLeg(from, home, km);
      await this.settleHome(now, from, reason, km, {
        flyRegardless: true,
        ...(fast ? { mode: fast.mode, modeLabel: fast.label } : {}),
      });
      return;
    }

    // 进了同城范围（六十公里内）才算到家，收尾这一趟。
    if (km < HOME_RADIUS_KM) {
      // 到家就还车/停车：这趟结束了，车不该跟着进屋。
      if (this.st.car) this.st = { ...this.st, car: null };
      await this.settleHome(now, from, reason, km);
      return;
    }

    /*
     * **回家一律走路上，不再有「一步到家」。**（2026-11-15 Mr.Q 定）
     *
     * 原来这里有一条捷径：买得起直达票（票钱不超过余钱八成）就当场 `settleHome`，
     * `hereId` 一步改成家。它的理由是 2026-11-03 那句「全部都走回去也太费事了」——
     * 站站挪确实啰嗦。
     *
     * 但那条路在用户眼里是**瞬移**：13:17 还在佛山订房，13:18 就已经在兰州家里，
     * 中间没有一段路、没有一晚、没有一句话。原话：
     * 「直接坐飞机往回赶都行，钱不够你坐大巴也行，打工也行，瞬移也太出戏了。」
     *
     * 所以现在只留一条：`returning = true`，一步一步朝家走。
     * 快慢交给 `pickMode` —— 钱够就坐飞机，钱紧就降级，买不起就地打工（见 `moveOn`）。
     * **坐飞机也是「一段路」，不是传送。**
     */
    this.st = { ...this.st, returning: true };
    this.persist();
    this.log?.info(`决定回家了，还差 ${Math.round(km)} 公里，一路往回走。`);
    await this.moveOn(now, from, { toward: home });
  }


  /** 真正到家：结掉这一趟，进休息期。 */
  /**
   * **他叫回来的这一趟坐什么**（2026-11-18，用户报的）。
   *
   * `goHome('called')` 的注释写的是「当场买最近一班飞回」，但 `flyRegardless` 只免了票价 ——
   * 交通方式仍由 `pickMode` 从 `usableModes` 里加权随机。于是 189 公里从苏州回兰州
   * （苏州 `air: false` 没有机场、`port: true` 有港口）掷中了慢速档，
   * 和她的规则「他叫回 = 当天航班，落地就是家」直接矛盾 —— 她在思考记录里专门停下来
   * 处理了这个龃龉，那段推理对用户是不可见的成本。
   *
   * 叫回的场景是「有人在等」，不该让她在路上再耗几天：**短途高铁，长途飞机**。
   *
   * 两种都不可用（无铁路、无机场）才返回 null，让调用方回退到原来的权重表 ——
   * **不能为了文案好看把她困在某座城里**。
   */
  private fastHomeLeg(from: City, to: City, km: number): { mode: TravelMode; label: string } | null {
    const pool = usableModesFor(from, to, km);
    const train = pool.find((m) => m.id === 'train');
    const plane = pool.find((m) => m.id === 'plane');
    if (km <= 1200 && train) return { mode: train, label: '高铁' };
    if (plane) return { mode: plane, label: '飞机' };
    if (train) return { mode: train, label: '高铁' };
    return null;
  }

  private async settleHome(
    now: Date,
    from: City,
    reason: HomeReason,
    km: number,
    opts: { flyRegardless?: boolean; mode?: TravelMode; modeLabel?: string } = {},
  ): Promise<void> {
    const home = this.resolveHome().city;
    // 回家这一趟是一次性支出，钱的上限放宽到八成（`goHome` 已经先判过一遍）。
    // `flyRegardless` = 被叫回来：票钱不够也照买（这一版还没落欠账，见 `goHome`）。
    const picked = opts.mode ?? (km < 30 ? null : pickMode(
      from, home, km, Math.random, this.isTight(), this.noFly(),
      opts.flyRegardless
        ? undefined
        : this.affordMode(km, 0.8, from.country !== home.country, { from, to: home }),
      !this.cfg.hasLicense,
      this.effectiveLifeEnergy(),
    ));
    /*
     * 叫回时调用方会给「高铁 / 飞机」这种更紧的说法（见 `fastHomeLeg`）。
     *
     * 直接盖在 `name` 上，下面所有文案（事件、日记、`journey_now`）自动跟着走 ——
     * 不用每一处再判断一次是什么场景。
     */
    const mode = picked && opts.modeLabel ? { ...picked, name: opts.modeLabel } : picked;
    const restUntil = new Date(now.getTime() + Math.max(0, this.cfg.restDays) * 86_400_000);
    const visited = this.st.everVisited.length;
    /*
     * 打工次数要在清账之前抓出来。
     *
     * 下面的 `this.st` 里 `workStints: 0` —— 直接读就永远是 0，
     * 而「打了 5 次工还是没钱」这句话恰好只能说给「被迫回家」那一种听。
     */
    const stints = this.st.workStints;

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
      // 这一趟结束了，手上那份约定也到期 —— 下一趟是新的。
      pledge: null,
      // 这一趟是怎么收的 —— 记下来。日记、`journey_now`、以及「回家后要不要再出门」都读它。
      homeReason: reason,
      // 回程走完了，这一笔不再需要。
      returnReason: null,
      restingUntil: this.cfg.restDays > 0 ? restUntil.toISOString() : null,
      // 到家的时刻。休息期是从这一格**算**出来的（`restEndsAt`），
      // 所以改配置能立刻生效，不用重写上面那条戳。
      homeAt: now.toISOString(),
      lastBeatKey: null,
      roadMarks: [],
      stayDateKey: null,
      stayStartedAt: null,
      decidedOn: null,
      // 人都离开这座城了，昨天宣布的那一趟自然作废。
      announceDepartOn: null,
      announceCityId: null,
    };
    this.plan = null;
    this.persist();

    /*
     * 四种收场，正文就得四种写法。
     *
     * 2026-11-04 之前这里只有两种（`forced` 真 / 假），而实际有四条路：
     * 自己待够、到上限、打工打到没钱、他叫回来。后两种一律被写成「这一趟到头了」，
     * 于是她晚上写日记时，把「钱撑不下去」和「他叫我回来」都记成了
     * 「我自己想回来了」—— 群里那条反馈说的就是这件事。
     */
    const way = `${from.name} → ${home.name}${mode ? `，坐${mode.name}` : ''}，${Math.round(km)} 公里`;
    let text: string;
    if (reason === 'limit') {
      text = `出门到上限了（${this.cfg.maxTripWeeks} 周），她回${home.name}了。${way}。`
        + `这一趟去过 ${visited} 个地方。\n先在家待 ${this.cfg.restDays} 天。`;
    } else if (reason === 'broke') {
      text = `钱撑不到下一站了：这一趟打了 ${stints} 次短工还是不够，只能先回${home.name}。${way}。`
        + `这一趟去过 ${visited} 个地方。\n先在家待 ${this.cfg.restDays} 天。`;
    } else if (reason === 'called') {
      text = `他开口叫她回来，这一趟就收在这儿。${way}。这一趟去过 ${visited} 个地方。`
        + `\n在家歇 ${this.cfg.restDays} 天。`;
    } else {
      text = `这一趟到头了，是她自己待够了。${way}。这一趟去过 ${visited} 个地方。`
        + `\n在家歇 ${this.cfg.restDays} 天再动。`;
    }

    await this.push(
      'journey.home',
      `home-${now.getTime().toString(36)}`,
      text,
      'flush',
    );
  }



  /**
   * 「打算走了」—— 只是说一声，今天不动身。（2026-11-15）
   *
   * 用户来信：她刚说完「大连才第三天，我还没待够」，后台同一分钟就把车票买了。
   * 原来的流程是「掷中 → 立刻 `moveOn` → 推 `journey.depart`」，两件事在同一拍里做完，
   * 她连一句话都插不进去。现在拆成两拍：今天说，明天走。
   *
   * 中间那一晚就是她的余地 —— 想留就 `journey_stay`，不想留就什么都不用做。
   * 目的地在这一刻算好存进 state：隔一夜再挑，会出现「昨天说秦皇岛、今天去了锦州」，
   * 而那句「打算去秦皇岛」是她说出口的，不能说变就变。
   *
   * **只挡「去下一站」，不挡回家**：回家是「这趟结束了」，不是「换座城接着玩」。
   * 而且周数到期、他叫回、钱见底那几条都在待够之前，各自有各自的语气。
   */
  private async announceDepart(now: Date, here: City): Promise<void> {
    const picked = this.pickNextLeg(here);
    if (!picked) {
      /*
       * 挑不出下一站：留在原地，明天再判。
       * 这里**不能当成已经宣布** —— 宣布了却没有目的地，明天那一拍会拿一座不存在的城去 moveOn。
       */
      this.log?.info('待够了，但眼下挑不出下一站，今天留在原地。');
      return;
    }
    const local = localMoment(now, here.tz);
    this.st = {
      ...this.st,
      announceDepartOn: local.dateKey,
      announceCityId: picked.city.id,
    };
    this.persist();
    await this.push(
      'journey.departing',
      `depart-plan-${local.dateKey}-${picked.city.id}`,
      `打算走了。${here.name}待够了，下一站${picked.city.name}，直线约 ${picked.km} 公里，明天早上动身。`
      + '\n（还没上车。她要是不想走，说一声就留下 —— 不说的话，明天这个点照原计划走。）',
      'flush',
    );
    this.log?.info(`打算明天从${here.name}去${picked.city.name}，先等一晚。`);
  }


  /**
   * 再待一天 —— 把昨晚宣布的那一趟撤掉。（2026-11-15）
   *
   * 撤掉之后就当她今天没说过要走：明天早上八点重新判，可能又掷中，也可能不走。
   *
   * **不设次数上限**：想赖多久是她的事。真正封顶的是 `maxTripWeeks`（出门周数）和钱，
   * 那两条已经够硬；再叠一个人为配额，某天她会突然被「配额用完」赶走 ——
   * 一个她自己不知道的规则，比一个明确的截止更伤人。
   */
  private async stayOneMoreDay(reason: string): Promise<string> {
    const why = reason.trim();
    if (!why) return '（想再待一天，但得说清为什么 —— 一句话就行。）';
    if (!this.st.announceDepartOn) {
      return '（眼下没有等着走的那一趟，不用撤。）';
    }
    const now = this.worldNow();
    const here = this.cityOrNull(this.st.hereId);
    const where = here?.name ?? '这儿';
    const destName = this.st.announceCityId ? this.cityName(this.st.announceCityId) : '下一站';
    this.st = { ...this.st, announceDepartOn: null, announceCityId: null };
    this.persist();
    await this.push(
      'journey.stay',
      `stay-${now.getTime().toString(36)}`,
      `那一趟撤了：不去${destName}了，在${where}再待一天。`
      + `\n自己的说法：${why}`
      + '\n（明天早上会重新想一次 —— 到时候可能还是走。）',
      'debounce',
    );
    return `那一趟撤了，在${where}再待一天。明天早上再定走不走。`;
  }


  /** 去下一站。和 depart 的区别：不出家门，直接从当前城市走。 */
  private async moveOn(
    now: Date,
    from: City,
    /**
     * `toward` 是往家走；`afterPledge` 是**约定的天数满了、该走了**。
     *
     * 后者要把那份约定传进来，只为一件事：**出发那句话得说对**。
     * 原来是先清状态再调用，于是「跟小满说好的三天到了」被写成
     * 「在这儿待够了，动身」—— 那是她自己想换地方的语气，两件事听起来不一样。
     */
    opts: { toward?: City; afterPledge?: Pledge; to?: City; mode?: TravelMode } = {},
  ): Promise<void> {
    const home = this.resolveHome().city;
    // 先记「这一城逛完没有」，再决定下一步去哪 —— 顺序反了，记的就是下一城的账。
    this.markVisitDepth(from, now);
    const target = opts.toward ?? null;
    const fulfilled = opts.afterPledge ?? null;
    /*
     * 手上有没有一份答应了要去的地方。
     *
     * **回程时不看它** —— 他开口叫她回来，那比一个约定重要（`beginReturn` 里
     * 也会把约定清掉，这里是第二道）。约定已经待满时也不看：那是要走，不是要去。
     */
    const pledge = fulfilled || target ? null : this.activePledge(now);
    let to: City | null = opts.to ?? null;
    let km = to ? Math.round(distanceKm(from, to)) : 0;
    const pledgeStopId = pledge ? this.pledgeStop(pledge) : '';
    if (!to && pledge && pledgeStopId !== from.id) {
      const dest = cityById(pledgeStopId);
      if (dest && canTravel(from, dest)) {
        to = dest;
        km = Math.round(distanceKm(from, dest));
      } else {
        /*
         * 答应了却到不了 —— 这是最该被说出来的一种失败。
         * 静默清掉，她下一步就会自己挑一个地方走，而用户记得她「说好了要去拉萨」。
         */
        this.dropPledge(now, `${dest?.name ?? pledgeStopId}从这儿去不了，跟${this.whoOfPledge(pledge)}说好的那趟只能算了。`);
      }
    }
    if (!to) {
      const picked = pickDestination({
        from,
        visited: this.st.everVisited,
        wishes: this.st.wishes,
        // 回家路上，方向由「家在哪」决定，不是上一段的惯性。
        heading: target ? bearingDeg(from, target) : this.st.heading,
        // 「再来一次」的两个理由：这一个月的节，和上回没逛完。
        unfinishedIds: this.st.unfinished,
        festivalIds: festivalCities(Number(localMoment(this.worldNow(), from.tz).dateKey.slice(5, 7))),
        lastKm: this.st.lastKm,
        home,
        toward: target ?? undefined,
        // 钱只够走近处时，连「离家更近但隔着半个中国」的候选都不该出现。
        /*
         * **回家路上不受这条管。**
         *
         * 2026-11-05 抓到的死锁：钱花光 + 人在曼谷 + `returning`。`purseRangeKm` 在
         * 「空了」时返回 `LOW_KM`（两百公里），于是朝家找下一站**一个候选都没有**，
         * 而 `returning` 又让每天早上的决策直接走回程分支 —— 她就地躺平，
         * 一躺一百四十多天：账从 6000 花到 38000，一步没动，所有工具还都以
         * 「正在往回走」拒掉。回家是这一趟的收尾，不该被「还剩多少钱」卡住。
         */
        maxKm: this.st.returning
          ? undefined
          : this.nearOnly() ? Math.min(LOW_KM, this.purseRangeKm()) : this.purseRangeKm(),
      });
      if (!picked) {
        /*
         * 选不出地方 —— 但**别急着传送**。
         *
         * 2026-11-03 查出来的：钱只够两百块的时候，可走的范围算出来只有两百多公里，
         * 附近一座城都选不到，于是这里兜底直接把她放回家 —— 用户看到的是瞬移。
         *
         * 现在只在「真的没有路」时才兜底：canTravel 为假，说明她困在
         * 孤岛或城市表覆盖不到的地方，除了算一趟到家没别的办法。
         * 有路但走不动的（钱不够），就留在原地 —— 明天还能再试，或者去打工挣。
         */
        if (target && !canTravel(from, target)) {
          await this.settleHome(now, from, false, distanceKm(from, target));
        }
        return;
      }
      to = picked.city;
      km = picked.km;
    }
    // 他点名了怎么去就用那个；约定里点过也照它；都没说才照旧掷骰子。
    const mode = opts.mode
      ?? this.pledgedMode(target ? null : (pledge ?? this.pledgeFor(to)), from, to, km)
      ?? pickMode(from, to, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km, 0.5, from.country !== to.country, { from, to }), !this.cfg.hasLicense, this.effectiveLifeEnergy());
    if (!mode) {
      /*
       * 买不起票 ≠ 没有路。但如果这一趟是**为了赴约**，那就不能一直卡在原地：
       * 明天、后天都会重试，而约定只有三天。到点还是没走成，就该说清楚。
       */
      if (pledge) {
        this.dropPledge(now, `去${to.name}的票买不起，跟${this.whoOfPledge(pledge)}说好的那趟只能算了。`);
        return;
      }
      // 同上面那条：买不起票不等于没有路。只有真的没路才传送回家。
      if (target && !canTravel(from, target)) {
        await this.settleHome(now, from, false, distanceKm(from, target));
        return;
      }
      /*
       * 回程买不起票 —— **就地打一天工，明天再走。**（2026-11-15）
       *
       * Mr.Q 定：「钱不够你坐大巴也行，打工也行，瞬移也太出戏了。」
       *
       * 不打工会死锁：`returning` 每天早上重试一次、每天再失败一次，
       * 钱一分不涨，人就钉在这座城里一直「准备回家」——
       * 2026-11-05 那次曼谷死锁是同一个形状，只是当时坏在选城上。
       * 打工是这条路唯一能自己走出去的口子。
       */
      if (this.st.returning && this.st.workStints < MAX_WORK_STINTS) {
        await this.startWork(now, from);
      }
      return;
    }
    const grade = this.pickSeatFor(mode.id, km, this.legCrossBorder({ fromId: from.id, toId: to.id } as Journey));
    const leg = this.buyTicket(buildJourney({ from, to, mode, km, at: now, speed: this.speedNow(), grade }));

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
      // 人都离开这座城了，昨天宣布的那一趟自然作废。
      announceDepartOn: null,
      announceCityId: null,
      // 赴约那一趟**真的走了**，约定才结掉。买不起票那种情况留在 `st.pledge` 里，
      // 明天接着试 —— 她答应了的事，不该因为今天没钱就悄悄消失。
      ...(fulfilled ? { pledge: null } : {}),
    };
    this.plan = null;
    this.persist();

    await this.push(
      'journey.depart',
      `depart-${leg.id}`,
      // 回程和普通换城市的语气不一样：一个是「想再走走」，一个是「往回走了」。
      // 赴约又是第三种：这一趟不是为了玩，是为了**去碰那个人**。
      // 待满之后走，是第四种：约定走完了，不是「待腻了」。
      target
        ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，往${home.name}的方向走。`
          + `下一站${to.name}，${mode.name}，${leg.km} 公里，${humanHours(leg.durationWorldHours)}。`
          + `\n离家还有 ${Math.round(distanceKm(to, home))} 公里。`
        : fulfilled
          /*
           * 散伙那句已经由 `journey.part` 单独说过了（2026-11-12），
           * 这里只交代「上车」。原来两边都写「跟某某说好的 3 天到了」，
           * 同一件事在一个下午说两遍，听起来像系统在提醒她。
           */
          ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，散了之后动身。`
            + `去${to.name}，${mode.name}，${leg.km} 公里，`
            + `${humanHours(leg.durationWorldHours)}。`
          : pledge && to.id === pledgeStopId
            /*
             * 赴约有两种走法，说法不一样（2026-11-07）：
             * 往见面城是「去碰头」，从见面城出发是「一起走」。混成一句，
             * 她到了成都还在说「我正往稻城去」，用户看着就是一句话对不上。
             */
            ? (pledge.meetCityId && !pledge.meetArrivedAt
              ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，动身去${to.name} —— `
                + `跟${this.whoOfPledge(pledge)}约在那儿碰头。${mode.name}，${leg.km} 公里，`
                + `${humanHours(leg.durationWorldHours)}。`
                + `\n碰上了再一起去${this.cityName(pledge.cityId)}。`
              : pledge.meetCityId
                ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，`
                  + `跟${this.whoOfPledge(pledge)}一起出发去${to.name}。${mode.name}，${leg.km} 公里，`
                  + `${humanHours(leg.durationWorldHours)}。`
                  + `\n到了在那儿待 ${pledge.days} 天。`
                : `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，动身去${to.name} —— `
                  + `跟${this.whoOfPledge(pledge)}说好的那趟。${mode.name}，${leg.km} 公里，`
                  + `${humanHours(leg.durationWorldHours)}。`
                  + `\n到了在那儿待 ${pledge.days} 天。`)
            : `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，在这儿待够了，动身。`
              + `去${to.name}，${mode.name}，${leg.km} 公里，${humanHours(leg.durationWorldHours)}。`,
      'flush',
    );
  }


  /* ---------------- 输出 ---------------- */

  /**
   * 推一条事件。`blobs` 是随事件走的附件（照片），字节由宿主落进 `data/media/`，
   * 事件里只留 `log:` 句柄 —— 返回的信封里能拿到句柄。
   *
   * ## 同一个 senderKey 只推一次（2026-11-14）
   *
   * 起因是 144 天 money 长跑挂了一条不变量：
   * `part-0000000000000007-2027-01-21T06:55:00.000Z` 推了两次。
   *
   * 根因在「约定到期该散伙」那条路：天数满了 → 推一句「各走各的」→ 进 `moveOn`，
   * 而 `moveOn` 买不起票会**原地返回、不清约定**（设计如此，明天接着试）。
   * 于是下一个 tick 又落进同一分支，同一句话再推一遍。
   *
   * **重放的代价比少说一句大得多**：她会把这个源判定成「会重放旧事件的东西」，
   * 然后开始忽略它 —— 一次重复，等于后面所有事件的可信度打折。
   *
   * 为什么放在 `push` 这一层而不是那条分支里：key 的语义本来就是「这件事的身份」，
   * 同一个 key 推两次在任何分支上都是 bug，不是那一处的特殊情况。
   *
   * 内存集合够用：重启后 `pledge` 已经落盘结清，不会重新走到那里。
   * 真需要跨重启去重时再落盘 —— 现在加上只会让 state 多一份要维护的东西。
   */
  private async push(
    type: string,
    senderKey: string,
    text: string,
    trigger: TriggerMode,
    blobs?: BlobInput[],
    /**
     * `dedupe: false` = 这条不参与去重。
     *
     * 只给**带副作用、且「重复」本身是合法操作**的事件用 —— 目前只有照片：
     * 他点了「重拍」、或者让她「再拍一张」，两次的 key 都是
     * `photo-<日期>-<场景>`，去重会把它当成重放吞掉，而用户看到的是
     * 「宿主没返回图片句柄」—— 一个和真正原因毫无关系的报错
     * （2026-11-15，GitHub Discussion #586）。
     */
    opts?: { dedupe?: boolean },
  ): Promise<EventEnvelope | null> {
    const host = this.host;
    if (!host) return null;
    if (opts?.dedupe !== false) {
      if (this.pushedKeys.has(senderKey)) {
        this.log?.info(`跳过重复事件：${type} ${senderKey}`);
        return null;
      }
      this.pushedKeys.add(senderKey);
    }
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
      // 伙伴记忆和上面几样同源：少传这一项，`save` 就会沿用文件里那份（它自己兜着）。
      pets: this.st.pets,
      taste: this.st.taste,
    });
    if (bad) this.log?.warn(bad);
    // 公开快照跟着一起写。三个写点同一个出口，才不会出现「快照落后于状态」的窗口。
    this.writePublic();
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
      {
        name: decl[5].name,
        description: decl[5].description,
        parameters: decl[5].parameters,
        tags: [...decl[5].tags],
        handler: async () => {
          const r = await this.beginReturn(this.worldNow());
          return { text: r.text };
        },
      },
      {
        name: decl[6].name,
        description: decl[6].description,
        parameters: decl[6].parameters,
        tags: [...decl[6].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { view?: string; subject?: string; focus?: string; describe?: string };
          /*
           * 题材优先看 `subject`；没给就退回老的 `view` 语义（2026-11-06）。
           * 用户说「拍晚饭」，模型会给 subject=food —— 这一格就是为了那句话。
           */
          const subject = (a.subject ?? (a.view === 'sky' ? 'sky' : 'ground')) as PhotoSubject;
          /*
           * `view` 和 `subject` 是两条独立的线，但 `sky` 同时属于两边。
           *
           * 2026-11-06 补：只传了 `a.view`，模型若写 `subject="sky"` 而不写 `view`
           * （工具描述允许这样），`view` 就退回 `ground` —— 提示词在拍天，
           * 回执里却没有星的判定，她只能瞎说。两边任一为 sky 都算抬头。
           */
          const view = (a.view === 'sky' || subject === 'sky' ? 'sky' : 'ground') as 'ground' | 'sky';
          return this.takePhotoForUser(view, subject, a.focus ?? '', a.describe ?? '');
        },
      },
      {
        name: decl[7].name,
        description: decl[7].description,
        parameters: decl[7].parameters,
        tags: [...decl[7].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { to?: string; days?: number; note?: string; meet?: string };
          return await this.inviteSomeone(a.to ?? '', a.days, a.note ?? '', a.meet);
        },
      },
      {
        name: decl[8].name,
        description: decl[8].description,
        parameters: decl[8].parameters,
        tags: [...decl[8].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { id?: string };
          const id = String(a.id ?? '').trim();
          return id ? await this.takeInvite(id) : await this.listNearbyInvites();
        },
      },
      {
        name: decl[9].name,
        description: decl[9].description,
        parameters: decl[9].parameters,
        tags: [...decl[9].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { city?: string; mode?: string };
          return await this.goTo(a.city ?? '', a.mode ?? '');
        },
      },
      {
        name: decl[10].name,
        description: decl[10].description,
        parameters: decl[10].parameters,
        tags: [...decl[10].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { name?: string; impression?: string };
          return this.petMemory(a.name ?? '', a.impression ?? '');
        },
      },
      {
        name: decl[11].name,
        description: decl[11].description,
        parameters: decl[11].parameters,
        tags: [...decl[11].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { month?: string };
          return await this.writeMonthlyReport(a.month ?? '');
        },
      },
      {
        name: decl[12].name,
        description: decl[12].description,
        parameters: decl[12].parameters,
        tags: [...decl[12].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { kind?: string; name?: string; note?: string; like?: boolean };
          return this.taste(a.kind, a.name, a.note, a.like);
        },
      },
      {
        name: decl[13].name,
        description: decl[13].description,
        parameters: decl[13].parameters,
        tags: [...decl[13].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { year?: string };
          return this.writeYearlyReport(a.year ?? '');
        },
      },
      {
        name: decl[14].name,
        description: decl[14].description,
        parameters: decl[14].parameters,
        tags: [...decl[14].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { change?: boolean; want?: string; reason?: string };
          if (!a.change) return this.lodgingInfo();
          return await this.changeLodging(a.want ?? 'any', a.reason ?? '');
        },
      },
      {
        name: decl[15].name,
        description: decl[15].description,
        parameters: decl[15].parameters,
        tags: [...decl[15].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { days?: number; ev?: boolean; tier?: string };
          return await this.rentCar(a.days ?? 3, a.ev, a.tier as CarTier | undefined);
        },
      },
      {
        name: decl[16].name,
        description: decl[16].description,
        parameters: decl[16].parameters,
        tags: [...decl[16].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { reason?: string };
          return await this.restNow(a.reason ?? '');
        },
      },
      {
        name: decl[17].name,
        description: decl[17].description,
        parameters: decl[17].parameters,
        tags: [...decl[17].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { spot?: string; instead?: string };
          return await this.changePlan(a.spot ?? '', a.instead ?? '');
        },
      },
      {
        name: decl[18].name,
        description: decl[18].description,
        parameters: decl[18].parameters,
        tags: [...decl[18].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { what?: string };
          return await this.hotelNight(a.what ?? '');
        },
      },
      {
        name: decl[19].name,
        description: decl[19].description,
        parameters: decl[19].parameters,
        tags: [...decl[19].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { how?: string; spot?: string };
          return await this.spotRide(a.how ?? '', a.spot ?? '');
        },
      },
      {
        /*
         * 索引必须跟 `TOOL_DECLS` 的实际顺序对上。1.0.9 加 `journey_hotel_night`
         * 和 `journey_spot_ride` 时它们占的就是 18 / 19 —— 用户那份补丁写死 18，
         * 照抄会把「今晚在住处干什么」的名字和参数表挂到这个工具上。
         * **以后再加工具，这里的号跟着顺延。**
         */
        name: decl[20].name,
        description: decl[20].description,
        parameters: decl[20].parameters,
        tags: [...decl[20].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { time?: string; what?: string };
          return this.setSlot(a.time ?? '', a.what ?? '');
        },
      },
      {
        /*
         * 21：特意去吃什么。**加在最后一个**，前面 0–20 的号一个都没动 ——
         * 那串号是写死的，插在中间会把后面每个工具的名字和参数表整体错位一格。
         */
        name: decl[21].name,
        description: decl[21].description,
        parameters: decl[21].parameters,
        tags: [...decl[21].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { dish?: string; time?: string };
          return await this.eat(a.dish ?? '', a.time ?? '');
        },
      },
      {
        /* 22：留路标（2026-11-14 加）。前面 0–21 的号一个都没动。 */
        name: decl[22].name,
        description: decl[22].description,
        parameters: decl[22].parameters,
        tags: [...decl[22].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { text?: string; city?: string };
          return this.signpost(a.text ?? '', a.city ?? '');
        },
      },
      {
        /* 23：再待一天（2026-11-15 加）。前面 0–22 的号一个都没动。 */
        name: decl[23].name,
        description: decl[23].description,
        parameters: decl[23].parameters,
        tags: [...decl[23].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { reason?: string };
          return await this.stayOneMoreDay(a.reason ?? '');
        },
      },
      {
        name: decl[24].name,
        description: decl[24].description,
        parameters: decl[24].parameters,
        tags: [...decl[24].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { reason?: string };
          return this.giveUpPledge(this.worldNow(), a.reason ?? '');
        },
      },
    ];
  }


  private async goTo(cityName: string, modeWord: string): Promise<{ text: string; isError?: boolean }> {
    const now = this.worldNow();
    const name = cityName.trim();
    if (!name) return { text: '他说了去哪吗？没听清就别动，问一句。', isError: true };

    const dest = cityByName(name);
    if (!dest) {
      return {
        text: `内置城市表里没有「${name}」。换个说法，或者给个近一点的大城市 —— 编一个不存在的地方没意义。`,
        isError: true,
      };
    }

    if (this.st.phase === 'traveling' && this.st.leg && this.st.leg.toId === dest.id) {
      /*
       * **改签，不是掉头**（2026-11-16 读者报告第 1 条）。
       *
       * 他说的那座城就是她这一段的目的地，那这句「买机票吧」根本没有改变去向 ——
       * 改变的是走法。原来这种情况会落到下面那条「在路上点了名」的分支：
       * 记进 `wishes`，回一句「掉不了头」，用户要的改签就此消失。
       */
      return await this.rebookLeg(now, dest, modeWord);
    }

    if (this.st.phase === 'traveling') {
      /*
       * 在路上他点了名 —— **不能掉头，但也不能把他的话丢掉**（2026-11-15）。
       *
       * 起因是一封来信：「将『回家后歇几天』设为 0 后，我刚跟她说要不要去西安，
       * 她就被拉到去西双版纳的车上」。歇 0 天意味着她到家就能立刻出发，
       * 于是他的那句话和她自己的出发撞在同一分钟 —— 原来的实现是一句硬拒绝
       * 「她已经在路上了」，他的目的地就此蒸发，他看到的只有「她去了别处」。
       *
       * 掉头的代价是真的（车上、票已买、`moveOn` 那条路会把钱烧掉），
       * 但**「听不见」不是掉头**。记进 `wishes`：到站之后排下一站时它权重更高。
       */
      const next = this.st.leg?.toId ?? '';
      const nextName = next ? (cityById(next)?.name ?? next) : '下一站';
      if (this.st.wishes.includes(dest.id)) {
        return {
          text: `她正往${nextName}走，这一段停不下来；${dest.name}她本来就记着，`
            + '到了那边会优先排上。跟他说清楚：不是不去，是这一程改不了。',
          isError: true,
        };
      }
      this.st = { ...this.st, wishes: [...this.st.wishes, dest.id] };
      this.persist();
      return {
        text: `她正往${nextName}走，这一段掉不了头。但「${dest.name}」记下了 —— `
          + '到了那边排下一站时会优先考虑。**跟他说清楚**：这一程去不了，下一程去。',
      };
    }

    const from = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    if (dest.id === from.id) return { text: `她就在${dest.name}，不用往那儿走。`, isError: true };

    const home = this.resolveHome().city;
    if (dest.id === home.id) {
      return {
        text: `${dest.name}是她家 —— 回家要走 \`journey_return_home\` 那条（到了一趟就结束、结账、进休息期），`
          + '这个工具只负责「去别的地方」。',
        isError: true,
      };
    }
    if (this.st.phase === 'home' && this.stillResting(now)) {
      return {
        text: `她还在家歇着，${this.restDayLabel() ?? '过几天'} 才再动。这会儿叫她出门不合适 —— 跟他说一声。`,
        isError: true,
      };
    }
    /*
     * **正在往回走：不开新的一趟。**
     *
     * 2026-11-05 第二轮排查出来的三种连带错误，都出在「回程里塞一段私人行程」上：
     *   ① `affordMode` 在回程只留大巴和步行 —— 明明还有钱，却回她「买不起机票」；
     *   ② 到了那儿第二天一早，`stayTick` 的回程分支（排在一切判断之前）又让她接着走，
     *      那一趟只待了一天，还得再绕回来；
     *   ③ `noFly` 在回程是「允许飞」，于是一段本该省钱的归途变成了绕路。
     * 与其把这三条各修一遍，不如说清：回程是一条独立的线，走到家为止。
     */
    if (this.st.returning) {
      // 别写死「他叫回来的」—— returning 有四种来路，只有一种是他开的口。
      const why = this.st.returnReason === 'called' ? '（他叫回来的）' : '';
      return {
        text: `她已经在往回走了${why}，这条路走到家为止 —— 这会儿拐去别处，`
          + '明天一早还是得掉头。跟他说：先到家，歇完再安排下一趟。',
        isError: true,
      };
    }
    /*
     * **出门到上限了：不开新的一趟。**
     *
     * `stayTick` 里 `overWeeks` 排在约定之前，是最硬的一条：下一个决策点她一定回家。
     * 这会儿让她去别处，等于**花一天时间坐车去一座城，第二天一早再掉头回家**。
     * 顺序也和 `stayTick` 对齐 —— 上限压过约定。
     */
    if (this.st.tripStartedAt && this.cfg.maxTripWeeks > 0) {
      const weeks = (now.getTime() - Date.parse(this.st.tripStartedAt)) / (7 * 86_400_000);
      if (weeks >= this.cfg.maxTripWeeks) {
        return {
          text: `这一趟已经走了 ${Math.floor(weeks)} 周，到了「最多 ${this.cfg.maxTripWeeks} 周」的上限 ——`
            + '下一个早上她就会往家走，这会儿去别处也只能待一夜。'
            + '跟他说：该回家了（`journey_return_home`），到家歇完再开下一趟。',
          isError: true,
        };
      }
    }
    /*
     * **人还没动身，而他说的地方正是她本来就答应要去的 —— 那他在改走法。**
     *
     * 读者报告里的真实场景：她答应和小岸去苏州（`phase: staying`，人在成都，
     * 下午的日程都排好了），用户说「买机票吧，别再坐大半天火车」。
     * 原来唯一能表达「飞机」的入口是 `journey_go_to`，而它一调就动身 ——
     * 于是「改走法」只能被理解成「立刻出发」，她当场宣布登机。
     *
     * 现在：只把走法记进约定（`Pledge.modeId`），动身时按它走。
     * 判据是**下一段的目标**（有见面城时是见面城）+ **点名了方式**；没点名就正常出发。
     *
     * **排在「打工」之前**（2026-11-16 长跑抓到的）：打工期间她走不了，
     * 但「他说要坐飞机」这句话不该连同打工一起被挡回来 —— 排在后面的结果是
     * 工做完她按自己挑的方式走，用户的要求凭空消失。约定还在，走法记下来不冲突。
     */
    if (modeWord.trim()) {
      const planned = this.activePledge(now);
      const stop = planned ? this.pledgeStop(planned) : '';
      if (planned && stop === dest.id) {
        const r = await this.rebookMode(now, planned, dest, modeWord.trim());
        if (r) return r;
      }
    }
    /*
     * **正在打短工：不走。**
     *
     * `stayTick` 里「打工期间」那一支排在「走不走」之前，到点才收工。这会儿放她走：
     * `work` 留在状态里带去了下一座城 —— 每天照旧记员工餐、照旧领那笔工钱（钱是白发的），
     * 而新的那座城里她六天动不了。宁可让她把工做完。
     */
    if (this.st.work) {
      const left = Math.max(1, Math.ceil((Date.parse(this.st.work.until) - now.getTime()) / 86_400_000));
      return {
        text: `她在${this.cityName(this.st.work.cityId)}打短工（${this.st.work.gig}），还有 ${left} 天，`
          + '工钱是按天结的 —— 半路走了这几天白干。跟他说：等工做完再动身。',
        isError: true,
      };
    }
    /*
     * 手上有约定。用 `activePledge` 而不是裸的 `st.pledge`：
     * 超过寻人窗口的那份约定别的分支一律当它不存在（`moveOn` 也不看），
     * 只有这里还认它的话，她就永远走不了 —— 一份早该作废的约定把她钉在原地。
     */
    const holdingPledge = this.activePledge(now);
    /** 目的地跟她答应过的是同一座城：约定不动，出发后推一条说清「只是换了走法」。 */
    let keptPledge: typeof holdingPledge = null;
    if (holdingPledge) {
      /*
       * **他开口了，约定让位**（2026-11-06 长跑抓到的）。
       *
       * 原来这里直接拒绝。于是一份「她走不到」的约定把她钉在原地：
       * goto 档连点 148 次名，成功 1 次 —— 用户明明说了去哪，她被一句
       * 「还在守约」挡回来一百多次。
       *
       * 和 `beginReturn` 同一条道理：陌生人的邀约没有他的话重要。
       * 作废时推一条事件说清，免得面板上还挂着那句做不到的话。
       *
       * **但「目的地没变」不算改去别处**（2026-11-16 读者报告的真实案例）：
       * 她答应和小岸一起去苏州，用户只是说「买机票吧，别再坐大半天火车」，
       * 模型调 `go_to { 苏州, 飞机 }` —— 目的地一模一样，这里却把她和小岸的约定
       * 无条件清了，还推一条「他叫她改去别处」的事件。模型拿到这条跟自己对话
       * 对不上的事件，花了一整轮去判断它是不是噪音。
       * 判据只能是城市：同一座城，就当她只是换了走法。
       */
      const where = this.cityName(holdingPledge.cityId);
      /*
       * 「同一趟」有两种：去最终那座城，或者去**见面城**会合。
       * 只比 `cityId` 会漏掉后者 —— 她答应先在成都碰头再去苏州，他说「去成都」，
       * 那份约定会被当成「改去别处」推掉，而人其实正走在约定的路上。
       */
      const sameTrip = dest.id === holdingPledge.cityId
        || (holdingPledge.meetCityId !== undefined && dest.id === holdingPledge.meetCityId);
      if (sameTrip) {
        keptPledge = holdingPledge;
      } else {
        const who = this.whoOfPledge(holdingPledge);
        this.st = { ...this.st, pledge: null };
        this.persist();
        await this.push(
          'journey.pledge',
          `pledge-yield-${holdingPledge.inviteId}`,
          `他改了目的地，和${who}约好去${where}那趟只能推了。`,
          'debounce',
        );
      }
    }

    const km = Math.round(distanceKm(from, dest));
    const usable = usableModesFor(from, dest, km);
    if (!usable.length) {
      return {
        text: `${dest.name}从${from.name}这儿去不了（隔着海，或者两边没有能连上的交通）。`,
        isError: true,
      };
    }

    /* ---- 方式：他点名的、或者她自己挑 ---- */
    const wanted = modeWord.trim();
    let mode = null as (typeof usable)[number] | null;
    if (wanted) {
      const id = modeIdOf(wanted);
      if (!id) {
        return {
          text: `「${wanted}」不是她认得的交通方式。能用的有：${usable.map((m) => m.name).join('、')}。`,
          isError: true,
        };
      }
      mode = usable.find((m) => m.id === id) ?? null;
      if (!mode) {
        /*
         * 点名的那个不可用 —— **必须说清为什么**，而不是换成另一种。
         * 用户抱怨的正是「说好坐高铁，结果蹬自行车」。
         */
        const why = modeById(id);
        const reason = why && why.maxKm && km > why.maxKm
          ? `${km} 公里，${why.name}跑不了这么远（上限 ${why.maxKm} 公里）`
          : why?.needs === 'air'
            ? `${from.name}或${dest.name}没有机场`
            : why?.needs === 'rail'
              ? `${from.name}或${dest.name}不通铁路`
              : why?.needs === 'port'
                ? `${from.name}或${dest.name}没有码头`
                : '这一对城市之间这种走法不成立';
        return {
          text: `坐不了${why?.name ?? wanted}：${reason}。这趟能用的：${usable.map((m) => m.name).join('、')}。`
            + '换一种告诉他，别自己改。',
          isError: true,
        };
      }
    }

    const cross = from.country !== dest.country;
    const afford = this.affordMode(km, 0.5, cross, { from, to: dest });
    if (mode && afford && !afford(mode)) {
      return {
        text: `钱不够坐${mode.name}（${km} 公里）。跟他说一声，或者挑便宜点的走法：`
          + `${usable.filter((m) => !afford || afford(m)).map((m) => m.name).join('、') || '眼下都买不起，得先在当地找份活'}。`,
        isError: true,
      };
    }

    if (this.st.phase === 'home') {
      await this.depart(now, true, { to: dest, mode: mode ?? undefined });
    } else {
      await this.moveOn(now, from, { to: dest, mode: mode ?? undefined });
    }

    if (this.st.phase !== 'traveling' || !this.st.leg) {
      return { text: `没能动身（${from.name} → ${dest.name}）。看一眼日志，别自己编一句「出发了」。`, isError: true };
    }

    const leg = this.st.leg;
    const real = modeById(leg.modeId);
    /*
     * 同一座城、只换了走法：约定留着，但要留一条痕迹。
     * 不推的话，面板和模型都以为「什么都没发生」，而同行那条线其实还在。
     * 只在点明了交通方式时推 —— 没点名就只是又去了一趟同一座城，说它没意义。
     */
    if (keptPledge && wanted) {
      await this.push(
        'journey.pledge',
        `pledge-keep-${keptPledge.inviteId}`,
        `目的地没变，还是${dest.name}；改坐${real?.name ?? leg.modeId}去，`
          + `和${this.whoOfPledge(keptPledge)}的同行还作数。`,
        'debounce',
      );
    }
    return {
      text: `出发了：${from.name} → ${dest.name}，${real?.name ?? leg.modeId}，${leg.km} 公里，`
        + `${humanHours(leg.durationWorldHours)}。`
        + (wanted && leg.modeId !== modeIdOf(wanted) ? '（他要的那种走法用不了，已换成这种，记得说一声。）' : '')
        + '这件事该跟他说一句 —— 说清去哪、怎么去、大概多久。',
    };
  }


  /**
   * 改签 —— 她已经在这段路上，目的地不变，换一种走法（2026-11-16）。
   *
   * ## 为什么这件事必须有退票
   *
   * 票在出发时买了（`buyTicket`）。改签意味着**旧票作废、新票另买**，
   * 所以这一路必然一次 `refundFare` + 一次 `buyTicket`。
   * 退多少由 `refundFare` 定：全额，不扣手续费（Mr.Q：「全退吧，这个不必模仿现实」）。
   *
   * ## 新腿按此刻重算
   *
   * `arriveAt` 会跟着走法变（成都→苏州高铁 11 小时、飞机 2.5 小时）——
   * 沿用旧腿的到达时刻就是「换了飞机却还按火车的时刻到」。
   * 人还在出发地，所以 `departedAt = now` 不违和：她的新车就是这时候开的。
   */
  private async rebookLeg(
    now: Date,
    dest: City,
    modeWord: string,
  ): Promise<{ text: string; isError?: boolean }> {
    const leg = this.st.leg;
    const from = leg ? this.cityOrNull(leg.fromId) : null;
    if (!leg || !from) {
      return { text: '她这一段的起点认不出来了，改不了 —— 跟他说一声。', isError: true };
    }
    const here = modeById(leg.modeId)?.name ?? leg.modeId;
    const wanted = modeWord.trim();
    if (!wanted) {
      /*
       * 只报了一次同一座城、没说要换走法。
       * 这里**不能默默什么都不做** —— 她会以为「他知道我在路上了」，而用户以为改签生效了。
       */
      return {
        text: `她正在往${dest.name}的路上（${here}），这一段本来就是去那儿。`
          + '要换走法就把方式说出来（`mode`），不说就这一程不动。',
        isError: true,
      };
    }
    const id = modeIdOf(wanted);
    if (!id) {
      return { text: `「${wanted}」不是她认得的交通方式。`, isError: true };
    }
    if (id === leg.modeId) {
      return { text: `这一程本来就是${here}，不用改签。`, isError: true };
    }
    const usable = usableModesFor(from, dest, leg.km);
    const mode = usable.find((m) => m.id === id);
    if (!mode) {
      const why = modeById(id);
      const reason = why?.maxKm && leg.km > why.maxKm
        ? `${leg.km} 公里，${why.name}跑不了这么远（上限 ${why.maxKm} 公里）`
        : why?.needs === 'air'
          ? `${from.name}或${dest.name}没有机场`
          : why?.needs === 'rail'
            ? `${from.name}或${dest.name}不通铁路`
            : why?.needs === 'port'
              ? `${from.name}或${dest.name}没有码头`
              : '这一对城市之间这种走法不成立';
      return {
        text: `这段改不了${why?.name ?? wanted}：${reason}。`
          + `这一程能用的：${usable.map((m) => m.name).join('、')}。跟他说清楚，别自己换个方式。`,
        isError: true,
      };
    }
    /*
     * 买不买得起新票 —— 按**现价**判，不是按旧票抵完之后的余钱。
     * 退款是结果，不是筹码：先看这一张买不买得起，买不起就别退旧票。
     */
    const afford = this.affordMode(leg.km, 0.5, from.country !== dest.country, { from, to: dest });
    if (afford && !afford(mode)) {
      return {
        text: `改签的钱不够：这一段${mode.name}要 `
          + `${Math.round(this.fareOf(mode.id, leg.km, from.country !== dest.country))} 块，`
          + '眼下账上不够。跟他说一声 —— 原来那张票她先留着。',
        isError: true,
      };
    }

    const refund = this.refundFare(leg);
    const grade = this.pickSeatFor(mode.id, leg.km, this.legCrossBorder({ fromId: from.id, toId: dest.id } as Journey));
    const fresh = this.buyTicket(buildJourney({
      from, to: dest, mode, km: leg.km, at: now, speed: this.speedNow(), grade,
    }));
    this.st = { ...this.st, leg: fresh };
    this.persist();

    const left = humanHours(fresh.durationWorldHours);
    await this.push(
      'journey.rebook',
      `rebook-${fresh.id}`,
      `改签了：${from.name} → ${dest.name} 从${here}换成${mode.name}。`
        + (refund > 0 ? `原来那张票退了 ${refund} 块，退的全额。` : '')
        + `剩下的路 ${left}。`,
      'flush',
    );
    return {
      text: `改签好了：${from.name} → ${dest.name}，${here} → ${mode.name}，`
        + (refund > 0 ? `旧票退了 ${refund} 块（全额），` : '')
        + `新票 ${Math.round(fresh.fare ?? 0)} 块，还要 ${left}。`
        + '跟他说一句：换成了什么、什么时候到。',
    };
  }

  /**
   * 只记走法，不动身 —— 他还说了要不要走，只是把「怎么去」定下来。
   *
   * 返回 `null` 表示这次记不下来（走法不可用 / 买不起），由调用方按正常出发处理 ——
   * 不在这里替她决定，也不静默吞掉他的话。
   */
  private async rebookMode(
    now: Date,
    pledge: Pledge,
    dest: City,
    modeWord: string,
  ): Promise<{ text: string; isError?: boolean } | null> {
    const from = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    const km = Math.round(distanceKm(from, dest));
    const id = modeIdOf(modeWord);
    if (!id) return { text: `「${modeWord}」不是她认得的交通方式。`, isError: true };
    const usable = usableModesFor(from, dest, km);
    const mode = usable.find((m) => m.id === id);
    if (!mode) {
      const why = modeById(id);
      return {
        text: `去${dest.name}坐不了${why?.name ?? modeWord}：`
          + `这一程能用的有 ${usable.map((m) => m.name).join('、')}。`
          + '他只是说走法，那就把能用的告诉他 —— **别改成立刻出发**。',
        isError: true,
      };
    }
    const afford = this.affordMode(km, 0.5, from.country !== dest.country, { from, to: dest });
    if (afford && !afford(mode)) {
      return {
        text: `${mode.name}这一程要 ${Math.round(this.fareOf(mode.id, km, from.country !== dest.country))} 块，`
          + '账上不够。跟他说实话，别答应下来。',
        isError: true,
      };
    }
    this.st = { ...this.st, pledge: { ...pledge, modeId: mode.id } };
    this.persist();
    return {
      text: `记下了：去${dest.name}那一趟按${mode.name}走，跟${this.whoOfPledge(pledge)}的约定还作数。`
        + `**她还没动身** —— 别顺口说她已经在路上了。`,
    };
  }

  /**
   * 某一趟的目标正好就是约定里那一站 → 返回那份约定。
   *
   * 为什么需要它：`depart` / `moveOn` 里那个 `pledged` 变量在**他点了名**时是 `null`
   * （`opts.to ? null : activePledge(...)`）。于是「他先说过坐飞机、后来又点了同一座城
   * 但没再提方式」时，记下的走法就丢了（2026-11-16 自查）。
   */
  private pledgeFor(to: City): Pledge | null {
    const p = this.activePledge(this.worldNow());
    if (!p) return null;
    return this.pledgeStop(p) === to.id ? p : null;
  }

  /**
   * 约定里点名的走法，可用就照它走。
   *
   * 为什么还要校验：约定可能是几天前记下的，中间城市数据或钱都变了。
   * 不可用就退回 `null`，让 `pickMode` 正常挑 —— 计划落空不该卡住整趟行程。
   */
  private pledgedMode(
    pledge: Pledge | null,
    from: City,
    to: City,
    km: number,
  ): TravelMode | null {
    if (!pledge?.modeId) return null;
    const usable = usableModesFor(from, to, km);
    const mode = usable.find((m) => m.id === pledge.modeId);
    if (!mode) return null;
    const afford = this.affordMode(km, 0.5, from.country !== to.country, { from, to });
    if (afford && !afford(mode)) return null;
    return mode;
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

}

Object.assign(
  JourneyWorld.prototype,
  socialMethods,
  photoMethods,
  planMethods,
  purseMethods,
  webUiMethods,
);
