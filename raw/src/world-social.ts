/**
 * 大肥鱼环游世界 —— 联机碰面、位置上报、邀约与同行约定子系统。
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
  partWord, seededRandom, modeIdOf, roadText, matchSpot, todayPilgrimLines,
  pilgrimNote, beatText,
} from './helpers.ts';
export * from './helpers.ts';

export const socialMethods: Record<string, any> = {
  /**
   * 碰面的配置。**没填地址就返回 null**，整个功能不工作 —— 这是默认状态。
   *
   * 一个开关管两头：填了就既上报也被看见，不填就谁也不打扰谁。
   * 只开一半（我能看别人、别人看不见我）是占便宜，不做。
   */
  meetOptions(): MeetOptions | null {
    /*
     * `String(… ?? '')` 不是随手加的防御。
     *
     * 2026-11-05 长跑模拟抓到的：配置对象少一个 `meetUrl` 时，`.trim()` 直接抛，
     * 而这一行在每个巡检里都会被调 —— 表现是**整趟旅行停摆**，日志里一秒一条
     * 「Cannot read properties of undefined」。而用户的 config.json 是可能缺项的
     * （老版本升级上来、手改过），缺一项不该等于扩展不能工作。
     */
    /*
     * 2026-11-13：那一栏不再原样拿去拼 URL。
     *
     * 少一个 `https://` 时 `fetch` 抛 `Invalid URL`，原来被压成「没连上碰面服务器」，
     * 用户和模型都只能推「地址没填对」—— 而线上服务实测是好的。
     * 现在先归一化（补协议、清零宽、剪掉多余路径），修不了的把原因留给面板和工具回执。
     */
    const raw = String(this.cfg.meetUrl ?? '');
    if (!raw.trim()) {
      this.meetUrlError = '';
      this.meetUrlFixed = '';
      return null;
    }
    const fix = normalizeMeetUrl(raw);
    this.meetUrlError = fix.error;
    this.meetUrlFixed = fix.fixed;
    if (fix.error) return null;
    return { url: fix.base, uid: this.meetUid(), pet: this.opts.botName };
  },


  /**
   * 她的匿名标识。**一次生成，存在日记目录里。**
   *
   * 放日记目录而不是本机数据目录，是为了让它跟着同步盘走：换一台电脑还是同一个人，
   * 重装才算新的人。和 `memoryDir` 的取舍一致。
   */
  /**
   * 现在报一次「我在哪儿」。
   *
   * 启动时调一次，`rebuildPlan` 末尾另有一次。失败要留痕 ——
   * 这条链路以前静默到「面板上名字还是旧的」都没人知道是上报没发出去。
   */
  async reportHere(): Promise<void> {
    const meet = this.meetOptions();
    if (!meet) return;
    const c = this.cityOrNull(this.st.hereId);
    if (!c || this.st.phase !== 'staying') return;
    const m = localMoment(this.worldNow(), c.tz);
    const doing = this.plan?.beats.find((b) => b.kind === 'activity')?.what ?? '';
    const ok = await reportPresence(meet, c.id, m.dateKey, slotOf(m.hour), doing);
    if (ok) {
      /*
       * 恢复要留一句 info。上一版失败只写 warn、成功什么都不写，
       * 于是一段静默故障在日志里长得像「一直没动静」而不是「坏过又好了」。
       */
      if (this.reportFails) {
        this.log?.info(`位置上报恢复（之前连续失败 ${this.reportFails} 次）`);
      }
      this.reportFails = 0;
      if (this.reportRetryTimer) {
        clearTimeout(this.reportRetryTimer);
        this.reportRetryTimer = null;
      }
      return;
    }

    this.reportFails += 1;
    /*
     * 不刷屏：第一次必报，之后每 10 次报一条。
     * 服务端挂一整天的话，日志里应该是十行左右，不是两千行。
     */
    if (this.reportFails === 1 || this.reportFails % 10 === 0) {
      this.log?.warn(
        `位置没报上去（碰面服务器没回 200，已连续 ${this.reportFails} 次）`
        + '—— 面板上会一直是旧数据，正在自动重试',
      );
    }
    this.armReportRetry();
  },


  /**
   * 排下一次重试。已有的排程不重复排（心跳那条线可能同时也在跑）。
   *
   * 注意 `phase !== 'staying'` 时 `reportHere` 会直接返回而**不算失败** ——
   * 在路上本来就没有「所在的城」，不该被当成服务端的问题。
   */
  armReportRetry(): void {
    if (this.reportRetryTimer) return;
    const wait = REPORT_RETRY_MS[Math.min(this.reportFails - 1, REPORT_RETRY_MS.length - 1)] ?? 10 * 60_000;
    this.reportRetryTimer = setTimeout(() => {
      this.reportRetryTimer = null;
      void this.reportHere();
    }, wait);
    this.reportRetryTimer.unref?.();
  },


  /**
   * 她在池子里的身份（uid），以及「这个身份归哪台机器」。
   *
   * ## 为什么从云盘搬回本机
   *
   * 原来是 `join(diary.current.dir, 'meet-uid.txt')` —— 日记目录一旦指到 OneDrive，
   * **两台电脑就读同一个文件、用同一个 uid**。后果不是「看起来像同一只鱼」这么轻：
   * 池子的「今天多少只」按 uid 去重，两台只算一只；两台同时上报会互相覆盖同一条 presence；
   * 邀约和邻居也会串。Mr.Q 2026-11-06 的两台机器就是这个状态。
   *
   * ## 迁移怎么不打架
   *
   * 本机没有 uid 时（升级后第一次启动），先看云盘那份还在不在、有没有被认领：
   *
   * - 没人认领 → 沿用。**本机的身份不变**，历史约定和池子里的记录都不断
   * - 已被另一台认领 → 生成一个新的
   *
   * 认领记在云盘的 `meet-uid.owner` 里，内容是主机名。两台主机名撞了（都叫 DESKTOP-XXXX）
   * 会退化成旧行为 —— 比不认领强，至少本机这个值存下来之后就不再变。
   */
  meetUid(): string {
    const local = join(this.opts.dataDir, 'meet-uid.txt');
    try {
      const mine = readFileSync(local, 'utf8').trim();
      if (/^[a-f0-9]{20,64}$/i.test(mine)) return mine;
    } catch { /* 本机还没有：第一次跑，或者刚升级 */ }

    const shared = join(this.diary.current.dir, 'meet-uid.txt');
    const ownerFile = join(this.diary.current.dir, 'meet-uid.owner');
    let host = 'unknown';
    try { host = hostname(); } catch { /* 拿不到主机名就按 unknown 记 */ }

    let sharedId = '';
    try {
      const saved = readFileSync(shared, 'utf8').trim();
      if (/^[a-f0-9]{20,64}$/i.test(saved)) sharedId = saved;
    } catch { /* 没有就是没有 */ }

    let owner = '';
    try { owner = readFileSync(ownerFile, 'utf8').trim(); } catch { /* 还没人认领 */ }

    let id: string;
    if (sharedId && (!owner || owner === host)) {
      id = sharedId;
      try { writeFileSync(ownerFile, host, 'utf8'); } catch { /* 云盘只读也不该崩 */ }
    } else {
      id = randomBytes(12).toString('hex');
    }
    try { writeFileSync(local, id, 'utf8'); } catch { /* 写不进去就用内存里这个，重启会换一个新的 */ }
    return id;
  },


  /**
   * 留一个路标（2026-11-14）。
   *
   * 借《死亡搁浅》的结构：前人留下的痕迹让后人受益，两个人永不同时在线。
   * **这不是聊天** —— 她留完就看不到它了，也没有人会回。所以话说给「以后来这儿的人」，
   * 不是说给某个具体的人。
   *
   * 服务端一支鱼一城一天只收一条（重留覆盖旧的），带链接的会被直接拒掉。
   */
  async signpost(text: string, cityArg: string): Promise<string> {
    const meet = this.meetOptions();
    if (!meet || !meet.url) return '（没配碰面服务器，路标留不下来。）';
    const body = text.trim().slice(0, 40);
    if (!body) return '（要留的那句话是空的。）';

    /* 给了城市就按名字或 id 找；没给就用她这会儿待的城。 */
    const named = cityArg.trim()
      ? CITIES.find((c) => c.name === cityArg.trim() || c.id === cityArg.trim())
      : undefined;
    const cityId = named?.id ?? this.st.hereId;
    if (!cityId) return '（不知道她现在在哪座城，留不了。）';

    const ok = await reportSignpost(meet, cityId, body);
    if (!ok) return '（路标没留成，服务端没接。）';
    return `在${named?.name ?? this.cityName(cityId)}的路边留了一句话，以后来这儿的人能看见。`;
  },


  /* ---------------- 池子里的称呼 ---------------- */

  /**
   * 池子里她是按**名字**被认的，而名字不保证唯一。
   *
   * 2026-11-06 Mr.Q 的两台电脑各养一只鱼、起的是同一个名字。本机那天读到的约定是
   * 「和『克罗艾的小银鱼』在成都待三天」—— 而她自己就叫这个，读起来就成了「我和我自己」，
   * 她跟用户报告同行者时名字整个乱掉。数据本身没错（对方确实叫这个），是**称呼有歧义**。
   *
   * 所以只在**输出**时加一个后缀区分，不动存下来的名字 ——
   * 那份数据是「对方当时叫什么」的事实，改了它等于篡改历史。
   */
  nameOf(pet: string): string {
    const name = String(pet ?? '').trim();
    const mine = String(this.opts.botName ?? '').trim();
    if (!name || !mine || name !== mine) return name;
    return `${name}（另一位同名的鱼）`;
  },


  /** `whoOf` 的带名版：把「和自己同名的那位」标出来。见 `nameOf`。 */
  whoOfPledge(p: { withPet: string; withPets?: readonly string[] }): string {
    return whoOf({
      withPet: this.nameOf(p.withPet),
      ...(p.withPets ? { withPets: p.withPets.map((x) => this.nameOf(x)) } : {}),
    });
  },


  /**
   * 「这几天是跟谁一起过的」那一句。没有这种日子就返回空串。
   *
   * 判据三条，少一条都不能说：约还在、**人已经到了**（`arrivedAt` 有值）、
   * 此刻这座城就是约定的那座城。前两条缺一句话，就是替她提前见面 ——
   * 她还在路上，同伴还没来，说「一起过」等于编。
   *
   * 2026-11-06 加。Mr.Q：「我一开始不就是要让她和一群肥鱼一起旅行嘛？日记肯定要体现啊」。
   * 原来只有到达那一条通知提过一次，之后那 N 天的 `journey.day` 一个字不提，
   * 她写日记时手上没有任何「今天和谁在一起」的事实 —— 只能写风景。
   */
  mateLine(
    p: {
      cityId: string; days: number; withPet: string;
      withPets?: readonly string[]; arrivedAt: string | null;
      meetCityId?: string; meetArrivedAt?: string | null;
    } | null,
    hereId: string,
    stayDays: number,
  ): string {
    if (!p) return '';
    /*
     * **在见面城等的那几天**（2026-11-07）。
     *
     * 不说这一句的话，她那几天手上的事实只有「我在成都」，没有任何一处告诉她
     * 「你在等一个人」—— 被问「你在这儿干嘛」时只能现编一个理由。
     * 这是这个系统里最常见的一类缺陷：状态在，但她看不见。
     */
    if (p.meetCityId && !p.arrivedAt && p.meetArrivedAt && p.meetCityId === hereId) {
      const met = Math.max(0, stayDays);
      return `在这儿不是玩：跟${this.whoOfPledge(p)}约在${this.cityName(p.meetCityId)}碰头，`
        + `你${met > 0 ? `已经等了 ${met} 天，` : ''}人还没露面。`
        + `等见了面再一起去${this.cityName(p.cityId)}，在那儿待 ${p.days} 天。`
        + '等着的时候也可以在城里转转，但别走远 —— 人家随时会到。';
    }
    if (!p.arrivedAt || p.cityId !== hereId) return '';
    /* `stayDays` 是「已经住满几天」，标题里用的是 +1，这里跟着对齐。 */
    const n = Math.max(1, stayDays + 1);
    const tail = n >= p.days ? '这是最后一天，明天就各走各的' : `还剩 ${p.days - n} 天`;
    /*
     * **加一句白天真发生的事。**（2026-11-07 Mr.Q）
     *
     * 原来只有「跟谁、几天、第几天」—— 全是**约定的元数据**，
     * 那个人在这几天里没有做过任何事。用户要看的是「一起旅行」，
     * 不是「一起旅行的合同条款」。
     */
    /*
     * **这一句原来像会议纪要**（2026-11-08 晚改）：
     *
     * 「跟某某说好在这儿待 3 天，今天是第 2 天，还剩 1 天。」
     *
     * 事实全对，但「说好在这儿待」是**协议**的口吻，不是同行的人会说的话。
     * 模型读到这种句子，写出来也是这种句子 —— 它照着念。
     * 改成「也在」「一起待」：同样是交代天数，但主语是两个人一起。
     */
    return `这几天不是一个人：${this.whoOfPledge(p)}也在，说好一起待 ${p.days} 天，`
      + `今天是第 ${n} 天，${tail}。`
      + `\n${banterWith(this.whoOfPledge(p), seedOf(`${p.cityId}|${n}|banter`), this.warmthOf(p))}`
      /*
       * 再一句讲关系（2026-11-08）。打趣是「今天发生的事」，这一句是「走到哪一步了」——
       * 两件事分开写，否则每次都只剩打趣，读起来像刚认识。
       */
      + `\n${bondWith(this.whoOfPledge(p), this.warmthOf(p), seedOf(`${p.cityId}|${n}|bond`))}`;
  },


  /* ---------------- 池子里有没有人在找伴 ---------------- */

  /**
   * 收到「谁在找伴」之后：**只在真有人找伴时**推一条事件。
   *
   * ## 为什么要有这个
   *
   * 原来她只在排表那一刻（每天第一次醒来 / 刚到一座城）才拉一次邀约列表。
   * 别人中午发一条，她可能等到第二天早上才发现 —— 而邀约 24 小时就过期，等于白等。
   * Mr.Q 2026-11-06 问「鱼收发邀请都是自动的么」，这就是那个缺口：**她不是不看，是没机会看**。
   *
   * ## 花钱的地方在哪
   *
   * 拉列表是只读请求，免费（限流只算发/接）。真正花钱的是**推事件** ——
   * 事件进对话，她要开口说一句，一次模型调用。所以这里两道闸：
   *
   * - 每条邀约只提一次（`inviteSeen`，最多留 50 条）
   * - 一天最多提 `INVITE_NOTICE_PER_DAY` 条
   *
   * 拿列表这件事本身由 `probeStatus` 顺带做掉（一个请求两样数据），
   * 所以这里不再自己发请求 —— 它只负责「要不要开口」。
   */
  async handleInvites(
    list: readonly { id: string; pet: string; to: string; days: number; note?: string }[],
    now: Date,
  ): Promise<void> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return;

    const mine = String(this.opts.botName ?? '').trim();
    const homeId = this.resolveHome().city.id;
    const seen = new Set(this.st.inviteSeen);
    /*
     * 三种不提：自己发的（那就是她自己的话）、去她现在这座城的（她已经在）、
     * 去她家的（接了等于回家，而回家有另一条路）。
     *
     * 「自己发的」只能按名字判 —— 列表里不返回 uid。同名的时候会误判成自己的，
     * 代价是**漏提一条**，比「把自己发的邀约当成别人的」轻。
     */
    const fresh = list.filter((x) => !!x.id && !seen.has(x.id)
      && x.pet !== mine && x.to !== here.id && x.to !== homeId);
    if (!fresh.length) return;

    const today = localMoment(now, here.tz).dateKey;
    const used = this.st.inviteNotice?.day === today ? this.st.inviteNotice.n : 0;
    /*
     * 今天提够了就**什么都不记**，直接走。
     *
     * 一度想把「超预算的」也写进 `inviteSeen`（当成「已经处理过」），那是错的：
     * `inviteSeen` 的意思是「已经跟她提过」，把没提过的写进去，那一条就永远提不到了 ——
     * 池子里三条邀约，一天只提第一条，剩下两条当天被记账，之后也不会再有第二次机会。
     * 留着不记，明天预算恢复还能提。
     */
    if (used >= INVITE_NOTICE_PER_DAY) return;

    const one = fresh[0]!;
    const dest = this.cityOrNull(one.to);
    const more = fresh.length > 1 ? `（池子里还有 ${fresh.length - 1} 条）` : '';
    this.st = {
      ...this.st,
      inviteSeen: [...this.st.inviteSeen, one.id].slice(-50),
      inviteNotice: { day: today, n: used + 1 },
    };
    this.persist();
    await this.push(
      'journey.invite',
      `invite-near-${one.id}`,
      `${this.nameOf(one.pet)} 在找伴：想一起去${dest?.name ?? one.to}，待 ${one.days} 天`
        + (one.note ? `（「${one.note}」）` : '') + more
        + '。要不要搭伴，用 journey_accept 看一遍再决定。',
      'debounce',
    );
  },


  /**
   * 单独去问一次池子多大（20 分钟一次）。
   *
   * 这个数字原本是 `rebuildPlan` 顺带从「同城有谁」那个接口带回来的，于是有两条空档：
   *
   * - 她在家或在路上时根本不排表 → 面板上「池子今天一共 N 只」整条消失，
   *   看起来像「只有别人能看到」（Mr.Q，2026-11-06 的原话）
   * - `staying` 时也只有**当天第一次排表**那一下的值 → 早上 6 点定下行程，`plan.pool`
   *   一整天都是 15，中午池子涨到 24 了她还显示 15
   *
   * 这个数字是全局的、跟城市无关，所以随便拿哪座城去问都一样（只影响那一行邻居列表，
   * 而这里根本不看 `list`）。
   */
  async probeStatus(now: Date): Promise<void> {
    const meet = this.meetOptions();
    if (!meet) return;
    const real = this.realNow().getTime();
    if (this.poolProbe && real - this.poolProbe.at < STATUS_PROBE_MS) return;
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return;
    try {
      // 一个请求拿两样：池子总数 + 谁在找伴。见 `meet.ts` 的 `fetchStatus`。
      const r = await fetchStatus(meet, here.id);
      /*
       * ## 失败也要记时间（2026-11-11 线上事故，最贵的一行）
       *
       * 原来这里是：
       *
       * ```ts
       * if (!r.ok) return;
       * this.poolProbe = { at: real, value: r.pool };
       * ```
       *
       * 返回写在赋值**前面** —— 服务器一挂，`poolProbe.at` 不动，
       * 下一轮 `tick`（60 秒）又打一次。**限流形同虚设。**
       *
       * 当晚的实际账：68 只鱼，正常 68 × 24 ≈ 1,600 次/天；
       * 故障期间变成 68 × 1,440 ≈ 9.8 万次/天，**放大 60 倍** ——
       * Cloudflare 免费层 10 万/天当场打满，而所有人都以为「是用户变多了」。
       *
       * 修法：不管成不成，先记下这次尝试。失败就沿用上一次的值，
       * 面板上的池子数字最多旧一小时 —— 比把服务器打爆划算太多。
       */
      this.poolProbe = {
        at: real,
        value: r.ok ? r.pool : (this.poolProbe?.value ?? 0),
        taken: r.ok ? r.mineTaken : (this.poolProbe?.taken ?? 0),
      };
      if (!r.ok) return;
      await this.handleInvites(r.invites, now);
    } catch {
      // 拿不到就算了。这不是她的事，也不该在日志里刷——下一轮再试。
    }
  },


  async claimTakenInvite(meet: MeetOptions, now: Date): Promise<void> {
    /*
     * **回程途中不再认领新的约定**（2026-11-06 长跑抓到的）。
     *
     * 原来只处理了「他叫她回来时把已有约定作废」，没想到回来路上这几十个小时里，
     * 别人又接了她说的话 —— 于是 `pledge` 和 `returning` 同时为真，
     * 面板上一边写「回家」一边写「去赴约」，两条路打架。
     * 现实里她已经在回家的车上了，不会应一声又掉头。
     */
    if (this.st.returning) return;
    /*
     * **正在路上不认领**（2026-11-06 的 144 天长跑抓到的）。
     *
     * 那趟跑完，面板上同时是「在飞布宜诺斯艾利斯」和「跟人说好去稻城亚丁」——
     * 而 `depart` 里那条「手上有约就往约的城走」只在**出发那一刻**读 pledge，
     * 飞机已经在天上，改不了航向。于是这份约定从建立起就注定兑现不了，
     * 三天后由 `prunePledge` 作废，期间面板一直挂着一条假的承诺。
     *
     * 落地那一刻 `rebuildPlan` 会再调一次这里，而且那会儿 `phase` 已经是
     * `staying`，认领完下一次决策就能安排改道 —— 所以「等落地」不丢东西。
     */
    if (this.st.phase === 'traveling') return;
    const r = await myTakenInvites(meet);
    if (!r.ok || !r.list.length) return;
    /*
     * 认领过的跳过。
     *
     * 服务端不知道本地认领过 —— 它回的是「我发的邀约被谁接了」，只要那条还在，
     * 每次问都会再回一遍。而这里原来的判据只有「手上没有 pledge」，
     * 于是 pledge 一被清（待满走了、过期作废）就会从头认领同一条：重复推事件，
     * 而且把 pledge 一直占着。2026-11-06 的 144 天跑抓到了这个循环。
     */
    const seen = new Set(this.st.claimedInvites ?? []);
    const fresh = r.list.filter((x) => !seen.has(x.id));
    if (!fresh.length) return;
    const one = fresh[0];
    const same = r.list.filter((x) => x.id === one.id);
    /*
     * 接单人的**全量**名单，和给句子用的名单分开（2026-11-11）。
     *
     * `MAX_PARTY - 1` = 5 只鱼能接一条邀约，`.slice(0, 3)` 是**说**的时候用的
     * —— 一口气报五个名字，那句话就没法读了。拿它去记账，第 4、第 5 个人
     * 永远进不了记忆：跟她们走过十天，她只记得前三个人。
     */
    const allNames = [...new Set(
      same.map((x) => String(x?.pet ?? '').trim()).filter((x) => !!x && x !== '一只鱼'),
    )];
    const names = allNames.slice(0, 3);
    const dest = cityById(one.to);
    if (!dest) return;
    /* 见面城（2026-11-07）。发起者这一侧也要走同一条两段路，不然「一起走」只算半边。 */
    const meetCity = one.meetCity ? cityById(one.meetCity) : null;
    const here = this.cityOrNull(this.st.hereId);
    /*
     * 她可能已经在这趟的目的地了（发完邀约自己先到了那里，对方才接）。
     * 那种情况下「先去别处碰头再回来」是荒唐的 —— 忽略见面这一级，她在那儿等着就行。
     * 判据和 `takeInvite` 同一条，理由见那边。
     */
    const useMeet = meetCity && here && here.id !== dest.id ? meetCity : null;
    this.st = {
      ...this.st,
      pledge: {
        cityId: dest.id,
        days: one.days,
        withPet: names[0] ?? one.pet,
        withPets: names,
        inviteId: one.id,
        acceptedAt: now.toISOString(),
        arrivedAt: here && here.id === dest.id ? now.toISOString() : null,
        ...(useMeet
          ? {
              meetCityId: useMeet.id,
              meetArrivedAt: here && here.id === useMeet.id ? now.toISOString() : null,
            }
          : {}),
      },
      /* 认领过就记下来，下次别再认一遍（键是整份 state，不能只改 pledge）。 */
      claimedInvites: [...seen, one.id].slice(-20),
    };
    /*
     * 一个人都没接上就别记 —— `names[0]` 兜底到 `one.pet` 是给显示用的，
     * 记账要的是「真的有谁接了」。空名单在这里是正常的（服务端刚删了那条）。
     *
     * `+6` 而不是默认的 `+1`：规则写在 `rememberPet` 上 ——「接一次约 +6，
     * 真的一起到了 +6，同城撞见 +1」。她接别人的 +6（world.ts `takeInvite`），
     * 别人接她的却只有 +1，同一个动作两个价，那一条是漏传了参数（2026-11-11 修）。
     */
    for (const who of allNames) this.rememberPet(who, 6);
    /*
     * 记下这一段同行（2026-11-11）。服务端那张卡是按邀约编号取的，
     * 而 pledge 待满就会清掉，编号跟着一起没 —— 不在这儿抄一份，散伙之后
     * 就再也问不到「她留了什么」。
     */
    this.partyLog.add({
      id: one.id,
      pets: allNames,
      days: one.days,
      at: now.toISOString(),
      city: dest.name,
    });
    this.persist();
    await this.push(
      'journey.invite',
      `invite-taken-${one.id}`,
      `${names.join('、')}接了话：`
      + (useMeet ? `先在${useMeet.name}碰头，再一起去${dest.name}，在那儿待 ${one.days} 天。` : `一起去${dest.name}，在那儿待 ${one.days} 天。`)
      + (one.note ? `对方留的话是「${one.note}」。` : '')
      + (useMeet
        ? (here && here.id === useMeet.id
          ? `\n本来就在${useMeet.name}，从这会儿起就在这儿等人 —— 人露面了再一起走。`
          : `\n也得先往${useMeet.name}去会合，见上了再一起往${dest.name}走。`)
        : (here && here.id === dest.id
          ? `\n本来就在${dest.name}，这几天就按这个过。`
          : `\n也得真的往${dest.name}走 —— 路上该多久是多久，不是明天就到。`))
      + `\n（那边也是这么走的：${useMeet ? `先在${useMeet.name}碰头，` : ''}到了各待 ${one.days} 天，谁先到谁等。）`,
      'flush',
    );
  },


  /* ---------------- 邀约 ---------------- */

  /**
   * 发一条：我在这个城，想去那座城待几天，有没有人一起。
   *
   * ## 为什么不指名
   *
   * 系统里没有好友、没有账号、没有「发给谁」。所以「一起玩」这件事只能做成
   * **同一个地方、同一个时段**的巧合 —— 谁那会儿在，谁就看得见。
   * 想指名要先把人认出来，那就要有账号、权限、审核，是另一个量级的东西。
   */
  async inviteSomeone(
    toName: string,
    days: number | undefined,
    note: string,
    /**
     * 见面城（2026-11-07）。不传 = 就在她现在待的这座城里见。
     *
     * 「我在这座城，想找个伴一起去那座城」是原来的全部语义；
     * Mr.Q 要的是三段：「约好在 A 见面 → 一起去 B → 在 B 分开」。
     * 于是缺的那一级就是 A，而 B 一直是 `to`。
     */
    meetName?: string,
  ): Promise<{ text: string; isError?: boolean }> {
    const meet = this.meetOptions();
    if (!meet) {
      return {
        text: '碰面服务器没配，发不出去。跟他说一声就行，别自己圆一个「有人回了」。',
        isError: true,
      };
    }
    /*
     * 只在她**待在一个地方**的时候发。
     *
     * 在家发等于「我在家，谁跟我去拉萨」—— 而她还在休息期，可能三天后才动身，
     * 那条邀约 24 小时就过期了。在路上发同理：她自己都不知道下一站会在哪儿停。
     */
    if (this.st.phase !== 'staying') {
      return {
        text: this.st.phase === 'home'
          ? '她还在家歇着，这会儿发了也赶不上 —— 邀约 24 小时就过期。等出门了再说。'
          : '她在路上，还没落地。到了地方再说。',
        isError: true,
      };
    }
    const here = this.cityOrNull(this.st.hereId);
    const c = cityByName(toName.trim());
    if (!here) return { text: '连自己在哪都不知道，先不发。', isError: true };
    if (!c) {
      return {
        text: `内置城市表里没有「${toName.trim()}」。换个说法，或者挑个近一点的大城市 —— 邀一个不存在的地方没意义。`,
        isError: true,
      };
    }
    if (c.id === here.id) return { text: `她现在就在${here.name}，不用邀人一起去${c.name}。`, isError: true };

    /*
     * 见面城。**不填就是她脚下这座城 —— 而且现在真的会发出去**（2026-11-12）。
     *
     * 原来这里默认 `null`：邀请里没有 `meet_city` → 接的人 `pledge.meetCityId` 为空 →
     * `pledgeStop` 直接返回目的地 → 两个人**各走各的**到 B 才碰头。
     * 「先在 A 会合、一起上车」这一级从此永远不会发生：能力在，路径不经过它。
     * Mr.Q 问「一起出发去另一个地方，怎么从来没见过」，根子就在这一行。
     *
     * 填了别处才有意义：她还没到，但已经知道要在那座城会合。
     * 那种情况要先确认**她自己去得成**，否则她答应了一场自己赶不上的见面。
     */
    let meetCity: City | null = here;
    const wanted = String(meetName ?? '').trim();
    if (wanted) {
      const m = cityByName(wanted);
      if (!m) {
        return { text: `内置城市表里没有「${wanted}」这座城，见面的地方换一个。`, isError: true };
      }
      if (m.id !== here.id) {
        if (!canTravel(here, m)) {
          return {
            text: `${m.name}从${here.name}这儿去不了（隔着海，或者那边没有机场）—— 约在那儿见面她赶不到。`,
            isError: true,
          };
        }
        meetCity = m;
      }
    }
    /* 见面城和目的地相同时没有「见面」这一级，按老口径发。 */
    if (meetCity && meetCity.id === c.id) meetCity = null;

    const d = Math.min(14, Math.max(1, Math.round(Number(days) || 2)));
    const r = await sendInvite(meet, {
      from: here.id,
      to: c.id,
      days: d,
      note,
      ...(meetCity ? { meetCity: meetCity.id } : {}),
      // 自己的流速要带上 —— 对方接之前得知道两边对不对得上日子。
      pace: this.speedNow(),
    });
    if (!r.ok) {
      /*
       * 失败要说得像人话，而且**分清是谁的问题**：
       * 「服务器没这个功能」和「今天发太多了」对她和对他都是两件事。
       */
      return {
        text: `没发出去：${r.reason}。别当成已经发出去了 —— 没人会来。`,
        isError: true,
      };
    }
    this.log?.info(`发了条邀约：${here.name} → ${c.name}，${d} 天。`);
    /*
     * 回执里那句「不保证有人接」必须写。
     *
     * 不发结果通知是设计（`INVITE_TTL_MS` 那条），但如果她以为「发了 = 有人来」，
     * 明天就会问「小满怎么还没来」。这不是她记错，是没人告诉过她这件事没有回音。
     */
    return {
      text: `发出去了：${meetCity ? `先在${meetCity.name}见面，再` : ''}${here.name} → ${c.name}，`
        + `在那儿一起待 ${d} 天${note ? `，留了一句「${note}」` : ''}。`
        + '谁能看见全看那会儿谁也在这一带 —— 没有人接是常事，那条 24 小时后自己过期，不会有回音。'
        + '别把它当成约好了，该怎么走还怎么走。',
    };
  },


  /** 看看同城有谁在找伴。不改任何状态。 */
  async listNearbyInvites(): Promise<{ text: string; isError?: boolean }> {
    const meet = this.meetOptions();
    if (!meet) return { text: '碰面服务器没配，看不到有没有人找伴。', isError: true };
    /*
     * **在家也能看。**
     *
     * 2026-11-06 之前只有 `staying` 能看，理由写在 `takeInvite` 里：在家接了也赶不上。
     * 但「接不了」和「看不见」是两件事 —— 他在反馈里说的就是后半句：
     * 一条邀约只有 24 小时，等她出门再看见，那条多半已经过期了。
     * 现在在家也能看见，接不接另说（看下一段）。
     */
    if (this.st.phase === 'traveling') {
      return { text: '她在路上，还没落地，看不到这一带谁在找伴。到了再说。', isError: true };
    }
    const atHome = this.st.phase === 'home';
    const here = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    if (!here) return { text: '连自己在哪都不知道，查不了。', isError: true };

    const r = await listInvites(meet, here.id);
    if (!r.ok) return { text: `看不成：${r.reason}。`, isError: true };
    /*
     * 和 `rebuildPlan` 用同一条过滤：去她这座城的、去她家的，都不该出现在
     * 「能接」的列表里 —— 两个地方各留一份过滤，迟早会漂。
     */
    const homeId = this.resolveHome().city.id;
    /*
     * 已经处理过的那条不再列出来（2026-11-06）。
     *
     * 让位之后（他点名要去别处，约定让位）同一条邀约还挂在池子里，她能再接一次 ——
     * 而 `pledge-yield-<邀请编号>` 是固定的 senderKey，于是同一句「这趟只能算了」
     * 会被推第二遍。goto 档 144 天跑出来的重复就在这儿。
     */
    const handled = new Set(this.st.claimedInvites ?? []);
    const takeable = r.list.filter((x) => x.to !== here.id && x.to !== homeId && !handled.has(x.id));
    if (!takeable.length) {
      return {
        text: atHome
          ? `${here.name}这一带这会儿没有能接的邀约。自己走就行，这很正常。`
          : `${here.name}这会儿没有能接的邀约。自己走就行，这很正常。`,
      };
    }

    const head = atHome
      ? `她还在${here.name}，先看看这一带谁在找伴：\n`
      : `${here.name}这会儿有人发了话：\n`;
    /*
     * 开了「出门等点头」时，接之前得先问他一句 —— 这句话得留在回执里。
     * 不写的话，模型会以为「接了 = 走定了」，而实际上面板上多了一张待批的卡片。
     */
    const tail = '\n（要接就把那串 id 原样传给 journey_accept。接了就是答应了：真的过去、按天数待着。'
      + (atHome ? '还在家的话，接了会立刻往那座城出发 —— 路上该多久是多久。' : '')
      + (this.cfg.askBeforeDepart ? '他开了「出门等点头」：接下来会先问他一句，他答好才真的走。' : '')
      + '不想接就别接，不接不会有任何回音，对方也不知道。）';

    return {
      text: head
        + takeable.map((x) => {
          const dest = cityById(x.to);
          return `- ${this.nameOf(x.pet)} 想去${dest?.name ?? x.to}，待 ${x.days} 天`
            + (x.note ? `（「${x.note}」）` : '')
            + `　id=${x.id}`;
        }).join('\n')
        + tail,
    };
  },


  /**
   * 接下一条。
   *
   * 三条前置判断，都是为了不让她许下一个做不到的承诺：
   * 得在一个城里、手上不能已经有别的约定、那地方得真的去得了。
   */
  async takeInvite(id: string, approved = false): Promise<{ text: string; isError?: boolean }> {
    const meet = this.meetOptions();
    if (!meet) return { text: '碰面服务器没配，接不了。', isError: true };
    /*
     * **在家也能接。**
     *
     * 原来的说法是「她还在家歇着，接了也赶不上 —— 邀约 24 小时就过期」。
     * 那句在「她还要歇好几天」时是对的，但被当成了**所有在家情形**的答案：
     * 休息期已经结束、只是还没到出门的点（7 点前）的那几个小时里，她也接不了。
     * 而一条邀约的窗口只有 24 小时，早上的那几个钟头恰恰是最容易错过的。
     *
     * 现在的口径：在家能接，接完立刻从家出发（`depart` 会认手上这份约定）；
     * **只有真的还在休息期**才拦，并说清歇到哪天。
     */
    if (this.st.phase === 'traveling') {
      return { text: '她在路上，还没落地。到了地方再接。', isError: true };
    }
    const atHome = this.st.phase === 'home';
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return { text: '连自己在哪都不知道，接不了。', isError: true };

    const now = this.worldNow();
    if (atHome && this.stillResting(now)) {
      return {
        text: `她还在家歇着（${this.restDayLabel() ?? '再过几天'}才动），`
          + '这会儿接了也赶不上 —— 邀约 24 小时就过期。等歇完了再说。',
        isError: true,
      };
    }

    /*
     * 正在往回走的时候不接。
     *
     * 这一条不是客气：回程那一支在 `stayTick` 里排在约定之前，
     * `moveOn` 在回程时也不看约定 —— 也就是说接了也**一定不会去**。
     * 许一个从机制上就兑现不了的承诺，比不接糟得多。
     */
    if (this.st.returning) {
      /*
       * 别在括号里写死「他叫回来的」。
       *
       * 2026-11-05 144 天模拟抓到的：`returning` 有四种来路 —— 他叫回、到周数上限、
       * 钱撑不下去、自己待够了。四个里只有一个是他开的口，写死就等于替他说了句没说过的。
       */
      const why = this.st.returnReason === 'called' ? '（他叫回来的）' : '';
      return { text: `她正在往回走${why}，这会儿接别人的邀约只会去不成。`, isError: true };
    }
    /*
     * 正在打短工也不接。
     *
     * `stayTick` 的「打工期间」那一支排在约定之前：工没做完，约定的天数一天都推不动，
     * 而邀约的寻人窗口只有一两天 —— 接了就是**一定过期**。跟回程那条是同一个道理：
     * 许一个从机制上兑现不了的承诺，比不接难看。
     */
    if (this.st.work) {
      const left = Math.max(1, Math.ceil((Date.parse(this.st.work.until) - now.getTime()) / 86_400_000));
      return {
        text: `她在打短工（${this.st.work.gig}），还有 ${left} 天 —— 这期间走不开，`
          + '邀约过一两天就过期了，接了也是空答应。跟她说：工做完再说。',
        isError: true,
      };
    }
    const holding = this.activePledge(now);
    if (holding) {
      return {
        text: `她已经答应过${this.whoOfPledge(holding)}了（去${this.cityName(holding.cityId)}）。`
          + '一趟里只守一个约定，先把那趟走完。',
        isError: true,
      };
    }

    /*
     * **先看清，再答应。**
     *
     * 原来这里是先 `acceptInvite`，再校验「是不是她家那座城 / 去不去得了 /
     * 买不买得起」。三个校验全在服务端已经收下之后 —— 也就是说：她答应了，
     * 别人的名单上也真的多了一只鱼，而本地一个 `pledge` 都没设，第二天她照自己的
     * 口味去了别处。**答应了却不出现**，比不接难看十倍，而这条路上一次都不会报错。
     *
     * 现在先把那条的详情拿到手，全部校验过了才发那一声「接」。
     */
    const peek = await listInvites(meet, here.id);
    if (!peek.ok) return { text: `看不成那条邀约：${peek.reason}。`, isError: true };
    const one = peek.list.find((x) => x.id === id);
    if (!one) {
      return {
        text: '那条邀约不在了 —— 过期了，或者已经被接满。',
        isError: true,
      };
    }
    const dest = cityById(one.to);
    if (!dest) return { text: `那条邀约说的「${one.to}」不在城市表里，接了也没法走。`, isError: true };
    /*
     * 见面城（2026-11-07）。**认不出来就当没有这一级** —— 服务端给的 id
     * 在本地城市表里不存在时（版本对不上），按老口径「直接在目的地见」处理，
     * 而不是让整条邀约作废。
     */
    const meetCity = one.meetCity ? cityById(one.meetCity) : null;
    /*
     * **她已经在目的地了，就没有「先碰头」这回事。**
     *
     * 2026-11-07 长跑的不变量抓到的：她人在西安，邀约说「先去成都碰头，再一起回西安」——
     * 状态里于是同时有 `arrivedAt`（已经在一起）和 `meetCityId`（还没碰头）。
     * 两条都成立，等于让已经到终点的人先跑回起点。
     *
     * 正确处理是**忽略见面这一级**：她就在他们要去的地方，等着就行。
     */
    const useMeet = meetCity && here.id !== dest.id ? meetCity : null;
    /*
     * 两边时间流速差太多就别接。
     *
     * 这一条挡的不是错误，是**一种注定落空的期待**：他那边一天只要一小时，
     * 等这边赶到会合点，他那边已经过了大半个月，早就按「等不到」走了。
     * 现在拒绝，她还能去挑下一条；接了，就是答应一桩兑现不了的事。
     */
    const gap = paceGap(this.speedNow(), one.pace);
    if (gap) return { text: gap, isError: true };
    /*
     * **目的地是她家那座城，不接。**
     *
     * 不是矫情：`moveOn` 只知道「去某座城」，不知道「到了那座城就意味着一趟结束」。
     * 真把她送回去，`phase` 还是 `staying`、`tripStartedAt` 还在 ——
     * 没有 `journey.home` 事件、账不结、不进休息期，第二天她还能从「家」直接
     * 再挑一个目的地出门。等于用一次邀约绕过了整套回家的逻辑。
     *
     * 要回家有 `journey_return_home` 那条路，走那条。
     */
    const homeCity = this.resolveHome().city;
    if (dest.id === homeCity.id) {
      return {
        text: `那条邀约去的是${dest.name} —— 她家就在那儿。接了就成「回家」了，`
          + '而回家要走另一条路（`journey_return_home`），用邀约绕过去会把账和休息期全打乱。',
        isError: true,
      };
    }
    /*
     * 去不了就别接。
     *
     * 接到手里才发现走不到，是「答应了却没出现」—— 比不接难看十倍。
     * 这里先问一句 `canTravel`，跟选目的地用的是同一套判定。
     */
    /*
     * **两段都要走得通**（2026-11-07）。
     *
     * 有见面城的时候，第一段是去会合点，第二段才是从会合点去目的地。
     * 只验最终目的地的话，「成都见，再一起去拉萨」里成都那段可能是断的 ——
     * 她答应了，第二天才发现自己到不了会合的地方。
     */
    const firstStop = useMeet ?? dest;
    if (!canTravel(here, firstStop)) {
      return {
        text: `${firstStop.name}从${here.name}这儿去不了（隔着海，或者那边没有机场）。`
          + '先别接 —— 答应了到不了，比不答应难看。',
        isError: true,
      };
    }
    if (useMeet && !canTravel(useMeet, dest)) {
      return {
        text: `从见面的${useMeet.name}没路去${dest.name}。先别接 —— 见上了也走不成。`,
        isError: true,
      };
    }
    /*
     * **买不起的也不接。**
     *
     * 2026-11-05 的 144 天模拟抓到的：她在徐州，接了「一起去蒙特雷」，
     * 第二天早上 `moveOn` 一看跨洲机票买不起，直接作废、推一条「只能算了」。
     * 「我答应了」和「算了」隔了一夜 —— 这个坑完全可以在入口就避开：
     * 当时就可以算这张票买不买得起。
     */
    /* 第一段是去会合点，票钱也按第一段算 —— 去成都的票和去拉萨的票不是一个价。 */
    const km = Math.round(distanceKm(here, firstStop));
    const canGo = pickMode(
      here, firstStop, km, Math.random, this.isTight(), this.noFly(),
      this.affordMode(km, 0.5, here.country !== firstStop.country, { from: here, to: firstStop }),
    );
    if (!canGo) {
      return {
        text: `从${here.name}去${firstStop.name}这一趟的票钱她付不起（${km} 公里）。`
          + '先别接 —— 答应了买不起票，第二天就得反悔，比不接难看。',
        isError: true,
      };
    }
    /*
     * **赶得到吗**（2026-11-07 的 invite 档抓到）。
     *
     * 那一段日志：`洛阳当地 八点七分，动身去悉尼 —— 跟小满约在那儿碰头。轮船，8619 公里，13 天。`
     * 而赶路窗口只有三天 —— 这份约定从接下的那一刻就注定作废，
     * 三天后她会说「没赶上」，像是她自己的错。
     *
     * 这里问的是「按她要坐的这趟，多久能到」。到不了就别接，
     * 并且**说出是多少天**，她才能跟他解释清楚为什么这趟不成。
     */
    const needHours = hoursFor(canGo, km);
    if (needHours * 3_600_000 > PLEDGE_TRAVEL_WINDOW_MS) {
      const days = Math.round((needHours / 24) * 10) / 10;
      return {
        text: `从${here.name}去${firstStop.name}，${canGo.name}要 ${days} 天，`
          + `可这趟约的只给了 ${Math.round(PLEDGE_TRAVEL_WINDOW_MS / 86_400_000)} 天赶路 —— `
          + '到不了还说去，比不答应难看。先别接。',
        isError: true,
      };
    }

    /*
     * 开了「出门等点头」，就先问一句 —— **这时候还没接**。
     *
     * 顺序要紧：接了再问，等于她已经把话说出口了，他答「不好」时那份承诺
     * 已经在服务端躺着了（别人名单上多一只不会出现的鱼）。所以这里只写一张待批单，
     * 等服务端那声「接」由 `answerAsk(true)` 里发出。
     */
    if (!approved && this.cfg.askBeforeDepart) {
      const ask: Ask = {
        kind: 'accept',
        cityId: dest.id,
        days: one.days,
        inviteId: id,
        withPet: one.pet,
        note: one.note ?? null,
        askedAt: now.toISOString(),
      };
      this.st = { ...this.st, ask };
      this.persist();
      await this.push(
        'journey.ask',
        `ask-invite-${id}`,
        `想接${this.nameOf(one.pet)}那条：`
        + (useMeet ? `先在${useMeet.name}碰头，再一起去${dest.name}，待 ${one.days} 天。` : `一起去${dest.name}，待 ${one.days} 天。`)
        + '在等他点头。'
        + '\n（他答「好」之前她没有答应任何人；答了才算。）',
        'flush',
      );
      return {
        text: `想接 —— 但还没接。他开了「出门等点头」，这会儿先问他一句：`
          + `${this.nameOf(one.pet)}找${useMeet ? `在${useMeet.name}碰头、再` : ''}一起去${dest.name}、`
          + `待 ${one.days} 天${one.note ? `（「${one.note}」）` : ''}。`
          + '\n面板上已经有一张卡片，他点「好」才算真的答应。别当成已经约好了。',
      };
    }

    /*
     * 回程路上不接新的（2026-11-06，和 `claimTakenInvite` 同一件事）。
     * 她已经往家走了，接了也兑现不了 —— 那才是真的「答应了做不到」。
     */
    if (this.st.returning) {
      return { text: '她已经在往回走了，这时候接不了新的约 —— 先到家再说。' };
    }
    const r = await acceptInvite(meet, id);
    if (!r.ok) return { text: `没接成：${r.reason}。`, isError: true };

    this.st = {
      ...this.st,
      pledge: {
        cityId: dest.id,
        days: r.days,
        withPet: r.withPet,
        withPets: [r.withPet],
        inviteId: id,
        acceptedAt: now.toISOString(),
        arrivedAt: here.id === dest.id ? now.toISOString() : null,
        /*
         * 见面城。**没有这一级就不写这两个字段** —— 老约定（和老服务端回的）
         * 必须保持原样，那套行为已经跑了一年，不要顺手改掉。
         */
        ...(useMeet
          ? {
              meetCityId: useMeet.id,
              // 她本来就在会合点（最常见的「我在这儿等人」），这一刻就算到了。
              meetArrivedAt: here.id === useMeet.id ? now.toISOString() : null,
            }
          : {}),
      },
      /*
       * 接过的记下来。用途是「这一条别再出现」—— 让位之后它还在池子里，
       * 不记就能再接一次，而 `pledge-yield-<邀请编号>` 是固定 key，会推重。
       */
      claimedInvites: [...(this.st.claimedInvites ?? []), id].slice(-20),
    };
    // 她接了别人的 —— 同样算一起走过一次。名字是服务端给的，不是她编的。
    this.rememberPet(r.withPet, 6);
    // 同一份同行记录，另一头（见 `claimTakenInvite` 里那段注释）。
    this.partyLog.add({
      id,
      pets: [r.withPet],
      days: r.days,
      at: now.toISOString(),
      city: dest.name,
    });
    this.persist();

    await this.push(
      'journey.invite',
      `invite-${id}`,
      `答应了${this.nameOf(r.withPet)}：`
      + (useMeet ? `先在${useMeet.name}碰头，再一起去${dest.name}，在那儿待 ${r.days} 天。` : `一起去${dest.name}，在那儿待 ${r.days} 天。`)
      + (r.note ? `对方留的话是「${r.note}」。` : '')
      + (useMeet
        ? (here.id === useMeet.id
          // 就在会合点：立刻进入「等」。
          ? `\n她本来就在${useMeet.name}，从这会儿起就在这儿等人 —— 人露面了再一起走。`
          : `\n接下来她先往${useMeet.name}去会合，见上了再一起往${dest.name}走。`)
        : (here.id === dest.id
          ? `\n本来就在${dest.name}，接下来这几天就按这个过。`
          : `\n接下来她会真的往${dest.name}走 —— 不是明天就到，路上该多久是多久。`)),
      'flush',
    );

    /*
     * 在家接下的，**当场动身**。
     *
     * 按手动处理，两个门禁都跳过：加载后的宽限（「别在我装好的下一秒就消失」）
     * 和 7–21 点的出门窗口。理由是这一趟不是闲逛 —— 她已经答应了别人，
     * 而那条邀约 24 小时就过期，等到明天早上可能就没了。
     */
    if (this.st.phase === 'home') {
      this.log?.info(`在家接了一条去${dest.name}的邀约，这就动身。`);
      await this.depart(now, true);
    }

    return {
      text: `接了。${r.withPet}想去${dest.name}，待 ${r.days} 天 —— 现在就作数了：`
        + (useMeet
          // 两段：先碰头，再一起走。回执里必须分段说，否则她会以为下一站就是目的地。
          ? (here.id === useMeet.id
            ? `她本来就在${useMeet.name}，从这会儿起就在这儿等人 —— 人露面了一起走。`
            : `下一站先去${useMeet.name}碰头，见上了再一起往${dest.name}走，在那儿待满 ${r.days} 天。`)
          : (here.id === dest.id
            ? `她本来就在${dest.name}，这几天不走。`
            : `下一站会往${dest.name}走，到了之后待满 ${r.days} 天。`))
        + (r.note ? `对方原话：「${r.note}」。` : '')
        + '这件事该跟他说一句 —— 说清跟谁、先去哪儿碰头、去哪儿、几天，别当成通知念。',
    };
  },


  /**
   * 手上那份约定还有效吗。**纯判断，不改状态** —— 它会被面板、`journey_now`
   * 和巡检各叫一遍，某一次顺手改了状态，另外两处读到的就不是同一份东西了。
   *
   * 失效条件只有一个：**接下了却迟迟没到**。邀约本身 24 小时过期，
   * 但赶路要时间，所以给三天 —— 三天还没挪到那座城，这条就当没说过。
   */
  /**
   * 这份约定**下一步该去哪座城**。
   *
   * 两段：还没到见面城 → 去见面城；到了 → 去一起走的那座城。
   * 没有见面城这一级（老约定）时，第一条分支永远不成立，行为和加这一级之前一模一样。
   */
  pledgeStop(p: { cityId: string; meetCityId?: string; meetArrivedAt?: string | null }): string {
    return p.meetCityId && !p.meetArrivedAt ? p.meetCityId : p.cityId;
  },


  /**
   * 约定的那些人里，**今天有谁真的在脚下这座城**。
   *
   * 判据只有一条：服务端同城同时段有没有他们的名字。没有别的渠道 ——
   * 这个系统里两个人之间没有消息、没有位置推送，只有「谁在哪儿」这张表。
   *
   * ## 为什么查 `night` 而不是此刻
   *
   * 每只鱼每天只在**排表那一刻**上报一次（本地零点，`startHour = 0`），
   * 那条记录的时段是 `night`。拿此刻的时段去问，问的是「上午在这儿的人」——
   * 而上午没人重新上报，永远问不出东西来。这是 2026-11-07 读代码时发现的：
   * `journey.day` 里那句「这一带还有谁」大多为空，根子也在这儿。
   *
   * 代价是**只在早上问一次**（调用点在每天那个决策点）。
   * 对方当天下午才到的，她第二天早上才看见 —— 这就是「等一天」，可以接受。
   */
  async matesHere(p: Pledge, here: City, now: Date): Promise<{ names: string[]; ok: boolean }> {
    const meet = this.meetOptions();
    if (!meet) return { names: [], ok: false };
    const names = (p.withPets ?? [p.withPet]).map((x) => x.trim()).filter(Boolean);
    if (!names.length) return { names: [], ok: true };
    /*
     * 只问「此刻在这座城的有谁」，不问日期 —— 服务端按真实写入时刻划窗口。
     * 约好的人在不在这儿，是个当下的事，跟她的游戏内日历无关。
     */
    /*
     * **四个时段都要问**（2026-11-17，zzy1053 报的，附服务端源码可核）。
     *
     * 原来只查 `night`。而服务端 `cloud/sight-cf/src/worker.js` 的查询是
     * `WHERE city = ?1 AND slot = ?2 AND at >= ?3` —— **按 slot 硬过滤**，
     * 对方在 afternoon 上报的，查 night 永远拿不到。
     *
     * `SLOTS` 就四个（morning / afternoon / evening / night），全查一遍再合并去重。
     * 一天只判一次，四次请求的代价可以接受；漏一个人就废掉一天，那才是贵的。
     *
     * ⚠ 服务端那边 `LIMIT` 是常量 `MAX = 3`，**不读客户端传的 limit 参数** ——
     * 单个时段最多回 3 个，四个时段合并后才有机会看到 5 个人。
     */
    const boards = await Promise.all(
      (['morning', 'afternoon', 'evening', 'night'] as const)
        .map((s) => findNeighbors(meet, here.id, s, 3).catch(() => null)),
    );
    const have = new Set<string>();
    for (const b of boards) {
      for (const x of b?.list ?? []) have.add(x.pet.trim());
    }
    /*
     * 四个时段里**只要有一个查成了**就算查过。全都没成 = 不知道，
     * 调用方不能把它当成「没人」—— 这正是 11-16 那天被误判成「人没露面」的原因。
     */
    const ok = boards.some((b) => b?.ok);
    this.lastMeetOk = ok;
    return { names: names.filter((n) => have.has(n)), ok };
  },


  activePledge(now: Date): Pledge | null {
    const p = this.st.pledge;
    if (!p) return null;
    if (!cityById(p.cityId)) return null;
    /* 见面城写坏了就当没有这一级 —— 别因为一个字段把她整份约定废掉。 */
    const meet = p.meetCityId && cityById(p.meetCityId) ? p.meetCityId : undefined;
    const atMeet = Boolean(meet && p.meetArrivedAt && Number.isFinite(Date.parse(p.meetArrivedAt)));
    if (p.arrivedAt) return Number.isFinite(Date.parse(p.arrivedAt)) ? p : null;
    /*
     * 到见面城之后，窗口**从到站那一刻重新起算**。
     *
     * 不这么做的话会出现一个反直觉的失败：兰州到拉萨坐了两天车，落地那一刻
     * 「接约后三天」只剩一天，她再等一天就整份约定作废 —— 明明人已经在约定的地方了。
     */
    const anchor = atMeet ? Date.parse(p.meetArrivedAt!) : Date.parse(p.acceptedAt);
    const age = now.getTime() - anchor;
    if (!Number.isFinite(age) || age < 0) return null;
    const win = atMeet ? MEET_WAIT_WINDOW_MS : PLEDGE_TRAVEL_WINDOW_MS;
    return age <= win ? p : null;
  },


  /** 天数待满没有。只在「已经到了」之后才有意义。 */
  pledgeDone(now: Date, p: Pledge): boolean {
    if (!p.arrivedAt) return false;
    const ms = now.getTime() - Date.parse(p.arrivedAt);
    if (!Number.isFinite(ms) || ms < 0) return false;
    return ms >= p.days * 86_400_000;
  },


  /** 作废一份约定，并且说出来为什么 —— 静默丢掉，她明天会自己编一个解释。 */
  /**
   * 散伙时催她写一句印象（2026-11-11）。
   *
   * ## 为什么要有这一步
   *
   * `PetMemory.impression` 这个字段一直存在、工具 `journey_pet` 也一直能写，
   * 但**没有任何东西会催她**。真实数据：三份伙伴记录，三条 `impression` 全是空串。
   * 「她记得跟谁走过」是自动的（`rememberPet`），「她怎么看这个人」不是 ——
   * 不催就永远是空的。
   *
   * 而散伙那一刻是唯一自然的时机：人还在眼前，这几天的事是热的。
   * 过三天再问「你觉得她怎么样」，答案只会是「挺好的」。
   *
   * ## 三个分寸
   *
   * 1. **只在真一起过的时候问。** 没赶上、等不到人、路上被甩下 —— 那些不算同行，
   *    问了就是在编关系（调用方传 `askWrite` 控制）。
   * 2. **只问还空着的。** 已经写过的人不重复问：第二次同行要不要更新是她的自由，
   *    但每回都催一句就成了打卡任务。
   * 3. **给退路。** 明确写「没记住就空着」。不写这一句，她会为了完成指令
   *    编一句「是个好旅伴」—— 那正是这个字段最没用的形态。
   */
  impressionAsk(p: { withPet: string; withPets?: readonly string[]; days?: number }): string {
    return impressionAsk(namesIn(p), this.st.pets ?? {}, Number(p.days) || 1);
  },


  /**
   * 不等了（2026-11-17，zzy1053 报的）。
   *
   * ## 为什么必须有一个声音能说「不等了」
   *
   * 原话：「这三天里没有任何自助取消入口」，「她会跟用户说『你在面板上把那邀约撤掉』，
   * 用户照着找只会白找」—— 那句是空话。24 个工具、全部面板方法、
   * `/sight/invite`（只有 GET/POST）里都没有取消路径，唯一能走的是
   * 本地清 `pledge` 再重启 World，**普通用户做不到**。
   *
   * 内部一直有 `dropPledge()`：清约定 + 推一条事件 + 给对方留一句话。
   * 缺的只是一个入口 —— 这一条补的就是它。
   *
   * ## 不做面板按钮
   *
   * 面板只读（唯一例外是「搬过去」）。撤约定是她的判断：用户跟她说「别等了」，
   * 她来决定撤不撤。开这一个口子，就等于给「替她决定」开第二个。
   */
  giveUpPledge(now: Date, reasonRaw: string): { text: string; isError?: boolean } {
    const p = this.st.pledge;
    if (!p) {
      return {
        text: '现在没有在等人的约定 —— 没答应过谁，也就没什么可撤的。',
        isError: true,
      };
    }
    const who = this.whoOfPledge(p);
    const where = this.cityName(p.cityId);
    const atMeet = Boolean(p.meetCityId && p.meetArrivedAt);
    const reason = String(reasonRaw || '').trim().slice(0, 40);
    const why = reason
      ? `不等了：${reason.replace(/[。！!]+$/, '')}。跟${who}说好去${where}的那趟，你自己收的。`
      : `不等了。跟${who}说好去${where}的那趟，你自己收的。`;
    /*
     * `askWrite = false`：印象是「真一起过」才问的（见 `dropPledge` 头上那三条）。
     * 等人没等到，不算同行 —— 问了就是在编关系。
     */
    this.dropPledge(now, why, false);
    return {
      text: `撤了。跟${who}说好去${where}的那一趟作废了，对方那边会收到一句话。`
        + (atMeet
          ? '你还在见面城，人没来就是没来。接下来去哪，你自己定。'
          : '你现在还在原来的地方。接下来去哪，你自己定。'),
    };
  },


  dropPledge(now: Date, why: string, askWrite = false): void {
    const p = this.st.pledge;
    if (!p) return;
    /*
     * 先算提示再清 pledge —— `impressionAsk` 要读 `namesIn(p)`，
     * 而 `p` 在下面那行之后就没地方取了。
     */
    const ask = askWrite ? this.impressionAsk(p) : '';
    this.st = { ...this.st, pledge: null };
    this.persist();
    this.log?.info(`约定作废（${why}）。`);
    void this.push(
      'journey.invite',
      `invite-drop-${now.getTime().toString(36)}`,
      ask ? `${why}\n${ask}` : why,
      'flush',
    );
    /*
     * **打断一份约，得跟对方说一声。**（2026-11-15 Mr.Q）
     *
     * 原话：「钱是比约定重要啊，这种情况最好给约定对方反馈一下。」
     *
     * 原来只在自己这边推一条事件，对方那边什么都不知道 —— 人家可能还在那座城里等。
     * 走的是 `/card` 留言板（服务端本来就有，不用改接口），40 字上限。
     */
    void this.tellTheOtherSide(p, why);
  },


  /**
   * 约作废时，给对岸留一句话。
   *
   * ## 为什么只写「哪一趟、去不成」，不写细节
   *
   * 服务端的卡是 40 个字，而 `why` 是我们这边的整句（「成都从这儿去不了，
   * 跟小满说好的那趟只能算了。」）。整句塞进去会从半截断掉，比不写还难看。
   * 所以只挑一个短原因：钱、被叫回、还是别的。
   *
   * 对方要的是「这事儿黄了」，不是我们这边的账目。
   */
  async tellTheOtherSide(p: Pledge, why: string): Promise<void> {
    const meet = this.meetOptions();
    if (!meet) return;
    const id = String(p.inviteId ?? '');
    if (!/^[a-f0-9]{16}$/.test(id)) return;
    const city = this.cityName(p.cityId);
    const short = why.includes('钱')
      ? '钱不够了'
      : why.includes('叫')
        ? '得先回家'
        : why.includes('上限')
          ? '出门时间到了'
          : '临时出了岔子';
    try {
      await putCard(meet, id, `${city}那趟我去不成了：${short}。`.slice(0, 40), '');
    } catch {
      /*
       * 留不成就算了。**不能因为通知不到对方，把「回家」这件事也卡住** ——
       * 那会变成「因为她没网，所以必须继续在外面走」。
       */
    }
  },


  /**
   * 每次巡检顺手看一眼：手上那份约定是不是已经废了。
   *
   * 它自己会过期（接下三天还没到），而过期这件事必须**由巡检来落盘** ——
   * `activePledge` 是纯判断，它只会让那份约定「不生效」，不会把文件里的那一行删掉。
   * 不清理的话，用户打开 `state.json` 会看到一条半个月前的承诺。
   */
  prunePledge(now: Date): void {
    const p = this.st.pledge;
    if (!p) return;
    /*
     * **人在路上，去的却不是约定的那座城**（2026-11-06）。
     *
     * 老版本会在途中认领别人接的邀约（`claimTakenInvite` 现在挡住了新的），
     * 可升级前已经落盘的脏数据还在 `state.json` 里。飞机改不了航向，
     * 这份约定从建立起就兑现不了 —— 当场作废，别留着让面板天天写一条假承诺。
     */
    /*
     * 判的是**下一站**，不是最终那座城（2026-11-07）。
     * 有见面城的时候「在飞成都、约的是稻城」是**对的** —— 成都就是去会合的地方。
     * 拿最终城去比，会把每一份正常的赴约都判成「赶不上」。
     */
    const stop = this.pledgeStop(p);
    if (this.st.phase === 'traveling' && this.st.leg && this.st.leg.toId !== stop) {
      const who = this.whoOfPledge(p);
      /*
       * 已经陪完了那几天的不叫「赶不上」。待满之后 `moveOn` 正常带货走，
       * 只是 pledge 那行没来得及清 —— 这时候说「只能算了」，等于把一次
       * 如约的同行说成放人鸽子。
       */
      const done = Boolean(p.arrivedAt) && this.pledgeDone(now, p);
      this.dropPledge(
        now,
        done
          ? `跟${who}在${this.cityName(p.cityId)}那几天过完了，各走各的。`
          : `跟${who}说好去${this.cityName(p.cityId)}，`
            + `可人已经在往${this.cityName(this.st.leg.toId)}的路上了 —— 这趟赶不上，只能算了。`,
        // 只有「陪完了」才值得问一句印象；赶不上那趟根本没一起待过。
        done,
      );
      return;
    }
    if (this.activePledge(now)) return;
    /*
     * 过期分三种说法。**混成一句就是替她说错话**：
     * 一个是压根没赶到，一个是到了地方等不到人，还有一个是陪着玩完了没走成。
     */
    const name = this.cityName(p.cityId);
    const meetName = p.meetCityId ? this.cityName(p.meetCityId) : name;
    if (p.arrivedAt) {
      this.dropPledge(
        now,
        `跟${this.whoOfPledge(p)}在${name}那几天早就过完了，这一页翻过去。`,
        true,
      );
      return;
    }
    if (p.meetCityId && p.meetArrivedAt) {
      this.dropPledge(
        now,
        `跟${this.whoOfPledge(p)}约在${meetName}见，在${meetName}等了几天没见着人 —— `
        + `总不能一直等下去，这趟自己走。`,
      );
      return;
    }
    this.dropPledge(now, `跟${this.whoOfPledge(p)}说好去${meetName}的那趟没赶上（过了三天还没到），这事儿只能算了。`);
  },

};
