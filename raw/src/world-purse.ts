/**
 * 大肥鱼环游世界 —— 钱袋档位、打工、票价、打车桥接与状态摘要子系统。
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

export const purseMethods: Record<string, any> = {
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
  async startWork(now: Date, here: City): Promise<void> {
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
  },


  /** 干满了，收工接着走。 */
  async endWork(now: Date, here: City): Promise<void> {
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
  },


  /**
   * 记一笔花销。
   *
   * ## 两本账，分开判（2026-11-15）
   *
   * 一笔钱可能同时要记两处，而且**两处的开关是分开的**：
   *
   * | 账 | 开关 | 记什么 |
   * |---|---|---|
   * | 这一趟花了多少 | `moneyEnabled` | 面板、日记、「这趟花了三万」那句话 |
   * | 从她的钱包里扣 | `payFromLife` | 递一张条子给「模拟鱼生」，由它自己扣 |
   *
   * Mr.Q 的话：「journey 没开钱（无上限）鱼生这边的钱该怎么算」——
   * 答案不是二选一，是分清「这趟花了多少」和「这钱谁出」。
   *
   * ## 为什么不直接扣
   *
   * `life-state.json` 只有一个写者（life 自己）。两个进程同时写同一个文件，
   * 迟早写坏一次，而那次一定是她的账 —— 所以这里只递条子（`life-spend/<id>.json`），
   * 由 life 下次 tick 消费、去重、落盘。见 `references/20-跨扩展联动.md`。
   */
  addSpent(n: number, note = ''): void {
    if (!(n > 0)) return;
    const amount = Math.round(n);
    if (this.cfg.moneyEnabled) this.st = { ...this.st, spent: this.st.spent + amount };
    if (this.cfg.moneyEnabled && this.cfg.payFromLife) this.queueLifeSpend(amount, note);
  },


  /**
   * 给她那边递一张「这一笔该扣我的」条子。
   *
   * 三条边界：
   * - **没装 life 就不写**：`life-state.json` 不在，说明没有那本账（只有 journey 的用户）；
   * - **文件名就是 id**：life 处理不过来时要能用文件名回一条 `rejected`；
   * - **写不进去只记日志**：不能因为递不出条子把行程搞挂 —— 那会变成「她因为磁盘满而不走了」。
   */
  queueLifeSpend(
    amount: number,
    note: string,
    effect?: {
      vitalsDelta?: Partial<Record<'food' | 'energy' | 'clean' | 'fun' | 'social', number>>;
      fitnessDelta?: number;
      moodlet?: { text: string; kind: 'good' | 'bad'; hours: number };
    },
  ): void {
    try {
      if (!existsSync(join(this.opts.dataDir, 'life-state.json'))) return;
      /*
       * 递条子之前顺手清一次旧的 —— **不另起一个轮询**。
       * 她那边处理完会把 id 写进 `life-spend-settled.json`；这份回执是我们读的、
       * 条子是我们自己的文件，所以也由我们删（谁的文件谁删）。
       */
      this.cleanupSpendTickets();
      const dir = join(this.opts.dataDir, 'life-spend');
      const stamp = this.realNow().getTime().toString(36);
      const id = `sp-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          at: this.realNow().toISOString(),
          amount,
          note: String(note || '').slice(0, 60),
          ...(effect?.vitalsDelta ? { vitalsDelta: effect.vitalsDelta } : {}),
          ...(effect?.fitnessDelta ? { fitnessDelta: effect.fitnessDelta } : {}),
          ...(effect?.moodlet ? { moodlet: effect.moodlet } : {}),
        }, null, 2),
      );
    } catch (e) {
      this.log?.warn(`这一笔没能递给她那边：${(e as Error)?.message ?? e}`);
    }
  },

  /** 纯状态反哺给 life（不扣钱，请客模式下同样生效）。 */
  queueLifeEffect(
    note: string,
    effect: {
      vitalsDelta?: Partial<Record<'food' | 'energy' | 'clean' | 'fun' | 'social', number>>;
      fitnessDelta?: number;
      moodlet?: { text: string; kind: 'good' | 'bad'; hours: number };
    },
  ): void {
    this.queueLifeSpend(0, note, effect);
  },

  /** 读模拟鱼生广播的精力与体质（30 分钟内有效，用于影响交通方式/景区代步与脚酸文案）。 */
  readLifeVitals(): { energy: number; fitness: number } | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      const nowMs = this.realNow().getTime();
      const upd = Date.parse(String(raw?.updatedAt ?? ''));
      if (!Number.isFinite(upd) || Math.abs(nowMs - upd) > 30 * 60_000) return null;
      const e = Number(raw?.vitals?.energy);
      const f = Number(raw?.vitals?.fitness);
      if (!Number.isFinite(e)) return null;
      return {
        energy: Math.max(0, Math.min(100, e)),
        fitness: Number.isFinite(f) ? Math.max(0, Math.min(100, f)) : 25,
      };
    } catch {
      return null;
    }
  },


  /**
   * 清掉她那边已经处理过的条子。
   *
   * 回执在 `life-spend-settled.json`（她写的，我们只读）。**没有回执也别留无限久** ——
   * 超过 30 天的直接丢：那时候钱早就扣过了，留着一张旧条子只会在下一次
   * 重装 life 之后被再扣一遍。
   */
  cleanupSpendTickets(): void {
    const dir = join(this.opts.dataDir, 'life-spend');
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return; }
    if (!names.length) return;

    const done = new Set<string>();
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-spend-settled.json'), 'utf8'));
      for (const x of (raw?.settled ?? []) as { id?: string }[]) {
        if (x?.id) done.add(String(x.id));
      }
    } catch { /* 还没回执 —— 那就只按天数清 */ }

    const nowMs = this.realNow().getTime();
    for (const name of names) {
      const full = join(dir, name);
      const id = name.replace(/\.json$/, '');
      let drop = done.has(id);
      if (!drop) {
        try { drop = nowMs - statSync(full).mtimeMs > 30 * 86_400_000; } catch { drop = false; }
      }
      if (drop) { try { unlinkSync(full); } catch { /* 删不掉就留着，下次再说 */ } }
    }
  },


  /** 现在手头紧不紧。记账关着或没设预算，永远不紧。 */
  /**
   * 钱袋子的档位。
   *
   * `ok` 正常走 / `tight` 住便宜的坐慢车 / `low` 只走近处且不坐飞机 / `empty` 停下打工。
   * 记账关着、预算填 0（不限），永远是 `ok` —— 没记账就别替用户省钱。
   */
  /**
   * 模拟鱼生广播的「这趟能动用的钱」。
   *
   * 读不到返回 `null` —— **不是 0**。那边现金耗尽时广播的就是 0，
   * 0 是「没钱了」，跟「没装生活层」是两回事，不能混（混了的后果见 `purseStage`）。
   */
  lifeAllowance(): number | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      const allowance = Number(raw?.ledger?.travelAllowance);
      if (Number.isFinite(allowance)) return Math.max(0, Math.round(allowance));
    } catch { /* 没装生活层或文件坏了，退回手填预算 */ }
    return null;
  },

  /**
   * 现在还能花多少（绝对额）。`null` = 没有钱这个概念（记账关着 / 手填预算 0 = 不限）。
   *
   * **生活层优先，而且不再减 `spent`**：那边广播的现金已经把旅行条子扣过了，
   * 再减一次等于同一笔路费扣两回 —— 2026-11-16 审查查出：现金 7000、已花 3000 时
   * 余钱被算成 500，实际能动的是 3500。
   */
  purseLeft(): number | null {
    if (!this.cfg.moneyEnabled) return null;
    const life = this.lifeAllowance();
    if (life !== null) return life;
    if (this.cfg.budget <= 0) return null;
    return this.cfg.budget - (this.st.spent - this.st.earned);
  },

  purseStage(): 'ok' | 'tight' | 'low' | 'empty' {
    if (!this.cfg.moneyEnabled) return 'ok';
    const life = this.lifeAllowance();
    if (life !== null) {
      /*
       * 生活层给的是实时余额：**只按绝对地板降档**，没有「预算的百分之几」可算。
       * 而且**广播 0 = 没钱了**，要落到 `empty` 停下打工 ——
       * 不能走下面那句 `budget <= 0 → ok`，那句的意思是「用户手填 0 = 不记账、别替她省」。
       */
      if (life < PURSE_EMPTY.floor) return 'empty';
      if (life < PURSE_LOW.floor) return 'low';
      if (life < PURSE_TIGHT.floor) return 'tight';
      return 'ok';
    }
    if (this.cfg.budget <= 0) return 'ok';
    // 净值 = 花掉的 - 挣到的。打工收入不该让「已经花了多少」这个数字变小。
    const left = this.cfg.budget - (this.st.spent - this.st.earned);
    const under = (t: { pct: number; floor: number }): boolean =>
      left < Math.max(this.cfg.budget * t.pct, t.floor);
    if (under(PURSE_EMPTY)) return 'empty';
    if (under(PURSE_LOW)) return 'low';
    if (under(PURSE_TIGHT)) return 'tight';
    return 'ok';
  },


  /** 任何一档不宽裕都算「紧」：住宿降级、慢车优先。 */
  isTight(): boolean {
    return this.purseStage() !== 'ok';
  },


  /**
   * 手上的钱最远能走多远（公里）。
   *
   * 2026-11-03 查出来的：召回时她在三亚，返程选点会挑到「离家近、但要绕远路」的城市
   * （三亚 → 张掖 2460 公里，因为张掖离兰州只有 500 公里）。然后票价超过余钱，
   * `pickMode` 一个方式都给不出来，`moveOn` 兜底直接传送回家 ——
   * 用户看到的是「按了一下，人瞬移了」。
   *
   * 所以**选点的时候就得知道「我买得起多远」**，不能等选完了才发现走不了。
   * 按最便宜的地面方式（公交 0.4 元/公里）估，而且只用一半余钱买路 ——
   * 剩一半留给到了之后的住和吃，和 `affordMode` 的判据保持一致。
   */
  purseRangeKm(): number {
    const left = this.purseLeft();
    if (left === null) return Infinity;
    if (left <= 0) return LOW_KM;
    return Math.max(200, (left * 0.5) / 0.4);
  },

  /**
   * 钱只够走近处了：候选卡在 LOW_KM 以内。
   *
   * 和「不坐飞机」分开两个判据：见底才限距离，但**只要开始紧就不该买机票** ——
   * 一张跨洲票够她打两次工。144 天模拟里就是这样：打工回血到「紧」档，
   * 概率压过之后还是中了机票，一次几千，直接又见底。
   */
  nearOnly(): boolean {
    const st = this.purseStage();
    return st === 'low' || st === 'empty';
  },


  /**
   * 不坐飞机。紧、见底、空了都算。
   *
   * **回家路上例外**：在国外没钱了还不让买票，她会永远卡在那座城市回不来。
   */
  noFly(): boolean {
    if (this.st.returning) return false;
    return this.purseStage() !== 'ok';
  },


  /**
   * 这一段的票价。和 `addSpent` 用的是同一个算式，别让两处算出差。
   *
   * **飞机分段算。** 2026-11-03 Mr.Q 给的真实数字：兰州飞三亚淡季 800-900 元，
   * 也就是两千公里八百块上下。原来按全价票校准（1.5 元/公里）差了四倍，
   * 后果是「她明明买得起机票，系统却说她买不起」，只能一路走回去。
   *
   * 分段是因为国际长途确实贵：0.4 元/公里一路乘下去，一万公里才四千，
   * 而实际洲际机票要六七千。三千公里以内按国内经济舱算，往上逐段加价。
   */
  fareOf(modeId: string, km: number, crossBorder = false, seatMult = 1): number {
    /*
     * `seatMult` 是座位档的倍数（二等 1 / 一等 1.6 / 商务 3.5 / 公务舱 2.8……）。
     * **默认 1 = 最低档**，所以「买不买得起」（`canAffordTrip`）那条老路径不用改：
     * 它问的是「最省能不能走」，那本来就该按最低档算。
     */
    if (modeId === 'plane') {
      /*
       * 国内经济舱 0.4 元/公里，跨国贵一截。
       *
       * 2026-11-03 模拟抓到的：不分国内国际的话，兰州飞大阪 2600 公里只要 1040 块，
       * 比现实便宜一半 —— 她于是动不动就飞出去，预算 3000 的人 48 天花掉四万七。
       */
      const per = crossBorder ? 0.85 : 0.4;
      const base = crossBorder ? 2400 : 1200;
      return (km <= 3000 ? km * per : base + (km - 3000) * 0.9) * seatMult;
    }
    /*
     * 铁路分段算（2026-11-08）：短途高铁、长途卧铺，单价差一倍。
     * 其余方式还是「单价 × 里程」，它们的单价不随距离变。
     */
    if (modeId === 'train') return km * trainUnit(km) * seatMult;
    return km * (FARE_PER_KM[modeId as ModeId] ?? 0) * seatMult;
  },

  /**
   * 这一段的票钱 —— **按腿上年份的那张票算**，不是按「现在重算一遍」。
   *
   * 为什么要单独一个函数：改签和到站补记（老存档）都得拿到「这张票当时花了多少」。
   * 重算一遍会跟着费率表变，而这条腿是几天前买的。
   */
  fareOfLeg(leg: { modeId: string; km: number; seatMult?: number }, crossBorder: boolean): number {
    return this.fareOf(leg.modeId, leg.km, crossBorder, leg.seatMult ?? 1);
  },

  /**
   * 退票 —— **全额退回，不扣手续费**。
   *
   * 2026-11-16，Mr.Q 定的规则：「全退吧，这个不必模仿现实。」
   * 现实里改签有手续费、退票按梯度扣，那是铁路和航司的定价策略；
   * 在这里它只会变成一条用户永远猜不到的钱窟窿 —— 而她改签的理由通常是
   * 「他刚说买机票吧」，不是她自己反悔。所以全退。
   *
   * ## 为什么是减 `spent` 而不是加 `earned`
   *
   * `earned` 的语义是「打工挣的」，退款既不是挣也不是花，是**那笔钱没花出去**。
   * 减 `spent` 之后，日记里「这趟花了多少」也跟着少 —— 这才是对的：
   * 那张票退了，这一趟确实没花这笔。
   *
   * ## `payFromLife` 那一头退不回来
   *
   * 递条子是**单向**的（`life-spend/<id>.json` 只表达「该扣我多少」），
   * 没有负数条子这种约定。所以这一笔在 life 那本账上仍然算花掉了。
   * 不假装能退 —— 记一条日志，等两本账合并的口径定了再说。
   */
  refundFare(leg: { fare?: number }): number {
    /*
     * **只退真付过的那一笔。** `fare` 是 1.8.12 才有的字段，升级前就在路上的腿没有它 ——
     * 那一代是到站才结算，也就是**根本没付**。这时候按算式退一笔出去，
     * 等于凭空给她钱（2026-11-16 自查时抓到的）。判据用 `undefined`，不用 0：
     * 走路骑车真是 0 元票，那种票没有可退的，也没什么可错的。
     */
    const fare = leg.fare;
    if (!(typeof fare === 'number' && fare > 0)) return 0;
    if (this.cfg.moneyEnabled) {
      this.st = { ...this.st, spent: Math.max(0, this.st.spent - Math.round(fare)) };
    }
    if (this.cfg.payFromLife) {
      this.log?.info(`退了 ${Math.round(fare)} 块票钱，但这笔在 life 那本账上退不回来（递条子是单向的）。`);
    }
    return Math.round(fare);
  },


  /**
   * 这一趟买哪个座位档 —— **她自己判断**，见 `journey.ts` 的 `pickGrade`。
   *
   * 判断依据里只有一条来自环境：**她手上有多少钱**（余钱 ÷ 最低票价）。
   * 其余（长途更舍得、短途不值得）都在 `pickGrade` 里，是可解释的规则，不是玄学。
   *
   * 没记账 / 预算填 0 时传 `null` —— 那时按「不紧不松」算，她照样会偶尔升一次舱。
   */
  /**
   * 手头宽不宽 —— 住高档酒店、坐好座位共用这一个判据。
   *
   * 门槛是「够住十天快捷连锁」（约 2500）。为什么不按比例：
   * 预算三千的人剩一千八，比例上「还有六成」，但他负担不起一晚一千的房 ——
   * **绝对余钱才决定她今晚能不能住好**。
   *
   * 没记账（`moneyEnabled` 关着或预算填 0）一律当「不宽」：
   * 那时钱是抽象的，凭空让她住五星反而假。
   */
  purseRich(): boolean {
    const left = this.purseLeft();
    if (left === null) return false;
    return left > 2500;
  },


  /**
   * 景区里那一趟值不值得花钱（2026-11-10）。
   *
   * ## 为什么不复用 `purseRich()`
   *
   * `purseRich()` 问的是「手头宽不宽」，它决定住哪档店、坐什么座位 —— 那些是**可选的生活方式**。
   * 景区里的索道、观光车、自行车不是同类东西：**腿会不会酸和钱包没关系**。
   *
   * 而 `purseRich()` 在「记账关着」时恒为 false，于是记账一关，景区里就永远只能走路。
   * 用户截图里那句「腿酸就租个自行车呗」就是它的后果 —— 不是随机没抽到，是硬开关。
   *
   * 判据改成：**没有钱这个概念时（记账关着 / 预算不限），就不存在「省着花」**；
   * 有钱的概念时，看余额够不够坐一趟（三百块以下就不坐索道了）。
   */
  spotSpendOk(): boolean {
    const left = this.purseLeft();
    if (left === null) return true;
    const eff = this.effectiveLifeEnergy();
    const minNeed = eff !== undefined && eff < 40 ? 120 : 300;
    return left > minNeed;
  },

  /** 有效精力（energy + fitness * 0.25）。未装 life 或数据过期时返回 undefined。 */
  effectiveLifeEnergy(): number | undefined {
    const v = this.readLifeVitals();
    if (!v) return undefined;
    return v.energy + v.fitness * 0.25;
  },

  /** 高体质判定（fitness >= 60）：不抱怨脚酸。 */
  isHighFitness(): boolean {
    const v = this.readLifeVitals();
    return Boolean(v && v.fitness >= 60);
  },


  pickSeatFor(modeId: string, km: number, crossBorder: boolean): SeatGrade | undefined {
    const mode = modeById(modeId);
    if (!mode) return undefined;
    const cheapest = this.fareOf(modeId, km, crossBorder);
    const left = this.purseLeft();
    const purse = left === null ? null : left / Math.max(1, cheapest);
    return pickGrade(mode, km, purse);
  },


  /**
   * 这一趟回不回得去。
   *
   * 按**最便宜的那种方式**算，不按 `pickMode` 恰好挑中的那种 ——
   * 挑中火车（一千块）买不起、而飞机（八百块）买得起的时候，
   * 答案应该是「回得去」，只是得坐飞机。
   *
   * 门槛是余钱的八成：留两成，到家之后还要过日子。
   * 没记账、预算填 0 时一律算回得去。
   */
  canAffordTrip(km: number, crossBorder = false): boolean {
    const left = this.purseLeft();
    if (left === null) return true;
    if (left <= 0) return false;
    const cheapest = Math.min(...(['bus', 'train', 'plane', 'ship', 'car'] as const)
      .map((id) => this.fareOf(id, km, crossBorder)));
    return cheapest <= left * 0.8;
  },


  /**
   * 买得起哪种票。
   *
   * 上限是**剩余预算的一半**（至少 200 块）：留一半给到了之后住和吃。
   * 一条路费吃掉全部余钱，到了那儿第一晚就没着落 —— 那不叫出发，那叫赌。
   *
   * 回家路上例外：卡票钱她就永远回不来。只要还剩钱就按「买得起」算，
   * 真的一分不剩就不限制 —— 记账认了，人得回去。
   */
  affordMode(
    km: number,
    share = 0.5,
    crossBorder = false,
    /**
     * 这一趟从哪到哪。**只有回家路上用得上。**
     *
     * 不给的话，「没钱了怎么办」只能退回「大巴和步行」这种一刀切；
     * 而大巴跑不了两千公里，一刀切就会把人卡死在国外（见下）。
     * 给了就能算出「这一对上真能走的方式里，最便宜的是哪种」。
     */
    pair?: { from: City; to: City },
  ): ((m: TravelMode) => boolean) | undefined {
    const left = this.purseLeft();
    if (left === null) return undefined;

    /*
     * **一分钱都不剩的时候，什么票都买不起。**
     *
     * 2026-11-03 查出来的：原来这里两边都在 0 时返回 `undefined`，
     * 而 `undefined` 的意思是「不限制」—— 于是**钱花光了反而什么都能买**。
     * 144 天模拟里，预算 3000 的那趟花掉三万三、净花一万八，全是这么滚出来的。
     */
    if (this.st.returning) {
      /*
       * **回家路上，钱只拦「贵的」，不拦「走得成的」。**
       *
       * 原来这里是「还有钱就按余钱算，没钱只留大巴和步行」。看着很省，
       * 实际会把人卡死在国外：曼谷到兰州两千五百公里，大巴跑不了，步行五千里，
       * 于是 `pickMode` 一个候选都没有 —— 她既不回家、也不打工、也不动，
       * 一天一天烧钱。2026-11-05 的 goto 档里，她在曼谷这么躺了 143 个世界天，
       * 账从 6000 花到三万八，而且所有工具都以「正在往回走」拒掉。
       *
       * 所以判据改成：**这一对上真能走的方式里，最便宜的那种永远放行**。
       * 曼谷 → 兰州只有飞机走得成，那就欠一张机票 —— 现实里也是这么解决的
       * （借钱、退票、把东西卖了）。到家这一趟就结清，预算本来就是「这一趟」的。
       * 贵的不放行：没钱的时候没人会去坐头等舱。
       */
      if (pair) {
        const usable = usableModesFor(pair.from, pair.to, km);
        const fares = usable.map((m) => this.fareOf(m.id, km, crossBorder));
        const cheapest = fares.length ? Math.min(...fares) : 0;
        const cap = Math.max(left, cheapest);
        return (m) => this.fareOf(m.id, km, crossBorder) <= cap;
      }
      // 没给起终点（老调用方 / 测试）：退回原来的「有钱按余钱、没钱走便宜的」。
      if (left > 0) return (m) => this.fareOf(m.id, km, crossBorder) <= left;
      return (m) => m.id === 'bus' || m.id === 'walk';
    }
    if (left <= 0) return () => false;

    /*
     * `share` 默认一半：中途选下一站要留一半给到了之后的住和吃。
     * 回家是一次性的事，`settleHome` 那边传 0.8 —— 到家就没下一站了。
     */
    const cap = Math.max(200, left * share);
    return (m) => this.fareOf(m.id, km, crossBorder) <= cap;
  },


  /**
   * 挣了一笔。
   *
   * **分开记，不从 `spent` 里扣。** 第一版直接减 `spent`，理由是「这趟的账就是净花掉多少」——
   * 跑模拟才发现那个理由站不住：预算 500 跑 48 天，面板显示「花销 0」，
   * 而她明明住了几十晚、吃了上百顿。**花销是事实，不该被收入抹掉。**
   *
   * 判断钱够不够的地方一律用 `spent - earned` 这个净值。
   */
  earn(n: number): void {
    if (!this.cfg.moneyEnabled || !(n > 0)) return;
    this.st = { ...this.st, earned: this.st.earned + Math.round(n) };
  },


  /** 钱那一行。记账关着时返回空串 —— 不记就别提。 */
  moneyLine(): string {
    if (!this.cfg.moneyEnabled) return '';
    const { spent, earned } = this.st;
    const tail = earned > 0 ? `，打工挣了 ${earned} 块` : '';
    const life = this.lifeAllowance();
    if (life !== null) {
      /* 生活层是实时余额，没有「预算」这个数可报 —— 说还能动用多少，别说预算多少。 */
      if (life <= 0) return `这一趟花了 ${spent} 块${tail}，手头的钱已经见底了。`;
      if (life < TIGHT_THRESHOLD) return `这一趟花了 ${spent} 块${tail}，还能动用 ${life} 块，得省着来。`;
      return `这一趟花了 ${spent} 块${tail}，还能动用 ${life} 块。`;
    }
    if (this.cfg.budget <= 0) return `这一趟已经花了 ${spent} 块${tail}。`;
    // 还剩多少按净值算：挣的钱确实能花。
    const left = this.cfg.budget - (spent - earned);
    if (left <= 0) return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget} 已经花超了。`;
    if (left < TIGHT_THRESHOLD) return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget}，只剩 ${left} 块，得省着来。`;
    return `这一趟花了 ${spent} 块${tail}，预算 ${this.cfg.budget}，还剩 ${left} 块。`;
  },


  /* ---------------- 车费桥（2026-11-10） ---------------- */

  /**
   * 城里的车让给第三方打车扩展没有。
   *
   * ## 为什么不是「开关一开就让位」
   *
   * 开关默认是开的，而绝大多数用户没装打车扩展 —— 拿 `cfg` 直接判，
   * 那些人的鱼从此再也不打车，而他们什么都没改过。
   *
   * 所以让位条件多一条：**对方的目录真的存在**。`ride-pending/` 是它写待结算单的地方，
   * 装过一次就会留下。它不装，这条永远走不到。
   *
   * 已知边界：对方卸载后目录还留着（卸载不清别人的数据），她就一直不自己叫车了。
   * 这个方向是安全的 —— 少叫一次车只是少花点钱，反过来（两套车同时开）是双倍收费。
   */
  taxiYields(): boolean {
    if (!this.cfg.bridgeSpend) return false;
    try {
      return existsSync(join(this.opts.dataDir, PENDING_DIR));
    } catch {
      return false;
    }
  },


  /**
   * 结算第三方交上来的车费。
   *
   * ## 为什么在 tick 的最开头，而不是三个分支里面
   *
   * `tick()` 有三个 `return`（在家 / 在路上 / 在目的地）。写进其中任何一支，
   * 另一支的人就永远不结算 —— 而「在家打个车」恰恰是最常见的场景。
   *
   * ## 为什么扫完当场就结
   *
   * 留着「先记账、下次再结算」的中间态，就要处理「中间崩了」；一个 tick 内
   * 扫完就写进 state，中间没有可崩的窗口。
   */
  settleRides(): void {
    if (!this.cfg.bridgeSpend && !this.cfg.bridgeDiary) return;

    const read = readPending(this.opts.dataDir);
    if (read.problem) {
      this.log?.warn(read.problem);
      return;
    }
    if (read.files.length > PENDING_WARN_FILES) {
      this.log?.warn(`待结算目录里有 ${read.files.length} 个文件，对方可能一直没删。`);
    }
    if (!read.files.length) {
      this.unsettledRideFare = 0;
      return;
    }

    const c = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
    const r = settle({
      pending: read.files,
      applied: this.st.rideApplied ?? [],
      spent: this.st.spent,
      moneyEnabled: this.cfg.moneyEnabled,
      budget: this.cfg.budget,
      tripStartedAt: this.st.tripStartedAt,
      worldNow: this.worldNow().getTime(),
      // 真实时刻只用来判「这份文件躺了多久」，不用来判 `at` 的早晚。
      realNow: this.realNow().getTime(),
      cityExists: (id) => Boolean(cityById(id)),
      tzOf: (id) => cityById(id)?.tz ?? c.tz,
    });

    this.unsettledRideFare = r.unsettled;

    const changed = r.spent !== this.st.spent || r.applied.length !== (this.st.rideApplied?.length ?? 0);
    if (!changed) return;

    this.st = { ...this.st, spent: r.spent, rideApplied: r.applied };
    this.persist();

    /*
     * 推事件是**一次模型调用**，所以不能「一条异常推一条」。
     * 三条以内逐条说，多了并成一句 —— 用户要的是「出事了」，
     * 不是一屏同名通知。
     */
    const notices = r.notices;
    if (!notices.length) return;
    if (notices.length <= 3) {
      for (const n of notices) {
        void this.push('journey.ride', `ride-${n.id}`, n.text, 'flush');
      }
      return;
    }
    const rejected = notices.filter((n) => n.kind === 'rejected').length;
    const odd = notices.length - rejected;
    const parts = [
      rejected ? `${rejected} 条车费没记上` : '',
      odd ? `${odd} 条金额不对劲（已记）` : '',
    ].filter(Boolean);
    void this.push(
      'journey.ride',
      `ride-batch-${this.realNow().getTime().toString(36)}`,
      `打车那边交上来 ${notices.length} 条，${parts.join('、')}。细节在日志里。`,
      'flush',
    );
  },


  /**
   * 写公开快照 `journey-public.json`。
   *
   * ## 为什么挂在 `persist()` 上
   *
   * 它是 state 的一个投影，不是第二份真相。三个写点（state / 记忆 / 快照）
   * 分开放就会有一段「快照落后于状态」的窗口 —— 对方那段时间读到的是旧城市。
   *
   * ## 为什么自己吞异常
   *
   * 快照写不进去是「对方看不见」，state 写不进去是「她丢了位置」。
   * 前者不能把后者带崩。
   */
  writePublic(): void {
    try {
      const now = this.worldNow();
      const c = this.cityOrNull(this.st.hereId) ?? this.resolveHome().city;
      const d = this.diary.current;
      const leg = this.st.phase === 'traveling' && this.st.leg ? citiesOf(this.st.leg) : null;
      const snap = publicSnapshot({
        worldNow: now.getTime(),
        speed: this.speedNow(),
        phase: this.st.phase,
        hotelTier: this.st.phase === 'staying' ? (this.st.lodging?.value?.tier ?? '') : '',
        city: { id: c.id, name: c.name, tz: c.tz },
        leg: this.st.phase === 'traveling' && this.st.leg
          ? {
            fromId: this.st.leg.fromId,
            toId: this.st.leg.toId,
            fromName: leg?.from?.name ?? this.st.leg.fromId,
            toName: leg?.to?.name ?? this.st.leg.toId,
            modeId: this.st.leg.modeId,
            departedAt: this.st.leg.departedAt,
            arriveAt: this.st.leg.arriveAt,
          }
          : null,
        money: {
          enabled: this.cfg.moneyEnabled,
          budget: this.cfg.budget,
          spent: this.st.spent,
          earned: this.st.earned,
          unsettledRideFare: this.unsettledRideFare,
        },
        diary: { enabled: !d.problem, dir: d.dir },
        applied: this.st.rideApplied ?? [],
        /* 下一站，给鱼鱼出行的包车续站用。见 `nextStopForPublic`。 */
        nextStop: this.nextStopForPublic(),
      });
      const file = join(this.opts.dataDir, PUBLIC_FILE);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
      renameSync(tmp, file);
    } catch (e) {
      this.log?.warn(`公开快照没写成：${e instanceof Error ? e.message : String(e)}`);
    }
  },


  /**
   * 首页那张「正在打车」的卡。
   *
   * **只在面板来问的时候读**，不在 tick 里读：tick 是 60 秒，
   * 拿它驱动进度条会一格一格跳；而这东西的语义是「现在」。
   *
   * 一秒缓存：面板轮询很密，同一个文件一秒内问几次只读一次盘。
   *
   * 过期自己判 —— 不等对方写 `active:false`。它崩了，卡片不能永远挂在首页。
   */
  readLive(): LiveRide | null {
    const real = this.realNow().getTime();
    if (real - this.liveCache.at < 1000) return this.liveCache.value;
    let value: LiveRide | null = null;
    try {
      const file = join(this.opts.dataDir, LIVE_FILE);
      value = existsSync(file) ? parseLive(JSON.parse(readFileSync(file, 'utf8')), real) : null;
    } catch {
      value = null; // 对方正写到一半 / 文件坏了：这一秒就没有卡，不是错误
    }
    this.liveCache = { at: real, value };
    return value;
  },


  /**
   * **包车还在服务时间内吗**（2026-11-11，鱼鱼出行作者提的接口申请）。
   *
   * 判断条件就是对方申请里写的那三条，一条不多：
   * `service === 'charter'` + 没过 `expiresAt` + `to` 非空。
   * 前两条 `parseLive` 已经做过了（过期返回 null），这里只补 `to` 那一层 ——
   * 包车订单刚下单、目的地还没填的时候，不能因为她「有包车」就不给安排交通。
   *
   * 返回整条 `LiveRide` 而不是布尔：日记里可能要写去哪儿。
   */
  charterNow(): LiveRide | null {
    const live = this.readLive();
    if (!live || live.service !== 'charter' || !live.to) return null;
    return live;
  },


  /**
   * 她接下来要去的那一站，给公开快照用。
   *
   * 只认**带地名的 activity**（饭点、回酒店、睡觉都不算「去一个地方」）。
   * 跨城移动期间返回 null —— 那段时间的「下一站」是另一座城，
   * 由 `leg` 那一段说，不在这里重复，否则对方会拿它去改包车目的地。
   */
  nextStopForPublic(): { name: string; at: string } | null {
    const here = this.cityOrNull(this.st.hereId);
    const plan = this.plan;
    if (!here || !plan) return null;
    // 路上不报：跨城的下一站是城市，不是城里某个点。
    if (this.st.phase === 'traveling') return null;
    const moment = localMoment(this.worldNow(), here.tz);
    /*
     * 作息表可能已经是明天的（前一天晚上排的）。表属于哪天看 `plan.dateKey`，
     * 不是看「现在几点」—— 拿 `moment.dateKey` 比会漏掉整张明天的表。
     */
    const isToday = plan.dateKey === moment.dateKey;
    const next = plan.beats.find(
      (b) => b.kind === 'activity' && b.spot && (!isToday || b.at > moment.decimal),
    );
    if (!next?.spot) return null;
    return { name: next.spot, at: utcFromLocal(plan.dateKey, next.at, here.tz).toISOString() };
  },


  /**
   * 此刻是不是正在城里移动（打车 / 公交 / 骑车去下一个点）。
   *
   * 2026-11-11 Mr.Q：「把路上的时间段得加上去，不然 sub 扩展没法搞了」。
   *
   * 时间轴一直是准的 —— `planDay` 把通勤排在「活动时刻 − 路上分钟」，
   * 从来没错过。缺的是**把这段变成一个可读的状态**：
   * 她这边说不出「还要 21 分钟」，别的扩展也拿不到「在路上」这个信号。
   *
   * 两处消费：`nowSummary`（写进她每回合看的 `{{journey.now}}`）
   * 和 `uiSnapshot`（面板 + 别的扩展读）。**同一个判断，不许分两份写** ——
   * 分开写迟早会出现「她说的」和「面板写的」对不上。
   */
  onWayNow(): { what: string; leftMin: number; arriveAt: string } | null {
    const here = this.cityOrNull(this.st.hereId);
    const plan = this.plan;
    if (!here || !plan) return null;
    const moment = localMoment(this.worldNow(), here.tz);
    // 歇着的日子不报通勤：那天表里的 activity 全废了，通勤也跟着不算。
    if (this.st.rest && this.st.rest.dateKey === moment.dateKey) return null;
    const c = plan.beats.findLast((b) => b.kind === 'commute' && b.at <= moment.decimal);
    if (!c) return null;
    // 到达时刻 = 这一段之后第一个非通勤节点。`planDay` 正是照这个关系排的。
    const end = plan.beats.find((b) => b.at > c.at && b.kind !== 'commute');
    if (!end || moment.decimal >= end.at) return null;
    /*
     * `arriveAt` 用 `HH:MM` 而不是 `fmtHour` 的「十点三十四分」：
     * 这个字段是给**别的扩展**读的（用户原话：「不然 sub 扩展没法搞了」），
     * 中文时刻它得再解析一遍。给人的那句话在 `nowSummary` 里，那里才用中文。
     */
    const totalMin = Math.round(end.at * 60);
    return {
      what: c.what,
      leftMin: Math.max(1, Math.round((end.at - moment.decimal) * 60)),
      arriveAt: `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`,
    };
  },


  /**
   * 「还能花多少」—— 每回合那一份（2026-11-17）。
   *
   * 和 `moneyLine()` 分工：那个给面板和统计看，是**事后**语气（「这一趟花了多少」）；
   * 这个是她在 `nowSummary` 里每回合读到的那一行，是**现在**语气 ——
   * 说得出的应该是「我还走得起多远」，不是「我这趟花了多少」。
   *
   * 为什么要加：`moneyLine` 只挂在 `statsSummary`，而她每回合读的是 `nowSummary`。
   * 于是「钱不够」这件事在旅程上只有一个来源 —— 后台某天悄悄把她降档，
   * 她自己完全不知道，用户看到的是「她忽然不去那个地方了」。
   */
  purseTravelLine(): string {
    if (!this.cfg.moneyEnabled) return '';
    const left = this.purseLeft();
    if (left === null) return '';
    const spentPart = this.st.spent > 0 ? `这一趟花了 ${this.st.spent} 块，` : '';
    if (left <= 0) {
      return `${spentPart}能动用的钱见底了 —— 想走下一段，得先在这座城打几天短工攒路费。`;
    }
    if (left < PURSE_TIGHT.floor) {
      return `${spentPart}能动用 ${left} 块，走不远也住不好；想去的地方太远，就先攒。`;
    }
    return `${spentPart}能动用 ${left} 块。`;
  },


  nowSummary(): string {
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
        // 这一趟为什么走：赴约和「待够了想换地方」在记忆里不是同一件事。
        String(this.cfg.meetUrl ?? '').trim() !== '' && this.lastMeetOk === false
        ? '碰面服务器这会儿没连上，暂时不知道这一带还有谁。'
        : '',
      this.pledgeText(now),
        /*
         * **赶路那天也要报日记欠账。**
         *
         * 这一支漏了就不是小疏忽 —— 11-06 她正是从九寨沟往成都走，
         * 而漏掉的那一天就在路上。赶路的日子事件最密（发车、过站、到达），
         * 注意力被占满，本来就最容易忘。
         *
         * 时区按**目的地**算：晚上落脚的、写日记的那一天，是到了那儿之后的一天。
         */
        this.diaryLine(now, to ?? here),
      ].filter(Boolean).join('\n') + `\n${NOW_TAIL}`;
    }

    if (this.st.phase === 'home') {
      /*
       * 休息期读派生值，不读 `restingUntil` 那条戳 —— 两者在「改过配置」之后
       * 会不一致，而她每回合看到的这一段必须和面板一致。
       */
      const rest = this.stillResting(now)
        ? `在家休息，到 ${this.restDayLabel() ?? '过几天'} 再出门。`
        : '在家，随时可以动身。';
      /*
       * 「怎么回来的」这句必须在这儿 —— 它进的是 `{{journey.now}}`，也就是她
       * **每回合都能看到的那一段**。没有它，回家那几天的日记只能靠上下文里
       * 早就被截断的那条 `journey.home`，写出来一律是「这一趟结束了」。
       */
      const why = homeReasonText(this.st.homeReason);
      const been = this.st.everVisited.length ? `走到现在一共到过 ${this.st.everVisited.length} 个地方。` : '';
      /*
       * **在家这一支要自己报天气和钱**（2026-11-17）。
       *
       * 这一支有独立的 `return`，不走下面那段（那边的天气挂在 `plan` 上，
       * 而回家之后 plan 是 null）。原来漏的正是这里 —— 她在家待最久，
       * 却恰好是唯一拿不到天气和余额的那几天。
       */
      const m = localMoment(now, here.tz);
      const homeW = this.homeWeather?.dateKey === m.dateKey ? this.homeWeather.w : null;
      return [
        `${here.name}。${rest}`,
        why,
        been,
        `家里这样：${bodyFeeling(here, here)}`,
        weatherLine(homeW),
        this.purseTravelLine(),
        /*
         * 在家也照样写日记（提示词里那句「日记照写，别把回程说得像结束」）。
         * 不报的话，回家那几天就成了日记的空白 —— 而「回来之后」本来就是
         * 这一趟的一部分。
         */
        this.diaryLine(now, here),
      ].filter(Boolean).join('\n') + `\n${NOW_TAIL}`;
    }

    const moment = localMoment(now, here.tz);
    const plan = this.plan;
    /*
     * 「下一个点」要跳过景点里的中段话（`activity` 且没有 `until`）——
     * 那不是「接下来去哪儿」，只是「还在那儿」。混进来会读成
     * 「下一个点：四点一刻 还在伏羲庙」，像在报行程。
     */
    /*
     * 今天歇着的话，已经被取消的 `activity` 不能再出现在「下一个点」里 ——
     * 不然现状里写着「下一个点：十五点 逛古城」，她就会照着说，而那个点其实取消了。
     * 这就是 ro-berry 看到的那个矛盾：嘴上说歇着，行为照旧。
     */
    const restingToday = Boolean(this.st.rest && this.st.rest.dateKey === moment.dateKey);
    const next = plan?.beats.find(
      (b) => b.at > moment.decimal && !(b.kind === 'activity' && b.until === undefined)
        && !(restingToday && b.kind === 'activity'),
    );
    /*
     * 正在进行的活动（有 until，且此刻落在区间里）。
     * 只认带 `until` 的那条：中段插话的节点没有 until，拿它当「正在」会算出一个零点。
     */
    const nowAt = restingToday ? undefined : plan?.beats.findLast(
      (b) => b.kind === 'activity' && b.until !== undefined
        && b.at <= moment.decimal && moment.decimal < b.until,
    );
    /*
     * ## 此刻正在路上（2026-11-11，Mr.Q：「把路上的时间段得加上去」）
     *
     * 用户转来的反馈：「我鱼说打车要 34 分钟到，然后转头就跟我说到了。」
     *
     * 时间轴是对的 —— `planDay` 把通勤排在「活动时刻 - 路上分钟」，
     * 34 分钟一分不少地占着。**缺的是「这 34 分钟里她在哪」这句话。**
     *
     * 状态里原来只有两条：`此刻在X`（活动区间内）和 `下一个点 14:34 在兵马俑`。
     * 通勤那一段两条都不命中，于是她对「你现在在哪」只能答「打车去兵马俑」，
     * 说不出「还要 21 分钟」—— 用户听着就像转眼就到了。
     *
     * 判据：落在某个 `commute.at` 之后、它后面第一个非通勤节点之前。
     */
    /* 和面板同一个判断，见 `onWayNow`。已经在一个活动里就不算「在路上」。 */
    const onWay = nowAt ? null : this.onWayNow();
    return [
      `在 ${here.name}，当地 ${moment.dateKey} ${fmtHour(moment.decimal)}（${partWord(moment.part)}）。`,
      // 体感以「家」为参照：她是从兰州出来的鱼，到湿热的南方和回西北，
      // 身体的第一反应不是一回事。这句话让她随时说得出「受不受得了」。
      `身体感觉：${bodyFeeling(here, this.resolveHome().city)}`,
      /*
       * **店名要给她。**
       *
       * 原来只给 `kind`（「连锁商务酒店」），而面板给的是「时尚睡吧快捷宾馆(避暑山庄店)
       * （连锁商务酒店）· 240」。两边说法不一样，用户问「你住哪家」她只能报类别，
       * 或者干脆编一个 —— 2026-11-06 Mr.Q 截图里那两个数（240 / 560）
       * 就是这么对不上的：她说的和面板说的不是同一套措辞。
       *
       * `lodgingLabel` 就是面板用的那个函数，两边从此同一句话。
       */
      plan ? `今晚住：${lodgingLabel(plan.lodging)}，${plan.lodging.price} 块左右。${plan.lodging.feel}` : '',
      /*
       * **今天日记写了没**（2026-11-07）。
       *
       * Mr.Q 的原话：「还有我的鱼6号没写日记，不知道为啥」。
       * 查下来：日记写了五天（11-01 到 11-05），11-06 那天漏了，
       * 而**她手上的状态里根本没有这一项** —— 写不写全靠她主动想起工具表里那行字。
       *
       * 这跟「有车不说」「同伴不说」是同一条规律：不在 `nowSummary` 里的事，
       * 对她就是不存在的。所以欠账要摆在她每回合都读的那一段里。
       *
       * 措辞按时刻分两档，是为了**不让她中午就写**：日记该是晚上回酒店之后的事，
       * 中午看到「今天还没写」就动笔，那篇会写成半天的流水。
       */
      this.diaryLine(now, here),
      /*
       * 天气：**停留/路上用作息表那一份，在家用家里那一份**（2026-11-17）。
       *
       * 原来只有 `plan?.weather` —— 回家的那几天 plan 是 null，这一行就整条消失，
       * 而提示词里又写着「你看不到天气」，两句话叠起来把她的天气彻底封死。
       * 现在家也查（`this.homeWeather`），日期对上才用，对不上宁可不写。
       */
      weatherLine(
        plan?.weather
        ?? (this.homeWeather?.dateKey === moment.dateKey ? this.homeWeather.w : null),
      ),
      this.purseTravelLine(),
      plan?.sunriseHour !== null && plan?.sunriseHour !== undefined
        ? `日出 ${fmtHour(plan.sunriseHour)}，日落 ${fmtHour(plan.sunsetHour ?? 0)}。`
        : '',
      /*
       * **她现在就在某个地方待着。**
       *
       * 2026-11-01 Mr.Q 说「14:30 逛伏羲庙是个时间段，不是到了那一秒就参观完了」——
       * 原来这里只有「下一个点」，她 15:30 被问「你在干嘛」只能答「等晚饭」。
       *
       * 后面那个括号是她写照片画面时的依据（2026-11-14）：光有地名，
       * 模型对「敦煌博物馆」这种小馆没有先验，只能按城市风貌猜 —— 猜出来就是沙漠。
       * 给她「室内展馆，在市区」这七个字，她自己在 `describe` 里就会写室内。
       * **只给事实，不写「拍照时该按这个」** —— 那是工具描述的事，混进来就成了命令。
       */
      nowAt
        ? `此刻在${nowAt.spot ?? '外面逛'}${spotKindLine(nowAt.spot)}，算着待到 ${fmtHour(nowAt.until ?? 0)}。`
        : '',
      /*
       * **正在路上**。这一条要给出「还要几分钟」—— 只说「在路上」，
       * 她还是答不出用户最想知道的那个数。
       */
      onWay ? `此刻在路上：${onWay.what}，还要 ${onWay.leftMin} 分钟才到。` : '',
      /*
       * **这趟有车**（2026-11-06 补）。
       *
       * 车在 `st.car` 里，`planDay` 也确实在城里开车去景点 —— 但这一段（也就是
       * 她每回合真正能看到的那段）从来不提它。于是在群里被问「你在城里怎么走」，
       * 她只能猜「靠腿」，用户以为功能坏了。
       *
       * 判据是 `st.car` 而不是当天的通勤方式：车是跟着人走的，不是某一段的交通。
       */
      this.st.car
        ? `这一趟开着车（${this.st.car.fuel === 'ev' ? '电车' : '油车'}），`
          + '城里出门也是开车，不是靠腿。'
        : '',
      /*
       * **今天在城里怎么挪**（2026-11-07）。
       *
       * Mr.Q 的原话：「城市里的交通工具还有共享单车和电瓶车」。查下来这两样**早就有了**
       * （`inCityMode`：1.5 元单车、3 元电瓶车、公交 2 元、地铁 4 元、远处出租），
       * 排程里也确实在骑 —— 但这一段从来不提，她描述「今天怎么逛的」时手上没有这个事实。
       *
       * 和「有车不说」是同一个病：功能在，她看不见。所以这里把当天的通勤方式直接给她。
       */
      plan?.commute && plan.commute.trips > 0
        ? `今天在城里${plan.commute.modes.length ? `靠${plan.commute.modes.join('、')}` : '靠两条腿'}来回，`
          + `${plan.commute.trips} 趟`
          /*
           * 包车那几趟的价是 0（钱在订单里付过了），别写「0 块」——
           * 那读起来像「这趟白坐了」，而实际是**早就付过**。
           */
          + (plan.commute.price > 0 ? `，${plan.commute.price} 块。` : '，钱已经付在包车订单里了。')
        : '',
      restingToday && this.st.rest
        ? `今天歇着，剩下的点都不去了（${this.st.rest.reason}）—— 饭点照吃，晚上照常回酒店。`
        : '',
      this.todaySoFar(plan, moment.decimal),
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
      /*
       * 这座城的来历，**只在到站那天说一次**。
       *
       * 放在这儿而不是每段都带：一天念三遍同一个梗，她会像个复读的导游。
       * 到站那天提一次，正好是「刚下车、还没开始逛」的那会儿。
       */
      plan?.shape === 'arrival' && here.lore ? `这地方的来历：${here.lore}` : '',
      /*
       * 手上那份约定。**必须每回合都能看见。**
       *
       * 它决定了接下来几天去哪、待多久，而她不会主动去查 —— 只写在事件里的话，
       * 那件事在第三天就只剩一句被截断的上下文。
       */
      this.pledgeText(now),
      this.songHint(now),
      this.st.wishes.length ? `想去还没去的：${this.st.wishes.map((id) => this.cityName(id)).join('、')}。` : '',
    ].filter(Boolean).join('\n') + `\n${NOW_TAIL}`;
  },


  /**
   * 今天**已经过完**的那几段（2026-11-09）。
   *
   * ## 为什么要有
   *
   * Mr.Q 问：「这些附加的东西，桌宠会不会实际去用，写进日记里？」
   *
   * 查下来原来**看不见**：`nowSummary` 只报「此刻在哪」和「下一个点」。
   * 上午坐索道、中午请讲解，到晚上写日记时已经不在可见范围里，她只能靠
   * 被截断的上下文回忆 —— 回忆不起来就写「今天逛了逛」，或者编一段。
   *
   * 这跟「有车不说」「日记欠账不说」是同一条规律：
   * **不在每回合注入的那段里的事，对她就是不存在的。**
   *
   * ## 但只能给素材，不能给提纲
   *
   * 第一版写成 `今天走过：九点四十五 上午，翡翠谷；十点十五 坐索道上去的；…`
   * —— 带时间戳、分号分隔。Mr.Q 当场纠：「日记主要还是靠她自己的人格去写」。
   *
   * 他是对的，而且这跟日记工具自己描述里那句是同一个道理：
   * 「城市、路、饭、房间是**素材**，不是照着走的清单；一项项打勾正是让它
   * 读起来像机器的原因。」我一边这么写着，一边又造了一个更硬的清单。
   *
   * 所以现在：**去掉时间，去掉分号，只说去过哪儿、路上干了什么**。
   * 顺序天然在（她按先后说），但读起来是一句话，不是一张表。
   */
  todaySoFar(plan: DayPlan | null, nowDecimal: number): string {
    if (!plan) return '';
    const done = plan.beats.filter(
      (b) => b.at <= nowDecimal
        && b.kind !== 'commute' && b.kind !== 'wake' && b.kind !== 'sleep'
        && !(b.kind === 'breakfast' && nowDecimal > 12),
    );
    if (!done.length) return '';

    /* 地点：只取景点名，不要「上午，宏村」那种带时段前缀的写法。 */
    const spots: string[] = [];
    for (const b of done) {
      const spot = String(b.spot ?? '').trim();
      if (spot && !spots.includes(spot)) spots.push(spot);
    }
    /*
     * 路上干的事：取每条的第一小句（「坐索道上去的，缆车在钢索上…」→「坐索道上去的」）。
     * 整句塞进去会变成一长串，读着就成流水账了。
     */
    const events = done
      .filter((b) => b.kind === 'beat' || b.kind === 'hotel')
      .map((b) => String(b.what).split(/[，,。]/)[0]!.trim())
      .filter(Boolean)
      .slice(-3);

    /*
     * 多于四处时**保留开头那几处**，不截尾巴 ——
     * 日记里最先想起来的常常是清早第一站，砍掉它反而失真。
     * 总数报出来，她自己知道还有几处。
     */
    const shown = spots.length > 4
      ? `${spots.slice(0, 4).join('、')}等 ${spots.length} 处`
      : spots.join('、');
    const head = shown ? `今天去过：${shown}。` : '';
    const tail = events.length ? `路上${events.join('、')}。` : '';
    return head + tail;
  },


  /**
   * 「今天日记写了没」这一行。
   *
   * 三种说法：今天写过了 / 今天还没写（白天）/ 今天还没写（晚上了，该写）。
   * 昨天要是也空着，顺带提一句 —— 她漏了一天自己不一定知道，
   * 而补写这件事只有她自己能做（我不会替她写）。
   *
   * **只报「今天」和「昨天」。** 再往前翻会变成一张待办清单，
   * 而且那些天她本来也补不回来了。
   */
  /**
   * 模拟鱼生扩展是否正在运行（根据 life-public.json 的真实更新时间判，30 分钟内有效）。
   */
  lifeActive(): boolean {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      const at = Date.parse(typeof raw?.updatedAt === 'string' ? raw.updatedAt : '');
      return Number.isFinite(at) && Math.abs(this.realNow().getTime() - at) <= 30 * 60_000;
    } catch {
      return false;
    }
  },

  diaryLine(now: Date, here: City): string {
    if (this.st.phase === 'home' && this.lifeActive()) {
      return '日记：这会儿在家过日子，日记写到生活那边去（life_diary_write）。';
    }
    const moment = localMoment(now, here.tz);
    const today = moment.dateKey;
    if (this.diary.read(today)) return '日记：今天已经写过了。';

    const y = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const tripStart = (this.st.tripStartedAt ?? '').slice(0, 10);
    /*
     * 昨天算不算「空着」要两个条件：在旅行期间内、而且确实没写。
     * 旅行第一天没有「昨天」—— 那时候提一句会让她以为自己欠了两天。
     */
    const beforeTrip = Boolean(tripStart) && y < tripStart;
    const gap = !beforeTrip && !this.diary.read(y) ? `；${y.slice(5)} 那天也空着` : '';

    return moment.decimal >= 20
      ? `日记：今天还没写${gap} —— 回酒店后写一条。`
      : `日记：今天还没写${gap}（晚上回酒店再写）。`;
  },


  /**
   * 「手上那份约定」这一行。
   *
   * 两个调用点：`nowSummary`（在目的地那一支）、以及赶路那一支 ——
   * **两处都要给**。只在目的地给的话，她坐两天车的那段时间里手上什么都没有，
   * 被问一句「你去哪儿、为什么」只能从很早以前的上下文里捞，捞不到就编。
   */
  pledgeText(now: Date): string {
    const p = this.activePledge(now);
    if (!p) return '';
    const name = this.cityName(p.cityId);
    const meetName = p.meetCityId ? this.cityName(p.meetCityId) : name;
    /*
     * 会见面的三态（2026-11-07）。**「还没到」这一句原来把两种处境混成了一种**：
     * 一种是在往见面城赶，一种是已经在见面城等着了。她分不清，就会说
     * 「我还在路上」，而人其实已经坐在那家客栈里等了两天。
     */
    if (p.meetCityId && !p.arrivedAt) {
      if (p.meetArrivedAt) {
        const waited = Math.max(0, Math.floor((now.getTime() - Date.parse(p.meetArrivedAt)) / 86_400_000));
        return `跟${this.whoOfPledge(p)}约在${meetName}见，你已经到了`
          // 别写「等了两三天（第 1 天）」——两个数放在一起会自相矛盾。
          + (waited > 0 ? `、在这儿等了 ${waited} 天` : '')
          /*
           * 「不保证碰上」要写进现状（2026-11-17，zzy1053 报的）。
           *
           * 原话：「至少在文案里说明这是偶遇、不保证碰面」。约定只是两边各自
           * 往同一座城走，接约那边没有任何约束；不写这一句，她会把「没露面」
           * 当成对方失约，而实际是这机制本来就不保证。
           */
          + (this.lastMeetOk === false ? '，刚才没连上碰面服务器，暂时不知道对方到了没有。' : '，人还没露面。')
          + `这趟碰不碰得上不一定 —— 等见到了再一起去${name}，在那儿待 ${p.days} 天。`;
      }
      return `答应了${this.whoOfPledge(p)}在${meetName}碰头，再一起去${name}待 ${p.days} 天 —— 正在往${meetName}赶。`;
    }
    if (!p.arrivedAt) return `答应了${this.whoOfPledge(p)}去${name}，在那儿待 ${p.days} 天 —— 还没到。`;
    const ms = now.getTime() - Date.parse(p.arrivedAt);
    const left = Math.ceil((p.days * 86_400_000 - ms) / 86_400_000);
    if (this.st.hereId !== p.cityId) return `答应了${this.whoOfPledge(p)}去${name}，还没到那儿。`;
    /*
     * 待满了却还没走 —— **别说「还剩 0 天」**。
     *
     * 走不了的原因通常是钱（决策点里「打工」排在「约定」之前，她可能先去干六天）。
     * 而「还剩 0 天」连着一周挂在现状里，她读到就会说「说好三天我还没走」——
     * 那是把一件她没做错的事描述成了她的失约。
     */
    if (left <= 0) {
      return `跟${this.whoOfPledge(p)}说好的 ${p.days} 天在${name}已经待满，`
        + '人还都在，剩下是看她还能不能动身。';
    }
    /*
     * **「人已经到了」必须写出来**（2026-11-07）。
     *
     * Mr.Q 发来一段对话：她答「约好的在成都待三天，还剩两天。至于谁到了 ——
     * 我这边的表上真没写，不敢替他们编。」
     *
     * 查下来名单就在这一行里（`withPets` 三个人全在），问题出在**这句只报了天数和城市，
     * 没说人到了**。于是「谁到了」这个问题在她那儿变成一个「我没有这个字段」的问题，
     * 她把内部结构（“表”）讲给了用户听，本来该说的一句没说。
     *
     * `arrivedAt` 有值的语义本来就是「人都到了」（见 `mateLine` 的判据：
     * 人没到就不说「一起过」）。所以结论在这里直接给，别留给她自己推。
     */
    return `跟${this.whoOfPledge(p)}一起在${name}，${p.days} 天的约还剩 ${left} 天`
      + ' —— 人已经到了，就在身边。';
  },


  writeDiary(body: string, dateKey?: string): { text: string; isError?: boolean } {
    if (this.st.phase === 'home' && this.lifeActive()) {
      return {
        text: '你现在在家过日子，生活和旅行两个扩展都开着时，在家期间请用 life_diary_write 写生活日记；出门旅行再用旅行日记。',
        isError: true,
      };
    }
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
      /*
       * 车费那一段（2026-11-10）。
       *
       * **每次从表里重建，不做累积追加** —— 同一天重写日记，段落由判重表算出来，
       * 写几遍都只出现一次。把幂等交给「从事实推导」，不交给「记住写过没」。
       */
      body: text + (this.cfg.bridgeDiary ? rideParagraph(this.st.rideApplied ?? [], key) : ''),
    };
    const r = this.diary.write(entry);
    if (r.problem) return { text: `日记只存到本机了：${r.problem}`, isError: true };
    return { text: `写好了，${key} 这天，存在 ${r.path}。` };
  },


  addWish(name: string, why?: string): { text: string; isError?: boolean } {
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
  },


  statsSummary(): string {
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
      /*
       * 「有人应过她几回」（2026-11-14）。
       *
       * 这是整套设计里唯一一处她能看见「我帮到别人了」的地方 ——
       * 《死亡搁浅》只给 Like 不给踩，因为负向按钮一旦存在就会被用来发泄。
       * 同理，这里**只说次数，不说谁**：说得出是谁，账就变成了社交债。
       *
       * 数来自 `/sight/status` 的 `mineTaken`，跟着池子探针一起刷新；
       * 没连服务器时是 0，那一行干脆不出现（0 次邀约和「没连上」不该长得一样）。
       */
      this.poolProbe?.taken ? `有人应过她 ${this.poolProbe.taken} 回约。` : '',
      `日记目录：${h.dir}`,
      h.problem ? `⚠ ${h.problem}` : h.notice ? `ℹ ${h.notice}` : '目录可写。',
    ].filter(Boolean).join('\n');
  },


  /* ---------------- 提示词 ---------------- */

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
      /*
       * **画面描述用哪种语言**（2026-11-18，zzy1053 报的）。
       *
       * `describe` 那句工具说明是静态的（`TOOL_DECLS` 是常量数组，没法按配置变），
       * 所以真正的结论放在这里，说明里让她「按环境里这一行来」。
       *
       * 默认 `en`，老用户一个字节不变。
       */
      'journey.imageLang': this.cfg.imagePromptLang === 'zh'
        ? '中文。这个后端读中文（Qwen-Image / Kolors 这类），写中文细节不会丢 —— 而且中文更短，不容易撞 `describe` 的 60 字上限。'
        : '英文。这个后端是 CLIP 系（SDXL / SD1.5 / Flux），写中文会出乱码和画笔字水印。',
      /*
       * **「只有她一个人」这句话太弱，模型会自己补一个同行者（2026-11-11）。**
       *
       * 用户报的：「我没开一起出发，她说我开车。」截图里她原话是
       * 「你开着车，我倒先犯困」—— 他那个开关明明是关着的。
       *
       * 根子在措辞。`只有她一个人` 模型读成「她一个人住 / 一个人逛」，
       * 而不是「**那个人不在她身边**」。它知道屏幕那头有个人在看她，
       * 于是把「开车」这个动作分配给了他 —— 毕竟车里总得有个人开。
       *
       * 所以不能只说「一个人」，要说清**那个人在哪**：隔着屏幕。
       * 这一条每回合都进上下文，是所有叙述的地基。
       */
      'journey.withUser': this.cfg.withUser
        ? '同行（叙事上说「我们」）'
        /*
         * **改第二人称**（2026-11-18，zzy1053 报的）。
         *
         * 原文是「她一个人在路上。那个人隔着屏幕看她……她看不见他……」——
         * 这一条每回合都进上下文，是叙述的地基：**里面全是第三人称，她照着学**。
         *
         * 他的观察：thinking 里自称 she 的比例没降（11-16/17/18 是 19/13/7 条），
         * 而调用不同扩展时人称会变（调 journey 冒 she、调 terrarium 是 I）——
         * 说明这不是指代歧义，是**文风被模板带偏**。
         */
        : '你一个人在路上。那个人隔着屏幕看你 —— 不在你身边、不在你的车上、不在你的桌上；你看不见他，也不知道他此刻在做什么。别把他写进画面里，也别把该你做的事分给他。',
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
       * 只写「动作怎么用」，**不再列词表**（2026-11-14 按市集作者要求改）。
       *
       * 老版本现读宿主安装目录里的 `figure.json` 来保证她写的名字都存在。那是读别人的
       * 安装目录，和改宿主是同一类越界，宿主换一次布局就静默失效。
       *
       * 词表本来就在她的上下文里 —— 桌宠 World 的 `{{pet.vocab}}`。两份不一致时，
       * 她自己那份才是对的。
       */
      'journey.actions': actionsPrompt(),
    };
  },

};
