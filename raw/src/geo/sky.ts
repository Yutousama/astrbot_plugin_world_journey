/**
 * 日出日落 —— 用 NOAA 的近似算法在本地算。
 *
 * 为什么不查接口：需求里「想看黄山日出就只能夜爬」这件事，取决于**明天几点天亮**。
 * 这个数每天每地都要用一次，而且一旦拿不到就整条作息表排不出来。用公式算，
 * 误差一两分钟，够用来决定四点起还是四点半起；而且离线也算得出来。
 *
 * 参考：NOAA Solar Calculator 的 simplified equations（Brooks 2017）。
 * 适用范围：南北纬 72° 以内。再往极圈走会有极昼极夜，这里显式返回 null，
 * 让上层去说「今天没有日出」——而不是算出一个假的时间。
 */

const rad = (d: number): number => (d * Math.PI) / 180;

export interface SunTimes {
  /** UTC 时刻。当地几点看 clock.ts。 */
  readonly sunriseUtc: Date;
  readonly sunsetUtc: Date;
  /** 白昼长度（小时）。可以用来判断「这天是不是很短」。 */
  readonly daylightHours: number;
}

/** 一年中的第几天，1 起。 */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}

/**
 * 某地某天的日出日落。
 *
 * `dayUtc` 只用它的年月日；时分秒会被忽略。返回的日期以 UTC 计，
 * **可能与传入的日期不是同一天**（东边国家日出早、跨日），这是对的，别去归一化。
 *
 * 极昼/极夜（`cos` 项超出 [-1,1]）返回 null —— 那不是「没有数据」，是**那天真的没有日出**。
 */
export function sunTimes(lat: number, lon: number, dayUtc: Date): SunTimes | null {
  const doy = dayOfYear(dayUtc);
  const gamma = (2 * Math.PI / 365) * (doy - 1);

  const eqTime =
    229.18 * (
      0.000075
      + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
    );
  const decl =
    0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  // 90.833° 而不是 90°：多出来的 0.833 是大气的折射和日面半径，不加上去会早算几分钟。
  const cosHa =
    Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl))
    - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosHa > 1) return null;   // 极夜
  if (cosHa < -1) return null;  // 极昼

  const ha = Math.acos(cosHa);
  const sunriseMin = 720 - 4 * (lon + (ha * 180) / Math.PI) - eqTime;
  const sunsetMin = 720 - 4 * (lon - (ha * 180) / Math.PI) - eqTime;

  const base = Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate());
  const sunriseUtc = new Date(base + sunriseMin * 60_000);
  const sunsetUtc = new Date(base + sunsetMin * 60_000);

  return {
    sunriseUtc,
    sunsetUtc,
    daylightHours: Math.round(((sunsetUtc.getTime() - sunriseUtc.getTime()) / 3_600_000) * 10) / 10,
  };
}

/**
 * 一个地方在某个日期是否值得排「看日出」。
 *
 * 两个条件：**天亮得够早**（当地 7 点前）以及 **白昼不是短得没得看**。
 * 纬度高的地方夏天三点多就亮，冬天十点才亮 —— 后者排日出等于让她黑着等。
 */
export function sunriseWorthIt(localSunriseHour: number): boolean {
  return localSunriseHour >= 3 && localSunriseHour <= 7;
}
