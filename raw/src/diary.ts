/**
 * 旅行日记 —— **记忆**，允许跟着人走。
 *
 * **一个月一个文件**（`2026-11.md`），放用户指定的同步盘目录；没指定就跟着本机。
 * 每天在月文件里是一个条目：frontmatter + 正文，条目之间空一行，新的在最上面。
 *
 * ## 为什么按月（2026-11-02 由 Mr.Q 提出）
 *
 * 原来一天一篇。真实用下来，问题不是「存不下」，是**翻不动**：同步盘里一天多一个文件，
 * 一个月三十个，一年三百六十个；想回看「那段日子」，得先在几百个文件名里找日期。
 * 按月之后，粒度和人回看的习惯对上了 ——「上个月在哪儿」本来就是一个整月的事。
 *
 * **格式一个字没换。** 每条仍是原来那份 frontmatter + 正文，所以：
 *   - 旧的一天一篇照样读得懂（它就是一个只含一天的月文件）；
 *   - 在 OneDrive 里点开，看到的还是熟悉的 `---` 元信息 + 散文，不是 JSON。
 * 迁移是自动的：旧文件并进对应月份后挪进 `_bak/legacy/`，**不删**。
 *
 * ## 五条从音乐扩展那里继承来的教训（都踩过，不重复踩）
 *
 * 1. **探测可写必须真写一次。** `accessSync(W_OK)` 在网盘和移动硬盘上会骗你 ——
 *    权限位报得很乐观，真写才失败。所以写一个带 pid 的探针文件再删掉。
 * 2. **不搬迁，只合并读取。** 用户改目录时不搬旧文件（搬迁要处理"搬一半断电"的窗口），
 *    写入只写新目录，**读取永远把本机和新目录合起来按日期去重**。切过去切回来都不会重复。
 * 3. **冲突副本要认。** 两台机器同一个月各写过，网盘会生成 `2026-11-电脑名.md`。
 *    按精确文件名读，那些天就在盘上却永远读不到，还不报错。所以按**月份前缀**认，
 *    并且同一天出现在两份里时取**文件更新的那份**。
 * 4. **写失败要回落，而回落目录必须在读取集合里。** 否则数据"写进去了但看不见"。
 * 5. **`problem` 和 `notice` 分开。** "配了能用但目录是空的"是提示，
 *    "配了但用不了"是错误 —— 共用一个字段，用户要么忽略真错误，要么被正常状态烦到。
 */
import {
  mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { cityById } from './geo/cities.ts';

export interface DiaryEntry {
  readonly dateKey: string;
  readonly cityId: string;
  readonly cityName: string;
  /** 当天天气。拿不到就留空，别写「未知」进正文。 */
  readonly weather?: string;
  readonly lodging?: string;
  /** 她写的正文。这里只管存，不管写什么。 */
  readonly body: string;
}

/** `2026-11-01.md` 与 `2026-11-01-笔记本.md`：一天一篇的老格式。 */
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})(?:[-_ ].*)?\.md$/;

/** `2026-11.md` 与 `2026-11-笔记本.md`：月文件。第三段必须以非数字开头，否则那是日文件。 */
const MONTH_FILE = /^(\d{4}-\d{2})(?:[-_ ][^\d].*)?\.md$/;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 一天一条的起点：`---` + 含 date 的 yaml + `---`。正文里单独出现的 `---` 靠 date 校验滤掉。 */
const ENTRY_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/gm;

/** 放在 `dir` 里的月份标题。旧文件挪走后也靠它区分「这是月文件」。 */
const monthTitle = (monthKey: string): string => {
  const [y, m] = monthKey.split('-');
  return `# ${y} 年 ${Number(m)} 月 · 旅行日记\n`;
};

function kvs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function frontmatter(e: DiaryEntry): string {
  const lines = [
    '---',
    `date: ${e.dateKey}`,
    `city: ${e.cityName}`,
    `cityId: ${e.cityId}`,
  ];
  if (e.weather) lines.push(`weather: ${e.weather}`);
  if (e.lodging) lines.push(`lodging: ${e.lodging}`);
  lines.push('---', '');
  return lines.join('\n');
}

