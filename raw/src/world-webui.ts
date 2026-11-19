/**
 * 大肥鱼环游世界 —— WebUI 面板声明、指示灯、快照与交互动作子系统。
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

export const webUiMethods: Record<string, any> = {
  /**
   * 设置页头部的两个徽章。
   *
   * 用户打开设置页，第一个想知道的是「她现在到底在哪儿」——
   * 这件事在配置项里一个字都没有，得翻日志才有。放两个徽章在这儿，
   * 不用点任何东西就知道她此刻在做什么。
   *
   * 只放两个：徽章多了就不是信息，是装饰。
   */
  settingBadges(): Array<{ label: string; value: string; tone?: 'on' | 'off' | 'plain' }> {
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
  },


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
        /*
         * 2026-11-06 用户来信要的：「希望插件里面可以直接看每天的日记」。
         * 原来日记只在同步盘的 md 文件里，要拿记事本打开 —— 那等于让用户去文件系统里找她。
         */
        { id: 'diary', title: '日记', description: '她每天写的那几段，按天翻。' },
        /*
         * 2026-11-11 用户来信（Discussion #586）：「散了就是真的散了 ——
         * 没有人知道下次在哪个城市还能撞见谁」。那一页要的是能再找到对方，
         * 但「她到底记不记得」这件事本来就没地方看 —— 记忆文件写得再满，
         * 用户不问她就永远不知道。这一页只做一件事：把那本记忆翻给他看。
         */
        { id: 'mates', title: '路上遇见的人', description: '她记得的每一只鱼：走过几次、上次哪天、她写的印象。' },
        /*
         * 2026-11-14 Mr.Q：「能不能像鱼鱼出行那样，两个按钮一格，点云端就只显示云端那几项？」
         *
         * 宿主的设置面板按 schema 自动渲染，**没有条件显示**（`ConfigProperty`
         * 里只有 enum / 范围 / 描述这些，没有 visibleWhen）。所以这件事只能在
         * 自己的面板里做 —— 设置页保留全量字段当「高级」，这一页只做
         * 「选一边、填那一边要的、保存」。
         */
        {
          id: 'settings',
          title: '生图设置',
          description: '她拍的照片从哪儿出来：云端还是本地，点一边只填那一边。',
        },
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
  },


  worldLamps(): WorldLamp[] {
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
            : { label: '天气', state: 'offline', hint: `还没查过，用的是${srcName}。不用管 —— 它自己会去查` };

    const health = this.diary.current;
    const diary: WorldLamp = health.problem
      ? { label: '日记', state: 'error', hint: health.problem }
      : { label: '日记', state: 'online', hint: `写得进去（目录：${health.dir}）` };

    /*
     * 照片这盏灯三态：
     *
     * - 什么都没配 → 灰（没启用，不是故障，红点会让人去修一个没坏的东西）
     * - 选了 ComfyUI 但没粘 workflow → **红**。这是「以为配好了其实不能用」，
     *   正是最需要有人提醒的那一种，而它不会自己好
     * - 能拍 → 按上一次的结果
     */
    /*
     * 判「配没配」一律用解析后的后端（2026-11-14）。
     * 直接看 `imageApi` 会在选了服务商预设时误判：地址来自预设、那一栏仍是空的。
     */
    const lampBackend = resolveImageBackend(this.cfg);
    const protoName = lampBackend.protocol === 'comfyui' ? 'ComfyUI' : '云端接口';
    const cfgProblem = this.photoConfigProblem();
    const photo: WorldLamp = cfgProblem && !lampBackend.api
      ? { label: '照片', state: 'offline', hint: '没配生图接口，只写字不拍照' }
      : cfgProblem
        ? { label: '照片', state: 'error', hint: cfgProblem }
        : this.photoOutcome === 'ok'
          ? { label: '照片', state: 'online', hint: `${protoName}，上一次拍成了` }
          : this.photoOutcome === 'fail'
            ? { label: '照片', state: 'error', hint: `${protoName}，上一次没拍成，日志里搜「没拍成」` }
            : { label: '照片', state: 'offline', hint: `${protoName}，配好了，还没拍过` };

    // 走 `realNow()`，不用 `Date.now()` —— 这个项目里时间是唯一入口，有测试守着。
    const now = this.realNow().getTime();
    if (!this.npCache || now - this.npCache.at > 2_000) {
      this.npCache = { at: now, value: this.currentSong() };
    }
    const np = this.npCache.value;
    const music: WorldLamp = np
      ? { label: '听歌', state: 'online', hint: `在放《${np.title}》` }
      : { label: '听歌', state: 'offline', hint: '没在放歌，或者没装「一起听歌」。没放歌时灰的是正常的，不用管', };

    return [weather, diary, photo, music];
  },


  /* ---------------- 面板 ---------------- */

  /**
   * 设置面板要的那几格当前值。
   *
   * ## 密钥只回「有没有」，不回明文
   *
   * 面板是浏览器里的一页，回明文等于把它又抄一遍到 DOM 上。而改密钥这件事
   * 本来就只需要「留空＝不动、填了＝覆盖」这一条语义 —— 看不见旧的也能操作。
   *
   * `keyInEnv` 要单独给一格：密钥一旦被 `adoptKeys` 搬进 `.env`，
   * 配置里那格就是**空的**。前端只读 `imageKey` 会显示「还没填」，
   * 而实际上早填过 —— 那是假信息，会让人重复填一遍。
   *
   * `preset*` 三项是预设自带的值，前端拿来做输入框的 placeholder：
   * 用户不填也知道最终会用哪个地址、哪个模型 —— 不然「选了豆包」这五个字
   * 对他没有任何解释力。
   */
  imageSettingsSnapshot(): Record<string, unknown> {
    const c = this.cfg;
    const backend = resolveImageBackend(c);
    const preset = (c.imagePreset ?? '').trim() || 'custom';
    return {
      protocol: /^comfy/i.test((c.imageProtocol ?? '').trim()) ? 'comfyui' : 'openai',
      preset,
      api: (c.imageApi ?? '').trim(),
      model: (c.imageModel ?? '').trim(),
      size: (c.imageSize ?? '').trim(),
      workflow: (c.imageWorkflow ?? '').trim(),
      promptNode: (c.imagePromptNode ?? '').trim(),
      negative: (c.comfyNegative ?? '').trim(),
      negativeNode: (c.comfyNegativeNode ?? '').trim(),
      /*
       * 下面这六项原来住在设置页的「生图」组里。组删掉之后，它们是
       * **唯一没有入口的一批** —— 所以一起搬到面板的「两边共用」区。
       * 不搬的话，删组就等于把它们从「难找」变成「改不了」。
       */
      minimal: Boolean(c.imageMinimal),
      style: (c.imageStyle ?? '').trim(),
      cast: (c.imageCast ?? '').trim(),
      /* 有人出镜那几张另用一套风格，留空就跟着 `style`（2026-11-17）。 */
      styleCast: (c.imageStyleCast ?? '').trim(),
      castChance: Number.isFinite(Number(c.imageCastChance))
        ? Math.min(1, Math.max(0, Number(c.imageCastChance)))
        : 1,
      watermark: (c.imageWatermark ?? 'auto').trim() || 'auto',
      timeoutSec: Number(c.imageTimeoutSec) || 0,
      photoDir: (c.photoDir ?? '').trim(),
      hasKey: Boolean(this.imageKey()),
      keyInEnv: Boolean((this.opts.keys?.read?.(IMAGE_KEY_NAME) ?? '').trim()),
      note: backend.note,
      sizeNote: backend.sizeNote,
      /*
       * 三档预设各自会填什么，一次全给前端。
       *
       * 只给「当前这一档」不够：用户在面板里点了「OpenAI」但还没保存时，
       * placeholder 需要立刻变成 OpenAI 的地址和模型 —— 那一刻后端保存的
       * 仍然是上一档。前端拿全表自己查，比每次点一下都问一次后端便宜。
       */
      presets: {
        doubao: presetDefaults('doubao'),
        openai: presetDefaults('openai'),
      },
    };
  },


  /**
   * 面板保存：写进 `cfg` 活对象，同时落盘到 `config.json`。
   *
   * ## 为什么不走 `POST /api/config`
   *
   * 那条路按**配置组**校验：组里没声明的键一律拒绝，找不到组直接 400。
   * 生图这一组已经从设置页删掉了（Mr.Q 2026-11-14：「把配置里面有关生图的条目删除」），
   * 组没了，`/api/config` 连寻址都找不到。
   *
   * 宿主另给了一条口子：`persist(patch)` —— 深合并进 `worlds.<id>`，
   * 活对象与 `config.json` 同步，**不经过任何 schema**。正是这里要的。
   *
   * ## 为什么要白名单
   *
   * 这是**从浏览器打上来**的一次写操作。面板是本地页面，但它走 HTTP，
   * 同机任何进程都能打这个口子。白名单保证它只能改生图那几项 ——
   * 尤其是碰不到 `enabled`、`homeCity` 这种会改变她行为的东西。
   */
  saveImageSettings(patch: unknown): Record<string, unknown> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('保存的内容不是一组键值');
    }

    const allowed = new Set([
      'imageProtocol', 'imagePreset', 'imageApi', 'imageModel', 'imageSize',
      'imageWorkflow', 'imagePromptNode', 'comfyNegative', 'comfyNegativeNode', 'imageKey',
      'imageMinimal', 'imageStyle', 'imageCast', 'imageStyleCast', 'imageCastChance',
      'imageWatermark', 'imageTimeoutSec', 'photoDir',
    ]);
    /*
     * 三个类型分家。
     *
     * `imageMinimal` 是 **boolean**，`imageTimeoutSec` 是 **number** —— 一律
     * `String()` 化会把 `false` 变成字符串 `'false'`，而它是**真值**，
     * 于是「关掉极简提示词」会变成「打开」，且不报错。这种错比崩了难查得多。
     */
    const booleans = new Set(['imageMinimal']);
    const numbers = new Set(['imageTimeoutSec']);
    /*
     * 0–1 的小数**不能进 `numbers`** —— 那里会 `Math.round`，0.3 变成 0，
     * 用户设「三成有她」会得到「一张都没有」。单独一组，并且夹到 [0,1]。
     */
    const floats = new Set(['imageCastChance']);

    const clean: Record<string, string | boolean | number> = {};
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (!allowed.has(key)) throw new Error(`生图设置里没有这一项：${key}`);
      if (booleans.has(key)) { clean[key] = value === true || value === 'true'; continue; }
      if (numbers.has(key)) {
        const n = Math.max(0, Math.round(Number(value)));
        clean[key] = Number.isFinite(n) ? n : 0;
        continue;
      }
      if (floats.has(key)) {
        const n = Number(value);
        clean[key] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
        continue;
      }
      clean[key] = String(value ?? '').trim();
    }
    if (Object.keys(clean).length === 0) throw new Error('没有要保存的内容');

    /*
     * 协议、预设、水印都是枚举。写进来一个认不出的值，表现不是报错，是
     * **「一直拍不出来」** 或「图悄悄被裁掉」—— 这些值决定走哪条分支，
     * 错了就静默走错。在这里挡掉，比让她在路上悄悄失败便宜得多。
     */
    const proto = clean.imageProtocol;
    if (typeof proto === 'string' && proto !== 'openai' && proto !== 'comfyui') {
      throw new Error(`生图后端只能是 openai 或 comfyui，收到的是「${proto}」`);
    }
    const preset = clean.imagePreset;
    if (typeof preset === 'string' && !['custom', 'doubao', 'openai'].includes(preset)) {
      throw new Error(`云端服务商只能是 custom / doubao / openai，收到的是「${preset}」`);
    }
    const mark = clean.imageWatermark;
    if (typeof mark === 'string' && !['auto', 'off', 'crop'].includes(mark)) {
      throw new Error(`水印只能是 auto / off / crop，收到的是「${mark}」`);
    }

    if (this.opts.persist) {
      /*
       * 宿主 `persist` 里的 `assignDeep` 改的就是 `cfg` 那一个对象
       * （`context()` 里 `cfg: this.section(...)`），所以活对象和 config.json
       * 会一起变 —— 不用、也不该再手写一遍 `Object.assign(this.cfg, …)`。
       */
      this.opts.persist(clean);
    } else {
      // 测试里没有宿主：只改内存。说出来，别让人以为存下来了。
      this.log?.warn('没有持久化通道，生图设置只改了内存，重启就没了。');
      Object.assign(this.cfg, clean);
    }

    return this.imageSettingsSnapshot();
  },


  /**
   * 面板的方法入口。
   *
   * 只有读、两个引导开关、一个「让她出发」和一个「把她的钟拉回我这边」。
   * 面板不给「让她现在就去某地」这种按钮 —— 那种事该她自己在对话里被说服，
   * 不该有人在设置页点一下就替她决定去哪。
   */
  async panelInvoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    /*
     * **`saveImageSettings` 跨面板可用，不按 `panel` 分流。**
     *
     * 除了「生图设置」页，照片页底部也有一格「额外存一份到」（`photoDir`）。
     * 它原来走 `ctx.setConfig('journey.services', { 'worlds.journey.photoDir': … })`
     * —— 而 `photoDir` 从头到尾**没在那个组的 schema 里声明过**，所以那一路
     * 一直是 400（回执原话：配置组 journey.services 没有声明 worlds.journey.photoDir），
     * 只是没人点过。生图组删掉之后更是连组都没了。
     * 统一收到这里，两个页签共用同一条白名单与同一套落盘逻辑。
     */
    if (method === 'saveImageSettings') return this.saveImageSettings(args[0]);
    if (panel === 'settings') {
      if (method === 'imageSettings') return this.imageSettingsSnapshot();
      throw new Error(`生图设置没有这个方法：${method}`);
    }
    if (panel === 'now') {
      if (method === 'snapshot') {
        if (!this.plan) await this.refreshHomeWeather(this.worldNow()).catch(() => {});
        return this.uiSnapshot();
      }
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
      /**
       * 叫她回来。
       *
       * 面板上不给「去某地」的按钮（那是替她做决定），但「回来」不一样 ——
       * 这一趟本来就是他从家里放出去的，他有权收回来。
       */
      if (method === 'returnHome') {
        const r = await this.beginReturn(this.worldNow());
        if (!r.ok) throw new Error(r.text);
        return this.uiSnapshot();
      }
      if (method === 'depart') {
        // 他按了「让她出发」。这里**不检查开关** —— 按钮只在开关打开时才出现，
        // 但真要绕过前端发这个请求也不该被静默吞掉：直接告诉他为什么不行。
        if (this.st.phase !== 'home') throw new Error('她已经在外面了');
        const now = this.worldNow();
        /*
         * **休息期里也放行。**
         *
         * 原来这里是一句 `throw new Error('她还在休息，还没到能走的日子')` ——
         * 那份 bug 报告里用户看到的就是这句话，而他的设置里「在家歇几天」已经是 0。
         * 判据盖死那一层已经修了（`restEndsAt`），但还剩第二种情形：
         * 她确实在歇，而他就是想现在让她走。手动出发本来就是「他明确要求」，
         * `depart` 早就为手动跳过 7–21 点窗口和加载宽限，没道理单独在这儿卡住。
         *
         * 出发失败（没地方可去、买不起票）就把休息期**还回去** ——
         * 不能因为她走不了，就顺手把人家剩下的假期一笔勾掉。
         */
        const wasResting = this.stillResting(now);
        const saved = { restingUntil: this.st.restingUntil, homeAt: this.st.homeAt };
        if (wasResting) {
          this.st = { ...this.st, restingUntil: null, homeAt: null };
          this.persist();
        }
        await this.depart(now, true);
        if (wasResting && this.st.phase !== 'traveling') {
          this.st = { ...this.st, ...saved };
          this.persist();
        } else if (wasResting) {
          this.log?.info('他按了「让她出发」，休息期提前结束。');
        }
        // 出发可能因为「没有可去的地方」之类失败，把最新状态交回去让面板自己判断。
        return this.uiSnapshot();
      }
      /*
       * 他答了卡片上那两个按钮。
       *
       * **只有这一个入口。** 不走工具、不走模型 —— 「让不让她走」该由他判断，
       * 让模型替他点这一下，等于把一个明确的开关变成了概率。
       */
      if (method === 'answerAsk') {
        await this.answerAsk(args[0] === true);
        return this.uiSnapshot();
      }
    }
    if (panel === 'diary') {
      /*
       * 只做两件事：列出最近的、读一天。
       *
       * 不在这里编辑 —— 日记是她写的，面板只负责让她写的那些字能被看见。
       * 用户想改就直接去那个目录改，日记本来就是 md。
       */
      if (method === 'list') {
        /*
         * **新的在前**（2026-11-17，Mr.Q 第三次提这条）。
         *
         * `recent(60)` 返回的是**升序**（`sort()` 升序取末尾 60 个，还是升序），
         * 直接 map 出去就是「从 10 月 31 日翻到 11 月 13 日」，想看今天得滚到底。
         *
         * 他上封信建议「按最新日期来」，我当时核的是**模拟鱼生**那边的面板 ——
         * 那边有 `.reverse()`，本来就对。**这一页是旅行日记，漏了那一步。**
         */
        const days = this.diary.recent(60).reverse().map((d) => ({
          dateKey: d.dateKey,
          city: d.cityName,
          weather: d.weather ?? '',
          lodging: d.lodging ?? '',
          body: d.body,
        }));
        return { days, dir: this.diary.current.dir, problem: this.diary.current.problem };
      }
      if (method === 'read') {
        const want = String((args?.[0] as string) ?? '').trim();
        const d = want ? this.diary.read(want) : null;
        return d ? {
          dateKey: d.dateKey,
          city: d.cityName,
          weather: d.weather ?? '',
          lodging: d.lodging ?? '',
          body: d.body,
        } : null;
      }
      throw new Error(`日记页不认识这个动作：${method}`);
    }
    /*
     * 路上遇见的人（2026-11-11）。只读 —— 这一页不提供任何写入口。
     *
     * 印象是她自己写的判断，用户在面板上改一句，等于替她记别人的样子；
     * 那本记忆是她的，不是一份可以编辑的通讯录。想让她改口，就跟她说。
     */
    if (panel === 'mates') {
      if (method === 'list') return { mates: this.uiSnapshot().mates };

      /*
       * 一起走过的那几趟，以及每一趟里互相留的卡（2026-11-11）。
       *
       * **只拉最近三段。** 每段一次 GET、五秒超时，翻二十段就是最坏一百秒 ——
       * 面板会一直转圈。而卡只有 30 天寿命，三段已经覆盖绝大多数「我想看看那趟」。
       * 拉不到就把空板交出去（`EMPTY_BOARD`），界面上「没人留」和「没连上」长一样。
       */
      if (method === 'parties') {
        const meet = this.meetOptions();
        const recent = this.partyLog.list().slice(0, 3);
        const parties = [];
        for (const pt of recent) {
          const board = meet ? await fetchCards(meet, pt.id) : EMPTY_BOARD;
          parties.push({
            id: pt.id,
            pets: pt.pets,
            days: pt.days,
            at: pt.at,
            city: pt.city,
            others: board.cards,
            mine: board.mine,
          });
        }
        return { parties, ready: !!meet };
      }

      /*
       * 留一张卡。
       *
       * 参数是「邀约编号、她的话、他的号」。**两样都空就不发** ——
       * 服务端也会拒，但在这里先挡住能给出更准的一句话。
       */
      if (method === 'leave') {
        const id = String(args[0] ?? '').trim();
        const note = String(args[1] ?? '').trim();
        const contact = String(args[2] ?? '').trim();
        const meet = this.meetOptions();
        if (!meet) throw new Error('还没配碰面服务器 —— 卡是留在服务器上的，本机留不了');
        if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('没说是哪一趟。');
        if (!note && !contact) throw new Error('写一句，或者留个号 —— 两样都空，那只是一张空白。');
        const ok = await putCard(meet, id, note, contact);
        if (!ok) throw new Error('没留成。多半是没连上服务器，或者这一趟已经超过 30 天。');
        return { ok: true };
      }

      /*
       * 名片（2026-11-11）。全局一张，只有**真的一起走过**的人看得见 ——
       * 服务端那边查的就是「有没有同一份邀请」，陌生人拿不到。
       *
       * 不做「请求-同意」：她没有通知通道，一个要等下次碰面才生效的同意，
       * 比不给更让人难受。理由写在 `cloud/sight-cf/schema.sql` 那张表的注释上。
       */
      if (method === 'profile') {
        const meet = this.meetOptions();
        const board = meet ? await fetchProfiles(meet) : EMPTY_PROFILE_BOARD;
        /*
         * 2026-11-13：`ready:false` 有两种来路，必须分开说。
         *
         * 原来只有 `ready` 一个布尔，面板一律显示「碰面服务器没配」。
         * 可用户明明填了 —— 只是把 `https://` 漏了。他照面板的提示去「配」，
         * 配一百遍也还是那一格字，最后只能报「填不了」。
         */
        return {
          ...board,
          ready: !!meet,
          urlIssue: this.meetUrlError,
          urlFixed: this.meetUrlFixed,
        };
      }

      /*
       * 写自己的名片。传空串就是撤回 —— 能写就该能收回去，
       * 等 30 天过期不叫删除，那叫等着它自己烂掉。
       */
      if (method === 'saveProfile') {
        const text = String(args[0] ?? '').trim();
        const meet = this.meetOptions();
        if (!meet) {
          throw new Error(this.meetUrlError
            ? `碰面服务器那一栏读不成网址：${this.meetUrlError}。去设置里改一下，改完不用重启。`
            : '还没配碰面服务器 —— 名片存在服务器上，本机写不了。填上地址（例如 https://cooppetsjourney.top）就能存。');
        }
        const r = await putProfile(meet, text);
        /*
         * **失败要说清是哪一种**（2026-11-12）。原来一律「多半是没连上服务器」——
         * 超时、400、500 三种情况一个样，用户报障只能报「存不上」，
         * 我们连去查哪一层都不知道。手书无愧那句「试了一天只成功过一两次」就是这么来的。
         */
        if (!r.ok) throw new Error(`没存上：${r.reason ?? '原因不明'}。`);
        return { ok: true, cleared: !text };
      }

      throw new Error(`这一页不认识这个动作：${method}`);
    }
    if (panel === 'album') {
      if (method === 'list') {
        const snap = this.uiSnapshot();
        // 把媒体目录一起带回去：相册页要显示它，用户才知道去哪个文件夹翻原图。
        return {
          photos: snap.photos,
          dir: snap.photoDir,
          /*
           * 额外副本目录（2026-11-09）。`photoDir` 不是「照片存哪儿」，
           * 是**再存一份**——照片主份永远跟着日记同步目录走。
           * 面板上要能改它，所以得把当前值一起带过去，不然输入框是空的。
           */
          extra: String(this.cfg.photoDir ?? '').trim(),
          error: snap.photoError,
        };
      }
      if (method === 'shoot') {
        /*
         * 配置齐不齐只问 `photoConfigProblem()` 一处。
         *
         * 这里原来自己判了一句 `!imageApi`。2026-11-04 多出一个必填项（workflow）时
         * 才发现：**同一个判据写在四个地方**（拍照 / 工具 / 灯 / 按钮），
         * 加一项就得改四处，漏一处就是「设置页说配好了，按钮说没配」。
         */
        const cfgProblem = this.photoConfigProblem();
        if (cfgProblem) throw new Error(cfgProblem);
        const shootBackend = resolveImageBackend(this.cfg);
        const api = shootBackend.api;
        /*
         * 拍哪儿、几点、在不在路上 —— 那段判定在 `photoSceneNow()` 里，
         * 工具 `journey_photo` 走的也是它。
         *
         * 这里原来有一整段自己的判定，其中一条踩过坑：**在路上补拍 = 拍窗外，
         * 不是拍出发城市**（2026-11-03 那位读者：「我人往东跑了一下午，
         * 照片还站在原地晾衣服」）。抽方法时没复制过来，就是为了不让这条
         * 只在按钮这边成立。
         */
        const scene = this.photoSceneNow();
        if (!scene.ok) throw new Error(scene.reason);
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
          scene.city, scene.hour, scene.dateKey, scene.spot,
          this.plan?.weather ?? null,
          // 他点的是「补一张」，那就换一张，不判重。
          true,
          scene.onRoad,
          scene.mode,
        );
        /*
         * 诊断信息按协议分开组织。
         *
         * 2026-11-04 之前面板那段文案写死了「接口 X，模型 Y，密钥已填/没填」——
         * 那三条是 OpenAI 那条路的形状。ComfyUI 没有「模型名」（写在 workflow 里）、
         * 通常也没有密钥，照念会让人以为漏填了两项。
         *
         * 所以这里额外给一句 `line`：**已经组织好的整句话**，前端直接显示。
         * 以后再加一条协议，前端不用跟着改。
         */
        const proto = shootBackend.protocol;
        const hasKey = Boolean(this.imageKey());
        const modelShown = shootBackend.model || '（用默认）';
        const line = proto === 'comfyui'
          ? `ComfyUI ${this.safeApi(api)}，提示词节点 ${(this.cfg.imagePromptNode ?? '').trim() || '自动'}，当地 ${scene.hour} 点`
          : `接口 ${this.safeApi(api)}，模型 ${modelShown}，密钥${hasKey ? '已填' : '没填'}，当地 ${scene.hour} 点`;
        return {
          ok: res.ok,
          reason: res.reason ?? null,
          diag: {
            protocol: proto,
            api: this.safeApi(api),
            model: modelShown,
            hasKey,
            localHour: scene.hour,
            line,
          },
        };
      }
      /*
       * 从相册里拿掉一张（2026-11-11，用户 TwoTwo：AI 生成的照片不满意）。
       *
       * 只摘记录，不删媒体文件 —— 理由见 `PhotoBook.remove`。
       * 返回最新的整份列表，前端不用自己猜哪条没了。
       */
      if (method === 'drop') {
        const handle = String(args[0] ?? '').trim();
        if (!handle) throw new Error('没说是哪一张。');
        const gone = this.photos.remove(handle);
        if (!gone) throw new Error('相册里没有这一张，可能已经删过了。');
        return { photos: this.uiSnapshot().photos, dir: this.uiSnapshot().photoDir };
      }
      /*
       * 重拍这一张（2026-11-11，同一封来信的后半句：能删，也得能重来）。
       *
       * **不覆盖旧字节。** 媒体是内容寻址的，旧 handle 可能已经被月报引用了；
       * 重拍 = 出一张新的，把记录指向它，旧的那份留在磁盘上。
       *
       * 用哪座城、哪一天：**照这条记录**，不照她现在在哪。她要是在西安了，
       * 把「大理那张」按西安重拍，出来的就是另一张照片了。
       */
      /*
       * **「右上角的 × 点了没反应」（2026-11-11，用户沃兔第三次提）。**
       *
       * 前端早就写好了：`ctx.invoke('drop', p.handle)`。
       * 后端 album 只处理 `list` 和 `regen` —— **`drop` 这个动作压根没实现**，
       * 于是走到最后那句 `未知的照片操作`。
       *
       * 1.2.4 我只把这句话翻成了人话（「扩展更新了，后台还在跑旧版本」），
       * 功能一行没加。**报错变友好了，按钮还是没用。**
       *
       * `PhotoBook.remove` 本来就是完整的（过滤 + 落盘），只是没人调它。
       */
      if (method === 'drop') {
        const handle = String(args[0] ?? '').trim();
        if (!handle) throw new Error('没说是哪一张。');
        if (!this.photos.remove(handle)) throw new Error('相册里没有这一张，可能已经删过了。');
        this.log?.info(`相册摘掉一条：${handle}`);
        return { photos: this.uiSnapshot().photos, dir: this.uiSnapshot().photoDir };
      }
      if (method === 'regen') {
        const handle = String(args[0] ?? '').trim();
        const prompt = String(args[1] ?? '').trim();
        if (!handle) throw new Error('没说是哪一张。');
        /*
         * **提示词允许为空 = 按现在的规则重新生成（2026-11-11，用户沃兔）。**
         *
         * 原来这一格强制非空，于是重拍只能沿用相册里存的那段旧提示词。
         * 而 `maybePhoto` 里是 `override?.prompt.trim() || photoPrompt(...)` ——
         * 只要传了提示词，就**整个跳过 `photoPrompt()`**。
         *
         * 后果：我改了一天提示词生成逻辑（景点名、锚点剔除），用户一点重拍，
         * 用的还是几天前存下来的那句话。「更新了、重启了、提示词一个字没变」——
         * 他报的第三次就是这个，前面两版全白改。
         *
         * 空串走 `photoPrompt()` 重新算，这才是「按现在的规则再来一张」。
         */
        const old = this.photos.list().find((p) => p.handle === handle);
        if (!old) throw new Error('相册里没有这一张，可能已经删过了。');
        const cfgProblem = this.photoConfigProblem();
        if (cfgProblem) throw new Error(cfgProblem);
        // 路上那张（cityId 是 'road'）没有城市对象，退到出发地/当前城市。
        // 标题由 override 接管、沿用旧记录，所以相册里看起来还是同一张。
        const city = this.cityOrNull(old.cityId)
          ?? this.cityOrNull(this.st.hereId)
          ?? this.cityOrNull(this.st.tripHomeId);
        if (!city) throw new Error('现在不知道她在哪，等她落地说。');
        const onRoad = old.cityId === 'road';
        const hour = Math.round(localMoment(this.worldNow(), city.tz).decimal);
        const res = await this.maybePhoto(
          city, hour, old.dateKey, old.spot, this.plan?.weather ?? null,
          // 不判重：他要的就是「这一张再来一次」。
          true, onRoad, '', 'ground', 'ground', '', '',
          { prompt, replaceHandle: handle, title: old.title },
        );
        if (!res.ok) throw new Error(res.reason ?? '没拍成');
        return { photos: this.uiSnapshot().photos, dir: this.uiSnapshot().photoDir };
      }
      throw new Error('未知的照片操作');
    }
    void args;
    throw new Error(`未知面板：${panel}`);
  },


  /** 面板那一份数据。**只搬，不算** —— 见 `ui.ts` 顶部。 */
  uiSnapshot(): UiSnapshot {
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
        ? makeSchedule(L.modeId, from, to, localMoment(new Date(L.departedAt), from.tz).dateKey, L.km, L.durationWorldHours, L.seat)
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
        /*
         * ETA 标时区 —— **只在跨时区时标**。
         *
         * 2026-11-04 读者报「12:30 到巴黎，13:15 还没下飞机」：其实没错，
         * 面板的「现在」是莫斯科时间、ETA 是巴黎时间，差两小时，两个并排就是会看错。
         * 国内飞国内同时区，加「（成都时间）」纯属噪音，所以只在真跨时区时才标。
         */
        eta: hm(localMoment(new Date(L.arriveAt), to?.tz ?? here.tz).decimal)
          + (to && to.tz !== here.tz ? `（${to.name}时间）` : ''),
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
      /*
       * 面板这格也要跟着天气走（2026-11-17）。
       *
       * 原来只有 `plan?.weather` —— 回家的那几天 plan 是 null，面板上「天气」整格空着。
       * 而用户判断「天气坏了没有」看的正是这一格：她说话不提，面板也空，
       * 两个信号叠在一起，结论当然是「兜底根本没做」。
       */
      weather: (() => {
        if (this.plan) return weatherLine(this.plan.weather);
        const m = localMoment(now, here.tz);
        return this.homeWeather?.dateKey === m.dateKey
          ? weatherLine(this.homeWeather.w)
          : '';
      })(),
      leg,
      // 别人叫的车：只在面板来问的这一刻读盘，过期自己消失（见 `readLive`）。
      ride: this.cfg.bridgeLive ? this.readLive() : null,
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
      /** 出发地认不出来时的一句话。用户看不到日志，得放在界面上。 */
      homeProblem: this.homeProblem,
      diary: {
        /** 填了同步目录没有。填了就在面板底部把路径显出来 —— 用户得能确认「设置生效了」。 */
        shared: this.cfg.memoryDir.trim() !== '',
        dir: this.diary.current.dir,
        days: this.diary.count(),
        problem: this.diary.current.problem,
      },
      /** 正在往回走。面板据此把按钮换成「正在回来」，不让连点。 */
      returning: this.st.returning,
      work: this.st.work
        ? {
          city: this.cityName(this.st.work.cityId),
          gig: this.st.work.gig,
          pay: this.st.work.pay,
          daysLeft: Math.max(0, Math.ceil((Date.parse(this.st.work.until) - now.getTime()) / 86_400_000)),
        }
        : null,
      /*
       * 同城有谁 + 手上的约定。**没配服务器也没约人时整条是 null** —— 面板不多出一行空壳。
       *
       * 只报事实，不做引导：这座城还有几个、有没有人在找伴、她跟谁约好了还剩几天。
       * 用户看到「同城 2 人」才会有下一步动作（去问她、去填地址），
       * 光在简介里写「可以找伴」是没人会看到的。
       */
      social: (() => {
        const p = this.activePledge(now);
        const configured = String(this.cfg.meetUrl ?? '').trim() !== '';
        const nearby = this.plan?.neighbors.length ?? 0;
        const invites = this.plan?.invites.length ?? 0;
        // 「池子今天多少只」：取样值优先（20 分钟内新鲜），排表那次的值兜底。
        // 两个来源都可能是 0（没配服务器 / 真没人 / 接口没回），面板那边只在 > 0 时显示。
        const pool = this.poolProbe?.value || this.plan?.pool || 0;
        if (!configured && !p) return null;
        const online = this.lastMeetOk !== false;
        if (!p) return { online, nearby, invites, pool, pledge: null };
        const city = this.cityName(p.cityId);
        if (!p.arrivedAt) {
          // 还没到：天数就是他答应人家的天数，不能算「还剩」。
          return { online, nearby, invites, pool, pledge: { withPet: this.whoOfPledge(p), city, days: p.days, daysLeft: p.days, here: false } };
        }
        const ms = now.getTime() - Date.parse(p.arrivedAt);
        const left = Math.max(0, Math.ceil((p.days * 86_400_000 - ms) / 86_400_000));
        return {
          online,
          nearby,
          invites,
          pool,
          pledge: { withPet: this.whoOfPledge(p), city, days: p.days, daysLeft: left, here: this.st.hereId === p.cityId },
        };
      })(),
      /*
       * 一起走过的人（2026-11-11）。
       *
       * 这一页之前**完全不存在**：记忆在 `travel-memory.json` 里躺着，
       * 用户想知道「她到底记不记得跟我走过的那只鱼」，只能开口问她 ——
       * 而她的回答取决于上下文里有没有那段记忆，不取决于文件里有没有。
       *
       * 按 `last` 倒序：这一页最常被用来找「上次跟我走的那是谁」，
       * 熟络度作为一列显示出来就够了，不该拿它排序把老朋友压到后面。
       */
      mates: Object.entries(this.st.pets ?? {})
        .map(([name, m]) => ({
          name,
          times: Math.max(0, Math.floor(Number(m?.times) || 0)),
          last: String(m?.last ?? ''),
          impression: String(m?.impression ?? ''),
          warmth: Math.max(0, Math.min(100, Math.floor(Number(m?.warmth) || 0))),
        }))
        // 只记过名字、一次都没走过的不算「路上遇见的人」——那是历史脏数据。
        .filter((m) => m.times >= 1)
        .sort((a, b) => (b.last || '').localeCompare(a.last || '') || b.times - a.times)
        .slice(0, 60),
      photos: this.photos.list().slice(0, 60).map((p) => ({
        handle: p.handle, title: p.title, city: p.cityName, dateKey: p.dateKey,
        // 句柄形如 `log:ab12.jpg`，去掉前缀就是媒体库里的真实文件名。
        file: p.handle.replace(/^[a-z]+:/i, ''),
        /*
         * 生成这张用的提示词（2026-11-11）。给空串而不是省略，前端少一个分支：
         * 空串 = 这张拍得早、没留提示词，「重新生成」置灰。
         */
        prompt: p.prompt ?? '',
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
      ask: (() => {
        const a = this.st.ask;
        if (!a) return null;
        const city = this.cityName(a.cityId);
        /*
         * 赴约和「想出门」不是一件事，面板上也得分开说（2026-11-12）。
         *
         * 判据现算，不往 `Ask` 里加字段：卡上要批的是「去不去」，而「她手上有没有
         * 一份约」是当下的事实 —— `activePledge` 就是它的唯一口径，存一份就会漂。
         * 顺带一说，这条不加的话，面板写「想出门了，去拉萨」而事件写「她要赴约」，
         * 同一次点头被说成两件事。
         */
        const pledged = this.activePledge(this.worldNow());
        const line = a.kind === 'accept'
          ? `${a.withPet ?? '有人'}想一起去${city}，待 ${a.days ?? 2} 天`
            + `${a.note ? `——「${a.note}」` : ''}。去不去？`
          : pledged && a.cityId === this.pledgeStop(pledged)
            ? `跟${this.whoOfPledge(pledged)}约好了去${city}。动身？`
            : `想出门了，去${city}。让我走吗？`;
        return {
          kind: a.kind,
          city,
          days: a.days,
          withPet: a.withPet,
          note: a.note,
          line,
        };
      })(),
      /*
       * 休息期里**不再置灰**。
       *
       * 那份 bug 报告的根因（判据盖死）已经修掉，但还有第二种情形：她确实在歇，
       * 而他就是想现在让她走。手动出发本来就是「他明确要求」——
       * `depart` 早已为手动跳过 7–21 点的窗口和加载宽限，没道理单独在休息期这儿卡住。
       * 现在点了就走，事件里说清这是提前收假（见 `panelInvoke` 的 depart 分支）。
       */
      canDepart: this.st.phase === 'home',
      restUntil: this.st.phase === 'home' && this.stillResting(now) ? this.restDayLabel() : null,
      wishes: this.st.wishes.map((id) => this.cityName(id)),
      home: home.name,
      // 这一趟出发时的家；还没出发就是现在的家。
      tripHome: this.cityName(this.st.tripHomeId ?? this.st.homeId),
      homeChanged: !!this.st.tripHomeId && this.st.tripHomeId !== this.st.homeId,
      speed: this.speedNow(),
      clockDriftMs: this.clockDriftMs(),
      /* 在城里挪动的那一段。不在路上就是 null —— 见 `onWayNow`。 */
      onWay: this.onWayNow(),
      weatherOutOfRange: this.weather.outOfRange,
      guideSeen: this.uiStore.guideSeen,
      version: PKG_VERSION,
      /* 面板 Footer 用的两个数（2026-11-08）：最新版，以及「确实有新版」这个判断。 */
      latestVersion: this.versionCheck.state().latest,
      versionOutdated: this.versionCheck.state().outdated,
      feedbackEmail: this.cfg.feedbackEmail.trim(),
    };
  },


  /**
   * 「接下来会发生什么」。
   *
   * 这是这个面板**最值钱的一条**，也是和同类扩展最大的区别：
   * 它们告诉你「能不能用」，这里告诉你**她下一件事大概什么时候来**。
   *
   * 数据全部来自已有的作息表和行程，这里只排序、起名、截断。
   * 在路上的时候，第一项永远是「到站」—— 那一刻比任何作息节点都重要。
   */
  uiTimeline(localNow: number, mode: UiSnapshot['mode']): UiTimelineItem[] {
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
  },
};
