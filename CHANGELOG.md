# 更新日志

## 未发布（工作区）— 上游 raw 0.5.26 → 0.8.6 + 壳层补齐

### 上游更新

- `raw/` 更新到 `coopani-world-journey` **0.8.6**（npm 校验 sha512，`upstream.lock.json` 重录，45 个文件）。
  上游这轮带来：碰面联机（`meetUrl`、邀约/接邀约）、ComfyUI 出图（协议/workflow/节点/负向提示词/超时可调）、
  拍照六题材（`subject`）、月报/年报、水印裁除、`maxTripMonths`→`maxTripWeeks` 改名换单位。
- 契约扫描全绿：无运行时 cortico import、`world.ts` 公开面不变、host 仍在 `log/pushEvent` 白名单、
  `### 身体怎么动` 与 `{{journey.now}}` 原位 —— **adapter 契约层零改动**。新工具/新事件经
  `/api/tools` 与事件泵动态透传自动生效。

### 壳层未实现功能的补齐（改壳不改 raw）

- **`max_trip_months` → `max_trip_weeks`**（`config_map.py` + `_conf_schema.json`）：上游改键名换单位，
  不处理则用户设置静默失效。迁移：旧月份值 ×4.345 换算成周（6 月 → 26 周，与新默认等价），
  新键被显式改成非默认值时以新键为准；日志写明换算结果。
- **13 个上游新配置进 AstrBot 表单**：`max_trip_weeks`、`has_license`、`meet_url`、
  `image_protocol`、`image_workflow`、`image_prompt_node`、`comfy_negative`、`comfy_negative_node`、
  `image_timeout_sec`、`image_cast`、`image_size`、`image_watermark`、`photo_dir`（此前只能靠 `extra_config` 手拼）。
- **点头卡片进聊天**（`bridge.ts` `askAnswer` + `server.ts` `/api/ask` + `main.py`
  `/journey_yes|/点头`、`/journey_no|/摇头`）：上游「出门等点头/接邀约」只有面板按钮一个入口，
  AstrBot 没有面板；现在 `journey.ask` 事件末尾附回答指令，`/journey_yes` 即点头。没有待批的事时
  明确回「她现在没有在等你点头」，不静默。
- **`/journey_back`（/叫她回来）**：`bridge.ts` `returnHome` + `/api/return-home` 路由，面板
  「回来」按钮的聊天替身（模型侧本来就有 `journey_return_home` 工具）。
- **`/journey_photo [题材]`**：带参数时按关键词映射上游 `subject` 六档（菜单/特写→detail 优先于
  饭/面→food，防子串误判），走 `journey_photo` 工具；不带参数保持原面板补拍行为。
- **ComfyUI 与自拍套壳互斥**（`bridge.ts`）：`image_protocol=comfyui` 且未单独配 `selfie_api` 时
  自拍套壳与主动汇报配图整体停用并写日志 —— 自拍打的是 `/images/generations`，对着 Comfy 地址
  必然 404；单配 `selfie_api` 可组合「ComfyUI 画风景 + 云端画自拍」。
- **出图等待上限跟随 `image_timeout_sec`**（`bridge.py`）：`/api/photo` 与题材拍照工具的客户端超时
  从固定 150s 改为 `max(150, 配置 + 60)`，用户把渲染超时调到 300/600 时套壳不再先掐自己。
- `/jy` 简写与 `/journey help` 同步新指令；插件 README 增补 ComfyUI 接入、碰面联机、
  配置表与新故障排查条目。

### 测试

- 新增：`bridge.test.ts` 点头拒绝/回程 + ComfyUI 自拍停用；`server.test.ts` `/api/ask`、
  `/api/return-home`；`config_map` 迁移逻辑手工表驱动验证（12 月→52 周、6 月→26、显式周优先）。

### 设置页整理：分组重排 + 两项合并（68 → 66）

- `_conf_schema.json` 全部按使用动线重排，`description` 加【分组】前缀（基本 / 旅行 /
  日记 / 数据 / 生图 / 生图·ComfyUI / 模板 / 自拍 / 主动消息 / 聊天注入 / 权限 /
  上游更新 / 高级），AstrBot 配置页按此顺序渲染。此前 `image_protocol` 夹在云端参数
  中间、更新组排最前、运行时项散落头尾。
