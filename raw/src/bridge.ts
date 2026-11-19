/**
 * 车费桥 —— 第三方打车扩展（`coopani-world-fish-ride`）与本扩展之间的**唯一**接口。
 *
 * ## 为什么是文件，不是调用
 *
 * 宿主没有跨 World 服务调用：`WorldContext` 只有自己的 `cfg / dataDir / secret`，
 * `WorldHost` 只有 `pushEvent / store`。写事件只能进模型上下文，另一个 World 收不到。
 * 但同一个部署下所有 World 的 `ctx.dataDir` 是**同一个目录**（宿主 `world.ts` 的
 * `context()` 里 `dataDir: loaded.dataDir`）—— 共享目录本身就是宿主给的桥。
 *
 * ## 三条不变量
 *
 * 1. **谁的文件谁写。** 本文件只读 `ride-pending/` 与 `ride-live.json`，
 *    一个字节都不写、不移、不删。结算记在**我们自己的** `state.rideApplied` 里。
 * 2. **一次原子写。** 结算表在 state 里，和 `spent` 同一次落盘。跨两个文件做
 *    「先加钱、再记账」的窗口，崩在中间就是重复扣钱 —— 这个坑不给自己留。
 * 3. **只认白名单。** 对方传多少字段都裁到七个，多的丢掉。
 *    对方的玩法每改一次，契约不用跟着改。
 *
 * ## 三个时钟，各归各位（这里最容易写错）
 *
 * | 判据 | 用哪个 | 为什么 |
 * |---|---|---|
 * | 日记 `dateKey` | 世界时刻 + 记录自己的城市时区 | 她按当地时间过日子 |
 * | `at` 合法性（未来 clamp、早于行程） | 世界时刻 | `at` 本身就是行程时间 |
 * | 文件搁置过久 | **文件 mtime + 真实时刻** | 这是「文件卫生」，不是世界里的事 |
 * | 判重表滚动 | **条数**，不按时间 | 世界时间在倍速下没有稳定含义 |
 *
 * 混用会出真事故：240x 下世界一天等于真实 6 分钟，拿真实时刻去卡 `at`，
 * 所有待结算单一瞬间全判死；拿世界时刻去判「搁置 30 天」，倍速一开就全过期。
 *
 * 契约全文见 `docs/BRIDGE.md`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { localDateKey } from './clock.ts';

/** 契约版本。不兼容变更才 +1，改字段语义也算。 */
export const BRIDGE_SCHEMA = 1;

/** 目录与文件名（相对 `<dataDir>`）。 */
export const PENDING_DIR = 'ride-pending';
export const LIVE_FILE = 'ride-live.json';
export const PUBLIC_FILE = 'journey-public.json';

/**
 * 单笔上限。超过就是**数据错误**，不是「这趟车贵」。
 *
 * 参考量级：城际出租 `12 + 2.4/km`，包车一天 500–1500，跨城专车 2000 上下。
 * 两万这个数在游戏物价里足够宽，宽到只剩一种解释：对方算错了。
 */
export const FARE_MAX = 20_000;

/** 超过预算这个比例 → 记账但提醒。不是拒收：钱真花了不能不记。 */
export const FARE_ODD_PCT = 0.1;

export const ID_MAX = 64;
/** `note` 要进 `state.json`，所以卡得比契约示例紧 —— 300 条 × 200 字会把 state 撑到几百 KB。 */
export const NOTE_MAX = 120;

/**
 * 判重表容量。
 *
 * 为什么不只按时间滚：`at` 是世界时刻，倍速下「30 天」没有稳定含义。
 * 只按条数滚，另外两道闸（`at` 早于行程开始、文件 mtime 超 30 天）负责挡住老记录 ——
 * 两条都过不了还能撞上判重表滚掉的概率，已经低到不值得为它加字段。
 */
export const APPLIED_KEEP = 120;

/** `ride-live.json` 超过这个时间没更新就不显示。真实时刻 —— 那是「现在」。 */
export const AT_FUTURE_GRACE_MS = 5 * 60_000;

/** 文件在目录里躺了这么久还没结算 → 判过期。用 mtime，不用 `at`。 */
export const PENDING_STALE_MS = 30 * 86_400_000;

/** 目录里堆了多少个就开始告警（不自动清 —— 不是我们的文件）。 */
export const PENDING_WARN_FILES = 500;

export type RideKind = 'normal' | 'rare' | 'special';

