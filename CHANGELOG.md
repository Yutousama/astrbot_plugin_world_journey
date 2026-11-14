# 更新日志

## 未发布 — 汇报配图失败时在文字末尾补一句原因

1.0.9 之后加的一个小功能，**不动版本号**。

### 行为

主动汇报要配图但生图失败时，以前只是日志里一行 warning，聊天里她照常说话 ——
看起来像「今天不想发图」，实际是接口回了 400。现在在汇报文字末尾补一句：

```
（本来想配一张自拍，生图没成功：HTTP 400：images[].image_url is required）
```

- 开着 `selfie_enabled` 说「本来想配一张自拍」，关着说「本来想配一张现场的图」——
  措辞必须跟实际走的那条链路一致，否则排查方向直接被带偏；
- 只有**真的试过了且失败**才有这句：`report_image_mode=off`、概率没抽中、
  事件本身已带照片，都不补；
- 原因取自 sidecar 的错误文本并压缩：优先取 `message`、**剥掉 `(request id: …)`**
  （那串号在聊天里没用，要查去看日志），其次只留 `HTTP <码>`，都没有就剥掉 `{}"[]`；
  最后统一 `_clip` 压到 60 字。压缩规则是拿**实测回来的真实错误**校准的：
  中转站不存在的模型会回 180 字的 `No available channel for model … under group 管理员
  (distributor) (request id: 2026…)`，不封顶不剔号就是一坨没法看的东西。

### 实测（部署后的代码，两条失败路径都不出图、不花配额）

```
【死端口（连接级失败）】  图片：null   reason："gpt-image-1：fetch failed"
【中转站上不存在的模型名】 图片：null   reason："wj-no-such-model-xyz：生图接口 HTTP 503：{...180 字...}"
```

### 接线

- `adapter/bridge.ts`：新增 `lastReportImageError`（成功时清空，别把上次的原因拖过来）；
  `reportImage()` 两条路径（自拍 / 空镜）合并成一个 try，失败原因留在字段上。
- `adapter/server.ts`：`/api/report-image` 响应多一个 `reason` 字段。
- `bridge.py`：`reportImage()` 返回 `(bytes | None, reason)` —— 传输层异常仍抛
  `BridgeError`，由调用方转成尾巴文案。
- `event_pump.py`：`image_factory` 协议改成返回 `(图片, 小尾巴)`，`_send_event` 在无图时追加。
- `main.py`：`_maybe_report_image` 决定措辞；新增 `_compact_image_reason()` 压原因。

### 验证

- `npm run check` 全绿（typecheck + **89 项测试** + 上游校验）；
  `test/server.test.ts` 里新增两条断言：失败时 `reason` 带回来、成功后 `reason` 必须是空串；
- `checks/check-report-note.py`：从 `main.py` 源码里原样抽出方法跑 9 组
  （off / 概率没抽中 / 已有照片 / 成功 / 自拍措辞 / 空镜措辞 / 抛异常 / 原因压缩 / 抽中才调接口），
  全通过 —— 判据和实现同源，不是复制一份去测。

## 1.0.9 — 2026-11-15（上游 raw 0.8.6 → 1.8.0 + Grok 参考图出片 + 面板瘦身）

本版主题：**吃下上游 1.x 全段**（0.9 → 1.8.0，约 60 个发布版）。核对结论是
**公开面一处没破**，破坏只落在「模拟器停定时器」和「汇报配图与相册同源」两处，
其余全是新功能接入与文档。

### 上游更新

- `npm run upstream:update`：npm 元数据 sha512 校验通过；备份 `.raw.bak-0.8.6`。
- `raw/` 文件数 45 → **67**：新增 `data/city-play.json`、`data/hotel-facts.json`（约 1.6 MB 真数据表）、
  上游 `docs/`，以及 `src/` 下 12 个新模块（`bridge.ts` 车费桥、`secrets.ts`、`version-check.ts`、
  `image-backend.ts`、`party-log.ts`、`mate-talk.ts`、`geo/{city-play,eatery,hotel-facts,season,spot-profile}.ts`、
  `plan/leisure.ts`）；`src/action-wishes.ts` 被上游删除（1.6.19 连功能一起撤）。