/** 条目 → 文件里的一段。和原来单天文件一模一样，一个字都没变。 */
function renderEntry(e: DiaryEntry): string {
  return `${frontmatter(e)}${e.body.trim()}\n`;
}

function entryOf(meta: Record<string, string>, body: string, dateKey: string): DiaryEntry {
  const cityId = meta.cityId ?? '';
  return {
    dateKey,
    cityId,
    cityName: meta.city ?? cityById(cityId)?.name ?? '不知道在哪',
    weather: meta.weather || undefined,
    lodging: meta.lodging || undefined,
    body: body.trim(),
  };
}

/**
 * 把一个文件解析成若干天。
 *
 * 同一份解析器吃两种文件：月文件（多个条目）和旧的一天一篇（一个条目）。
 * 这不是偷懒 —— 迁移和回读用的是同一条路，就少了一半出错的机会。
 */
export function parseDiaryFile(text: string): DiaryEntry[] {
  const hits: { start: number; end: number; meta: Record<string, string>; date: string }[] = [];
  ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(text))) {
    const meta = kvs(m[1]);
    if (!DATE_KEY.test(meta.date ?? '')) {
      // 正文里的分隔线：形状像元信息但里面没有 date。从下一行接着找，别跳过真条目。
      ENTRY_RE.lastIndex = m.index + 1;
      continue;
    }
    hits.push({ start: m.index, end: m.index + m[0].length, meta, date: meta.date });
  }
  return hits.map((h, i) => {
    const stop = i + 1 < hits.length ? hits[i + 1].start : text.length;
    return entryOf(h.meta, text.slice(h.end, stop), h.date);
  });
}

export interface DiaryHealth {
  /** 实际在写的目录。 */
  readonly dir: string;
  /** 能不能写。false 时 `dir` 是本机兜底。 */
  readonly ok: boolean;
  /** 配了但用不了 —— 这是错误，要让她说出来。 */
  readonly problem: string | null;
  /** 能用但值得提一句。 */
  readonly notice: string | null;
}

interface MonthFiles {
  /** 标准那份 `2026-11.md`（可能不存在）。 */
  main: string | null;
  /** 全部副本，按 mtime 从新到旧。 */
  all: { path: string; mtime: number }[];
}

export class DiaryStore {
  private readonly local: string;
  private dir = '';
  private health: DiaryHealth;
  /** 目录快照指纹 → 合并后的全部条目。文件一改指纹就变，缓存自然失效。 */
  private cacheKey = '';
  private cache = new Map<string, DiaryEntry>();

  constructor(dataDir: string) {
    this.local = join(dataDir, 'diary');
    this.dir = this.local;
    this.health = { dir: this.local, ok: true, problem: null, notice: null };
  }

  /** 配置的目录变了就重新探测。挂在巡检里调用即可，一次 mkdir 的代价。 */
  configure(memoryDir: string): DiaryHealth {
    const want = memoryDir.trim();
    if (!want) {
      this.dir = this.local;
      this.health = { dir: this.local, ok: true, problem: null, notice: null };
      this.ensure(this.local);
      this.migrate(this.local);
      return this.health;
    }
    if (want === this.dir) {
      this.migrate(this.dir);
      return this.health;
    }

    const probe = this.probeWritable(want);
    if (probe) {
      this.dir = this.local;
      this.ensure(this.local);
      this.migrate(this.local);
      this.health = {
        dir: this.local,
        ok: false,
        problem: `日记目录用不了（${probe}），先存本机了：${want}`,
        notice: null,
      };
      return this.health;
    }
    this.dir = want;
    mkdirSync(join(want, ''), { recursive: true });
    this.migrate(want);
    const empty = this.count() === 0;
    this.health = {
      dir: want,
      ok: true,
      problem: null,
      notice: empty ? `日记目录已切到这个位置，还没写过东西：${want}` : null,
    };
    return this.health;
  }

