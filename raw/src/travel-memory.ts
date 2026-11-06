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

/**
 * 对某个伙伴的印象 —— 一起走过几次、上次什么时候、她怎么看这个人。
 *
 * key 用**名字**：服务端只回名字，不发 uid（`meet.ts` 那条「能看见，摸不着」的线）。
 * 代价写在前面：他改一次名，同一个人就变成两条记录。这是已知的、接受的代价 ——
 * 比拿一个服务端根本不给的 id 去猜要诚实。
 */
export interface PetMemory {
  /** 一起走过几次。取大不取和：两台机器各见过 2 次，合并后还是 2，不是 4。 */
  readonly times: number;
  /** 上次一起的日子（她那里的日期，`YYYY-MM-DD`）。 */
  readonly last: string;
  /** 她对这个人的印象，一句话。空 = 还没写。 */
  readonly impression: string;
}

export type PetsMap = Readonly<Record<string, PetMemory>>;

/**
 * 她自己的口味 —— **跟人走，和「去过哪」同一个文件**。
 *
 * 2026-11-05 Mr.Q：「那个偏好系统还可以做扩展（喜欢哪个地方、吃什么、看什么景色）」。
 *
 * 三类的分野不是随便分的：地方决定「下次去哪」，吃食决定「到了吃什么」，
 * 景色决定「什么时候来」（雪山要冬天、花要春天）。混成一张清单的话，
 * 这三种用途一个都做不成。
 *
 * `like: false` 也是记忆 —— 她说「这个不想再吃」，比「这个好吃」更该被记住。
 * 不记下来，下一次又会被推荐一遍。
 */
export interface TasteItem {
  /** 「玉泉观」「牦牛肉汤」「雪山」。 */
  readonly name: string;
  /** 一句为什么。空 = 只是记了一下。 */
  readonly note: string;
  /** 哪天记下的（她当地的日期）。合并时用它判谁新。 */
  readonly at: string;
  readonly like: boolean;
  /**
   * 一张照片的句柄，只有「地方」这一类带。
   *
   * 2026-11-05 Mr.Q：「地方指的是一个城市选一张她最喜欢的图片，如果每个风景点都算进去，
   * 那照片就太多了」。所以这里存的是**一座城一张** —— 它是「这座城市她记得的那一眼」，
   * 不是那次旅行的相册。年报要用的就是这一张。
   */
  readonly photo: string;
}

export type TasteKind = 'place' | 'food' | 'scenery';

export type TasteMap = Readonly<Record<TasteKind, readonly TasteItem[]>>;

export const TASTE_KINDS: readonly TasteKind[] = ['place', 'food', 'scenery'];

/** 每一类最多记多少条。超了丢最早的 —— 无上限的清单迟早把同步盘撑坏。 */
const TASTE_CAP = 60;

export const emptyTaste = (): TasteMap => ({ place: [], food: [], scenery: [] });

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
  /** 一起走过的人。见 `PetMemory` 的注释：key 是名字，改名会断成两条。 */
  readonly pets: PetsMap;
  /** 口味：喜欢 / 不喜欢的地方、吃食、景色。见 `TasteItem`。 */
  readonly taste: TasteMap;
  readonly updatedAt: string;
}

/** 只取记忆那几样，其余字段不碰 —— 位置、路线、时钟一律留在本机。 */
export interface MemoryFields {
  readonly everVisited: readonly string[];
  readonly wishes: readonly string[];
  readonly spent: number;
  readonly earned: number;
  /** 可选：老调用方（和不带伙伴的迁移路径）不传就当没有。 */
  readonly pets?: PetsMap;
  /** 可选：同上。不传就沿用文件里原有的。 */
  readonly taste?: TasteMap;
}

const FILE = 'travel-memory.json';

const uniq = (list: readonly unknown[]): string[] => {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
};

/** 把任意输入收成一份干净的伙伴表。名字空的、次数不是数的，一律按「没有」处理。 */
export function normalizePets(raw: unknown): PetsMap {
  const out: Record<string, PetMemory> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(k || '').trim().slice(0, 24);
    if (!name) continue;
    const r = (v ?? {}) as Partial<PetMemory>;
    out[name] = {
      times: Number.isFinite(Number(r.times)) ? Math.max(0, Math.floor(Number(r.times))) : 0,
      last: typeof r.last === 'string' ? r.last.slice(0, 10) : '',
      impression: typeof r.impression === 'string' ? r.impression.slice(0, 80) : '',
    };
  }
  return out;
}

