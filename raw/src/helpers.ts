/**
 * 大肥鱼环游世界 —— 无副作用的纯函数（距离/票价/方位/时刻格式化/文案拼装）。
 *
 * 从 world.ts 拆出（Step 2：纯函数），由 world.ts 统一重导出以保持兼容。
 */
import { CITIES, type City } from './geo/cities.ts';
import { type ModeId } from './geo/modes.ts';
import { localMoment, humanHours } from './clock.ts';
import { feelOf, type Forecast } from './geo/amap.ts';
import { fmtHour, type DayPlan, type BeatKind } from './plan/dayplan.ts';
import type { Pilgrim } from './geo/pilgrim.ts';
import type { Journey } from './plan/journey.ts';
import type { HomeReason } from './state.ts';
import type { MonthlyEntry } from './monthly.ts';
import { DECIDE_HOUR, TRAIN_FAST, TRAIN_SLOW, SLOT_WORDS } from './constants.ts';

/**
 * `before` → `now` 这段里，有没有跨过当地 `DECIDE_HOUR` 那个决定点。
 *
 * 判据只有「跨没跨过那一刻」，**不设「离线多久才算」的阈值**：
 * 阈值定了就必然有人卡在边上（离线 2 小时 1 分 vs 1 小时 59 分），
 * 而真正要防的只有一件事 —— 那一拍的决定权属于「当时在场的她」，不属于开机后的补算。
 *
 * 纯函数，单测直接喂时间，不用起世界。
 */
export function decisionCrossedWhileAway(
  before: Date,
  now: Date,
  tz: string,
): boolean {
  const b = localMoment(before, tz);
  const a = localMoment(now, tz);
  // 今天的决定点还没到 —— 到点儿自然会在正常的巡检里判，不算「被跳过」。
  if (a.decimal < DECIDE_HOUR) return false;
  // 跨了日期：今天的那个决定点一定落在 (before, now] 这段里。
  if (b.dateKey !== a.dateKey) return true;
  // 同一天：只有在 8 点前离开、8 点后回来，才算跨过去。
  return b.decimal < DECIDE_HOUR;
}

/**
 * 铁路的每公里单价 —— **随距离递减**，因为一千公里上下跑的不是同一种车。
 *
 * ## 为什么不是一个数
 *
 * 短途是白天的高铁二等座（0.42 元/公里），长途是夜车硬卧（0.21）。
 * 一个数伺候不了两头：写 0.5，北京到兰州硬卧算 825（实价 322–363）；
 * 写 0.21，成都到西安只剩 138（实价 263–285）。
 *
 * ## 为什么要过渡，而不是在某一公里处劈开
 *
 * 直接 `km < 1000 ? 0.42 : 0.21` 会在 999 公里处出现「多走两公里，票价腰斩」。
 * 那在代码上没错（`journey.ts` 的座位档本来就在 1000 公里处分界），
 * 但用户看到的是「昨天去的城市 420，今天这个 210，明明更远」。
 *
 * 所以 800–1200 之间线性过渡：这一段她本来就可能两样都坐，
 * 单价取两端之间，和「有时高铁、有时卧铺」的期望值对得上。
 */
export function trainUnit(km: number): number {
  if (km <= 800) return TRAIN_FAST;
  if (km >= 1200) return TRAIN_SLOW;
  return TRAIN_FAST + (TRAIN_SLOW - TRAIN_FAST) * ((km - 800) / 400);
}

export const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length) % list.length];

/** 一句话的稳定种子：同样的输入，同样的措辞。用在同伴互动的选句上。 */
export function seedOf(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * `"12:30"` / `"7"` / `"7.5"` → 当地小数小时（2026-11-10）。
 *
 * 只认钟点写法，不认「下午三点」—— 那要语言理解，交给模型，它翻成 `15:00` 再传进来。
 */
export function parseClock(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const colon = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(text);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour >= 24 || minute > 59) return null;
    return hour + minute / 60;
  }
  const decimal = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (decimal) {
    const hour = Number(decimal[1]);
    if (hour >= 24) return null;
    return hour + (decimal[2] ? Number(`0.${decimal[2]}`) : 0);
  }
  return null;
}

