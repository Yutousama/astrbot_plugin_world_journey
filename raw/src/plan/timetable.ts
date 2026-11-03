/**
 * 班次 —— 「坐的是哪一趟车」这件事。
 *
 * ## 先说清楚这里没有什么
 *
 * 没有真实时刻表。12306 不向任何第三方提供数据（国铁集团 2026-01-29 发布会明说），
 * 市面上的「火车/航班 API」全是爬虫封装，接进来是合规风险 + 随时失效。
 *
 * 所以这里是**按真实规律生成**：车次号的位数和前缀、席别的叫法、站台和检票口的编号范围，
 * 都照现实里的写法来。**同一天、同一条线路，生成结果固定** —— 她今天说 G2028，
 * 晚上写日记还说 G2028，明天再走同一段才换一趟。
 *
 * 判据很简单：**读者能不能一眼看出这是编的。**「她坐火车去天水」看不出问题，但很空；
 * 「G2028 次，二等座，五站台」立刻就有画面，而且经得起她反复提起。
 *
 * ## 不做什么
 *
 * 不做「查余票」「查晚点」。那些必须实时数据，编出来就是假的 ——
 * 一旦她说「这趟晚点二十分钟」，用户去查发现没这趟车，整个东西就不可信了。
 * 这里只给**静态的、不会自相矛盾**的那部分。
 */
import { createHash } from 'node:crypto';
import type { City } from '../geo/cities.ts';
import type { ModeId } from '../geo/modes.ts';

export interface Schedule {
  /** 车次 / 航班号，如 `G2028`、`K165`、`CA1234`。走路骑车没有。 */
  readonly code: string;
  /** 席别 / 舱位，如「二等座」「硬卧」「经济舱」。 */
  readonly seat: string;
  /** 站台号（火车）。飞机是登机口。 */
  readonly gate: string;
}

/** 哪些交通方式有「班次」这回事。走路、骑车、自驾都没有。 */
const HAS_SCHEDULE: ReadonlySet<ModeId> = new Set<ModeId>([
  'train', 'plane', 'bus', 'ship',
]);

/**
 * 从字符串算一个稳定的种子。
 *
 * **不能用 `Math.random()`** —— 那样她今天说 G2028、明天说同一段路又是 G4471，
 * 用户一旦记住就会觉得「这东西在乱编」。
 */
function seedOf(parts: readonly string[]): number {
  const h = createHash('sha256').update(parts.join('|')).digest();
  return h.readUInt32BE(0);
}

/** 按种子取一个区间内的整数。 */
function pick(seed: number, min: number, max: number, salt = 0): number {
  const span = max - min + 1;
  return min + ((seed >>> (salt % 24)) % span);
}

/** 取数组里的一项，同样由种子决定。 */
function oneOf<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length] as T;
}

/**
 * 造一趟班次。`dateKey` 参与种子 —— 同一天同线路固定，换一天换一趟。
 *
 * 距离影响车次类型：短途多是高铁动车，长途普速的比例上来。
 * 这不是精确统计，是「别人听着不奇怪」的量级。
 */
export function makeSchedule(
  mode: ModeId,
  from: City,
  to: City,
  dateKey: string,
  km: number,
  hours: number,
): Schedule | null {
  if (!HAS_SCHEDULE.has(mode)) return null;
  const seed = seedOf([mode, from.id, to.id, dateKey]);

  if (mode === 'plane') {
    // 航班号：两字码 + 四位。国内主流航司的代码。
    const airline = oneOf(['CA', 'MU', 'CZ', 'HU', '3U', 'ZH', 'MF', 'SC'], seed);
    const code = `${airline}${pick(seed, 1000, 9899, 4)}`;
    const seat = hours >= 4 ? oneOf(['经济舱', '超级经济舱'], seed >>> 3) : '经济舱';
    // 登机口：真实机场是字母 + 数字，A/B/C 区最常见。
    const gate = `${oneOf(['A', 'B', 'C', 'D'], seed >>> 5)}${pick(seed, 1, 36, 7)}`;
    return { code, seat, gate };
  }

  if (mode === 'train') {
    // 高铁动车是 G/D + 四位；普速是 Z/T/K + 三到四位。
    const highSpeed = km <= 1200 ? pick(seed, 0, 99, 2) < 62 : pick(seed, 0, 99, 2) < 28;
    let code: string;
    let seat: string;
    if (highSpeed) {
      const letter = pick(seed, 0, 99, 3) < 72 ? 'G' : 'D';
      code = `${letter}${pick(seed, 100, 9899, 4)}`;
      seat = pick(seed, 0, 99, 6) < 76 ? '二等座' : '一等座';
    } else {
      const letter = oneOf(['K', 'Z', 'T'], seed >>> 2);
      code = `${letter}${pick(seed, 10, 999, 4)}`;
      // 过夜的长途才说卧铺 —— 三小时的 K 车说「软卧」很奇怪。
      seat = hours >= 8
        ? oneOf(['硬卧', '软卧'], seed >>> 4)
        : oneOf(['硬座', '硬卧'], seed >>> 4);
    }
    const gate = `${pick(seed, 1, 16, 7)} 站台`;
    return { code, seat, gate };
  }

  if (mode === 'bus') {
    // 长途客车没有车次号，只有班次时刻。这里给检票口。
    return { code: '', seat: '普通座', gate: `${pick(seed, 1, 12, 3)} 号检票口` };
  }

  // 船：班次 + 舱位。
  return { code: `S${pick(seed, 100, 989, 4)}`, seat: oneOf(['散座', '二等舱'], seed >>> 3), gate: `${pick(seed, 1, 6, 5)} 号泊位` };
}

/**
 * 把班次写进一句话里。没有班次的交通方式返回空串 —— 调用方自己接别的话。
 *
 * 中文里的语序：`G2028 次，二等座，5 站台`。飞机没有「次」，直接写航班号。
 */
export function scheduleText(mode: ModeId, s: Schedule | null): string {
  if (!s) return '';
  const bits: string[] = [];
  if (s.code) bits.push(mode === 'plane' ? s.code : mode === 'ship' ? s.code : `${s.code} 次`);
  if (s.seat) bits.push(s.seat);
  if (s.gate) bits.push(mode === 'plane' ? `${s.gate} 登机口` : s.gate);
  return bits.join('，');
}
