import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRaw } from '../adapter/raw.ts';
import { applyEngineConfig, loadEngineConfig } from '../adapter/config.ts';
import { tempDir } from './helpers.ts';

const root = process.cwd();

async function defaults() {
  return (await loadRaw()).JOURNEY_DEFAULTS();
}

test('没有配置时使用 raw 默认值', async () => {
  const dir = tempDir();
  const base = await defaults();
  const loaded = loadEngineConfig(dir, join(dir, 'engine-config.json'), base);
  assert.equal(loaded.cfg.homeCity, base.homeCity);
  assert.equal(loaded.cfg.speed, 1);
  assert.equal(loaded.offline, false);
});

test('engine 覆盖项 + wrapper 开关', async () => {
  const dir = tempDir();
  const path = join(dir, 'engine-config.json');
  writeFileSync(path, JSON.stringify({
    engine: { homeCity: '成都', speed: 4, memoryDir: '/tmp/x', futureField: 'keep-me' },
    wrapper: { offline: true },
  }), 'utf8');
  const loaded = loadEngineConfig(dir, path, await defaults());
  assert.equal(loaded.cfg.homeCity, '成都');
  assert.equal(loaded.cfg.speed, 4);
  assert.equal(loaded.offline, true);
  assert.equal((loaded.cfg as unknown as Record<string, unknown>).futureField, 'keep-me');
});

test('坏 JSON 回退默认值，不覆盖原文件', async () => {
  const dir = tempDir();
  const path = join(dir, 'engine-config.json');
  writeFileSync(path, '{ bad', 'utf8');
  const loaded = loadEngineConfig(dir, path, await defaults());
  assert.equal(loaded.cfg.homeCity, '');
  assert.ok(loaded.notes.some((n) => n.includes('读不出来')));
});

test('applyEngineConfig 删除的字段回到 raw 默认值', async () => {
  const base = await defaults();
  const cfg = { ...base, homeCity: '成都', speed: 4 };
  const next = { ...base, speed: 2 };
  applyEngineConfig(cfg, next, base);
  assert.equal(cfg.homeCity, base.homeCity);
  assert.equal(cfg.speed, 2);
});

/*
 * 上游 1.7.1 那次提醒了我们：`journey.image` 整组配置从**宿主 schema** 里删掉了。
 * 键本身还在 `JOURNEY_DEFAULTS()`，所以套壳没事 —— 但这种「改名/删组」如果哪天砸到
 * 套壳真写的键上，坏法是**静默的**：Python 侧照常把 `imageXxx` 写进 engine-config.json，
 * 上游读不到那个字段，用户的设置一个字都不生效，而且一声不吭。
 *
 * 这条守卫把 Python 壳 `config_map.py` 的 FIELD_MAP 与上游 defaults 钉在一起：
 * 上游删名/改名 → 这里先红。套壳自己造的键（自拍、兼容开关、模板）走显式白名单。
 */
const WRAPPER_OWNED_KEYS = [
  // 出镜自拍那一套（adapter/selfie.ts 读）。
  'selfieEnabled', 'selfieReference', 'selfieReferencePath', 'selfieSubject', 'selfiePrompt',
  'selfieApi', 'selfieKey', 'selfieModel', 'selfieMode', 'selfieEditJson', 'selfieNativeUrl',
  'selfieImageField', 'selfieSize',
  // 套壳维护的模型列表（上游只认一个 imageModel 字符串）。
  'imageModels',
  // 请求形状兼容开关与提示词模板（也是套壳在读）。
  // 接口形状（含它合并掉的旧字段名）与请求字段兼容：也是套壳在读，上游 defaults 没有。
  'imageShape', 'imageCompat',
  'imageNoResponseFormat', 'imageNoSize', 'imageQuality',
  'imagePromptTemplate', 'imagePromptSceneTemplate', 'imagePromptForScene',
] as const;