/**
 * 两份伙伴表合一份。
 *
 * 次数**取大不取和** —— 和 `spent` 同一条道理：两台机器各见过他两次，
 * 合并之后是「见过两次」，不是四次。相加会把同一次旅行算两遍。
 */
export function mergePets(a: PetsMap, b: PetsMap): PetsMap {
  const out: Record<string, PetMemory> = { ...a };
  for (const [name, y] of Object.entries(b)) {
    const x = out[name];
    if (!x) { out[name] = y; continue; }
    const newer = (y.last || '') >= (x.last || '') ? y : x;
    out[name] = {
      times: Math.max(x.times, y.times),
      last: newer.last || x.last || y.last,
      // 印象有字才算数：一边写了、一边没写，就留写了的那句。
      impression: newer.impression || x.impression || y.impression,
    };
  }
  return out;
}

/** 一起走过一次。纯函数 —— 落盘交给调用方，因为 `save` 还要别的字段。 */
export function metPet(pets: PetsMap, name: string, dateKey: string): PetsMap {
  const key = String(name || '').trim().slice(0, 24);
  if (!key) return pets;
  const cur = pets[key];
  return {
    ...pets,
    [key]: {
      times: (cur?.times ?? 0) + 1,
      last: String(dateKey || '').slice(0, 10) || cur?.last || '',
      impression: cur?.impression ?? '',
    },
  };
}

/** 写一句对这个人的印象。空串 = 抹掉（她改主意了，不该被旧印象锁死）。 */
export function setPetImpression(pets: PetsMap, name: string, text: string): PetsMap {
  const key = String(name || '').trim().slice(0, 24);
  if (!key) return pets;
  const cur = pets[key] ?? { times: 0, last: '', impression: '' };
  return {
    ...pets,
    [key]: { ...cur, impression: String(text || '').trim().slice(0, 80) },
  };
}

/**
 * 把任意输入收成一张干净的口味表。
 *
 * 老文件里没有这一段（`undefined`）→ 返回空表；某一类被写成对象而不是数组 →
 * 这一类按空处理。**不抛异常**：一份口味表读坏了，不该让她的旅行起不来。
 */
export function normalizeTaste(raw: unknown): TasteMap {
  const out: Record<TasteKind, TasteItem[]> = { place: [], food: [], scenery: [] };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const kind of TASTE_KINDS) {
    const list = src[kind];
    if (!Array.isArray(list)) continue;
    for (const one of list) {
      if (!one || typeof one !== 'object') continue;
      const r = one as Partial<TasteItem>;
      const name = String(r.name ?? '').trim().slice(0, 24);
      if (!name) continue;
      if (out[kind].some((x) => x.name === name)) continue;
      out[kind].push({
        name,
        note: String(r.note ?? '').trim().slice(0, 60),
        at: typeof r.at === 'string' ? r.at.slice(0, 10) : '',
        like: r.like !== false,
        photo: typeof r.photo === 'string' ? r.photo.slice(0, 64) : '',
      });
    }
    out[kind] = out[kind].slice(-TASTE_CAP);
  }
  return out;
}

/**
 * 两份口味表合一份。
 *
 * 按名字去重，**谁的日子新听谁**：她在 A 机器上把「牦牛肉汤」标成喜欢、
 * 后来在 B 机器上改成不喜欢，合并之后应该是不喜欢 —— 反过来的话，
 * 她改了主意也白改，下次还会被推荐。
 *
 * 日期一样时（同一天两边各记一次）保留**有备注**的那条。
 */
export function mergeTaste(a: TasteMap, b: TasteMap): TasteMap {
  const out: Record<TasteKind, TasteItem[]> = { place: [], food: [], scenery: [] };
  for (const kind of TASTE_KINDS) {
    const merged: TasteItem[] = [];
    for (const it of [...(a[kind] ?? []), ...(b[kind] ?? [])]) {
      const i = merged.findIndex((x) => x.name === it.name);
      if (i < 0) { merged.push(it); continue; }
      const old = merged[i]!;
      const newer = it.at > old.at ? it : (it.at === old.at && it.note && !old.note ? it : old);
      merged[i] = {
        ...newer,
        note: newer.note || old.note || it.note,
        photo: newer.photo || old.photo || it.photo,
      };
    }
    out[kind] = merged.slice(-TASTE_CAP);
  }
  return out;
}

