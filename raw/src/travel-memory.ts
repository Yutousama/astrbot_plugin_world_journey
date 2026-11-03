/**
 * 旅行记忆 —— 跨设备的那一份。
 *
 * ## 为什么从 `state.json` 里拆出来
 *
 * `state.json` 回答的是「她现在在哪」。两台机器共写这一份，后果不是报错，是**幻觉**：
 * 回家打开电脑，看到的是公司那台三天前的位置，还在把真正的位置盖掉。
 *
 * 但她**攒下来的东西**是另一回事：去过哪些城、还想去哪、一共花了多少钱。
 * 这些是记忆，不是位置。换台机器就归零，那不叫"换设备"，那叫**失忆**，
 * 而且失忆之后没有任何东西可以恢复。
 *
 * 所以分成两份：
 *
 *   行程（现在怎么样）→ `dataDir/state.json`，只在本机
 *   记忆（攒下了什么）→ `<memoryDir>/travel-memory.json`，跟着人走
 *
 * ## 合并规则只有三条，方向都朝「宁可多记，不可丢」
 *
 * - `everVisited` **并集**：去过就是去过，换台机器不该变成没去过。
 * - `wishes` **并集**：宁可多出一条想去，也不能把她惦记的地方冲掉。
 *   代价是已经兑现的目的地会回来一次 —— 但下一次到达时它会被删掉，这个代价可以接受；
 *   反过来（丢掉一条想去）是不可接受的。
 * - `spent` **取大的**：累计花销只会变大，小的那份是旧机器上的截断或重置。
 *
 * ## 为什么不按时间戳判「谁更新」
 *
 * `state.json` 每十几分钟就写一次（巡检、每个作息节点都写），时间戳永远比记忆文件新。
 * 用「谁新听谁」的话，记忆文件永远输，那这套东西等于没做。
 * 所以这里只比**内容**，不比时间。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TravelMemory {
  readonly version: 1;
  readonly everVisited: readonly string[];
  readonly wishes: readonly string[];
  readonly spent: number;
  /**
   * 打工挣的。**必须跟着走。**
   *
   * 2026-11-02 模拟抓到的：只同步 `spent` 不同步 `earned`，换台机器之后
   * 净值 = 花销 - 收入 会算成「收入 0」，于是她刚到新机器就以为自己把钱花光了，
   * 立刻跑去打工。
   */
  readonly earned: number;
  readonly updatedAt: string;
}

/** 只取记忆那三样，其余字段不碰 —— 位置、路线、时钟一律留在本机。 */
export interface MemoryFields {
  readonly everVisited: readonly string[];
  readonly wishes: readonly string[];
  readonly spent: number;
  readonly earned: number;
}

const FILE = 'travel-memory.json';

const uniq = (list: readonly unknown[]): string[] => {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
};