/** 白名单后的七个字段。多的一律不认。 */
export interface RideRecord {
  schema: 1;
  id: string;
  /** 上车时间，**世界时刻**。不是下单、不是到达。 */
  at: string;
  cityId: string;
  fare: number;
  kind: RideKind;
  /** 细节全在这里，原样引用进日记。空串表示对方没写，日记就不提这一条。 */
  note: string;
}

export type RideStatus = 'applied' | 'rejected';

/** 进 `state.json` 的那一条。既是判重表，也是日记的素材 —— 所以 `note` 得存。 */
export interface RideApplied {
  readonly id: string;
  readonly at: string;
  readonly fare: number;
  /** 按**该条记录自己的** `cityId` 时区换算出的当地日期。 */
  readonly dateKey: string;
  readonly status: RideStatus;
  /** 拒收原因，只给日志和事件用。 */
  readonly reason?: string;
  /** `at` 跑到未来 5 分钟以外，被当前世界时刻覆盖过。 */
  readonly atClamped?: boolean;
  /** 通过校验的记录才有；被拒的留着也没人能引用。 */
  readonly note?: string;
}

/** 目录里的一份待结算单。`broken` 表示读不出来，但**文件名仍是 id** —— 靠它回传才能让对方删。 */
export interface PendingFile {
  readonly id: string;
  readonly path: string;
  readonly mtimeMs: number;
  readonly value: unknown;
  readonly broken: boolean;
}

export interface ReadPendingResult {
  readonly files: PendingFile[];
  /** 目录读不了（权限、I/O）。ENOENT 不算，那是「还没有人来过」。 */
  readonly problem: string | null;
}

const REASON_TEXT: Record<string, string> = {
  unreadable: '文件读不出来',
  schema: 'schema 版本不认识',
  id: 'id 不合规',
  at: 'at 不是合法时间',
  'before-trip': 'at 早于这趟行程开始',
  stale: '在目录里放了太久',
  city: 'cityId 不存在',
  fare: 'fare 超出合理区间',
  kind: 'kind 不是 normal/rare/special',
};

/** 给人看的拒收原因。 */
export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason;
}

/**
 * 读待结算目录。
 *
 * `ENOENT` 返回空 —— 没人装打车扩展时这个目录永远不存在，那不是错误。
 * 坏 JSON 也返回一条（`broken: true`），id 取文件名：**不返回就等于让对方永远删不掉那份文件**。
 */
export function readPending(dataDir: string): ReadPendingResult {
  const dir = join(dataDir, PENDING_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { files: [], problem: null };
    return { files: [], problem: `待结算目录读不了：${e instanceof Error ? e.message : String(e)}` };
  }

  const files: PendingFile[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const path = join(dir, name);
    const id = name.slice(0, -5);
    // mtime 要在 try 外面留一份：读不出来时也要能判「放了多久」。
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue; // 刚好被对方删了，跳过就是
    }
    try {
      files.push({ id, path, mtimeMs, value: JSON.parse(readFileSync(path, 'utf8')), broken: false });
    } catch {
      files.push({ id, path, mtimeMs, value: null, broken: true });
    }
  }
  return { files, problem: null };
}

export interface ValidateContext {
  /** 这趟行程什么时候开始的（世界时刻）。没有行程时为 null，跳过该检查。 */
  readonly tripStartedAt: string | null;
  /** 当前世界时刻。`at` 用它判早晚。 */
  readonly worldNow: number;
  readonly cityExists: (id: string) => boolean;
  readonly tzOf: (cityId: string) => string;
}