- 公开面逐项复核，**没有破坏套壳契约**：`start/stop/tools/envPromptVars/webUi` 都在、
  必需 5 个工具名都在、8 个必需提示词变量都在、`now`/`album` 面板都在、
  `host.` 仍只有 `log`/`pushEvent`、`photo.ts` 仍导出 `photoPrompt`/`spotFromBeat`、
  `cortico` 仍只有 `import type`、`state.ts` 的 `version` 仍是 1（旧存档继续读）。
- 上游能力面扩张：工具 15 → **23**、面板 3 → **5**（新增 `mates`、`settings`）、
  事件新增 `journey.car` / `journey.part` / `journey.ride`。

### 壳层适配（全部在壳里解决，`raw/` 一个字没改）

1. **`adapter/compat/private.ts` 定时器清单**（唯一的真破坏）：上游 1.6.19 删了 `wishTimer`，
   新增 `heartTimer`（20 分钟位置心跳）、`versionTimer`（3 小时 npm 对账）、`reportRetryTimer`。
   清单不更新，模拟就留着真实定时器继续跑心跳/版本检查（表现是测试跑完进程不退、CI 多打 npm）。
2. **`adapter/raw.ts` 构造参数**：补上 1.6.19 新增的可选 `keys` / `persist` 类型，
   并**决定不传**——上游 `adoptKeys()` 第一句 `if (!ports) return`，不传就完全不发生
   「把 amapKey/imageKey 搬进 `.env` 并清空配置」。AstrBot 的 key 由插件配置表单管，
   被上游抹掉反而没人能改回来。
3. **`adapter/bridge.ts capabilities()`**：从 3 项扩到 14 项（1.x 八个新工具 +
   `photoFocus`/`photoDescribe` + `matesPanel`）。指令版本闸的主路仍是这份实测，
   旧版兜底表跟着同步，「壳新 raw 旧」时给准确指引。
4. **`adapter/photo-prompt.ts` 汇报配图与上游同源**（这块的收益最实在）：
   - 补传 `cityId`：1.8.0 的视觉锚点、季节句、太阳高度**全按 id 查**，只有地名时上游退化成
     「只拍城市」。在城里直接读快照 `place.id`；在路上快照只给目的地**名字**，
     于是多 import 一个上游 `geo/cities.ts` 用 `cityByName` 反查（`photo.ts` 本就依赖那张表，
     不多加载模块）。实测差异：喀什 19 点从「判黑」变成「天还蓝、光很低」。
   - 补上游 1.11 的判据：在路上**过半才算到目的地那一带**（`leg.progress` 是百分数）；
     原来一律取目的地，「刚出成都两小时」窗外就成了戈壁滩。
   - 补 `minimal` / `cast`：上游自动拍照会传这两件（1.6/1.7 加的），少传就变成
     「相册按设置出图、汇报图不按设置」——和当初「画风不生效」同一类分裂。
   - `hour` 改四舍五入对齐上游 `Math.round(decimal)`：18:40 那边按 19 点判光。
   - `month`/`day` **故意仍不传**：上游 `maybePhoto` 自己也没传（`scene.month ?? 1`），
     两边一致优先于单侧更准；已判定这是上游的遗漏，值得单独去提。
5. **Python 壳**：新增 5 个配置项 `image_preset` / `image_minimal` / `bridge_spend` /
   `bridge_diary` / `bridge_live`（三个桥开关默认 **关**，AstrBot 没有写 `ride-pending/` 的邻居扩展）；
   `photo_dir` 文案改成上游 1.6.15 澄清后的真实语义（「另外再存一份」，不是「换地方存」）；
   `_FEATURE_MIN_RAW` / `_FEATURE_CAP_KEY` 从 3 项扩到 10 项。
