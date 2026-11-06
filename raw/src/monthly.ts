import { featureOf } from './geo/cities.ts';

/**
 * 月度报告 —— 把一个月里她拍的照片和写的日记，拼成一张可以看的页面。
 *
 * ## 为什么是 HTML 而不是一段话
 *
 * 需求原话：「用每天她拍的照片和日记重组写一篇 HTML 格式的可视化报告」。
 * 照片是这份东西的主体，纯文本装不下它。
 *
 * ## 为什么按月换风格
 *
 * Mr.Q：「按照不同月份有不同的艺术风格」。所以 `themeOf(month)` 给十二套
 * 底色 / 主色 / 字体，而不是一套模板换张图 —— 三月和十二月长得一样，
 * 那就只是一份月报，不是「这个月的月报」。
 *
 * ## 图片走相对路径，不内联
 *
 * 宿主媒体库里的 PNG 单张两三兆，三十张 base64 进 HTML 就是九十兆，
 * 浏览器打开会卡死。报告存在 `dataDir/reports/`，图片在 `dataDir/media/`，
 * 同级的 `../media/` 就够 —— 用本地浏览器打开时相对路径是通的。
 *
 * ## 这里不估算
 *
 * 只写能数出来的数：几天、几座城、几张照片、几篇日记。
 * **不写「一共走了多少公里」** —— 那要从行程流水里累加，而现在没有按月存的流水，
 * 硬凑一个数就是编。
 */

export interface MonthlyPhoto {
  readonly dateKey: string;
  readonly cityName: string;
  readonly title: string;
  /** 宿主给的句柄，形如 `log:ab12cd34.png`。 */
  readonly handle: string;
  /** 具体地点（「中查沟」）。封面上的大字要用它，没有就退回城市名。 */
  readonly spot?: string;
  /** 城市 id。用来认出路上的那张（`road` 不是地方）。 */
  readonly cityId?: string;
}

/** 一张封面的元信息。图片文件已经落盘，这里只管排版。 */
export interface MonthlyPoster {
  readonly dateKey: string;
  readonly cityName: string;
  readonly spot: string;
  /** 相对报告文件的路径，形如 `posters/2026-11/2026-11-04-jiuzhaigou.png`。 */
  readonly file: string;
  /** 她自己那天写下的一句，排在海报右下角当手写批注。 */
  readonly line?: string;
}

export interface MonthlyEntry {
  readonly dateKey: string;
  readonly cityName: string;
  readonly body: string;
}

export interface MonthlyInput {
  /** `2026-11`。 */
  readonly monthKey: string;
  readonly photos: readonly MonthlyPhoto[];
  readonly entries: readonly MonthlyEntry[];
  /** 报告标题下面那行小字，通常是她现在在哪儿。 */
  readonly nowLine?: string;
  /** 图片相对前缀，默认 `../media/`。 */
  readonly mediaPrefix?: string;
  /** 按月生成的封面（配了生图接口才有）。没有就只排真照片。 */
  readonly posters?: readonly MonthlyPoster[];
  /**
   * `notebook`（默认）= 图片日记：线圈本、真照片、她那天写的第一句。
   * `poster` = 只有海报封面 + 照片墙那一版。
   *
   * 2026-11-05 Mr.Q：「你去小红书上搜图片日记，我感觉这种风格是更适合我们的」。
   * 对的地方在于它**不换掉照片** —— 小红书那套 plog 的做法是照片原样、白色细线描边、
   * 小字碎念，照片还是那天的照片。海报那条路做不到这点（文生图，画的是「按描述画的」）。
   */
  readonly layout?: 'notebook' | 'poster';
}

/** 一套配色。十二月各不一样，但都保持「纸 + 墨 + 一个强调色」这三件。 */
export interface Theme {
  readonly name: string;
  readonly bg: string;
  readonly paper: string;
  readonly ink: string;
  readonly soft: string;
  readonly accent: string;
  /** 标题用衬线还是黑体。冷天的月份给衬线，夏天的给黑体。 */
  readonly serif: boolean;
}

const THEMES: Record<number, Theme> = {
  1: { name: '雪夜', bg: '#eef1f5', paper: '#fbfcfe', ink: '#1c2430', soft: '#7c8797', accent: '#3d6a9a', serif: true },
  2: { name: '灯红', bg: '#f6ece8', paper: '#fff8f5', ink: '#2a1a16', soft: '#8d6a5c', accent: '#a3342b', serif: true },
  3: { name: '樱白', bg: '#fbf1f2', paper: '#fffafb', ink: '#2c2224', soft: '#8d7378', accent: '#c2546b', serif: true },
  4: { name: '新绿', bg: '#f1f6ee', paper: '#fbfdf8', ink: '#1f2a1c', soft: '#6f8266', accent: '#4f8a3d', serif: false },
  5: { name: '青苗', bg: '#eef5f2', paper: '#fafffd', ink: '#1b2a26', soft: '#688076', accent: '#2f7f66', serif: false },
  6: { name: '梅雨', bg: '#eef2f5', paper: '#fafcfd', ink: '#1d2731', soft: '#6b7c8a', accent: '#3f6f96', serif: true },
  7: { name: '烈阳', bg: '#fdf2e4', paper: '#fffaf1', ink: '#2b1f12', soft: '#8f7452', accent: '#c26a1e', serif: false },
  8: { name: '长夜', bg: '#1d2230', paper: '#252b3c', ink: '#eef1f7', soft: '#98a2b8', accent: '#d8a944', serif: false },
  9: { name: '谷黄', bg: '#f8f3e6', paper: '#fffdf5', ink: '#2a2417', soft: '#8a7c5c', accent: '#a8811f', serif: true },
  10: { name: '枫褐', bg: '#f7eee8', paper: '#fffaf6', ink: '#2b1e17', soft: '#8d6f5e', accent: '#a9502a', serif: true },
  11: { name: '初冬', bg: '#eef1ef', paper: '#fafbfa', ink: '#20261f', soft: '#6f7a6e', accent: '#4a6b5a', serif: true },
  12: { name: '雪蓝', bg: '#eaeff6', paper: '#f9fbfe', ink: '#1a2230', soft: '#72808f', accent: '#31537d', serif: true },
};

export function themeOf(monthKey: string): Theme {
  const m = Number(String(monthKey).slice(5, 7));
  return THEMES[m] ?? THEMES[1];
}

const esc = (s: string): string => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
));

/** `log:ab12.png` → `ab12.png`。文件句柄和媒体库文件名只差这个前缀。 */
export function mediaFile(handle: string): string {
  return String(handle ?? '').replace(/^log:/, '');
}

/** 城市按出现次数排，用来做「这个月走过的地方」。 */
export function citiesOfMonth(photos: readonly MonthlyPhoto[], entries: readonly MonthlyEntry[]): { name: string; days: number }[] {
  const seen = new Map<string, Set<string>>();
  const eat = (city: string, dateKey: string): void => {
    const c = String(city || '').trim();
    if (!c) return;
    if (!seen.has(c)) seen.set(c, new Set());
    seen.get(c)!.add(dateKey);
  };
  for (const p of photos) eat(p.cityName, p.dateKey);
  for (const e of entries) eat(e.cityName, e.dateKey);
  return [...seen.entries()]
    .map(([name, days]) => ({ name, days: days.size }))
    .sort((a, b) => b.days - a.days);
}