- **删 `upstream_source`**：代码零引用的死字段（只有 README 在讲它）。
- **`inject_recent_reports` 并入 `recent_report_count`**：0 = 关闭注入（语义等价）。
  `main.py` 三处判断统一成 `_recent_report_limit()`；老配置里显式 False 的旧开关仍优先，
  行为不翻转。
- **`selfie_size` 默认改留空 = 跟随 `image_size`**：兜底链（自拍尺寸 → 上游请求体尺寸 →
  方形）本就存在，只是旧默认值 `1024x1024` 把它盖住了；旧配置里存过的值照旧生效。
  `test/selfie.test.ts` 新增锁定用例。
- 易混项的 hint 讲清分工：`beat_gap`（她想一句的频率）vs `debounce_seconds`（壳层发送
  合并窗口）、`request_timeout`（普通命令）vs `image_timeout_sec`（出图等待）；
  `ask_before_depart` hint 补上 `/journey_yes|no` 的实际用法。
- README 配置表按新分组重排，补上此前漏表的 `node_path`/`sidecar_port`/`request_timeout`/`log_level` 行。
- 验证：`npm test` 共 **46 项**全过（含自拍尺寸跟随新用例）；`_recent_report_limit` 按 main.py
  真实源码抽取执行，9/9 分支符合预期（旧开关 False 优先、0=关、上限 20、坏值回退 5）。

## 1.0.5 — 2026-11-06

### 拍照场景描述统一：画风、时段、在路上的城市真的生效

- 新增 `adapter/photo-prompt.ts`：「这一张拍什么」的唯一来源。相册拍照（`bridge.photo()`）
  和主动汇报配图（`bridge.reportImage()`）从同一处构造提示词，上游 `raw/src/photo.ts` 只
  import 不复制 —— 用户填的「画面风格」（`image_style`）从此对两条路径都生效，
  不再出现「相册是二次元、汇报配图是真人」的分裂。
- 拍照城市跟着她的行程走：在路上取 `leg.toId` 一带（车窗、过站、车厢里的光），
  不再拿出发城市原地晾衣服；快照里拿不到精确景点时退化为「城市 + 光线」，不编地名。
- 生图模板拆成三套：`image_prompt_template`（出镜自拍）、`image_prompt_scene_template`
  （自拍关着时的空镜，守住「画面里没有人物」）、`image_prompt_for_scene`（空镜是否套模板）。
- 旧 `selfie_prompt` 自动迁移（`defaults.py` 新增 `LEGACY_SELFIE_PROMPT` 识别）：
  空的直接回填新默认；填的恰好是旧默认模板的换成新模板并清空旧字段；
  用户自己改过的一个字不动，运行期回退读旧字段。
- `config_map.py` 增加 `imagePromptTemplate` / `imagePromptSceneTemplate` / `imagePromptForScene` 映射。
- 新增 `test/photo-prompt.test.ts`；`npm test` 共 **43 项**，全过。

### 写完日记推送给主要通知人

- 自动日记落盘成功后，把当天正文（带日期和所在城市）推送到会话；新增配置
  `diary_notify`（默认开）与 `diary_notify_target`（主要通知人，WebUI 会话选择器）。
- 目标解析顺序：`diary_notify_target` → `event_target` → 最近和机器人说话的会话；
  `access_scope=target` 时不用最近会话兜底；三者都没有只写日志跳过。
- 推送失败不影响日记落盘，也不重试推送；只针对自动日记，工具写入和历史日记不推。

### `/journey help` 指令列表

- `/journey help`（或 `/jy help`、`/旅行 帮助`）输出当前全部可用指令：命令、参数形式、
  中文别名、`/jy` 简写形式、管理员标注和控制范围说明。

### `/jy` 简写指令

- `/jy` 单独使用等同 `/journey`；`/jy diary 7`、`/jy note all`、`/jy draw 成都 一首歌`
  等同对应的 `/journey_diary` / `/journey_note` / `/journey_draw`；
  depart / photo / stats / sync / debug / reset / update 同样支持，未知子命令给提示。