6. **新指令**：`/journey_eat 火锅 [晚饭|12:30]`、`/journey_signpost 一句话`（≤40 字、需碰面服务器）、
   `/journey_mates`（读快照里的同行记忆）；`/journey_photo` 认不出题材时不再回一句「不认识」，
   整句按 1.0.9 的 `describe` 交给她写画面（旧上游仍走原来的题材提示）。

### 明确不做（并写进 README 说明理由）

`settings`（生图设置）面板与 `saveImageSettings`（AstrBot 有自己的配置表单 + 热重载，
接两套写入口必打架）；密钥进 `.env`；车费桥的文件契约对端模拟；音乐扩展联动
（套壳一直用自己的 `nowplaying.json` 回调）；立绘动作 / `{{pet.vocab}}`（提示词继续剥动作段）。

### 验证

- `npm run check` 全绿：typecheck + **60 个测试**（46 → 60）+ 上游校验「与锁一致：1.8.0（67 个文件）」；
- `npm run build`：sidecar 81.6 KB、`engine/upstream.json` 写入 1.8.0/67、raw hash 构建前后未变；
- 新增守卫：工具/面板清单钉死、`FIELD_MAP` 每个引擎键必须在上游 defaults 或套壳白名单里、
  `pauseTimers` 按对象上真实存在的 `*Timer` 字段逐个查停、离线模拟不留 npm 查询成功痕迹。

### Grok（xAI）参考图出片：接口形状

上游 1.7.1 加了 `image-backend.ts`，但那是「哪家云端」的预设，不是「请求长什么样」。
Grok 的 `/v1/images/edits` 与 OpenAI 那套**不是同一个形状**（官方文档 + `openapi.json` 核对）：
只收 `application/json`（OpenAI SDK 的 `images.edit()` multipart 直接被拒）、参考图必须是
**对象** `image:{url}`（多图换 `images:[…]` ≤5）、**没有 `size` 也没有 `watermark`**，
尺寸改由 `aspect_ratio` + `resolution` 表达，且官方明确说单图编辑的比例总是从输入图推。

形状错了的坏法正是最难查的那一种：**接口收下请求、把不认识的字段丢掉，照样 200 出一张
跟她毫无关系的照片**。所以这一层必须在套壳的 fetch 代理里做 —— 上游的 400 阶梯只会
**删**字段，学不会**换**字段。

- `adapter/selfie.ts` 新增 `ImageShape` / `resolveImageShape()`（解析只在这一处）、
  `grokSizeOf()`（`1664x928`→`16:9`+`1.5k`、`3:4`→比例、`2k`→分辨率）、
  `applyGrokShape()`（空镜也换形状）、`loadSelfieReferences()`（Grok 一次喂最多 5 张参考图）、
  `proxyHint()`（连不上时说明 Node 的 fetch 默认不走系统代理，要 `NODE_USE_ENV_PROXY=1`）。
- 自拍超时不再写死 120 秒，改跟 `image_timeout_sec`（2k 的编辑请求实测 60–90 秒）。
- 别家形状收到 `3:4`/`2k` 这种值时**不发 `size`** 并 warn 一行，免得吃一个看不懂的 400。
- 内置 `DEFAULT_GROK_PROMPT`：按 xAI 的 Prompting Guide 写的「编辑型」模板
  （先说要改什么 → 再一句话锁定身份 → 画风/时间 → 只留一条负面）。通用模板里那串
  「不要换脸，不要变成陌生人，没有文字、水印、边框」正是官方建议避免的写法。
  **用户写过自己的模板就永远不替换**；判据 `isBuiltInTemplate`（TS）/
  `is_builtin_prompt`（Python）两侧一致，由测试逐字守着（`defaults.py` ↔ `selfie.ts`）。

### `auto` 按**模型名**认形状（实测推翻了我最初按地址猜的方案）

