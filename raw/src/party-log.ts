/**
 * 同行记录 —— 本地那张「我参与过哪几趟」的清单。
 *
 * ## 为什么要有这个文件
 *
 * 同行卡存在服务端，按 `invite id` 取。但 `pledge` 一旦清掉（待满、过期、作废），
 * 本地就**再也没有那个 id 了** —— `state.json` 里只剩一个空 pledge。
 * 结果就是：卡明明在服务器上等着，客户端不知道去问哪一条。
 *
 * 所以这里只做一件事：把「我参与过的同行」记下来，让面板找得回那张卡。
 *
 * ## 为什么不塞进 `state.json`
 *
 * `state.json` 回答的是「她现在在哪」，每十几分钟就写一次，而且有它自己的
 * 白名单重建和合并规则。往那里加一种新东西，要同时照顾老数据兼容、
 * 跨设备合并、白名单别漏 —— 为了一张卡付这个代价不值。
 *
 * 这份东西**只在本机**：`uid` 本来就是按机器分的（见 `meetUid`），
 * 卡也是按那个 `uid` 留的，换台机器本来就没有「我」这一半。
 *
 * ## 三件事
 *
 * 1. **只留最近的 20 条。** 卡 30 天过期，20 条足够覆盖，而且这个文件
 *    不该无限长大 —— 它每次 `persist` 都会被读一次。
 * 2. **同一条不重复记。** 认领和接单可能各触发一次，重复记会让面板上
 *    出现两行一模一样的「跟小满去过大理」。
 * 3. **坏了就当空的。** 文件是给人看的，它坏掉不该让她连旅行都进行不下去。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 最多留几条。卡 30 天过期，这一段够覆盖。 */
const MAX = 20;

const FILE = 'party-log.json';

export interface PartyEntry {
  /** 邀约编号，16 位 hex。取卡的钥匙。 */
  readonly id: string;
  /** 一起走的人（不含自己）。服务端只给名字。 */
  readonly pets: readonly string[];
  /** 待了几天。 */
  readonly days: number;
  /** 那趟开始的时刻（真实时间 ISO）。排序用。 */
  readonly at: string;
  /** 那趟在哪座城散的。面板上要能说清「大理那三天」。 */
  readonly city: string;
}

export class PartyLog {
  constructor(private readonly dir: string) {}

  private path(): string {
    return join(this.dir, FILE);
  }

  /** 全部记录，新的在前。读不到或者坏了都返回空数组。 */
  list(): PartyEntry[] {
    try {
      const raw = readFileSync(this.path(), 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (!Array.isArray(data)) return [];
      return data
        .filter((x): x is PartyEntry => !!x && typeof x === 'object' && typeof (x as PartyEntry).id === 'string')
        .map((x) => ({
          id: String(x.id).slice(0, 32),
          pets: Array.isArray(x.pets) ? x.pets.map((p) => String(p)).filter(Boolean).slice(0, 8) : [],
          days: Math.max(1, Math.floor(Number(x.days) || 1)),
          at: String(x.at ?? '').slice(0, 32),
          city: String(x.city ?? '').slice(0, 24),
        }))
        .filter((x) => /^[a-f0-9]{16}$/.test(x.id))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, MAX);
    } catch {
      return [];
    }
  }

  /**
   * 记一趟。`id` 已经记过就更新其余字段（天数可能被改过），不新增一行。
   * 返回 true 表示内容真的变了 —— 调用方据此决定要不要再落盘。
   */
  add(entry: PartyEntry): boolean {
    const all = this.list();
    const i = all.findIndex((x) => x.id === entry.id);
    const next: PartyEntry = {
      id: entry.id,
      pets: [...new Set(entry.pets.map((p) => String(p).trim()).filter(Boolean))].slice(0, 8),
      days: Math.max(1, Math.floor(Number(entry.days) || 1)),
      at: String(entry.at ?? '').slice(0, 32),
      city: String(entry.city ?? '').slice(0, 24),
    };
    if (i >= 0) {
      const old = all[i]!;
      const same = old.days === next.days
        && old.city === next.city
        && old.pets.length === next.pets.length
        && old.pets.every((p, k) => p === next.pets[k]);
      if (same) return false;
      all[i] = next;
    } else {
      all.unshift(next);
    }
    this.save(all.slice(0, MAX));
    return true;
  }

  private save(rows: readonly PartyEntry[]): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      // 先写临时文件再改名：中途崩掉不会留下半份 JSON。
      const tmp = `${this.path()}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.path());
    } catch { /* 写不进去不该影响旅行 */ }
  }
}
