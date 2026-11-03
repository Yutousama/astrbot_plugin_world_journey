/**
 * 中国的全国性节日 —— 她在中国境内的时候，这一天是什么日子。
 *
 * ## 为什么单独一个文件
 *
 * `cities.ts` 里的 `FESTIVALS` 是**地方节庆**（泼水节、那达慕、雪顿节），
 * 一座城一条，按月份粗判就行 —— 那些节日走的是傣历、藏历、牧区习惯，写死日期一定错。
 *
 * 但春节、中秋、端午不一样：**全国人民过同一个日子**，而且日期是确定的。
 * 2026-11-02 Mr.Q 指出：「春节也是中国国内的节日，国内的节日没算到节日里」——
 * 她在国内任何一座城，都该知道今天是除夕。
 *
 * ## 日期不写死，问 Intl
 *
 * 农历年年挪。我试着凭记忆写「2027 年春节是 2 月 6 日」，查证之后是 **2 月 7 日**
 * （2 月 6 日是除夕）—— 差一天就变成「除夕说着春节的话」。
 *
 * 所以这里不维护日期表，直接用 ICU 的 `chinese` 历法算：
 *
 * ```
 * new Intl.DateTimeFormat('en-u-ca-chinese', { month:'numeric', day:'numeric' })
 * ```
 *
 * Node 自带 full-icu，2026-02-17 算出来是 `1/1`（正月初一），对得上。
 * 好处是**不用维护、不会过期**；坏处是依赖运行时的 ICU —— 万一哪天被裁掉，
 * `lunarOf()` 返回 null，退化成「不知道今天过节」，而不是算错一天。
 *
 * ## 只影响她说什么，不影响价格和人流
 *
 * 这一版只管「她知道今天是过节」。景区挤不挤、房费涨不涨，还没接 ——
 * 那是另一套改动，别混在一起，不然出了问题分不清是哪个的锅。
 */
import type { City } from '../geo/cities.ts';
import { shiftDateKey } from '../clock.ts';

export interface Holiday {
  readonly name: string;
  /** 那天街面上是什么景象。**只给事实**，她照着说才不会变成报菜名。 */
  readonly what: string;
}

/** 公历固定的那几天。 */
const SOLAR: Record<string, Holiday> = {
  '01-01': { name: '元旦', what: '商场在打折，街上有跨年的气球还没扫干净' },
  '05-01': { name: '劳动节', what: '连休几天，车站和景区都是人' },
  '10-01': { name: '国庆', what: '长假第一天，哪儿都是人，票也不好买' },
};

/**
 * 清明是节气不是农历节日，落在 4 月 4 到 6 日之间。
 *
 * 三天窗口一起认：算准那一天的黄经要引入节气表，而「这几天是清明」本身没说错。
 * 文案里也不点具体哪一天，只说这几天是什么光景。
 */
const QINGMING_DAYS = new Set(['04-04', '04-05', '04-06']);

/** 农历的。键是 `月-日`。闰月不会被匹配到（ICU 给的是 `6bis` 这种，转不成数字）。 */
const LUNAR: Record<string, Holiday> = {
  '1-1': { name: '春节', what: '鞭炮从半夜响到早上，店基本都关了，街上空得很' },
  '1-15': { name: '元宵', what: '街上有灯会，人挤人，猜灯谜的摊子前排着队' },
  '5-5': { name: '端午', what: '粽子堆在门口卖，河边上有人划船' },
  '8-15': { name: '中秋', what: '月饼摆满柜台，晚上月亮很圆' },
  '9-9': { name: '重阳', what: '上山的路上全是老人，手里拎着东西' },
};

const LUNAR_FMT = ((): Intl.DateTimeFormat | null => {
  try {
    return new Intl.DateTimeFormat('en-u-ca-chinese', {
      month: 'numeric',
      day: 'numeric',
      // 农历按北京时间算。不用系统时区 —— 用户可能在任何地方，
      // 但中国的节日只该按中国的日历走。
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return null;
  }
})();

/** 某一天对应农历几月几日。算不出来（ICU 被裁、日期非法）就 null。 */
function lunarOf(dateKey: string): { month: number; day: number } | null {
  if (!LUNAR_FMT) return null;
  try {
    const parts = LUNAR_FMT.formatToParts(new Date(`${dateKey}T04:00:00Z`));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
    const month = get('month');
    const day = get('day');
    if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) return null;
    return { month, day };
  } catch {
    return null;
  }
}

/**
 * 除夕：**明天是正月初一**。
 *
 * 不写成「腊月三十」—— 腊月有二十九天的时候，那一天是二十九。
 * 靠「明天是初一」来认，月大月小都不用管。
 */
function isNewYearsEve(dateKey: string): boolean {
  const tmr = lunarOf(shiftDateKey(dateKey, 1));
  return !!tmr && tmr.month === 1 && tmr.day === 1;
}

/**
 * 这一天她在当地赶上什么节日。没有就 null。
 *
 * 只有中国境内的城市才有全国性节日 —— 她在东京过的是花见，不是春节。
 */
export function cnHolidayOn(city: City, dateKey: string): Holiday | null {
  if (city.country !== 'CN') return null;

  const md = dateKey.slice(5);
  if (QINGMING_DAYS.has(md)) {
    return { name: '清明', what: '这几天是上坟的日子，出城的路上车多，山上有人烧纸' };
  }
  const solar = SOLAR[md];
  if (solar) return solar;

  const lunar = lunarOf(dateKey);
  if (!lunar) return null;
  if (isNewYearsEve(dateKey)) {
    return { name: '除夕', what: '年夜饭，馆子里全满，天黑之后一直在放炮' };
  }
  return LUNAR[`${lunar.month}-${lunar.day}`] ?? null;
}