- 权限、管理要求、控制范围与完整命令完全一致（直接分发进原 handler，行为只有一份）。
- 参数传递用 per-event 的覆盖值实现，不新增 handler 位置参数 ——
  AstrBot 会按签名自动解析指令尾参，加了反而会污染参数类型。

### `/journey_update` 成功时附上更新日志

- 更新成功后从新版 `raw/CHANGELOG.md` 截取**旧版本 → 新版本**之间的段落一起输出，
  一眼知道这轮升级改了什么；「已经是最新」时不输出。
- 旧版本没收录在日志里时保守只截新版一节；超过 2500 字截断并提示看全文；
  CHANGELOG 读不到不影响更新本身（只少一段说明，照常完成更新）。

## 1.0.4 — 2026-11-04

自 1.0.3 之后合入的功能，统一在 1.0.4 发布。

### 生图模型名改成列表，按顺序降级

- 插件配置里的「生图模型名」从单个字符串改成**列表**：按填写顺序尝试，第一个模型报错或不可用时
  自动换下一个，**所有模型都失败**才把错误交回上游（只写日志，不停旅行）。
- 上游 `raw/` 不动。降级在套壳的 `fetch` 代理里完成：Python 侧把列表写成 `imageModels`、
  首个模型写成 `imageModel`，`adapter/selfie.ts` 拦截 `POST .../images/generations` 后按顺序重发。
- 自拍模型留空时沿用这份列表；`selfie_model` 显式填写时仍以它为准，主动汇报配图同样走降级。
- 尺寸/字段名不兼容的 400 不换模型 —— 那是请求形状问题，留给上游自己的换字段重试阶梯；
  401/403 也原样返回，避免把鉴权错误变成一串重试。
- 旧配置里的字符串值在插件启动时自动迁移成单元素列表；配置页的列表控件不再把字符串按字符拆开。

### 自拍模板支持时间描述

- `selfie_prompt` 新增两个占位符：
  - `{time}`：**时段描述词**，按她当地的分钟数分 23 档，从「午夜」「凌晨」「黎明前」
    「拂晓」「黎明」「破晓」「晨光初现」「清晨」「早晨」「上午」「上午将尽」「临近正午」「正午」
    「午后」「下午」「下午将尽」「傍晚」「黄昏」「暮色」「入夜」「夜晚」「深夜」到「午夜前」；
  - `{clock}`：她所在城市的当地时间，`HH:MM`（如 `18:12`）。
- 时间取自 raw 的 UI 快照（她那边几点），不用本机时间 —— 她可能在别的时区；
  快照取不到时才退回本机时间，只影响描述词，不影响生图。
- 默认模板加了一行 `时间：{time}（{clock}）。`；老的自定义模板没有这两个占位符时，
  会把时间自动补在末尾，升级后立刻生效，不用重新编辑模板。
- 保留了 `{scene}` / `{subject}`，模板里只想用描述词或只用具体时间都可以。
- 新增时段边界与模板替换测试，共 31 项测试。

### 日记：自动写、`/journey_note` 与 `/journey` 状态

- 新配置 `diary_write_time`，默认 **23:00**，按她所在城市的当地时间；到点当天还没写就自动写一篇。
  已有日记（手动写入也算）不覆盖；失败隔 10 分钟重试；留空关闭。自动写使用当前 AstrBot LLM provider，
  生成后仍走上游的 `journey_diary_write` 落盘，`raw/` 零改动。
- 新增 `/journey_note [all|N]`（别名 `/旅行笔记`）：`all` 读全部，`N` 读最近 N 篇，默认 1；
  输出第一行是「一共有多少篇日记可读」，最新的在前，纯文本、不用 Markdown 分隔线。
- `/journey` 末尾增加「日记 N 天，今天已经写了/还没写」。
- 新增 `diary_view.py`：只读日记文件，同时看同步盘和本机兜底目录，同一天取文件更新的那份；
  `/journey_note` 与 `/journey` 都走它，不依赖上游工具的分页上限。
- README 补充日记读法、自动写配置和 `/journey_note` 说明；版本 1.0.4。

### 修复：主动汇报配图没有接通 sidecar

- 症状：`report_image_mode` 开着时，每次主动汇报都只发文字，日志里一行
  `汇报配图异常：'SidecarBridge' object has no attribute 'reportImage'`。
