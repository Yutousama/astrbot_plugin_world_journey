/**
 * 大肥鱼环游世界 —— 每日排程、住宿、租车、改行程与口味同伴记忆子系统。
 *
 * 从 world.ts 拆出（Step 3：状态机与业务子系统分段），挂载到 JourneyWorld.prototype。
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
  partWord, seededRandom, modeIdOf, roadText, matchSpot, todayPilgrimLines, clockInText,
  pilgrimNote, beatText,
} from './helpers.ts';
export * from './helpers.ts';

/**
 * 「按钟点找格子」时允许多大的差（小时）。
 *
 * **0.25 = 一刻钟**（2026-11-17 由 0.5 收窄，Donahue 第二批反馈）。
 *
 * 原来半小时：用户说「6:30 出门」，表里最近的格是 07:00「起床」，
 * 于是被静默改成 7 点那格 —— 而他要的是 6:30。收窄之后差半小时就不算命中，
 * 会走 `add` 给她**真的加一格 6:30**；一刻钟还能兜住「说 12 点、表上 12:05」这种口误。
 *
 * 判据：**容差是给口误留的，不是给「差不多那个意思」留的。**
 */
export const SLOT_NEAR_HOURS = 0.25;

export const planMethods: Record<string, any> = {
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
  songHint(now: Date): string {
    if (this.st.phase !== 'staying') return '';
    if (this.stayDaysSoFar(now) > 1) return '';
    return '刚到这儿。想听和这地方有关的歌就搜一首（装了一起听歌可用 music_pick），'
      + '搜到自己去放：动得了电脑就点开播放器放，动不了就请他点。'
      + '动别人的播放器之前先问一句。';
  },


  stayDaysSoFar(now: Date): number {
    if (!this.st.stayStartedAt) return 0;
    const ms = now.getTime() - Date.parse(this.st.stayStartedAt);
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.floor(ms / 86_400_000);
  },


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
  /**
   * 走之前记一下：这一城逛完了没有。
   *
   * `spotText` 一天用两格（`seq = dayIndex * 2 + index`），所以待够
   * `ceil(slots.length / 2)` 天才算把点名的景点走完。没走完记进 `unfinished`，
   * 她下次挑目的地时这座城拿到加成；走完了摘掉 —— 不摘的话「没逛完」会永久贴着，
   * 她一辈子都在往回跑。
   *
   * 没有景点数据的城不记：那本来就说不清"逛完"是什么。
   */
  markVisitDepth(city: City, now: Date): void {
    if (!city.slots.length) return;
    const days = this.stayDayIndex(now);
    const need = Math.ceil(city.slots.length / 2);
    const cur = new Set(this.st.unfinished ?? []);
    if (days >= need) cur.delete(city.id);
    else cur.add(city.id);
    this.st = { ...this.st, unfinished: [...cur] };
  },


  stayDayIndex(now: Date): number {
    if (!this.st.stayStartedAt) return 0;
    const c = this.cityOrNull(this.st.hereId);
    if (!c) return 0;
    const from = localMoment(new Date(this.st.stayStartedAt), c.tz).dateKey;
    const to = localMoment(now, c.tz).dateKey;
    const diff = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0;
  },


  /** 排当天的作息表。`shape` 由调用方给 —— 到达日、完整日、最后一天。 */
  /**
   * 排当天的作息表。`shape` 由调用方给 —— 到达日、完整日、最后一天。
   *
   * `override` 只给「换酒店」用：那一晚的房由调用方指定，不掷骰子。
   * 除了住宿，其余（景点、天气、邻居、邀约）全部按原样重排 ——
   * 作息表的 seed 只跟「哪座城 + 哪天入住」有关，所以换一家店不会把白天的行程搅乱。
   */
  /**
   * `lastBeatKey` 里那个时刻（当天的小数小时）。不在这一天就返回 null。
   *
   * key 的格式是 `${dateKey}|${kind}|${at}` —— 在 `advanceBeats` 里拼的。
   * 解析失败一律当「没有推过」，宁可多排一次也不要漏排。
   */
  lastPushedAt(dateKey: string): number | null {
    const k = this.st.lastBeatKey;
    if (!k) return null;
    const [d, , at] = k.split('|');
    if (d !== dateKey) return null;
    const n = Number(at);
    return Number.isFinite(n) ? n : null;
  },


  /**
   * 把住宿记录里缺的设施补回来（2026-11-12）。
   *
   * ## 为什么需要它
   *
   * `amen` / `around` 从 2026-11-09 就由 `withHotel` 产生，`feel` 里那句
   * 「顶层有个小酒吧，晚上有人弹琴」正是 `amen=['bar']` 拼出来的。
   * 但存盘只挑了几个字段、读回又是一道白名单 —— 两处都把它们丢了。
   *
   * 于是同一个晚上：到达事件说楼上有酒吧，`journey_hotel_night` 回
   * 「这家没这个，今晚能干的：泡澡、在房间待着」（西安智选假日实测）。
   * **`feel` 是字符串，活下来了；`amen`/`around` 是字段，死了。**
   *
   * ## 为什么不能靠重算自愈
   *
   * `pinned` 有 `name` → `pois` 置空 → `withHotel` 第一行直接 `return base`。
   * 只要不换城、不重新入住，这个洞就一直是洞。
   * 所以只能按名字回 `hotel-facts.json` 查一次 —— 数据本来是全的。
   *
   * 查不到（老城没采、店名改过）就原样返回，不猜。
   */
  healLodgingFacts(lod: Lodging, cityId: string): { lod: Lodging; healed: boolean } {
    if (!lod.name || lod.amen?.length) return { lod, healed: false };
    const row = factsFor(cityId).find((h) => h.name === lod.name);
    if (!row) return { lod, healed: false };
    const amen = row.amen ?? [];
    const around = row.around ?? [];
    if (!amen.length && !around.length) return { lod, healed: false };
    return {
      lod: {
        ...lod,
        ...(amen.length ? { amen } : {}),
        ...(around.length ? { around } : {}),
      },
      healed: true,
    };
  },


  async rebuildPlan(
    now: Date,
    shape: 'arrival' | 'full' | 'last' = 'full',
    startHour = 0,
    city?: City,
    override?: Lodging,
  ): Promise<void> {
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
    this.hotels.setKey(this.amapKey());
    this.eateries.setKey(this.amapKey());
    /*
     * 种子按「哪座城 + 这次入住从哪天开始 + 钱紧不紧」算，不用 `Math.random` ——
     * 作息表只在内存里，重启一次就重建一次，随机源一变她就搬家。
     */
    const seed = `${c.id}|${this.st.stayStartedAt ?? 'x'}|${this.isTight() ? 'tight' : 'ok'}`;
    /*
     * **这次入住定的那家，定下来就不许改。**（2026-11-09 Mr.Q：「他怎么又自动改酒店」）
     *
     * 原来只有 `override ?? this.plan?.lodging ?? rollLodging(...)` 三级，
     * `plan` 一被清掉（日切、钱紧度变化都会清）就落回 `rollLodging` ——
     * **过零点重新掷一次骰子**，同一家旅店住三晚第二晚换了牌子，用户没让换。
     *
     * 判据：**酒店是「她住进去」这个动作的结果，不是每天重算的参数。**
     * 所以存在 state 里，按「城市 + 这次落脚的时刻」认；只有三种情况该变 ——
     * 用户让她换（`override`）、换城市、重新落脚。
     */
    const stayKey = `${c.id}|${this.st.stayStartedAt ?? 'x'}`;
    const pinned = this.st.lodging
      && this.st.lodging.cityId === c.id
      && this.st.lodging.stayKey === stayKey
      ? (this.st.lodging.value as unknown as Lodging)
      : null;
    let base = override
      ?? pinned
      ?? this.plan?.lodging
      // 最后一个参数：出了国就换那一套房型词（「县城宾馆」不该出现在柏林）。
      // 最后两个参数：出了国就换那一套房型词；地形决定「山景/海景/湖景」能不能开。
      ?? rollLodging(seededRandom(seed), this.isTight(), c.priceIdx, this.purseRich(),
        c.country !== 'CN', terrainOf(c));
    /* 旧存档缺设施就补一次（见 healLodgingFacts）。补上就地用，也写回盘。 */
    const heal = this.healLodgingFacts(base, c.id);
    if (heal.healed) base = heal.lod;
    /*
     * **先看本地真数据，再退回联网查。**（2026-11-09）
     *
     * `data/hotel-facts.json` 是 TourMind 拉下来的真店：星级、真价、设施、周边。
     * 有它就不用再问高德 —— 而且高德那条路对海外城市基本是空的。
     *
     * 两条路的差别不只是「有没有名字」：
     * 高德给的是名字 + 猜出来的档次；本地数据给的是**挂牌星级**和**真设施**。
     * 用户已经被「名字猜档次」坑过两次（「汝阳轩源大酒店」二钻 92 块），
     * 所以有真数据时必须用真数据。
     */
    const facts = factsFor(c.id);
    // 已经挂过真名的房型不必再查一次（同一个地方住几天就是同一家）。
    const pois = base.name ? null : (facts.length ? facts : await this.hotels.hotels(c));
    const lodging = withHotel(base, pois, seededRandom(`${seed}|hotel`), c.priceIdx, c.country !== 'CN');
    /*
     * 定下来就记住。`override` 是用户明确要求换（`journey_lodging`），要覆盖旧的。
     * 只有这两种情况写盘 —— 普通重算不写，免得每次重建都落一次文件。
     */
    if (override || !pinned || heal.healed) {
      this.st = {
        ...this.st,
        lodging: {
          cityId: c.id,
          stayKey,
          value: {
            tier: lodging.tier,
            kind: lodging.kind,
            price: lodging.price,
            feel: lodging.feel,
            ...(lodging.name ? { name: lodging.name } : {}),
            ...(lodging.address ? { address: lodging.address } : {}),
            /*
             * 设施与周边（2026-11-12）。
             *
             * **这两行以前不在。** 于是 `feel` 里写着「顶层有个小酒吧」，
             * 晚上问她能不能去喝一杯，她说这家没有 —— 因为校验读的是 `amen`，
             * 而 `amen` 从来没被存过（`state.ts` 的反序列化白名单同样要放行）。
             *
             * 加字段时记住：写口、读口、类型声明，**三处都是白名单**。
             */
            ...(lodging.amen?.length ? { amen: [...lodging.amen] } : {}),
            ...(lodging.around?.length
              ? { around: lodging.around.map((x) => ({ n: x.n, km: x.km })) }
              : {}),
          },
        },
      };
      this.persist();
    }
    this.weather.setKey(this.amapKey());
    // 查不到就是 null —— 作息表照排，只是不排日出、不排夜间出门。
    const w = await this.weather.forecast(c, moment.dateKey).catch(() => null);
    /*
     * 碰面：排表之前先看一眼同城同时段还有谁。
     *
     * 拉的是「这一带这会儿有谁」—— 排完表再说就晚了，作息表里那几个节点已经定好，
     * 想加一句「谁也在这儿」得回头改它。所以顺序是：先看，再排，最后报。
     *
     * 拉不到就是空数组，plan 里也就没有那一句。**不硬凑。**
     */
    const meet = this.meetOptions();
    const slot = slotOf(startHour || 8);
    /*
     * 邻居和邀约**一起拉**，不串行。
     *
     * 两边各自最多 5 秒超时 —— 串着等，最坏 10 秒，而 `rebuildPlan` 是在巡检里
     * 被 await 的：这十秒里作息节点一个都不会推，用户看到的是「她卡住了」。
     * 并行之后最坏 5 秒，而且本来就没有先后关系。
     */
    const [board, inviteRes] = await Promise.all([
      meet
        ? findNeighbors(meet, c.id, slot)
        : Promise.resolve({ list: [] as { pet: string; doing: string }[], pool: 0, ok: true }),
      meet ? listInvites(meet, c.id) : Promise.resolve({ ok: true as const, list: [] }),
    ]);
    this.lastMeetOk = meet ? board.ok : null;
    const neighbors = board.list;
    /*
     * **她发出去的邀约，有人接了没有。**
     *
     * 「一起走」必须两边都动：原来只有接的人会得到约定，发起者永远不知道有没有人应 ——
     * 于是「发完邀请两条鱼一起去」在机制上不可能发生。这里补发起者那半边。
     * 服务端用 owner_seen 保证只返回一次，不会每次排表都重复建约定。
     */
    if (meet && !this.st.pledge) await this.claimTakenInvite(meet, now);
    /*
     * 拉不到就是空数组：没配服务器、旧服务器、没人发，三种在这里没有区别 ——
     * 差别只在**主动问**的时候才说得出来（`journey_accept` 会给出具体原因）。
     *
     * 两种邀约不进叙事：去她现在这座城的（她已经在），和去**她家**的
     * （接了就等于回家，而回家要走 `journey_return_home` 那条路）。
     * 列表里不该出现「看见了但接不了」的东西 —— 那会让她反复去点一个坏按钮。
     */
    const homeId = this.resolveHome().city.id;
    const invites = (inviteRes.ok ? inviteRes.list : [])
      .map((x) => ({
        id: x.id,
        pet: x.pet,
        to: x.to,
        toName: cityById(x.to)?.name ?? x.to,
        days: x.days,
        note: x.note,
      }))
      .filter((x) => x.to !== c.id && x.to !== homeId);
    /*
     * **同一座城、同一天，重建两次必须得出一模一样的表。**
     *
     * 2026-11-07 Mr.Q 的截图：「怎么前脚骑单车后脚变成电瓶车了」——
     * 同一条「去锦里」的节点推了两遍，一次骑共享单车，一次扫电瓶车。
     *
     * 根因：`planDay` 的随机源是 `Math.random`（`inCityMode` 用它挑交通方式，
     * 而单车和电瓶车的耗时不同、`at` 也跟着不同）。plan 只活在内存里，
     * **重启一次就重建一次**，每次重建都重新掷骰子 —— 于是同一件事既换了车、
     * 又因为 `at` 变了骗过了 `lastBeatKey` 那道去重，被推了第二遍。
     *
     * 传种子随机之后，重建是幂等的：同城同日同 shape，结果一模一样。
     * 这不只是修重复推送 —— 已经发生过的事不该因为一次重启被改写。
     */
    const planSeed = `${seed}|plan|${moment.dateKey}|${shape}|${startHour}`;
    const prevPlan = this.plan;
    const fresh = planDay({
      // 同城同时段的邻居，只进叙事，不参与任何计算。
      neighbors,
      // 这个池子今天一共多少只（不分城市）。只给面板看，不进叙事。
      pool: board.pool,
      invites,
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
      // 手上有车就开车去景点（2026-11-06）。买车/租车发生在出发那一步。
      /* 档位要一起传下去 —— 只传油种的话，排程永远按 comfort 算油钱。 */
      car: this.st.car ? { fuel: this.st.car.fuel, tier: this.st.car.tier } : null,
      /*
       * 车里只有一套。第三方打车扩展在场时，排程不再自己叫出租（2026-11-10）——
       * 两边都排，同一天日记两段「打车」、账上两笔钱，怎么解释都像补丁。
       */
      noTaxi: this.taxiYields(),
      // 手头宽才在景点买讲解/观光车（2026-11-06）。和酒店、座位同一个判据。
      comfortable: this.purseRich(),
      /*
       * 一起待着的人（2026-11-08）：交给排程，让「一起」出现在日程和饭菜里，
       * 不只出现在「跟谁约了几天」那一句里。
       */
      mate: this.st.pledge && this.st.pledge.arrivedAt && this.st.pledge.cityId === c.id
        ? this.whoOfPledge(this.st.pledge)
        : undefined,
      /*
       * 熟络度跟着一起下去（2026-11-08）—— 日程要知道「今天能不能说那些话」、
       * 「今天有几处会写到他」。不传就等于两个刚约上的人。
       */
      warmth: this.st.pledge && this.st.pledge.arrivedAt && this.st.pledge.cityId === c.id
        ? this.warmthOf(this.st.pledge)
        : undefined,
      /* 她的口味（2026-11-08）：不想再吃的不会再被排到。 */
      taste: this.tasteForPlan(),
      rnd: seededRandom(planSeed),
      /* 包车还在服务时间内就全程用它（2026-11-11）。判据见 `charterNow()`。 */
      charter: this.charterNow() !== null,
      /*
       * 景区内代步和「手头宽」分开判（2026-11-10）。
       *
       * 那个问的是「住得起哪档店」，这个问的是「腿要不要歇」——
       * 合在一起的后果是**记账一关，景区里永远只能走路**（见 `spotSpendOk`）。
       */
      spotRideOk: this.spotSpendOk(),
      highFitness: this.isHighFitness(),
      lowEnergy: (this.effectiveLifeEnergy() ?? 100) < 40,
    });

    /*
     * 第二道保险：**已经推出去的那一段，一个字都不改。**
     *
     * 种子随机让「同参数重建」幂等，但参数本身会变 —— 钱紧了（`isTight` 进种子）、
     * 换了酒店、`shape` 变了，都会让整天的表重排。那些变化只该影响**还没发生的事**。
     *
     * 判据用 `lastBeatKey` 里那个时刻：它之前的是已经说过的话，之后的是还没到的。
     */
    /*
     * **先给刚排出来的表打上她改过的补丁，再跟已推出的段合并。**
     *
     * 顺序不能反：合并在前、打补丁在后，那些「已经说出去的」格子会被补丁改口 ——
     * 而她上午真去了哪儿是既成事实。补丁只该作用于还没发生的那一段。
     */
    const patched = this.applyPlanPatches(fresh, c.id, moment.dateKey);
    const pushedAt = this.lastPushedAt(moment.dateKey);
    this.plan = prevPlan && prevPlan.dateKey === fresh.dateKey && pushedAt !== null
      ? {
          ...patched,
          beats: [
            ...prevPlan.beats.filter((b) => b.at <= pushedAt),
            ...patched.beats.filter((b) => b.at > pushedAt),
          ],
        }
      : patched;

    /* 上报「我在这儿」。不 await —— 报不上去也不该拖慢她这一天。 */
    if (meet) {
      const doing = this.plan.beats.find((b) => b.kind === 'activity')?.what ?? '';
      void reportPresence(meet, c.id, moment.dateKey, slot, doing);
    }
  },


  /**
   * 记下「这一轮巡检真的跑过了」（2026-11-13）。
   *
   * 这是 `awayMs` 的新基准：Core 在跑就每轮刷新，停摆了才会变旧。
   * 落盘节流见 `SEEN_SAVE_MS` 的说明。
   *
   * **必须放在算完 `awayMs` 之后调用。** 顺序反了差值恒为 0，
   * 「他离开了 14 小时」就永远说不出来 —— 测试里有一条专门钉这个顺序。
   */
  markSeen(realNowMs: number): void {
    if (realNowMs - this.lastSeenSavedMs < SEEN_SAVE_MS) return;
    this.lastSeenSavedMs = realNowMs;
    this.st = { ...this.st, lastSeenAt: new Date(realNowMs).toISOString() };
    this.persist();
  },


  /**
   * 把该说的那一个节点说出来。
   *
   * 关键在「漏掉几轮怎么办」：Core 关了一夜，醒来时可能已经有三个节点过期。
   * **只推最后一个**，并在正文里说明中间跳过了什么。一次推三条会把她变成报站机，
   * 而她本来该像人一样「哦，一觉睡到中午了」。
   */
  /**
   * 「你不在的这段时间」那一小段（2026-11-11）。
   *
   * 用户的原话：「以前关电脑的时候，鱼不是会在电脑启动的时候冒出一堆
   * 电脑关机时候的信息嘛，现在这个功能怎么没有了。」
   *
   * ## 为什么不照旧做法把事件堆回来
   *
   * 旧版本会堆，是因为**事件按时间排队推**，Core 一关就断，开机时队列里
   * 全是过期的，于是一起涌出来 —— 那不是设计，是副作用。`world.ts` 开头写着
   * 为什么后来改了：「醒来时会堆一堆过期事件一起推，她一口气说十条昨天的事。」
   *
   * 所以这里不做「十条」，做**一条摘要**：多久没见 + 这期间她自己做过的事，
   * 最多三件，夹在第一条事件前面。
   *
   * ## 阈值
   *
   * 6 小时。短于这个的多半是「他上班去了」或「睡了一觉」，硬报一句反而啰嗦 ——
   * 那些时候 `skippedNote`（中间跨过了 N 个点）已经够了。
   */
  awayNote(): string {
    const AWAY_MIN_MS = 6 * 3_600_000;
    if (this.awayMs < AWAY_MIN_MS) return '';
    const hours = Math.round(this.awayMs / 3_600_000);
    const span = hours >= 36
      ? `${Math.floor(hours / 24)} 天（约 ${hours} 小时）`
      : `${hours} 个小时`;
    /*
     * 「这期间她做了什么」从今天的作息表里取 —— **不挑睡觉和赶路**，
     * 那两样说了等于没说。最多三件：离开很久的时候全列出来，就又成了报站机。
     *
     * 跨天的话 plan 会被重排，所以这里只有今天的；跨天那段用「多久没见」概括，
     * 不再编细节 —— 编出来的日程不如不说。
     */
    const beats = this.plan?.beats ?? [];
    const did = beats
      .filter((b) => b.kind === 'activity' || b.kind === 'breakfast' || b.kind === 'lunch' || b.kind === 'dinner')
      .slice(-3)
      .map((b) => b.what);
    const body = did.length ? `今天的日程里她已经过了：${did.join('；')}。` : '';
    const where = this.st.phase === 'traveling' ? '还在路上' : `在${this.cityName(this.st.hereId)}`;
    return `（他离开了 ${span}，刚回到屏幕前。这段时间她自己过着 —— 现在${where}。${body}这些只是背景，不用一条条补，也别把这段时间讲成一份报告。）`;
  },


  async advanceBeats(now: Date, city: City, localNow: number, dateKey: string): Promise<void> {
    const plan = this.plan;
    if (!plan) return;
    /*
     * 今天歇着的时候，`activity` 一律不算「该说的」。
     *
     * ro-berry 的反馈：她说累了要歇着，接下来还是按作息出门了 ——
     * 因为「累了」只存在于她说的话里，排好的表一个字没改。这里把表真的改掉。
     * 饭点和回酒店保留：歇着不是绝食。
     */
    const r = this.st.rest;
    const resting = r && r.dateKey === dateKey;
    const due = plan.beats.filter((b) => b.at <= localNow && !(resting && b.kind === 'activity' && b.at >= r.from));
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

    /* 旅行节点反哺 life 五维（不扣钱，请客模式同样生效）。 */
    const tier = plan.lodging?.tier ?? 'budget';
    if (last.kind === 'breakfast') {
      this.queueLifeEffect('旅途早饭', { vitalsDelta: { food: 22 } });
    } else if (last.kind === 'lunch' || last.kind === 'dinner') {
      const richMeal = tier === 'luxury' || this.purseRich();
      this.queueLifeEffect('旅途正餐', {
        vitalsDelta: { food: richMeal ? 36 : 30 },
        ...(richMeal ? { moodlet: { text: '在当地吃了顿顺口的好饭', kind: 'good', hours: 3 } } : {}),
      });
    } else if (last.kind === 'activity') {
      this.queueLifeEffect('逛景点', {
        vitalsDelta: { fun: 14, ...(this.st.mate ? { social: 16 } : {}) },
      });
    } else if (last.kind === 'hotel') {
      const hotelBonus = tier === 'luxury'
        ? { clean: 24, energy: 8 }
        : tier === 'view'
          ? { clean: 20, energy: 5 }
          : tier === 'comfort'
            ? { clean: 16, energy: 3 }
            : { clean: 12 };
      this.queueLifeEffect('回酒店洗漱休息', { vitalsDelta: hotelBonus });
    }

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
  },


  /**
   * 认领一条「我发的、被人接了」的邀约：自己也往那座城走。
   *
   * 语义和「接别人的」完全对称 —— 到了各待同样的天数，谁先到谁等。
   * 差别只在**谁先动**：接的人是当场拍板，发起者是在下一次排表时才看到。
   */
  /**
   * 读 / 写对某个伙伴的印象。
   *
   * 名字必须跟她从池子里看到的一模一样 —— 服务端只给名字，没有 id，
   * 所以这里不做模糊匹配：「小银」匹配到「小银鱼」听起来贴心，
   * 实际会让她把印象记到另一个名字上，而且事后完全看不出来。
   */
  petMemory(name: string, impression: string): { text: string } {
    const pets = this.st.pets ?? {};
    const key = String(name || '').trim();
    if (!key) return { text: this.petListText(pets) };

    const text = String(impression || '').trim();
    const cur = pets[key];
    if (text) {
      this.st = { ...this.st, pets: setPetImpression(pets, key, text) };
      this.persist();
      return {
        text: cur
          ? `记下了。跟${key}一起走过 ${cur.times} 次，现在你对他的是：「${text}」`
          : `记下了：「${key}」—— 「${text}」。不过你还没跟他一起走过，这条只是印象。`,
      };
    }
    if (!cur) {
      return {
        text: `你跟「${key}」没一起走过。名字要跟池子里显示的一字不差 —— `
          + '不带名字调一次，我把记得的人都列给你。',
      };
    }
    return {
      text: `${key}：一起走过 ${cur.times} 次${cur.last ? `，上次 ${cur.last}` : ''}。`
        + (cur.impression ? `你的印象：「${cur.impression}」` : '还没写过印象。'),
    };
  },


  /** 名单。按「上次见面」倒序 —— 最近一起玩过的人排前面。 */
  petListText(pets: PetsMap): string {
    const list = Object.entries(pets)
      .sort((a, b) => String(b[1].last || '').localeCompare(String(a[1].last || '')));
    if (!list.length) {
      return '还没跟谁一起走过。等哪天接了谁的邀约，我会记一笔 —— 到那时你再写印象。';
    }
    return list.map(([n, p]) => `${n}：${p.times} 次`
      + (p.last ? `，上次 ${p.last}` : '')
      + (p.impression ? `；「${p.impression}」` : '；没写印象')).join('\n');
  },


  /**
   * 她的口味：地方、吃食、景色。
   *
   * 不带参数就是读。带 kind + name 就是写一条（`like` 默认 true）。
   *
   * 三处刻意的取舍：
   *
   * 1. **只收这三类。** 多开一类，她就得先想「这个算哪类」—— 分类成本高于记录价值，
   *    最后一条都不会写。
   * 2. **名字按原样存，不改写。** 「牦牛肉汤」不要被规整成「牛肉汤」：
   *    她下次想吃的是那一碗，不是任何一碗。
   * 3. **不喜欢的也要记。** 只记喜欢的，推荐永远在扩大，不会收窄。
   */
  taste(kind: string, name: string, note: string, like: boolean | undefined): { text: string } {
    const k = String(kind || '').trim() as TasteKind;
    const key = String(name || '').trim();
    const cur = this.st.taste ?? emptyTaste();

    if (!key) {
      const said = tasteSummary(cur);
      return {
        text: said
          ? `你现在记着这些：\n${said}\n\n要加一条就说清哪一类、叫什么、为什么。`
          : '你的口味表还是空的。吃过什么好吃的、看过什么叫你停下来的，都能记一条 —— '
            + '地方、吃食、景色三类。',
      };
    }
    if (!TASTE_KINDS.includes(k)) {
      return {
        text: `「${kind || '空'}」不是能记的一类。只有三类：place（地方）、food（吃食）、scenery（景色）。`,
      };
    }

    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    const dateKey = here
      ? localMoment(this.worldNow(), here.tz).dateKey
      : new Date().toISOString().slice(0, 10);

    /*
     * 「地方」存的是**一座城一张**照片，不是每个景点一张。
     *
     * Mr.Q 的原话：「地方指的是一个城市选一张她最喜欢的图片，如果每个风景点都算进去，
     * 那照片就太多了」。所以这里按城市名去相册里找那一座城最近拍的那张；
     * 她要是写了个景点名（玉泉观），先按景点找，找不到再按城市找 —— 两种写法都别落空。
     */
    const photo = k === 'place' ? (this.cityPhotoOf(key) ?? '') : '';
    this.st = { ...this.st, taste: setTaste(cur, k, key, note, like !== false, dateKey, photo) };
    this.persist();
    const label = k === 'place' ? '地方' : k === 'food' ? '吃食' : '景色';
    const why = String(note || '').trim();
    return {
      text: `记下了（${label}）：${key}${like === false ? ' —— 不喜欢，以后别再推荐' : ''}`
        + (why ? `，理由是「${why}」` : '')
        + (photo ? `。配的是你在${key}拍的那一张（${this.photoTitleOf(photo) ?? '相册里那张'}）` : '')
        + `。记在 ${dateKey}，跟人走 —— 换台机器也还在。`,
    };
  },


  /** 今晚住哪儿。不带参数就是读。 */
  lodgingInfo(): { text: string } {
    const here = this.cityOrNull(this.st.hereId);
    if (!here || this.st.phase !== 'staying' || !this.plan) {
      return {
        text: '她这会儿不在住处 —— 在路上，或者还没落脚。别替她编一间房出来。',
      };
    }
    const l = this.plan.lodging;
    return {
      text: `今晚住 ${lodgingLabel(l)}，一晚 ${l.price} 块左右。${l.feel}`
        + (l.address ? `地址在${l.address}。` : '')
        + ' 想换一家就说一声。',
    };
  },


  /**
   * 在当地租一辆车（2026-11-06）。
   *
   * 三个前置：**人在城里**（路上租不了，落地才是「当地」）、**手上没车**（一辆够用）、
   * **钱够**（记账开着才判）。三条都在扣钱之前，跟 `takeInvite` 同一条规矩：
   * 先看清，再答应。
   *
   * 租到之后 `this.plan = null`，下一次巡检会重建当天的作息 —— 城里那几个点
   * 就从「走过去」变成「开车去」。**不手动 rebuild**：`rebuildPlan` 从 0 点重排，
   * 晚上八点调它会多推一串已经过去的时间点，而 `lastBeatKey` 只挡得住重复的、
   * 挡不住顺序乱。
   */
  /**
   * 今天剩下的不逛了，真的歇下来（2026-11-07）。
   *
   * **不清 `this.plan`。** 清了会让下一轮巡检从 0 点重排当天，把上午已经推过的
   * 作息整段重推一遍（144 天长跑在租车那版抓过这个，见 `rentCar` 的注释）。
   * 这里只落一个 `rest` 标记，`advanceBeats` 自己会跳过被它盖住的 `activity`。
   */
  async restNow(reason: string): Promise<{ text: string; isError?: boolean }> {
    if (this.st.phase !== 'staying') {
      return { text: '她这会儿不在城里待着 —— 这个动作只在停留时有用。路上照样会累，但那是另一回事。', isError: true };
    }
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '连自己在哪都不知道，歇不了。', isError: true };
    if (!this.plan) return { text: '今天还没排表，等一下再说。', isError: true };

    const now = this.worldNow();
    const moment = localMoment(now, here.tz);
    const cur = this.st.rest;
    if (cur && cur.dateKey === moment.dateKey) {
      return { text: '今天已经歇着了 —— 剩下的点不会再出门，明天照原计划。' };
    }
    const why = reason.trim() || '累了';

    this.st = {
      ...this.st,
      rest: { dateKey: moment.dateKey, from: moment.decimal, reason: why },
    };
    this.persist();

    /*
     * 数一下还剩几个点被砍掉 —— 回执里给个具体数，她才知道自己说了算不算。
     * 一个都没有（比如已经晚上了）也要照实说，否则她会以为自己白折腾一趟。
     */
    const left = this.plan.beats.filter((b) => b.kind === 'activity' && b.at >= moment.decimal).length;
    return {
      text: left > 0
        ? `好，今天剩下那 ${left} 个点不去了（${why}）。在${here.name}待着，`
          + '饭点照常吃、晚上照常回酒店，明天照原计划。'
        : `今天本来也没什么点剩下了（${why}）—— 那就早点歇，明天照原计划。`,
    };
  },


  async rentCar(
    days: number,
    ev?: boolean,
    /** 车的档。不传按 `comfort` —— 就是原来那个 200/天的价。 */
    tier?: CarTier,
  ): Promise<{ text: string; isError?: boolean }> {
    if (this.st.phase === 'traveling') {
      return { text: '她在路上，租不了车 —— 到了地方再说，那时候才叫「当地」。', isError: true };
    }
    if (this.st.car) {
      const cur = CAR_TIERS[this.st.car.tier ?? 'comfort'];
      const left = this.st.car.days > 0 ? `还剩 ${this.st.car.days} 天` : '一直能用';
      return { text: `已经有车了（${cur.name}，${left}）—— 一辆够用，不用再租。`, isError: true };
    }
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '连自己在哪都不知道，租不了车。', isError: true };

    /*
     * 天数要夹住。`days === 0` 不能走 `|| 3`（它 falsy）：0 在 `car` 里的语义是
     * 「自己的车、不递减」，拿它当「没填」就会静默租三天 —— 用户说「就今天一天」，
     * 账单上却是六百。
     */
    const n = days === undefined || days === null || !Number.isFinite(Number(days))
      ? 3
      : Math.min(7, Math.max(1, Math.round(Number(days))));
    /* 没填或不认识的档按 comfort（原来的默认价），不因为一个坏参数就给她降级或涨价。 */
    const t: CarTier = tier === 'economy' || tier === 'luxury' ? tier : 'comfort';
    const spec = CAR_TIERS[t];
    const fee = spec.price * n;
    const left = this.cfg.moneyEnabled && this.cfg.budget > 0
      ? this.cfg.budget - (this.st.spent - this.st.earned)
      : null;
    if (left !== null && left < fee) {
      return {
        text: `租金 ${fee} 块（${spec.name}一天 ${spec.price}），她手上只剩 ${Math.max(0, Math.round(left))} 块，`
          + '租不起。跟他说实话：坐公交、或者等她打完工攒够了再说 —— 别答应下来。',
        isError: true,
      };
    }

    /* 不指定就按车行的库存掷（四成电车），和城际自驾那条用同一个比例。 */
    const fuel: 'oil' | 'ev' = ev === undefined ? (Math.random() < 0.4 ? 'ev' : 'oil') : ev ? 'ev' : 'oil';
    if (this.cfg.moneyEnabled) this.addSpent(fee);
    this.st = { ...this.st, car: { fuel, days: n, km: 0, tier: t } };
    /*
     * **不动 `this.plan`。**
     *
     * 试过清空让下一轮重建，结果 144 天的 goto 档抓到重复事件
     * `beat-2027-01-10-commute-14.25`：`rebuildPlan` 从 0 点重排，
     * 下午租车会把当天上午的作息整段重推一遍，而 `lastBeatKey` 只记最后一条，
     * 挡不住顺序被打乱。手动 `rebuildPlan(now, 'full', 当前时刻)` 也有同一类风险
     * （会丢掉「此刻正在做什么」）。
     *
     * 所以当天剩下的点还是按原计划走，**明天跨天重建时自然开车**。
     * 回执里照实说：「明天起」。
     */
    this.persist();

    const what = `${spec.name}${fuel === 'ev' ? '，电车' : ''}`;
    await this.push(
      'journey.car',
      `car-rent-${this.st.hereId}-${this.worldNow().getTime().toString(36)}`,
      `在${here.name}租了辆车（${what}），${n} 天，${fee} 块。`
      + '明天起城里那几个点开车去，油钱按公里算。',
      'flush',
    );
    return {
      text: `租好了：${here.name}一辆${what}，${n} 天，${fee} 块（一天 ${spec.price}）。`
        + `车的感觉：${spec.feel}。`
        + '今天剩下的安排不动，**明天起**城里也开车。到期自动还，不用特意记。',
    };
  },


  /**
   * 换一家。
   *
   * 2026-11-05 Mr.Q：「换酒店直接两种模式都打开吧，用户让肥鱼换，肥鱼可以换」。
   *
   * 「两种模式」是**记账开 / 记账关**。记账关着的时候 `isTight()` 恒为 false，
   * 原来那条「钱紧了、日切时把 plan 清掉重掷」永远不触发 ——
   * 也就是说没开记账的人，让鱼换酒店，鱼一辈子都换不了。现在这个动作不看钱袋档位，
   * 只看「人在不在住处」。
   *
   * 三件事是刻意的：
   *
   * 1. **差价照实记，但只在记账开着时记。** 关着的时候钱根本不存在，
   *    替用户扣一笔，他会莫名其妙看到「今天花了三百」。
   * 2. **用真随机，不用种子随机。** 换房是人的决定，不是可复现的推演；
   *    种子随机会让同一句话说两遍换到同一间房 —— 那就成了没换。
   * 3. **换完就说清「今晚就住这儿」。** 不提醒的话，她下一句还会提上一家的名字，
   *    而那个名字已经不在时间轴上了。
   */
  async changeLodging(want: string, reason: string): Promise<{ text: string }> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here || this.st.phase !== 'staying' || !this.plan) {
      return {
        text: '她这会儿不在住处 —— 在路上，或者还没落脚，换不了房。跟他说等住下来再说。',
      };
    }
    const cur = this.plan.lodging;
    const w: LodgingWant = want === 'cheaper' || want === 'nicer' ? want : 'any';

    const base = rerollLodging(cur, Math.random, this.isTight(), here.priceIdx, w,
      this.purseRich(), here.country !== 'CN', terrainOf(here));
    /*
     * 「换便宜点」但已经到底了：`rerollLodging` 会原样返回。
     * 这时候**不要假装换了**，也不要为了「换」而涨价 —— 直说一句就够。
     */
    if (base.kind === cur.kind && base.price === cur.price) {
      return {
        text: `${lodgingLabel(cur)} 已经是这一带最便宜的了（一晚 ${cur.price} 块），今晚先住这儿。`
          + '再往下就只有车站边那种地方，不值得。',
      };
    }
    this.hotels.setKey(this.amapKey());
    this.eateries.setKey(this.amapKey());
    /*
     * **换房时要排掉现在这家。**
     *
     * 2026-11-09 修：同档真店常常只有两三家（县城更少），随机抽很容易抽回原处 ——
     * 用户看到的是「说换了，房没变」。排掉当前店名再抽，抽不到就是抽不到（那说明这一带就这几家）。
     */
    const facts = factsFor(here.id).filter((f) => f.name !== cur.name);
    const pois = base.name ? null : (facts.length ? facts : await this.hotels.hotels(here).catch(() => null));
    const next = withHotel(base, pois, Math.random, here.priceIdx);

    const diff = next.price - cur.price;
    if (this.cfg.moneyEnabled && diff > 0) this.addSpent(diff);
    if (this.cfg.moneyEnabled && diff < 0) {
      this.st = { ...this.st, spent: Math.max(0, this.st.spent + diff) };
    }

    /*
     * 重排一遍作息，而不是只把 plan.lodging 换个对象。
     *
     * 时间轴上写着「回老城民宿。院里有棵老树…」—— 只换字段的话，那几句还是旧的，
     * 晚上那条节点会当着用户的面说错店名。重建的代价是重查一次天气和邻居（几秒），
     * 换来的是全天节点都和房对得上。
     */
    await this.rebuildPlan(this.worldNow(), 'full', 0, here, next);
    this.persist();

    const why = String(reason || '').trim();
    const money = diff === 0
      ? '价钱一样'
      : diff > 0 ? `比刚才贵 ${diff} 块` : `比刚才省 ${-diff} 块`;
    const floor = w === 'cheaper' && diff >= 0 ? '这一档已经是最便宜的了。' : '';
    return {
      text: `换到 ${lodgingLabel(next)} 了，一晚 ${next.price} 块，${money}。${next.feel}`
        + floor
        + (why ? `（理由是：${why}）` : '')
        + ' 今晚就住这儿 —— 别再说上一家的名字。',
    };
  },


  /**
   * 记一次「跟这个人一起走过」。
   *
   * 只记名字和日期，**不记印象**。次数是事实（接了就是一次），印象是判断
   * （要真的相处过才写得出来）—— 两件事混在一起，自动生成的那句必然变成套话。
   * 印象由她自己用 `journey_pet` 写。
   */
  /**
   * 记住一个一起走过的人。`warm` 是这一笔涨多少熟络度（2026-11-08）——
   * 接一次约 +6，真的一起到了 +6，同城撞见 +1。
   */
  rememberPet(name: string, warm = 1): void {
    const pet = String(name || '').trim();
    if (!pet) return;
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    // 用她当地的日期，不用 UTC：跨零点的那一趟，UTC 会记成前一天。
    const dateKey = here
      ? localMoment(this.worldNow(), here.tz).dateKey
      : new Date().toISOString().slice(0, 10);
    this.st = { ...this.st, pets: metPet(this.st.pets ?? {}, pet, dateKey, warm) };
  },


  /** 排程要的口味形状：只要名字，分喜欢/不想再吃两栏。 */
  tasteForPlan(): { like: string[]; dislike: string[] } {
    const food = this.st.taste?.food ?? [];
    return {
      like: food.filter((x) => x.like).map((x) => x.name),
      dislike: food.filter((x) => !x.like).map((x) => x.name),
    };
  },


  /**
   * 这份约定里，她最熟的那个人的熟络度。
   *
   * 一群人一起走的时候取最大值 —— 问「这趟跟谁最熟」比问平均值有意义。
   */
  warmthOf(p: { withPet: string; withPets?: readonly string[] }): number {
    const names = p.withPets?.length ? p.withPets : [p.withPet];
    let best = 0;
    for (const raw of names) {
      const name = String(raw || '').trim();
      const w = name ? (this.st.pets?.[name]?.warmth ?? 0) : 0;
      if (w > best) best = w;
    }
    return best;
  },


  /* ---------------- 指定去哪、怎么去 ---------------- */

  /**
   * 用户说了「去哪 / 怎么去」。
   *
   * ## 为什么要有这个工具
   *
   * 2026-11-05 一位用户来信：「我喊桌宠坐高铁从常熟去上海，桌宠刚答应，
   * 插件转头安排它蹬自行车 80 公里去上海」。查下来不是哪一步写错了，
   * 是**整条路上没有「交通方式」这个输入** —— 目的地可以记（`journey_draw_to`），
   * 回家可以叫（`journey_return_home`），唯独「用什么去」永远由代码掷骰子。
   *
   * 所以她答应得越好听，下一句越像在骗人：她说坐高铁，四十分钟后
   * `journey.depart` 推来一句「山西路服务区加油」。
   *
   * ## 三条边界
   *
   * 1. **不替她挑目标**：`city` 必填。没填就是没听懂，交回去问。
   * 2. **不覆盖回家**：去家那座城要走路 `journey_return_home` ——
   *    到了家意味着一趟结束（结账、进休息期），那条路 `moveOn` 不知道。
   * 3. **不许静默换方式**：要的方式不可用就说明原因，不偷偷改成另一种。
   *    这正是用户抱怨的那件事。
   */
  /**
   * 改今天还没去的那一格（2026-11-09）。
   *
   * ## 为什么要有它
   *
   * 用户来信（清风乱域）：「我的鱼说想更改安排，发现更改不了。本来她想去故宫，
   * 但是被安排推着去了颐和园。」
   *
   * 查下来 `journey_go_to` 只管「去哪座城」；城里一天去哪两处由 `planDay`
   * 按 `dayIndex` 排死，**没有任何入口能改**。她说「我想改安排」的时候，
   * 是在承诺一件工具做不到的事 —— 比不答应更坏。
   *
   * ## 三条边界
   *
   * 1. **只改还没到的**（`at > 现在`）。已经说过的话不改口：她说上午去了颐和园，
   *    下午就不可能「其实我上午在故宫」。
   * 2. **只能改这座城真有的地方**（`city.slots`）。匹配不上就把这座城有的列出来 ——
   *    编一个不存在的地名，出图、日记、景点讲解全都接不上。
   * 3. **改完要留痕**（`planPatches`）。日程会重算，不记账就变回去。
   */
  /**
   * 把今天改过的行程重新贴到新排出来的表上（2026-11-09）。
   *
   * 日程会被重算（刷新面板、钱紧了、换酒店），`planDay` 每次都给一份「原样」的表。
   * 不贴补丁的话，她说「改好了」，用户下一次刷新看到的又变回颐和园 ——
   * 那不是「改不了」，是「改了骗你」，更坏。
   *
   * 只按 `at` 对齐；`fromSpot` 用来把「坐公交去X」那格也换掉。
   *
   * 2026-11-10：匹配时带上 `kind`。原来这里写死 `b.kind === 'activity'`，
   * 只能重贴景点那一格 —— 早饭、起床、夜里改了就贴不回去，等于「改了骗你」。
   * `x.kind` 缺省当 `activity`（老状态文件、`changePlan` 写的补丁都没这个字段）。
   */
  applyPlanPatches(plan: DayPlan, cityId: string, dateKey: string): DayPlan {
    const mine = this.st.planPatches.filter((x) => x.dateKey === dateKey && x.cityId === cityId);
    if (!mine.length) return plan;
    const beats: DayPlan['beats'][number][] = plan.beats.map((b) => {
      const act = mine.find((x) => x.at === b.at && (x.kind ?? 'activity') === b.kind);
      if (act) return { ...b, what: act.what, spot: act.spot };
      const ride = mine.find(
        (x) => x.fromSpot && b.kind === 'commute' && b.at <= x.at && b.what.includes(x.fromSpot),
      );
      if (ride?.fromSpot) return { ...b, what: b.what.replace(ride.fromSpot, ride.spot) };
      return b;
    });
    /*
     * 补上「新增的格」（2026-11-13）。
     *
     * 上面那个 map 只能改已有的一格 —— 凌晨那几小时日程表里本来就没有，
     * 补丁点名了一个表上没有的时刻，map 转一圈也碰不到它，于是
     * `journey_set_slot` 回了「记上了」、面板上却什么都没有。
     *
     * **只认 `kind === 'beat'`**：景点那格必须由 `changePlan` 带通勤格一起换，
     * 酒店那格要按这家店真有的设施给选项 —— 让它们凭空长出一格就是另一类错。
     *
     * 去重按「同一时刻已经有同类型的格」：`setSlot` 落盘后会立刻再调一次本函数，
     * 而那时传进来的 `plan` 已经含上一次插入的格，不去重就会一小时里长出两格。
     */
    for (const x of mine) {
      if (x.kind !== 'beat') continue;
      if (beats.some((b) => b.at === x.at && b.kind === 'beat')) continue;
      beats.push({ at: x.at, kind: 'beat', what: x.what });
    }
    beats.sort((a, b) => a.at - b.at);
    return { ...plan, beats };
  },


  /** 往今天的时间轴上插一段（2026-11-09）。`changePlan` 和两个新工具都用它。 */
  pushBeat(at: number, what: string): void {
    if (!this.plan) return;
    const beats = [...this.plan.beats, { at, kind: 'beat' as const, what }];
    beats.sort((a, b) => a.at - b.at);
    this.plan = { ...this.plan, beats };
  },


  /**
   * 今晚在住处干什么（2026-11-09）。
   *
   * Mr.Q：「加上具体酒店信息了，晚上的语句是不是也可丰富的多了，
   * 甚至可以让桌宠自己靠设备自己选择发生什么事件。」
   *
   * 以前这一步只有 `planDay` 按档位自动决定，她插不上手。现在：
   * 选项来自**这家店真有的设施**（`hotelNightOptions`），她挑一个，
   * 挑得到就执行、挑不到就说清没有 —— 而不是硬演一段。
   */
  async hotelNight(whatRaw: string): Promise<{ text: string; isError?: boolean }> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here || this.st.phase !== 'staying' || !this.plan) {
      return { text: '她这会儿不在住处 —— 在路上，或者还没落脚。等住下来再说。', isError: true };
    }
    const now = localMoment(this.worldNow(), here.tz).decimal;
    /*
     * 白天不问「今晚干什么」。17 点以后才算晚上 ——
     * 用户下午三点问「晚上干嘛」，她答一段晚上的事，时间轴就对不上了。
     */
    if (now < 17) {
      return { text: `这会儿才 ${fmtHour(now)}，还没到晚上。等天黑了再说。`, isError: true };
    }

    /*
     * 住处缺设施就地补一次（2026-11-12）。
     *
     * 不能只靠 `rebuildPlan` 那条路——它可能到日切才再跑一次，
     * 而用户此刻正在问「去酒吧喝一杯」，等不到那时候。
     * 补完写回 `plan` 与 state，下一次就不用再查。
     */
    const heal = this.healLodgingFacts(this.plan.lodging, here.id);
    if (heal.healed) {
      this.plan = { ...this.plan, lodging: heal.lod };
      if (this.st.lodging) {
        const v = this.st.lodging.value;
        this.st = {
          ...this.st,
          lodging: {
            ...this.st.lodging,
            value: {
              ...v,
              ...(heal.lod.amen?.length ? { amen: [...heal.lod.amen] } : {}),
              ...(heal.lod.around?.length
                ? { around: heal.lod.around.map((x) => ({ n: x.n, km: x.km })) }
                : {}),
            },
          },
        };
      }
      this.persist();
    }
    const lod = this.plan.lodging;
    /*
     * 夜间「出门转转」说哪儿：**优先用问道采到的具体地点**（162 城有），
     * 其次 `nightIn` 那一句，都没有才说通用的话。
     *
     * `nightIn` 会按月份过滤 —— 漠河「等极光」只在 9–3 月成立，
     * 夏天说这句就是编的。直接用 `here.night` 还会撞上 `{ text, months }`
     * 变成「出门去了[object Object]」（2026-11-09 长跑抓到）。
     */
    const month = Number(localMoment(this.worldNow(), here.tz).dateKey.slice(5, 7));
    const nightLine = playLine(here.id) || (nightIn(here, month) ?? '');
    const opts = hotelNightOptions(lod.tier, lod.amen, lod.around, nightLine);
    const want = whatRaw.trim();
    const hit = opts.find((o) => o.what === want) ?? opts.find((o) => o.label.includes(want));
    if (!hit) {
      const list = opts.map((o) => (o.price > 0 ? `${o.label}（${o.price} 块）` : o.label)).join('、');
      const where = lod.name ? `${lod.name}没这个` : '这儿没这个';
      /*
       * 这里是整个功能的**边界**：查过没有就是没有。
       * 编一个「在泳池里游了二十分钟」，用户上携程一看没泳池 —— 第三次返工。
       */
      /*
       * 措辞按「这家店有什么」说，不按「我能选什么」说（2026-11-12）。
       *
       * 原来写的是「今晚能干的：泡澡、在房间待着」—— 那是把内部枚举直接翻成人话，
       * 她一转手就成了「系统只给我泡澡和待屋里两个选项」（西安实测原话）。
       * 回执是事实、不是台词，那就别再带「能干 / 可选 / 选项」这类清单口气。
       */
      return { text: `${where}。有的就这些：${list}。`, isError: true };
    }

    if (hit.price > 0) {
      const left = this.cfg.budget - (this.st.spent - this.st.earned);
      if (this.cfg.moneyEnabled && this.cfg.budget > 0 && left < hit.price) {
        return { text: `${hit.label}要 ${hit.price} 块，手头不够（还剩 ${Math.max(0, Math.round(left))} 块）。换一个不要钱的。`, isError: true };
      }
      this.addSpent(hit.price);
    }
    this.pushBeat(Math.min(now + 0.1, 23), hit.text);
    if (hit.what === 'pool') {
      this.queueLifeEffect('酒店泳池游泳', { vitalsDelta: { clean: 25, fun: 15 }, fitnessDelta: 1.5 });
    } else if (hit.what === 'onsen' || hit.what === 'spa') {
      this.queueLifeEffect(`酒店${hit.label}`, {
        vitalsDelta: { clean: 30, energy: 15, fun: 12 },
        moodlet: { text: `在酒店做完${hit.label}，浑身都松快了`, kind: 'good', hours: 4 },
      });
    } else if (hit.what === 'bath') {
      this.queueLifeEffect('酒店泡澡', { vitalsDelta: { clean: 20 } });
    } else if (hit.what === 'gym') {
      this.queueLifeEffect('酒店健身房', { vitalsDelta: { fun: 10, energy: -8, clean: -8 }, fitnessDelta: 2 });
    } else {
      this.queueLifeEffect(`酒店夜间：${hit.label}`, { vitalsDelta: { fun: 12 } });
    }
    this.persist();
    return { text: hit.text + (hit.price > 0 ? `（花了 ${hit.price} 块）` : '') };
  },


  /**
   * 景区里怎么代步（2026-11-09）。
   *
   * Mr.Q：「爬山、景区交通得能用啊，要不一天靠走路可以嘛？」
   *
   * 以前 `pickSpotExtra` 只是在排程时写一句「坐索道上去的」再记笔钱 ——
   * **没有工具能执行**。用户说「坐索道上山」，她手里空的，只能说「我这儿没找着」。
   *
   * 现在：按所在景点给出真有的选项、报出票价、扣钱、写进时间轴。
   * 「自己走」永远可选 —— 问「一天靠走路可以吗」，答案是「可以，但腿会酸」。
   */
  async spotRide(howRaw: string, spotRaw: string): Promise<{ text: string; isError?: boolean }> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here || this.st.phase !== 'staying' || !this.plan) {
      return { text: '她这会儿不在景点里 —— 在路上，或者还没落脚。', isError: true };
    }
    const now = localMoment(this.worldNow(), here.tz).decimal;

    /* 此刻所在的那一处：当天最后一条 activity，且开始不超过三小时。 */
    const acts = this.plan.beats.filter((b) => b.kind === 'activity' && b.at <= now);
    const cur = acts[acts.length - 1];
    const spot = (spotRaw.trim() || cur?.spot || '').trim();
    if (!spot) {
      return { text: `她现在不在景点里（当地 ${fmtHour(now)}）。景区里的车票得人到了才买得上。`, isError: true };
    }
    /* 没指定地点时，必须是「此刻真的在那儿」—— 离开三小时以上就不算。 */
    if (!spotRaw.trim() && (!cur || now - cur.at > 3)) {
      return { text: `这会儿已经不在${spot}了（当地 ${fmtHour(now)}）。要坐哪儿的车，得说明是在哪个景点。`, isError: true };
    }

    const opts = spotRideOptions(spot);
    const want = howRaw.trim();
    const hit = opts.find((o) => o.how === want) ?? opts.find((o) => o.label.includes(want));
    if (!hit) {
      const list = opts.map((o) => (o.price > 0 ? `${o.label}（${o.price} 块）` : o.label)).join('、');
      return { text: `${spot}没有这个。这儿能选的是：${list}。`, isError: true };
    }

    if (hit.price > 0) {
      const left = this.cfg.budget - (this.st.spent - this.st.earned);
      if (this.cfg.moneyEnabled && this.cfg.budget > 0 && left < hit.price) {
        return { text: `${hit.label}要 ${hit.price} 块，手头不够（还剩 ${Math.max(0, Math.round(left))} 块）。要不走上去。`, isError: true };
      }
      this.addSpent(hit.price);
    }
    const line = hit.text.includes('%s') ? hit.text.replace('%s', spot) : hit.text;
    this.pushBeat(Math.min(now + 0.15, 23.5), line);
    this.persist();
    return { text: line + (hit.price > 0 ? `（${hit.price} 块）` : '') };
  },


  async changePlan(wantRaw: string, insteadRaw: string): Promise<{ text: string; isError?: boolean }> {
    const now = this.worldNow();
    if (this.st.phase === 'traveling') {
      return { text: '她在路上，今天没有城里的行程可改。等到了再说。', isError: true };
    }
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '她现在不在城里，改不了今天的行程。', isError: true };
    if (!this.plan) return { text: '今天的日程还没排出来。等一下再问。', isError: true };

    const want = wantRaw.trim();
    if (!want) return { text: '要改成哪儿？地名说清楚再动。', isError: true };

    const spots = here.slots;
    const hit = matchSpot(spots, want);
    if (!hit) {
      const few = spots.slice(0, 8).join('、');
      return {
        text: `${here.name}没有「${want}」。这座城能去的是：${few}。`
          + '换一个，或者跟他说清想干什么（想看什么、想吃什么），别自己编一个地名。',
        isError: true,
      };
    }

    const nowHour = localMoment(now, here.tz).decimal;
    const ahead = this.plan.beats.filter((b) => b.kind === 'activity' && b.at > nowHour);
    if (!ahead.length) {
      return {
        text: `今天该逛的都逛完了（这会儿当地 ${fmtHour(nowHour)}）。要加地方就明天说，或者用 journey_go_to 换一座城。`,
        isError: true,
      };
    }

    let target = ahead[0]!;
    const instead = insteadRaw.trim();
    if (instead) {
      const found = ahead.find((b) => (b.spot ?? '').includes(instead) || b.what.includes(instead));
      if (!found) {
        const names = ahead.map((b) => b.spot ?? b.what).join('、');
        return { text: `今天还没去的有：${names}。要换其中哪一个？说个名字。`, isError: true };
      }
      target = found;
    }

    const fromSpot = target.spot ?? '';
    if (fromSpot === hit) {
      return { text: `今天本来就要去${hit}，不用改。`, isError: true };
    }

    /*
     * 新的那句怎么拼。
     *
     * 沿用原来的时段前缀（`下午，` / `上午，`），**不重新决定上午下午** ——
     * 换地方不该顺带把时间也改了，那是两件事。
     * 原来没有前缀（就是地名本身，`青城山`）就还是地名。
     */
    const prefix = /^(上午|中午|下午|傍晚)，/.exec(target.what)?.[0] ?? '';
    const what = `${prefix}${hit}`;
    const at = target.at;

    const beats = this.plan.beats.map((b) => {
      if (b === target) return { ...b, what, spot: hit };
      /*
       * 「坐公交去颐和园」那格也得跟着改。
       *
       * 只改活动那格会留下自相矛盾的两行：上面写着去哪儿，下面却是另一个地方。
       * 判据用 `b.at <= at` —— 那一趟一定排在这一格之前。
       */
      if (fromSpot && b.kind === 'commute' && b.at <= at && b.what.includes(fromSpot)) {
        return { ...b, what: b.what.replace(fromSpot, hit) };
      }
      return b;
    });
    this.plan = { ...this.plan, beats };

    /* 记账：只留今天。跨天的补丁没有意义（第二天本来就重排）。 */
    const patch: PlanPatch = {
      dateKey: this.plan.dateKey,
      cityId: here.id,
      at,
      what,
      spot: hit,
      ...(fromSpot ? { fromSpot } : {}),
    };
    this.st = {
      ...this.st,
      planPatches: [
        ...this.st.planPatches.filter((x) => x.dateKey === patch.dateKey && x.at !== at),
        patch,
      ],
    };
    this.persist();

    const was = fromSpot || '原来那一处';
    return {
      text: `改好了：今天 ${fmtHour(at)} 那一格从${was}换成${hit}。`
        + '已经去过的不动 —— 说出去的话不改口。',
    };
  },


  /**
   * 从今天的表里找出要改的那一格（2026-11-10）。
   *
   * 三条路，按优先级：
   * ① **类型词**（「午饭」）→ 该 kind 里还没到的那一格；
   * ② **钟点精确**（±1 分钟）；
   * ③ **钟点就近**（±半小时）—— 用户说「六点吃饭」而表上排的是 18:30，
   *    不该回「没有这一格」，那是把猜错的成本甩给用户。
   *
   * 三种都落空、而这个时刻还没到 → 回 `{ add }`，让调用方**新增一格**。
   *
   * ## 为什么要有第四种（2026-11-13，mrlin97 在 Discussion #586 报的）
   *
   * 日程从 07:00「起床」起排，23:00「睡」收尾 —— **凌晨那几小时根本没有格子**。
   * 于是住在他说的那种情形里：当地 01:06 想安排一段夜里的事，
   * `journey_set_slot` 只能回「01:30 附近没有可改的格子」，那条路是死的。
   * 「改现有的格」和「这一天这一段还没排过」是两件事，得分开走。
   */
  findSlotBeat(
    raw: string,
    nowDecimal: number,
    what = '',
  ): { beat: DayPlan['beats'][number]; approximate?: { asked: number; at: number } }
    | { add: number }
    | { error: string } {
    const plan = this.plan;
    if (!plan) return { error: '今天的日程还没排出来，等一下再问。' };

    /*
     * **通勤格不参与「按钟点挑格」**（2026-11-10，长跑抓到的）。
     *
     * `commute`（「开车去X」「走着去X」）的 at 是 `活动时刻 - 路上分钟/60`，
     * 而 `ride.min` 在「走着去」这类情况下可以是 0 —— 于是它和活动格**同一时刻**。
     * `beats.find` 从数组头开始找，先撞上通勤格，结果：「用车去武侯祠」被改成
     * 用户那句「在家躺着」，景点那格一动没动，两行还自相矛盾。
     *
     * 通勤格本来也不该由用户直接指：换地方走 `journey_plan_change`（连这一格一起换），
     * 换交通方式走 `journey_spot_ride`。把它从候选里剔掉，钟点就只指向真正那件事。
     */
    const pickable = plan.beats.filter((b) => b.kind !== 'commute');

    const kind = parseSlotKind(raw);
    if (kind) {
      const cand = plan.beats.filter((b) => b.kind === kind);
      if (!cand.length) return { error: `今天没有「${raw}」这一格。` };
      const open = cand.filter((b) => b.at > nowDecimal);
      if (!open.length) {
        return { error: `${raw}已经过去了（当地 ${slotClock(nowDecimal)}），改不了 —— 说出去的话不改口。` };
      }
      return { beat: open[0]! };
    }

    const at = parseClock(raw);
    if (at === null) {
      return {
        error: `看不懂这个时刻：${raw || '（空）'}。要 "12:30" 或 "7" 这种写法，`
          + '也可以只说「午饭」「晚饭」「起床」。',
      };
    }

    /*
     * **通勤格先说清楚**（2026-11-17，Donahue 第二批反馈）。
     *
     * 通勤格被 `pickable` 排除之后，用户指到 09:15（「扫了辆电瓶车去拙政园」）时：
     * `exacts` 在 pickable 里找不到它，`near` 会落到旁边 09:30 那个景点格上 ——
     * **报错的格子是错的**，于是模型去改一个用户没提的地方，或者反复试同一个工具。
     *
     * ⚠ 这一段必须排在 `exacts` **之前**：「走着去」的通勤格 `ride.min = 0`，
     * 和活动格同一时刻，`exacts` 会先把活动格抢走，这里就永远轮不到。
     */
    const nearestAny = plan.beats
      .filter((b) => b.at > nowDecimal && Math.abs(b.at - at) <= SLOT_NEAR_HOURS)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (nearestAny?.kind === 'commute') {
      /*
       * 三种情形要分开说，一句话糊过去必错一边：
       *
       * ① 这一刻**只有**通勤格 → 用户真指到了路上，给 `journey_spot_ride`；
       * ② 这一刻还撞着别的格（「走着去」和活动同点）→ **两个都报**，
       *    换地方是 `journey_plan_change`、换走法是 `journey_spot_ride`；
       * ③ 别的格比他更近 → 那才是他要改的，交给下面正常挑。
       */
      const d = Math.abs(nearestAny.at - at);
      const others = plan.beats.filter(
        (b) => b !== nearestAny && Math.abs(b.at - at) <= Math.max(d, 0.02),
      );
      const here = `${slotClock(nearestAny.at)} 那一格是「${slotBrief(nearestAny.what)}」—— 路上的事，不在这儿改。`;
      if (!others.length) {
        return { error: `${here}换走法用 journey_spot_ride；换了目的地，这一格会自己跟着变。` };
      }
      return {
        error: `${here}这一刻还有「${slotBrief(others[0]!.what)}」—— `
          + '换地方用 journey_plan_change，换走法用 journey_spot_ride，别用这个改。',
      };
    }

    const exacts = pickable.filter((b) => Math.abs(b.at - at) < 0.02);
    if (exacts.length) {
      const hit = exacts[0]!;
      if (hit.at <= nowDecimal) {
        return { error: `${slotClock(hit.at)} 这一格已经过去了，改不了 —— 说出去的话不改口。` };
      }
      // 万一还剩两格同点，优先挑能自由改的那格；全是保护格就交给 setSlot 去给正确入口。
      const open = exacts.find((b) => b.kind !== 'activity' && b.kind !== 'hotel');
      return { beat: open ?? hit };
    }

    /*
     * **「要改成什么」里点了名，就以名为准**（2026-11-17）。
     *
     * 「19:00，晚饭吃火锅」—— 表里晚饭是 18:30，人不会精确记住那一刻，
     * 而她说的事很明确。所以钟点落空之后先看 `what` 有没有「早饭/午饭/晚饭/起床/睡」
     * 这类词（`parseSlotKind` 认的那一套），有就直接改那一格。
     *
     * 这一条和下面的容差收窄是配套的：容差只用来兜「说了 12 点、表上 12:05」，
     * **真正决定改哪格的依据是「她要做的是哪件事」，不是「分钟差多少」**。
     */
    const byWhat = what ? parseSlotKind(what) : null;
    if (byWhat) {
      const cand = plan.beats.filter((b) => b.kind === byWhat && b.at > nowDecimal);
      if (cand.length) {
        const hit = cand[0]!;
        return Math.abs(hit.at - at) > 0.02
          ? { beat: hit, approximate: { asked: at, at: hit.at } }
          : { beat: hit };
      }
    }

    /*
     * 近似命中：容差**从半小时收到一刻钟**（2026-11-17）。
     *
     * 原来 0.5 小时，于是「6:30 出门」被悄悄算成「7:00 起床」那格 ——
     * 用户报的是「改成了七点、内容里又写六点半，前后重复」，根子在这一行。
     * 一刻钟能兜住「说了 12 点、表上 12:05」这种口误，兜不住「差半小时」的错格；
     * 兜不住就会走下面的 `add`，给她真的加一格 6:30。
     */
    const near = pickable
      .filter((b) => b.at > nowDecimal && Math.abs(b.at - at) <= SLOT_NEAR_HOURS)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (near) {
      /* 近似命中要带回去，让回执说得出「我改的是哪一格」—— 不静默替换。 */
      return Math.abs(near.at - at) > 0.02 ? { beat: near, approximate: { asked: at, at: near.at } } : { beat: near };
    }

    /*
     * 表上没有这一格。
     *
     * 先挡住「改过去」：这一刻已经过了的话，新增一格等于给历史补一条 —
     * 那和她「说出去的话不改口」是同一条边界的另一面。
     * 报错照样把今天剩下的列出来 —— 只报错不给替代，她只能干瞪眼。
     */
    if (at <= nowDecimal) {
      const table = pickable
        .filter((b) => b.at > nowDecimal)
        .map((b) => `${slotClock(b.at)} ${slotBrief(b.what)}`)
        .join('、');
      return {
        error: `${slotClock(at)} 已经过去了（当地 ${slotClock(nowDecimal)}），改不了 —— 说出去的话不改口。`
          + `今天剩下的：${table || '（没了）'}`,
      };
    }
    return { add: at };
  },


  /**
   * 改今天某一点吃什么、做什么（2026-11-10 加，源自用户「清风乱域」的补丁）。
   *
   * 和 `changePlan` 的分工：那个换景点（要校验城里真有），这个改作息与吃食 ——
   * 早饭、午饭、晚饭、起床、睡觉、夜里干嘛，都是「人说了就该算数」的事。
   * **两格一样挡回去**：`activity`（交给 `journey_plan_change`）和 `hotel`（交给
   * `journey_hotel_night`）。理由分别在下面两处。
   *
   * 边界跟它一致：不在城里不改、没排表不改、已经过去的不改。
   * 改动照样落 `planPatches`，重排之后贴回去，不会「改了骗你」。
   *
   * ## `hotel` 那格为什么拦下来
   *
   * 晚上在住处干什么，选项来自**这家店真有的设施**（`hotelNightOptions`），
   * 另有一条 `journey_hotel_night` 专管。这里再开一个自由文本的口子，
   * 就会出现「她说在泳池游了二十分钟，用户一查这家店没泳池」——
   * 跟「挂真店名报假房钱」是同一类错。
   *
   * `night`（城里夜里那处）不拦：它没有对应的工具和候选表，拦了就是死路。
   */
  setSlot(timeRaw: string, whatRaw: string): { text: string; isError?: boolean } {
    if (this.st.phase !== 'staying') {
      return { text: '她这会儿不在城里待着 —— 改作息只在停留时有用。', isError: true };
    }
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '连自己在哪都不知道，改不了。', isError: true };
    if (!this.plan) return { text: '今天的日程还没排出来，等一下再问。', isError: true };

    const what = whatRaw.trim().slice(0, 60);
    if (!what) return { text: '要改成什么？说清楚再动。', isError: true };

    const moment = localMoment(this.worldNow(), here.tz);
    const found = this.findSlotBeat(timeRaw, moment.decimal, what);
    if ('error' in found) return { text: found.error, isError: true };
    /*
     * 表上没有这一格 —— **新增一格**（2026-11-13）。
     *
     * 和「改已有的格」是两种语义：那边是 `map` 里换掉一句话，这边是往时间轴上插一段。
     * 落盘仍走 `planPatches`，由 `applyPlanPatches` 在重排之后贴回来 ——
     * 不然下次刷新面板这格就没了，又变成「改了骗你」。
     *
     * `kind` 固定 `beat`：它不是景点（不该带地名）、不是酒店夜里的活动（那个要按
     * 这家店真有的设施给选项）、也不是三餐里的一格（那三格的时刻由日程表决定）。
     */
    if ('add' in found) {
      const at = found.add;
      const added: PlanPatch = {
        dateKey: this.plan.dateKey,
        cityId: here.id,
        at,
        what,
        spot: '',
        kind: 'beat',
      };
      this.st = {
        ...this.st,
        planPatches: [
          ...this.st.planPatches.filter(
            (x) => x.dateKey === added.dateKey
              && !(x.cityId === added.cityId && x.at === added.at && x.kind === 'beat'),
          ),
          added,
        ],
      };
      this.persist();
      this.plan = this.applyPlanPatches(this.plan, here.id, moment.dateKey);
      const left = this.plan.beats
        .filter((b) => b.at > moment.decimal)
        .map((b) => `${slotClock(b.at)} ${slotBrief(b.what)}`)
        .join('、');
      return {
        text: `${slotClock(at)} 这一格今天原来空着，记上了：「${what}」。\n`
          + `今天剩下的：${left || '（没了）'}`,
      };
    }
    const beat = found.beat;

    if (beat.kind === 'activity') {
      /*
       * 景点那格不从这里改（2026-11-10 自己看出来的）。
       *
       * 活动格前面跟着一格 `commute`（「坐公交去武侯祠」）。`changePlan` 专门用
       * `fromSpot` 把那一格一起换掉，注释里写着「只改活动那格会留下『坐公交去颐和园』
       * +『下午，故宫』这种自相矛盾的两行」—— 这里要是不管它，等于把那个坑重挖一遍。
       *
       * 「不去了」和「换个地方」是两件事。换地方归 `journey_plan_change`（它校验
       * 这座城真有那处）；「不去了」还没有对应的语义，不拿自由文本糊过去。
       */
      return {
        text: `${slotClock(beat.at)} 那一格是景点，不在这儿改 —— 换地方用 journey_plan_change`
          + '（它会先确认这座城真有那一处）。',
        isError: true,
      };
    }

    if (beat.kind === 'hotel') {
      return {
        text: `${slotClock(beat.at)} 那一格是在住处干什么。它按这家店真有的设施给选项，`
          + '要用 journey_hotel_night 挑 —— 别在这儿改，改了会说出这家店没有的东西。',
        isError: true,
      };
    }

    /*
     * 非景点的格子没有地名。
     *
     * 原样保留（`beat.spot ?? ''`）—— 上面已经把活动格挡掉了，走到这里的都不带地名。
     */
    const spot = beat.spot ?? '';

    const patch: PlanPatch = {
      dateKey: this.plan.dateKey,
      cityId: here.id,
      at: beat.at,
      what,
      spot,
      kind: beat.kind,
    };
    /*
     * 记账：**只留今天**。
     *
     * `applyPlanPatches` 只按当天的 `dateKey` 取，昨天的补丁永远不会再被读到，
     * 留着只是把存档越撑越大 —— 144 天长跑里改作息 372 次就攒了 372 条，
     * 而且每次重排日程都要把整张表 filter 一遍，越跑越慢。
     *
     * 同一格改第二遍就覆盖掉第一遍（否则重贴时 `find` 会取到旧的那条）。
     */
    /* 先看这一格有没有改过 —— 覆盖要**说出来**（2026-11-17），见下面的回执。 */
    const prev = this.st.planPatches.find(
      (x) => x.dateKey === patch.dateKey && x.cityId === patch.cityId
        && x.at === patch.at && (x.kind ?? 'activity') === beat.kind,
    );
    this.st = {
      ...this.st,
      planPatches: [
        ...this.st.planPatches.filter(
          (x) => x.dateKey === patch.dateKey
            && !(x.cityId === patch.cityId && x.at === patch.at && (x.kind ?? 'activity') === beat.kind),
        ),
        patch,
      ],
    };
    this.persist();
    this.plan = this.applyPlanPatches(this.plan, here.id, moment.dateKey);

    const after = this.plan.beats
      .filter((b) => b.at > moment.decimal)
      .map((b) => `${slotClock(b.at)} ${slotBrief(b.what)}`)
      .join('、');
    /*
     * 回执要说清三件事（2026-11-17，Donahue 第二批反馈）：
     *
     * ① **近似命中**：改的不是用户说的那个钟点，就得写明「表上没有 6:30，改的是 07:00」；
     * ② **覆盖**：同一格改第二遍是替换，不是新增 —— 不说的话，用户在外面看到的
     *    就是她反复横跳（昨天那四条 6:30 → 起床 → 起床 → 起床，最后一版抹掉前面全部）；
     * ③ **内容与格子冲突**：`what` 里写了「六点半」而格子在 07:00，两处会一起显示。
     */
    const approx = 'approximate' in found ? found.approximate : undefined;
    const notes = [
      approx
        ? `（表上没有 ${slotClock(approx.asked)} 这一格，最近的是 ${slotClock(approx.at)}`
          + `「${slotBrief(beat.what)}」，改的是那一格。）`
        : '',
      prev && prev.what !== what ? `（替换掉刚才那版「${slotBrief(prev.what)}」。）` : '',
      (() => {
        const t = clockInText(what);
        if (t === null || Math.abs(t - beat.at) < 0.02) return '';
        return `（内容里写的是 ${slotClock(t)}，格子在 ${slotClock(beat.at)} —— 两处会一起显示，`
          + '看着像两件事。要么把钟点从内容里去掉，要么改的就是另一个格。）';
      })(),
    ].filter(Boolean).join('');

    return {
      text: `好，${slotClock(beat.at)} 改成「${what}」。${notes}\n今天剩下的：${after || '（没了）'}`,
    };
  },


  /**
   * 特意去吃某一样（2026-11-13，Discussion #586）。
   *
   * ## 为什么不是 `journey_set_slot` 加个参数
   *
   * 那条是纯本地的：改一格文字，不发请求、不会失败。这条要查网。混在一起，
   * 一次超时就会连累「八点再起」这种根本不联网的动作。
   *
   * ## 顺序：**先查店，再改日程**
   *
   * 反过来也能跑，但那样失败时日程已经改了 —— 回执说「没查到店」而那一格已经写成
   * 「去吃火锅」，她会以为自己有个去处。先查后改，查不到就写个不带店名的版本，
   * 两种结果是分得清的。
   *
   * ## 查不到时不许编
   *
   * 高德没返回、没 key、国外城市（高德那边一条都没有，酒店模块实测过）—— 一律
   * 走泛称。「重庆有一家老火锅」不成立的地方，就说「找了一家本地人排队的」。
   * 这是这个项目最不能犯的错：**编一个不存在的店名**。
   */
  async eat(dishRaw: string, timeRaw: string): Promise<{ text: string; isError?: boolean }> {
    const want = dishRaw.trim().slice(0, 20);
    if (!want) return { text: '要吃什么？给个菜名或品类就行（「火锅」「螺蛳粉」）。', isError: true };
    if (this.st.phase !== 'staying') {
      return { text: '她这会儿不在城里待着 —— 找店只在停留时有用。', isError: true };
    }
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '连自己在哪都不知道，查不了。', isError: true };
    if (!this.plan) return { text: '今天的日程还没排出来，等一下再问。', isError: true };

    /*
     * 没给餐次就按当地时间落在哪一顿 —— 和拍照那条链同一个口径
     * （`journey_photo` 的 `subject=food` 也是这么分的），
     * 不然照片写「午饭」、日程写「晚饭」，两个人对不上。
     */
    const hourNow = localMoment(this.worldNow(), here.tz).decimal;
    const fallback = hourNow < 10.5 ? '早饭' : hourNow < 15 ? '午饭' : '晚饭';
    const time = timeRaw.trim() || fallback;

    const list = await this.eateries.find(here, want);
    const top = list?.[0];
    const what = top ? `${time}，在「${top.name}」吃的${want}` : `${time}，${want}`;

    const r = this.setSlot(time, what);
    if (r.isError) return r;

    if (!top) {
      /*
       * 查不到 —— **不能说店名**。
       *
       * 这里把话说死，是因为「没查到」和「这城没有」是两件事：高德没有这条数据，
       * 不代表街上没有火锅店。回执两边都交代清楚，她就不会把泛称说成事实。
       */
      return {
        text: `${r.text}\n（这座城没查到具体的店 —— 说「找了一家本地人排队的」就行，别报店名。）`,
      };
    }

    const where = top.address ? `，${top.address}` : '';
    const rating = top.rating ? `，评分 ${top.rating}` : '';
    const more = (list?.length ?? 0) > 1
      ? `\n附近还有：${list!.slice(1).map((x) => x.name).join('、')}。`
      : '';
    return {
      text: `${r.text}\n店是真查到的：「${top.name}」${where}${rating}。${more}`,
    };
  },

};
