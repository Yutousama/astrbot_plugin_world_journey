/**
 * 当地时间 —— 全靠 `Intl`，不引第三方库，也不写死 UTC 偏移。
 *
 * 写死偏移（比如「日本 +9」）在夏令时国家会错一小时，而一小时足够把「晚上八点回酒店」
 * 挪成「九点还在外面」。`Intl` 带着完整的时区数据库，夏令时、历史变更都替你处理了。
 *
 * `Intl.DateTimeFormat` 的构造很贵（实测比自己算慢两个数量级），所以按 tz 缓存。
 * 这个扩展一天要问几百次「当地几点了」，不缓存会成为可见的卡顿。
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

/** 一天里的时段。分界对应真实作息，不是均分 —— 见 clock.ts 顶部说明。 */
export type DayPart = 'late' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export interface LocalMoment {
  /** 当地日期 `YYYY-MM-DD`。存日记、判「新的一天」都用它。 */
  readonly dateKey: string;
  /** 0-23。 */
  readonly hour: number;
  readonly minute: number;
  /** 小数小时，方便比大小（如 `decimal >= 20` 判回酒店）。 */
  readonly decimal: number;
  /** 周几，0=周日。 */
  readonly weekday: number;
  readonly part: DayPart;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partOf(decimal: number): DayPart {
  if (decimal < 4) return 'late';
  if (decimal < 6.5) return 'dawn';
  if (decimal < 11) return 'morning';
  if (decimal < 14) return 'noon';
  if (decimal < 17) return 'afternoon';
  if (decimal < 20) return 'evening';
  return 'night';
}

/** 把一个 UTC 时刻翻译成某时区的当地读数。 */
export function localMoment(at: Date, tz: string): LocalMoment {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const decimal = hour + minute / 60;
  return {
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    hour,
    minute,
    decimal,
    weekday: WEEKDAYS[get('weekday')] ?? 0,
    part: partOf(decimal),
  };
}

/** 只要当地的小数小时。 */
export function localHour(at: Date, tz: string): number {
  return localMoment(at, tz).decimal;
}

/** 只要当地的日期键。 */
export function localDateKey(at: Date, tz: string): string {
  return localMoment(at, tz).dateKey;
}

/** `YYYY-MM-DD` 加上 n 天。用来算「三天后」。 */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * 把「当地某天的某个小数小时」换算成 UTC 时刻。
 *
 * 做法：先按 UTC 猜一个时刻，读出当地的偏差，再减掉偏差校一次。
 * 一次校正对绝大多数情况足够；跨夏令时切换当天可能差一小时，那天的作息表跟着偏一小时，
 * 这在真实世界里也会发生（换表那天所有人的作息都要调），所以不去补第二次。
 */
export function utcFromLocal(dateKey: string, decimalHour: number, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0) + decimalHour * 3_600_000;
  const guessOffset = offsetMs(guess, tz);
  return new Date(guess - guessOffset);
}

/** 某时刻在该时区的 UTC 偏移（毫秒）。 */
function offsetMs(atMs: number, tz: string): number {
  const parts = fmt(tz).formatToParts(new Date(atMs));
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return asUtc - atMs;
}

/**
 * 她那边现在是几点时区 —— `UTC+9`、`UTC-3`、`UTC+5:30`。
 *
 * 2026-11-02 由 Mr.Q 换掉面板上那句「比你快 1 天 21 小时」：
 * 那句只在世界时钟漂移时才有意义，平时读起来像界面算错了；
 * **时区是稳定信息**，一眼就知道她那边和你在不在同一个白天。
 *
 * 不写成「日本时间」「东部时间」：那要维护一张地名表，
 * 而 `Intl` 给的偏移本身就是准的（夏令时也算进去了）。
 */
export function tzOffsetLabel(tz: string, at: Date = new Date()): string {
  let off = 0;
  try {
    // 先把时刻归到整分钟：offsetMs 的精度只到分钟，带着秒去减会差出 59 秒，
    // 四舍五入之后可能变成 UTC+8:59 这种丑数。
    const base = Math.floor(at.getTime() / 60_000) * 60_000;
    off = Math.round(offsetMs(base, tz) / 60_000);
  } catch {
    return '';
  }
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `UTC${sign}${h}:${String(m).padStart(2, '0')}` : `UTC${sign}${h}`;
}

/** 「几个小时」说成人话：14.7 → 「十四个多小时」。 */
export function humanHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟`;
  const whole = Math.floor(h);
  const rest = h - whole;
  if (rest < 0.25) return `${whole} 小时`;
  if (rest < 0.75) return `${whole} 个半小时`;
  return `${whole} 个多小时`;
}