- 根因：`main.py` 调了 `bridge.reportImage()`，但 Python 客户端没有这个方法；
  sidecar 也没有对应的 HTTP 路由。
- 修法（仍然只改壳，`raw/` 零改动）：`adapter/server.ts` 增加 `POST /api/report-image`，
  把 `bridge.reportImage()` 产出的字节包成 base64；`bridge.py` 增加 `reportImage()`
  客户端方法并解码回字节。失败时返回 `image: null`，调用方只发文字，不丢整条汇报。
- 新增 sidecar 接口测试（base64 往返、空图分支），共 31 项测试。

## 1.0.3 — 2026-11-03

### 修复：Node 26 起跑不了上游源码

- Node 26.0.0 移除了 `--experimental-transform-types`（`process.features.typescript` 也不再返回
  `transform`），而上游 `raw/src` 用了 parameter properties，纯擦除模式直接
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`；表现为 sidecar 起不来、`/journey_update` 更新完也起不来。
- `bridge.py` 不再用版本号猜能力，改成实跑探针
  `node --experimental-transform-types -p process.features.typescript`，只有回 `transform` 才算原生可用。
- 探针不通时改走随包发布的 `engine/amaro`（Node 官方 SWC/WASM 转换器）：
  `--enable-source-maps --import file:///.../engine/amaro/register-transform.mjs`。纯 JS+WASM，
  没有原生二进制；`raw/` 仍是磁盘上的 TS，**热更新流程与回滚完全不变**。
- Node 22.7–25.x 走原生 flag，行为和产物不变。
- `engine/upstream.json` 的 `bridgeVersion` 改为读根 `package.json`，不再硬编码。
- `THIRD_PARTY_NOTICES.md` 补充 amaro（MIT）与它打包的 SWC WebAssembly（Apache-2.0）。
- 发布包基线从 0.5.16 升到 **0.5.26**（含同步盘日记/旅行记忆、路途补拍等上游改动）。
- 重装/升级插件会把 `raw/` 换回发布包基线，看起来像「又升级了一次」：现在启动时会把
  「见过的最新上游版本」记在 `plugin_data/upstream-state.json`，发现被换回旧版就 warn，
  `/journey_debug` 也会显示 `上游源码 / 记录的最新上游` 两行。
- `typecheck` 不再把 `raw/` 纳入编译（0.5.26 有一处上游自己的 strict 报错），套壳改用本地
  最小类型声明；测试里的上游版本断言改为读 `upstream.lock.json`，上游升版不用再改测试。
- `BRIDGE_VERSION` 改为构建时由 `package.json` 注入，不再写死。
- 升到本版需要重装一次插件本体（`/journey_update` 只换 `raw/`，换不了 `engine/`）。

### 安全：按第三方审查收口两处配置面

- `allow_upstream_update` 默认由**开**改为**关**：`/journey_update` 会从 npm 下载 tarball
  整体替换 `raw/`，虽然有 sha512 校验、失败自动回滚、仅管理员可触发，但它等于允许运行时
  替换代码；改为默认关、按需打开。要用的话去插件配置里把它打开，关闭时的回复也会提示去哪开。
- `extra_config` 补强：schema 提示写明「只给上游新增字段兜底、会覆盖表单映射、不要放密钥」；
  启动时用 warn 日志列出被覆盖的**键名**（不打印值，避免 URL/密钥进日志）；非法 JSON 的报错
  改成能照做的一句话，并保留「忽略 extra_config 重试、不让插件起不来」的兜底。
- README 新增「安全说明」：运行时代码替换默认关闭、网络边界（127.0.0.1 + 随机 token）、
  密钥只落本地 `engine-config.json`。

## 1.0.2 — 2026-11-03

### 修复：上下文注入不再破坏 prompt cache

- `inject_prompt` 不再向 `req.system_prompt` 尾部拼接动态旅行状态；
- 改用 `req.extra_user_content_parts` + `TextPart.mark_as_temp()`，作为仅本轮可见的临时
  user 内容块，不写入会话历史；
- 旅行状态与最近主动汇报合并成一个临时内容块；
- AstrBot 版本不支持临时内容块时跳过注入并写日志，不回退到 system prompt。

### 1.0.1 — 2026-11-03