实测那台中转站 `ai.yutou233.cn` 一个域名后面同时挂着 `grok-imagine-image`、
`gpt-image-2.6-flare`、`qwen-image-3.0-pro`、`wan2.7-image` —— 地址毫无信息量。
真实请求矩阵（全部实测，不是推断）：

| 参考图字段形状 | `grok-imagine-image` | `gpt-image-2.6-flare` |
|---|---|---|
| multipart（旧 `openai` 形状） | 未测 | **502** |
| 顶层 `image_url` + `size` | ✅ 200 / 84.6s | 400 `images[].image_url is required` |
| `image:{url}` 无 `size` | ✅ 200 / 76.6s | 400 同上 |
| `images:[{image_url}]` / `[{url}]` 无 size | ✅ 200 / 57.7s、76.4s | 502 |
| 任何形状带 `size` | ❌ 400 `Argument not supported: size` | ❌ 同 |
| 带 `aspect_ratio` + `resolution` | ✅ 200 / 68.2s | —— |

于是优先级改成：显式值 > 旧 `selfie_mode`/`selfie_edit_json` > **模型名**（`MODEL_SHAPES`）
> 接口地址 > 默认 `openai`，并且**降级链里每换一个模型都重新认一次** ——
顺带消掉了「形状全局一套」的限制：`gpt-image → gpt-image → grok` 这种混用在实例上
真跑通了（前两个各失败一次，第三个用 `image:{url}` 出图 351 KB，女仆装细节和脸都对得上）。

`wan` 是唯一故意不按模型名认的：同一个万相模型名既可能配百炼原生端点（要 `wan`）
也可能配中转站兼容端点（要 `openai`），这歧义只有地址能解。

### 面板瘦身：生图/自拍相关 32 → 26 项，为 Grok 一个可见选项都没加

| 动作 | 旧 | 新 |
|---|---|---|
| 4 → 1 | `selfie_mode`、`selfie_edit_json`、`selfie_image_field`、`selfie_native_url` | `image_shape`（后来又整项去掉，见下） |
| 2 → 1 | `image_no_size`、`image_no_response_format` | **`image_compat`**（`none`/`no_size`/`no_format`/`both`） |
| 2 → 1 | `image_prompt_template` + `selfie_prompt` | **统一提示词模板**（默认文本直接摆在面板上，留空由迁移填回） |
| 整项去掉 | `image_shape`、`image_preset`、`bridge_spend`/`bridge_diary`/`bridge_live` | 形状固定 `auto`；预设不映射＝上游默认 `custom`；车费桥在 `PANEL_DROPPED_ENGINE_DEFAULTS` 固定 `False`（上游默认是 `true`，**不映射不等于关**） |

- 逃生口统一走 `extra_config`：`{"imageShape":"relay"}`、`{"selfieImageField":"image"}`、
  `{"bridgeSpend":true}`、`{"imageQuality":"medium"}`。
- 迁移（`main.py`，一次性写回）：旧四键 + 残留 `image_shape` 清空；两个模板字段合并 ——
  只有旧 `selfie_prompt` 被用户写过就把他那份搬进统一模板，**两处都写过就保留生效那份、
  旧那份全文备份到 `template_backup/`**（日志给路径，不静默丢用户内容）。
- `test/config.test.ts` 的「1.8.0 新增键已接到表单」守卫改成 `PANEL_DROPPED` 显式例外表：
  每一项必须写理由，并校验「不再映射」+「引擎侧有兜底」；同时断言旧四键不许再映射
  （它们优先级高于模型名猜测，映射着就等于让固定 `auto` 失效）。
- `image_minimal`（极简提示词）的 hint 从黑话重写成大白话：控制发给画图模型那段描述写多长。

### 主动汇报配图不再要求开自拍

以前 `selfie_enabled` 关着就完全不配图（「保持原来的成本上限」），于是
「不想每句话都塞一张自拍、但想配一张她眼前的景」直接配不出来。

- `adapter/selfie.ts` 新增 `generateSceneImageBytes()`：不带参考图，走空镜模板 +
  同一套形状改写 + 同一条降级链。
