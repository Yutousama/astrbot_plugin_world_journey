/**
 * 大肥鱼环游世界 —— 旅途拍照、生图网关、月报与年报子系统。
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
import { spotKindLine, spotProfile } from './geo/spot-profile.ts';
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

export const photoMethods: Record<string, any> = {
  /* ---------------- 跟着日记一起同步 ---------------- */

  /**
   * 把照片 / 报告多存一份到日记目录，让云盘把它们一起带走。
   *
   * ## 为什么要单独复制
   *
   * 三样东西原来存在三个地方：
   *
   * - 日记正文 → `memoryDir`（用户可能指到 OneDrive / 坚果云）
   * - 照片 → 宿主媒体库 `<dataDir>/media/`（字节由宿主落盘，扩展只负责交过去）
   * - 月报 / 年报 → `<dataDir>/reports/`
   *
   * 于是设了云盘的用户**只有文本同步过去了**，图片和报告留在生成它们的那台机器上。
   * 另一台电脑打开日记：有字没图 —— 2026-11-06 Mr.Q 就是这么发现的
   * （「一条鱼的图片在上面，另一条却没有」）。
   *
   * ## 两个子目录的名字不是随便起的
   *
   * 报告里的图片写的是 `../media/<文件名>`（`monthly.ts` 的默认前缀）。所以照片
   * 必须落在**日记目录下的 `media/`**、报告落在 `reports/`，那个相对路径才解得开 ——
   * 云盘上双击报告，图是好的。放在 `photos/` 之类的名字里，报告就是一片裂图。
   *
   * 文件名也得跟宿主那边一致（`log:` 前缀去掉就是媒体库文件名），否则同样对不上。
   */
  /**
   * 报告用的照片列表：逐张算好 `src`（2026-11-15）。
   *
   * ## 为什么需要这个
   *
   * 报告搬进日记目录之后，引用的图默认走 `../media/<文件名>` —— 那是她自己的
   * 照片副本，宿主清媒体库碰不到。但**历史照片未必有副本**：副本是 2026-11-12
   * 修了 `archiveToJournal` 那条守卫之后才稳定写的，更早的照片只有宿主媒体库那份。
   * 而宿主没有「读附件字节」的口子（`WorldContext` 只有 secret / persist / restart），
   * 补不回来。
   *
   * 三档处理，不让它静默裂：
   *   - 日记 media 有 → 留空，走相对路径（能跟着同步盘上另一台机器）
   *   - 日记没有、宿主有 → 给 `file:///` 绝对路径（本机照常看，换机器看不到）
   *   - 两边都没有 → 留空，把标题收进 `missing`，调用方打 warn
   */
  reportPhotos(prefixKey: string): { photos: Record<string, unknown>[]; missing: string[] } {
    const journalMedia = join(this.diary.current.dir, 'media');
    const hostMedia = join(this.opts.dataDir, 'media');
    const missing: string[] = [];
    const photos = this.photos.list()
      .filter((p) => p.dateKey.startsWith(prefixKey))
      .map((p) => {
        const base = {
          dateKey: p.dateKey,
          cityName: p.cityName,
          title: p.title,
          handle: p.handle,
          // 封面上的大字要「中查沟」，不是「九寨沟」；路上那张要靠 cityId 认出来。
          spot: p.spot,
          cityId: p.cityId,
        };
        const name = String(p.handle ?? '').replace(/^log:/, '');
        if (!name || existsSync(join(journalMedia, name))) return base;
        const fromHost = join(hostMedia, name);
        if (existsSync(fromHost)) return { ...base, src: pathToFileURL(fromHost).href };
        missing.push(p.title || name);
        return base;
      });
    return { photos, missing };
  },


  archiveToJournal(sub: 'media' | 'reports', name: string, body: Uint8Array | string): void {
    /*
     * ## 额外副本先做，而且**不依赖 memoryDir**（2026-11-12，用户实报）
     *
     * 原来这段写在函数最底部，而函数第一行是：
     *
     * ```ts
     * if (!String(this.cfg.memoryDir ?? '').trim()) return;
     * ```
     *
     * **没设「日记目录」的人，一进门就被请走了** —— 下面那段永远跑不到。
     * 于是「照片额外存一份到」对这类用户完全无效：
     * 照片照进宿主媒体库（`<dataDir>/media/`，另一条路），他填的目录一个文件都不多。
     *
     * 来信那位用户排查得很干净：「主位置正常增加（340→389），填的那栏一个文件都不多；
     * 不是没重启——重启过两次；不是中文路径——换成纯英文也一样；
     * config.json 里 photoDir 确实是新值，重启后读出来也是新值，**是拷贝那一步没跑**」。
     * 他指对了位置，只是没看到门口那道早退。
     *
     * `photoDir` 和 `memoryDir` 是两件独立的事：一个是"我想自己备份一份"，
     * 一个是"日记同步到哪儿"。**前者不该被后者没配这件事拦住。**
     */
    const extra = String(this.cfg.photoDir ?? '').trim();
    if (sub === 'media' && extra) {
      try {
        const dst = join(resolve(extra), name);
        if (!existsSync(dst)) {
          mkdirSync(dirname(dst), { recursive: true });
          if (typeof body === 'string') writeFileSync(dst, body, 'utf8');
          else writeFileSync(dst, body);
        }
      } catch (e) {
        this.log?.warn(`没能把照片额外存到 ${extra}：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    /*
     * **不再按「有没有配日记目录」提前返回**（2026-11-15）。
     *
     * 原来这里是 `if (!cfg.memoryDir) return;` —— 而 `diary.current.dir` 在
     * 没配同步盘时是 `<dataDir>/diary`（`diary.ts:156` 的 `this.local`），
     * 是个完全可写的目录。也就是说：**没配同步盘的人，照片一份副本都没有**，
     * 只有宿主媒体库那份 —— 而媒体库是可以被一键清空的。
     *
     * 现在报告也搬进日记目录了（见 `writeMonthlyReport`），报告靠的正是这份
     * 副本；守卫留着，对那批用户就是「月报里的图全是破图」。
     */
    try {
      const dir = join(this.diary.current.dir, sub);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      /*
       * 照片是内容寻址命名（哈希），同名就是同一张 —— 重写没有意义，还会在云盘上
       * 制造一次假的改动（OneDrive 会为它排一次上传）。
       * 报告不一样：同一个月的月报会被重写（补照片、改排版），必须覆盖。
       */
      if (sub === 'media' && existsSync(file)) return;
      if (typeof body === 'string') writeFileSync(file, body, 'utf8');
      else writeFileSync(file, body);

      /* 额外副本已在函数开头做过（2026-11-12 移到最前面，见那段注释）。 */
    } catch (e) {
      // 云盘目录可能暂时不可写（同步盘正在挪文件）。这不该影响她拍照本身。
      this.log?.warn(`没能把${sub === 'media' ? '照片' : '报告'}存到日记目录：${e instanceof Error ? e.message : String(e)}`);
    }
  },


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
   *    选了 ComfyUI 却没粘 workflow 也算「没配好」—— 见 `photoConfigProblem`。
   * 2. 同一天同一个城市不重复拍 —— 高倍速下一分钟能过完一天，不去重会连拍十张。
   * 3. 只在当地天亮着的时候拍。半夜出去拍一张「漆黑的街」没有意义。
   *
   * 失败一律静默：接口挂了、超时了、额度没了，旅行一步都不停，
   * 也不该把报错糊到用户脸上 —— 只写一行日志。
   */
  /**
   * 生图配置齐不齐。齐了返回 null，不齐返回一句人话。
   *
   * 2026-11-04 加 ComfyUI 时抽出来的。原来只有一句 `!imageApi` 的判断散在四处
   * （拍照、工具前置、灯、面板），多一个必填项就意味着四处都要改 ——
   * 漏一处就是「界面说配好了，拍照说没配」。
   */
  photoConfigProblem(): string | null {
    /*
     * 2026-11-14 改成看**解析后**的后端，不再直接看 `imageApi`。
     *
     * 之前第一句是「`imageApi` 为空 = 还没配」。加了服务商预设之后这条会误报：
     * 用户选「豆包」、只贴一把密钥时，地址来自预设、`imageApi` 仍是空的，
     * 而面板会亮红灯说「还没配生图接口」—— 明明能拍。
     */
    const backend = resolveImageBackend(this.cfg);
    if (!backend.api) return '还没配生图接口（云端要挑一个服务商，或手填地址）';
    /*
     * `?? ''`：这三个字段是 2026-11-04 才加的。老配置文件里没有它们，
     * 万一框架没做默认值合并，`.trim()` 会在 undefined 上直接抛 ——
     * 而抛在拍照路径里的表现是「点了没反应」。
     */
    if (backend.protocol === 'comfyui' && !(this.cfg.imageWorkflow ?? '').trim()) {
      return '生图接口选的是 ComfyUI，但还没粘 workflow —— 在 ComfyUI 里用「Save (API Format)」导出，整份贴进设置';
    }
    if (backend.protocol === 'openai' && !backend.model) {
      return '云端生图还差模型名 —— 上面挑一个服务商，或手填模型 ID';
    }
    return null;
  },


  /** 诊断用：接口地址只留到 host，别把 key 或整条路径打到界面上。 */
  safeApi(raw: string): string {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}/…`;
    } catch {
      return '（不是合法 URL）';
    }
  },


  /**
   * 这个时刻她在哪一处 —— 取「已经过去的活动节点里最后一个有具体地名的」。
   *
   * 只认 `at <= hour` 的活动节点：下午两点半在伏羲庙，三点还在伏羲庙；
   * 五点已经回了酒店，这时候拍的该是酒店窗外，不是下午那处。
   */
  spotNow(hour: number): string {
    const plan = this.plan;
    if (!plan) return '';
    let spot = '';
    for (const b of plan.beats) {
      if (b.kind !== 'activity' || b.at > hour) continue;
      const s = b.spot ?? spotFromBeat(b.what);
      if (s) spot = s;
    }
    return spot;
  },


  /**
   * 此刻该拍什么。**界面那个「补一张」和聊天里那句「拍张照」共用这一段。**
   *
   * 2026-11-04 抽出来的。原来这段逻辑只写在 `webUi()` 的 `shoot` 分支里，
   * 于是她在对话里根本没有拍照的办法 —— 一位用户的反馈原话：
   * 「我跟他说让他拍张照，他说必须点拍一张才行」。
   *
   * 加工具时最初的想法是把这段复制一份过去。没这么做，因为里面有一条规则
   * 只在按钮那边生效过、而且踩过：**在路上补拍是拍窗外，不是拍出发城市**
   * （`hereId` 在 traveling 时还是出发地）。复制一份 = 以后改一处、漏一处，
   * 表现是「按钮拍的对了，她拍的还是错的」。
   */
  photoSceneNow():
    | { ok: true; city: City; hour: number; dateKey: string; spot: string; onRoad: boolean; mode: string }
    | { ok: false; reason: string } {
    const city = this.cityOrNull(this.st.hereId);
    if (!city) return { ok: false, reason: '现在不知道她在哪' };
    const onRoad = this.st.phase === 'traveling' && !!this.st.leg;
    /*
     * **路上拍哪儿，按走了多少算（2026-11-11，Mr.Q：「才从成都出发没几个小时就到沙漠地区了」）。**
     *
     * 原来这里一律用目的地：`hereId` 还是出发城市，拿它拍会拍出一张「原地没动」的照片 ——
     * 这个顾虑是对的，但修法过了头。成都 → 敦煌 1362 公里，刚出城二十分钟，
     * 照片标题就叫「敦煌一带的路上」，画面按敦煌的锚点出戈壁滩。
     * 用户看到的是：人在四川盆地，窗外已经是大漠。
     *
     * 现在按真实进度分：**过半才算到了对面那一带**，前半程还是出发地。
     * 中间那段（若尔盖、河西走廊）没有数据，两头都不完全对 —— 但比「全程都是对面」诚实。
     */
    const progress = onRoad ? progressOf(this.st.leg!, this.worldNow()) : 0;
    const target = onRoad && progress >= 0.5
      ? (this.cityOrNull(this.st.leg!.toId) ?? city)
      : city;
    // 时区跟着拍摄地走 —— 跨时区的时候，出发地和目的地的「下午」不是一个下午。
    const moment = localMoment(this.worldNow(), target.tz);
    const hour = Math.round(moment.decimal);
    let spot = onRoad ? '' : this.spotNow(moment.decimal);
    if (!onRoad && this.st.phase === 'home') {
      const lifeAct = this.readLifeActivityNow();
      if (lifeAct && (lifeAct.scene || lifeAct.label)) {
        spot = String(lifeAct.scene || lifeAct.label);
      }
    }
    return {
      ok: true,
      city: target,
      hour,
      dateKey: moment.dateKey,
      spot,
      onRoad,
      mode: onRoad ? modeById(this.st.leg!.modeId).name : '',
    };
  },


  /**
   * 拍一张。**返回为什么没拍**，不再静默。
   *
   * 2026-11-01 收到一条反馈：地址、密钥、模型都填好了，点「补一张」没反应，
   * core.log 里没有任何记录，中转站也没看到请求。查下来是这里四个 `return`
   * 全是静默的，而 `shoot` 又是 `void` 不等待 —— 用户在界面上看到的只有「什么都没发生」。
   *
   * 现在每个跳过都带 reason，手动那条还会记一行日志。
   *
   * 2026-11-04：成功时连 `title` 一起回。界面那条路只需要 `ok`，而工具回执是
   * **给模型看的一句话** —— 没有标题，她只能说「拍了张照片」，或者更糟：
   * 自己编一个画面。标题是那句话里唯一能说的事实。
   */
  async maybePhoto(
    city: City, hour: number, dateKey: string, spot: string, weather: Forecast | null,
    replace = false,
    /**
     * 这一张是在**路上**拍的。路上没有景点可写，画面换成窗外。
     *
     * 2026-11-03 一位读者来信说生图永远是城里的景点、看不到火车和乡间 ——
     * 因为拍照只挂在「出去逛」这一个节点上，路上一个节点都不拍。
     */
    onRoad = false,
    /** 路上坐的是什么（火车 / 长途汽车…）。只有 onRoad 时才有意义。 */
    mode = '',
    /**
     * 镜头朝哪。`sky` = 抬头看天。
     *
     * 2026-11-05 加：Mr.Q 要一张星空，她在九寨沟晚上八点只能拍到脚边的池子，
     * 回来难过了一晚（「那个画面只有我自己看」）。取景方向该能选，
     * 但看到什么仍由当地时刻和天气定 —— 见 `skyOf`。
     */
    view: 'ground' | 'sky' = 'ground',
    /**
     * 拍什么（2026-11-06）。
     *
     * 用户报的 bug：「无论提出什么拍摄要求（比如拍晚饭），都只会生成同一处风景」。
     * 现在题材分六档，各走各的模板；`ground` 是老行为，一个字不变。
     */
    subject: PhotoSubject = 'ground',
    /**
     * 她自己补的一句「怎么拍」（2026-11-09）。
     *
     * 接在 `subject` 后面而不是塞进前面那几个布尔位 —— 那几格已经十来个了，
     * 再插一个位置参数，下一个加功能的人必然传错一个（这坑 2026-11-06 踩过：
     * `subject` 加了签名却漏传一处，出来还是旧画面）。所以放最后，默认空。
     */
    focus = '',
    /** 她自己写的画面内容（2026-11-10）。放最后，理由同 `focus`。 */
    describe = '',
    /**
     * 面板「重新生成」用的覆盖项（2026-11-11，用户 TwoTwo：AI 生成的照片不满意）。
     *
     * **只做两件事**：换成他在相册页改过的那段提示词、原位替换掉指定的那条记录。
     * 不参与任何判断 —— 判重、时间窗、题材都是「拍新的一张」才要问的，
     * 重拍一张已有的照片，他已经替它决定过了（所以调用方传 replace=true）。
     */
    override?: { prompt: string; replaceHandle: string; title?: string },
  ): Promise<{ ok: boolean; reason?: string; title?: string; sky?: SkyView }> {
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
    /*
     * **配置问题要在发请求之前说清，而且要放在最前面。**
     *
     * 2026-11-04 加 ComfyUI 之后多了一个必填项（workflow）。如果这个校验排在
     * 时段、判重那几道闸后面，用户会先看到「她那边 3 点不在拍照时段」这种
     * 跟真正原因毫无关系的话 —— 而他真正缺的是粘一份 workflow。
     *
     * 判据：**凡是「要等 / 要花钱 / 要写盘」的分支，能力判断一律提到最前。**
     */
    const cfgProblem = this.photoConfigProblem();
    if (cfgProblem) return skip(cfgProblem);
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
    /*
     * 路上拍的那张按 `road` 这个伪城市记，每天最多一张。
     * 不这么分的话，「今天在城里逛过」会把「今天路上那张」挡掉。
     */
    const sceneId = onRoad ? 'road' : city.id;
    const lifePolicy = !replace ? this.readLifeImagePolicy() : null;
    if (!replace && lifePolicy?.policy === 'off') {
      return skip('留影策略已设为静默');
    }
    if (!replace && lifePolicy && lifePolicy.cooldownMin > 0) {
      const latestAt = this.photos.list()[0]?.at;
      const lastMs = latestAt ? Date.parse(latestAt) : NaN;
      const nowMs = this.realNow().getTime();
      if (Number.isFinite(lastMs) && nowMs - lastMs < lifePolicy.cooldownMin * 60_000) {
        return skip(`距上一张照片未满 ${lifePolicy.cooldownMin} 分钟冷却`);
      }
    }
    const allowMultiPerDay = lifePolicy?.policy === 'active' && lifePolicy.cooldownMin > 0;
    if (!replace && !allowMultiPerDay && this.photos.has(dateKey, sceneId)) {
      return skip(onRoad ? '今天在路上已经拍过' : '这一天这个城市已经拍过');
    }

    // 标题要在 try 外面算好：catch 里要用它拼日志，写在里面就出作用域了。
    // 节日/季节题材要月日。dateKey 是当地的日期，直接拆，别再算一次时区。
    const month = Number(dateKey.slice(5, 7)) || 1;
    const day = Number(dateKey.slice(8, 10)) || 1;
    /*
     * 标题要按题材走（2026-11-06 补）。
     *
     * 原来只有 `onRoad` 这一个分支：「路上」那张一律叫「XX 一带的路上」。
     * 但路上也能吃东西、也能拍街 —— 那时候她还说「路上」，等于把一碗面
     * 说成一条公路。`subject` 不是 `ground` 时交给 `photoTitle` 自己命名。
     */
    /*
     * 重拍一张已有的照片时，标题沿用原来那条 —— 那是这张照片的名字，
     * 不该因为换了提示词就改名。路上那张尤其：它当初叫「大理一带的路上」，
     * 过两天人在西安重拍，按现在的位置算会变成「西安一带的路上」，那是另一张照片。
     */
    const title = override?.title
      ?? (onRoad && subject === 'ground'
        ? `${city.name}一带的路上`
        : photoTitle(city.name, spot, hour, view, subject));
    this.shooting = true;
    try {
      /*
       * 重新生成时用他改过的那一段，一个字都不重排 —— 他要的就是"按我改的拍"。
       * 老照片没留提示词的话，前端那边按钮是禁用的，走不到这里。
       */
      /*
       * **这张里出不出现她，按概率定**（2026-11-17，读者要「一张风景一张自拍」）。
       *
       * 播种用 `dateKey + 场景`，不是 `Math.random()`：同一张重拍必须给出同样的结果，
       * 否则用户会看到「刚才那张有她，再拍一次没了」—— 那不像照片，像抽卡。
       *
       * `imageCastChance` 默认 1，所以没填这个配置的人行为完全不变（每张都有）。
       */
      const castOn = !!this.cfg.imageCast
        && seededRandom(`${dateKey}:${sceneId}:cast`)() <= this.cfg.imageCastChance;
      /*
       * 有人那几张可以用另一套风格（`imageStyleCast`）。留空就还是 `imageStyle`。
       * 这样「风景写实 + 自拍二次元」才成立 —— 风格和有没有人本来就是两件事。
       */
      const shootStyle = castOn && this.cfg.imageStyleCast ? this.cfg.imageStyleCast : this.cfg.imageStyle;
      const prompt = override?.prompt.trim() || photoPrompt({
        city: city.name,
        // 视觉锚点按 id 查（名字会重，id 唯一）
        cityId: city.id,
        spot: onRoad ? undefined : spot,
        onRoad,
        mode,
        hour,
        weather: weather?.dayWeather,
        /*
         * 体感参与提示词：高原和湿热拍出来的调子不一样，那是她眼睛看到的东西。
         *
         * **路上那张不传**（2026-11-17，读者实测指出）。路上 `this.plan` 是 null，
         * `weather` 跟着是 null —— 于是 1.10.1 那个「有天气就以天气为准」的修法
         * 在路上一律走 else 分支，照样把「冷得不像话」拼成「画面能看出这一点」。
         * 而他报的那张「哈尔滨一带的路上」**正是路上自动拍的**。
         *
         * 两个理由不传，不只是为了绕开：
         * ① 路上那张的 city 是「XX 一带」，不是真城 —— 按那座城算体感本来就不准；
         * ② 没有天气数据时再拼体感，等于让模型自己编天气。
         */
        feel: onRoad ? '' : bodyFeeling(city, this.resolveHome().city),
        // 风格交给用户：接本地模型的人要能盖掉「胶片质感」这种写实指令。
        style: shootStyle,
        /*
         * 极简提示词（2026-11-11）。用户沃兔实测「只写地名和景点反而对」，
         * 这一格把这套开关接到那条路上。默认关，见 `imageMinimal` 的定义。
         */
        minimal: this.cfg.imageMinimal,
        // 留空 = 画面里没有人。填了才画人。
        cast: castOn ? this.cfg.imageCast : '',
        // 抬头还是看脚下。天空照仍受当地时刻和天气约束。
        view,
        /* 她自己写的那一句（2026-11-10）。空 = 不出现，老行为不变。 */
        describe,
        /*
         * 拍什么（2026-11-06）。用户说「拍晚饭」时，这里就不再是风景。
         * 美食的具体菜名由 `pickFood` 按城市和时段挑 —— 是当地此刻会吃的东西。
         */
        subject,
        /* 她自己补的取景（2026-11-09）。空 = 这一句根本不出现，老行为不变。 */
        focus,
        /*
         * 菜名按「城市 + 日期 + 餐次」抽签，和作息表里写的**同一套**算出来 ——
         * 不然照片上是担担面、正文写的是钟水饺，两个人对不上。
         */
        dish: subject === 'food'
          ? pickFood(city, hour < 10 ? 0 : hour < 15 ? 1 : 2,
              localMoment(this.worldNow(), city.tz).dateKey, this.tasteForPlan())
          : undefined,
        /*
         * 她这一刻在做什么（2026-11-08 Mr.Q：「把鱼看到的说到的直接写入图片提示词」）。
         *
         * 取日程里**已经过掉的那一格**，不是她现编的一句 ——
         * 照片对不对得上，靠的就是「文字说的」和「画面画的」是同一件事。
         */
        doing: this.photoDoingNow(city, hour),
        cityIdx: city.priceIdx,
        month,
        day,
      });
      /*
       * 分派只有这一处，是因为入口只有这一处。
       *
       * 2026-11-04 加 ComfyUI 时本来想在 `shootPhoto` 里加分支，那样调用方不用改 ——
       * 但两条链路的「失败」不是一回事（一个是 HTTP 状态码，一个是 workflow 被拒 /
       * 排队超时 / 节点报红），混在一个函数里会让错误文案互相污染。
       * 分成两个函数、在这里按协议选，每条路的失败原因都能说得准。
       */
      /*
       * 夜拍要多给两样东西（2026-11-10）。
       *
       * Mr.Q 连问两轮：「晚上拍的跟白天一样」「天空为啥还有鱼肚白啊，
       * 一般来说乡村灯光没有这么亮吧」。查下来**光靠正向压不住**：
       * cfg 2.5 时模型对「天上没有星」「地平线不发白」只是"知道了"，
       * 照样画三颗星、照样给田铺一层暖光。
       *
       * 实测：加负向能压掉地平线那道白，星星还要 cfg 提到 3.3 才干净。
       * 所以夜里两样一起上；白天一个字不动 —— 那套参数是调过的。
       *
       * 判据和提示词用**同一个** `daylitAt`，不另算一份。
       * 两处各写一份，迟早出现「提示词说深夜、负向却按白天给」。
       */
      /*
       * **重拍（override）不判夜。**
       *
       * `hour` 来自 `worldNow()`，也就是「此刻几点」。这对「现在出去拍一张」是对的，
       * 对重拍一张几天前的照片是错的：
       *
       * - `dateKey` 用的是旧记录（照片那天的日期）✓
       * - `hour` 用的却是现在 ✗ —— 白天拍的那张，深夜点重拍会被判成夜拍
       *
       * 判成夜拍的后果不是多一句话：`nightNegative()` 会往负向里塞「天上没有星／地平线
       * 不要发白」，`cfg` 从 2.5 提到 3.3。用户明明在提示词里写着「雨后的湖边小路」，
       * 系统却按他现在几点在改写这张照片的光线，两下互斥。
       *
       * 而且重拍是他自己写的完整提示词（`override.prompt`），场景自带光线；
       * 这一层再按钟点加补丁，等于不信他写的东西。
       *
       * 2026-11-11 加：上面那条注释「判据和提示词用同一个 daylitAt」在 override 路径下
       * 已经不成立了 —— 提示词被整个换掉，只剩负向还在按 hour 走，正是那种两处不同步。
       */
      const nightShot = shotIsNight({
        repaint: !!override,
        lat: city.lat ?? 0,
        month: Number(dateKey.slice(5, 7)) || 1,
        hour,
        /*
         * **经度和时区要一起传（2026-11-12 实图之后）。**
         *
         * 只给纬度的话，`shotIsNight` 退回「钟点 = 太阳时」。喀什的钟点比太阳时快近三小时，
         * 于是北京时间十九点（太阳还有八度、提示词写着低角度光）被判成夜拍 ——
         * 负向塞进「stars / bright horizon」、cfg 提到 3.3，一路在跟提示词对打。
         *
         * 提示词用什么判的光，负向就得用同一个判据。这是那次「两处各写一份」的同一个病。
         */
        ...(city.lon !== undefined ? { lon: city.lon } : {}),
        ...(city.tz ? { tz: city.tz } : {}),
      });

      /*
       * 后端在这里解析一次（2026-11-14）。
       *
       * 规则：`imageProtocol` 决定云端还是本地；云端再按 `imagePreset` 补地址/模型/尺寸，
       * **手填的值优先**。尺寸还会按模型的最低像素抬一次 —— 豆包那条门槛
       * （2560×1440 起）比我们的默认尺寸高一倍多，不抬就是必失败。
       *
       * `sizeNote` 只在第一次说一遍：它每次都成立，刷屏没有信息量。
       */
      const backend = resolveImageBackend(this.cfg);
      if (backend.sizeNote && !this.imageSizeNoted) {
        this.imageSizeNoted = true;
        this.log?.info(backend.sizeNote);
      }
      const shot = backend.protocol === 'comfyui'
        ? await shootComfy({
            api: backend.api,
            key: this.imageKey(),
            workflow: this.cfg.imageWorkflow ?? '',
            promptNode: this.cfg.imagePromptNode ?? '',
            prompt,
            /*
             * 负向提示词（2026-11-06 补上）。
             *
             * **这一处原来漏了** —— 0.8.2 加负向时只改到了海报那条路，
             * 主拍照（也就是用户说「补一张」走的那条）一个字都没传。
             * 用户 19:05 来信：「更新到 0.8.4 试了一下，补拍似乎负向提示词没生效」。
             * 他说得对，不是他填错了。
             */
            negative: this.cfg.comfyNegative ?? '',
            negativeNode: this.cfg.comfyNegativeNode ?? '',
            ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
            // 留空 = 用 workflow 里原来的尺寸
            size: backend.size,
            /* 只在夜里补：负向追加 + 提高 cfg。白天这两个都不传，等于老行为。 */
            /*
             * 负向按**天气**决定要不要禁星，不是按钟点：
             * 阴雨夜确实不该有星，晴夜该有 —— 她抬头看天的时候更是主角。
             */
            /*
             * 负向：夜里那套 + **「画面里不许有人」**（2026-11-12 实图之后）。
             *
             * 正向写「画面里没有人物」在这个底模上压不住：成都锦里那张街景、
             * 喀什老城那张，两版都照样画了行人。而 ENV_PROMPT 明明白白告诉她
             * 「这个工具画不出人」「来张合影就照实说镜头里没有人」——
             * 正向不管用，那句话就成了假话。
             *
             * 只在没设人物（`imageCast` 空）时追加：设了角色的人要的就是人，
             * 那时提示词里那句「画面里有一个人」是主角。
             */
            /*
             * **`people` 那条负向撤了（2026-11-12 晚，Mr.Q：「得有人，景区有人气最好」）。**
             *
             * 加它是为了压掉正向压不住的行人，代价是把景区也变成了空场：
             * 一条街、一座古城、一片海滩，一个人都没有。**那是置景，不是有人住的地方。**
             * 现在改成正向写「远处零星几个虚化的人影，看不清脸」——
             * 量、距离、清晰度三样都写死，人就不会抢主体。
             */
            ...(nightShot
              ? { negativeAppend: nightNegative(String(weather?.dayWeather ?? '')) }
              : {}),
            ...(nightShot ? { cfg: NIGHT_CFG } : {}),
          })
        : await shootPhoto({
            api: backend.api,
            key: this.imageKey(),
            model: backend.model,
            prompt,
            ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
            // 留空 = photo.ts 里的 PHOTO_SIZE（1024x1024）
            size: backend.size,
          });
      /*
       * 水印：只可能在云端那条路上出现。
       *
       * 裁的是**底边一条像素**，不是打码也不是模糊 —— 水印是服务商出图后盖上去的
       * 一层，底下本来就没有东西，裁掉不需要推测任何内容。
       * 裁失败（图不是 PNG、结构不认识）会原样返回，照样发出去。
       */
      /*
       * ## 两条用户反馈都落在这里（2026-11-12 晚）
       *
       * ① 「选项选的 crop，图片都没裁过」—— `cropBottom` 只认 PNG。
       *    服务商回 JPEG 时这行静默跳过，用户以为开关坏了。现在会记一句原因。
       * ② 「填 1664x1244，静默变成 1024x1024，白等一轮」—— 服务商不认这个尺寸时
       *    不报错，按自己的默认值出图。请求对、图也对，**只是不是他要的那张**。
       *    量一下，不一致就写日志。
       */
      const wantCrop = shouldCropWatermark(this.cfg.imageWatermark, this.cfg.imageProtocol);
      if (wantCrop && shot.mime !== 'image/png') {
        this.log?.info(
          `水印没裁：这张回来是 ${shot.mime}，裁剪只支持 PNG。`
          + '想裁干净，把服务商的输出格式改成 png；本地 ComfyUI 出的图本来就没有水印。',
        );
      }
      const wantSize = parseSize(this.cfg.imageSize);
      const gotSize = imagePixelSize(shot.bytes);
      if (wantSize && gotSize && (gotSize[0] !== wantSize[0] || gotSize[1] !== wantSize[1])) {
        this.log?.info(
          `尺寸被服务商改了：填的是 ${wantSize[0]}x${wantSize[1]}，`
          + `回来的是 ${gotSize[0]}x${gotSize[1]}。这家大概率只认自己那几档尺寸。`,
        );
      }
      const bytes = wantCrop && shot.mime === 'image/png'
        ? cropBottom(shot.bytes, WATERMARK_CROP_RATIO)
        : shot.bytes;
      // 字节交给宿主：它算哈希、落 data/media/、回一个 log: 句柄。
      const env = await this.push(
        'journey.photo',
        `photo-${dateKey}-${sceneId}`,
        /*
         * **事件正文不带人称**（2026-11-16 读者报告，附了数据）。
         *
         * 这条事件经 `external_event_frame` 投递，而核心 ORIENTATION 把那一区定义成
         * 「别人在说话」。里面写「她」，模型就会把它当第三方：收到「她拍了张照片」，
         * reasoning 里先问一句「谁拍的」，再把自己绕进去 —— 扫 1740 条 reasoning，
         * 事件轮的第三人称比例从 10 月 24 日的 0% 涨到 11-16 的 60%。
         * 说出口的话没被带偏（自称仍是「我」），但对自身经历的错认会累积。
         *
         * 无人称（不是「我」，也不是「她」）：这条通道语义上属于外部来源，
         * 「我」会和「别人在说话」打架，空主语最稳。
         */
        `拍了张照片：${title}。`,
        'debounce',
        [{
          bytes,
          mime: shot.mime,
          name: `${sceneId}-${dateKey}.png`,
          fallbackText: `（一张${title}的照片）`,
        }],
        // 同一天同一个场景再拍一张是**合法操作**（重拍、被他要求再拍），不是重放。
        { dedupe: false },
      );
      const handle = env?.blobs?.[0]?.handle;
      this.photoOutcome = handle ? 'ok' : 'fail';
      /*
       * 两种失败要分开说。「事件压根没发出去」和「发出去了但附件没落库」
       * 是两条不同的排查路径，混成一句「宿主没返回图片句柄」会让人去查错地方
       * —— 2026-11-15 那位就是被这句话带偏的，真正原因是事件被去重吞了。
       */
      if (!handle) {
        return {
          ok: false,
          reason: env ? '宿主没返回图片句柄' : '照片事件没发出去（扩展没挂上宿主）',
        };
      }
      this.photoError = null;
      // 云盘用户：再存一份到日记目录下，另一台电脑才看得到这张图。
      // **文件名必须和宿主那边一致** —— 报告里的 `<img src="../media/…">` 是按它拼的。
      this.archiveToJournal('media', handle.replace(/^log:/, ''), bytes);
      /*
       * 提示词跟着记录一起存（2026-11-11）。
       *
       * 原来它只在内存里活一次，拍完就没了 —— 用户看到一张不满意的图，
       * 没法知道"当时是按什么生成的"，也就没法改。存下来之后，相册页才能
       * 把它摊开给他改。老记录没有这一格，前端按空串处理。
       */
      const rec: PhotoRecord = {
        handle,
        cityId: sceneId,
        cityName: onRoad ? '路上' : city.name,
        dateKey,
        title,
        spot,
        // 真实时刻排序：世界时间在高倍速下会跑到未来，按它排相册会乱。
        at: this.realNow().toISOString(),
        prompt,
      };
      // 重拍已有的那张：原位替换，别让它跳到相册最前面（见 PhotoBook.update）。
      // 原位换失败（那张已经被 × 摘掉了）就退回去当新照片落库。
      if (!(override && this.photos.update(override.replaceHandle, rec))) {
        // override 是「重拍某一具体的一张」，它不该顺手清掉同城同日的其他记录。
        if (replace && !override) this.photos.replaceDay(dateKey, sceneId, handle);
        this.photos.add(rec);
      }
      return {
        ok: true,
        title,
        // 抬头那张把「天上到底有没有星」交给调用方 —— 回执要拿它说实话。
        /*
         * **纬度和时区必须一起传**（2026-11-15）。原来只传了钟点，于是
         * `skyOf` 拿纬度 0、一月去算极昼极夜 —— 而提示词那半边的光
         * 是按太阳高度算的。两套判据并存，回执就敢说「拍到了星空」。
         */
        ...(view === 'sky'
          ? {
              sky: skyOf(hour, weather?.dayWeather ?? '', city.lat, month, city.lon, city.tz,
                !onRoad && (spot ? spotProfile(spot).setting === 'urban' : true)),
            }
          : {}),
      };
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
  },


  /** 那一座城最近拍的那张照片的句柄。先按景点找，再按城市找。 */
  cityPhotoOf(name: string): string | null {
    const list = this.photos.list();
    const exactSpot = list.filter((p) => p.spot === name);
    const pool = exactSpot.length ? exactSpot
      : list.filter((p) => p.cityName === name);
    if (!pool.length) return null;
    return [...pool].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0]!.handle;
  },


  /** 句柄 → 那张照片的标题，回执里能说人话。 */
  photoTitleOf(handle: string): string | null {
    return this.photos.list().find((p) => p.handle === handle)?.title ?? null;
  },


  /**
   * 把这个月的照片和日记拼成一份网页。
   *
   * 只重排**已经发生**的东西：照片来自 `PhotoBook`、日记来自 `DiaryStore`，
   * 都是她真的攒下来的。路程不算 —— 没有按月存的行程流水，硬凑一个公里数就是编。
   */
  async writeMonthlyReport(month: string): Promise<{ text: string }> {
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    const cur = here ? localMoment(this.worldNow(), here.tz) : null;
    const raw = String(month || '').trim();
    const want = /^\d{4}-\d{2}$/.test(raw)
      ? raw
      : (cur ? cur.dateKey.slice(0, 7) : new Date().toISOString().slice(0, 7));

    const { photos, missing } = this.reportPhotos(want);
    if (missing.length) {
      this.log?.warn(
        `报告有 ${missing.length} 张照片两份都找不到（日记 media 与宿主 media），页面上会是裂图：`
        + `${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}`,
      );
    }
    const entries = this.diary.month(want)
      .map((e) => ({ dateKey: e.dateKey, cityName: e.cityName, body: e.body }));

    if (!photos.length && !entries.length) {
      return {
        text: `${want} 这个月没有照片，也没有日记 —— 拼不出月报。别编一份，`
          + '就跟他说这个月没攒下东西。',
      };
    }

    /*
     * 封面默认**不出**。
     *
     * 月报改成图片日记那一版之后，主体是她自己拍的那些照片 —— 再让模型照着描述画一遍，
     * 既多花一次接口钱，又多一层「画的和照片对不上」的风险（实测四张里两张的中文是错的）。
     * `makeCovers` 那条线留着，将来真要做「海报封面」时把 `MAKE_COVERS` 打开就有。
     */
    const covers = MAKE_COVERS
      ? await this.makeCovers(want, photos, entries)
      : { posters: [] as (MonthlyPoster & { fileName: string })[], note: '' };

    const html = monthlyReport({
      monthKey: want,
      photos,
      entries,
      nowLine: here ? `写于 ${cur?.dateKey ?? '今天'}，${here.name}` : '',
      posters: covers.posters.map((p) => ({
        dateKey: p.dateKey,
        cityName: p.cityName,
        spot: p.spot,
        line: p.line,
        // 报告在 reports/ 下，封面在 reports/posters/ 下，从报告看过去就是这一层。
        file: `posters/${want}/${p.fileName}`,
      })),
    });
    const dir = join(this.diary.current.dir, 'reports');
    const file = join(dir, `${want}.html`);
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, html, 'utf8');
      renameSync(tmp, file);
      /*
       * **报告直接落在日记目录，不再另存一份到 `<dataDir>/reports/`**（2026-11-15）。
       *
       * 同一个 HTML 里的 `../media/` 只在一个目录下是对的：
       *   - 报告在 `<dataDir>/reports/` → `../media/` 指向**宿主媒体库**，
       *     那里跟签到截图、CUA 截图混着，宿主「清空媒体」一点就全没；
       *   - 报告在日记目录 → `../media/` 指向**她自己的照片副本**，宿主碰不到。
       *
       * 原来两份都写，等于同一份报告在两个地方显示两套图，其中一套随时会裂。
       * 现在只有一份，图和报告永远在同一棵树下。日记目录本身就在同步盘里时，
       * 另一台电脑照样翻得到。
       */
    } catch (e) {
      return {
        text: `月报没写成：${e instanceof Error ? e.message : String(e)}。`
          + '跟他说一声，别假装已经写好了。',
      };
    }

    const cities = citiesOfMonth(photos, entries);
    return {
      text: `${monthTitle(want)}的月报写好了：${file}\n`
        + `这个月 ${photos.length} 张照片、${entries.length} 篇日记、${cities.length} 座城`
        + (cities.length ? `（${cities.slice(0, 4).map((c) => c.name).join('、')}）` : '')
        + '。用浏览器打开就能看 —— 图片走的是 ../media/ 相对路径，别把这份文件挪出这个目录。'
        + (covers.note ? `\n${covers.note}` : ''),
    };
  },


  /**
   * 一年的年报。
   *
   * 与月报同一条底线：只重排已有的东西。照片来自相册、日记来自日记本、
   * 城市题图来自她自己写下的「地方」—— 一样都不编。
   */
  writeYearlyReport(year: string): { text: string } {
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    const cur = here ? localMoment(this.worldNow(), here.tz) : null;
    const raw = String(year || '').trim();
    const want = /^\d{4}$/.test(raw)
      ? raw
      : (cur ? cur.dateKey.slice(0, 4) : new Date().toISOString().slice(0, 4));

    const { photos, missing } = this.reportPhotos(want);
    if (missing.length) {
      this.log?.warn(
        `报告有 ${missing.length} 张照片两份都找不到（日记 media 与宿主 media），页面上会是裂图：`
        + `${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}`,
      );
    }
    const entries = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${want}-${String(m).padStart(2, '0')}`;
      for (const e of this.diary.month(key)) {
        entries.push({ dateKey: e.dateKey, cityName: e.cityName, body: e.body });
      }
    }
    if (!photos.length && !entries.length) {
      return {
        text: `${want} 年没有照片也没有日记 —— 年报是空的。跟他说这一年还没攒下东西，别编。`,
      };
    }

    const tastes: YearlyTaste[] = (this.st.taste?.place ?? [])
      .filter((t) => (t.at || '').startsWith(want))
      .map((t) => ({ monthKey: (t.at || '').slice(0, 7), name: t.name, photo: t.photo, note: t.note }));

    const html = yearlyHtml({
      year: want,
      photos,
      entries,
      tastes,
      nowLine: here ? `写于 ${cur?.dateKey ?? '今天'}，${here.name}` : '',
    });
    const dir = join(this.diary.current.dir, 'reports');
    const file = join(dir, `${want}.html`);
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, html, 'utf8');
      renameSync(tmp, file);
      // 同上：年报与它引用的 `../media/` 必须在同一个目录树下（2026-11-15）。
    } catch (e) {
      return {
        text: `年报没写成：${e instanceof Error ? e.message : String(e)}。跟他说一声，别假装写好了。`,
      };
    }

    const months = new Set(photos.map((p) => p.dateKey.slice(0, 7))).size;
    return {
      text: `${want} 年的年报写好了：${file}\n`
        + `这一年 ${months} 个月留下东西，${photos.length} 张照片、${entries.length} 篇日记，`
        + `记下的地方 ${tastes.length} 座。用浏览器打开就能看 —— 图走的是 ../media/ 相对路径。`,
    };
  },


  /**
   * 出一个地方一张封面。
   *
   * 三件事值得记：
   *
   * 1. **失败不算事故。** 一张出不来就少一张，正文照写 —— 打印不出来不该把整份月报扣下。
   * 2. **出过的不再出。** 她会因为「再给我看一眼」被叫两遍，同一份月报重复调接口就是白花钱。
   * 3. **文生图，不是图生图。** 接口拿到的是提示词，不是那张照片 —— 所以画出来的景
   *    是「按描述画的这一处」，不是那天的实景。报告里因此叫「封面」，正文里那堆才叫照片。
   */
  async makeCovers(
    month: string,
    photos: readonly MonthlyPhoto[],
    entries: readonly MonthlyEntry[],
  ): Promise<{ posters: (MonthlyPoster & { fileName: string })[]; note: string }> {
    const picks = pickPosters(photos);
    if (!picks.length) return { posters: [], note: '' };

    const problem = this.photoConfigProblem();
    if (problem) {
      return { posters: [], note: `封面没出：${problem} —— 月报里只有真照片那部分。` };
    }

    const dir = join(this.diary.current.dir, 'reports', 'posters', month);
    const posters: (MonthlyPoster & { fileName: string })[] = [];
    let failed = 0;

    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i]!;
      const fileName = `${pick.dateKey}-${String(i + 1).padStart(2, '0')}.png`;
      const abs = join(dir, fileName);
      try {
        if (!existsSync(abs)) {
          mkdirSync(dir, { recursive: true });
          const prompt = posterPrompt({
            cityName: pick.cityName,
            spot: pick.spot,
            title: pick.title,
            dateKey: pick.dateKey,
            monthKey: month,
          });
          /*
           * 海报这一张同样走后端解析（2026-11-14），但尺寸用海报自己的 1024x1536 ——
           * 它不该被「出图尺寸」那一栏改掉。豆包那条路会把它按比例抬到合规像素，
           * 否则海报就成了唯一一张必失败的图。
           */
          const posterBackend = resolveImageBackend(this.cfg, POSTER_SIZE);
          const shot = posterBackend.protocol === 'comfyui'
            ? await shootComfy({
                api: posterBackend.api,
                key: this.imageKey(),
                workflow: this.cfg.imageWorkflow ?? '',
                promptNode: this.cfg.imagePromptNode ?? '',
                prompt,
                negative: this.cfg.comfyNegative ?? '',
                negativeNode: this.cfg.comfyNegativeNode ?? '',
                ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
                size: posterBackend.size,
              })
            : await shootPhoto({
                api: posterBackend.api,
                key: this.imageKey(),
                model: posterBackend.model,
                prompt,
                ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
                size: posterBackend.size,
              });
          const bytes = shouldCropWatermark(this.cfg.imageWatermark, this.cfg.imageProtocol)
            && shot.mime === 'image/png'
            ? cropBottom(shot.bytes, WATERMARK_CROP_RATIO)
            : shot.bytes;
          writeFileSync(abs, bytes);
        }
        // 那句话不给模型画，报告里叠在图上 —— 原话不能被画错。
        posters.push({ ...pick, fileName, line: coverLine(entries, pick.dateKey) });
      } catch (e) {
        failed++;
        this.log?.info(`封面没出来（${pick.cityName}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!posters.length) {
      return { posters: [], note: `封面一张都没出（${failed} 次都失败了）—— 正文没受影响。` };
    }
    return {
      posters,
      note: `封面 ${posters.length} 张（一个地方一张）`
        + (failed ? `，另有 ${failed} 张没出成` : '')
        + '。封面是按当天的景排的版式，画面是画的，不是那天的照片。',
    };
  },


  /**
   * 拍照时她「正在做的那件事」。
   *
   * 取当天日程里最后一条已经开始的节点 —— 上午十点半在亚龙湾，
   * 那就是「在亚龙湾坐了香蕉艇…」那一条（如果沙滩上买了项目）。
   * **只认当天的表**；跨天、以及表还没建好时返回空串，让照片退回风景照。
   */
  readLifeActivityNow(): {
    id: string;
    label: string;
    scene?: string | null;
    outfitHint?: string | null;
    props?: string | null;
    visualPrompt?: string | null;
  } | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      /*
       * 时间只从 `realNow()` 拿 —— `world*.ts` 里出现 `Date.now()` 会被
       * `test/journey.test.mjs` 那条「时钟只有一个入口」直接判红（2026-11-18 修的）。
       */
      const nowMs = this.realNow().getTime();
      const upd = Date.parse(String(raw?.updatedAt ?? ''));
      if (!Number.isFinite(upd) || Math.abs(nowMs - upd) > 30 * 60_000) return null;
      const a = raw?.activity;
      if (!a || typeof a !== 'object') return null;
      const until = Date.parse(String(a.until ?? ''));
      if (!Number.isFinite(until) || until <= nowMs) return null;
      return {
        id: String(a.id ?? ''),
        label: String(a.label ?? ''),
        scene: typeof a.scene === 'string' ? a.scene : null,
        outfitHint: typeof a.outfitHint === 'string' ? a.outfitHint : null,
        props: typeof a.props === 'string' ? a.props : null,
        visualPrompt: typeof a.visualPrompt === 'string' ? a.visualPrompt : null,
      };
    } catch {
      return null;
    }
  },

  /**
   * 读取模拟鱼生广播的留影策略与冷却（`life-public.json` 的 `imagePolicy`）。
   * 未安装或超过 30 分钟未更新时返回 null，退回旅行扩展默认策略。
   */
  readLifeImagePolicy(): { policy: 'off' | 'milestone' | 'active'; cooldownMin: number } | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.dataDir, 'life-public.json'), 'utf8'));
      const nowMs = this.realNow().getTime();
      const upd = Date.parse(String(raw?.updatedAt ?? ''));
      if (!Number.isFinite(upd) || Math.abs(nowMs - upd) > 30 * 60_000) return null;
      const p = raw?.imagePolicy;
      if (!p || typeof p !== 'object') return null;
      const policy = p.policy === 'off' || p.policy === 'milestone' || p.policy === 'active' ? p.policy : null;
      if (!policy) return null;
      const cd = Number(p.cooldownMin);
      const cooldownMin = Number.isFinite(cd) && cd >= 0 ? Math.min(1440, Math.round(cd)) : 60;
      return { policy, cooldownMin };
    } catch {
      return null;
    }
  },

  photoDoingNow(city: { id: string; tz: string }, hour: number): string {
    const plan = this.plan;
    if (!plan) {
      if (this.st.phase === 'home') {
        const lifeAct = this.readLifeActivityNow();
        if (lifeAct) {
          if (lifeAct.visualPrompt) return lifeAct.visualPrompt;
          return [
            lifeAct.scene ? `在${lifeAct.scene}` : '',
            lifeAct.label,
            lifeAct.outfitHint ? `穿着${lifeAct.outfitHint}` : '',
            lifeAct.props ? `手边有${lifeAct.props}` : '',
          ].filter(Boolean).join('，');
        }
      }
      return '';
    }
    if (plan.cityId !== city.id) return '';
    if (plan.dateKey !== localMoment(this.worldNow(), city.tz).dateKey) return '';
    const done = plan.beats.filter((b) => b.at <= hour
      && (b.kind === 'activity' || b.kind === 'beat' || b.kind === 'night' || b.kind === 'hotel'));
    const last = done[done.length - 1];
    return last ? last.what : '';
  },


  /**
   * 他在对话里要一张照片。**走的和界面那个「补一张」是同一条路。**
   *
   * 三件事必须和按钮一致，否则「她拍的」和「他点出来的」会是两种东西：
   * 拍哪儿（`photoSceneNow`）、不受时段限制、不受「一天一张」判重限制。
   * 后两条是成本闸 —— 它们管的是「她自己决定要拍」，管不到「人明确要的那一张」。
   */
  async takePhotoForUser(
    view: 'ground' | 'sky' = 'ground',
    subject: PhotoSubject = 'ground',
    /**
     * 她自己补的一句「怎么拍」（2026-11-09）。空 = 老行为，一个字不变。
     *
     * 只往下传到提示词，**不进任何判断**：不参与票价、不参与判重、不改文件命名。
     * 它是"这一张怎么取景"，不是"这一张是什么"。
     */
    focus = '',
    /**
     * 她自己写的「画面里是什么」（2026-11-10）。空 = 老行为。
     *
     * 和 `focus` 分工：describe 管看到什么，focus 管怎么拍。
     * 同样只往下游传，不进任何判断。
     */
    describe = '',
  ): Promise<{ text: string }> {
    /*
     * 没配好这件事要在发请求之前说清，别让她先说「稍等」再报错。
     *
     * 2026-11-04 起这句不再是固定的「去填地址和密钥」—— ComfyUI 那条缺的是
     * workflow，让她照着旧台词说，用户会去改一个本来就对的字段。
     * 直接把 `photoConfigProblem()` 的原因交给她转述。
     */
    const cfgProblem = this.photoConfigProblem();
    if (cfgProblem) {
      return {
        text: `拍不了：${cfgProblem}。别答应「一会儿再拍」，也别描述一张你没有的照片 —— 跟他说清缺的是什么，让他去设置里补上；相册页那个「补一张」用的是同一份配置。`,
      };
    }
    const scene = this.photoSceneNow();
    if (!scene.ok) return { text: `拍不了：${scene.reason}。让他过一会儿再问。` };

    const res = await this.maybePhoto(
      scene.city, scene.hour, scene.dateKey, scene.spot,
      this.plan?.weather ?? null,
      // true = 人明确要的那一张：时段和判重都不拦。
      true,
      scene.onRoad,
      scene.mode,
      // 抬头还是看脚下。
      view,
      /*
       * **这一格 2026-11-06 漏了。**
       *
       * 0.8.5 把题材做进了 `maybePhoto`（六个模板、六套提示词），
       * 工具签名也加了 `subject`，但这一处调用没往后传 —— `maybePhoto`
       * 用的是默认值 `'ground'`，于是「拍晚饭」出来的还是那处风景。
       *
       * 现场证据：19:47:55 `journey_photo {"subject":"food"}` → 19:48:04 出的图
       * 标题是「黄昏的宽窄巷子」。她的原话是「它没说食物，但这是她脚边的景」。
       *
       * 这和 0.8.2 的负向提示词是同一个病：**可选参数少传一处不报错。**
       * 光靠人眼看不住，见 `test/photo-wiring.test.mjs`。
       */
      subject,
      focus,
      describe,
    );

    if (res.ok) {
      /*
       * 照片已经通过 `journey.photo` 事件发出来了，所以这里**只给一句话**。
       * 多写一句「画面里有什么」她就得编 —— 她没看过那张图（`photo.ts` 只给提示词，
       * 不给她图）。标题是这条回执里唯一能说的事实。
       *
       * 2026-11-05 补：只写「别描述画面」堵不住 —— 20:03 那次照样说了「沟里的池子，
       * 树里亮着几盏灯，星星一颗都没有。我这镜头大概是钉在地上了」。提示词里那节
       * 《他要的那张，你这会儿拍不到》当时已经在生效（`/api/prompts/prefix` 验过），
       * 她还是编。
       *
       * 真正缺的不是禁令，是**一条能说出口的真话**：她不知道现在几点、也不知道这工具
       * 拍不了什么，于是只能拿身体编个理由。所以这里把「当地几点」和「能力边界」
       * 一起交给她 —— 她要的东西不在画面里时，至少有一句真的可说。
       *
       * 末尾那句是防重复：20:02:53 和 20:03:02 连着调了两次，云端按张计费。
       *
       * 2026-11-05 二次：加了 `view` 之后两条要分开写。抬头那张她是**真的拍到了天**，
       * 只是天上有没有星由时刻和天气定 —— 还照 `ground` 那套说「这个拍不到」，
       * 就是把她刚拍到的东西说成没拍到，比编更糟。
       */
      const hour = scene.hour;
      if (view === 'sky') {
        return {
          text:
            `拍好了：${res.title ?? '一张'}，当地 ${hour} 点 —— 你把镜头抬起来了，拍的是头顶那片天。` +
            (res.sky?.stars
              ? '今晚天开，有星。'
              : `这会儿天上没有星（${res.sky?.told ?? '云把天盖住了'}）—— 跟他说实话：星要等天黑透、等天晴。`) +
            '别描述画面（这张图没给过你，你手上只有标题），更别编有几颗、在哪一边。' +
            '这一张够了：同一次回答里别再调第二遍；他过会儿又开口要，那是新的一张，可以拍。',
        };
      }
      return {
        text:
          `拍好了：${res.title ?? '一张'}，当地 ${hour} 点。这是你脚边这一刻的实景 —— ` +
          `他要的人和事它拍不出来，别处也拍不到。` +
          `不在里头就换个题材再拍一张：subject="food"（吃的）/ "street"（街）/ "detail"（一样东西）/ ` +
          `"festival"（时节），看天用 view="sky"。都没有，就照实说「这会儿 ${hour} 点，那个拍不到」。` +
          `别描述画面（这张图没给过你，你手上只有标题），也别编「手举得低」「镜头钉在地上」这类理由。` +
          `这一张就够了：同一次回答里别再调第二遍；他过会儿又开口要，那是新的一张，可以拍。`,
      };
    }

    /*
     * 失败要能让她说出一句**他能动手的话**。原来的写法只有一句「没拍成：原因」，
     * 她照着念出来，用户拿到的是一串 HTTP 状态码。
     */
    const why = res.reason ?? '不知道什么原因';
    const hint = /HTTP\s*40[13]/.test(why)
      ? '多半是密钥或模型名不对，让他对一下设置里那两项'
      : /HTTP\s*\d{3}/.test(why)
        ? '那边服务出错了，把这句原样转给他'
        : /还没拍完/.test(why)
          ? '再等一下就成'
          : '让他看一眼设置里的生图配置';
    return { text: `没拍成：${why}。跟他说一声 —— ${hint}。别自己编一张照片出来。` };
  },

};
