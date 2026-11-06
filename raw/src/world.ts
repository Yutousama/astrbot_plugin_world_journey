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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, TriggerMode, BlobInput, EventEnvelope, WorldLamp,
} from 'cortico/core/types.ts';
import { JOURNEY_ID, journeyConfigGroups, type JourneyConfigSection } from './config.ts';
import { cityByName, cityById, CITIES, type City } from './geo/cities.ts';
import { distanceKm } from './geo/distance.ts';
import { modeById, type ModeId, type TravelMode, type SeatGrade } from './geo/modes.ts';
import { localMoment, humanHours, localHour, shiftDateKey, tzOffsetLabel } from './clock.ts';
import { AmapWeather, feelOf, type Forecast } from './geo/amap.ts';
import { bodyFeeling, climateOfCity } from './geo/climate.ts';
import { bearingDeg } from './geo/distance.ts';
import { readNowPlaying, songLine, cityMentioned, type NowPlaying } from './music-peer.ts';
import { rollTrouble } from './easter.ts';
import { makeSchedule, scheduleText } from './plan/timetable.ts';
import { join, dirname, resolve } from 'node:path';
import { planDay, fmtHour, pickFood, type DayPlan } from './plan/dayplan.ts';
import type { Pilgrim } from './geo/pilgrim.ts';
import { readPetVocab, actionsPrompt } from './pet-vocab.ts';
import { ActionWishes } from './action-wishes.ts';
import {
  rollLodging, rerollLodging, withHotel, lodgingLabel,
  type Lodging, type LodgingWant,
} from './plan/lodging.ts';
import { HotelDirectory } from './geo/hotels.ts';
import {
  pickDestination, pickMode, canTravel, usableModesFor, buildJourney, progressOf, remainingRealHours, citiesOf,
  beatMarks, beatKey, sentProgress, beatGapText, BEAT_GAP_DEFAULT, pickGrade,
  type Journey,
} from './plan/journey.ts';
import {
  slotOf, findNeighbors, neighborLine, reportPresence, fetchStatus,
  sendInvite, listInvites, myTakenInvites, acceptInvite, inviteLine,
  type MeetOptions,
} from './meet.ts';
import { StateStore, initialState, type TripState, type HomeReason, type Pledge, type Ask } from './state.ts';
import { DiaryStore, type DiaryEntry } from './diary.ts';
import {
  TravelMemoryStore, metPet, setPetImpression, setTaste, tasteSummary, emptyTaste,
  TASTE_KINDS, type PetsMap, type TasteKind,
} from './travel-memory.ts';
import {
  monthlyReport, monthTitle, citiesOfMonth,
  pickPosters, posterPrompt, yearlyHtml, type MonthlyPoster, type MonthlyPhoto, type MonthlyEntry,
  type YearlyTaste,
} from './monthly.ts';
import { shootPhoto, photoPrompt, photoTitle, spotFromBeat, skyOf, type SkyView, type PhotoSubject } from './photo.ts';
import { shootComfy } from './comfy.ts';
import { cropBottom, WATERMARK_CROP_RATIO } from './png-crop.ts';
import { PhotoBook } from './photo-book.ts';
import { UiStore, hm, remainText, type UiSnapshot, type UiTimelineItem, type UiLeg } from './ui.ts';

/** 加载后的待命宽限。见 `depart()` 开头。 */
const BOOT_GRACE_MS = 2 * 60_000;

/**
 * 「今天池子里多少只」的取样间隔（**真实**毫秒，不是世界时间）。
 *
 * 这个数字是全局的、跟她在哪座城市无关，所以花一次请求就能拿到。
 * 但它原本只在她**停留**某座城时才顺带拉到（`rebuildPlan` 里跟邻居一起取），
 * 于是在家、在路上的时候，面板上那行「池子今天一共 N 只」就整条消失 ——
 * 用户分不清是「没人」还是「这条线断了」。
 *
 * 20 分钟：够新鲜（这个数字一天才变一次量级），也不至于每分钟都打一次接口。
 * 用真实时间算，不跟世界时钟走 —— 倍速是她那边的节奏，不该让网络请求跟着变密。
 */
/**
 * 多久问一次「池子多大、谁在找伴」（真实毫秒）。
 *
 * ## 60 分钟是算过账的
 *
 * 这两样原来各占一个请求：池子 20 分钟一次、邀约 30 分钟一次 ——
 * **一只鱼一天 120 次请求**。Cloudflare 免费额度是 10 万/天，等于 800 只鱼就到顶。
 *
 * 现在服务端 `/sight/status` 一次回两样，客户端 60 分钟问一次：一天 24 次，
 * 同样额度能撑到 4000 只。代价只是「池子数字最多旧一小时」——
 * 那个数字本来也不是实时行情，而邀约 24 小时才过期。
 */
const STATUS_PROBE_MS = 60 * 60_000;

/**
 * 一天最多为邀约推几条事件。
 *
 * **推事件是要花钱的**：一条事件进对话，她会开口说一句，那就是一次模型调用。
 * 所以不能「有新的就推」。2 条/天是给「真有人在找你」留的余量，再多就成了打扰
 * —— 用户 2026-11-06 明确说过怕额度不够。
 */
const INVITE_NOTICE_PER_DAY = 2;

/** 坐过站的概率。一趟最多掷一次骰子。 */
const MISS_STOP_CHANCE = 0.035;
/** 坐过站之后要多花多少分钟（下车、发现、等返程）。 */
const MISS_STOP_EXTRA_MIN = 38;
const MISS_STOP_EXTRA_MAX = 72;

/**
 * 接下一份邀约之后，多久之内得挪到那座城。
 *
 * 邀约本身 24 小时就过期，但**赶路要时间** —— 兰州到拉萨坐火车要一天多，
 * 拿 24 小时卡她，等于「接了却因为路远而必然作废」。
 * 三天：一段最长的陆路加一次夜间停靠。再久就不是「去赴约」了。
 */
const PLEDGE_TRAVEL_WINDOW_MS = 3 * 86_400_000;

/**
 * 她问出口的那件事，等多久算没人答。
 *
 * 20 小时：比一个世界日短一点，这样「早上问、晚上还没回」就会自己作废，
 * 不会跨夜挂在那儿。作废按「被回绝」处理（进冷却），不是直接重问 ——
 * 否则一挂一整天，面板上那张卡片会变成一块永久占位的化石。
 */
const ASK_TTL_MS = 20 * 3_600_000;

/**
 * 被回绝之后，隔多久才再问一次。
 *
 * 一个世界日。原来是「回绝了就清空」，下一轮巡检（几十秒后）立刻再问一遍，
 * 问的还是同一座城 —— 那不是征求意见，是骚扰。开了倍速之后这一天会更快过去，
 * 那是用户自己选的节奏，跟着走。
 */
const ASK_COOLDOWN_MS = 86_400_000;

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
 * （油费加过路费）、公交 300km ≈ 120 元。
 *
 * **飞机单算，不在这一行里。** 2026-11-03 Mr.Q 给的真实数字：兰州飞三亚淡季 800-900 元。
 * 原来这里写 1.5 元/公里，是拿「5000 公里 7500 元」校准的 —— 那是**全价票**，
 * 现实里没人按全价买。2057 公里算出 3085 元，是他实际花费的四倍。
 * 见 `fareOf()` 里的分段算法。
 */