export type ValidateResult =
  | { readonly ok: true; readonly rec: RideRecord; readonly atClamped: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * 单条校验。纯函数。
 *
 * 顺序是**先便宜的、后贵的**：字符串形状 → 时间 → 城市 → 数字。
 * 一条 `fare: NaN` 的记录不该先跑去查城市表。
 */
export function validateRide(pf: PendingFile, ctx: ValidateContext): ValidateResult {
  if (pf.broken) return { ok: false, reason: 'unreadable' };

  const raw = pf.value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'schema' };
  const o = raw as Record<string, unknown>;

  if (Number(o.schema) !== BRIDGE_SCHEMA) return { ok: false, reason: 'schema' };

  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id || id.length > ID_MAX || id !== pf.id) return { ok: false, reason: 'id' };

  const atRaw = typeof o.at === 'string' ? o.at.trim() : '';
  const atMs = Date.parse(atRaw);
  if (!Number.isFinite(atMs)) return { ok: false, reason: 'at' };

  if (ctx.tripStartedAt) {
    const startMs = Date.parse(ctx.tripStartedAt);
    if (Number.isFinite(startMs) && atMs < startMs) return { ok: false, reason: 'before-trip' };
  }

  const cityId = typeof o.cityId === 'string' ? o.cityId.trim().toLowerCase() : '';
  if (!cityId || !ctx.cityExists(cityId)) return { ok: false, reason: 'city' };

  const fare = Number(o.fare);
  if (!Number.isInteger(fare) || fare <= 0 || fare > FARE_MAX) return { ok: false, reason: 'fare' };

  const kind = o.kind;
  if (kind !== 'normal' && kind !== 'rare' && kind !== 'special') return { ok: false, reason: 'kind' };

  /*
   * `at` 跑到未来：用**当前世界时刻**盖掉。
   *
   * 不盖的话，一条「未来时间」的车费会在日记里排到后面去 ——
   * 而日记是按天分段的，排到后面就是凭空多一天。
   */
  const atClamped = atMs > ctx.worldNow + AT_FUTURE_GRACE_MS;
  const at = new Date(atClamped ? ctx.worldNow : atMs).toISOString();

  const noteRaw = typeof o.note === 'string' ? o.note.trim() : '';

  return {
    ok: true,
    atClamped,
    rec: {
      schema: BRIDGE_SCHEMA,
      id,
      at,
      cityId,
      fare,
      kind,
      note: noteRaw.slice(0, NOTE_MAX),
    },
  };
}

/** 一条要推给对方（其实是给她）的提醒。 */
export interface RideNotice {
  readonly kind: 'rejected' | 'odd';
  readonly id: string;
  readonly text: string;
}

export interface SettleInput {
  readonly pending: readonly PendingFile[];
  readonly applied: readonly RideApplied[];
  readonly spent: number;
  readonly moneyEnabled: boolean;
  readonly budget: number;
  readonly tripStartedAt: string | null;
  readonly worldNow: number;
  readonly realNow: number;
  readonly cityExists: (id: string) => boolean;
  readonly tzOf: (cityId: string) => string;
}

export interface SettleResult {
  readonly applied: RideApplied[];
  readonly spent: number;
  /** 通过了校验但还没来得及结算的总额。正常为 0 —— 扫完当场就结。 */
  readonly unsettled: number;
  readonly notices: RideNotice[];
  /** 这一轮真入账了几条。 */
  readonly settledCount: number;
}

/**
 * 结算。**不碰 fs、不碰世界状态**，只吃数组吐数组 —— 测试才能不启动 World 就跑。
 *
 * ## 三条分支必须互斥
 *
 * - 已在 `applied` 里 → **跳过**，不算拒收（等对方看到 `settled` 自己删）
 * - 校验不过 → `rejected`，`spent` 不动
 * - 通过 → `applied`，`spent += fare`
 *
 * 第二条容易写成「不处理」，那样坏文件每个 tick 被重拒一次，日志会刷屏；
 * 写进表里，对方才有机会删。
 */
export function settle(input: SettleInput): SettleResult {
  const seen = new Set(input.applied.map((a) => a.id));
  const out: RideApplied[] = [...input.applied];
  const notices: RideNotice[] = [];
  let spent = input.spent;
  let settledCount = 0;
  let unsettled = 0;

  for (const pf of input.pending) {
    if (seen.has(pf.id)) continue;

    // 文件卫生：躺太久还挂着，说明对方早就没了。用 mtime，不用 at。
    if (input.realNow - pf.mtimeMs > PENDING_STALE_MS) {
      const rec: RideApplied = {
        id: pf.id, at: '', fare: 0, dateKey: '', status: 'rejected', reason: 'stale',
      };
      out.push(rec);
      notices.push({ kind: 'rejected', id: pf.id, text: `${pf.id}：在目录里放了太久，没结算。` });
      continue;
    }

    const v = validateRide(pf, {
      tripStartedAt: input.tripStartedAt,
      worldNow: input.worldNow,
      cityExists: input.cityExists,
      tzOf: input.tzOf,
    });

    if (!v.ok) {
      out.push({
        id: pf.id, at: '', fare: 0, dateKey: '', status: 'rejected', reason: v.reason,
      });
      notices.push({ kind: 'rejected', id: pf.id, text: `${pf.id}：${reasonText(v.reason)}，没记。` });
      continue;
    }

    const { rec, atClamped } = v;
    const dateKey = localDateKey(new Date(rec.at), input.tzOf(rec.cityId));
    out.push({
      id: rec.id,
      at: rec.at,
      fare: rec.fare,
      dateKey,
      status: 'applied',
      ...(atClamped ? { atClamped: true } : {}),
      ...(rec.note ? { note: rec.note } : {}),
    });

    if (input.moneyEnabled) spent += rec.fare;
    settledCount += 1;

    /*
     * 超过预算 10% —— **照记**，只提醒。
     *
     * 拒收等于假装这趟车没发生。钱真花了不能不记；能做的只是让人看见。
     */
    if (input.moneyEnabled && input.budget > 0 && rec.fare > input.budget * FARE_ODD_PCT) {
      notices.push({
        kind: 'odd',
        id: rec.id,
        text: `${rec.fare} 块这一趟，超过预算的 ${Math.round(FARE_ODD_PCT * 100)}%，照记了。`,
      });
    }
  }

  return {
    applied: out.slice(-APPLIED_KEEP),
    spent,
    unsettled,
    notices,
    settledCount,
  };
}