export function parseSlotKind(raw: string): BeatKind | null {
  const text = raw.trim();
  if (!text) return null;
  for (const [word, kind] of SLOT_WORDS) if (text.includes(word)) return kind;
  return null;
}

/**
 * 回执里的钟点：`21:30` 这种（2026-11-10）。
 *
 * **不能借用 `fmtHour`** —— 那个是给日记和文案的中文写法（「二十一点半」），
 * 而 `journey_set_slot` 的回执读者是模型：它会把回执里的时刻照抄回来重试，
 * 中文数字进了 `parseClock` 就当场失败。实测过：拦住「住处那格」那条提示
 * 写着「二十一点半」，模型再传「二十一点半」还是同一个错。
 * **回执给什么格式，就得能读回什么格式。**
 */
export function slotClock(h: number): string {
  const whole = Math.max(0, Math.min(23, Math.floor(h)));
  const m = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 回执里的日程摘要（2026-11-10）：一格只留第一小句的开头。
 *
 * 住处那格的 `what` 是整段酒店描述（「回月牙酒店(成都春熙路…)。卫生间做了干湿分开，
 * 排水有点慢；插座在书桌底下，要弯腰找。」）—— 全文塞进「今天剩下的」，
 * 回执又长又没信息量，而模型只需要认出「这一格是什么」。
 */
export function slotBrief(what: string): string {
  const one = what.split(/[，。；、]/)[0] ?? what;
  return one.length > 14 ? `${one.slice(0, 14)}…` : one;
}

/**
 * 一句话里带的钟点（小数小时）。认不出返回 `null`。
 *
 * 只认 `6:30` / `六点半` 两种写法。**认不全没关系** —— 它只用来判断
 * 「正文里的钟点跟这一格对不对得上」，认不出的下场只是少剥一次，不会去改内容本身。
 */
export function clockInText(t: string): number | null {
  const cn: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const m = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return h + mi / 60;
  }
  const c = t.match(/([一二两三四五六七八九十]{1,3})点(半)?/);
  if (!c) return null;
  const raw = c[1]!;
  let h: number | null = null;
  if (raw === '十') h = 10;
  else if (raw.length === 1) h = cn[raw] ?? null;
  else if (raw[0] === '十') h = 10 + (cn[raw[1]!] ?? 0);
  else if (raw[1] === '十') h = (cn[raw[0]!] ?? 0) * 10;
  return h === null ? null : h + (c[2] ? 0.5 : 0);
}

/**
 * 正文里的钟点和这一格对不上时，把那一段剥掉（2026-11-17，Donahue 第三批）。
 *
 * ## 现场
 *
 * 用户把起床格改成「六点半，赶拙政园开门头一趟」，格子本身还在 07:00。
 * `beatText` 的头部写「当地 07:00」，正文又写「六点半」——
 * 她读到的就是「七点起床，六点半…」，用户看到的是件**前后重复**的事。
 *
 * ## 为什么剥而不是提示
 *
 * Donahue 给了两条路（剥掉 / 提示冲突）。选剥：这行字是**天天读的日程**，
 * 每行缀一句「本格内容与时刻不符」会让整张表没法看。写入那一刻已经提醒过一次了
 * （`setSlot` 的回执），渲染层再把矛盾抹平，两边各管一件事。
 *
 * ## 边界
 *
 * 只删**第一处**钟点。一句话里写两个（「六点半起，七点出门」）时，
 * 第二个很可能是真内容（她要描述两件事），这里只处理「渲染时间对不上」这一个毛病，
 * 不做时间轴解析。
 */
export function stripClashClock(what: string, at: number): string {
  const found = clockInText(what);
  /*
   * 3 分钟以内不算矛盾。人写钟点会取整会手滑，而 `findSlotBeat` 那头的精确匹配
   * 用的是 1.2 分钟（找格子要准），**判冲突不需要那么准** —— 用同一个阈值会把
   * 「7:02 起床」当成冲突剥掉，正好剥掉她本来写对的东西。
   */
  if (found === null || Math.abs(found - at) < 0.05) return what;
  const clean = what
    .replace(/(\d{1,2})\s*[:：]\s*(\d{2})|[一二两三四五六七八九十]{1,3}点(半)?/, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,、\s]+/, '')
    .trim();
  /* 剥空了就退回原文 —— 「六点半」单独一格的极端情况，剥掉等于把这一格删了。 */
  return clean || what;
}