function parse(raw: string): TravelMemory | null {
  try {
    const j = JSON.parse(raw) as Partial<TravelMemory>;
    return {
      version: 1,
      everVisited: uniq(Array.isArray(j.everVisited) ? j.everVisited : []),
      wishes: uniq(Array.isArray(j.wishes) ? j.wishes : []),
      spent: Number.isFinite(Number(j.spent)) ? Math.max(0, Number(j.spent)) : 0,
      earned: Number.isFinite(Number(j.earned)) ? Math.max(0, Number(j.earned)) : 0,
      updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** 两份记忆合一份：并集 + 取大。 */
export function mergeMemory(a: TravelMemory | null, b: TravelMemory | null): TravelMemory | null {
  if (!a) return b;
  if (!b) return a;
  return {
    version: 1,
    everVisited: uniq([...a.everVisited, ...b.everVisited]),
    wishes: uniq([...a.wishes, ...b.wishes]),
    spent: Math.max(a.spent, b.spent),
    earned: Math.max(a.earned ?? 0, b.earned ?? 0),
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

export class TravelMemoryStore {
  /** 跟着人走的那份（同步盘）。空 = 没配，只在本机。 */
  private dir = '';
  private readonly local: string;

  constructor(dataDir: string) {
    this.local = join(dataDir, FILE);
  }

  /**
   * 换目录。传进来的应该是**已经验证过可写**的目录（`DiaryStore.current.dir`）——
   * 记忆和日记住同一个文件夹，用户填一次就够，两个各填一遍反而容易填错。
   */
  configure(dir: string): void {
    this.dir = dir;
  }

  get file(): string {
    return this.dir ? join(this.dir, FILE) : this.local;
  }

  private readFile(path: string): TravelMemory | null {
    try {
      if (!existsSync(path)) return null;
      return parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * 读一份记忆。
   *
   * **同步盘那份优先，本机那份只在同步盘读不到时兜底。**
   *
   * 第一版是「两边都读、合起来」，看起来更保险，实际有个要命的副作用：
   * 本机副本永远不删，于是**删除永远无效** ——
   * 她在 A 机器上去过京都、把它从「想去」里划掉，A 把自己和同步盘都写干净了；
   * 换成 B 机器启动，B 的旧副本里还有京都，一合并又回来了。
   * 用户看到的是「这个想去的地方怎么删不掉」。
   *
   * 所以这里不做合并：`save()` 每次都同时写两边，本机的不会比同步盘新，
   * 合并只会把已经删掉的东西加回来。跨机器之间的合并放在 `merge()` 里，
   * 那个是「两台机器各自的行程」之间的合并，不是「同一台机器的两份副本」。
   */
  read(): TravelMemory | null {
    if (this.dir) {
      const remote = this.newestIn(this.dir);
      if (remote) return remote;
    }
    return this.readFile(this.local);
  }

  /**
   * 目录里最新的一份记忆 —— **包括网盘生成的冲突副本**。
   *
   * 两台机器都写过同一个同步盘，OneDrive 会留一份 `travel-memory-笔记本.json`。
   * 只认固定文件名的话，那一份里独有的「去过」「想去」永远读不到，还不报错 ——
   * 和日记里踩过的是同一个坑（那边按月份前缀认文件）。
   *
   * 取 mtime 最新那份，**不做并集**：并集会让划掉的地方复活（见 read 的注释）。
   * 中间靠 mtime 排序、跳过解析不了的，坏一份不至于把整份记忆读丢。
   */
  private newestIn(dir: string): TravelMemory | null {
    let names: string[];
    try { names = readdirSync(dir); } catch { return null; }
    const cands: { path: string; mtime: number }[] = [];
    for (const n of names) {
      if (!/^travel-memory[^\\/]*\.json$/.test(n)) continue;
      if (n.includes('.bad.')) continue;   // 留底的坏文件不参与
      const p = join(dir, n);
      try {
        const st = statSync(p);
        if (st.isFile()) cands.push({ path: p, mtime: st.mtimeMs });
      } catch { /* 刚被删 */ }
    }
    cands.sort((a, b) => b.mtime - a.mtime);
    for (const c of cands) {
      const m = this.readFile(c.path);
      if (m) return m;
    }
    return null;
  }

  /**
   * 把这一趟攒下的东西写出去。
   *
   * **先写同步盘，失败了再写本机。** 顺序不能反：反过来的话，同步盘上永远是旧的那份，
   * 而本机那份悄悄变成了最新的 —— 下一台机器读到的就是丢了几天记忆的版本。
   */
  save(fields: MemoryFields): string | null {
    const data: TravelMemory = {
      version: 1,
      everVisited: uniq(fields.everVisited),
      wishes: uniq(fields.wishes),
      spent: Math.max(0, Number(fields.spent) || 0),
      earned: Math.max(0, Number(fields.earned) || 0),
      updatedAt: new Date().toISOString(),
    };
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const targets = this.dir ? [join(this.dir, FILE), this.local] : [this.local];
    let lastErr: string | null = null;
    for (const path of targets) {
      try {
        mkdirSync(join(path, '..'), { recursive: true });
        /*
         * 目标文件在、却解析不出来：先改名留底再写。
         * 不然一份坏掉的 JSON 会被这台机器的状态直接覆盖 ——
         * 丢的正好是**另一台机器上攒的那部分**，而且事后无从查起。
         */
        if (existsSync(path) && !this.readFile(path)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          renameSync(path, path.replace(/\.json$/, `-${stamp}.bad.json`));
        }        // 原子写：同步盘上被读了半截的 JSON 会让她「去过的地方」凭空少一半。
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, text, 'utf8');
        renameSync(tmp, path);
        return null;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return `旅行记忆没写进去：${lastErr ?? '原因不明'}`;
  }

  /**
   * 把读到的记忆并进当前状态。
   *
   * 只在启动时调一次。返回的是新对象 —— 外面那些 `this.st` 的引用都靠重新赋值，
   * 就地改字段最容易漏掉某一处 `readonly` 的假设。
   * `grew` 只用来决定要不要在日志里说一句，不参与任何判断。
   */
  merge<T extends MemoryFields>(st: T): { state: T; grew: boolean } {
    const mem = this.read();
    if (!mem) return { state: st, grew: false };
    const everVisited = uniq([...st.everVisited, ...mem.everVisited]);
    const wishes = uniq([...st.wishes, ...mem.wishes]);
    const spent = Math.max(st.spent, mem.spent);
    const earned = Math.max(st.earned, mem.earned ?? 0);
    const grew = everVisited.length !== st.everVisited.length
      || wishes.length !== st.wishes.length
      || spent !== st.spent
      || earned !== st.earned;
    return { state: { ...st, everVisited, wishes, spent, earned }, grew };
  }
}
