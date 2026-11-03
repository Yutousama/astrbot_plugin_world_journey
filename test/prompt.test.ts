import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, readPromptFile, sanitizePlatformText, stripActionSection } from '../adapter/prompt.ts';

test('动作段被剥掉，并追加聊天平台说明', () => {
  const file = readPromptFile();
  assert.equal(file.hadActionSection, true, 'raw ENV_PROMPT 应该还有动作段；上游改名了要更新 prompt.ts');
  const stripped = stripActionSection(file.text);
  assert.equal(stripped.stripped, true);
  assert.equal(stripped.text.includes('journey.actions'), false);
  assert.equal(stripped.text.includes('身体怎么动'), false);
  assert.ok(stripped.text.includes('### 聊天平台'));
});

test('music_pick 被清洗', () => {
  const text = '刚到这儿。想听就搜一首（装了一起听歌可用 music_pick），搜到自己去放。';
  const out = sanitizePlatformText(text);
  assert.equal(out.includes('music_pick'), false);
  assert.equal(out.includes('一起听歌'), false);
});

test('buildPrompt 变量齐全时没有 missing', () => {
  const vars: Record<string, string> = {};
  for (const key of [
    'journey.version', 'journey.status', 'journey.now', 'journey.withUser',
    'journey.beatGap', 'journey.home', 'journey.homeFeel', 'journey.diary',
  ]) vars[key] = `[${key}]`;
  const prompt = buildPrompt(vars);
  assert.deepEqual(prompt.missing, []);
  assert.equal(prompt.text.includes('{{'), false);
  assert.equal(prompt.text.includes('journey.actions'), false);
});