/* ---------------- 对外自描述 ---------------- */

/**
 * 这个月当地有节的城市。
 *
 * 一个月一次就够：挑目的地不会一小时一次，算一遍比缓存省事。
 * 只回 id，具体的「是什么节」由 `dayplan.ts` 的 `festivalOn` 负责 ——
 * 那边管"当天撞上什么"，这边只管"值不值得为这个月专门跑一趟"。
 */
/**
 * 封面右下角那句手写：**用她自己那天写下的原话**。
 *
 * 不让模型编一句「今日份的诗意」—— 编出来的东西和正文里那些日记一对照就露馅。
 * 那天没写日记就往前找最近的一篇；整月都没写就留空，宁可不写。
 */
export function coverLine(entries: readonly MonthlyEntry[], dateKey: string): string {
  if (!entries.length) return '';
  const day = (k: string): number => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86400000;
  };
  const target = day(dateKey);
  let best: MonthlyEntry | null = null;
  let bestGap = Infinity;
  for (const e of entries) {
    const gap = Math.abs(day(e.dateKey) - target);
    if (gap < bestGap) { best = e; bestGap = gap; }
  }
  if (!best) return '';
  const t = String(best.body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const stop = t.search(/[。！？!?]/);
  const one = stop > 0 ? t.slice(0, stop + 1) : t;
  return one.length > 22 ? `${one.slice(0, 21)}…` : one;
}

/**
 * 约定里「跟谁」。
 *
 * 2026-11-05 之前一条邀约只能成一对，所以到处直接拼 pledge.withPet。
 * 现在一条邀约最多三只鱼接，得能说「小满和小汐」「小满、小汐、阿澈」。
 *
 * 老数据没有 `withPets`，那就退回单个人 —— 不要用空数组把它盖掉。
 */