  get current(): DiaryHealth {
    return this.health;
  }

  /** null = 能写；否则是原因。真写一个探针文件，不用权限位。 */
  private probeWritable(dir: string): string | null {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, `.probe-${process.pid}.tmp`);
      writeFileSync(probe, 'ok', 'utf8');
      rmSync(probe, { force: true });
      return null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return '路径不存在，或者盘没连上';
      if (code === 'EACCES' || code === 'EPERM') return '没有写入权限';
      if (code === 'ENOSPC') return '磁盘满了';
      return e instanceof Error ? e.message : String(e);
    }
  }

  private ensure(dir: string): void {
    try { mkdirSync(dir, { recursive: true }); } catch { /* 连本机都建不了，那也没办法 */ }
  }

  /** 目录里一个月对应的全部文件。同一个月的冲突副本也收进来。 */
  private months(dir: string): Map<string, MonthFiles> {
    const out = new Map<string, MonthFiles>();
    let names: string[];
    try { names = readdirSync(dir); } catch { return out; }
    for (const name of names) {
      const m = MONTH_FILE.exec(name);
      if (!m) continue;
      const path = join(dir, name);
      let mtime = 0;
      try { mtime = statSync(path).mtimeMs; } catch { continue; }
      const cur = out.get(m[1]) ?? { main: null, all: [] };
      cur.all.push({ path, mtime });
      if (name === `${m[1]}.md`) cur.main = path;
      out.set(m[1], cur);
    }
    for (const v of out.values()) v.all.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  /** 一次把所有文件连同 mtime、size 拍成指纹，用来判断缓存还能不能用。 */
  private fingerprint(dir: string): string {
    let names: string[];
    try { names = readdirSync(dir); } catch { return ''; }
    const bits: string[] = [];
    for (const name of names.sort()) {
      if (!MONTH_FILE.test(name) && !DAY_FILE.test(name)) continue;
      try {
        const st = statSync(join(dir, name));
        bits.push(`${name}:${st.mtimeMs}:${st.size}`);
      } catch { /* 刚好被删了 */ }
    }
    return bits.join('|');
  }

  /**
   * 读集合：新目录优先，其次本机；同一天出现在两份里时取**文件更新的**那份。
   *
   * 为什么按文件 mtime 而不是"配置的目录优先"：两台机器都在往同一个同步盘写时，
   * 后写的那份才是真的；配置目录只是"这台机器默认往哪写"，不代表内容更新。
   */
  private allEntries(): Map<string, DiaryEntry> {
    const key = `${this.fingerprint(this.dir)}#${this.fingerprint(this.local)}`;
    if (key === this.cacheKey) return this.cache;

    const merged = new Map<string, DiaryEntry>();
    const stamps = new Map<string, number>();
    for (const dir of this.dir === this.local ? [this.local] : [this.dir, this.local]) {
      const months = this.months(dir);
      for (const [, files] of months) {
        for (const f of files.all) {       // 已经是新到旧
          let entries: DiaryEntry[];
          try { entries = parseDiaryFile(readFileSync(f.path, 'utf8')); } catch { continue; }
          for (const e of entries) {
            const seen = stamps.get(e.dateKey) ?? -1;
            if (f.mtime <= seen) continue;
            merged.set(e.dateKey, e);
            stamps.set(e.dateKey, f.mtime);
          }
        }
      }
      // 旧的一天一篇：还没迁移完的目录也得能读
      for (const name of this.safeNames(dir)) {
        if (!DAY_FILE.test(name)) continue;
        const path = join(dir, name);
        let mtime = 0;
        try { mtime = statSync(path).mtimeMs; } catch { continue; }
        let entries: DiaryEntry[];
        try { entries = parseDiaryFile(readFileSync(path, 'utf8')); } catch { continue; }
        for (const e of entries) {
          const seen = stamps.get(e.dateKey) ?? -1;
          if (mtime <= seen) continue;
          merged.set(e.dateKey, e);
          stamps.set(e.dateKey, mtime);
        }
      }
    }
    this.cacheKey = key;
    this.cache = merged;
    return merged;
  }

  private safeNames(dir: string): string[] {
    try { return readdirSync(dir); } catch { return []; }
  }

  /**
   * 把旧的一天一篇并进月文件，然后把旧文件挪进 `_bak/legacy/`。永不删。
   *
   * **每次 configure 都扫一遍，不记「已经扫过」。**
   * 2026-11-02 自查改的：一开始用 Set 挡了重复扫描，想着省一次 readdir。
   * 问题是另一台机器还装着旧版时，它会继续往同一个同步盘里写 `2026-11-02.md` ——
   * 这边已经被挡过，那些天就永远只是「读得到但不并进月文件」，
   * 用户看到的是「怎么还有一天一个的文件冒出来」。
   * readdir 一次而已，30 分钟一回，省这点没有意义。
   */
  private migrate(dir: string): void {
    const days = this.safeNames(dir).filter((n) => DAY_FILE.test(n));
    if (!days.length) return;

    const byMonth = new Map<string, DiaryEntry[]>();
    for (const name of days) {
      const path = join(dir, name);
      let entries: DiaryEntry[];
      try { entries = parseDiaryFile(readFileSync(path, 'utf8')); } catch { continue; }
      for (const e of entries) {
        const monthKey = e.dateKey.slice(0, 7);
        const list = byMonth.get(monthKey) ?? [];
        list.push(e);
        byMonth.set(monthKey, list);
      }
    }

    for (const [monthKey, entries] of byMonth) {
      const file = join(dir, `${monthKey}.md`);
      const cur = this.readMonthFile(file);
      // 这个月读不出来就别迁：挪走旧文件的同时写不进去，等于把那天扔掉。
      if (!cur.ok) continue;
      const have = cur.days;
      for (const e of entries) if (!have.has(e.dateKey)) have.set(e.dateKey, e);
      if (this.writeMonthFile(file, monthKey, have)) this.archiveLegacy(dir, monthKey);
    }
  }

  private archiveLegacy(dir: string, monthKey: string): void {
    const bak = join(dir, '_bak', 'legacy');
    try { mkdirSync(bak, { recursive: true }); } catch { return; }
    for (const name of this.safeNames(dir)) {
      if (!DAY_FILE.test(name)) continue;
      if (!name.startsWith(monthKey)) continue;   // 只挪这个月的，别越界
      try { renameSync(join(dir, name), join(bak, name)); } catch { /* 挪不动就留着，不影响读 */ }
    }
  }

  /**
   * 读一个月的文件。三种结果必须分开，混成一种就会丢整月。
   *
   * `ok: false` 是**文件在、但这一下读不出来**（被同步盘锁住、权限、IO 错）。
   * 2026-11-02 自查抓到的洞：原来 catch 直接返回空 Map，调用方分不清
   * 「这个月还没写」和「这个月读不了」，于是拿空 Map 加上今天这一条整份重写 ——
   * **整月日记被今天的几百字覆盖**。日记在同步盘上是唯一副本，这个洞必须堵。
   */
  private readMonthFile(file: string): { days: Map<string, DiaryEntry>; ok: boolean; raw: string } {
    let raw = '';
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      return { days: new Map(), ok: code === 'ENOENT', raw: '' };
    }
    const days = new Map<string, DiaryEntry>();
    for (const e of parseDiaryFile(raw)) days.set(e.dateKey, e);
    return { days, ok: true, raw };
  }

  /** 整份重写一个月的文件。失败返回 false，由调用方决定回落。 */
  private writeMonthFile(file: string, monthKey: string, days: Map<string, DiaryEntry>): boolean {
    const sorted = [...days.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)); // 新的在上
    const text = `${monthTitle(monthKey)}\n${sorted.map(renderEntry).join('\n')}`;
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, file);
      return true;
    } catch {
      return false;
    }
  }

  /** 写一天的日记。同一天重复写 = 覆盖（她可能改口）。 */
  write(entry: DiaryEntry): { path: string; problem: string | null } {
    const monthKey = entry.dateKey.slice(0, 7);
    const targets = [this.dir];
    if (this.dir !== this.local) targets.push(this.local);
    let lastErr: string | null = null;
    for (const dir of targets) {
      try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${monthKey}.md`);
        const cur = this.readMonthFile(file);
        // 文件在、这一下读不出来：宁可这一次不写，也不能拿今天一条盖掉整月。
        if (!cur.ok) throw new Error('这个月的文件读不出来，先不覆盖');
        /*
         * 有内容却一条都解析不出来：不是「这个月还是空的」，是格式不认识或者文件坏了。
         * 先整份挪进 `_bak` 留底，再往下写 —— 覆盖前留一手，事后还能捞。
         */
        const days = cur.days;
        if (cur.raw.trim() && days.size === 0) {
          const bakDir = join(dir, '_bak');
          mkdirSync(bakDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(join(bakDir, `${monthKey}-unreadable-${stamp}.md`), cur.raw, 'utf8');
        }

        // 同一天再写 = 覆盖（她可能改口），这在正常旅行里是对的。
        // 但**世界时间回退**时（把倍速调回 1x 会自动对齐真实时间），
        // 同一天会被写第二次，而内容完全是另一个地方的事。
        // 那种情况不能覆盖 —— 先把它单独存进 `_bak/`，文件名带时间戳。
        const old = days.get(entry.dateKey);
        const next = renderEntry(entry);
        if (old && renderEntry(old).trim() !== next.trim()) {
          const bakDir = join(dir, '_bak');
          mkdirSync(bakDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(join(bakDir, `${entry.dateKey}-${stamp}.md`), renderEntry(old), 'utf8');
        }

        days.set(entry.dateKey, entry);
        if (!this.writeMonthFile(file, monthKey, days)) throw new Error('月文件写不进去');
        this.cacheKey = '';   // 让下一次读重新捏一份
        return { path: file, problem: dir === this.dir ? null : `日记没写进配置的目录，存到本机了：${lastErr ?? ''}` };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return { path: '', problem: `日记写不进去：${lastErr ?? '原因不明'}` };
  }

  read(dateKey: string): DiaryEntry | null {
    return this.allEntries().get(dateKey) ?? null;
  }

  /** 最近 n 天的日记，旧的在前。 */
  recent(n: number): DiaryEntry[] {
    const dates = [...this.allEntries().keys()].sort().slice(-Math.max(1, n));
    return dates.map((d) => this.read(d)).filter((x): x is DiaryEntry => !!x);
  }

  /** 一共写过多少天。她「走了多久」的实感靠这个数，不靠内存。 */
  count(): number {
    return this.allEntries().size;
  }

  /**
   * 某个月的全部日记，旧的在前。
   *
   * 2026-11-02 加：`journey_diary_read` 的「最近 N 天」上限是 60（上下文保护），
   * 但日记会攒到几百天 —— 她问「去年秋天那会儿你在哪」时，那 60 天窗口里根本没有。
   * 所以给一个按月的入口：先列出这个月有哪几天、每天一句摘要，要细看再按天取。
   */
  month(monthKey: string): DiaryEntry[] {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(monthKey)) return [];
    return [...this.allEntries().values()]
      .filter((e) => e.dateKey.startsWith(monthKey))
      .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  }

  /** 最近去过哪些城市（按日记倒序去重）。用来在没配置出发地时兜底。 */
  recentCities(limit = 12): string[] {
    const seen: string[] = [];
    for (const e of this.recent(120).reverse()) {
      if (e.cityId && !seen.includes(e.cityId)) seen.push(e.cityId);
      if (seen.length >= limit) break;
    }
    return seen;
  }
}
