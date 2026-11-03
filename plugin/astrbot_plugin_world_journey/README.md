# 大肥鱼环游世界 · AstrBot 插件

让她真的出门旅行：自己挑目的地和交通方式，路上耗真实时间；到了按当地时间吃饭、看日出、写日记。
旅行引擎来自上游 [`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)
（作者 Mr.Q，MIT），感谢原项目；本插件只做 AstrBot 接入，上游源码可在插件内从 npm 更新
（`/journey_update`），不需要重装插件。

版本：**v1.0.0**

## 安装

1. 需要 AstrBot **4.16+** 和 Node.js **22.7+**（运行时使用 `--experimental-transform-types`）。
2. 把整个 `astrbot_plugin_world_journey` 目录复制到：

   ```
   <AstrBot>/data/plugins/astrbot_plugin_world_journey/
   ```

3. AstrBot WebUI → 插件 → 重载。
4. 插件配置里确认：
   - `node_path`：留空自动找；找不到时填 `C:\Program Files\nodejs\node.exe` 或 Node 安装目录。
   - `home_city`：从哪儿出发（兰州/西安…）；留空按日记最近城市/兰州兜底。
   - `event_target`：主动消息发给谁（可选）。

## 图标

插件根目录的 `logo.png` 会被 AstrBot 自动识别，不需要在 `metadata.yaml` 里配置：

```text
astrbot_plugin_world_journey/
  logo.png      512x512 PNG，和 main.py 同级
  main.py
  metadata.yaml
```

必须是全小写 `logo.png`，不要用 `icon.png` 或 `logo.jpg`；打包 zip 时放在 zip 根目录，
重载插件后生效。当前图标为 512×512 PNG。

## 命令

| 命令 | 说明 |
|---|---|
| `/journey` `/旅行` `/她在哪` | 她此刻在哪、那边几点、今晚住哪、接下来做什么 |
| `/journey_depart` `/让她出发` | 手动让她出发（默认需要管理员） |
| `/journey_photo` `/旅行照片` | 开始拍一张；出图后自动发，不阻塞命令 |
| `/journey_diary [7\|2026-11\|2026-11-02]` | 读最近几天 / 某个月目录 / 某一天全文 |
| `/journey_stats` `/旅行统计` | 走了多少天、去过多少城、日记在哪 |
| `/journey_draw 成都 一首歌` | 记下想去的地方 |
| `/journey_sync` | 把她的钟拉回真实时间 |
| `/journey_debug` | 诊断：上游版本、sidecar、数据目录、最后 seq |
| `/journey_reset confirm` | 重置旅行：清空行程、事件、照片、日记和旅行记忆（管理员） |
| `/journey_update [latest\|0.5.25]` | 从 npm 更新上游源码（管理员；失败自动回滚） |

## 控制范围

`access_scope` 决定插件对谁开放：

| 值 | 行为 |
|---|---|
| `all`（默认） | 所有好友/群组都能用命令、工具和旅行提示词 |
| `target` | **只有** `event_target` 选中的个人/群组能用 |

`target` 模式会同时限制：

- 所有 `/journey*` 命令（包括管理员的重置/更新）；
- LLM 工具：非目标会话的 `req.func_tool` 里会移除 `journey_*`，模型看不到也调用不了；
- 旅行提示词注入；
- 主动消息（`event_target` 本身）。

注意：

- `target` 但 `event_target` 为空时，**所有会话都会被拒绝**。
- `target` 模式不再用 `last_umo` 兜底；主动消息只发 `event_target`。
- 管理员命令也受控制范围限制；如果把自己锁在外面，去 WebUI 改 `access_scope` 或 `event_target`。

## 重置旅行

```text
/journey_reset            # 只显示警告，不删
/journey_reset confirm    # 真正重置
```

会清空：

- `engine/` 里的位置、路线、时钟、事件、照片、`photos.json`、日记、caches；
- 同步盘 `memory_dir` 里的月文件日记、`travel-memory*.json`、`_bak/legacy/`；
- 事件游标（last_seq / event_log_id）。

会保留：

- 插件配置（`home_city`、倍速、API key、自拍参考图等）；
- `engine-config.json`；
- 最近会话 `last_umo`（主动消息还发同一个地方）。

重置只有管理员能执行，且必须带 `confirm`；`allow_reset=false` 可完全关闭。

## 自拍参考图

上游原本只拍空镜。开启 `selfie_enabled` 后，插件会在 sidecar 里套一层生图代理：

1. 拦截上游的 `POST /images/generations`；
2. 把「没有人物」的空镜提示词换成自拍提示词；
3. 用 WebUI 上传的 `selfie_reference` 作为参考图，走图生图；
4. 把结果包回上游认识的结果。

配置步骤：

1. `image_api` / `image_key` / `image_model` 先配好（用于兜底）。
2. 在 `selfie_reference` 上传一张正脸清晰的角色参考图（png/jpg/jpeg/webp）。
3. 打开 `selfie_enabled`。
4. 先发 `/journey_photo` 试一张；失败原因会直接回在命令里。

接口模式：

- `selfie_mode=edit`（默认）：`POST {api}/images/edits`，multipart 上传参考图；
- `selfie_mode=generation`：`POST {api}/images/generations`，参考图放
  `selfie_image_field`（默认 `image_url`，也支持 `image`）；
- `selfie_mode=native`：阿里百炼万相原生
  `/api/v1/services/aigc/multimodal-generation/generation`，`input.messages` 里传
  `data:image/...` 参考图；适合 `wan2.7-image`。`selfie_native_url` 可覆盖完整端点。

`selfie_api` / `selfie_key` / `selfie_model` 留空则沿用 `image_api` / `image_key` /
`image_model`。`selfie_prompt` 可自定义，支持 `{scene}`（上游风景提示词）和
`{subject}`（默认「她本人」）；默认显示完整内置模板，留空保存会自动回填。

注意：

- 参考图只保证“长相接近”，不保证 100% 一致；底模/中转站必须支持图生图。
- 开启后没有参考图，照片会失败，**不会退回空镜**。
- 自动拍照和 `/journey_photo` 都走这套；失败只写日志/回命令，不阻塞旅行。

## 工具

LLM 工具由引擎自动注册（0.5.25 是 6 个，0.5.16 是 5 个，以实际 `tools()` 为准）：

- `journey_now`
- `journey_diary_write`
- `journey_diary_read`
- `journey_stats`
- `journey_draw_to`
- `journey_return_home`

上游新增工具会自动出现；不需要改插件代码。

## 内置更新上游源码

默认源：[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)。

```text
/journey_update            # 最新
/journey_update 0.5.25     # 指定版本
```

更新流程：

1. 从 `https://registry.npmjs.org/coopani-world-journey` 取元数据；
2. 下载 tarball，校验 `dist.integrity` 的 sha512；
3. 解压到插件目录的 staging；
4. 停事件泵 → 停 sidecar → 备份旧 `raw/` → 换新 `raw/`；
5. 重启 sidecar、重新注册工具、恢复事件泵；
6. 新版本起不来则**自动回滚**到旧 `raw/` 并重启。

配置里 `allow_upstream_update` 控制是否允许；`upstream_package`、`upstream_registry` 可换源；
`upstream_source` 只是展示页面。运行时更新只换上游源码，本插件/Python 代码仍随插件版本更新。

## 提示词

开启 `inject_prompt` 后，每次 LLM 请求会追加一段旅行状态（她所在城市、当地时刻、今晚住哪、接下来做什么）。
这段来自上游 `ENV_PROMPT.md`，已剥掉桌面立绘的动作段、清洗了 AstrBot 不存在的 `music_pick` 工具。

另外，插件会在内存里保留最近几条**主动汇报**（`inject_recent_reports`，默认 5 条），
只注入给实际收到汇报的那个会话。这样用户接着「刚刚到哪了」聊时，主 agent 知道在说哪条汇报。
`recent_report_count` 控制条数；重启插件后缓冲清空，重置旅行也会清空。

## 主动消息

默认关闭。建议：

1. 先和机器人说一句话（让它记住会话），或直接在配置里选 `event_target`。
2. 打开 `proactive_enabled`。
3. `speed` 调到 24 可以更快看到出发/到站；日常建议 1 或 4。

`flush` 事件（出发/到达/跨天/回家/麻烦）立即发；`debounce` 事件（作息/路上/照片）在
`debounce_seconds` 内合并，只发最新一条。照片以图片段发送。

### 主动汇报配图

| `report_image_mode` | 行为 |
|---|---|
| `off`（默认） | 不加图 |
| `always` | 每条主动汇报都生成一张自拍附在文字后 |
| `probability` | 按 `report_image_probability` 概率生成 |

- 用当前 `selfie_*` 配置出图（当前是 `native` 万相），提示词基于**这条汇报的文本** + 当前状态；
- 不经过上游 `journey.photo`，所以不会和相册照片重复；
- 事件本身已有照片时跳过；
- 生图失败只发文字，并写 `sidecar.log`；
- `always` 会增加费用和发送延迟，建议先用 `probability=0.2~0.3`。
- 只影响主动汇报，`/journey` 查询命令不加图。

## 配置

大部分字段和上游一致：`home_city`、`speed`、`beat_gap`、`rest_days`、`ask_before_depart`、
`max_trip_months`、`with_user`、`money_enabled`、`budget`、`memory_dir`、`amap_key`、
`image_api/key/model/style`。

套壳自己的：

| 项 | 默认 | 说明 |
|---|---|---|
| `node_path` | 空 | Node 22.7+ 路径 |
| `inject_prompt` | 开 | 注入旅行状态 |
| `inject_recent_reports` | 开 | 把最近汇报注入汇报会话 |
| `recent_report_count` | 5 | 保留几条汇报 |
| `proactive_enabled` | 关 | 主动发事件 |
| `event_target` | 空 | 主动消息目标会话；`target` 模式下也是唯一允许使用的会话 |
| `access_scope` | `all` | `all` 所有会话；`target` 仅 `event_target` |
| `debounce_seconds` | 60 | 路上事件合并窗口 |
| `report_image_mode` | `off` | `off` / `always` / `probability` |
| `report_image_probability` | 0.3 | 汇报配图概率 |
| `admin_only_controls` | 开 | 出发/拍照/同步/更新仅管理员 |
| `allow_reset` | 开 | 允许 `/journey_reset`（始终仅管理员） |
| `allow_upstream_update` | 开 | 允许 `/journey_update` |
| `upstream_package` | `coopani-world-journey` | 上游 npm 包名 |
| `upstream_registry` | `https://registry.npmjs.org` | npm registry |
| `upstream_source` | npm 页面 | 展示用源地址 |
| `selfie_enabled` | 关 | 所有照片必须是自拍 |
| `selfie_reference` | 空 | 自拍参考图（WebUI 上传） |
| `selfie_reference_path` | 空 | 参考图绝对路径/URL（可选） |
| `selfie_subject` | `她本人` | 提示词主体 |
| `selfie_prompt` | 内置模板 | 自拍模板，可用 `{scene}`/`{subject}`；留空保存回填 |
| `selfie_mode` | `edit` | `edit` / `generation` / `native` |
| `selfie_native_url` | 空 | native 完整端点，留空自动拼 |
| `selfie_api/key/model` | 空 | 留空沿用生图配置 |
| `selfie_image_field` | `image_url` | generation 模式图片字段 |
| `selfie_size` | `1024x1024` | 自拍尺寸 |
| `offline` | 关 | 不查天气/酒店/生图 |
| `extra_config` | 空 | 上游新增字段的 JSON 兜底 |

`extra_config` 示例：`{"someNewField": 123}`，会覆盖同名引擎字段。

## 数据

`<AstrBot data>/plugin_data/astrbot_plugin_world_journey/`：

- `engine/state.json`：位置/路线/时钟（只在本机）
- `engine/diary/2026-11.md`：月文件日记
- `engine/diary/travel-memory.json`：去过/想去/花销（可跟同步盘）
- `engine/photos.json` + `engine/media/`：照片
- `engine/events.jsonl`：事件流
- `engine-config.json`：配置映射
- `plugin_state.json`：last_seq / last_umo
- `logs/sidecar.log`：sidecar 日志

`memory_dir` 留空时日记和旅行记忆在 `engine/diary`；填同步盘则跟人走。

从旧版迁移：把旧数据目录的 `state.json`、`diary/`、`photos.json`、`media/` 复制进 `engine/`。
上游会把旧的一天一篇日记自动并进月文件，旧文件挪进 `_bak/legacy/`，不删。

## 故障排查

- **插件加载失败**：看 `data/logs/astrbot.log` 里 `astrbot_plugin_world_journey` 的报错。
- **提示 Node 不可用**：装 Node 22.7+，或配置 `node_path` 指向 `node.exe`。
- **sidecar 启动超时**：看 `plugin_data/.../logs/sidecar.log`；确认 22.7+ 和端口。
- **重载后没有孤儿进程**：插件用真实 `node.exe` + 心跳 + terminate；如果还有，查 `journey_debug`。
- **主动消息没来**：确认 `proactive_enabled`、`event_target`（或先和机器人说话）、以及 sidecar 已就绪。
- **照片没拍**：配 `image_api`/`image_key`/`image_model`；失败原因会回在 `/journey_photo`。
- **拍照报 `Server disconnected`**：sidecar 在拍照途中被重载/重启（改配置、更新插件、重载插件）。
  等几秒重试；v0.6.5 起客户端最多等 150s，不会用 10s 默认超时误杀慢图。
- **拍照很慢**：v0.6.6 起 `/journey_photo` 立刻返回“开始拍了”，后台等图；出图后自动发。
  如果主动消息关着，后台任务会直接发到发命令的会话；失败也会主动回原因。
- **更新失败**：看回复里的原因；插件会回滚旧 `raw/`。确认能访问 npm，且 Node 22.7+。

## 许可

上游引擎 `coopani-world-journey` 作者 Mr.Q，MIT。本插件只做套壳与 AstrBot 接入；
详见随包的 `THIRD_PARTY_NOTICES.md`。