- 插件作者改为 **yutou**，原项目 Mr.Q 仅在 README/第三方声明中保留致谢与版权；
- 拆分开发仓库与发布仓库：发布仓库根目录直接作为 AstrBot 插件根目录；
- 发布仓库补齐 `logo.png`、`engine/`、`raw/`，可直接安装；
- 修正发布元数据 `repo` 指向 release 仓库；
- 同步版本号到 `package.json`、sidecar、`metadata.yaml`、README。

### 1.0.0 — 2026-11-03

首个稳定版。感谢 **Mr.Q** 的原项目
[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)：
旅行引擎、城市/路线、日记、旅行记忆、照片和事件流都来自原项目。

### 本版包含

- `raw/` 只读上游 + `adapter/` 运行时动态加载，更新源码不用重打 adapter；
- AstrBot 命令、动态工具、旅行提示词注入、主动消息；
- `/journey_update`：从 npm 更新上游源码，失败自动回滚；
- `/journey_reset confirm`：清空行程/事件/照片/日记/旅行记忆；
- 自拍套壳：`edit` / `generation` / 阿里万相 `native`，支持参考图 data URL；
- 主动汇报配图：`off` / `always` / `probability`，提示词基于该条汇报内容；
- `access_scope=target`：只允许 `event_target` 会话使用；
- 最近主动汇报注入主聊天提示词；
- 自拍模板默认值显示，清空保存自动回填；
- 23 项测试全过。

### 0.7.1 — 2026-11-03

### 最近主动汇报注入主聊天提示词

- 插件内存保留最近 `recent_report_count` 条主动汇报（默认 5，单条最多 1200 字）；
- 用户在同一会话正常聊天时，把这些汇报追加到 system prompt，主 agent 能接上
  「刚刚出发/到站/路上」的话题；
- 只注入给**实际收到汇报的会话**，不会泄漏到其它群；
- `inject_recent_reports` 可关闭；重置旅行会清空缓冲；
- 重启插件后缓冲从空开始（不落盘）。

### 0.7.0 — 2026-11-03

### 自拍模板：默认值显示 + 空值回填

- `selfie_prompt` 的 schema 默认值改成完整内置模板，设置页一打开就能看到；
- 插件初始化时如果 `selfie_prompt` 为空，自动写回默认模板并 `save_config()`，
  用户清空保存后下一次加载会恢复默认；
- 默认模板集中在 `defaults.py`，与 `adapter/selfie.ts` 保持一致。
- 新增 `defaults.py` 到插件包。

### 0.6.9 — 2026-11-03

### 汇报配图提示词改为基于汇报内容

- 之前：汇报配图只用 `bridge.now()` 的当前状态；
- 现在：把该条 `journey.*` 事件的 `text`（例如「兰州 → 天水，自驾」「下午，莫高窟」）
  加上「此刻：当前状态」一起交给自拍 prompt，生成与这条汇报对应的画面。
- 仍然不写上游 `journey.photo`，不重复发相册照片。

### 0.6.8 — 2026-11-03

### 主动汇报配图：always / probability

- 新增 `report_image_mode`：
  - `off`（默认）：保持原样；
  - `always`：每条主动汇报都生成一张自拍并附在消息里；
  - `probability`：按 `report_image_probability` 概率生成。
- 用同一套 `selfie_*` 配置（当前 native 万相）直接出图，不写上游 `journey.photo` 事件，避免和相册照片重复。
- 事件已有照片（`journey.photo`）时跳过；失败只发文字并写日志。
- 注意：`always` 每条 beat/depart/arrive 都会调用一次生图，费用和耗时会明显增加。
- 仅作用于**主动汇报**（EventPump），不影响 `/journey` 查询命令。

### 0.6.7 — 2026-11-03

### 新增万相原生 native 模式

- 实测阿里百炼 `wan2.7-image`：
  - OpenAI 兼容 `/compatible-mode/v1/images/generations` 不接受参考图，返回 `url error`；
  - 原生 `POST /api/v1/services/aigc/multimodal-generation/generation` 接受
    `input.messages[].content[].image` 的 **data URL**，8s 出图。
