/**
 * 和「一起听歌」扩展打配合 —— **只读它留下的快照文件，不碰它的进程**。
 *
 * ## 为什么走文件
 *
 * 宿主没有给 world 之间互查状态的接口（这是 music 扩展 `peer.ts` 里写明的结论：
 * 两个扩展各推各的事件，互相不认识）。所以只有三条路：读进程列表（只知道在不在跑）、
 * 自己再读一遍 SMTC（要复制一整套 PowerShell 采集）、或者读对方已经写出来的东西。
 *
 * 第三条最省：music 扩展把当前播放写成一个 JSON 快照，格式稳定、字段齐全。我们只读不写。
 *
 * ## 路径换过一次（2026-10-31 踩到）
 *
 * music 0.5.6 起把快照从系统临时目录搬到了 core 的 `<data>/tmp/` 下（`-Out` 参数）。
 * 我们这边还读着 `%TEMP%`，于是那个文件停在旧时间戳、一直「过期」，
 * **联动静默失效**：用户在放《爱错》，她收到的却是空。整条链路没有一处报错。
 *
 * 所以现在按**候选路径**找：先把可能的几个位置都算出来，取修改时间最新的那个。
 *
 * **耦合代价要说清楚**：那个文件的路径和格式属于另一个扩展，它改了这边就静默失效。
 * 所以这里全部按「拿不到就当没有」处理 —— 没装音乐扩展、文件不在、格式变了、
 * 字段缺了，一律返回 null，旅行照走，只是少一层联想。
 */
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CITIES, type City } from './geo/cities.ts';

export interface NowPlaying {
  readonly title: string;
  readonly artist: string;
  readonly at: number;
}

/** 快照超过这个时间就当过期 —— 她早就关掉播放器了，别拿半小时前的歌当现在的背景。 */
const STALE_MS = 5 * 60_000;

/**
 * 快照可能存在的地方，按可能性排序。
 *
 * `dataDir` 是这一个 World 的目录（`<core>/data/home/<bot>/data`），
 * 而 music 写的是 core 的 `<core>/data/tmp/` —— 也就是从这儿往上两层再进 tmp。
 * 这个相对关系属于宿主目录结构，不是我们说了算，所以**每个候选都会试**，
 * 拿不到就往下试，一个也没有就返回 null。宁可能试错几个路径，不要静默失效。
 */
export function snapshotPaths(dataDir?: string): string[] {
  const out: string[] = [];
  if (dataDir) {
    /*
     * **不要数层级。** 我第一版写死「往上两层」（`../../tmp`），算出的是
     * `<core>/data/home/tmp` —— 差一层，白改。而「World 目录比 core data 深几层」
     * 是宿主的目录约定，不是我们说了算，随时可能变。
     *
     * 所以从 World 目录开始一层层往上爬，每层都试一次 `<那层>/tmp/coopani-nowplaying.json`，
     * 最多五层。命中哪个用哪个，都不中就当没装音乐扩展。
     */
    let dir = resolve(dataDir);
    for (let i = 0; i < 5; i++) {
      const parent = resolve(dir, '..');
      if (parent === dir) break;   // 到盘根了，别再往上
      dir = parent;
      out.push(join(dir, 'tmp', 'coopani-nowplaying.json'));
    }
  }
  // music ≤ 0.5.5：系统临时目录。Windows 上就是 %TEMP%。
  out.push(join(tmpdir(), 'coopani-nowplaying.json'));
  return out;
}

/** 候选里最新的那个还没过期的。都过期或都不在 → null。 */
function freshestPath(paths: readonly string[], now: number): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  for (const path of paths) {
    try {
      const mtimeMs = statSync(path).mtimeMs;
      if (now - mtimeMs > STALE_MS) continue;
      if (!best || mtimeMs > best.mtimeMs) best = { path, mtimeMs };
    } catch { /* 这个位置没有，试下一个 */ }
  }
  return best?.path ?? null;
}

/**
 * 读当前播放。**拿不到就返回 null**，不抛错、不打日志 ——
 * 没装音乐扩展是完全正常的状态，不该每次巡检都刷一条警告。
 */
export function readNowPlaying(dataDir?: string, paths?: readonly string[]): NowPlaying | null {
  try {
    const p = freshestPath(paths ?? snapshotPaths(dataDir), Date.now());
    if (!p) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) as {
      ts?: number;
      sessions?: { title?: unknown; artist?: unknown; status?: unknown }[];
    };
    const s = raw.sessions?.[0];
    if (!s) return null;
    // 只认「正在放」。暂停时她不该说「车上放着这首歌」。
    if (String(s.status ?? '').toLowerCase() !== 'playing') return null;
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    const artist = typeof s.artist === 'string' ? s.artist.trim() : '';
    if (!title) return null;
    return { title, artist, at: Number(raw.ts) || Date.now() };
  } catch {
    return null;
  }
}

/**
 * 歌名里提到了哪座城市。
 *
 * 只做**字面匹配**，不做联想 —— 「许巍」该不该让人想起西安，那是模型的事。
 * 字面能确定的部分交给代码（《成都》《回到拉萨》），剩下的交给
 * `journey_draw_to` 那个工具，让她自己说。
 *
 * 要求全名命中且不重叠，避免「上海」被「上海滩」误判成两座城。
 */
export function cityMentioned(title: string): City | null {
  const hits: { city: City; at: number }[] = [];
  for (const c of CITIES) {
    // 太短的名字容易误伤（比如「西安」还行，「大理」也还行，但两字以下不做）。
    if (c.name.length < 2) continue;
    const at = title.indexOf(c.name);
    if (at >= 0) hits.push({ city: c, at });
  }
  if (!hits.length) return null;
  // 取最先出现的那个；同位置取更长的名字。
  hits.sort((a, b) => a.at - b.at || b.city.name.length - a.city.name.length);
  return hits[0].city;
}

/** 那一行给事件的背景。没在听歌就返回空串，不要写「没在听歌」这种废话。 */
export function songLine(np: NowPlaying | null): string {
  if (!np) return '';
  return `\n车上传的是「${np.title}」${np.artist ? `（${np.artist}）` : ''}。`;
}
