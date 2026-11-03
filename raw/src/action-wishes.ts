/**
 * 她想做、但这套立绘还没有的动作。
 *
 * ## 痕迹在哪儿
 *
 * 她写 `【开心, 拍拍】`，宿主词表里没有「拍拍」，于是**静默丢掉** ——
 * 桌面上什么都不发生，扩展也收不到任何回调。
 *
 * 唯一的痕迹在 `pet_say` 的**工具回执**里：
 *
 * ```
 * 已开始显示,这段约 6 秒。 [执行参数] 当前形象的词表里没有这些标记,已略过:拍拍。
 * ```
 *
 * 2026-11-01 先试过读 `core.log` —— 那里**没有**这一行。它只进 session。
 * 所以这里读 `<dataDir>/session-main.jsonl`，顺带也扫 core.log（万一哪天改成写日志）。
 *
 * ## 为什么要去重
 *
 * session 文件会被截断重写（`core-state.lastTruncateAt`），一重写，
 * 之前扫过的行会**再出现一次**。按字节偏移接不上，只能按内容去重。
 * 每条用 `call_id` 当指纹、没有就用整行的哈希。
 *
 * 去重表只留最近两千条：这份账是「她最近想做什么」，
 * 不是审计流水，旧指纹丢了也不会重复加 —— 因为旧行早就不在 session 里了。
 */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { findHostRoot } from './pet-vocab.ts';

export interface ActionWish {
  /** 她写的那个词。 */
  readonly word: string;
  /** 出现过几次。 */
  readonly count: number;
  /** 第一次见到（ISO，按扫描时刻记 —— 回执里只有时分秒，没有日期）。 */
  readonly firstAt: string;
  readonly lastAt: string;
}

interface WishFile {
  readonly seen: readonly string[];
  readonly items: readonly ActionWish[];
}

/**
 * 宿主的丢弃提示。
 *
 * 只认「已略过」这三个字：前面那句「当前形象的词表里没有这些标记」在实测里
 * 有时带、有时被截断（回执里前面还挂着「已开始显示,这段约 6 秒」）。
 * 卡整句会漏掉一部分 —— 而漏掉正是这个模块最不能犯的错。
 */
const DROP = /已略过\s*[:：]?\s*([^。\n"\\]+)/;

/** 一次可能报好几个词（用、或逗号分隔）。 */
function wordsOf(text: string): string[] {
  return text
    .split(/[、,，]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && w.length <= 12);
}

const SEEN_LIMIT = 2000;

export class ActionWishes {
  private readonly file: string;
  private readonly sessionFile: string;
  private readonly logFile: string | null;
  private items: ActionWish[] = [];
  private seen: string[] = [];

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'action-wishes.json');
    this.sessionFile = join(dataDir, 'session-main.jsonl');
    const root = findHostRoot(dataDir);
    this.logFile = root ? join(root, 'data', 'logs', 'core.log') : null;
    this.load();
  }

  list(): readonly ActionWish[] {
    return [...this.items].sort((a, b) => b.count - a.count);
  }

  /** 攒到这个数就值得做成真动作。 */
  get ripe(): readonly ActionWish[] {
    return this.list().filter((w) => w.count >= 3);
  }

  /**
   * 扫一遍。返回这次新记下的条数。
   *
   * 不抛错：捡不到就当这轮没有 —— 这件事坏掉不该影响旅行。
   */
  scan(now = new Date()): number {
    const stamp = now.toISOString();
    const known = new Set(this.seen);
    const map = new Map(this.items.map((w) => [w.word, w] as const));
    let added = 0;

    const take = (fingerprint: string, text: string): void => {
      if (known.has(fingerprint)) return;
      const m = DROP.exec(text);
      if (!m) return;
      const words = wordsOf(m[1]);
      if (!words.length) return;
      known.add(fingerprint);
      this.seen.push(fingerprint);
      for (const word of words) {
        const prev = map.get(word);
        map.set(word, prev
          ? { ...prev, count: prev.count + 1, lastAt: stamp }
          : { word, count: 1, firstAt: stamp, lastAt: stamp });
        added++;
      }
    };

    // 1) session 的工具回执（真正的来源）
    try {
      if (existsSync(this.sessionFile)) {
        const text = readFileSync(this.sessionFile, 'utf8');
        if (text.includes('已略过')) {
          for (const line of text.split('\n')) {
            if (!line.trim() || !line.includes('已略过')) continue;
            /*
             * 用 `call_id` 当指纹：同一次 pet_say 在 session 里可能有多行
             * （item 行、context 行），靠它才能认成同一条。
             */
            let fp = '';
            try {
              const d = JSON.parse(line) as { item?: { call_id?: unknown; id?: unknown } };
              const id = d.item?.call_id ?? d.item?.id;
              if (typeof id === 'string') fp = `s:${id}`;
            } catch { /* 不是 JSON 就用整行哈希 */ }
            if (!fp) fp = `h:${createHash('sha1').update(line).digest('hex').slice(0, 16)}`;
            take(fp, line);
          }
        }
      }
    } catch { /* 读不到就跳过 */ }

    // 2) core.log（兜底：哪天宿主把提示改成写日志）
    try {
      if (this.logFile && existsSync(this.logFile) && statSync(this.logFile).size < 8_000_000) {
        const text = readFileSync(this.logFile, 'utf8');
        if (text.includes('已略过')) {
          for (const line of text.split('\n')) {
            if (!line.includes('已略过')) continue;
            take(`l:${createHash('sha1').update(line).digest('hex').slice(0, 16)}`, line);
          }
        }
      }
    } catch { /* 同上 */ }

    if (added) {
      this.seen = this.seen.slice(-SEEN_LIMIT);
      this.items = [...map.values()];
      this.save();
    }
    return added;
  }

  /** 一句给工具回执用的话。没有就是空串。 */
  summary(): string {
    const list = this.list().slice(0, 6);
    if (!list.length) return '';
    const ripe = this.ripe.map((w) => w.word);
    const tail = ripe.length ? `。攒够的：${ripe.join('、')}（可以做出来了）` : '';
    return `她想做但还没做出来的动作：${list.map((w) => `${w.word}×${w.count}`).join('、')}${tail}。`;
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')) as Partial<WishFile>;
      if (Array.isArray(raw.seen)) this.seen = raw.seen.filter((x): x is string => typeof x === 'string');
      if (Array.isArray(raw.items)) {
        this.items = raw.items.filter(
          (w): w is ActionWish => typeof w?.word === 'string' && typeof w?.count === 'number',
        );
      }
    } catch {
      // 坏文件当没有。丢几个候选动作，比让 World 起不来轻得多。
      this.items = [];
      this.seen = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ seen: this.seen, items: this.items }, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch { /* 写不进去不影响旅行 */ }
  }
}