/** 从 `applied` 里摘出回传给对方的那一窗（只用来让它删文件）。 */
export function settledWindow(applied: readonly RideApplied[]): Array<{ id: string; status: RideStatus }> {
  return applied.map((a) => ({ id: a.id, status: a.status }));
}

export interface PublicInput {
  readonly worldNow: number;
  readonly speed: number;
  readonly phase: string;
  readonly city: { readonly id: string; readonly name: string; readonly tz: string };
  readonly leg: {
    readonly fromId: string; readonly toId: string;
    readonly fromName: string; readonly toName: string;
    readonly modeId: string;
    readonly departedAt: string; readonly arriveAt: string;
  } | null;
  readonly money: {
    readonly enabled: boolean;
    readonly budget: number;
    readonly spent: number;
    readonly earned: number;
    readonly unsettledRideFare: number;
  };
  readonly diary: { readonly enabled: boolean; readonly dir: string };
  readonly applied: readonly RideApplied[];
  readonly hotelTier?: string;
  /**
   * **她接下来要去哪儿**（2026-11-11，鱼鱼出行作者提的接口申请）。
   *
   * 用途只有一个：包车还在服务时间内时，对方要能把包车订单的目的地改成这一站，
   * 而不是让她在半路又去叫一辆公交。
   *
   * 归属很清楚 —— **下一站由这边拥有，对方只读**；包车订单由对方拥有，这边只读
   * `ride-live.json`。两边没有谁写谁的文件。
   *
   * 可以为 `null`：今天没有下一个景点了（都在城里待着 / 只有吃饭回酒店），
   * 或者她正在跨城移动 —— 那段时间「下一站」是另一座城，不是城里某个点，
   * 交给 `leg` 那一段说，不在这里重复。
   */
  readonly nextStop: { readonly name: string; readonly at: string } | null;
}

/**
 * 公开快照。**只放事实，不放算出来的现值。**
 *
 * `leg.progress` 故意不给：它是按「现在几点」算的，落盘就开始陈旧。
 * 对方要进度，拿 `clock.worldNow` 和 `departedAt / arriveAt` 自己算。
 */
export function publicSnapshot(input: PublicInput): Record<string, unknown> {
  const { money } = input;
  /*
   * `remaining` 扣掉未结算的车费。
   *
   * 正常情况下这个数是 0（扫完当场就结），它只在结算出错的路径上有意义 ——
   * 保留它是为了让对方看到「有单挂着」，而不是看到一个偏乐观的余额。
   */
  const remaining = money.enabled && money.budget > 0
    ? money.budget - (money.spent - money.earned) - money.unsettledRideFare
    : null;

  return {
    schema: BRIDGE_SCHEMA,
    updatedAt: new Date(input.worldNow).toISOString(),
    clock: {
      worldNow: new Date(input.worldNow).toISOString(),
      speed: input.speed,
    },
    phase: input.phase,
    hotelTier: input.hotelTier || undefined,
    city: { id: input.city.id, name: input.city.name, timezone: input.city.tz },
    leg: input.leg
      ? {
        fromId: input.leg.fromId,
        toId: input.leg.toId,
        fromName: input.leg.fromName,
        toName: input.leg.toName,
        modeId: input.leg.modeId,
        departedAt: input.leg.departedAt,
        arriveAt: input.leg.arriveAt,
      }
      : null,
    money: {
      enabled: money.enabled,
      budget: money.budget,
      spent: money.spent,
      earned: money.earned,
      pendingRideFare: money.unsettledRideFare,
      remaining,
    },
    diary: { enabled: input.diary.enabled, dir: input.diary.dir },
    /*
     * 下一站。`at` 用世界时刻（跟 `leg.arriveAt` 一个口径），不是当地时刻字符串 ——
     * 对方拿 `clock.worldNow` 一比就知道还有多久，不用再处理时区。
     */
    plan: { nextStop: input.nextStop },
    rides: {
      supported: true,
      spendEnabled: money.enabled,
      settled: settledWindow(input.applied),
    },
  };
}