- 新增 `selfie_mode=native`：
  - 端点默认从 `selfie_api` 的 origin 拼
    `/api/v1/services/aigc/multimodal-generation/generation`；
  - `input.messages[0].content = [{image: dataURL}, {text: prompt}]`；
  - `parameters = {size: "1K"/"2K", n:1, watermark:false, thinking_mode:false}`；
  - 解析 `output.choices[0].message.content[].image`，包回上游 URL。
- 新增 `selfie_native_url` 可覆盖完整原生端点。
- 新增 1 项 native 代理测试；共 23 项。

### 0.6.6 — 2026-11-03

### 拍照改成异步任务 + 自拍响应诊断

- `/journey_photo` 不再阻塞等待 150s：命令立刻回“开始拍了”，后台任务继续等图。
- 出图后：
  - 主动消息开着且目标就是当前会话：由 EventPump 自动发；
  - 主动消息关着、或目标是别的会话：后台任务直接发到发起命令的会话；
  - 失败：后台任务发“没拍成：原因”；
  - 再点 `/journey_photo` 会提示“上一张还在拍”。
- 新增自拍代理日志：HTTP 状态、`content-length`、响应体字符数、结果类型
  （`b64_json` 长度 / `url` 的 host），不再只看到“自拍生图”就卡住。
- 插件重载/重置/更新前会取消未完成的拍照任务，避免后台任务和 sidecar 重启打架。

### 0.6.5 — 2026-11-03

### 修复拍照被插件重载打断时的报错/超时

- 现象：`/journey_photo` 返回 `没拍成：Server disconnected`。
- 日志确认：10:32:43 开始拍照，10:32:52 AstrBot `Terminating plugin`，同一秒
  aiohttp 报 `Server disconnected`；sidecar 随后重启。不是生图接口错误。
- `/api/photo` 的 HTTP 等待从默认 10s 改成 **150s**；上游生图本身允许 90s，
  之前 10s 的客户端超时也会误杀慢图。
- `Server disconnected` / 连接失败 / 150s 超时改成可读中文提示（提示等几秒/看相册）。
- 取图 `/media` 超时 60s。

### 0.6.4 — 2026-11-03

### 控制范围：只有 event_target 选中的会话能用

- 新增 `access_scope`：`all`（默认）/ `target`。
- `target` 时只有 `event_target` 的 unified_msg_origin 能使用：
  - 所有 `/journey*` 命令静默拒绝；
  - 非目标会话的 `req.func_tool` 移除 `journey_*`，模型看不到也调不到；
  - 跳过旅行提示词注入；
  - 主动消息不再用 `last_umo` 兜底，只发 `event_target`。
- `target` 但 `event_target` 为空时全部拒绝；管理员命令也受限。
- 新增 `access.py` 纯函数判断并做过单元验证。
- 配置 schema/文档同步。

### 0.6.3 — 2026-11-03

### 重置旅行数据

- 新增 `/journey_reset confirm`（管理员，必须带 confirm）：
  - 清空 `engine/`：位置/路线/时钟、事件、照片、`photos.json`、日记、缓存；
  - 清空 `memory_dir` 同步盘里的月文件日记、`travel-memory*.json`、`_bak/legacy/`；
  - 重置 `last_seq` / `event_log_id`，保留 `last_umo`；
  - 保留插件配置、`engine-config.json`、自拍参考图；
  - 停泵/停 sidecar → 删数据 → 换新 `SidecarBridge` → 重启 → 重注册工具。
- 不带 `confirm` 只返回警告，不删任何东西；`allow_reset=false` 可关闭。
- 新增 `reset.py`：只按旅行文件模式清理同步盘，不碰其它文件。
- 新增 `allow_reset` 配置；文档/命令表同步。

### 0.6.2 — 2026-11-03

### 自拍套壳：生图必须含自拍，并带参考图

- 新增 `adapter/selfie.ts`：在 sidecar 进程内包一层 `fetch`，只拦截上游
  `POST .../images/generations`。
- 开启 `selfie_enabled` 后，把上游的「空镜」提示词换成自拍提示词：去掉
  「没有人物 / 路过的人拍 / 胶片质感」，加入前置镜头、脸和上半身、看镜头。
- `selfie_reference` 支持 WebUI 上传参考图（png/jpg/jpeg/webp），走
  `/images/edits`（默认）或带 `image_url` 的 `/images/generations`（`generation` 模式）。