const FARE_PER_KM: Record<ModeId, number> = {
  walk: 0, bike: 0, scooter: 0.1, motorcycle: 0.3,
  car: 0.8, bus: 0.4, train: 0.5, ship: 0.7,
  /** 飞机正常走 `fareOf()` 的分段公式，这里只是兜底，不会实际用到。 */
  plane: 0.4,
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
  {
    name: 'journey_return_home',
    description:
      'Turn her trip around and start home, because the person asked her to come back. She walks back stop by stop - arriving somewhere, spending a night, moving on - not a teleport; it can take days. Only call it when the person actually asks her back. Deciding to go home is otherwise hers alone, and leaving early costs her the part of the trip she has not seen.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['write'] as const,
    summary: { zh: '他说回来吧，就结束这一趟往回走。', en: 'Starts her trip back home, because the person asked.' },
  },
  /*
   * 2026-11-04 加。起因是一位用户对她说「拍张照」，她回答
   * 「必须点『拍一张』才行」—— 拍照原来只有界面按钮那一条路，她手上没有工具。
   *
   * 描述里那两句「never answer that they have to press a button」是这条需求的
   * 核心：**她得知道这件事自己能办**。工具描述是模型挑工具时读的第一手材料，
   * 只写「拍一张照片」她仍可能客气地让人去点按钮。
   */
  {
    name: 'journey_photo',
    description:
      'Take a photo right now and show it in the chat: the view from where she is. Call it whenever the person asks for a photo, or asks what it looks like where she is - never tell them to press a button in the app instead, this is the button. In a city it is the spot she is at right now; on the road it is the view out of the window. Any hour is fine: being asked is reason enough. One photo per call - if they want another, call it again. '
      + 'Set view="sky" when they ask for the sky itself - stars, the moon, sunrise, sunset, clouds. It means she tilts the camera up, nothing more: what comes out is still the real sky over her at that hour. Stars only show at night and only when it is not overcast; ask at noon and you get daylight, ask on a cloudy night and you get cloud. Never claim a sky she did not actually see.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        view: {
          type: 'string',
          enum: ['ground', 'sky'],
          description: 'ground (default) = the ground at her feet, the usual travel photo. sky = she lifts the camera: whatever is overhead right now. Use sky whenever the request is about the sky rather than the place - 星空 / 月亮 / 日出 / 晚霞 / 云.',
        },
        /*
         * 拍什么（2026-11-06）。
         *
         * 这一格是为那个 bug 加的：用户说「拍晚饭」，模型以前只能改 view（ground/sky），
         * 于是出来的还是那处风景。现在题材是一等公民。
         */
        subject: {
          type: 'string',
          enum: ['ground', 'sky', 'food', 'street', 'festival', 'detail'],
          description: 'What the photo is OF. ground (default) = the view where she is - the usual travel photo. '
            + 'food = what she is eating right now (拍吃的 / 晚饭 / 这碗面 / 早饭). '
            + 'street = the street itself, facades and shopfronts (街景 / 这条街 / 巷子 / 夜市). '
            + 'festival = the season or holiday around her (节日 / 过年 / 中秋 / 秋天 / 下雪). '
            + 'detail = one close-up object (细节 / 特写 / 车票 / 钥匙 / 茶碗 / 菜单). '
            + 'sky = same as view=sky. Pick by what they actually asked for; if they just say "拍张照", use ground.',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '现在拍一张给他看（路上就是窗外；要看天就把镜头抬起来）。', en: 'Takes a photo right now and shows it.' },
  },
  /*
   * 2026-11-05 加：邀约的两半。
   *
   * 为什么要两个工具而不是一个：**发**和**接**的时机完全不同。
   * 发是「我打算去某地，想有个伴」——主动、随时；接是「有人找我，我要不要应」——
   * 得先看见。挤成一个工具，模型会在没看见任何邀约的情况下就去「接」。
   */
  {
    name: 'journey_invite',
    description:
      'Ask whether anyone nearby wants to go somewhere together: where, how many days, and one line of what for. It goes out to the whole pool, with pets in her own city listed first - she cannot name a person, because there are no accounts or friends here. When someone takes it, she finds out and travels there too, so the two of them really do end up in the same place for those days. Use it when she actually wants company on a leg she is about to take, not as a greeting; most trips she takes alone and that is fine. At most three a day.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        to: { type: 'string', description: 'Which city she wants to go to, by name - 拉萨 / 成都 / 巴黎. Must be one of the built-in cities.' },
        days: { type: 'integer', minimum: 1, maximum: 14, description: 'How many days she means to stay there. Default 2.' },
        note: { type: 'string', description: 'One short line on what for - "想看雪山" / "找个搭子吃饭". At most 60 characters. Leave it out if there is nothing to say.' },
      },
      required: ['to'],
    },
    tags: ['write'] as const,
    summary: { zh: '问同城的谁要不要一起走一段：去哪、几天、一句话。', en: 'Asks whoever is nearby to come along to a city for a few days.' },
  },
  {
    name: 'journey_accept',
    description:
      'Invitations from other pets anywhere in the pool (her own city first). Without an id it lists them: who, where they want to go, how many days, and their line - this works at home too, and it is the only way to see one before it expires. With an id it takes that one. Accepting is a promise, not a reply - she will really travel to that city and stay as many days as the invitation asked, and her route follows it; if she is not willing to do that, do not take it. One a day. Refused while she is travelling, already heading home, working a short stint, or still resting at home; from home it is allowed and she sets off straight away. If the person has asked to approve departures first, taking one only books the request - they get a yes/no card and nothing is agreed until they say yes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id of the invitation to take. Leave it out to just look at what is there.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '看同城有谁在找伴，或者接下其中一条（接了就真去）。', en: 'Lists invitations from nearby pets, or takes one.' },
  },
  /*
   * 2026-11-05 加，来自一封用户来信（鱼酥）：
   *
   * 「我喊桌宠坐高铁从常熟去上海，桌宠刚答应但是插件转头安排它蹬自行车 80 公里」
   * 「能不能加一个让桌宠可以自己选择交通工具的功能，不是强制分配」
   *
   * 两句话其实是同一件事：**交通方式原来完全由代码掷骰子**。用户说得再明确，
   * 也进不来 —— 她手上根本没有「用什么去」这个参数。
   */
  {
    name: 'journey_go_to',
    description:
      'Set off for a named city, optionally by a stated means of transport. Use it when the person says where to go and/or how - "take the high-speed rail to Shanghai", "fly to Lhasa". With no mode it picks one itself, weighted by distance; with a mode it uses exactly that one, and if that one is impossible (too far, no airport, no rail link, no money) it says why instead of silently substituting another. Only when she is settled in a city or at home: not while travelling, not while heading home, not during a short-term job, and not once the trip has hit its length limit - it will say which of those it is. Going home has its own tool.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string', description: 'Which city, by name - 上海 / 拉萨 / 巴黎. Must be one of the built-in cities.' },
        mode: {
          type: 'string',
          description: 'How to get there, in her words or his - 高铁 / 火车 / 飞机 / 自驾 / 大巴 / 轮船 / 摩托车 / 自行车 / 步行. Leave it out to let her choose.',
        },
      },
      required: ['city'],
    },
    tags: ['write'] as const,
    summary: { zh: '他指明了去哪、怎么去，就用它；不说方式就她自己挑。', en: 'Sets off for a named city, by a stated means of transport if given.' },
  },
  /*
   * 2026-11-05 加：对伙伴的记忆。
   *
   * 需求原话：「对一起旅行的伙伴会有个印象，可以决定以后接不接对方的邀请」。
   * 所以这个工具两用：不填名字 = 看名单，填了名字 = 看她对这个人的印象。
   *
   * 次数不要她记 —— 接了就是一次，`rememberPet` 自动记。只有印象要她写：
   * 印象是判断，让她「顺手生成一句」的结果一定是套话（「是个好旅伴」），
   * 那种东西写一百条也没法拿来决定接不接。
   */
  {
    name: 'journey_pet',
    description:
      'What she remembers about the pets she has travelled with. Without a name it lists everyone she has ever walked a leg with: how many times, when last, and her one-line impression. With a name it shows that one. With a name and an impression it writes it down, replacing the old one (passing an empty impression erases it). '
      + 'Read it **before** taking an invitation - it is the only thing she knows about who is asking. The count is filled in for her automatically when a leg is agreed; the impression is hers to write, in her own words, and only after she has actually been with them. Never a generic "good travel companion".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: "The pet's name, exactly as the pool shows it - 小银鱼. Leave it out to list everybody." },
        impression: { type: 'string', description: 'One short line of what she makes of them, at most 40 characters, in her own voice. Leave it out to read instead of writing.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '看看跟谁一起走过、对这个人什么印象，也能写一句。', en: 'Her memory of the pets she has travelled with.' },
  },
  /*
   * 2026-11-05 加：月报。
   *
   * Mr.Q：「每到月末能让她写一个旅行月报嘛？用每天她拍的照片和日记重组写一篇 HTML
   * 格式的可视化报告」「月报用定时吧，按照不同月份有不同的艺术风格」。
   *
   * 定时那一半不靠这个工具 —— 是月末的作息节点里提醒她「今天月底」（见 `dayplan.ts`），
   * 工具只负责「把已发生的东西拼出来」。分开的理由：工具一旦自己判断「该写月报了」，
   * 就会在任意一天被调起来写一份半空的报告。
   */
  {
    name: 'journey_monthly',
    description:
      'Write the monthly travel report: one HTML page laid out from the photos she took and the diary entries she wrote that month, in that month\'s own colour scheme. Call it at the end of a month, once, when the month is about to turn over - or when the person asks for it. Without an argument it covers the month she is in right now. '
      + 'It only rearranges what already exists; it invents nothing. Tell the person where the file is so they can open it in a browser.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        month: { type: 'string', description: 'Which month, as YYYY-MM - 2026-11. Leave it out for the month she is in right now.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '把这个月的照片和日记拼成一份月报，存成网页。', en: 'Writes the monthly report as an HTML page.' },
  },
  /*
   * 2026-11-05 加：口味。
   *
   * Mr.Q：「那个偏好系统还可以做扩展（喜欢哪个地方、吃什么、看什么景色）」。
   *
   * 跟 `journey_pet` 是同一个思路：**记的是判断，不是事实**。所以写入口只有一个，
   * 而且写完之后要靠她自己一句话说清为什么 —— 没有理由的「喜欢」，
   * 下次照样想不起来该不该再去。
   */
  {
    name: 'journey_taste',
    description:
      'What she likes and dislikes, learned on the road. Three kinds only: place (a CITY, one per city - not every spot in it, or the list fills up with alleys), food (a dish she actually ate), scenery (snow mountains, autumn leaves, the sea - the thing a season is for). '
      + 'Called with no arguments it lists everything she has written down. Called with kind + name it writes one entry (like defaults to true; pass like:false for something she does not want again - that matters more than the likes, because otherwise it comes back around). '
      + 'Write only what she actually met: a dish she did not eat, a view she did not see, is not hers to judge. One short note saying why, in her own words. Use it when something strikes her, and read it back before choosing where to eat or what to go and see.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['place', 'food', 'scenery'], description: 'Which list. Leave everything out to just read.' },
        name: { type: 'string', description: 'For place: the CITY (「九寨沟」), never a single spot. For food/scenery: 「牦牛肉汤」/「雪山」. Short, the way she would say it.' },
        note: { type: 'string', description: 'One line of why, at most 30 characters, in her own voice. Skip it if there is nothing to say.' },
        like: { type: 'boolean', description: 'true (default) = she liked it; false = she does not want it again.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '她喜欢什么样的地方、吃食、景色，也能记一条。', en: 'Her own taste: places, food, scenery.' },
  },
  /*
   * 2026-11-05 加：年报。
   *
   * Mr.Q：「等到年末还可出个年报」。跟月报同一套路 —— 只重排已有的东西，不编。
   * 分工是：月报看细节，年报看形状（哪几个月在动、去过几座城、每座城留了哪一张）。
   */
  {
    name: 'journey_yearly',
    description:
      'Write the yearbook: one page with the twelve months side by side - where she was, how many days, and the one photo she kept for each city. '
      + 'Call it at the very end of a year, once - or when the person asks for it. Without an argument it covers the year she is in right now. '
      + 'It rearranges what already exists: the photos she took, the diary she wrote, and the cities she wrote down as places she liked. Tell the person where the file is.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year: { type: 'string', description: 'Which year, as YYYY - 2026. Leave it out for the year she is in right now.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '把这一年摊成一页：十二个月、几座城、每座城一张。', en: 'Writes the yearbook page.' },
  },
  /*
   * 2026-11-05 加：换酒店。
   *
   * Mr.Q 转来群里的反馈：用户让鱼改酒店，鱼去翻代码，「完全没找到」。
   * 确实没有 —— 原来只有「记账开着且钱紧了，日切时自动重掷」这一条路，
   * 用户开口让它换，它无路可走。
   *
   * 这个工具不看钱袋档位，两种模式（记账开 / 关）都能用。
   */
  {
    name: 'journey_lodging',
    description:
      'Where she sleeps tonight. Called with no arguments it tells you the room she is in and how it feels. '
      + 'Pass change:true to move to another place - when the person asks her to ("换个酒店"), or when the room is really not working (no hot water, noise all night, that price for this room is not worth it). '
      + 'want:"cheaper" or "nicer" when they said which way; leave it out and she decides. '
      + 'The new room is where she sleeps from tonight on, and she pays the difference - so say the new price once. '
      + 'One short line about why she moved, in her own words. "换换心情" is not a reason; a real one (太吵、热水不热、窗外是堵墙) is.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        change: {
          type: 'boolean',
          description: 'true = move out and take another room tonight. Leave it out to just look at the current one.',
        },
        want: {
          type: 'string',
          enum: ['cheaper', 'nicer', 'any'],
          description: 'Which way to move. Only fill it in when they actually said cheaper or nicer.',
        },
        reason: {
          type: 'string',
          description: 'Why she moved, one short sentence in her own voice. Not "just for a change".',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '今晚住哪儿；也能换一家。', en: "Tonight's room, and moving to another." },
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

  /**
   * 碰面的配置。**没填地址就返回 null**，整个功能不工作 —— 这是默认状态。
   *
   * 一个开关管两头：填了就既上报也被看见，不填就谁也不打扰谁。
   * 只开一半（我能看别人、别人看不见我）是占便宜，不做。
   */
  private meetOptions(): MeetOptions | null {
    /*
     * `String(… ?? '')` 不是随手加的防御。
     *
     * 2026-11-05 长跑模拟抓到的：配置对象少一个 `meetUrl` 时，`.trim()` 直接抛，
     * 而这一行在每个巡检里都会被调 —— 表现是**整趟旅行停摆**，日志里一秒一条
     * 「Cannot read properties of undefined」。而用户的 config.json 是可能缺项的
     * （老版本升级上来、手改过），缺一项不该等于扩展不能工作。
     */
    const url = String(this.cfg.meetUrl ?? '').trim();
    if (!url) return null;
    return { url, uid: this.meetUid(), pet: this.opts.botName };
  }

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
  private async reportHere(): Promise<void> {
    const meet = this.meetOptions();
    if (!meet) return;
    const c = this.cityOrNull(this.st.hereId);
    if (!c || this.st.phase !== 'staying') return;
    const m = localMoment(this.worldNow(), c.tz);
    const doing = this.plan?.beats.find((b) => b.kind === 'activity')?.what ?? '';
    const ok = await reportPresence(meet, c.id, m.dateKey, slotOf(m.hour), doing);
    if (!ok) {
      this.log?.warn('位置没报上去（碰面服务器没回 200）—— 面板上会一直是旧数据');
    }
  }

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
  private meetUid(): string {
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
  }

  /** 这一段跨不跨国。票价按这个加价，所以要和 `fareOf` 一起看。 */
  private legCrossBorder(leg: Journey): boolean {
    const a = this.cityOrNull(leg.fromId);
    const b = this.cityOrNull(leg.toId);
    if (!a || !b) return false;
    return a.country !== b.country;
  }

  private cityName(id: string): string {
    return cityById(id)?.name ?? id;
  }

  private cityOrNull(id: string): City | null {
    return cityById(id);
  }

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
  private nameOf(pet: string): string {
    const name = String(pet ?? '').trim();
    const mine = String(this.opts.botName ?? '').trim();
    if (!name || !mine || name !== mine) return name;
    return `${name}（另一位同名的鱼）`;
  }

  /** `whoOf` 的带名版：把「和自己同名的那位」标出来。见 `nameOf`。 */
  private whoOfPledge(p: { withPet: string; withPets?: readonly string[] }): string {
    return whoOf({
      withPet: this.nameOf(p.withPet),
      ...(p.withPets ? { withPets: p.withPets.map((x) => this.nameOf(x)) } : {}),
    });
  }

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
  private archiveToJournal(sub: 'media' | 'reports', name: string, body: Uint8Array | string): void {
    if (!String(this.cfg.memoryDir ?? '').trim()) return;
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

      /*
       * 额外再存一份到用户指定的目录（2026-11-06）。
       *
       * 一位用户来信：「图片媒体库是否能自己指定目录。想与日记指定到同一位置，方便保存」。
       * 其实**照片本来就归档到日记目录下的 `media/` 了**（见上面那段注释，0.7.12 做的），
       * 他大概是没找到。所以这里不是「改存放位置」，而是**再加一个副本** ——
       * 想单独放一个备份目录的人也能满足，而依赖 `../media/` 相对路径的月报不受影响。
       *
       * 已经存在就跳过：照片是内容寻址命名，同名就是同一张。
       */
      const extra = String(this.cfg.photoDir ?? '').trim();
      if (sub === 'media' && extra) {
        try {
          const dst = join(resolve(extra), name);
          if (!existsSync(dst)) {
            mkdirSync(dirname(dst), { recursive: true });
            writeFileSync(dst, body);
          }
        } catch (e) {
          this.log?.warn(`没能把照片额外存到 ${extra}：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      // 云盘目录可能暂时不可写（同步盘正在挪文件）。这不该影响她拍照本身。
      this.log?.warn(`没能把${sub === 'media' ? '照片' : '报告'}存到日记目录：${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
  private async handleInvites(
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
  }

  /* ---------------- 池子总数 ---------------- */

  /** 最近一次取到的「今天池子里多少只」。见 `probeStatus`。 */
  private poolProbe: { at: number; value: number } | null = null;

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
  private async probeStatus(now: Date): Promise<void> {
    const meet = this.meetOptions();
    if (!meet) return;
    const real = this.realNow().getTime();
    if (this.poolProbe && real - this.poolProbe.at < STATUS_PROBE_MS) return;
    const here = this.cityOrNull(this.st.hereId);
    if (!here) return;
    try {
      // 一个请求拿两样：池子总数 + 谁在找伴。见 `meet.ts` 的 `fetchStatus`。
      const r = await fetchStatus(meet, here.id);
      if (!r.ok) return;
      this.poolProbe = { at: real, value: r.pool };
      await this.handleInvites(r.invites, now);
    } catch {
      // 拿不到就算了。这不是她的事，也不该在日志里刷——下一轮再试。
    }
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
       * 池子总数：每次巡检都问一句（内部有 20 分钟缓存，绝大多数时候立刻返回）。
       *
       * 原来只在「不在城里停留」时才补 —— 因为 staying 那条路会由 `rebuildPlan` 顺带取。
       * 可那次取数是**当天第一次排表**时的事：一条鱼早上 6 点定了行程，`plan.pool` 就一直是 15，
       * 到了中午池子涨到 24 她还显示 15（2026-11-06 Mr.Q 两台机器一个 25 一个 15 就是这么来的）。
       */
      // 一个请求两样：池子总数 + 谁在找伴（60 分钟闸，绝大多数轮次立刻返回）。
      await this.probeStatus(now);

      if (this.st.phase === 'home') {
        if (this.stillResting(now)) return;
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
    const pledgedCity = pledged ? cityById(pledged.cityId) : null;
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
      ?? pickMode(from, to, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km, 0.5, from.country !== to.country, { from, to }), !this.cfg.hasLicense);
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
    const leg = buildJourney({ from, to, mode, km, at: now, speed: this.speedNow(), grade });
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

    const picked = this.pickNextLeg(from);
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

    await this.push(
      'journey.ask',
      `ask-${ask.askedAt}`,
      `她想出门，在等他点头：从${from.name}去${picked.city.name}，直线约 ${picked.km} 公里。`
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
    /*
     * 赴约的那一趟到了没有。
     *
     * `arrivedAt` 从这一刻起算「待几天」—— 接下邀约之后可能还坐了两天车，
     * 那两天不该算进「一起待的三天」。到了别的地方就把约定清掉：
     * 那是她半路改了主意，硬留着只会在 `journey_now` 里挂一句做不到的话。
     */
    const pledgeOf = this.st.pledge;
    const pledged = pledgeOf && pledgeOf.cityId === to.id ? pledgeOf : null;
    const stray = pledgeOf && !pledged ? pledgeOf : null;
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
      pledge: pledged ? { ...pledged, arrivedAt: now.toISOString() } : null,
    };
    if (stray) this.log?.info(`到了${to.name}，手上那份去${this.cityName(stray.cityId)}的约定作废。`);
    await this.rebuildPlan(now, 'arrival', moment.decimal, to);
    // 交通费在到站时结算 —— 票是出发前买的，但"花了多少"到站才成事实。
    /*
     * **必须和 `fareOf` 用同一个算式。**
     *
     * 原来是这里自己乘一遍 `FARE_PER_KM`：判断买不买得起走 `fareOf`（分段 + 跨国加价），
     * 实际扣钱走这一行（单价 × 距离）—— 两个数从改价那一天起就不一样了。
     * 表面看只是账不平，实际后果是「判她买不起、真扣的时候又没扣那么多」，
     * 预算约束整个偏掉。
     */
    // 座位档要一起算：商务座那张票是三倍价，只记最低档等于让她白花钱。
    const fare = this.fareOf(leg.modeId, leg.km, this.legCrossBorder(leg), leg.seatMult ?? 1);
    this.addSpent(fare);
    // 到了 = 那个念头兑现了，从「想去」里划掉。
    if (this.st.wishes.includes(to.id)) {
      this.st = { ...this.st, wishes: this.st.wishes.filter((x) => x !== to.id) };
    }
    this.persist();

    /*
     * 到站那一刻就把「这一带还有谁」说出来，不等第二天早上那句 `journey.day`。
     *
     * 2026-11-05 Mr.Q：「新功能从哪看？我找不到啊」。原来同城信息只在排当天表的正文里带一句，
     * 而到站这一条才是用户**真的会读**的那一条 —— 落地、放下包、看一眼四周。
     * 上面几行的 `rebuildPlan` 已经跑过了，邻居和同城邀约都在 `this.plan` 里，不用额外请求。
     */
    const social = [
      neighborLine(this.plan?.neighbors ?? []),
      inviteLine(this.plan?.invites ?? []),
    ].filter(Boolean).join('\n');

    await this.push(
      'journey.arrive',
      `arrive-${leg.id}`,
      `到了。${to.name}，当地 ${fmtHour(moment.decimal)}。`
      + `这一趟 ${leg.km} 公里走了 ${humanHours(leg.durationWorldHours)}。`
      + `${beenBefore ? '这地方她以前来过，' : ''}${bodyFeeling(to, this.resolveHome().city)}`
      // 赴约到了：这一趟不是随便来的，得说出来是冲着谁来的。
      + (pledged ? `\n这是跟${this.whoOfPledge(pledged)}说好一起来的地方，` + `在这儿待 ${pledged.days} 天。` : '')
      + `\n今晚住：${this.plan ? lodgingLabel(this.plan.lodging) : '还没定'}。`
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
    if (moment.decimal >= 8 && this.st.decidedOn !== moment.dateKey) {
      this.st = { ...this.st, decidedOn: moment.dateKey };
      this.persist();
      const startedDaysAgo = this.st.tripStartedAt
        ? (now.getTime() - Date.parse(this.st.tripStartedAt)) / 86_400_000
        : 0;
      // 按周算：一周七天，和设置项的单位对上（2026-11-04 由「月」改成「周」）。
      const overWeeks = startedDaysAgo / 7 >= this.cfg.maxTripWeeks;
      const stayDays = this.stayDaysSoFar(now);

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
       * 出门到上限了 —— 这是硬上限，压过一切约定。
       *
       * 顺序放在赴约之前：一个说好了的行程不该让她在外面待到天荒地老；
       * 而且这条一触发就是回家，和「回家路上」是同一个性质。
       */
      if (overWeeks) {
        await this.goHome(now, here, 'limit');
        return;
      }

      /*
       * 手上有一份答应了要去的约定。
       *
       * 两件事：**还没到就动身**，**到了就按天数待着**。
       * 待满之后直接走人 —— 不走 `stayedLongEnough` 那套随机：
       * 约定了三天就是三天，第三天早上收拾东西，这件事本身没有掷骰子的余地。
       */
      const pledge = this.activePledge(now);
      if (pledge) {
        if (here.id !== pledge.cityId) {
          // `moveOn` 会把目的地定成约定的那座城，这里只负责「今天该动身了」。
          await this.moveOn(now, here);
          return;
        }
        if (this.pledgeDone(now, pledge)) {
          /*
           * 天数满了：走。**约定先不清** —— 交给 `moveOn` 在真正动身那一刻结掉，
           * 出发那句话才说得出「跟谁说好的几天到了」。
           * 买不起票走不成时它还在，明天接着试。
           */
          await this.moveOn(now, here, { afterPledge: pledge });
          return;
        }
        // 天数没满：今天不走，等它满。
        return;
      }

      if (stayedLongEnough && Math.random() < GO_HOME_CHANCE) {
        await this.goHome(now, here, 'done');
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
  private markVisitDepth(city: City, now: Date): void {
    if (!city.slots.length) return;
    const days = this.stayDayIndex(now);
    const need = Math.ceil(city.slots.length / 2);
    const cur = new Set(this.st.unfinished ?? []);
    if (days >= need) cur.delete(city.id);
    else cur.add(city.id);
    this.st = { ...this.st, unfinished: [...cur] };
  }

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
  /**
   * 排当天的作息表。`shape` 由调用方给 —— 到达日、完整日、最后一天。
   *
   * `override` 只给「换酒店」用：那一晚的房由调用方指定，不掷骰子。
   * 除了住宿，其余（景点、天气、邻居、邀约）全部按原样重排 ——
   * 作息表的 seed 只跟「哪座城 + 哪天入住」有关，所以换一家店不会把白天的行程搅乱。
   */
  private async rebuildPlan(
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
    this.hotels.setKey(this.cfg.amapKey);
    /*
     * 种子按「哪座城 + 这次入住从哪天开始 + 钱紧不紧」算，不用 `Math.random` ——
     * 作息表只在内存里，重启一次就重建一次，随机源一变她就搬家。
     */
    const seed = `${c.id}|${this.st.stayStartedAt ?? 'x'}|${this.isTight() ? 'tight' : 'ok'}`;
    const base = override
      ?? this.plan?.lodging
      ?? rollLodging(seededRandom(seed), this.isTight(), c.priceIdx, this.purseRich());
    // 已经挂过真名的房型不必再查一次（同一个地方住几天就是同一家）。
    const pois = base.name ? null : await this.hotels.hotels(c);
    const lodging = withHotel(base, pois, seededRandom(`${seed}|hotel`), c.priceIdx);
    this.weather.setKey(this.cfg.amapKey);
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
        ? findNeighbors(meet, c.id, moment.dateKey, slot)
        : Promise.resolve({ list: [] as { pet: string; doing: string }[], pool: 0 }),
      meet ? listInvites(meet, c.id) : Promise.resolve({ ok: true as const, list: [] }),
    ]);
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
    this.plan = planDay({
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
      car: this.st.car ? { fuel: this.st.car.fuel } : null,
      // 手头宽才在景点买讲解/观光车（2026-11-06）。和酒店、座位同一个判据。
      comfortable: this.purseRich(),
    });

    /* 上报「我在这儿」。不 await —— 报不上去也不该拖慢她这一天。 */
    if (meet) {
      const doing = this.plan.beats.find((b) => b.kind === 'activity')?.what ?? '';
      void reportPresence(meet, c.id, moment.dateKey, slot, doing);
    }
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
  private photoConfigProblem(): string | null {
    if (!(this.cfg.imageApi ?? '').trim()) return '还没配生图接口';
    /*
     * `?? ''`：这三个字段是 2026-11-04 才加的。老配置文件里没有它们，
     * 万一框架没做默认值合并，`.trim()` 会在 undefined 上直接抛 ——
     * 而抛在拍照路径里的表现是「点了没反应」。
     */
    if (photoProtocolOf(this.cfg.imageProtocol) === 'comfyui' && !(this.cfg.imageWorkflow ?? '').trim()) {
      return '生图接口选的是 ComfyUI，但还没粘 workflow —— 在 ComfyUI 里用「Save (API Format)」导出，整份贴进设置';
    }
    return null;
  }

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
  private photoSceneNow():
    | { ok: true; city: City; hour: number; dateKey: string; spot: string; onRoad: boolean; mode: string }
    | { ok: false; reason: string } {
    const city = this.cityOrNull(this.st.hereId);
    if (!city) return { ok: false, reason: '现在不知道她在哪' };
    const onRoad = this.st.phase === 'traveling' && !!this.st.leg;
    // 路上拍目的地一带：`hereId` 这时候还是出发城市，拿它拍会拍出一张「原地没动」的照片。
    const target = onRoad ? (this.cityOrNull(this.st.leg!.toId) ?? city) : city;
    // 时区跟着拍摄地走 —— 跨时区的时候，出发地和目的地的「下午」不是一个下午。
    const moment = localMoment(this.worldNow(), target.tz);
    const hour = Math.round(moment.decimal);
    const spot = onRoad ? '' : this.spotNow(moment.decimal);
    return {
      ok: true,
      city: target,
      hour,
      dateKey: moment.dateKey,
      spot,
      onRoad,
      mode: onRoad ? modeById(this.st.leg!.modeId).name : '',
    };
  }

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
  private async maybePhoto(
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
    if (!replace && this.photos.has(dateKey, sceneId)) return skip(onRoad ? '今天在路上已经拍过' : '这一天这个城市已经拍过');

    // 标题要在 try 外面算好：catch 里要用它拼日志，写在里面就出作用域了。
    // 节日/季节题材要月日。dateKey 是当地的日期，直接拆，别再算一次时区。
    const month = Number(dateKey.slice(5, 7)) || 1;
    const day = Number(dateKey.slice(8, 10)) || 1;
    const title = onRoad ? `${city.name}一带的路上` : photoTitle(city.name, spot, hour, view);
    this.shooting = true;
    try {
      const prompt = photoPrompt({
        city: city.name,
        // 视觉锚点按 id 查（名字会重，id 唯一）
        cityId: city.id,
        spot: onRoad ? undefined : spot,
        onRoad,
        mode,
        hour,
        weather: weather?.dayWeather,
        // 体感参与提示词：高原和湿热拍出来的调子不一样，那是她眼睛看到的东西。
        feel: bodyFeeling(city, this.resolveHome().city),
        // 风格交给用户：接本地模型的人要能盖掉「胶片质感」这种写实指令。
        style: this.cfg.imageStyle,
        // 留空 = 画面里没有人。填了才画人。
        cast: this.cfg.imageCast,
        // 抬头还是看脚下。天空照仍受当地时刻和天气约束。
        view,
        /*
         * 拍什么（2026-11-06）。用户说「拍晚饭」时，这里就不再是风景。
         * 美食的具体菜名由 `pickFood` 按城市和时段挑 —— 是当地此刻会吃的东西。
         */
        subject,
        dish: subject === 'food' ? pickFood(city, hour < 10 ? 0 : hour < 15 ? 1 : 2) : undefined,
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
      const shot = photoProtocolOf(this.cfg.imageProtocol) === 'comfyui'
        ? await shootComfy({
            api: this.cfg.imageApi,
            key: this.cfg.imageKey,
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
            size: this.cfg.imageSize ?? '',
          })
        : await shootPhoto({
            api: this.cfg.imageApi,
            key: this.cfg.imageKey,
            model: this.cfg.imageModel,
            prompt,
            ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
            // 留空 = photo.ts 里的 PHOTO_SIZE（1024x1024）
            size: this.cfg.imageSize ?? '',
          });
      /*
       * 水印：只可能在云端那条路上出现。
       *
       * 裁的是**底边一条像素**，不是打码也不是模糊 —— 水印是服务商出图后盖上去的
       * 一层，底下本来就没有东西，裁掉不需要推测任何内容。
       * 裁失败（图不是 PNG、结构不认识）会原样返回，照样发出去。
       */
      const bytes = shouldCropWatermark(this.cfg.imageWatermark, this.cfg.imageProtocol)
        && shot.mime === 'image/png'
        ? cropBottom(shot.bytes, WATERMARK_CROP_RATIO)
        : shot.bytes;
      // 字节交给宿主：它算哈希、落 data/media/、回一个 log: 句柄。
      const env = await this.push(
        'journey.photo',
        `photo-${dateKey}-${sceneId}`,
        `她拍了张照片：${title}。`,
        'debounce',
        [{
          bytes,
          mime: shot.mime,
          name: `${sceneId}-${dateKey}.png`,
          fallbackText: `（一张${title}的照片）`,
        }],
      );
      const handle = env?.blobs?.[0]?.handle;
      this.photoOutcome = handle ? 'ok' : 'fail';
      if (!handle) return { ok: false, reason: '宿主没返回图片句柄' };
      this.photoError = null;
      // 云盘用户：再存一份到日记目录下，另一台电脑才看得到这张图。
      // **文件名必须和宿主那边一致** —— 报告里的 `<img src="../media/…">` 是按它拼的。
      this.archiveToJournal('media', handle.replace(/^log:/, ''), bytes);
      if (replace) this.photos.replaceDay(dateKey, sceneId, handle);
      this.photos.add({
        handle,
        cityId: sceneId,
        cityName: onRoad ? '路上' : city.name,
        dateKey,
        title,
        spot,
        // 真实时刻排序：世界时间在高倍速下会跑到未来，按它排相册会乱。
        at: this.realNow().toISOString(),
      });
      return {
        ok: true,
        title,
        // 抬头那张把「天上到底有没有星」交给调用方 —— 回执要拿它说实话。
        ...(view === 'sky' ? { sky: skyOf(hour, weather?.dayWeather ?? '') } : {}),
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
  }

  /* ---------------- 回家 / 换地方 ---------------- */

  /**
   * 让他把她叫回来。**面板按钮和聊天里的「回来吧」共用这一段。**
   *
   * 走的是正常返程：还远就一站一站往回走、路上照写日记照花钱，近了才一趟车到家。
   * 不是传送 —— 那样中间那几天就白过了，日记也没有。
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
      this.st = { ...this.st, pledge: null };
      this.log?.info('被叫回家，手上那份约定作废。');
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
      this.st = { ...this.st, pledge: null };
      this.log?.info(`开始回家，手上那份去${name}的约定作废。`);
    }

    // 够近了就一趟车到家。五百公里差不多是一段能当天到的路。
    if (km < HOME_RADIUS_KM) {
      // 到家就还车/停车：这趟结束了，车不该跟着进屋。
      if (this.st.car) this.st = { ...this.st, car: null };
      await this.settleHome(now, from, reason, km);
      return;
    }

    /*
     * **还远的时候，先问一句「买得起直达票吗」。**
     *
     * 2026-11-03 Mr.Q：「全部都走回去也太费事了，我淡季去三亚机票也就 800/900」。
     * 他说得对 —— 赶着回家的人不会沿途每座城住一晚，有直达的票就买。
     * 一站站挪是「穷得只能省路费」时的走法，不该是默认。
     *
     * 判据是票钱不超过余钱的八成；钱不够就还是走回去 —— 那不是啰嗦，是真买不起。
     */
    /*
     * **这里不自己判「买得起吗」。** 那道闸（`affordMode`）是给「中途选下一站」用的，
     * 上限是余钱的一半；而回家是一次性的事，判据按「票钱不超过余钱的八成」——
     * 两条判据打架的话，会出现「够钱回家却被拦下」。钱够不够统一由 `canAffordTrip` 说了算。
     */
    const direct = pickMode(from, home, km, Math.random, this.isTight(), this.noFly(), undefined, !this.cfg.hasLicense);
    if (direct && this.canAffordTrip(km, from.country !== home.country)) {
      await this.settleHome(now, from, reason, km);
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
  private async settleHome(now: Date, from: City, reason: HomeReason, km: number): Promise<void> {
    const home = this.resolveHome().city;
    // 回家这一趟是一次性支出，钱的上限放宽到八成（`goHome` 已经先判过一遍）。
    const mode = km < 30 ? null : pickMode(from, home, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km, 0.8, from.country !== home.country, { from, to: home }));
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
    if (!to && pledge && pledge.cityId !== from.id) {
      const dest = cityById(pledge.cityId);
      if (dest && canTravel(from, dest)) {
        to = dest;
        km = Math.round(distanceKm(from, dest));
      } else {
        /*
         * 答应了却到不了 —— 这是最该被说出来的一种失败。
         * 静默清掉，她下一步就会自己挑一个地方走，而用户记得她「说好了要去拉萨」。
         */
        this.dropPledge(now, `${dest?.name ?? pledge.cityId}从这儿去不了，跟${this.whoOfPledge(pledge)}说好的那趟只能算了。`);
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
    // 他点名了怎么去就用那个；没说就照旧掷骰子。
    const mode = opts.mode
      ?? pickMode(from, to, km, Math.random, this.isTight(), this.noFly(), this.affordMode(km, 0.5, from.country !== to.country, { from, to }));
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
      }
      return;
    }
    const grade = this.pickSeatFor(mode.id, km, this.legCrossBorder({ fromId: from.id, toId: to.id } as Journey));
    const leg = buildJourney({ from, to, mode, km, at: now, speed: this.speedNow(), grade });

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
          ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，跟${this.whoOfPledge(fulfilled)}说好的 `
            + `${fulfilled.days} 天到了，动身。去${to.name}，${mode.name}，${leg.km} 公里，`
            + `${humanHours(leg.durationWorldHours)}。`
          : pledge && to.id === pledge.cityId
            ? `${from.name}当地 ${fmtHour(localMoment(now, from.tz).decimal)}，动身去${to.name} —— `
              + `跟${this.whoOfPledge(pledge)}说好的那趟。${mode.name}，${leg.km} 公里，${humanHours(leg.durationWorldHours)}。`
              + `\n到了在那儿待 ${pledge.days} 天。`
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
  private purseRangeKm(): number {
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return Infinity;
    const left = this.cfg.budget - (this.st.spent - this.st.earned);
    if (left <= 0) return LOW_KM;
    return Math.max(200, (left * 0.5) / 0.4);
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
  private petMemory(name: string, impression: string): { text: string } {
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
  }

  /** 名单。按「上次见面」倒序 —— 最近一起玩过的人排前面。 */
  private petListText(pets: PetsMap): string {
    const list = Object.entries(pets)
      .sort((a, b) => String(b[1].last || '').localeCompare(String(a[1].last || '')));
    if (!list.length) {
      return '还没跟谁一起走过。等哪天接了谁的邀约，我会记一笔 —— 到那时你再写印象。';
    }
    return list.map(([n, p]) => `${n}：${p.times} 次`
      + (p.last ? `，上次 ${p.last}` : '')
      + (p.impression ? `；「${p.impression}」` : '；没写印象')).join('\n');
  }

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
  private taste(kind: string, name: string, note: string, like: boolean | undefined): { text: string } {
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
  }

  /** 今晚住哪儿。不带参数就是读。 */
  private lodgingInfo(): { text: string } {
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
  }

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
  private async changeLodging(want: string, reason: string): Promise<{ text: string }> {
    const here = this.cityOrNull(this.st.hereId);
    if (!here || this.st.phase !== 'staying' || !this.plan) {
      return {
        text: '她这会儿不在住处 —— 在路上，或者还没落脚，换不了房。跟他说等住下来再说。',
      };
    }
    const cur = this.plan.lodging;
    const w: LodgingWant = want === 'cheaper' || want === 'nicer' ? want : 'any';

    const base = rerollLodging(cur, Math.random, this.isTight(), here.priceIdx, w, this.purseRich());
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
    this.hotels.setKey(this.cfg.amapKey);
    const pois = base.name ? null : await this.hotels.hotels(here).catch(() => null);
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
  }

  /** 那一座城最近拍的那张照片的句柄。先按景点找，再按城市找。 */
  private cityPhotoOf(name: string): string | null {
    const list = this.photos.list();
    const exactSpot = list.filter((p) => p.spot === name);
    const pool = exactSpot.length ? exactSpot
      : list.filter((p) => p.cityName === name);
    if (!pool.length) return null;
    return [...pool].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0]!.handle;
  }

  /** 句柄 → 那张照片的标题，回执里能说人话。 */
  private photoTitleOf(handle: string): string | null {
    return this.photos.list().find((p) => p.handle === handle)?.title ?? null;
  }

  /**
   * 把这个月的照片和日记拼成一份网页。
   *
   * 只重排**已经发生**的东西：照片来自 `PhotoBook`、日记来自 `DiaryStore`，
   * 都是她真的攒下来的。路程不算 —— 没有按月存的行程流水，硬凑一个公里数就是编。
   */
  private async writeMonthlyReport(month: string): Promise<{ text: string }> {
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    const cur = here ? localMoment(this.worldNow(), here.tz) : null;
    const raw = String(month || '').trim();
    const want = /^\d{4}-\d{2}$/.test(raw)
      ? raw
      : (cur ? cur.dateKey.slice(0, 7) : new Date().toISOString().slice(0, 7));

    const photos = this.photos.list()
      .filter((p) => p.dateKey.startsWith(want))
      .map((p) => ({
        dateKey: p.dateKey,
        cityName: p.cityName,
        title: p.title,
        handle: p.handle,
        // 封面上的大字要「中查沟」，不是「九寨沟」；路上那张要靠 cityId 认出来。
        spot: p.spot,
        cityId: p.cityId,
      }));
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
    const dir = join(this.opts.dataDir, 'reports');
    const file = join(dir, `${want}.html`);
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, html, 'utf8');
      renameSync(tmp, file);
      // 云盘用户：报告也跟过去，另一台电脑才翻得到。
      this.archiveToJournal('reports', `${want}.html`, html);
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
  }

  /**
   * 一年的年报。
   *
   * 与月报同一条底线：只重排已有的东西。照片来自相册、日记来自日记本、
   * 城市题图来自她自己写下的「地方」—— 一样都不编。
   */
  private writeYearlyReport(year: string): { text: string } {
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    const cur = here ? localMoment(this.worldNow(), here.tz) : null;
    const raw = String(year || '').trim();
    const want = /^\d{4}$/.test(raw)
      ? raw
      : (cur ? cur.dateKey.slice(0, 4) : new Date().toISOString().slice(0, 4));

    const photos = this.photos.list()
      .filter((p) => p.dateKey.startsWith(want))
      .map((p) => ({
        dateKey: p.dateKey, cityName: p.cityName, title: p.title,
        handle: p.handle, spot: p.spot, cityId: p.cityId,
      }));
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
    const dir = join(this.opts.dataDir, 'reports');
    const file = join(dir, `${want}.html`);
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, html, 'utf8');
      renameSync(tmp, file);
      // 云盘用户：年报也跟过去。
      this.archiveToJournal('reports', `${want}.html`, html);
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
  }

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
  private async makeCovers(
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

    const dir = join(this.opts.dataDir, 'reports', 'posters', month);
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
          const shot = photoProtocolOf(this.cfg.imageProtocol) === 'comfyui'
            ? await shootComfy({
                api: this.cfg.imageApi,
                key: this.cfg.imageKey,
                workflow: this.cfg.imageWorkflow ?? '',
                promptNode: this.cfg.imagePromptNode ?? '',
                prompt,
                negative: this.cfg.comfyNegative ?? '',
                negativeNode: this.cfg.comfyNegativeNode ?? '',
                ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
                size: POSTER_SIZE,
              })
            : await shootPhoto({
                api: this.cfg.imageApi,
                key: this.cfg.imageKey,
                model: this.cfg.imageModel,
                prompt,
                ...(this.cfg.imageTimeoutSec > 0 ? { timeoutMs: this.cfg.imageTimeoutSec * 1000 } : {}),
                size: POSTER_SIZE,
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
  }

  /**
   * 记一次「跟这个人一起走过」。
   *
   * 只记名字和日期，**不记印象**。次数是事实（接了就是一次），印象是判断
   * （要真的相处过才写得出来）—— 两件事混在一起，自动生成的那句必然变成套话。
   * 印象由她自己用 `journey_pet` 写。
   */
  private rememberPet(name: string): void {
    const pet = String(name || '').trim();
    if (!pet) return;
    const here = this.cityOrNull(this.st.hereId) ?? this.cityOrNull(this.st.tripHomeId);
    // 用她当地的日期，不用 UTC：跨零点的那一趟，UTC 会记成前一天。
    const dateKey = here
      ? localMoment(this.worldNow(), here.tz).dateKey
      : new Date().toISOString().slice(0, 10);
    this.st = { ...this.st, pets: metPet(this.st.pets ?? {}, pet, dateKey) };
  }

  private async claimTakenInvite(meet: MeetOptions, now: Date): Promise<void> {
    /*
     * **回程途中不再认领新的约定**（2026-11-06 长跑抓到的）。
     *
     * 原来只处理了「他叫她回来时把已有约定作废」，没想到回来路上这几十个小时里，
     * 别人又接了她说的话 —— 于是 `pledge` 和 `returning` 同时为真，
     * 面板上一边写「回家」一边写「去赴约」，两条路打架。
     * 现实里她已经在回家的车上了，不会应一声又掉头。
     */
    if (this.st.returning) return;
    const r = await myTakenInvites(meet);
    if (!r.ok || !r.list.length) return;
    /*
     * 一条邀约现在可以被好几只鱼接，服务端把它们**一个人一行**返回。
     * 所以要按 id 归组：同一份约定只建一次，把接的人全收进 withPets。
     *
     * 第一版只取 list[0]，三只鱼接了同一条邀约时，发起者只会记住第一个 ——
     * 另外两只在他的叙事里根本不存在。
     */
    const one = r.list[0];
    const same = r.list.filter((x) => x.id === one.id);
    const names = same.map((x) => x.pet).slice(0, 3);
    const dest = cityById(one.to);
    if (!dest) return;
    const here = this.cityOrNull(this.st.hereId);
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
      },
    };
    // 他接了她的邀约 —— 这一趟就算一起走过一次。
    this.rememberPet(one.pet);
    this.persist();
    await this.push(
      'journey.invite',
      `invite-taken-${one.id}`,
      `${names.join('、')}接了她说的话：一起去${dest.name}，在那儿待 ${one.days} 天。`
      + (one.note ? `对方留的话是「${one.note}」。` : '')
      + (here && here.id === dest.id
        ? `\n她本来就在${dest.name}，这几天就按这个过。`
        : `\n她也得真的往${dest.name}走 —— 路上该多久是多久，不是明天就到。`)
      + `\n（那边也是这么走的：各自出发、各自到，到了各待 ${one.days} 天，谁先到谁等。）`,
      'flush',
    );
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
  private fareOf(modeId: string, km: number, crossBorder = false, seatMult = 1): number {
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
    return km * (FARE_PER_KM[modeId as ModeId] ?? 0) * seatMult;
  }

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
  private purseRich(): boolean {
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return false;
    return this.cfg.budget - (this.st.spent - this.st.earned) > 2500;
  }

  private pickSeatFor(modeId: string, km: number, crossBorder: boolean): SeatGrade | undefined {
    const mode = modeById(modeId);
    if (!mode) return undefined;
    const cheapest = this.fareOf(modeId, km, crossBorder);
    let purse: number | null = null;
    if (this.cfg.moneyEnabled && this.cfg.budget > 0) {
      const left = this.cfg.budget - (this.st.spent - this.st.earned);
      purse = left / Math.max(1, cheapest);
    }
    return pickGrade(mode, km, purse);
  }

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
  private canAffordTrip(km: number, crossBorder = false): boolean {
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return true;
    const left = this.cfg.budget - (this.st.spent - this.st.earned);
    if (left <= 0) return false;
    const cheapest = Math.min(...(['bus', 'train', 'plane', 'ship', 'car'] as const)
      .map((id) => this.fareOf(id, km, crossBorder)));
    return cheapest <= left * 0.8;
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
  private affordMode(
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
    if (!this.cfg.moneyEnabled || this.cfg.budget <= 0) return undefined;
    const left = this.cfg.budget - (this.st.spent - this.st.earned);

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
      // 伙伴记忆和上面几样同源：少传这一项，`save` 就会沿用文件里那份（它自己兜着）。
      pets: this.st.pets,
      taste: this.st.taste,
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
          const a = (args ?? {}) as { view?: string; subject?: string };
          /*
           * 题材优先看 `subject`；没给就退回老的 `view` 语义（2026-11-06）。
           * 用户说「拍晚饭」，模型会给 subject=food —— 这一格就是为了那句话。
           */
          const subject = (a.subject ?? (a.view === 'sky' ? 'sky' : 'ground')) as PhotoSubject;
          return this.takePhotoForUser(a.view === 'sky' ? 'sky' : 'ground', subject);
        },
      },
      {
        name: decl[7].name,
        description: decl[7].description,
        parameters: decl[7].parameters,
        tags: [...decl[7].tags],
        handler: async (args) => {
          const a = (args ?? {}) as { to?: string; days?: number; note?: string };
          return await this.inviteSomeone(a.to ?? '', a.days, a.note ?? '');
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
    ];
  }

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

    if (this.st.phase === 'traveling') {
      return { text: '她已经在路上了。到了再安排下一段。', isError: true };
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
     * 手上有约定。用 `activePledge` 而不是裸的 `st.pledge`：
     * 超过寻人窗口的那份约定别的分支一律当它不存在（`moveOn` 也不看），
     * 只有这里还认它的话，她就永远走不了 —— 一份早该作废的约定把她钉在原地。
     */
    const holdingPledge = this.activePledge(now);
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
       */
      const who = this.whoOfPledge(holdingPledge);
      const where = this.cityName(holdingPledge.cityId);
      this.st = { ...this.st, pledge: null };
      this.persist();
      await this.push(
        'journey.pledge',
        `pledge-yield-${holdingPledge.inviteId}`,
        `他叫她改去别处，和${who}约好去${where}那趟只能推了。`,
        'debounce',
      );
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
    return {
      text: `出发了：${from.name} → ${dest.name}，${real?.name ?? leg.modeId}，${leg.km} 公里，`
        + `${humanHours(leg.durationWorldHours)}。`
        + (wanted && leg.modeId !== modeIdOf(wanted) ? '（他要的那种走法用不了，已换成这种，记得说一声。）' : '')
        + '这件事该跟他说一句 —— 说清去哪、怎么去、大概多久。',
    };
  }

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
  private async inviteSomeone(toName: string, days: number | undefined, note: string): Promise<{ text: string; isError?: boolean }> {
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

    const d = Math.min(14, Math.max(1, Math.round(Number(days) || 2)));
    const r = await sendInvite(meet, here.id, c.id, d, note);
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
      text: `发出去了：${here.name} → ${c.name}，在那儿待 ${d} 天${note ? `，留了一句「${note}」` : ''}。`
        + '谁能看见全看那会儿谁也在这一带 —— 没有人接是常事，那条 24 小时后自己过期，不会有回音。'
        + '别把它当成约好了，该怎么走还怎么走。',
    };
  }

  /** 看看同城有谁在找伴。不改任何状态。 */
  private async listNearbyInvites(): Promise<{ text: string; isError?: boolean }> {
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
    const takeable = r.list.filter((x) => x.to !== here.id && x.to !== homeId);
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
  }

  /**
   * 接下一条。
   *
   * 三条前置判断，都是为了不让她许下一个做不到的承诺：
   * 得在一个城里、手上不能已经有别的约定、那地方得真的去得了。
   */
  private async takeInvite(id: string, approved = false): Promise<{ text: string; isError?: boolean }> {
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
    if (!canTravel(here, dest)) {
      return {
        text: `${dest.name}从${here.name}这儿去不了（隔着海，或者那边没有机场）。`
          + '先别接 —— 答应了到不了，比不答应难看。',
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
    const km = Math.round(distanceKm(here, dest));
    const canGo = pickMode(
      here, dest, km, Math.random, this.isTight(), this.noFly(),
      this.affordMode(km, 0.5, here.country !== dest.country, { from: here, to: dest }),
    );
    if (!canGo) {
      return {
        text: `从${here.name}去${dest.name}这一趟的票钱她付不起（${km} 公里）。`
          + '先别接 —— 答应了买不起票，第二天就得反悔，比不接难看。',
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
        `她想接${this.nameOf(one.pet)}那条：一起去${dest.name}，待 ${one.days} 天。在等他点头。`
        + '\n（他答「好」之前她没有答应任何人；答了才算。）',
        'flush',
      );
      return {
        text: `想接 —— 但还没接。他开了「出门等点头」，这会儿先问他一句：`
          + `${this.nameOf(one.pet)}找一起去${dest.name}、待 ${one.days} 天${one.note ? `（「${one.note}」）` : ''}。`
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
      },
    };
    // 她接了别人的 —— 同样算一起走过一次。名字是服务端给的，不是她编的。
    this.rememberPet(r.withPet);
    this.persist();

    await this.push(
      'journey.invite',
      `invite-${id}`,
      `她答应了${this.nameOf(r.withPet)}：一起去${dest.name}，在那儿待 ${r.days} 天。`
      + (r.note ? `对方留的话是「${r.note}」。` : '')
      + (here.id === dest.id
        ? `\n本来就在${dest.name}，接下来这几天就按这个过。`
        : `\n接下来她会真的往${dest.name}走 —— 不是明天就到，路上该多久是多久。`),
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
        + (here.id === dest.id
          ? `她本来就在${dest.name}，这几天不走。`
          : `下一站会往${dest.name}走，到了之后待满 ${r.days} 天。`)
        + (r.note ? `对方原话：「${r.note}」。` : '')
        + '这件事该跟他说一句 —— 说清跟谁、去哪、几天，别当成通知念。',
    };
  }

  /**
   * 手上那份约定还有效吗。**纯判断，不改状态** —— 它会被面板、`journey_now`
   * 和巡检各叫一遍，某一次顺手改了状态，另外两处读到的就不是同一份东西了。
   *
   * 失效条件只有一个：**接下了却迟迟没到**。邀约本身 24 小时过期，
   * 但赶路要时间，所以给三天 —— 三天还没挪到那座城，这条就当没说过。
   */
  private activePledge(now: Date): Pledge | null {
    const p = this.st.pledge;
    if (!p) return null;
    if (!cityById(p.cityId)) return null;
    if (p.arrivedAt) return p.arrivedAt && Number.isFinite(Date.parse(p.arrivedAt)) ? p : null;
    const age = now.getTime() - Date.parse(p.acceptedAt);
    if (!Number.isFinite(age) || age < 0) return null;
    return age <= PLEDGE_TRAVEL_WINDOW_MS ? p : null;
  }

  /** 天数待满没有。只在「已经到了」之后才有意义。 */
  private pledgeDone(now: Date, p: Pledge): boolean {
    if (!p.arrivedAt) return false;
    const ms = now.getTime() - Date.parse(p.arrivedAt);
    if (!Number.isFinite(ms) || ms < 0) return false;
    return ms >= p.days * 86_400_000;
  }

  /** 作废一份约定，并且说出来为什么 —— 静默丢掉，她明天会自己编一个解释。 */
  private dropPledge(now: Date, why: string): void {
    if (!this.st.pledge) return;
    this.st = { ...this.st, pledge: null };
    this.persist();
    this.log?.info(`约定作废（${why}）。`);
    void this.push('journey.invite', `invite-drop-${now.getTime().toString(36)}`, why, 'flush');
  }

  /**
   * 每次巡检顺手看一眼：手上那份约定是不是已经废了。
   *
   * 它自己会过期（接下三天还没到），而过期这件事必须**由巡检来落盘** ——
   * `activePledge` 是纯判断，它只会让那份约定「不生效」，不会把文件里的那一行删掉。
   * 不清理的话，用户打开 `state.json` 会看到一条半个月前的承诺。
   */
  private prunePledge(now: Date): void {
    const p = this.st.pledge;
    if (!p) return;
    if (this.activePledge(now)) return;
    const name = this.cityName(p.cityId);
    this.dropPledge(now, `跟${this.whoOfPledge(p)}说好去${name}的那趟没赶上（过了三天还没到），这事儿只能算了。`);
  }

  /**
   * 他在对话里要一张照片。**走的和界面那个「补一张」是同一条路。**
   *
   * 三件事必须和按钮一致，否则「她拍的」和「他点出来的」会是两种东西：
   * 拍哪儿（`photoSceneNow`）、不受时段限制、不受「一天一张」判重限制。
   * 后两条是成本闸 —— 它们管的是「她自己决定要拍」，管不到「人明确要的那一张」。
   */
  private async takePhotoForUser(
    view: 'ground' | 'sky' = 'ground',
    subject: PhotoSubject = 'ground',
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
            '这一张够了，别连着再调一次。',
        };
      }
      return {
        text:
          `拍好了：${res.title ?? '一张'}，当地 ${hour} 点。这是你脚边这一刻的实景 —— ` +
          `指定的画面（星空、日出、雪）它拍不出来，别处也拍不到。` +
          `他要的如果不在里头，就照实说「这会儿 ${hour} 点，那个拍不到」；` +
          `要是他想看的是天，下次把镜头抬起来（view="sky"），那是另一张。` +
          `别描述画面（这张图没给过你，你手上只有标题），也别编「手举得低」「镜头钉在地上」这类理由。` +
          `这一张够了，别连着再调一次。`,
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
        // 这一趟为什么走：赴约和「待够了想换地方」在记忆里不是同一件事。
        this.pledgeText(now),
      ].filter(Boolean).join('\n');
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
      return [
        `${here.name}。${rest}`,
        why,
        been,
        `家里这样：${bodyFeeling(here, here)}`,
      ].filter(Boolean).join('\n');
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
    ].filter(Boolean).join('\n');
  }

  /**
   * 「手上那份约定」这一行。
   *
   * 两个调用点：`nowSummary`（在目的地那一支）、以及赶路那一支 ——
   * **两处都要给**。只在目的地给的话，她坐两天车的那段时间里手上什么都没有，
   * 被问一句「你去哪儿、为什么」只能从很早以前的上下文里捞，捞不到就编。
   */
  private pledgeText(now: Date): string {
    const p = this.activePledge(now);
    if (!p) return '';
    const name = this.cityName(p.cityId);
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
    if (left <= 0) return `跟${this.whoOfPledge(p)}说好的 ${p.days} 天在${name}已经待满，剩下是看她还能不能动身。`;
    return `答应了${this.whoOfPledge(p)}一起在${name}待 ${p.days} 天，还剩 ${left} 天。`;
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
        /*
         * 2026-11-06 用户来信要的：「希望插件里面可以直接看每天的日记」。
         * 原来日记只在同步盘的 md 文件里，要拿记事本打开 —— 那等于让用户去文件系统里找她。
         */
        { id: 'diary', title: '日记', description: '她每天写的那几段，按天翻。' },
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

    /*
     * 照片这盏灯三态：
     *
     * - 什么都没配 → 灰（没启用，不是故障，红点会让人去修一个没坏的东西）
     * - 选了 ComfyUI 但没粘 workflow → **红**。这是「以为配好了其实不能用」，
     *   正是最需要有人提醒的那一种，而它不会自己好
     * - 能拍 → 按上一次的结果
     */
    const proto = photoProtocolOf(this.cfg.imageProtocol);
    const protoName = proto === 'comfyui' ? 'ComfyUI' : '云端接口';
    const cfgProblem = this.photoConfigProblem();
    const photo: WorldLamp = cfgProblem && !this.cfg.imageApi.trim()
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
        const days = this.diary.recent(60).map((d) => ({
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
    if (panel === 'album') {
      if (method === 'list') {
        const snap = this.uiSnapshot();
        // 把媒体目录一起带回去：相册页要显示它，用户才知道去哪个文件夹翻原图。
        return { photos: snap.photos, dir: snap.photoDir, error: snap.photoError };
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
        const api = this.cfg.imageApi.trim();
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
        const proto = photoProtocolOf(this.cfg.imageProtocol);
        const hasKey = Boolean(this.cfg.imageKey.trim());
        const line = proto === 'comfyui'
          ? `ComfyUI ${this.safeApi(api)}，提示词节点 ${(this.cfg.imagePromptNode ?? '').trim() || '自动'}，当地 ${scene.hour} 点`
          : `接口 ${this.safeApi(api)}，模型 ${this.cfg.imageModel.trim() || '（用默认）'}，密钥${hasKey ? '已填' : '没填'}，当地 ${scene.hour} 点`;
        return {
          ok: res.ok,
          reason: res.reason ?? null,
          diag: {
            protocol: proto,
            api: this.safeApi(api),
            model: this.cfg.imageModel.trim() || '（用默认）',
            hasKey,
            localHour: scene.hour,
            line,
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
        if (!p) return { nearby, invites, pool, pledge: null };
        const city = this.cityName(p.cityId);
        if (!p.arrivedAt) {
          // 还没到：天数就是他答应人家的天数，不能算「还剩」。
          return { nearby, invites, pool, pledge: { withPet: this.whoOfPledge(p), city, days: p.days, daysLeft: p.days, here: false } };
        }
        const ms = now.getTime() - Date.parse(p.arrivedAt);
        const left = Math.max(0, Math.ceil((p.days * 86_400_000 - ms) / 86_400_000));
        return {
          nearby,
          invites,
          pool,
          pledge: { withPet: this.whoOfPledge(p), city, days: p.days, daysLeft: left, here: this.st.hereId === p.cityId },
        };
      })(),
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
      ask: (() => {
        const a = this.st.ask;
        if (!a) return null;
        const city = this.cityName(a.cityId);
        const line = a.kind === 'accept'
          ? `${a.withPet ?? '有人'}想一起去${city}，待 ${a.days ?? 2} 天`
            + `${a.note ? `——「${a.note}」` : ''}。去不去？`
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

/**
 * 这个月当地有节的城市。
 *
 * 一个月一次就够：挑目的地不会一小时一次，算一遍比缓存省事。
 * 只回 id，具体的「是什么节」由 `dayplan.ts` 的 `festivalOn` 负责 ——
 * 那边管"当天撞上什么"，这边只管"值不值得为这个月专门跑一趟"。
 */
/**
 * 封面的尺寸。3:4 竖版 —— 小红书那套手账封面基本都是这个比例，
 * 也是唯一一个「竖着看像一页纸」的常见比例。
 */
const POSTER_SIZE = '1024x1536';

/** 月报要不要额外画封面。默认关 —— 见 `writeMonthlyReport` 里那段说明。 */
const MAKE_COVERS = false;

/**
 * 封面右下角那句手写：**用她自己那天写下的原话**。
 *
 * 不让模型编一句「今日份的诗意」—— 编出来的东西和正文里那些日记一对照就露馅。
 * 那天没写日记就往前找最近的一篇；整月都没写就留空，宁可不写。
 */
function coverLine(entries: readonly MonthlyEntry[], dateKey: string): string {
  if (!entries.length) return '';
  const day = (k: string): number => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86400000;
  };
  const target = day(dateKey);
  let best: MonthlyEntry | null = null;
  let bestGap = Infinity;
  for (const e of entries) {
    const gap = Math.abs(day(e.dateKey) - target);
    if (gap < bestGap) { best = e; bestGap = gap; }
  }
  if (!best) return '';
  const t = String(best.body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const stop = t.search(/[。！？!?]/);
  const one = stop > 0 ? t.slice(0, stop + 1) : t;
  return one.length > 22 ? `${one.slice(0, 21)}…` : one;
}

/**
 * 约定里「跟谁」。
 *
 * 2026-11-05 之前一条邀约只能成一对，所以到处直接拼 pledge.withPet。
 * 现在一条邀约最多三只鱼接，得能说「小满和小汐」「小满、小汐、阿澈」。
 *
 * 老数据没有 `withPets`，那就退回单个人 —— 不要用空数组把它盖掉。
 */
export function whoOf(p: { withPet: string; withPets?: readonly string[] }): string {
  const list = (p.withPets && p.withPets.length ? p.withPets : [p.withPet])
    .filter((x): x is string => typeof x === 'string' && !!x && x !== '一只鱼');
  if (!list.length) return '一只鱼';
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]}和${list[1]}`;
  return list.slice(0, 3).join('、');
}

function festivalCities(month: number): string[] {
  if (!Number.isFinite(month)) return [];
  return CITIES
    .filter((c) => c.festivals.some((f) => f.months.includes(month)))
    .map((c) => c.id);
}

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
      type: 'journey.ask',
      description: { zh: '她在问：想出门（或者想接一条邀约），等他点头。面板上会有一张卡片，两个按钮。', en: 'She is asking to set off (or to take an invitation) and waiting for a yes. The panel shows a card with two buttons.' },
      trigger: 'flush' as const,
    },
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
      type: 'journey.invite',
      description: {
        zh: '跟同城的人说好了去哪、几天，或者那份约定没走成。',
        en: 'She agreed with someone nearby to go somewhere for a few days, or that plan fell through.',
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
 * 生图走哪条协议。**默认 openai，只有明确写了 comfy 才切。**
 *
 * 宽容一点认写法（`ComfyUI` / `comfy` / `comfy ui`），但不认模糊说法 ——
 * 用户填了看不懂的词，宁可当云端处理（那是绝大多数人的配置），
 * 也不要靠猜去切一条他根本没配的链路。
 */
function photoProtocolOf(raw: string): 'openai' | 'comfyui' {
  return /^\s*comfy/i.test(raw ?? '') ? 'comfyui' : 'openai';
}

/**
 * 这张图要不要裁掉底边那条水印。
 *
 * `auto` 的判断依据是**协议，不是图像识别**：
 * 本地 ComfyUI 出的图不可能带水印（「AI生成」是服务商出图后盖上去的），
 * 所以只裁云端那些。这个事实比 OCR 可靠得多，也不用为每张图算一遍。
 *
 * 不做自动检测的另一个理由：漏检的代价是水印留在图上（用户看得见、能再处理），
 * 误检的代价是把好画面裁掉一截（用户根本不知道本来有）。
 */
function shouldCropWatermark(mode: string | undefined, protocol: string): boolean {
  if (mode === 'off') return false;
  if (mode === 'crop') return true;
  // 空 / 认不出的值一律按 auto 走：配置写错了不该让水印漏出来。
  return protocol !== 'comfyui';
}

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

/**
 * 这一趟是怎么收的，一句事实。
 *
 * 2026-11-04 加。这句同时进 `{{journey.now}}`（系统前缀）和 `journey_now` 的工具回执 ——
 * 她回家那几天写日记、答「这趟怎么样」，读到的都是这一句。
 *
 * **只给事实，不给情绪词。** 写成「心里空落落的」她会照抄；写成「是被上限掐断的」，
 * 情绪由她自己决定 —— 同样是到上限，累垮了和舍不得是两种收场，那该由她判断。
 */
function homeReasonText(r: HomeReason | null): string {
  switch (r) {
    case 'limit': return '这一趟是到出门上限被掐断的，不是你自己待够了。';
    case 'broke': return '这一趟是钱撑不下去才回来的，不是玩够了。';
    case 'called': return '这一趟是他叫你回来，你才收的。';
    case 'done': return '这一趟是你自己待够了，正常收的。';
    default: return '';
  }
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
/**
 * 按一个字符串算出一串稳定的伪随机数。
 *
 * 2026-11-03 Mr.Q：「她每天的宾馆本身都定下来了，后面又换了一家旅馆」。
 *
 * 根因：`plan` 只活在内存里（`this.plan = null` 满天飞，没有任何一处从磁盘恢复），
 * 所以**每重启一次扩展，住宿就重新掷一次**。那天为了发版重启了十二次，
 * 她就在同一天里换了十二家店。
 *
 * 用种子代替 `Math.random`：同一次入住、同样的钱况，重启多少次都是同一家。
 * 钱紧了种子跟着变（下面加了后缀），所以「紧就换一家便宜的」那条逻辑照样成立。
 */
function seededRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * 用户嘴里的「怎么去」翻译成 `ModeId`。
 *
 * 只认**明确**的说法。认不出来就返回 null，让上层问她一句 ——
 * 猜错的代价是他明明说坐高铁、她上了飞机，那和这一轮要修的 bug 是同一个。
 *
 * 顺序有讲究：`高铁|动车` 要排在 `动车|车` 那些更宽的模式前面，
 * 否则「动车」会被 `car` 的「车」先吃掉。
 */
function modeIdOf(word: string): ModeId | null {
  const s = word.trim();
  if (!s) return null;
  const rules: [RegExp, ModeId][] = [
    [/高铁|动车|火车|铁路|列车|train|rail/i, 'train'],
    [/飞机|航班|机票|飞过去|飞|plane|flight|fly/i, 'plane'],
    [/自驾|开车|汽车|租车|拼车|car|drive/i, 'car'],
    [/大巴|长途汽车|客车|公交|班车|bus|coach/i, 'bus'],
    [/轮船|渡轮|客轮|船|ship|ferry|boat/i, 'ship'],
    [/摩托|机车|motorcycle|motorbike/i, 'motorcycle'],
    [/自行车|单车|骑行|bike|bicycle|cycle/i, 'bike'],
    [/电瓶车|电动车|scooter|e-bike/i, 'scooter'],
    [/步行|走路|徒步|腿儿|walk|on foot/i, 'walk'],
  ];
  for (const [re, id] of rules) if (re.test(s)) return id;
  return null;
}

function roadText(  modeId: string, idx: number, leg: Journey, from: City, to: City, hour: number, progress = 0,
): string {
  const night = hour >= 21 || hour < 6;
  // 按调用方给的真实进度算剩余，而不是拿 idx 反推 —— 短途只有一个节点（idx=1），
  // 反推出来的「还有三小时」和实际剩一小时会差得很远。
  const left = Math.max(0, Math.round(leg.durationWorldHours * (1 - progress)));
  /*
   * 剩余时间走 `humanHours`，不再直接写「${left} 小时」。
   *
   * 跨洋的船一趟四百多小时，直写就是「还有大约 448 小时」—— 数字没错，
   * 但没人这么说话，而且得读者自己换算。改成「还有大约 19 天」。
   */
  const tail = left > 0 ? `还有大约 ${humanHours(left)}。` : '';
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