/** 日记太长会把这页压垮。取前若干字，最后一句尽量切在句号上。 */
export function excerpt(body: string, max = 120): string {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut}…`);
}

/**
 * 只取第一句。图片日记上的注脚就该是一句话 —— 多了就变成正文，
 * 而正文在下面另有一节。
 */
export function firstSentence(body: string, max = 46): string {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const stop = t.search(/[。！？!?…]/);
  const one = stop >= 0 ? t.slice(0, stop + 1) : t;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * 取前两句（最多 max 字）。
 *
 * 2026-11-05 Mr.Q 在图上圈了左边一大块空白：「太空了」。
 * 一天只取一句的时候，短日记撑不满那一列 —— 取两句既填了位置，
 * 又还是她自己的原话，不用编。
 */
export function firstSentences(body: string, max = 150): string {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = t.split(/(?<=[。！？!?…])/u).map((x) => x.trim()).filter(Boolean);
  let out = '';
  for (const one of parts) {
    if (out && (out + one).length > max) break;
    out += one;
    if (out.length >= max * 0.7) break;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** 把一段日记切成句子。便签要挑一句没被正文用过的，得先有得挑。 */
export function sentences(body: string): string[] {
  return String(body || '')
    .split(/(?<=[。！？!?…])/u)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length >= 4)
    .map((x) => (x.length > 40 ? `${x.slice(0, 39)}…` : x));
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

export function monthTitle(monthKey: string): string {
  const m = Number(String(monthKey).slice(5, 7));
  return `${CN_NUM[m - 1] ?? m}月`;
}

/**
 * 生成整页 HTML。
 *
 * 纯函数：给什么数据画什么，不读文件、不算路程、不联网。
 * 想改版式只改这里，`world.ts` 那边只管把数据凑齐。
 */
export function monthlyReport(input: MonthlyInput): string {
  const layout = input.layout ?? 'notebook';
  // 图片日记那一版是完全不同的一页纸（线圈本），单独一套模板。
  if (layout === 'notebook') return notebookHtml(input);

  const theme = themeOf(input.monthKey);
  const prefix = input.mediaPrefix ?? '../media/';
  const title = monthTitle(input.monthKey);
  const year = String(input.monthKey).slice(0, 4);

  // 照片按日期排，同一天多张时保持原有先后（PhotoBook 是头插，先反转回时间序）。
  const photos = [...input.photos].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const entries = [...input.entries].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const cities = citiesOfMonth(photos, entries);
  const days = new Set([...photos.map((p) => p.dateKey), ...entries.map((e) => e.dateKey)]).size;

  const stats = [
    { k: '在路上', v: `${days}`, u: '天' },
    { k: '走过', v: `${cities.length}`, u: '座城' },
    { k: '拍下', v: `${photos.length}`, u: '张' },
    { k: '写下', v: `${entries.length}`, u: '篇' },
  ];

  const cityLine = cities.slice(0, 6).map((c) => c.name).join(' · ');
  const quote = entries.length ? excerpt(entries[Math.floor(entries.length / 2)]!.body, 64) : '';

  const photoCards = photos.map((p) => `
      <figure class="ph">
        <img src="${esc(prefix + mediaFile(p.handle))}" alt="${esc(p.title)}" loading="lazy">
        <figcaption><span class="d">${esc(p.dateKey.slice(5))}</span>${esc(p.title)}</figcaption>
      </figure>`).join('');

  const posters = input.posters ?? [];
  /*
   * 文字是**叠在图上**的，不是让模型画的。
   *
   * 底图那块空地是提示词点名留出来的（右上三分之一）。字号按字数的多少算：
   * 三个字放开写，五个字就收窄 —— 手账上的地名是「一行写得下」才好看，
   * 让它换行比让它缩小更糟。
   */
  const posterCards = posters.map((p, i) => {
    const chars = [...p.spot].length || 1;
    const size = Math.min(12, 42 / chars).toFixed(1);
    return `
      <figure class="cover">
        <img src="${esc(p.file)}" alt="${esc(p.spot)}" loading="lazy">
        <div class="ov">
          <p class="place" style="font-size:${size}cqw">${esc(p.spot)}</p>
          <p class="sub">${esc(p.cityName)}</p>
          <p class="sub">${esc(dateStamp(p.dateKey))}</p>
          <p class="sub">第 ${i + 1} 页</p>
          ${p.line ? `<p class="hand">${esc(p.line)}</p>` : ''}
        </div>
        <figcaption><span class="d">${esc(p.dateKey.slice(5))}</span>${esc(p.cityName)} · ${esc(p.spot)}</figcaption>
      </figure>`;
  }).join('');

  const entryCards = entries.map((e) => `
      <article class="en">
        <p class="meta"><span class="d">${esc(e.dateKey.slice(5))}</span>${esc(e.cityName)}</p>
        <p class="body">${esc(excerpt(e.body, 200))}</p>
      </article>`).join('');

  /*
   * 图片日记：一张照片配一句那天自己写下的话。
   *
   * 小红书上叫 plog（photo + log）。它的关键**不是装饰，是照片不动** ——
   * 原片、原光线、原构图，文字是一层薄薄的手写注脚。所以这里不给照片加滤镜、
   * 不裁成统一比例，只给它一张纸、一行日期、一句原话。
   * 那天没写日记就只写日期 —— 宁可不说话，也别替她补一句。
   */
  const lineByDay = new Map<string, string>();
  for (const e of entries) {
    if (!lineByDay.has(e.dateKey)) lineByDay.set(e.dateKey, firstSentence(e.body, 46));
  }
  const plogCards = photos.map((p, i) => {
    const line = lineByDay.get(p.dateKey) || '';
    return `
      <figure class="plog${i % 2 ? ' tilt' : ''}">
        <img src="${esc(prefix + mediaFile(p.handle))}" alt="${esc(p.title)}" loading="lazy">
        <figcaption>
          <span class="stamp">${esc(p.dateKey.slice(5).replace('-', '.'))}</span>
          <span class="where">${esc(p.cityName)}</span>
          ${line ? `<span class="say">${esc(line)}</span>` : ''}
        </figcaption>
      </figure>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(year)} 年${esc(title)} · 旅行月报</title>