- 结果包回上游认识的 `{data:[{b64_json|url}]}`；没有参考图时照片失败，不退回空镜。
- 新增配置：`selfie_enabled`、`selfie_reference`、`selfie_subject`、`selfie_prompt`、
  `selfie_api/key/model`、`selfie_mode`、`selfie_image_field`、`selfie_size`。
- 新增 4 项测试：提示词清洗、带参考图的 edits 代理、无参考图失败、RawBridge 端到端
  （`album.shoot` 真的走参考图接口）；共 22 项。
- 实测：带 mock 图生图接口跑通 multipart 参考图请求，返回 b64 给上游。

### 0.6.1 — 2026-11-03

### 内置从 npm 更新上游源码

- 新增 `adapter/update.ts`：从 `https://registry.npmjs.org/coopani-world-journey` 拉元数据/tarball，
  校验 `dist.integrity`，解压到 staging；仓库用 `npm run upstream:update`，插件用 `/journey_update`。
- 新增 AstrBot 命令 `/journey_update [latest|版本]`（管理员）：停泵/停 sidecar → 备份旧 raw →
  换新 raw → 重启 → 失败自动回滚。
- `adapter/raw.ts` 改成**运行时动态 import** raw：sidecar bundle 从 341KB 降到约 42KB；
  `plugin/raw/` 成为安装后的源码/更新目标，更新后不需要重新打包 adapter。
- sidecar 以 `node --experimental-transform-types` 运行 raw TS；Node 要求从 22+ 收紧到 **22.7+**。
- 构建脚本拆成 `sidecar.mjs` + `update.mjs`，并把 `raw/` 复制进插件包。
- 实测：AstrBot 内 `/journey_update` 从 0.5.16 更新到 0.5.19，sidecar 正常重启、工具重新注册；
  失败路径会回滚。

### 0.6.0 — 2026-11-02

### 从「分叉」改成「以 raw 为上游的套壳」

上一版把 Coopani 依赖剥离后，自己维护了一份 `world.ts`。上游 0.5.16 又加了月文件日记、
`travel-memory.json`、节假日/打工等功能，分叉会继续落后。这一版改成：

- `raw/`：上游 0.5.16 源码，**只读**；构建前后校验 hash。
- `adapter/`：唯一的 raw 导入点、类型垫片、本地宿主/媒体/事件、配置、提示词清洗、
  回环 HTTP sidecar、虚拟时钟模拟。
- `plugin/astrbot_plugin_world_journey/`：AstrBot Python 插件，命令 + 动态工具 + 提示词注入 +
  主动事件泵 + sidecar 生命周期。
- `upstream.lock.json`：上游版本/逐文件 hash；`upstream-check` 用于更新演练。
- 旧分叉已清理，不参与构建与测试。

### 兼容策略

- 工具/配置/事件动态透传；上游新增工具和字段通常不用改 Python。
- 公开面（`JourneyWorld` 构造、`start/stop`、`tools`、`envPromptVars`、`webUi.invoke`）由
  `adapter/raw.ts` + `adapter/contract.ts` 集中检查。
- 私有 `tick`/定时器只在 `adapter/compat/private.ts` 的模拟里使用；生产 sidecar 不依赖。
- 未知 `host.xxx` 调用用 Proxy no-op 兜底并告警。
- prompt 的「身体怎么动」段与 `music_pick` 在套壳层清洗，不改 raw。

### AstrBot 侧

- 命令：`/journey`、`/journey_depart`、`/journey_photo`、`/journey_diary`、`/journey_stats`、
  `/journey_draw`、`/journey_sync`、`/journey_debug`。
- 工具：上游 `tools()` 动态注册（当前 5 个）。
- 提示词：`on_llm_request` 注入。
- 主动消息：`event_target` + `proactive_enabled`，flush/debounce，照片发送。
- sidecar：token、心跳、看门狗、真实 `node.exe` 解析（避免 Windows `.CMD` 留下孤儿进程）。

### 测试

- 18 项 TypeScript 测试：上游 hash/契约、媒体/事件、桥接、配置、提示词、HTTP sidecar、模拟。
- AstrBot 4.29.4 实机验证：插件加载、5 工具注册、`/journey`、`/journey_depart`、主动消息。
