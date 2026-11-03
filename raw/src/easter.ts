/**
 * 稀有的麻烦 —— 每到一个地方掷一次，命中率不到千分之一。
 *
 * ## 为什么不是「被拐走」
 *
 * 同一个机制可以做得很戏剧，但那个具体设定把陪玩扩展变成了人口拐卖题材。
 * 分量和风险都不对等：它不该出现在一个桌宠里。
 *
 * 所以这里全部是**「她处理不了，得你出手」**这一类 —— 证件和钱没了、高反躺了、
 * 车冻住了、语言不通走错方向。同样是稀有事件、同样需要用户介入，
 * 但它们发生在真实旅行里真的会发生，而且她**确实**一个人搞不定。
 *
 * ## 触发概率
 *
 * 千分之零点八。一次半年旅行大约到站五十次，期望命中 0.04 次 ——
 * 也就是说**大多数人一辈子碰不到一次**。碰到的时候才知道有这么回事，
 * 那才是彩蛋，而不是打卡点。
 *
 * 命中后不会连着来：`lastEasterAt` 里记时间，一天之内不再掷。
 */
import type { City } from './geo/cities.ts';

export interface Trouble {
  readonly id: string;
  /** 只在符合条件的地方发生。写死成「任何地方都行」的只有最后一条。 */
  readonly fits: (city: City) => boolean;
  readonly text: (city: City) => string;
}

/**
 * 千分之零点八。
 *
 * 2026-10-31 曾临时调到 0.35 做链路验证（「到达 → 掷骰 → 推事件 → 她怎么处理」
 * 一次都没跑过，而真实概率靠等是等不到的）。验完已改回 —— **别再加临时值**，
 * 要验链路就把 chance 当参数传给 `rollTrouble`。
 */
const CHANCE = 0.0008;

const has = (city: City, tag: string): boolean => city.tags.includes(tag);
const inCountry = (city: City, ...codes: string[]): boolean => codes.includes(city.country);

export const TROUBLES: readonly Trouble[] = [
  {
    id: 'southeast-pickpocket',
    fits: (c) => inCountry(c, 'TH', 'SG', 'VN'),
    text: (c) => `出事了。${c.name}的夜市里，她的包被人从侧面划开——钱和证件一起没了。
现在人站在最近的派出所门口，语言不太通，填表填到一半停了。
**这件事她一个人办不完。** 得有人替她联系、告诉她下一步去哪、或者干脆汇一笔钱过来。`,
  },
  {
    id: 'altitude',
    fits: (c) => has(c, '高原') || has(c, '雪山'),
    text: (c) => `高反压下来了。${c.name}这边海拔比昨天高出一截，她在旅馆床上躺了一整天，
头疼、想吐、不想吃东西。老板上来看过两次，说了句她没听懂的话。
**这已经不是"多喝热水"能过去的程度。** 要不要下撤、去哪家医院，需要有人拿主意。`,
  },
  {
    id: 'frozen',
    fits: (c) => c.lat > 50 || has(c, '极北'),
    text: (c) => `${c.name}冷得不讲道理。车打不着了，电瓶冻透，手机在外面十分钟就掉到没电。
附近只有一家还开着的小卖部，老板说救援车要等，可能到明天早上。
**今晚得有个安排，这得你来定。** 是花钱找人拖，还是在车里等，她拿不了这个主意。`,
  },
  {
    id: 'wrong-way',
    fits: (c) => inCountry(c, 'CN') && (has(c, '西域') || has(c, '巴扎')),
    text: (c) => `${c.name}这边路牌不太认。她手机没电，问了两个人指的方向不一样，
现在站在一个不知道该往哪走的岔口，天快黑了。
**她需要有人帮她想办法。** 找谁、怎么回去、今晚住哪儿，得有人跟她说清楚。`,
  },
  {
    id: 'stranger',
    fits: () => true,
    text: (c) => `${c.name}，她在路边坐了一会儿。旁边坐下一个也是一个人旅行的人，
聊了几句，说的都是路上那些没什么用的事。
临走对方说了一句「一个人走久了会习惯的」。
她没接话。**这件事她想跟你说，但不知道怎么开口。**`,
  },
];

/**
 * 掷一次。命中返回那条麻烦，否则 null。
 *
 * `rnd` 只在**决定要不要掷**时用一次 —— 命中之后挑哪一条是确定的
 * （第一条符合条件的就是），这样同一个地点重复触发时表现一致。
 *
 * `chance` 只是给测试用的注入口。**生产永远走默认值** ——
 * 把概率写死在函数里，测试要验「不到千分之一」就只能去读源码，
 * 而验证链路时临时调高又会把测试弄红，两头都不对。
 */
export function rollTrouble(
  city: City,
  rnd: () => number = Math.random,
  chance: number = CHANCE,
): Trouble | null {
  if (rnd() >= chance) return null;
  const fits = TROUBLES.filter((t) => t.fits(city));
  if (!fits.length) return null;
  return fits[0];
}
