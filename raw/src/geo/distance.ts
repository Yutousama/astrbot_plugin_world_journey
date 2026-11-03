/**
 * 距离与途经点。
 *
 * 全部本地计算，不查地图接口。理由见 cities.ts 顶部：
 * 旅行的时长必须在没有网络的时候也算得出来。
 */
import { CITIES, type City } from './cities.ts';

const EARTH_RADIUS_KM = 6371;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** 大圆距离（km）。误差在 0.5% 以内，对「火车开几小时」完全够用。 */
export function distanceKm(a: City, b: City): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 从 `a` 指向 `b` 的方位角，0～360 度，0 = 正北，顺时针。
 *
 * 只用在地球表面短距离近似，跨半个地球会有误差 —— 但这个扩展里它只用来判断
 * 「下一站是不是在往回走」，几十度的误差无所谓。
 */
export function bearingDeg(a: City, b: City): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * 两个方位角的夹角，0～180 度。0 = 同向，180 = 原路折返。
 */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * 直线路径上会路过哪些城市。
 *
 * 这不是真的路线规划 —— 铁路会绕、飞机会偏航。它回答的是**「这趟大概经过哪一片」**，
 * 用来让她说得出「过了西安就进关中平原了」这种话，而不是「我在一条直线上」。
 *
 * `corridorKm` 是这个「一片」有多宽：火车给 90，飞机给 250（巡航高度看到的范围大得多），
 * 走路给 15（只算真的会碰到的地方）。
 */
export function waypoints(from: City, to: City, corridorKm = 90, samples = 48): City[] {
  const out: City[] = [];
  const seen = new Set<string>([from.id, to.id]);
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const lat = from.lat + (to.lat - from.lat) * t;
    const lon = from.lon + (to.lon - from.lon) * t;
    let best: City | null = null;
    let bestKm = Infinity;
    for (const c of CITIES) {
      if (seen.has(c.id)) continue;
      // 粗筛：先比经纬差，省掉大半的三角函数
      if (Math.abs(c.lat - lat) > 3 || Math.abs(c.lon - lon) > 3) continue;
      const d = distanceKm(c, { ...c, lat, lon });
      if (d < bestKm) { bestKm = d; best = c; }
    }
    if (best && bestKm <= corridorKm) {
      seen.add(best.id);
      out.push(best);
    }
  }
  return out;
}

/**
 * 按距离给出「这一段算短途、中途还是长途」。
 *
 * 三档的分界不是随意的：400 km 以内火车和自驾各有胜负，1500 km 以上自驾开始失控
 * （一天开不完、要过夜），这正好是现实里人们换交通方式的直觉位置。
 */
export type Haul = 'short' | 'medium' | 'long' | 'intercontinental';

export function haulOf(km: number): Haul {
  if (km <= 400) return 'short';
  if (km <= 1500) return 'medium';
  if (km <= 5000) return 'long';
  return 'intercontinental';
}
