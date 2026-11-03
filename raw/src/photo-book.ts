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
   * 把「这一天、这个城市」的旧记录摘掉，只留新拍的这一张。
   *
   * 用在手动补拍上：他点了「补一张」就是想要一张新的，不该被「一天一张」挡住。
   * 旧的媒体文件不删 —— 内容寻址，删了别人那条会话就断了。
   */
  replaceDay(dateKey: string, cityId: string, keepHandle: string): number {
    const before = this.items.length;
    this.items = this.items.filter(
      (p) => !(p.dateKey === dateKey && p.cityId === cityId && p.handle !== keepHandle),
    );
    const removed = before - this.items.length;
    if (removed) this.save();
    return removed;
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