test('Python 壳 FIELD_MAP 写出的引擎键，要么上游真有，要么在套壳白名单里', async () => {
  const base = await defaults();
  const known = new Set(Object.keys(base));
  const py = readFileSync(join(root, 'plugin', 'astrbot_plugin_world_journey', 'config_map.py'), 'utf8');
  const block = /FIELD_MAP:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\n\}/.exec(py);
  assert.ok(block, '读不到 config_map.py 的 FIELD_MAP（那张表的写法变了？同步改这条测试）');
  const mapped = [...block![1]!.matchAll(/^\s*"[a-z_0-9]+":\s*"([A-Za-z_][A-Za-z0-9_]*)"/gm)].map((m) => m[1]!);
  assert.ok(mapped.length > 20, `FIELD_MAP 只解析出 ${mapped.length} 项，解析八成漏了`);
  const wrapper = new Set<string>(WRAPPER_OWNED_KEYS);
  const unknown = mapped.filter((k) => !known.has(k) && !wrapper.has(k));
  assert.deepEqual(unknown, [], `这些引擎键上游 defaults 里没有，也不在套壳白名单：${unknown.join('、')}`);
});

/*
 * 面板上**故意不放**的上游键：每一项都必须写清理由和「引擎侧怎么兜住」，
 * 否则这条守卫就成了随手放宽 —— 而「用户改不了这一项」正是它要防的那类静默失效。
 * 上游 defaults 里仍然要有这些键（下面照样断言），只是插件表单不呈现。
 */
const PANEL_DROPPED: Record<string, string> = {
  // 车费桥三件：AstrBot 场景没有配套打车扩展；config_map 的 PANEL_DROPPED_ENGINE_DEFAULTS 固定 False。
  bridgeSpend: '车费桥：没有配套打车扩展，引擎侧固定 False',
  bridgeDiary: '车费桥：同上',
  bridgeLive: '车费桥：同上',
  // 云端服务商预设（doubao/openai 一次填三样）：地址/模型/尺寸一律自己填；上游默认就是 custom。
  imagePreset: '预设已去掉；上游默认 custom，不映射即等于 custom',
};

test('1.8.0 新增的上游配置键已接到 AstrBot 表单', async () => {
  const base = await defaults();
  const py = readFileSync(join(root, 'plugin', 'astrbot_plugin_world_journey', 'config_map.py'), 'utf8');
  const schema = JSON.parse(
    readFileSync(join(root, 'plugin', 'astrbot_plugin_world_journey', '_conf_schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  // 上游 defaults 真有这些键（这条同时守住「上游哪天又把它删了」）。
  for (const key of ['imagePreset', 'imageMinimal', 'bridgeSpend', 'bridgeDiary', 'bridgeLive']) {
    assert.ok(key in base, `上游 defaults 没有 ${key}`);
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (key in PANEL_DROPPED) {
      // 故意不上面板：既不能留在 FIELD_MAP（映射着就等于给用户一个看不见的开关），
      // 也不能出现在表单里；理由必须写在这张表上。
      assert.ok(!py.includes(`"${snake}":`), `${snake} 说好了去掉，却还在 FIELD_MAP 里`);
      assert.ok(!(snake in schema), `${snake} 说好了去掉，却还在 _conf_schema.json 里`);
      // 不映射的键必须有兜底：要么上游默认就是我们要的值，要么在 PANEL_DROPPED_ENGINE_DEFAULTS 里固定。
      const forced = new RegExp(`"${key}":`).test(py);
      const upstreamDefaultIsFine = !['bridgeSpend', 'bridgeDiary', 'bridgeLive'].includes(key);
      assert.ok(forced || upstreamDefaultIsFine,
        `${key} 已从面板去掉，但引擎侧既没固定值、上游默认又不是我们要的那一个`);
      continue;
    }
    assert.ok(py.includes(`"${snake}"`), `${snake} 没进 FIELD_MAP —— 用户改不了这一项`);
    assert.ok(snake in schema, `${snake} 没进 _conf_schema.json —— 配置页看不到这一项`);
  }
  // 「接口形状」固定 auto：面板项和映射都去掉了，但旧四键也不能再映射
  // （它们在 TS 里优先级高于模型名猜测，留着就等于让 auto 失效）。
  assert.ok(!py.includes('"image_shape":'), 'image_shape 已固定 auto，不该再映射');
  assert.ok(!('image_shape' in schema), 'image_shape 的面板项该去掉');
  for (const legacy of ['selfie_mode', 'selfie_edit_json', 'selfie_image_field', 'selfie_native_url']) {
    assert.ok(!py.includes(`"${legacy}":`), `${legacy} 还在映射 —— 它会压住固定 auto`);
  }
});