/**
 * 记一条口味。同名就改写 —— 她的口味会变，不该变成两条互相矛盾的记录。
 */
export function setTaste(
  taste: TasteMap,
  kind: TasteKind,
  name: string,
  note: string,
  like: boolean,
  dateKey: string,
  photo = '',
): TasteMap {
  const key = String(name || '').trim().slice(0, 24);
  if (!key) return taste;
  const list = [...(taste[kind] ?? [])];
  const i = list.findIndex((x) => x.name === key);
  const item: TasteItem = {
    name: key,
    note: String(note || '').trim().slice(0, 60) || (i >= 0 ? list[i]!.note : ''),
    at: String(dateKey || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    like: like !== false,
    // 新的一张优先；没给就沿用原来那张 —— 不能因为这次没拍就把记录清空。
    photo: String(photo || '').slice(0, 64) || (i >= 0 ? list[i]!.photo : ''),
  };
  if (i >= 0) list.splice(i, 1, item); else list.push(item);
  return { ...taste, [kind]: list.slice(-TASTE_CAP) };
}

/** 把口味表说成人话，给工具的回执用。空的那一类整行不出现。 */
export function tasteSummary(taste: TasteMap): string {
  const label: Record<TasteKind, string> = { place: '地方', food: '吃食', scenery: '景色' };
  const lines: string[] = [];
  for (const kind of TASTE_KINDS) {
    const list = taste[kind] ?? [];
    if (!list.length) continue;
    const yes = list.filter((x) => x.like).map((x) => (x.note ? `${x.name}（${x.note}）` : x.name));
    const no = list.filter((x) => !x.like).map((x) => x.name);
    const bits: string[] = [];
    if (yes.length) bits.push(`喜欢：${yes.join('、')}`);
    if (no.length) bits.push(`不喜欢：${no.join('、')}`);
    lines.push(`${label[kind]} —— ${bits.join('；')}`);
  }
  return lines.join('\n');
}

function parse(raw: string): TravelMemory | null {
  try {
    const j = JSON.parse(raw) as Partial<TravelMemory>;
    return {
      version: 1,
      everVisited: uniq(Array.isArray(j.everVisited) ? j.everVisited : []),
      wishes: uniq(Array.isArray(j.wishes) ? j.wishes : []),
      spent: Number.isFinite(Number(j.spent)) ? Math.max(0, Number(j.spent)) : 0,
      earned: Number.isFinite(Number(j.earned)) ? Math.max(0, Number(j.earned)) : 0,
      // 老文件没有这一段 —— `normalizePets` 收到 undefined 就返回空表，不报错。
      pets: normalizePets((j as Record<string, unknown>).pets),
      // 老文件没有这一段 —— `normalizeTaste` 收到 undefined 就返回空表。
      taste: normalizeTaste((j as Record<string, unknown>).taste),
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
    pets: mergePets(a.pets ?? {}, b.pets ?? {}),
    taste: mergeTaste(a.taste ?? emptyTaste(), b.taste ?? emptyTaste()),
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
      /*
       * 伙伴表没有传就沿用文件里原有的 —— `save` 是全量覆盖写，
       * 少带这一项就等于每次保存都把对别人的印象清空一次。
       */
      pets: normalizePets(fields.pets ?? this.read()?.pets ?? {}),
      // 同一条道理：口味没传就沿用文件里原有的，否则每次保存都清空一次。
      taste: normalizeTaste(fields.taste ?? this.read()?.taste ?? {}),
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
    const before = st.pets ?? {};
    const pets = mergePets(before, mem.pets ?? {});
    const tasteBefore = st.taste ?? emptyTaste();
    const taste = mergeTaste(tasteBefore, mem.taste ?? emptyTaste());
    const grew = everVisited.length !== st.everVisited.length
      || wishes.length !== st.wishes.length
      || spent !== st.spent
      || earned !== st.earned
      || Object.keys(pets).length !== Object.keys(before).length
      || TASTE_KINDS.some((k) => (taste[k]?.length ?? 0) !== (tasteBefore[k]?.length ?? 0));
    return { state: { ...st, everVisited, wishes, spent, earned, pets, taste }, grew };
  }
}
