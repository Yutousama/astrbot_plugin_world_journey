import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenePrompt } from '../adapter/photo-prompt.ts';
import type { UiSnapshot } from '../adapter/raw.ts';

/**
 * 造一份最小快照：只填套壳会读到的字段。
 *
 * 注意 `place.id` 就是上游的 city id，`leg.progress` 是上游给的**百分数**
 * （`Math.round(progress * 100)`）；在路上时 `place` 是出发城，到站才换成目的地。
 */
function snapshot(overrides: Record<string, unknown>): UiSnapshot {
  return {
    dateKey: '2026-11-04',
    clock: '09:00',
    mode: 'staying',
    place: { id: 'wuhan', name: '武汉' },
    trip: { visited: 1 },
    diary: { days: 1 },
    photos: [],
    wishes: [],
    ...overrides,
  } as unknown as UiSnapshot;
}

const STYLE_ONLY = { style: '动漫画风' };

test('场景描述带上画面风格、城市、景点、光线和天气', async () => {
  const prompt = await buildScenePrompt(snapshot({
    weather: '小雨',
    feeling: '潮，被子摸上去是凉的',
    timeline: [{ at: '09:30', what: '上午，黄鹤楼', kind: 'activity', past: true }],
  }), STYLE_ONLY);
  // 画风是整句的前缀 —— 这是「画面风格」在主动汇报配图里也能生效的前提。
  assert.match(prompt, /^动漫画风：/);
  assert.match(prompt, /武汉的黄鹤楼/);
  // 传了 cityId（place.id）才会拿到上游那张**真景点锚点**表里的句子 —— 这条是
  // 「汇报配图与相册同源」最硬的证据：0.8.6 时期只给地名，画出来只能是「武汉的某处」。
  assert.match(prompt, /攒尖顶/);
  // 上游 1.6.16 起按真实天气与太阳高度说光：小雨的上午**不该**再出现「明亮日光」。
  assert.match(prompt, /看不出太阳在哪/);
  assert.doesNotMatch(prompt, /明亮日光/);
  // 天气不再写成「天气小雨」那种标签，而是画得出来的事实。
  assert.match(prompt, /雨丝|湿得反光/);
  assert.match(prompt, /潮，被子摸上去是凉的/);
});

test('在路上：过半才算到目的地那一带（上游 1.11 的判据）', async () => {
  const road = (progress: number | undefined) => buildScenePrompt(snapshot({
    mode: 'traveling',
    place: { id: 'changsha', name: '长沙' },
    leg: { from: '长沙', to: '武汉', mode: '船', ...(progress === undefined ? {} : { progress }) },
    timeline: [],
  }), STYLE_ONLY);

  // 前半程：窗外还是出发地那一带。原来这里一律取目的地，于是「刚出发两小时」就成戈壁滩。
  const early = await road(20);
  assert.match(early, /长沙一带/);
  assert.doesNotMatch(early, /武汉/);

  // 过半之后才换目的地，并且用上游 cityByName 把 leg.to 反查成 id 去判光。
  const late = await road(80);
  assert.match(late, /武汉一带/);
  assert.doesNotMatch(late, /长沙/);

  // 没有 progress 就当没过半：宁晚勿早。
  const unknown = await road(undefined);
  assert.match(unknown, /长沙一带/);
});

test('跨经度的路：判光跟着目的地走，不是按赤道算', async () => {
  // 喀什 19 点天还亮着（东经 76°，比北京时间晚约 3 小时）。不传 cityId 时上游按
  // lat=0 算，19 点直接判黑 —— 这条守住「在路上也反查 id」这个改动的意义。
  const prompt = await buildScenePrompt(snapshot({
    clock: '19:00',
    mode: 'traveling',
    place: { id: 'changsha', name: '长沙' },
    leg: { from: '长沙', to: '喀什', mode: '火车', progress: 80 },
    timeline: [],
  }), '');
  assert.match(prompt, /喀什一带/);
  assert.match(prompt, /天还是蓝的|光从很低的角度/);
  assert.doesNotMatch(prompt, /头顶是黑的/);
});

test('小时按四舍五入判光（18:40 算 19 点）', async () => {
  const prompt = await buildScenePrompt(snapshot({ clock: '18:40' }), '');
  // 上游 photoSceneNow 用 Math.round(decimal)：18:40 是 19 点，十一月夜里的武汉没有日光。
  assert.match(prompt, /天是深灰的|头顶是黑的|星星/);
});

test('抠不出景点就只写城市，不拿「早饭」当地点', async () => {
  const prompt = await buildScenePrompt(snapshot({
    timeline: [{ at: '09:00', what: '早饭，本地人日常吃的那种', kind: 'meal', past: true }],
  }), { style: '' });
  assert.match(prompt, /^一张真实旅行照片：武汉，/);
  assert.doesNotMatch(prompt, /早饭/);
});

test('画风填 none 时既不写风格也不写写实句', async () => {
  const prompt = await buildScenePrompt(snapshot({}), { style: 'none' });
  assert.doesNotMatch(prompt, /一张真实旅行照片|画风|胶片质感|路过的人/);
  assert.match(prompt, /武汉/);
});

test('画面风格之外的两件生图配置也要生效：出人与极简', async () => {
  // 上游自动拍照那一路传的是 style / minimal / cast（1.8.0 maybePhoto）。
  // 少传一件就会变成「相册按设置出图、汇报图不按设置」—— 和当初画风不生效同一类分裂。
  const withCast = await buildScenePrompt(snapshot({}), { style: '', cast: '一个扎马尾的广东女生，背影' });
  assert.match(withCast, /画面里有一个人：一个扎马尾的广东女生，背影/);

  const bare = await buildScenePrompt(snapshot({}), { style: '' });
  assert.doesNotMatch(bare, /扎马尾/);

  const minimal = await buildScenePrompt(snapshot({
    timeline: [{ at: '09:30', what: '上午，黄鹤楼', kind: 'activity', past: true }],
  }), { style: '', minimal: true });
  // 极简模式：只留地名+景点+时段，锚点长句和气候句整段撤掉。
  assert.match(minimal, /武汉黄鹤楼/);
  assert.doesNotMatch(minimal, /胶片颗粒|随手拍|香樟|煨汤/);
});