<style>
  :root {
    --bg: ${theme.bg};
    --paper: ${theme.paper};
    --ink: ${theme.ink};
    --soft: ${theme.soft};
    --accent: ${theme.accent};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
  body {
    font: 16px/1.75 ${theme.serif
      ? '"Songti SC", "SimSun", "Noto Serif SC", Georgia, serif'
      : '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'};
    padding: 32px 16px 64px;
  }
  .sheet { max-width: 880px; margin: 0 auto; background: var(--paper); padding: 48px 44px 56px; border-radius: 4px; }

  header { border-bottom: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); padding-bottom: 26px; margin-bottom: 30px; }
  .kicker { font-size: 12px; letter-spacing: .28em; color: var(--soft); text-transform: uppercase; margin: 0 0 10px; }
  h1 { margin: 0; font-size: 52px; line-height: 1.05; font-weight: 600; letter-spacing: .04em; }
  h1 small { display: block; font-size: 15px; font-weight: 400; color: var(--soft); letter-spacing: .12em; margin-top: 12px; }
  .now { margin: 14px 0 0; font-size: 13px; color: var(--soft); }

  .quote { margin: 0 0 34px; padding: 18px 22px; border-left: 3px solid var(--accent);
           font-size: 17px; line-height: 1.9; background: color-mix(in srgb, var(--accent) 6%, transparent); }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: color-mix(in srgb, var(--ink) 12%, transparent);
           border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); margin: 0 0 34px; }
  .stat { background: var(--paper); padding: 16px 12px; text-align: center; }
  .stat .k { font-size: 12px; color: var(--soft); letter-spacing: .16em; margin: 0 0 6px; }
  .stat .v { font-size: 30px; line-height: 1.1; font-weight: 600; }
  .stat .u { font-size: 12px; color: var(--soft); margin-left: 3px; font-weight: 400; }

  h2 { font-size: 13px; letter-spacing: .22em; color: var(--soft); margin: 44px 0 18px;
       padding-bottom: 8px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
  .ph { margin: 0; background: color-mix(in srgb, var(--ink) 4%, transparent); border-radius: 3px; overflow: hidden; }
  .ph img { display: block; width: 100%; height: auto; }
  .ph figcaption { font-size: 12.5px; color: var(--soft); padding: 8px 10px 10px; line-height: 1.5; }
  .ph .d { color: var(--accent); margin-right: 8px; font-variant-numeric: tabular-nums; }

  /* 封面：一个地方一张。竖版 3:4，两列排，窄屏一列。 */
  .covers { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 16px; }
  .cover { margin: 0; background: color-mix(in srgb, var(--ink) 5%, transparent); border-radius: 3px; overflow: hidden;
           position: relative; container-type: inline-size; }
  .cover img { display: block; width: 100%; height: auto; }
  /* 叠字的位置照着提示词留的那块空地：右上、宽四成。颜色固定成旧墨褐 ——
     海报底子永远是暖白纸，跟着主题换色反而会在八月那套深色主题里变成看不见的浅字。 */
  .cover .ov { position: absolute; top: 5.5%; right: 6%; width: 40%; text-align: right; color: #4a3524; }
  .cover .ov p { margin: 0; line-height: 1.5; }
  .cover .place { font-family: "Kaiti SC", "KaiTi", "STKaiti", "Songti SC", serif; font-weight: 600;
                  font-size: 34px; font-size: 11cqw; letter-spacing: .02em; }
  .cover .sub { font-size: 13px; font-size: 4.2cqw; letter-spacing: .06em; opacity: .82; }
  .cover .hand { margin-top: .5em !important; font-size: 12px; font-size: 3.7cqw; font-family: "Kaiti SC", "KaiTi", serif;
                 opacity: .72; line-height: 1.6; }
  .cover figcaption { font-size: 12.5px; color: var(--soft); padding: 8px 10px 10px; line-height: 1.5; }
  .cover .d { color: var(--accent); margin-right: 8px; font-variant-numeric: tabular-nums; }
  .note { font-size: 12px; color: var(--soft); margin: 10px 0 0; line-height: 1.7; }

  .entries { display: grid; gap: 18px; }
  .en { padding-left: 16px; border-left: 2px solid color-mix(in srgb, var(--ink) 10%, transparent); }
  .en .meta { margin: 0 0 5px; font-size: 12.5px; color: var(--soft); letter-spacing: .08em; }
  .en .meta .d { color: var(--accent); margin-right: 8px; font-variant-numeric: tabular-nums; }
  .en .body { margin: 0; font-size: 15.5px; line-height: 1.9; }

  /* 卡片式图片日记。2026-11-05 起默认不用它了（改成线圈本 notebookHtml），
     留着是因为 poster 那条路要用到 .grid 之外的一档排法时它是现成的。 */
  .plogs { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 26px 22px; }
  .plog { margin: 0; background: color-mix(in srgb, var(--paper) 88%, #fff);
          padding: 12px 12px 14px; border-radius: 2px; box-shadow: 0 2px 10px rgb(0 0 0 / 8%);
          transform: rotate(0deg); }
  .plog.tilt { transform: rotate(-.7deg); }
  .plog img { display: block; width: 100%; height: auto; border-radius: 1px; }
  .plog figcaption { display: block; padding: 10px 2px 0; }
  .plog .stamp { font: 600 11px/1 ui-monospace, "SFMono-Regular", monospace; letter-spacing: .16em;
                 color: var(--accent); }
  .plog .where { font-size: 11px; color: var(--soft); letter-spacing: .12em; margin-left: 8px; }
  .plog .say { display: block; margin-top: 7px; font-family: "Kaiti SC", "KaiTi", "STKaiti", serif;
               font-size: 14px; line-height: 1.85; color: var(--ink); opacity: .9; }
  .plog .say::before { content: ""; display: block; width: 22px; height: 1px;
                       background: color-mix(in srgb, var(--accent) 55%, transparent); margin-bottom: 7px; }

  .empty { color: var(--soft); font-size: 14px; padding: 18px 0; }

  footer { margin-top: 52px; padding-top: 18px; border-top: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
           font-size: 12px; color: var(--soft); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

  @media (max-width: 640px) {
    body { padding: 18px 10px 40px; }
    .sheet { padding: 30px 20px 38px; }
    h1 { font-size: 36px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .grid { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { max-width: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="sheet">

  <header>
    <p class="kicker">${esc(year)} · ${esc(theme.name)}</p>
    <h1>${esc(title)}<small>${esc(cityLine || '还在路上')}</small></h1>
    ${input.nowLine ? `<p class="now">${esc(input.nowLine)}</p>` : ''}
  </header>

  ${quote ? `<blockquote class="quote">${esc(quote)}</blockquote>` : ''}

  <div class="stats">
    ${stats.map((s) => `<div class="stat"><p class="k">${esc(s.k)}</p><p class="v">${esc(s.v)}<span class="u">${esc(s.u)}</span></p></div>`).join('')}
  </div>

  ${posters.length && layout === 'poster' ? `<h2>封面 · 一处一张</h2>
  <div class="covers">${posterCards}
  </div>
  <p class="note">这几张是按当天的景排的版式，不是照片 —— 画面是画出来的。真的照片在下面。</p>` : ''}

  <h2>这个月拍下的</h2>
  ${photos.length ? `<div class="grid">${photoCards}\n  </div>` : '<p class="empty">这个月一张都没拍。</p>'}

  <h2>这个月写下的</h2>
  ${entries.length ? `<div class="entries">${entryCards}\n  </div>` : '<p class="empty">这个月还没写日记。</p>'}

  <footer>
    <span>${esc(year)} 年${esc(title)} · 月报</span>
    <span>照片 ${photos.length} 张 · 日记 ${entries.length} 篇</span>
  </footer>

</div>
</body>
</html>
`;
}

/* ================= 封面：一个地方挑一张 ================= */

/**
 * 一个月最多出几张封面。
 *
 * 每张都要真的调一次生图接口（硅基流动那边实测 7.5 秒一张）。一个月走五座城不算多，
 * 但真有人一天换一个地方的话，二十座城就是二十次请求、两分半的等待 ——
 * 月报是月底睡前看的，不该让人盯着转圈。
 */
export const POSTER_CAP = 8;

export interface PosterPick {
  readonly dateKey: string;
  readonly cityName: string;
  readonly spot: string;
  readonly handle: string;
}

/** 「路上」不是地方，是一段路 —— 它没有可以画成封面的「这一个地方」。 */
export function isRoadPhoto(p: MonthlyPhoto): boolean {
  return p.cityId === 'road' || p.cityName === '路上';
}

/**
 * 一个地方挑一张。
 *
 * 为什么按地方挑而不是按构图挑：**月报是按「走过哪些地方」读的**，不是按「哪些照片好看」
 * 读的。同一座城挑三张，读起来就是「这个月只去了一座城」；而那些挑剩下的、构图差的，
 * 恰恰是当天真实的光线。
 *
 * 城里挑哪一天：取**日期居中**的那张。到的第一天多半在赶路、刚放下包，走的那天多半在收拾 ——
 * 中间那几天才是真的在看。没有构图判断的余地（我这里拿不到像素），
 * 但「中间那天」这个规则是可以讲清楚的，而且结果固定、可复现。
 */
export function pickPosters(photos: readonly MonthlyPhoto[], cap: number = POSTER_CAP): PosterPick[] {
  const groups = new Map<string, MonthlyPhoto[]>();
  for (const p of photos) {
    if (isRoadPhoto(p)) continue;
    const key = String(p.cityName || p.cityId || '').trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const perCity = [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const one = sorted[Math.floor(sorted.length / 2)]!;
    return {
      days: sorted.length,
      first: sorted[0]!.dateKey,
      pick: {
        dateKey: one.dateKey,
        cityName: one.cityName,
        spot: String(one.spot || '').trim() || one.cityName,
        handle: one.handle,
      },
    };
  });

  // 城市比上限多时，待得久的那几座先出 —— 三天的地方比得住一晚的更像「这个月的一部分」。
  perCity.sort((a, b) => (b.days - a.days) || a.first.localeCompare(b.first));
  return perCity.slice(0, Math.max(0, cap)).map((x) => x.pick)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** 相册里没写星期，就用日期本身：`2026 · 11 · 04`。 */
export function dateStamp(dateKey: string): string {
  return String(dateKey || '').replace(/-/g, ' · ');
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export function seasonOf(monthKey: string): Season {
  const m = Number(String(monthKey).slice(5, 7));
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

/**
 * 「季节限定事物」。
 *
 * Mr.Q 的原话是把那套复古模板里的装饰换成当季才有的东西：春天花和藤蔓、夏天汽水和海、
 * 秋天枫叶、冬天雪人。换掉的理由是**旧的装饰跟月份没关系** —— 十一月和四月贴同样的
 * 压花和邮票，那份月报就只是「一份月报」。
 */
export function seasonTrim(monthKey: string): string {
  switch (seasonOf(monthKey)) {
    case 'spring':
      return '几枝压平的花和一小段刚抽芽的藤蔓';
    case 'summer':
      return '一只玻璃汽水瓶和一小片海的颜色';
    case 'autumn':
      return '几片压平的枫叶和一小枝干枯的秋草';
    default:
      return '一个用墨水画的小雪人';
  }
}

export interface PosterPromptInput {
  readonly cityName: string;
  readonly spot: string;
  /** 她那天的照片标题，含时段（「黄昏的甘海子」）。 */
  readonly title: string;
  readonly dateKey: string;
  readonly monthKey: string;
}

/**
 * 封面的提示词。
 *
 * 三件事是踩着坑定下来的，改之前先看这儿：
 *
 * 1. **日期写阿拉伯数字。** 第一版写「二〇二六年十一月五日」，模型把「〇」认成「公」，
 *    成了「二公二年」—— 整页就废在一个字上。
 * 2. **手绘必须写「同一处景、同一个视角」。** 不写死它就把左边画成另一座山。
 * 3. **不许提亮。** 「轻微复古胶片调色」被理解成「加曝光」，黄昏的照片回来是正午。
 *
 * 还有一条不在提示词里、但在调用方：**这张图是画的，不是那张照片**。接口是文生图，
 * 它只拿到下面这段字，没拿到像素。所以报告里它叫「封面」，不叫「照片」。
 */
export function posterPrompt(o: PosterPromptInput): string {
  const place = o.spot || o.cityName;
  const trim = seasonTrim(o.monthKey);

  return [
    `${place} · 旅行手账封面。竖版海报，做成一页真实的旅行观察手账。`,
    '',
    '【版式】3:4 竖版，非对称错位拼贴，绝不上下等分。暖黄旧纸为底；左侧是大幅写实风景，'
      + '约占 58% 宽，从顶部延伸至画面约 72% 高；右侧偏下叠一张同场景的钢笔速写，约 35% 宽，'
      + '与照片错开、只压住照片右下角一点点；右上方留文字区，左下方留大片旧纸。',
    '',
    `【左侧】写实摄影：${o.cityName}的${place}，${o.title}那个时刻的样子。`
      + '忠实保留当地的地貌、建筑、植被与光线的方向，不要提亮，不要改成另一段时间的光。'
      + '边缘做自然裁切与纸张贴附感。',
    '',
    '【右侧手绘】**必须与左侧是同一处景、同一个视角**：同样的轮廓、同样的透视、同样的远山，'
      + '只是换成速写语言。细钢笔线稿、干刷墨迹、局部淡彩；黑灰墨为主，只在重点区域做低饱和上色。'
      + '边缘散在纸里，像没画完。',
    '',
    '【纸张】暖米白、浅卡其、泛黄羊皮纸，带纤维、折痕、磨损与细小污渍。加半透明纸胶带、'
      + `撕纸边、淡印章、细线框。点缀${trim}，克制，不要贴满。`,
    '',
    /*
     * 这一节是 2026-11-05 翻小红书排版教程抄来的作业。抄的不是「好看」，是**能说清的纪律** ——
     * 上一版提示词写的是「克制、精致、松弛」，模型只能靠猜，出来的是没有毛病的通用拼贴。
     * 下面每一条都能被一张图违反，也都能被眼睛一眼查出来。
     */
    '【排版纪律】',
    '- 底色不要纯白：用暖米白或浅卡其的纸感色，纯白一出，复古感全没。',
    '- 文字不要纯黑：用深褐或深墨绿，像印上去的油墨，不像屏幕上的字。',
    '- 边线只用一到两条（比如顶部和底部各一条细线），**绝不画封闭的四边框** —— 边框一闭合，画面就闷。',
    '- 胶带、邮票、票根必须**压在照片或手绘的边缘上**，制造层叠关系；孤零零贴在空白处的装饰一律不要。',
    '- 纸片、票根摆得略微歪、有角度，底下带一层很淡的投影，像真的贴上去，不像浮着。',
    '- 竖屏当横排杂志排：顶部一条小标识，上中是大图，右上是标题，底部放印章与页码。',
    '- 留白不少于三分之一，画面上小物件总数不超过五件。',
    /*
     * 2026-11-05 实测：不加这条，模型会在印章里自己造一串字母（出现过 `i5I8DA`、`BNA`），
     * 远看像水印，近看是乱码 —— 整页的可信度就是被这种小地方拖走的。
     * 印章只用**空白**的圆章或方章，宁可什么都不写。
     */
    '- 印章只用空白的圆章或方章、或纯线框几何图形，**章里一个字都不要写**；画面里不许出现任何拉丁字母。',
    '',
    '【色彩】四色以内：暖米白、褐黑、灰绿、赭石、褪色金。低饱和，暖，旧胶片感。',
    '',
    /*
     * **文字不让模型画。**
     *
     * 2026-11-05 实测四张，两张的中文是错的：「玉泉观」拆成「玉泉 / 泉观」（重了一个字），
     * 「甘海子」写成「甘子」、「九寨沟」写成「九海沟」。这不是概率高低的问题 ——
     * 一个会漏字、会换字的渲染器，不适合承担「地名必须逐字正确」这件事。
     *
     * 小红书那份教程说得比我想得干脆：AI 出整张含文字的封面，错别字率高；
     * 稳的做法是 AI 只出底图，文字由排版层加。所以这里只要一块干净的空地，
     * 中文由 `monthlyReport` 用系统楷体排上去 —— 那是确定性的，不会写错。
     */
    '【文字】**画面里不要出现任何文字、数字、字母或印章文字。**',
    '右上角从顶部到四成高、靠右侧，留出一大片干净的旧纸（约占画面三分之一），'
      + '什么也不写、什么也不画 —— 那块地是留给排版放标题的。',
    '其它的印章、邮戳一律只用空白圆章或纯线框几何图形，章里一个字都不要写。',
    '',
    '【整体】安静、诗意、精致、松弛。',
    '',
    '【避免】上下等分、规整双栏、画面拥挤、任何文字与数字、英文、拉丁字母、拼音、乱码、印章里的字、水印。',
  ].join('\n');
}

/* ================= 图片日记：线圈本那一版 ================= */

/**
 * 照着小红书那张「厦门旅行日记」的样子做的一页。
 *
 * 那张图里能数出来的东西：线圈、奶油纸、顶部大标题 + 日期区间、右上角打勾清单、
 * Day1/2/3 加地点小标签、蓝色高亮的日记段落、歪着贴的宝丽来、纸胶带、
 * 角落的小涂鸦（云、太阳、植物、相机）、右下角一张便签。
 *
 * **这里一样 AI 都不出。** 照片是她拍的，字是她写的，装饰是 CSS 和几个内联 SVG ——
 * 所以它既是那个风格，又不会把「中查沟」画成「中查沟」以外的任何东西。
 */
export function notebookHtml(input: MonthlyInput): string {
  const theme = themeOf(input.monthKey);
  const prefix = input.mediaPrefix ?? '../media/';
  const year = String(input.monthKey).slice(0, 4);
  const title = monthTitle(input.monthKey);

  const photos = [...input.photos].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const entries = [...input.entries].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const cities = citiesOfMonth(photos, entries);
  const mainCity = cities.length === 1 ? cities[0]!.name : '';

  // 一天一段。照片和日记按日期归到一起，缺哪样就只用另一样。
  const byDay = new Map<string, { photos: MonthlyPhoto[]; entries: MonthlyEntry[] }>();
  for (const p of photos) {
    if (!byDay.has(p.dateKey)) byDay.set(p.dateKey, { photos: [], entries: [] });
    byDay.get(p.dateKey)!.photos.push(p);
  }
  for (const e of entries) {
    if (!byDay.has(e.dateKey)) byDay.set(e.dateKey, { photos: [], entries: [] });
    byDay.get(e.dateKey)!.entries.push(e);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const first = days[0]?.[0] ?? '';
  const last = days[days.length - 1]?.[0] ?? '';
  const range = first && last
    ? `${first.replace(/-/g, '.')} — ${last.slice(5).replace('-', '.')}`
    : input.monthKey.replace('-', '.');

  // 右上角那张清单：她这个月真的到过的地方。
  const spots: string[] = [];
  for (const p of photos) {
    const s = String(p.spot || '').trim();
    if (s && !spots.includes(s)) spots.push(s);
  }
  const checkList = spots.slice(0, 5).map((s) => `<li>${esc(s)}</li>`).join('');

  /*
   * 这座城的三样招牌：市花、地标、吃食。
   *
   * 2026-11-05 Mr.Q：「季节特色不明显（其实也可以加上当地城市的特色的比如：市花、景观、
   * 地标、特色美食什么的）」。涂鸦给的是「季节」，这三样给的是「这个地方」——
   * 一张月报上两者都有，才不像通用模板。
   */
  const mainId = (() => {
    const count = new Map<string, number>();
    for (const p of photos) {
      const id = String(p.cityId || '');
      if (!id || id === 'road') continue;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  })();
  const feat = featureOf(mainId);
  const featChips = [
    feat.flower ? `<span class="chip"><b>市花</b>${esc(feat.flower)}</span>` : '',
    feat.landmark ? `<span class="chip"><b>地标</b>${esc(feat.landmark)}</span>` : '',
    feat.food ? `<span class="chip"><b>吃</b>${esc(feat.food)}</span>` : '',
  ].filter(Boolean).join('');
  const featRow = featChips ? `<p class="feat">${featChips}</p>` : '';

  const usedLines = new Set<string>();

  const dayBlocks = days.map(([dateKey, d], i) => {
    const p = d.photos[0];
    const say = d.entries.length ? firstSentences(d.entries[0]!.body, 150) : '';
    if (say) usedLines.add(say);
    const place = p ? (p.spot || p.cityName) : (d.entries[0]?.cityName ?? '');
    /*
     * 这一天的城市如果**不是**这个月的主城，就在当天补上它的三样招牌。
     * 主城的已经写在页眉了 —— 天天重复一遍反而像模板。
     */
    /*
     * 同一座城只标一次 —— 第一版每天标，天水连写两天就是两遍「麦积山 / 麻辣烫」，
     * 读起来像模板复读。所以只有这座城这个月**第一次**出现那天才补。
     */
    const dayFeatId = String(p?.cityId || '');
    const seenCity = dayFeatId !== '' && i > 0
      && days.slice(0, i).some(([, prev]) => String(prev.photos[0]?.cityId || '') === dayFeatId);
    const df = dayFeatId && dayFeatId !== mainId && !seenCity ? featureOf(dayFeatId) : {};
    const dfChips = [
      df.flower ? `<span class="chip"><b>市花</b>${esc(df.flower)}</span>` : '',
      df.landmark ? `<span class="chip"><b>地标</b>${esc(df.landmark)}</span>` : '',
      df.food ? `<span class="chip"><b>吃</b>${esc(df.food)}</span>` : '',
    ].filter(Boolean).join('');
    const left = i % 2 === 1; // 双数照片在右，单数照片在左 —— 跟参考图一样错着来
    // 四种胶带轮着用：一页上全一样，就等于没贴。
    const tape = TAPES[i % TAPES.length]!;
    return `
    <section class="day${left ? ' flip' : ''}">
      <div class="txt">
        <p class="d">Day ${i + 1}.</p>
        ${place ? `<p class="loc">${pin()}${esc(place)}</p>` : ''}
        ${say ? `<p class="say">${esc(say)}</p>${wave()}${inlineDoodle(input.monthKey, i)}` : ''}
        ${dfChips ? `<p class="feat day-feat">${dfChips}</p>` : ''}
      </div>
      ${p ? `<figure class="pic">
        <img src="${esc(prefix + mediaFile(p.handle))}" alt="${esc(p.title)}" loading="lazy">
        <span class="tape tape--${tape}"></span>
        <figcaption>${esc(p.title)}</figcaption>
      </figure>` : '<div class="pic blank"></div>'}
    </section>`;
  }).join('');

  /*
   * 右下角便签：用她自己写过的一句话，不编。
   * 但要避开正文已经用过的那几句 —— 第一版取最后一天的日记，
   * 结果 Day5 旁边又贴了同一句，一页纸上说了两遍。
   */
  /*
   * 便签的内容：**她自己写的、而且正文里没出现过的一句**。
   *
   * 只找「第一句」不够 —— 一天一句的时候，五天的第一句正好把日记占满，便签就永远空着，
   * 右下角那一块留白变得很扎眼。所以退一步取同一天的**第二句、第三句**。
   * 还是她写的原话，只是不是段首那句。
   */
  let tipLine = '';
  const outside: string[] = [];
  for (const e of entries) {
    for (const one of sentences(e.body)) {
      if (!usedLines.has(one) && !outside.includes(one)) outside.push(one);
    }
  }
  tipLine = outside.length ? outside[outside.length - 1]! : '';


  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(year)} 年${esc(title)} · ${esc(mainCity || '旅行')}日记</title>
<style>
  :root { --paper: #fbf7e9; --ink: #3d3226; --soft: #8c7c63; --line: #e3d7bd;
          --blue: #2f4f7a; --hl: #dfe9f7; --accent: ${theme.accent}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #efe7d8; color: var(--ink); }
  body { font-family: "Kaiti SC", "KaiTi", "STKaiti", "Songti SC", serif; padding: 26px 12px 60px; }
  /*
   * 横格。参考图那种本子是有格子的，第一版没做，空白纸显得太空。
   * 34px 一条，正文 .say 的行高也是 34px —— 两处必须一起改，否则字会骑在线上。
   */
  .book { max-width: 900px; margin: 0 auto;
          background-image: repeating-linear-gradient(to bottom,
            transparent 0 33px, #ece0c7 33px 34px);
          background-color: var(--paper); border-radius: 8px;
          box-shadow: 0 14px 40px rgb(90 70 40 / 22%), inset 0 0 60px rgb(200 175 130 / 18%);
          position: relative; padding-left: 58px; overflow: hidden; }
  /* 线圈：一列金属孔。用背景重复画，不加元素。 */
  .book::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 58px;
    background:
      radial-gradient(circle at 30px 22px, #b9a68a 0 6px, #6f6152 7px, transparent 8px) 0 0/100% 52px repeat-y,
      linear-gradient(90deg, #e8dcc4 0 44px, #d9c9a9 44px, transparent 46px);
  }
  .page { padding: 34px 42px 46px 34px; position: relative; }

  /* 清单是绝对定位的，**不占位**：不给 header 留高度，第一天那张照片就会盖掉它下半截
     （2026-11-05 第一版就是这样，清单只剩两行看得见）。150px 是按五行算的。 */
  header { position: relative; padding-right: 220px; margin-bottom: 6px; min-height: 142px; }
  /* 标题像秀丽笔写的：粗、略宽，字距拉开一点。 */
  h1 { font-size: 35px; margin: 0 0 8px; font-weight: 700; letter-spacing: .05em; display: flex;
       align-items: center; gap: 10px; }
  h1 svg { flex: none; }
  .range { margin: 0; font-size: 15.5px; color: var(--soft); letter-spacing: .1em;
           display: inline-flex; align-items: center; gap: 8px; padding-bottom: 2px; }

  /* 右上角清单 */
  .check { position: absolute; right: 2px; top: 6px; width: 190px; z-index: 3; background: #fffdf4;
           border: 1px solid var(--line); padding: 12px 14px; transform: rotate(1deg);
           box-shadow: 0 3px 10px rgb(120 100 60 / 12%); }
  .check p { margin: 0 0 8px; font-size: 12px; color: var(--soft); letter-spacing: .18em; }
  .check ul { margin: 0; padding: 0; list-style: none; }
  .check li { font-size: 13.5px; line-height: 1.9; color: var(--ink); }
  .check li::before { content: "☑"; color: #7fa6cf; margin-right: 7px; font-size: 13px; }
  /* 清单上压一小块蓝白格子胶带，跟参考图右上角那块一样。 */
  .check .check-tape { position: absolute; top: -11px; left: 26px; width: 66px; height: 20px;
                       transform: rotate(-3deg);
                       background:
                         repeating-linear-gradient(0deg, rgb(140 178 210 / 60%) 0 1px, transparent 1px 7px),
                         repeating-linear-gradient(90deg, rgb(140 178 210 / 60%) 0 1px, transparent 1px 7px),
                         rgb(247 251 254 / 80%); }

  /* 城市特色的三枚小标签：像盖上去的三枚章 */
  .feat { margin: 12px 0 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .feat .chip { font-size: 11.5px; letter-spacing: .06em; color: #5f5142;
                border: 1px dashed #cbb894; border-radius: 2px; padding: 3px 8px;
                background: rgb(255 253 244 / 70%); }
  .feat .chip:nth-child(2) { transform: rotate(-1.2deg); }
  .feat .chip:nth-child(3) { transform: rotate(1deg); }
  .feat .chip b { font-weight: 400; color: #9a8663; margin-right: 6px; letter-spacing: .12em; }

  /* 涂鸦 */
  /*
   * 尺寸统一放大：Mr.Q 说「涂鸦麻烦大一点看不清」。
   * 原来 30–44px，在 900px 宽的纸上就是几个灰点 —— 现在页边 56、正文里 52。
   */
  .doodle { position: absolute; opacity: .9; pointer-events: none;
            width: 56px !important; height: 56px !important; }
  /* 正文里那个：同一套形状，只是回到文档流里，贴着文字站。 */
  /* 页眉那一行：占位排列，不会再压到标题和日期。 */
  .doodles-row { display: flex; gap: 16px; align-items: flex-start; justify-content: flex-end;
                 margin: 10px 0 0; }
  .doodles-row .doodle { position: static; }

  .inline-doodle .doodle { position: static; margin-left: 10px; vertical-align: middle;
                           width: 52px !important; height: 52px !important;
                           opacity: .95; pointer-events: none; }

  /* 顶对齐：参考图里 Day 那行和照片的上沿齐，垂直居中的话文字会浮在半空。 */
  .day { display: grid; grid-template-columns: 1fr 1.02fr; gap: 20px; align-items: start;
         margin: 26px 0 34px; }
  .txt { padding-top: 14px; }
  .day.flip .txt { order: 2; }
  .day.flip .pic { order: 1; }
  .d { display: inline-block; margin: 0 0 8px; font-size: 17px; color: var(--blue);
       transform: rotate(-1.2deg);
       background: var(--hl); padding: 1px 9px; border-bottom: 2px solid #a9c6e6; }
  .loc { margin: 0 0 10px; font-size: 15px; color: #6b5a44; display: flex; align-items: center; gap: 5px; }
  /* 行高钉成 34px，正好压在横格上 —— 这也是本子上写字的那个间距。 */
  /*
   * 正文用「铅笔」那种灰。系统里没有真正的铅笔体，所以靠三样凑：
   * 颜色偏灰（不是纯黑）、字重轻、再加一道极细的描边阴影 —— 远看就有颗粒感。
   */
  .say { margin: 0; font-size: 16.5px; line-height: 34px; white-space: pre-wrap;
         color: #4b463c; font-weight: 300; letter-spacing: .012em;
         text-shadow: 0 0 .7px rgb(70 60 45 / 45%);
         /* 手写不会横平竖直 —— 斜一点点，整页就松了 */
         transform: rotate(-.7deg); transform-origin: left top; }
  .day-feat { margin-top: 14px; }
  .squiggle { display: block; margin: 6px 0 0 2px; opacity: .85; }

  /* 宝丽来：白边、微歪、下面一行小字 */
  .pic { margin: 0; background: #fff; padding: 9px 9px 6px; position: relative;
         transform: rotate(-1.6deg); box-shadow: 0 6px 20px rgb(90 70 40 / 18%); }
  .pic.blank { background: transparent; box-shadow: none; transform: none; }
  .day.flip .pic { transform: rotate(1.4deg); }
  .pic img { display: block; width: 100%; height: auto; }
  .pic figcaption { font-size: 11.5px; color: var(--soft); text-align: center; padding: 5px 0 1px; }
  /*
   * 胶带。参考图里四条胶带**没有一条是同一种**：牛皮纸素色、蓝白格子、粉条纹、
   * 撕下来的卷边。所以这里做四个变体，按日子轮着用 —— 一页上全一样就等于没贴。
   */
  .pic .tape { position: absolute; height: 22px; box-shadow: 0 1px 3px rgb(120 100 60 / 12%);
               opacity: .92; }
  .pic .tape::before, .pic .tape::after { content: ""; position: absolute; inset: 0; }
  /* 三条压在照片上沿，一条压在角上 —— 位置也不该整齐 */
  .tape--kraft { top: -11px; left: 50%; width: 78px; margin-left: -39px; transform: rotate(-2.5deg);
                 background: rgb(214 196 158 / 82%); }
  .tape--grid { top: -9px; left: -14px; width: 62px; transform: rotate(-38deg);
                background:
                  repeating-linear-gradient(0deg, rgb(150 185 215 / 55%) 0 1px, transparent 1px 8px),
                  repeating-linear-gradient(90deg, rgb(150 185 215 / 55%) 0 1px, transparent 1px 8px),
                  rgb(246 250 253 / 78%); }
  .tape--stripe { top: -10px; right: -12px; width: 66px; transform: rotate(32deg);
                  background: repeating-linear-gradient(45deg,
                    rgb(240 186 186 / 78%) 0 5px, rgb(252 236 236 / 82%) 5px 10px); }
  .tape--roll { top: -12px; left: 18px; width: 70px; transform: rotate(-4deg);
                background: rgb(222 214 190 / 85%); border-radius: 1px 8px 8px 1px;
                box-shadow: 0 2px 4px rgb(120 100 60 / 18%), inset -6px 0 8px rgb(160 145 115 / 22%); }

  /* 右下角便签 */
  /* 便签：淡黄方格纸，右边一条撕痕（clip-path），上面压一小块胶带。 */
  .tip { position: relative; width: min(300px, 78%); margin: 34px 0 0 auto; padding: 16px 18px 18px;
         transform: rotate(-1.1deg); color: #4b463c;
         background-color: #fdf1cf;
         background-image:
           repeating-linear-gradient(0deg, rgb(206 178 120 / 30%) 0 1px, transparent 1px 22px),
           repeating-linear-gradient(90deg, rgb(206 178 120 / 30%) 0 1px, transparent 1px 22px);
         box-shadow: 0 6px 16px rgb(120 100 60 / 18%);
         clip-path: polygon(0 0, 100% 0, 100% 92%, 96% 88%, 99% 84%, 95% 80%, 99% 76%,
                            96% 72%, 100% 68%, 96% 64%, 99% 60%, 95% 56%, 99% 52%,
                            96% 48%, 100% 44%, 100% 100%, 0 100%); }
  .tip p { margin: 0; font-size: 15px; line-height: 22px; }
  .tip .tip-tape { position: absolute; top: -9px; right: 22px; width: 54px; height: 18px;
                   transform: rotate(6deg); background: rgb(214 196 158 / 82%);
                   box-shadow: 0 1px 3px rgb(120 100 60 / 14%); }

  footer { margin-top: 40px; padding-top: 14px; border-top: 1px dashed var(--line);
           font-size: 12px; color: var(--soft); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }

  @media (max-width: 700px) {
    .book { padding-left: 34px; }
    .book::before { width: 34px;
      background: radial-gradient(circle at 17px 22px, #b9a68a 0 5px, #6f6152 6px, transparent 7px) 0 0/100% 46px repeat-y,
                  linear-gradient(90deg, #e8dcc4 0 26px, #d9c9a9 26px, transparent 28px); }
    .page { padding: 24px 18px 34px 14px; }
    header { padding-right: 0; }
    .check { position: static; width: auto; display: inline-block; margin-top: 10px; transform: none; }
    .day { grid-template-columns: 1fr; gap: 12px; }
    .day.flip .txt, .day.flip .pic { order: 0; }
    h1 { font-size: 27px; }
  }
  @media print { html, body { background: #fff; } .book { box-shadow: none; } }
</style>
</head>
<body>
<div class="book">
  <div class="page">

    <header>
      <h1>${pin(30)}${esc(mainCity ? `${mainCity}旅行日记` : `${title}旅行日记`)}</h1>
      <p class="range">${esc(range)}${wave(46)}</p>
      ${featRow}
      ${doodles(input.monthKey)}
      ${checkList ? `<aside class="check"><span class="check-tape"></span><p>走过的</p><ul>${checkList}</ul></aside>` : ''}
    </header>

    ${dayBlocks || '<p>这个月没有留下照片，也没有日记。</p>'}

    ${tipLine ? `<aside class="tip"><span class="tip-tape"></span><p>${esc(tipLine)}</p></aside>` : ''}

    <footer>
      <span>${esc(year)} 年 ${esc(title)} · ${esc(mainCity || '旅行')}日记</span>
      <span>${days.length} 天 · ${photos.length} 张照片 · ${entries.length} 篇日记</span>
    </footer>

  </div>
</div>
</body>
</html>
`;
}

/** 定位针。参考图上正文每一段前面都有一枚。 */
/** 一页上轮着用的四种胶带，见 CSS 里的 .tape--*。 */
const TAPES = ['kraft', 'grid', 'stripe', 'roll'] as const;

/** 手画的小波浪。参考图里日期后面、段落末尾都有，是最省事的「手写感」。 */
function wave(width = 58): string {
  const seg = 14;
  let d = `M1 8`;
  for (let x = 1; x < width - 2; x += seg) d += ` q${seg / 2} -6 ${seg} 0`;
  return `<svg class="squiggle" width="${width}" height="12" viewBox="0 0 ${width} 12" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="#8fb4d6" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

function pin(size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">`
    + '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" stroke="#8a6f52" stroke-width="1.6"/>'
    + '<circle cx="12" cy="10" r="2.6" fill="#c9a98a"/></svg>';
}

/* ---------------- 涂鸦 ---------------- */

/**
 * 角落里的手绘小东西。
 *
 * 2026-11-05 Mr.Q 两次提：「季节涂鸦还是太少了，多一点」「可以多学一些细节
 * （比如胶带的样式都不一样，字体用铅笔啥的）」。第一版只有一朵云一个太阳，
 * 四季都一样，等于没有四季。现在每季七件，位置各不同。
 *
 * 两条纪律：**只放页边**（照片和字占的地方一律不碰）、**笔画细、颜色淡**。
 * 涂鸦是让纸不空，不是让人看它。
 */
const put = (
  body: string, x: number, y: number, w: number, h: number, rot = 0, from: 'top' | 'bottom' = 'top',
): string =>
  `<svg class="doodle" style="left:${x}%;${from}:${y}px;transform:rotate(${rot}deg)" `
  + `width="${w}" height="${h}" viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;

/** 一朵云。四季都可能有，所以给它两个位置。 */
const cloudSvg = (x = 1, y = 8, k = 1): string => put(
  '<path d="M9 27c-3.5 0-6-2.3-6-5.2s2.9-5.2 6.4-4.7c1.2-3.5 4.7-5.3 8.2-4.1s5.2 4.7 4.7 7.6c3.5-.6 6.4 1.7 6.4 4.4s-2.9 4.6-6.4 4.6z"'
  + ' fill="#e8f2fb" fill-opacity=".74" stroke="#b6cfe8" stroke-width="1.5" stroke-linejoin="round"/>',
  x, y, 44 * k, 44 * k, -2);

const sunSvg = (x = 31, y = 4): string => put(
  '<circle cx="20" cy="20" r="7" fill="#fbe0a6" fill-opacity=".74" stroke="#e0b25f" stroke-width="1.6"/>'
  + '<path d="M20 4v5M20 31v5M4 20h5M31 20h5M9 9l3.5 3.5M27.5 27.5L31 31M31 9l-3.5 3.5M12.5 27.5L9 31"'
  + ' stroke="#e0b25f" stroke-width="1.5" stroke-linecap="round"/>', x, y, 40, 40, 6);

const flowerSvg = (x = 90, y = 26): string => put(
  '<circle cx="20" cy="20" r="3.2" fill="#f0d58a" stroke="#c9a24a" stroke-width="1.1"/>'
  + [0, 72, 144, 216, 288].map((a) => {
      const r = (a * Math.PI) / 180;
      return `<circle cx="${(20 + Math.cos(r) * 7).toFixed(1)}" cy="${(20 + Math.sin(r) * 7).toFixed(1)}" r="4.2" fill="#f7c9d8" fill-opacity=".76" stroke="#d98aa8" stroke-width="1.2"/>`;
    }).join(''), x, y, 34, 34, 8);

const vineSvg = (x = 2, y = 30): string => put(
  '<path d="M6 36c6-4 4-12 10-15s4-10 10-13" fill="none" stroke="#7fae6a" stroke-width="1.4" stroke-linecap="round"/>'
  + '<path d="M16 21c-3-1-5-4-4-6 3 0 5 2 4 6zM24 12c2-2 6-2 7 0-1 3-5 3-7 0zM12 30c-3-1-5-4-4-6 3 0 5 2 4 6z"'
  + ' fill="#cfe6c7" fill-opacity=".74" stroke="#7fae6a" stroke-width="1.2" stroke-linejoin="round"/>', x, y, 40, 40, -6);

const butterflySvg = (x = 90, y = 24): string => put(
  '<path d="M20 20c-4-7-12-8-13-3s6 8 13 3zM20 20c4-7 12-8 13-3s-6 8-13 3z" fill="#f2d4e4" fill-opacity=".74" stroke="#c98fb0" stroke-width="1.3"/>'
  + '<path d="M20 15v11" stroke="#8a6f52" stroke-width="1.2" stroke-linecap="round"/>', x, y, 34, 34, -10);

/** 刚冒头的一小株。春天除了花，还得有「才长出来」这件事。 */
const sproutSvg = (x = 4, y = 34): string => put(
  '<path d="M20 34V20" stroke="#7fae6a" stroke-width="1.3" stroke-linecap="round"/>'
  + '<path d="M20 22c-5 0-8-3-8-7 5 0 8 3 8 7zM20 26c5 0 8-3 8-7-5 0-8 3-8 7z"'
  + ' fill="#cfe6c7" fill-opacity=".74" stroke="#7fae6a" stroke-width="1.2" stroke-linejoin="round"/>', x, y, 30, 30, 4);

const sodaSvg = (x = 2, y = 28): string => put(
  '<path d="M16 8h8v3l2 4v19a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V15l2-4z" fill="#fbe2cc" fill-opacity=".74" stroke="#e0894f" stroke-width="1.4"/>'
  + '<path d="M14 18h12" stroke="#e0894f" stroke-width="1.2"/>'
  + '<circle cx="18" cy="24" r="1.3" fill="none" stroke="#8ec1d6"/><circle cx="22" cy="28" r="1" fill="none" stroke="#8ec1d6"/>'
  + '<circle cx="19" cy="32" r=".9" fill="none" stroke="#8ec1d6"/>', x, y, 36, 36, 7);

const melonSvg = (x = 90, y = 24): string => put(
  '<path d="M6 30a14 14 0 0 1 28 0z" fill="none" stroke="#3f8a5a" stroke-width="1.4"/>'
  + '<path d="M10 30a10 10 0 0 1 20 0" fill="#f7b9b9" fill-opacity=".66" stroke="#e06a6a" stroke-width="1.2"/>'
  + '<circle cx="16" cy="26" r="1" fill="#5a3a2a"/><circle cx="22" cy="24" r="1" fill="#5a3a2a"/>', x, y, 38, 38, -8);

const waveSvg = (x = 90, y = 38): string => put(
  '<path d="M4 18c4-4 8-4 12 0s8 4 12 0M4 26c4-4 8-4 12 0s8 4 12 0" fill="none" stroke="#6aa9c8" stroke-width="1.4" stroke-linecap="round"/>', x, y, 38, 38, 0);

/** 一支蛋卷冰淇淋。夏天要有两样能吃的，汽水不算吃的。 */
const iceCreamSvg = (x = 4, y = 30): string => put(
  '<path d="M14 18h12l-6 16z" fill="none" stroke="#c9a24a" stroke-width="1.2" stroke-linejoin="round"/>'
  + '<circle cx="20" cy="13" r="6" fill="#fbd9e6" fill-opacity=".8" stroke="#e6a0b4" stroke-width="1.3"/>'
  + '<path d="M15 20h10M17 24h6" stroke="#c9a24a" stroke-width="1"/>', x, y, 30, 30, -5);

const mapleSvg = (x = 2, y = 26): string => put(
  '<path d="M20 34V22M20 22l-8-4 4-2-3-6 6 3 1-7 1 7 6-3-3 6 4 2-8 4z" fill="#f2b184" fill-opacity=".74" stroke="#c06a34" stroke-width="1.3" stroke-linejoin="round"/>', x, y, 34, 34, 12);

const ginkgoSvg = (x = 4, y = 32): string => put(
  '<path d="M20 33V21" stroke="#b0842f" stroke-width="1.2" stroke-linecap="round"/>'
  + '<path d="M20 21c-6-6-5-13 0-15 5 2 6 9 0 15z" fill="#f4d78f" fill-opacity=".74" stroke="#d0a03a" stroke-width="1.3"/>', x, y, 34, 34, -8);

const mushroomSvg = (x = 90, y = 30): string => put(
  '<path d="M8 19c0-6 5-10 12-10s12 4 12 10z" fill="#eaa19b" fill-opacity=".74" stroke="#b6564a" stroke-width="1.4"/>'
  + '<path d="M16 19v7a4 4 0 0 0 8 0v-7" fill="none" stroke="#8a6f52" stroke-width="1.2"/>'
  + '<circle cx="15" cy="14" r="1.4" fill="none" stroke="#e7c3a8"/><circle cx="24" cy="16" r="1.1" fill="none" stroke="#e7c3a8"/>', x, y, 34, 34, 4);

/** 一颗橡果。秋天的地上除了叶子还有这个。 */
const acornSvg = (x = 90, y = 22): string => put(
  '<path d="M12 16h16c0 8-3 14-8 14s-8-6-8-14z" fill="#dcae86" fill-opacity=".74" stroke="#a9784a" stroke-width="1.3"/>'
  + '<path d="M12 16c2-4 14-4 16 0M20 10v3" stroke="#7d5a35" stroke-width="1.2" stroke-linecap="round"/>', x, y, 30, 30, 9);

const snowmanSvg = (x = 2, y = 24): string => put(
  '<circle cx="20" cy="14" r="5" fill="#f4fafe" fill-opacity=".9" stroke="#7fa6cf" stroke-width="1.4"/>'
  + '<circle cx="20" cy="26" r="7" fill="#f4fafe" fill-opacity=".9" stroke="#7fa6cf" stroke-width="1.4"/>'
  + '<path d="M15 10h10M20 9V6" stroke="#8a6f52" stroke-width="1.2" stroke-linecap="round"/>'
  + '<circle cx="18" cy="13" r=".9" fill="#6b7f96"/><circle cx="22" cy="13" r=".9" fill="#6b7f96"/>', x, y, 36, 36, -4);

const flakeSvg = (x = 4, y = 28, k = 1): string => put(
  '<path d="M20 5v30M7 12l26 16M33 12L7 28" stroke="#8fb4d6" stroke-width="1.2" stroke-linecap="round"/>'
  + '<path d="M20 9l-3 3M20 9l3 3M20 31l-3-3M20 31l3-3" stroke="#8fb4d6" stroke-width="1.1" stroke-linecap="round"/>',
  x, y, 32 * k, 32 * k, 14);

const pineSvg = (x = 4, y = 36): string => put(
  '<path d="M20 6l8 12h-4l6 9h-6l6 8H10l6-8H10l6-9h-4z" fill="#cfe4d3" fill-opacity=".74" stroke="#5f8a6a" stroke-width="1.3" stroke-linejoin="round"/>'
  + '<path d="M20 35v3" stroke="#8a6f52" stroke-width="1.2" stroke-linecap="round"/>', x, y, 34, 34, -3);

/**
 * 这一季的涂鸦，摆在页边。
 *
 * 位置是固定的、每季换形状 —— 所以四季的版面骨架一样、气氛不一样。
 * 刻意避开三处：右上（清单）、左侧中段（正文）、右侧中段（照片）。
 */
export function doodles(monthKey: string): string {
  const sea = seasonOf(monthKey);
  /*
   * 分成两半：页眉里那几个**走文档流**，页脚那两个才绝对定位。
   *
   * 2026-11-05 第二版把它们全绝对定位在页眉带上，结果五十六像素的橡果正好压在
   * 「2026.11.01」上 —— 页眉只有一百来像素高，放大之后就没地方了。
   * 走文档流会让它们占位，页眉自己变高，谁也不压谁。
   */
  const sky = sea === 'winter'
    ? [cloudSvg(), cloudSvg(30, 8, 0.85)]
    : [cloudSvg(), sunSvg(), cloudSvg(52, 10, 0.8)];

  const own = {
    spring: [flowerSvg(), vineSvg(), butterflySvg()],
    summer: [sodaSvg(), melonSvg(), waveSvg()],
    autumn: [mapleSvg(), ginkgoSvg(), acornSvg()],
    winter: [snowmanSvg(), flakeSvg(), pineSvg()],
  }[sea];

  const row = [...sky, ...own].slice(0, 6).join('');

  const tail = {
    spring: [flowerSvg(6, 30, 1, 'bottom'), vineSvg(90, 28, 1, 'bottom')],
    summer: [iceCreamSvg(6, 30, 1, 'bottom'), waveSvg(90, 30, 1, 'bottom')],
    autumn: [ginkgoSvg(6, 30, 1, 'bottom'), mushroomSvg(90, 26, 1, 'bottom')],
    winter: [pineSvg(6, 32, 1, 'bottom'), flakeSvg(90, 28, 0.9, 'bottom')],
  }[sea].join('');

  return `<div class="doodles-row">${row}</div>${tail}`;
}

/**
 * 正文里的小装饰。
 *
 * 参考图里那棵棕榈、那盆仙人掌都不是单独摆在页边的，是**贴着文字**站着的。
 * 页边那七个位置被照片挡掉之后，这一手才让涂鸦真的看得见。
 */
export function inlineDoodle(monthKey: string, i: number): string {
  const s = seasonOf(monthKey);
  const pool = {
    spring: [flowerSvg, butterflySvg, sproutSvg],
    summer: [iceCreamSvg, melonSvg, waveSvg],
    autumn: [mapleSvg, ginkgoSvg, acornSvg],
    winter: [snowmanSvg, flakeSvg, pineSvg],
  }[s];
  const make = pool[i % pool.length]!;
  return `<span class="inline-doodle">${make()}</span>`;
}

/* ================= 年报 ================= */

export interface YearlyTaste {
  /** `2026-05`：这条口味是哪个月记下的。 */
  readonly monthKey: string;
  /** 城市名。 */
  readonly name: string;
  /** 那座城她挑的那一张照片，可能为空。 */
  readonly photo: string;
  readonly note: string;
}

export interface YearlyInput {
  /** `2026`。 */
  readonly year: string;
  readonly photos: readonly MonthlyPhoto[];
  readonly entries: readonly MonthlyEntry[];
  /** 这一年记下的「地方」。年报里用它当每座城的题图。 */
  readonly tastes?: readonly YearlyTaste[];
  readonly mediaPrefix?: string;
  readonly nowLine?: string;
}

/**
 * 年报：把十二个月摊成一页。
 *
 * 2026-11-05 Mr.Q：「等到年末还可出个年报」。
 *
 * 和月报分工不同：月报是**这个月的细节**（每天一段、每张照片），年报是**这一年的形状** ——
 * 哪几个月在动、哪几个月停着，去过几座城，每座城留了哪一张。
 *
 * 所以这里不做日记摘录，只留三样能一眼比的：月份、数字、一张照片。
 */
export function yearlyHtml(input: YearlyInput): string {
  const year = String(input.year).slice(0, 4);
  const prefix = input.mediaPrefix ?? '../media/';

  const byMonth = new Map<string, { photos: MonthlyPhoto[]; entries: MonthlyEntry[] }>();
  for (const p of input.photos) {
    const k = p.dateKey.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, { photos: [], entries: [] });
    byMonth.get(k)!.photos.push(p);
  }
  for (const e of input.entries) {
    const k = e.dateKey.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, { photos: [], entries: [] });
    byMonth.get(k)!.entries.push(e);
  }

  const tasteOf = new Map<string, YearlyTaste>();
  for (const t of input.tastes ?? []) tasteOf.set(t.name, t);

  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  /*
   * 「路上」不是一座城。第一版把它也算进去，年报上就出现「3 座城」而实际只有两座 ——
   * 这种数字最伤，它是整页唯一能一眼核对的东西。
   */
  const realPlace = (name: string): boolean => !!name && name !== '路上';
  const totalCities = new Set<string>();
  for (const [, d] of months) {
    for (const p of d.photos) if (realPlace(p.cityName) && !isRoadPhoto(p)) totalCities.add(p.cityName);
    for (const e of d.entries) if (realPlace(e.cityName)) totalCities.add(e.cityName);
  }
  const totalDays = new Set([
    ...input.photos.map((p) => p.dateKey),
    ...input.entries.map((e) => e.dateKey),
  ]).size;

  const cards = months.map(([monthKey, d], i) => {
    const m = Number(monthKey.slice(5, 7));
    const theme = themeOf(monthKey);
    const cities = citiesOfMonth(
      d.photos.filter((p) => !isRoadPhoto(p)),
      d.entries.filter((e) => realPlace(e.cityName)),
    );
    const days = new Set([...d.photos.map((p) => p.dateKey), ...d.entries.map((e) => e.dateKey)]).size;

    /*
     * 题图三档：她自己挑的那张 > 这个月中间那张 > 空着。
     * **「路上」那张永远不当题图** —— 第一版十一月挑中了车窗照，整页最重要的一张成了高速路。
     */
    const usable = d.photos.filter((p) => !isRoadPhoto(p));
    const tasteHit = (input.tastes ?? []).find((t) => t.monthKey === monthKey && t.photo);
    const picked = usable.find((p) => {
      const t = tasteOf.get(p.cityName);
      return t && t.monthKey === monthKey && t.photo === p.handle;
    });
    const sorted = [...usable].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const cover = usable.find((p) => p.handle === tasteHit?.photo) ?? picked
      ?? sorted[Math.floor(sorted.length / 2)];

    return `
    <section class="mo">
      <span class="tape tape--${TAPES[i % TAPES.length]}"></span>
      <div class="head">
        <span class="n">${esc(String(m).padStart(2, '0'))}</span>
        <span class="t">${esc(theme.name)}</span>
        ${inlineDoodle(monthKey, i)}
      </div>
      ${cover
        ? `<figure class="shot"><img src="${esc(prefix + mediaFile(cover.handle))}" alt="${esc(cover.title)}" loading="lazy"></figure>`
        : '<div class="shot blank"><span>这个月没拍照</span></div>'}
      <p class="where">${esc(cities.slice(0, 3).map((c) => c.name).join(' · ') || '没挪窝')}</p>
      <p class="nums">${days} 天 · ${d.photos.length} 张 · ${d.entries.length} 篇</p>
      ${tasteHit ? `<p class="say">「${esc(tasteHit.name)}${tasteHit.note ? `，${esc(tasteHit.note)}` : ''}」</p>` : ''}
    </section>`;
  }).join('');

  const firstSeason = months.length ? seasonOf(months[0]![0]) : 'autumn';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(year)} 年 · 旅行年报</title>
<style>
  :root { --paper: #fbf7e9; --ink: #3d3226; --soft: #8c7c63; --line: #e3d7bd; --blue: #2f4f7a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #efe7d8; color: var(--ink); }
  body { font-family: "Kaiti SC", "KaiTi", "STKaiti", "Songti SC", serif; padding: 26px 12px 60px; }

  /* 同一套本子：线圈、奶油纸、写字横线。年报不是另一套设计，是同一本的最后一页。 */
  .book { max-width: 940px; margin: 0 auto; position: relative; padding-left: 58px; overflow: hidden;
          background-image: repeating-linear-gradient(to bottom,
            transparent 0 33px, #ece0c7 33px 34px);
          background-color: var(--paper); border-radius: 8px;
          box-shadow: 0 14px 40px rgb(90 70 40 / 22%), inset 0 0 60px rgb(200 175 130 / 18%); }
  .book::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 58px;
    background:
      radial-gradient(circle at 30px 22px, #b9a68a 0 6px, #6f6152 7px, transparent 8px) 0 0/100% 52px repeat-y,
      linear-gradient(90deg, #e8dcc4 0 44px, #d9c9a9 44px, transparent 46px);
  }
  .page { padding: 36px 40px 44px 32px; position: relative; }

  header { position: relative; margin-bottom: 22px; }
  .kicker { margin: 0; font-size: 12px; letter-spacing: .34em; color: var(--soft); }
  h1 { margin: 4px 0 6px; font-size: 54px; line-height: 1.05; letter-spacing: .06em; font-weight: 700; }
  h1 small { display: block; font-size: 14px; font-weight: 400; letter-spacing: .34em;
             color: var(--soft); margin-top: 10px; }
  .totals { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0 0; }
  .totals span { font-size: 11.5px; letter-spacing: .06em; color: #5f5142; padding: 3px 9px;
                 border: 1px dashed #cbb894; border-radius: 2px; background: rgb(255 253 244 / 70%); }
  .totals b { font-size: 15px; color: var(--ink); margin-right: 4px; font-weight: 600; }

  /* 月份卡：一张像票根的小纸，歪着贴 */
  .months { display: grid; grid-template-columns: repeat(auto-fill, minmax(242px, 1fr)); gap: 26px 20px; margin-top: 26px; }
  .mo { position: relative; background: #fffdf5; border: 1px dashed #d9c9a9;
        padding: 12px 12px 14px; box-shadow: 0 4px 14px rgb(120 100 60 / 12%); }
  .mo:nth-child(even) { transform: rotate(-.5deg); }
  .mo:nth-child(3n) { transform: rotate(.6deg); }
  .mo .head { display: flex; align-items: baseline; gap: 8px; }
  .mo .n { font-size: 26px; font-weight: 700; color: var(--blue); font-variant-numeric: tabular-nums; }
  .mo .t { font-size: 12px; letter-spacing: .2em; color: var(--soft); }
  .mo .inline-doodle { margin-left: auto; }
  .mo .inline-doodle .doodle { width: 40px !important; height: 40px !important; }

  .shot { margin: 10px 0 8px; background: #fff; padding: 6px; box-shadow: 0 3px 12px rgb(90 70 40 / 14%);
          transform: rotate(-.8deg); }
  .shot img { display: block; width: 100%; height: 132px; object-fit: cover; }
  /* 没照片的月份也要占住同样的高度 —— 塌成 0 高的话，那一块会漂在格子上方。 */
  .shot.blank { background: transparent; box-shadow: none; transform: none; height: 132px;
                border: 1px dashed var(--line); display: flex; align-items: center; justify-content: center; }
  .shot.blank span { font-size: 12px; color: var(--soft); letter-spacing: .12em; }

  .where { margin: 0; font-size: 13px; color: var(--ink); }
  .nums { margin: 3px 0 0; font-size: 11.5px; color: var(--soft); letter-spacing: .06em; }
  .say { margin: 6px 0 0; font-size: 13px; color: #5a4c3c; }

  /* 胶带：跟月报同一套四种，按月份轮换 */
  .mo .tape { position: absolute; top: -10px; left: 50%; width: 66px; height: 18px;
              margin-left: -33px; box-shadow: 0 1px 3px rgb(120 100 60 / 14%); opacity: .92; }
  .tape--kraft { background: rgb(214 196 158 / 82%); transform: rotate(-2.5deg); }
  .tape--grid { background:
      repeating-linear-gradient(0deg, rgb(150 185 215 / 55%) 0 1px, transparent 1px 8px),
      repeating-linear-gradient(90deg, rgb(150 185 215 / 55%) 0 1px, transparent 1px 8px),
      rgb(246 250 253 / 78%); transform: rotate(-8deg); }
  .tape--stripe { background: repeating-linear-gradient(45deg,
      rgb(240 186 186 / 78%) 0 5px, rgb(252 236 236 / 82%) 5px 10px); transform: rotate(6deg); }
  .tape--roll { background: rgb(222 214 190 / 85%); border-radius: 1px 8px 8px 1px;
                box-shadow: 0 2px 4px rgb(120 100 60 / 18%), inset -6px 0 8px rgb(160 145 115 / 22%); }

  footer { margin-top: 40px; padding-top: 14px; border-top: 1px dashed var(--line);
           font-size: 12px; color: var(--soft); display: flex; justify-content: space-between;
           flex-wrap: wrap; gap: 8px; }

  @media (max-width: 700px) {
    .book { padding-left: 34px; }
    .book::before { width: 34px;
      background: radial-gradient(circle at 17px 22px, #b9a68a 0 5px, #6f6152 6px, transparent 7px) 0 0/100% 46px repeat-y,
                  linear-gradient(90deg, #e8dcc4 0 26px, #d9c9a9 26px, transparent 28px); }
    .page { padding: 24px 18px 34px 14px; }
    h1 { font-size: 36px; }
    .months { grid-template-columns: 1fr; }
  }
  @media print { html, body { background: #fff; } .book { box-shadow: none; } }
</style>
</head>
<body>
<div class="book">
  <div class="page">

    <header>
      <p class="kicker">${esc(year)}</p>
      <h1>旅行年报<small>十 二 个 月 · 一 页 纸</small></h1>
      <div class="totals">
        <span><b>${months.length}</b>个月留下东西</span>
        <span><b>${totalCities.size}</b>座城</span>
        <span><b>${totalDays}</b>天</span>
        <span><b>${input.photos.length}</b>张照片</span>
        <span><b>${input.entries.length}</b>篇日记</span>
      </div>
      ${input.nowLine ? `<p style="margin:12px 0 0;font-size:12px;color:var(--soft)">${esc(input.nowLine)}</p>` : ''}
    </header>

    ${months.length ? `<div class="months">${cards}
    </div>` : '<p style="color:var(--soft)">这一年还没攒下照片和日记。</p>'}

    <footer>
      <span>${esc(year)} 年 · 旅行年报 · ${esc(firstSeason === 'spring' ? '春天开的头' : firstSeason === 'summer' ? '夏天开的头' : firstSeason === 'autumn' ? '秋天开的头' : '冬天开的头')}</span>
      <span>每座城只留一张</span>
    </footer>

  </div>
</div>
</body>
</html>
`;
}
