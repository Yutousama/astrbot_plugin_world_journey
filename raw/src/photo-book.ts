/**
 * 照片簿 —— 她拍过哪些张，一张一行。
 *
 * ## 只记索引，不存字节
 *
 * 字节在宿主的媒体库里（`data/media/`，内容寻址、自动去重），这里只留句柄。
 * 分开的好处：同一张图被重复生成时，字节只有一份；而这个文件很小，读写随便。
 *
 * ## 和日记不是一类东西
 *
 * 日记跟着人走（同步盘），照片跟着机器走（本机媒体库）。原因写在 `state.ts` 顶部：
 * 同步盘里塞几百张 PNG，同步就废了。照片丢了还能再拍，日记丢了就真没了。
 *
 * ## 一天一张是按「当地日期 + 城市」判的
 *
 * 用真实日期会错：24x 下一天能跨好几个城市，按真实日期算，一天只能拍一张，
 * 之后所有城市都没有照片。所以用的是**她那里的日期**。
 */
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface PhotoRecord {
  /** 宿主给的附件句柄，形如 `log:ab12cd34.png`。UI 拿它换图。 */
  readonly handle: string;
  readonly cityId: string;
  readonly cityName: string;
  /** 当地日期 `YYYY-MM-DD`。 */
  readonly dateKey: string;
  /** 短标题，如「黄昏的麦积山」。 */
  readonly title: string;
  /** 具体地点，没有就是空串。 */
  readonly spot: string;
  /** 真实时刻（ISO）。排序用 —— 世界时间在高倍速下会跑到未来，不能当排序键。 */
  readonly at: string;
  /**
   * 生成这张用的提示词（2026-11-11，用户 TwoTwo：「AI 生成的照片有些不满意，
   * 能否加一个重新生成或者删除」）。
   *
   * 存下来只为一件件事：让他在相册页**看见它、改它、拿着改过的再去拍一张**。
   * 所以它原样存，不做归一化 —— 用户改的是这一整段话。
   *
   * **老记录没有这一格。** 那时候还不存，读出来是 undefined。别把它当损坏：
   * 前端见到空串就说明这张拍得早、没留下提示词。
   */
  readonly prompt?: string;
}

export class PhotoBook {
  private readonly file: string;
  private items: PhotoRecord[] = [];

  constructor(private readonly dir: string) {
    this.file = join(dir, 'photos.json');
    this.load();
  }

  list(): readonly PhotoRecord[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  /** 这一天、这个城市已经拍过了吗。 */
  has(dateKey: string, cityId: string): boolean {
    return this.items.some((p) => p.dateKey === dateKey && p.cityId === cityId);
  }

  add(rec: PhotoRecord): void {
    this.items = [rec, ...this.items];
    this.save();
  }

  /**
   * 从相册里拿掉一张（2026-11-11，用户 TwoTwo 来信：AI 生成的照片不满意，想要重生成或删除）。
   *
   * **只摘记录，不删媒体文件。** 三条理由：
   *
   * 1. 媒体是内容寻址的（`log:cf799f4c…`），同一张图可能被别的记录或别的会话引用；
   * 2. 已经生成的月报 HTML 里嵌的就是那张，删了字节那边就裂；
   * 3. 「不满意」是主观的，她替用户判断该不该真删，等于替人扔掉照片。
   *
   * 想彻底删就去媒体目录自己删 —— 面板只负责让它别碍眼。
   */
  remove(handle: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((p) => p.handle !== handle);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  /**
   * 把「这一天、这个城市」的旧记录摘掉，只留新拍的这一张。
   *
   * 用在手动补拍上：他点了「补一张」就是想要一张新的，不该被「一天一张」挡住。
   * 旧的媒体文件不删 —— 内容寻址，删了别人那条会话就断了。
   *
   * ## 为什么会出现「几张一模一样的」
   *
   * 原来的过滤条件是 `handle !== keepHandle`，意思是「留新的、删旧的」。
   * 但**同一张图被拍两次时，两个 handle 是一样的**，于是条件不成立，
   * 旧记录一条都删不掉，照片簿里就堆出 N 条相同记录。
   *
   * 2026-11-04 Mr.Q 撞上了：wf 里 seed 固定 → ComfyUI 命中执行缓存 →
   * 连点几下秒回同一张图 → 照片簿多了三条一模一样的。
   *
   * 现在改成「同城同日只留一条」：按 handle 认，保留最前面那条（`add` 是头插，
   * 最前面就是最新的），其余全删。这样不论新旧 handle 是否相同都收敛到一条。
   */
  replaceDay(dateKey: string, cityId: string, keepHandle: string): number {
    const before = this.items.length;
    let kept = false;
    this.items = this.items.filter((p) => {
      if (p.dateKey !== dateKey || p.cityId !== cityId) return true;
      if (p.handle === keepHandle && !kept) { kept = true; return true; }
      return false;
    });
    const removed = before - this.items.length;
    if (removed) this.save();
    return removed;
  }

  /**
   * 用新记录替换旧的那一张（重新生成用，2026-11-11）。
   *
   * 和 `remove` + `add` 的唯一区别：**位置不动**。
   * 重新生成拍的是同一张照片（同一个日期、同一座城），不该因为重拍一次就跳到相册最前面。
   * 找不到旧 handle（已经被 × 摘掉了）返回 false，让调用方决定怎么办。
   */
  update(handle: string, rec: PhotoRecord): boolean {
    const i = this.items.findIndex((p) => p.handle === handle);
    if (i < 0) return false;
    this.items[i] = rec;
    this.save();
    return true;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      // 去 BOM：PowerShell 的 `Set-Content -Encoding utf8` 会加，JSON.parse 当场抛。
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')) as unknown;
      const arr = Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items;
      if (!Array.isArray(arr)) return;
      this.items = arr
        .filter((x): x is PhotoRecord => {
          const r = x as Partial<PhotoRecord>;
          return typeof r?.handle === 'string' && typeof r?.dateKey === 'string'
            && typeof r?.cityId === 'string' && typeof r?.at === 'string';
        })
        .map((r) => ({
          handle: r.handle,
          cityId: r.cityId,
          cityName: typeof r.cityName === 'string' ? r.cityName : r.cityId,
          dateKey: r.dateKey,
          title: typeof r.title === 'string' ? r.title : '',
          spot: typeof r.spot === 'string' ? r.spot : '',
          at: r.at,
          /*
           * 提示词（2026-11-11）。这里是**白名单重建**，漏一个字段它就永远读不回来 ——
           * 第一版就是漏了这一行，面板上看得到、重开一次全没了。
           * 老记录没有这一格：留 undefined，不补空串（前端要能区分「没留下」和「被清空」）。
           */
          ...(typeof r.prompt === 'string' ? { prompt: r.prompt } : {}),
        }));
    } catch {
      // 坏了就当没有。照片簿丢一张索引，比让 World 起不来轻得多。
      this.items = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch { /* 写不进去不影响旅行，下一张再试 */ }
  }
}