- `bridge.reportImage()` 双路：开着自拍走参考图编辑接口，关着走空镜。
- `main.py` 去掉那道门槛；成本变化写进 hint 与 README。

### 日志可诊断性（从实例真实日志里翻出来的两处）

- 降级链**每一次失败都单独记一行**（以前只在全部失败时汇总，中间为什么没过看不见）。
- 形状配错的 warn 只在**形状被钉住**时才发：`auto` 下混用多家是正常配置，
  实例日志里就出现过「链子跑通并出了图，启动却先挨一条警告」的噪音。
- 启用行改成对照表：`自拍套壳已启用：降级链形状 gpt-image-2.6-flare→openai、grok-imagine-image→grok`。
- `/journey_debug` 增加「生图形状」「字段兼容」两行。

### 本版验证

- `npm run check` **89/89 通过**（本版新增 25 条测试：形状解析、grok 两条路径、尺寸映射、
  编辑型模板与跨语言一致性、按模型名 auto、混合降级链各用各的形状、空镜配图、模板迁移）；
- 三份 Python/Node 校验脚本（`config_map` 展开 9 组、`main.py` 迁移 9+8 组、面板与重复自检）；
- 端到端实测：`auto` + `grok-imagine-image` → 88.7 秒出图 333 KB，日志
  `形状=grok（按模型名认出）`、`自拍接口响应：HTTP 200（grok）`；
- 构建：sidecar 101.8 KB、`engine/upstream.json` 1.8.0/67 文件、raw hash 构建前后未变；
- 已部署到本地 AstrBot 实例并重载验证。

## 1.0.8 — 2026-11-07

本版主题：**生图接口兼容层**——按服务商的报错逐个关掉不认的字段，参考图过大时自动压缩。

### 新增：三个请求形状开关（默认关，保持老行为）

- `image_no_response_format`：不发 `response_format`，给不认这个字段的接口；
- `image_no_size`：不发 `size`，给回 `Argument not supported: size` 的接口
  （此时「出图尺寸」「自拍尺寸」不生效）；
- `selfie_edit_json`：`edit` 模式直接发 JSON（参考图放 `selfie_image_field` 的 data URL），
  给只认 `application/json` 的中转站/上游；关着时 multipart 失败、错误点名
  multipart / Content-Type 也会自动兜底一次 JSON。

### 修复：编辑模式 JSON 兜底

- 兜底字段从写死的 `image` 改为 `selfie_image_field`（默认 `image_url`）——不少上游只认后者；
- 触发条件从「400/415 + 正文点名」放宽到 415 与所有 5xx（中转站把上游形状错误包成 502 的情况）；
- JSON 编辑体会按开关正确携带 `response_format` 与 `size`（上一轮重写时漏掉过，本版补上）。

### 新增：参考图自动压缩（`selfie_reference_shrink`，默认开）

- 超过 600 KB 的参考图压一份（最长边 1024、JPEG q82）再发给接口，**原图不动**，
  产物在 `files/selfie_reference/_cache/`；
- 背景：3 MB 的 PNG base64 后请求体接近 4 MB，有的上游直接 `502`，有的收下图却不用 ——
  表现是「人物和参考图完全不像」；压缩后同一请求 20–30 秒出图，人物一致；
- 没装 Pillow / 压缩失败时退回原图，只记一条 warning。

### 修复：generation 模式错误可读

- 以前上游 400 会被吞成「返回里没有图片」；现在直接抛
  `自拍接口 HTTP <status>：<正文>`。

### 验证

- `npm run check` 全绿（typecheck + 51 个测试 + 上游校验）；
- 实测链路：中转站 JSON + `image_url` + 150 KB 参考图 → 200，27 秒，人物与参考图一致；
- 打包产物 `engine/sidecar.mjs` 冒烟：请求体带 `response_format=b64_json`、按开关不带 `size`。

## 1.0.7 — 2026-11-07

