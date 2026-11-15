# 大肥鱼环游世界 · AstrBot 套壳（开发仓库）

插件发布仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey_release>
插件作者：**yutou**

本仓库是**开发仓库**，维护：

```text
raw/          上游 coopani-world-journey 源码（只读基线，当前 1.8.0）
adapter/      TypeScript 套壳：宿主、配置、事件、媒体、提示词、生图提示词、HTTP、模拟
scripts/      构建、部署、npm 源码更新、校验
test/         92 项测试
docs/         架构与上游更新文档（本地目录，.gitignore 排除，不提交到本仓库）
plugin/       本地构建/联调目录（.gitignore 排除，不提交到本仓库）
```

`plugin/astrbot_plugin_world_journey/` 是发布用的插件根目录。它从上面的发布仓库克隆，
由本仓库 `npm run build` 写入 `engine/` 和 `raw/` 副本；插件本体不在本开发仓库跟踪。

## 原项目与致谢

本项目建立在 **Mr.Q** 的原项目
[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey) 之上。

感谢 Mr.Q 写出并持续维护这套旅行引擎：城市/路线、交通、天气、作息、日记、旅行记忆、
照片、事件流等核心逻辑都来自原项目。没有原项目，就没有这个插件。

- 原项目：<https://www.npmjs.com/package/coopani-world-journey>
- 作者：Mr.Q
- 许可：MIT

## 本地准备

需要 Node **22.7+**。22.7–25.x 用 Node 自带的 `--experimental-transform-types` 跑上游 TS；
**Node 26 起该 flag 被移除**，插件会自动改用随包发布的 `engine/amaro` 转换器，不需要你配置。

```bash
git clone https://github.com/Yutousama/astrbot_plugin_world_journey_release.git \
  plugin/astrbot_plugin_world_journey
npm install
npm run check
npm run build
```

`plugin/` 在本仓库被忽略，所以发布仓库本身是一个独立的 Git 仓库：

```bash
cd plugin/astrbot_plugin_world_journey
git status
```

## 开发

```bash
npm run check          # typecheck + 92 项测试 + upstream hash/契约
npm run sim -- --days 7 --speed 24 --seed 42 --data ./data/sim --offline
npm run status -- --data ./data/sim --offline
npm run prompt -- --data ./data/sim --offline
```

`npm run sim` 用虚拟时钟驱动 raw：停掉 raw 定时器，用 `compat/private.ts` 的私有 tick 推进。
生产 sidecar 不依赖私有 tick，raw 自己按真实时间巡检。

## 构建与发布

`npm run build` 会：

- 把 `raw/` 复制到 `plugin/astrbot_plugin_world_journey/raw/`；
- 用 esbuild 生成 `engine/sidecar.mjs` 和 `engine/update.mjs`；
- 写入 `engine/upstream.json`；
- 校验 `raw/` 构建前后 hash 未变。

构建后在发布仓库提交：

```bash
cd plugin/astrbot_plugin_world_journey
git add -A
git commit -m "build: v1.0.0"
git push
```

发布仓库根目录就是 AstrBot 插件根目录，包含 `metadata.yaml`、`main.py`、`logo.png`、
`engine/`、`raw/`，可直接被 AstrBot 解析/安装。

## 上游更新

### 在 AstrBot 里

```text
/journey_update            # 更新到 npm 最新
/journey_update 0.5.25     # 更新到指定版本
```

更新器会校验 npm `dist.integrity`，替换发布仓库的 `plugin/raw/`，失败自动回滚。

### 在开发仓库里

```bash
npm run upstream:update    # 从 npm 更新 raw/（--install，自动备份）
npm run upstream:check     # 版本、变更文件、契约扫描
npm test
npm run upstream:accept    # 只写 upstream.lock.json
npm run build              # 重新生成 sidecar/update/插件 raw 副本
```

详见本地 `docs/upstream-update.md`（`docs/` 已被 `.gitignore` 排除，不入库）。

## 架构

```text
raw/                     上游源码基线（只读）
  ↓ 构建时复制
plugin/.../raw/          安装后的上游源码（运行时动态加载/更新目标）
plugin/.../engine/
  sidecar.mjs            adapter 套壳（动态 import raw，约 104KB）
  update.mjs             npm registry 更新器
  ↓ 回环 HTTP（token）
main.py / bridge.py      AstrBot 命令、工具、提示词、主动消息、sidecar 生命周期
```

提示词注入使用 `req.extra_user_content_parts` + `TextPart.mark_as_temp()`，作为仅本轮可见的
临时 user 内容块，不拼接 `system_prompt`，避免破坏 prompt cache。

套壳只依赖上游少量公开面：

| 上游 | 套壳用法 | 上游变了怎么办 |
|---|---|---|
| `JourneyWorld` 构造 | `adapter/raw.ts`（动态 import） | 改这一处。1.6.19 起可选 `keys`/`persist` **故意不传**：不传就不发生「密钥搬进 `.env` 并清空配置」，key 继续由 AstrBot 表单管 |
| `start/stop/tools/envPromptVars/webUi` | `adapter/bridge.ts` + `contract.ts` | 契约测试会报 |
| `host.log/pushEvent`（上游只用这两个） | `adapter/host.ts` | 未知成员 no-op 兜底 |
| `photo.ts` 的 `photoPrompt/spotFromBeat` | `adapter/photo-prompt.ts`（动态 import，只读复用） | 拍照与汇报配图退回旧提示词并写 warn，旅行不中断 |
| `geo/cities.ts` 的 `cityByName` | 同上，用来把路上目的地**名**反查成 city id（缺了就退化，不报错） | 少了这个只影响画面锚点/判光，不会挂 |
| 私有 `tick`/`*Timer` 字段 | 只在 `adapter/compat/private.ts` 的模拟里（清单按对象上真实存在的 `*Timer` 逐个停） | 只影响模拟，不影响插件；测试会红 |

