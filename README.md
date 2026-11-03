# 大肥鱼环游世界 · AstrBot 套壳

`raw/` 是上游 **coopani-world-journey** 的源码（当前基线 0.5.16）；`adapter/` 是 TypeScript 套壳，
把上游 `JourneyWorld` 接到本地宿主与回环 HTTP；`plugin/astrbot_plugin_world_journey/` 是 AstrBot 插件。
旅行逻辑一行都没有重写。

## 原项目与致谢

本项目建立在 **Mr.Q** 的原项目
[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey) 之上。

感谢 Mr.Q 写出并持续维护这套旅行引擎：城市/路线、交通、天气、作息、日记、旅行记忆、
照片、事件流等核心逻辑都来自原项目。本仓库只做 AstrBot 侧的套壳、宿主适配和运行时源码更新；
没有原项目，就没有这个插件。

- 原项目：<https://www.npmjs.com/package/coopani-world-journey>
- 作者：Mr.Q
- 许可：MIT

插件**内置源码更新能力**：默认从上述 npm 包拉最新版，替换 `plugin/raw/` 后重启 sidecar；
adapter 不需要重新打包。

```
raw/                     上游源码基线（开发/构建用，正常只读）
  ↓ 构建时复制
plugin/.../raw/          安装后的上游源码（运行时动态加载，更新目标）
plugin/.../engine/
  sidecar.mjs            adapter 套壳（动态 import raw，约 58KB）
  update.mjs             npm registry 更新器
  upstream.json          基线版本
  ↓ 回环 HTTP（token）
main.py / bridge.py      AstrBot 命令、工具、提示词、主动消息、sidecar 生命周期
```

## 为什么这样分层

上游更新很频繁（月文件日记、旅行记忆、节假日/打工……）。分叉 `world.ts` 会持续落后。
套壳只依赖上游的少量公开面：

| 上游 | 套壳用法 | 上游变了怎么办 |
|---|---|---|
| `JourneyWorld` 构造 | `adapter/raw.ts`（动态 import） | 改这一处 |
| `start/stop` | `bridge.ts` | 契约测试会报 |
| `tools()` | 动态注册给 AstrBot | 自动跟随 |
| `envPromptVars()` | 渲染提示词 | 自动跟随 |
| `webUi().invoke` | 快照/出发/同步/拍照 | 契约测试会报 |
| `WorldHost.log/pushEvent` | `adapter/host.ts` | 未知成员 no-op 兜底 |
| 私有 `tick`/定时器 | 只在 `adapter/compat/private.ts` 的模拟里 | 只影响模拟，不影响插件 |

安装后的 sidecar 用 Node 的 `--experimental-transform-types` 直接运行 `plugin/raw/src/*.ts`，
所以**更新源码只要替换 raw 目录 + 重启 sidecar**，不用重新编译 adapter。

## 开发

需要 Node **22.7+**（运行时 `--experimental-transform-types`）。

```bash
npm install
npm run check          # typecheck + 23 项测试 + upstream hash/契约
npm run build          # 生成 engine/sidecar.mjs + engine/update.mjs，并把 raw 复制进插件
npm run sim -- --days 7 --speed 24 --seed 42 --data ./data/sim --offline
npm run status -- --data ./data/sim --offline
npm run prompt -- --data ./data/sim --offline
```

`npm run sim` 用虚拟时钟驱动 raw：停掉 raw 定时器，用 `compat/private.ts` 的私有 tick 推进。
生产 sidecar 不依赖私有 tick，raw 自己按真实时间巡检。

## 内置更新源码

### 在 AstrBot 里

```text
/journey_update            # 更新到 npm 最新
/journey_update 0.5.25     # 更新到指定版本
```

- 只有管理员能执行；`allow_upstream_update` 可关闭。
- 更新器从 `https://registry.npmjs.org/coopani-world-journey` 拉取，校验 `dist.integrity` 的 sha512，
  解压到插件目录的 staging，然后：停事件泵 → 停 sidecar → 备份旧 raw → 换新 raw → 重启 sidecar。
- 新 raw 启动失败（公开 API 变了 / 语法不支持）会**自动回滚**到旧 raw 并重启。
- 成功后重新注册工具、恢复事件泵；不需要重装插件。
- 默认源页面在配置 `upstream_source` 里；实际下载用 `upstream_package` + `upstream_registry`。

### 在仓库里

```bash
npm run upstream:update    # 从 npm 更新 raw/（--install，自动备份）
npm run upstream:check     # 看版本/变更文件/契约
npm test
npm run upstream:accept    # 只写 upstream.lock.json
npm run build              # 重新生成 sidecar/update/插件 raw 副本
```

`upstream:update` 会留下 `.raw.bak-<旧版本>`；确认无误后可删。详见
[`docs/upstream-update.md`](docs/upstream-update.md)。

## 自拍套壳

上游 `photo.ts` 原本只拍空镜：提示词明确写「画面里没有人物」，请求走
`/images/generations` 的纯文生图。AstrBot 侧加了一层 **fetch 代理**，不改 raw：

- 开启 `selfie_enabled` 后，拦截上游的生图请求；
- 把「空镜」提示词换成自拍提示词（前置镜头、脸和上半身、看镜头）；
- 去掉「没有人物/路过的人拍/胶片质感」这些空镜约束；
- 用 `selfie_reference` 上传的参考图走图生图（`/images/edits`，或配置成带
  `image_url` 的 `/images/generations`），要求保持五官/发型/气质一致；
- 把结果包回上游认识的 `{data:[{b64_json|url}]}`。