审核修复版：**1.0.6 的完整功能都包含在本版**（1.0.6 已过审读但未分发，本版随审核修正定版）。

- **npm 最新版本查询改 aiohttp 异步**：指令版本闸被审核指出一处并发问题——
  `_npm_latest_version()` 在异步命令链（`_require_raw` 由命令 handler `await`）里
  用同步 `urllib.request.urlopen(timeout=5)` 发请求，最坏会卡 AstrBot 事件循环 5 秒。
  现改为 `aiohttp.ClientSession + ClientTimeout(total=5)`（与 `bridge.py` 同款依赖），
  行为不变：缓存新鲜不联网、失败静默沿用旧值、仍只在功能缺失时才走这条网络路径。
- 验证：真实源码抽取驱动 6/6（含「缓存新鲜 → 外呼次数 = 0」锁定）、`npm run check` 46/46、
  部署目录 `main.py` 无任何 `urlopen` 残留。

### 1.0.6 的其余内容（同版携带）

见下一节，条目与本版一致：上游 raw 0.8.6、壳层补齐、设置页整理、指令版本闸（能力实测）。

## 1.0.6 — 2026-11-06

本版主题：**上游 raw 0.5.26 → 0.8.6**，0.6–0.8.6 期间的功能缺口全部在壳层补齐；
顺带完成设置页整理（68 → 66，分组重排 + 两项合并）；
并为「壳新 raw 旧」的老用户加了**指令版本闸（能力实测）**。

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

### 指令版本闸：「壳新 raw 旧」的老用户兜底（能力实测）

- 场景：插件更新会把 `raw/` 换回发布包基线，而旧上游没有新功能时，新指令原本会
  **静默给错行为**（点头答不上、题材拍成普通风景）。现在命令命中时先确认上游真有
  这个功能，没有就不调引擎，直接回可操作指引（需求版本、当前版本、npm 最新、
  按 `allow_upstream_update` 开关状态给出不同升级路径）。
- **判定优先用能力实测**：`adapter/bridge.ts` 新增 `capabilities()`，随 `/api/health`
  上报当前真加载的 raw 有没有 `answerAsk` 方法 / `journey_return_home` 工具 /
  `journey_photo` 的 `subject` 参数——上游 `/journey_update` 升到未来版本或改名后
  自动跟上，**忘记维护手工表也不会误拦或漏拦**。`returnHome` 探测走工具名而非
  world 方法（后者只是 `ui.invoke` 路由字符串，0.5.19 与 `journey_return_home`
  工具同批引入，工具面等价）。
- 手工表（`_FEATURE_MIN_RAW`）退化为文案素材与 sidecar 不可用时的版本兜底：
  `/journey_yes|no` ≥ 0.7.9、`/journey_back` ≥ 0.5.19、`/journey_photo 带题材` ≥ 0.8.5
  （不带题材的旧补拍路径不拦）。
- 「npm 最新版本」查询带 6 小时缓存（`plugin_data/upstream-latest.json`），失败静默
  沿用旧值——只在功能缺失时才走这条网络路径；raw 目录丢失同样给明确提示。
  sidecar 就绪时正常命令只多一次回环 health 查询（毫秒级）。
  （审核修正：该查询最初用同步 `urllib` 在异步命令链里发起，会卡 AstrBot 事件循环
  最长 5 秒——已改为 `aiohttp` 异步请求，与 `bridge.py` 同款依赖。）
- 维护约定（README）：新增面板指令 = `capabilities()` 加一行 + `_FEATURE_MIN_RAW`/
  `_FEATURE_CAP_KEY` 各加一条。
- 验证：main.py 真实源码抽取驱动 8/8（实测 true 优先于错表 / 实测 false 拦 0.8.6 /
  无实测退表兜底与放行 / bridge 未建 / health 抛错退表 / raw 丢失 / caps 缺键退表）；
  `bridge.test.ts`、`server.test.ts` 断言 0.8.6 实测全 `true`。

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
