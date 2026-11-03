# 大肥鱼环游世界 · AstrBot 套壳（开发仓库）

插件发布仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey_release>
插件作者：**yutou**

本仓库是**开发仓库**，维护：

```text
raw/          上游 coopani-world-journey 源码（只读基线，当前 0.5.26）
adapter/      TypeScript 套壳：宿主、配置、事件、媒体、提示词、HTTP、模拟
scripts/      构建、部署、npm 源码更新、校验
test/         29 项测试
docs/         架构与上游更新文档
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
npm run check          # typecheck + 29 项测试 + upstream hash/契约
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

详见 [`docs/upstream-update.md`](docs/upstream-update.md)。

## 架构

```text
raw/                     上游源码基线（只读）
  ↓ 构建时复制
plugin/.../raw/          安装后的上游源码（运行时动态加载/更新目标）
plugin/.../engine/
  sidecar.mjs            adapter 套壳（动态 import raw，约 58KB）
  update.mjs             npm registry 更新器
  ↓ 回环 HTTP（token）
main.py / bridge.py      AstrBot 命令、工具、提示词、主动消息、sidecar 生命周期
```

提示词注入使用 `req.extra_user_content_parts` + `TextPart.mark_as_temp()`，作为仅本轮可见的
临时 user 内容块，不拼接 `system_prompt`，避免破坏 prompt cache。

套壳只依赖上游少量公开面：

| 上游 | 套壳用法 | 上游变了怎么办 |
|---|---|---|
| `JourneyWorld` 构造 | `adapter/raw.ts`（动态 import） | 改这一处 |
| `start/stop/tools/envPromptVars/webUi` | `adapter/bridge.ts` + `contract.ts` | 契约测试会报 |
| `WorldHost.log/pushEvent` | `adapter/host.ts` | 未知成员 no-op 兜底 |
| 私有 `tick`/定时器 | 只在 `adapter/compat/private.ts` 的模拟里 | 只影响模拟，不影响插件 |

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

## 许可与署名

上游 `raw/` 作者 Mr.Q，MIT；本项目只做套壳与 AstrBot 接入，版权与许可见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。旧的分叉实现已清理，不参与构建与测试。