/**
 * 日记里的那一段。
 *
 * **每次从表重建，不做累积追加** —— 同一天重写日记，写几遍都只出现一次。
 * 这是「重写不重复」唯一可靠的做法：把幂等交给「从事实推导」，不交给「记住写过没」。
 *
 * 用括号与她的散文分开：这是账目，不是她的口气。混在正文里，模型下一轮会学着用这种腔调写。
 */
export function rideParagraph(applied: readonly RideApplied[], dateKey: string): string {
  const rows = applied.filter((a) => a.status === 'applied' && a.dateKey === dateKey && a.note);
  if (!rows.length) return '';

  /*
   * 车费另起一句，不套在括号里。
   *
   * 第一版写成「龙门石窟，9.7 公里。（54 块）」—— 两对括号挨着，读起来像
   * 排版坏了；而且对方的 `note` 大多自带句号，硬接上去还会出现「。）。
   */
  const part = (a: RideApplied): string => {
    const n = (a.note ?? '').trim();
    const tail = /[。．.！!？?]$/u.test(n) ? n : `${n}。`;
    return `${tail}车费 ${a.fare} 块。`;
  };
  const head = rows.slice(0, 3).map(part).join('');
  const more = rows.length > 3 ? `还有 ${rows.length - 3} 次没说。` : '';
  return `\n\n（今天叫了 ${rows.length} 次车：${head}${more}）`;
}

/** 首页卡。只留要画的那几个，别把对方整个文件原样透给前端。 */
export interface LiveRide {
  readonly id: string;
  /**
   * `hailing`（叫车）还是 `charter`（包车）。
   *
   * 2026-11-11 加，来自鱼鱼出行那边的一封来信：包车订单的车费是包车价、
   * 车型也是包车用的，但卡上标题一直写「正在打车」—— 因为这一格原来根本没进来。
   *
   * **可选**：缺了、空了、或者是个不认识的值，一律按 `hailing` 显示。
   * 旧版 `ride-live.json` 不用迁移，契约里的 `schema` 也不用动。
   */
  readonly service: string;
  readonly status: string;
  readonly car: string;
  readonly plate: string;
  readonly from: string;
  readonly to: string;
  readonly cityName: string;
  readonly fare: number;
  readonly progress: number;
  readonly secondsToPickup: number;
  readonly secondsToDropoff: number;
}

const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

/**
 * 解析 `ride-live.json`。纯函数，`realNow` 传进来。
 *
 * 过期自己判 —— **不等对方写 `active: false`**。它崩了，卡片不能永远挂在首页。
 */
export function parseLive(value: unknown, realNow: number): LiveRide | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (Number(o.schema) !== BRIDGE_SCHEMA) return null;
  if (o.active !== true) return null;

  const expiresAt = Date.parse(typeof o.expiresAt === 'string' ? o.expiresAt : '');
  if (!Number.isFinite(expiresAt) || realNow >= expiresAt) return null;

  const id = str(o.id, ID_MAX);
  if (!id) return null;

  return {
    id,
    // 只有 `charter` 会被前端当成包车；其余（含缺失、空串、没见过的值）都是叫车。
    service: str(o.service, 20),
    status: str(o.status, 20),
    car: str(o.car, 30),
    plate: str(o.plate, 20),
    from: str(o.from, 30),
    to: str(o.to, 30),
    cityName: str(o.cityName, 20),
    fare: num(o.fare, FARE_MAX),
    progress: num(o.progress, 100),
    secondsToPickup: num(o.secondsToPickup, 86_400),
    secondsToDropoff: num(o.secondsToDropoff, 86_400),
  };
}
