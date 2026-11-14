/*
 * 本地人晚上去哪（2026-11-09）。
 *
 * ## 从哪来
 *
 * 携程问道采的：每城问「本地人晚上会去的 2 处特色玩乐」，
 * 拿到「地点 + 一句话说明」。原始回答留在 `tools/.play-inbox.txt`，
 * 解析成 `data/city-play.json`（`tools/parse-city-play.mjs`）。
 *
 * ## 为什么需要它
 *
 * 夜间「出门转转」原来只有两种说法：`city.night` 一句（「九眼桥那一带的夜」），
 * 或者没数据时的通用句（「出门沿着街走了一段」）。前者太短，后者是废话。
 *
 * 问道给的是**有具体地名 + 一句当地说法**的东西，正好补上中间那层。
 *
 * ## 覆盖与边界
 *
 * 162 / 185 城（问道有每日调用上限，最后 23 城没采，见 CHANGELOG）。
 * 没有的城市就退回 `city.night` 或通用句 —— **不编**。
 */

import { readFileSync } from 'node:fs';

export interface PlaySpot {
  /** 地名（`玉林街区`、`Äußere Neustadt外新城`）。 */
  readonly n: string;
  /** 一句话说明（`串串火锅配小酒馆微醺`）。 */
  readonly d: string;
}

let cache: Record<string, readonly PlaySpot[]> | null = null;

function load(): Record<string, readonly PlaySpot[]> {
  if (cache) return cache;
  try {
    const raw = readFileSync(new URL('../../data/city-play.json', import.meta.url), 'utf8');
    cache = JSON.parse(raw) as Record<string, readonly PlaySpot[]>;
  } catch {
    /* 文件不在就当没有 —— 退回 `city.night`，不崩。 */
    cache = {};
  }
  return cache;
}

/** 这座城市本地人晚上会去的地方。没有就是空数组。 */
export function playSpots(cityId: string): readonly PlaySpot[] {
  return load()[cityId] ?? [];
}

/**
 * 挑一处，拼成一句能直接进时间轴的话。
 *
 * `rnd` 由调用方给（排程用种子、工具用 Math.random）——
 * 同一晚重算两次不该换地方，所以排程那边传种子。
 */
export function playLine(cityId: string, rnd: () => number = Math.random): string {
  const list = playSpots(cityId);
  if (!list.length) return '';
  const hit = list[Math.floor(Math.abs(rnd()) * list.length) % list.length];
  return hit ? `${hit.n}，${hit.d}` : '';
}