export function whoOf(p: { withPet: string; withPets?: readonly string[] }): string {
  const list = (p.withPets && p.withPets.length ? p.withPets : [p.withPet])
    .filter((x): x is string => typeof x === 'string' && !!x && x !== '一只鱼');
  if (!list.length) return '一只鱼';
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]}和${list[1]}`;
  return list.slice(0, 3).join('、');
}

/**
 * 这份约定里的**每一个人**，分开列。
 *
 * `whoOf` 是给**句子**用的（「小满和小汐」），这个函数是给**记账**用的。
 * 两者不能混：拿拼接串当人名去记账，会往记忆里写进一个叫「小满、小汐、阿澈」的假人。
 *
 * 2026-11-11 修的就是这件事 —— `rememberPet(this.whoOfPledge(atDest), 6)`
 * 单人时看不出问题（拼接串恰好等于那个名字），三个人一起走到站就炸：
 * 记忆里多出一个假人，而真正的三个人一个都没记上。
 *
 * 去重是必要的：服务端一条邀约的接单记录可能重复回同一个人
 * （`INSERT OR IGNORE` 之前的历史数据、或者两次轮询之间名单变了）。
 * 重复记一次就等于把 `times` 多加一次，那是事实错误，不是显示问题。
 */
export function namesIn(p: { withPet: string; withPets?: readonly string[] }): string[] {
  const raw = (p.withPets && p.withPets.length ? p.withPets : [p.withPet])
    .map((x) => String(x ?? '').trim())
    .filter((x) => !!x && x !== '一只鱼');
  return [...new Set(raw)];
}

/**
 * 散伙那一刻催她写印象的那句话。没有该问的人就返回空串。
 *
 * 抽成纯函数有两个理由：一是 `st.pets` 那层读不到就测不了，而「谁该问、谁不该问」
 * 正是这里最容易写错的地方；二是这段文案会直接进她的上下文，改一个字就该有测试兜着。
 *
 * **只问还空着的。** 已经写过的人不再问 —— 第二次同行要不要更新是她的自由，
 * 每回都催一句就成了打卡任务。
 *
 * **给退路。** 结尾必须留「空着没关系」。少了这一句，她会为了完成任务
 * 编一句「是个好旅伴」—— 那是这个字段最没用的形态。
 */
export function impressionAsk(
  names: readonly string[],
  pets: Readonly<Record<string, { impression?: string } | undefined>>,
  days: number,
): string {
  const blank = names.filter((n) => !String(pets[n]?.impression ?? '').trim());
  if (!blank.length) return '';
  const d = Math.max(1, Math.floor(Number(days) || 1));
  return `（这一趟 ${d} 天。这几天里要是真记住了${blank.join('、')}的什么，`
    + '用 `journey_pet` 给她写一句印象存下来 —— 一件具体的事，'
    + '不是「人很好」「好旅伴」这种换个名字也成立的话。没记住就空着，这格空着没关系。）';
}

export function festivalCities(month: number): string[] {
  if (!Number.isFinite(month)) return [];
  return CITIES
    .filter((c) => c.festivals.some((f) => f.months.includes(month)))
    .map((c) => c.id);
}

/* ---------------- 文案：给事实，不给台词 ---------------- */

/**
 * 天气那一行。**只给体感和数字，不给天气播报。**
 *
 * 写「晴转多云，15~27℃」她会照着念；写「热，走两步就出汗」她才会说人话。
 * 查不到天气就返回空串 —— 不要写「天气未知」，那也是在念一个字段。
 */
/**
 * 生图走哪条协议。**默认 openai，只有明确写了 comfy 才切。**
 *
 * 宽容一点认写法（`ComfyUI` / `comfy` / `comfy ui`），但不认模糊说法 ——
 * 用户填了看不懂的词，宁可当云端处理（那是绝大多数人的配置），
 * 也不要靠猜去切一条他根本没配的链路。
 */
export function photoProtocolOf(raw: string): 'openai' | 'comfyui' {
  return /^\s*comfy/i.test(raw ?? '') ? 'comfyui' : 'openai';
}

/**
 * 这张图要不要裁掉底边那条水印。
 *
 * `auto` 的判断依据是**协议，不是图像识别**：
 * 本地 ComfyUI 出的图不可能带水印（「AI生成」是服务商出图后盖上去的），
 * 所以只裁云端那些。这个事实比 OCR 可靠得多，也不用为每张图算一遍。
 *
 * 不做自动检测的另一个理由：漏检的代价是水印留在图上（用户看得见、能再处理），
 * 误检的代价是把好画面裁掉一截（用户根本不知道本来有）。
 */
export function shouldCropWatermark(mode: string | undefined, protocol: string): boolean {
  if (mode === 'off') return false;
  if (mode === 'crop') return true;
  // 空 / 认不出的值一律按 auto 走：配置写错了不该让水印漏出来。
  return protocol !== 'comfyui';
}

/**
 * 一段正文压成一句摘要 —— 按月列目录时每天只占一行。
 *
 * 取到第一个句号为止，再按字数硬截：她一句话常常就二三十字，
 * 不截的话一个月的目录能有两千字，那就不是目录了。
 */
export function gist(body: string, max = 34): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const first = flat.split(/[。！？.!?]/)[0] ?? flat;
  return first.length <= max ? first : `${first.slice(0, max)}…`;
}

/**
 * 这一趟是怎么收的，一句事实。
 *
 * 2026-11-04 加。这句同时进 `{{journey.now}}`（系统前缀）和 `journey_now` 的工具回执 ——
 * 她回家那几天写日记、答「这趟怎么样」，读到的都是这一句。
 *
 * **只给事实，不给情绪词。** 写成「心里空落落的」她会照抄；写成「是被上限掐断的」，
 * 情绪由她自己决定 —— 同样是到上限，累垮了和舍不得是两种收场，那该由她判断。
 */
export function homeReasonText(r: HomeReason | null): string {
  switch (r) {
    case 'limit': return '这一趟是到出门上限被掐断的，不是你自己待够了。';
    case 'broke': return '这一趟是钱撑不下去才回来的，不是玩够了。';
    case 'called': return '这一趟是他叫你回来，你才收的。';
    case 'done': return '这一趟是你自己待够了，正常收的。';
    default: return '';
  }
}

export function weatherLine(w: Forecast | null): string {
  if (!w) return '';
  const feel = feelOf(w);
  return `\n天气：${w.dayWeather}，${feel ? `夜里 ${w.nightTemp}℃，${feel}` : `夜里 ${w.nightTemp}℃`}。`;
}

export function partWord(p: string): string {
  const map: Record<string, string> = {
    late: '后半夜', dawn: '天没亮', morning: '上午', noon: '中午',
    afternoon: '下午', evening: '傍晚', night: '夜里',
  };
  return map[p] ?? p;
}

/**
 * 路上那一段发生什么。
 *
 * **按交通方式写，不按城市写** —— 同样是二十五趴，在火车上和在船上完全是两回事。
 * 内容只给事实和数量，不给成句台词：写「可以说：这风吹得人想哭」，
 * 她就会连着三天念同一句。
 *
 * 夜里的节点会换一套说法 —— 半夜的服务区和下午的服务区，不是同一个地方。
 */
/**
 * 按一个字符串算出一串稳定的伪随机数。
 *
 * 2026-11-03 Mr.Q：「她每天的宾馆本身都定下来了，后面又换了一家旅馆」。
 *
 * 根因：`plan` 只活在内存里（`this.plan = null` 满天飞，没有任何一处从磁盘恢复），
 * 所以**每重启一次扩展，住宿就重新掷一次**。那天为了发版重启了十二次，
 * 她就在同一天里换了十二家店。
 *
 * 用种子代替 `Math.random`：同一次入住、同样的钱况，重启多少次都是同一家。
 * 钱紧了种子跟着变（下面加了后缀），所以「紧就换一家便宜的」那条逻辑照样成立。
 */
export function seededRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * 用户嘴里的「怎么去」翻译成 `ModeId`。
 *
 * 只认**明确**的说法。认不出来就返回 null，让上层问她一句 ——
 * 猜错的代价是他明明说坐高铁、她上了飞机，那和这一轮要修的 bug 是同一个。
 *
 * 顺序有讲究：`高铁|动车` 要排在 `动车|车` 那些更宽的模式前面，
 * 否则「动车」会被 `car` 的「车」先吃掉。
 */
export function modeIdOf(word: string): ModeId | null {
  const s = word.trim();
  if (!s) return null;
  const rules: [RegExp, ModeId][] = [
    [/高铁|动车|火车|铁路|列车|train|rail/i, 'train'],
    [/飞机|航班|机票|飞过去|飞|plane|flight|fly/i, 'plane'],
    [/自驾|开车|汽车|租车|拼车|car|drive/i, 'car'],
    [/大巴|长途汽车|客车|公交|班车|bus|coach/i, 'bus'],
    [/轮船|渡轮|客轮|船|ship|ferry|boat/i, 'ship'],
    [/摩托|机车|motorcycle|motorbike/i, 'motorcycle'],
    [/自行车|单车|骑行|bike|bicycle|cycle/i, 'bike'],
    [/电瓶车|电动车|scooter|e-bike/i, 'scooter'],
    [/步行|走路|徒步|腿儿|walk|on foot/i, 'walk'],
  ];
  for (const [re, id] of rules) if (re.test(s)) return id;
  return null;
}

export function roadText(  modeId: string, idx: number, leg: Journey, from: City, to: City, hour: number, progress = 0,
): string {
  const night = hour >= 21 || hour < 6;
  // 按调用方给的真实进度算剩余，而不是拿 idx 反推 —— 短途只有一个节点（idx=1），
  // 反推出来的「还有三小时」和实际剩一小时会差得很远。
  const left = Math.max(0, Math.round(leg.durationWorldHours * (1 - progress)));
  /*
   * 剩余时间走 `humanHours`，不再直接写「${left} 小时」。
   *
   * 跨洋的船一趟四百多小时，直写就是「还有大约 448 小时」—— 数字没错，
   * 但没人这么说话，而且得读者自己换算。改成「还有大约 19 天」。
   */
  const tail = left > 0 ? `还有大约 ${humanHours(left)}。` : '';
  const route = `${from.name} → ${to.name}`;

  switch (modeId) {
    case 'car':
    case 'motorcycle':
      if (idx === 0) return night
        ? `服务区，加油。夜里只有两三家还开着，热食柜是空的。${route}，${tail}`
        : `服务区，加油。油价比出发时贵几毛，买了瓶水和一包饼干。${route}，${tail}`;
      if (idx === 1) return night
        ? `又在服务区停了一下，洗了把脸。镜子里眼睛是红的。${tail}`
        : `服务区吃饭。快餐窗口排了几个人，菜是温的。${tail}`;
      return night
        ? `还在开。路上只剩车灯，对面偶尔来一辆。腰开始酸。${tail}`
        : `天开始变了颜色。路边的牌子换成了一个没听过的地方名。${tail}`;

    case 'train':
      if (idx === 0) return night
        ? `过站，停了两分钟。站台上没人上车，广播念了一串站名。`
        : `过了一个大站，下去一批人，上来一批人。车厢里的口音变了。`;
      if (idx === 1) return night
        ? `车厢灯调暗了。邻座的呼吸声很匀，窗外只剩偶尔的一盏灯。${tail}`
        : `去餐车。盒饭三十块，米饭有点硬，汤是免费的。${tail}`;
      return night
        ? `醒了一次，不知道停在哪儿。看了看表，还能再睡一会儿。`
        : `窗外的地貌已经换了。刚才还是平原，现在开始有坡。${tail}`;

    case 'bus':
      if (idx === 0) return `中途停了一个站，上来几个人，行李塞在过道上。`;
      if (idx === 1) return night
        ? `服务区，二十分钟。下车的人都在抽烟，空气里全是那个味道。${tail}`
        : `服务区，二十分钟。买了碗泡面，蹲在花坛边上吃完。${tail}`;
      return night
        ? `车里只剩几盏小灯。有人打呼，司机没开广播。${tail}`
        : `快到了。前排的人开始收拾东西，有人站起来又坐下。${tail}`;

    case 'ship':
      if (idx === 0) return `出了港，岸上的灯缩成一条线。风比刚才大，站不太稳。`;
      if (idx === 1) return night
        ? `夜里在甲板上。水是黑的，船的声音从脚底下一直传上来。${tail}`
        : `船上吃饭。菜偏咸，米饭管够。窗外一直是同一个水平线。${tail}`;
      return night
        ? `天还没亮，甲板上已经有人在等。风冷得站不住。`
        : `快到岸了。能看见岸上的房子和一条上坡的路。${tail}`;

    case 'plane':
      if (idx === 0) return `起飞后平稳了。遮光板拉开，下面是云，什么也看不见。`;
      if (idx === 1) return `发餐。铝箔盒里的菜温的，面包是凉的。${tail}`;
      return `开始下降。耳朵有压力，咽了一下才好。窗外能看见地面了。${tail}`;

    case 'walk':
      if (idx === 0) return `走了四分之一。鞋里进了点土，坐在路边倒了倒。`;
      if (idx === 1) return `水喝掉一半。前面还是个坡，看不见顶。${tail}`;
      return night ? `天黑了，只能借着最后一点光走。` : `腿开始不听使唤，一步比一步慢。${tail}`;

    case 'bike':
    case 'scooter':
      if (idx === 0) return `停在路边歇了一会儿。手被风吹得发麻。`;
      if (idx === 1) return night
        ? `路灯一盏一盏过。电量掉得比预想快。${tail}`
        : `找了家小店买水。老板问去哪儿，说了个地名，他点点头。${tail}`;
      return `快到了。路边开始有人和房子。${tail}`;

    default:
      return `还在路上。${tail}`;
  }
}

/**
 * 把一个作息节点说成事实。
 *
 * **这里只写事实和数量，不写成句的台词。** 写「可以说：这风吹得人想哭」，
 * 她就会一字不差地念出来，连着三天都念同一句。
 */
/**
 * 巡礼那半句。**放在 `what` 之后单独拼，不并进去** —— `what` 是排程事实，
 * 这一句是「这地方还有另一个身份」，两件事分开她才分得清哪句能改哪句不能。
 */
/** 今天行程里挂得上作品的几处，一句话一条。没有就是空数组。 */
/**
 * 把用户说的地名对到这座城真有的那一处（2026-11-09）。
 *
 * 三级匹配，从严到宽：
 *
 * 1. 完全一样（`故宫` 对 `故宫`）
 * 2. 城里的名字包含他说的（`故宫` → `故宫博物院`）
 * 3. 他说的包含城里的名字（`我想去故宫看看` → `故宫`）
 *
 * 匹配不上就返回 null —— **绝不模糊到「差不多就行」**。
 * 排在最后那条泛化说法（`城里随便走走`）也算一处真地方，但它不该被
 * 一个具体地名顶掉：那样等于「你说去故宫，我给你排了个『随便走走』」。
 */
export function matchSpot(spots: readonly string[], want: string): string | null {
  const w = want.trim();
  if (!w) return null;
  return spots.find((x) => x === w)
    ?? spots.find((x) => x.includes(w))
    ?? spots.find((x) => w.includes(x))
    ?? null;
}

export function todayPilgrimLines(plan: DayPlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of plan.beats) {
    if (b.kind !== 'activity' || !b.pilgrim) continue;
    if (seen.has(b.pilgrim.spot)) continue;
    seen.add(b.pilgrim.spot);
    out.push(pilgrimNote(b.pilgrim));
  }
  return out;
}

export function pilgrimNote(p: Pilgrim): string {
  return `这地方也出现在：${p.works.map((w) => `《${w.title}》——${w.scene}`).join('；')}`;
}

export function beatText(
  city: City, plan: DayPlan, kind: string, at: number, what: string, pilgrim?: Pilgrim,
): string {
  const head = `${city.name}，当地 ${fmtHour(at)}。`;
  /*
   * 正文里自带的钟点跟这一格对不上，先剥掉（2026-11-17）。
   *
   * `head` 已经报了「当地 07:00」，正文再写「六点半」就是两个时间摆在一起。
   * 详见 `stripClashClock` 的注释 —— 写入时提醒过一次，这里是渲染时抹平。
   */
  what = stripClashClock(what, at);
  // 统一在这里收句号，并压掉重复标点。
  //
  // 酒店的体感（`lodging.feel`）本身是整句、自带句号，拼上「价格」那句就会变成
  // 「…煮鸡蛋。。180 块一晚」。收尾只去一个还不够 —— 2026-10-31 实测在日记事件里
  // 真出现过双句号。所以先合并再收尾。
  const tidy = (body: string): string =>
    `${head}${body.replace(/。{2,}/g, '。').replace(/[。\s]+$/, '')}。`;

  switch (kind) {
    case 'sunrise':
      return tidy(`看日出，天还没全亮，人不多${plan.sunriseHour !== null ? `。当地日出 ${fmtHour(plan.sunriseHour)}` : ''}`);
    case 'hotel':
      // 酒店那句的 what 里已经写了房型和体感，这里只补价格，别再说一遍房型。
      return tidy(`${what}。${plan.lodging.price} 块一晚`);
    /*
     * **路上那一段要说多久**（2026-11-11）。
     *
     * 原来没有这个分支，`commute` 走 default —— 事件文本只有「打车去兵马俑」，
     * 一个字不提路上要花多久。而用户听到的是「打车 34 分钟」然后转眼就到：
     * 时间轴上是真占了 34 分钟（`planDay` 把通勤排在活动前），
     * 可她手上的两句话（「打车去X」和「14:34 到X」）之间没有任何东西把这段连起来。
     *
     * 时长不用另存 —— 下一个非通勤节点的时刻减去这一段的时刻就是，
     * 而 `planDay` 正是照这个关系排的。
     */
    case 'commute': {
      const nextBeat = plan.beats.find((b) => b.at > at && b.kind !== 'commute');
      const min = nextBeat ? Math.round((nextBeat.at - at) * 60) : 0;
      return tidy(min > 0 ? `${what}，路上 ${min} 分钟` : what);
    }
    case 'sleep':
    case 'wake':
    case 'breakfast':
    case 'lunch':
    case 'dinner':
    case 'activity':
      return tidy(pilgrim ? `${what}。${pilgrimNote(pilgrim)}` : what);
    case 'night':
    case 'arrive':
    default:
      return tidy(what);
  }
}