上游 1.8.0 的面板已有 5 页（`now/album/diary/mates/settings`）、23 个工具、事件多出
`journey.car/part/ride`；工具与事件是动态透传的，**加东西不用改壳**，只有做聊天侧快捷
指令时才动 `main.py`（现有三条：`/journey_eat`、`/journey_signpost`、`/journey_mates`）。
`settings`（生图设置）那一页是 Coopani 专属，套壳不接——AstrBot 有自己的配置表单与热重载。

安装后的 sidecar 用 Node 直接运行 `plugin/raw/src/*.ts`，所以更新源码只要替换 raw 目录 +
重启 sidecar，不用重新编译 adapter。跑 TS 的能力有两种来源：Node 22.7–25.x 用
`--experimental-transform-types`；Node 26+ 用随包发布的 `engine/amaro`（`--import` 一个
SWC/WASM loader，`raw/` 仍是磁盘上的 TS，热更新不受影响）。具体走哪条由 `bridge.py` 的
能力探针决定。

## 插件使用

命令、配置、自拍、主动汇报、控制范围、重置等说明见发布仓库：

- <https://github.com/Yutousama/astrbot_plugin_world_journey_release>
- 或本地 `plugin/astrbot_plugin_world_journey/README.md`

## 数据

插件数据在 `<AstrBot data>/plugin_data/astrbot_plugin_world_journey/`，包括：

- `engine/state.json`：位置/路线/时钟，只在本机
- `engine/diary/2026-11.md`：月文件日记
- `engine/diary/travel-memory.json`：去过/想去/花销，可跟同步盘
- `engine/photos.json` + `engine/media/`：照片
- `engine/events.jsonl`：事件流
- `engine-config.json`：AstrBot 配置映射结果
- `plugin_state.json`：last_seq / last_umo / event_log_id
- `logs/sidecar.log`：sidecar 日志

`memory_dir` 留空时日记/记忆在 `engine/diary`；填同步盘则跟人走，`state.json` 仍只在本机。

## 已知限制

- 需要 Node 22.7+（22.7–25.x 原生转换；26+ 自动走内置 `engine/amaro`）；没有 Node 时插件会明确报错（可配 `node_path`）。
- 主动消息默认关闭；需要配置 `event_target` 或先和机器人说话，再打开。
- `raw/` 的立绘动作/音乐扩展联动不适用于 AstrBot；提示词会剥掉动作段。
- 上游私有 `tick` 只用于模拟；上游改了它只影响模拟，不影响插件运行。
- 运行时更新只更新**上游源码**；本套壳/Python 代码仍随插件版本更新。
- **上游 1.0.1 起自带 npm 版本对账**：sidecar 启动时会打一次
  `registry.npmjs.org`（8 秒超时、失败静默、结果缓存在 `engine/version-check.json`），
  之后每 3 小时一次。它没有开关，也和插件自己的 `/journey_update` 各管各的——
  上游那份只是「知道有没有新版」，真正更新仍走我们的更新器。离线环境表现为一次失败的请求，不影响旅行。
- **配了 `meet_url` 才有对外上报**：位置心跳（20 分钟）、到站写足迹（1.8.0）、路标（`/journey_signpost`）、
  名片/同行卡（1.6.x）。可见内容是宠物名/城市/时段（24 小时过期）与你自己留下的那句话；
  留空则一条都不发。1.7.1 起上游不再随包提供自建服务端，只能填公共池或留空。
- **那个「宠物名」由套壳注入**：上游没有配置项，只在构造引擎时读宿主的 `botName`
  （Coopani 那边是桌宠的名字）。以前套壳写死 `astrbot`，所有 AstrBot 用户在公共池里互相撞名；
  现在走插件配置 `pet_name` → `adapter/cli.ts --bot-name` → `RawBridgeOptions.botName`，
  留空回退 `AstrBot大肥鱼`。改名要重启 sidecar，且只认前 24 字（清洗见 `normalizeBotName`）。
- **填了 `amap_key` 会多出餐厅 POI 查询**（1.6.18 的 `journey_eat`/吃饭编排），和高德酒店查询同一个 key、
  同样带本地缓存（`engine/eatery-cache.json`）。额度敏感的用户知道这一项再去填。
- **车费桥（`bridgeSpend`/`bridgeDiary`/`bridgeLive`）由套壳固定关**：上游那三项默认是 **`true`**，
  而 AstrBot 场景没有写 `ride-pending/` 的配套打车扩展——它读的是同一数据目录下第三方扩展的文件。
  所以面板去掉这三项的同时，`config_map.py` 的 `PANEL_DROPPED_ENGINE_DEFAULTS` 把引擎侧钉成 `False`
  （**「不映射」不等于「关」**：不映射就还是上游默认的 true）。想真接打车扩展，用
  `extra_config` 写 `{"bridgeSpend":true}` 覆盖回来。

## 许可与署名

上游 `raw/` 作者 Mr.Q，MIT；本项目只做套壳与 AstrBot 接入，版权与许可见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。旧的分叉实现已清理，不参与构建与测试。