配置：

| 项 | 说明 |
|---|---|
| `selfie_enabled` | 开启后所有照片必须是自拍；没参考图会失败，不退回空镜 |
| `selfie_reference` | WebUI 里上传参考图（png/jpg/jpeg/webp） |
| `selfie_reference_path` | 也可以直接填绝对路径/URL |
| `selfie_subject` | 提示词里的主体称呼，默认「她本人」 |
| `selfie_prompt` | 自定义模板，可用 `{scene}` / `{subject}` |
| `selfie_mode` | `edit`（默认，`/images/edits`）、`generation`（带 `image_url`）或 `native`（阿里万相原生，data URL） |
| `selfie_api/key/model` | 留空沿用 `image_api/key/model` |
| `selfie_image_field` | generation 模式的图片字段，默认 `image_url` |
| `selfie_size` | 默认 `1024x1024`；竖图可试 `1024x1536` |

注意：参考图只负责“长得像”，不保证 100% 一致；底模/中转站必须支持对应的图生图接口。
失败会写日志并让这张照片失败（`/journey_photo` 会返回原因），不会偷偷生成一张空镜。

## 部署到 AstrBot

1. `npm run build`。
2. 把 `plugin/astrbot_plugin_world_journey` 复制到 `<AstrBot>/data/plugins/`，或：

   ```bash
   npm run deploy -- --target "C:\...\core\data\plugins"
   ```

   开发时可用 `--link` 建 junction；覆盖已存在目录要 `--force`（先停用插件，否则 Windows 会锁文件）。
3. AstrBot 插件页**重载插件**（只启用不一定重载 Python 模块）；配置里确认 Node 路径。
4. 发 `/journey` 验证；`GET /api/v1/tools` 应能看到 `journey_*`。

## AstrBot 插件功能

命令：`/journey`、`/journey_depart`、`/journey_photo`、`/journey_diary`、`/journey_stats`、
`/journey_draw`、`/journey_sync`、`/journey_debug`、`/journey_reset confirm`、`/journey_update`。

工具：上游 `tools()` 自动注册（仓库基线 0.5.16 是 5 个；更新到 0.5.25 后多 `journey_return_home`，
以实际 `tools()` 为准）。上游新增工具会自动出现，不用改 Python。

提示词：`/api/prompt` 渲染 raw `ENV_PROMPT.md`，套壳层剥掉「身体怎么动」动作段、追加聊天平台说明、
清洗 `music_pick`，然后注入 `on_llm_request`。另外保留最近几条主动汇报，只注入给收到汇报的会话，
方便用户接着刚汇报的旅行话题聊。

主动消息：配置 `event_target`（或用最近会话）+ `proactive_enabled`；`flush` 立即发，
`debounce` 按 `debounce_seconds` 合并；照片以图片段发送。

主动汇报配图：`report_image_mode=always` 每条汇报都生成自拍；`probability` 按
`report_image_probability` 概率生成。提示词基于**这条汇报的文本** + 当前状态，用
`selfie_*` 配置出图，不写上游 `journey.photo`，所以不会和相册照片重复；失败只发文字。

### 控制范围

`access_scope`：

- `all`（默认）：所有好友/群组可用；
- `target`：**只有 `event_target` 选中的个人/群组可用**。

`target` 会同时限制命令、LLM 工具、提示词注入和主动消息；非目标会话的
`journey_*` 工具会从请求工具集里移除。`target` 但 `event_target` 为空时全部拒绝。
管理员命令也受限制；锁住了就去 WebUI 改配置。

### 重置旅行

```text
/journey_reset            # 只给警告
/journey_reset confirm    # 清空并重新开始
```

清空 `engine/`（位置/路线/事件/照片/日记/缓存）和 `memory_dir` 里的月文件日记、
`travel-memory*.json`；保留插件配置、`engine-config.json`、自拍参考图和 `last_umo`。
只有管理员能执行，且必须带 `confirm`；`allow_reset=false` 可关闭。

## 数据

插件数据：`<AstrBot data>/plugin_data/astrbot_plugin_world_journey/`

- `engine/state.json`：位置/路线/时钟，只在本机
- `engine/diary/2026-11.md`：月文件日记
- `engine/diary/travel-memory.json`：去过/想去/花销，可跟同步盘
- `engine/photos.json` + `engine/media/`：照片索引与字节
- `engine/events.jsonl`：事件流
- `engine-config.json`：AstrBot 配置映射结果
- `plugin_state.json`：last_seq / last_umo / event_log_id
- `logs/sidecar.log`：sidecar 日志

`memory_dir` 留空时日记/记忆在 `engine/diary`；填同步盘则跟人走，`state.json` 仍只在本机。

## 已知限制

- 需要 Node 22.7+；没有 Node 时插件会明确报错（可配 `node_path`）。
- 主动消息默认关闭；需要配置 `event_target` 或先和机器人说话，再打开。
- `raw/` 的立绘动作/音乐扩展联动不适用于 AstrBot；提示词会剥掉动作段。
- AstrBot 插件市场安装需要把 `plugin/astrbot_plugin_world_journey` 作为 zip 根或独立仓库根。
- 上游私有 `tick` 只用于模拟；上游改了它只影响模拟，不影响插件运行。
- 运行时更新只更新**上游源码**；本套壳/Python 代码仍随插件版本更新。

## 许可与署名

上游 `raw/` 作者 Mr.Q，MIT；本项目只做套壳与 AstrBot 接入，版权与许可见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。旧的分叉实现已清理，不参与构建与测试。
