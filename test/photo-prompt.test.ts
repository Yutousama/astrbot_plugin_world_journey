import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenePrompt } from '../adapter/photo-prompt.ts';
import type { UiSnapshot } from '../adapter/raw.ts';

/** 造一份最小快照：只填套壳会读到的字段。 */
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

test('场景描述带上画面风格、城市、景点、光线和天气', async () => {
  const prompt = await buildScenePrompt(snapshot({
    weather: '小雨',
    feeling: '潮，被子摸上去是凉的',
    timeline: [{ at: '09:30', what: '上午，黄鹤楼', kind: 'activity', past: true }],
  }), '动漫画风');
  // 画风是整句的前缀 —— 这是「画面风格」在主动汇报配图里也能生效的前提。
  assert.match(prompt, /^动漫画风：/);
  assert.match(prompt, /武汉的黄鹤楼/);
  assert.match(prompt, /上午的明亮日光/);
  assert.match(prompt, /天气小雨/);
  assert.match(prompt, /画面里没有人物/);
});

test('在路上拍的是窗外，城市取目的地而不是出发城市', async () => {
  const prompt = await buildScenePrompt(snapshot({
    mode: 'traveling',
    leg: { from: '长沙', to: '武汉', mode: '船' },
    timeline: [],
  }), '动漫画风');
  assert.match(prompt, /在船上往外看的风景，武汉一带的田野、村庄和路/);
  assert.doesNotMatch(prompt, /长沙/);
});

test('抠不出景点就只写城市，不拿「早饭」当地点', async () => {
  const prompt = await buildScenePrompt(snapshot({
    timeline: [{ at: '09:00', what: '早饭，本地人日常吃的那种', kind: 'meal', past: true }],
  }), '');
  assert.match(prompt, /^一张真实旅行照片：武汉，/);
  assert.doesNotMatch(prompt, /早饭/);
});

test('画风填 none 时既不写风格也不写写实句', async () => {
  const prompt = await buildScenePrompt(snapshot({}), 'none');
  assert.doesNotMatch(prompt, /一张真实旅行照片|画风|胶片质感|路过的人/);
  assert.match(prompt, /武汉/);
});
