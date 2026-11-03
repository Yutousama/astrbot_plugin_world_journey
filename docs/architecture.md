# 架构

## 三层

```
raw/            上游 coopani-world-journey（开发基线，正常只读）
  ↓ npm 更新 / 构建复制
plugin/.../raw/ 安装后的上游源码（运行时动态加载 + 更新目标）
  ↑ adapter/raw.ts 动态 import（不是 bundle）
adapter/        TypeScript 套壳
  ├── raw.ts        loadRaw(): 运行时 import raw/src/world.ts
  ├── host.ts        WorldHost: log / pushEvent → EventLog + media
  ├── config.ts      raw JOURNEY_DEFAULTS + engine-config.json 覆盖
  ├── bridge.ts      公开门面: snapshot/now/prompt/tools/tool/depart/sync/photo
  ├── prompt.ts      渲染 ENV_PROMPT + 去动作段 + 清洗 music_pick
  ├── selfie.ts      生图 fetch 代理：空镜 → 自拍 + 参考图图生图
  ├── server.ts      回环 HTTP（token/心跳）
  ├── update.ts      npm registry 更新器（下载/校验/解压/staging）
  ├── sim.ts         虚拟时钟模拟（compat 私有 tick）
  └── cli.ts         serve/status/prompt/sim/check
  ↓ HTTP
plugin/         AstrBot Python 插件
  ├── bridge.py      sidecar 进程管理 + aiohttp 客户端
  ├── config_map.py  AstrBot 配置 → engine-config.json
  ├── event_pump.py  events → 主动消息（flush/debounce）
  └── main.py        命令 / 动态工具 / prompt hook / 更新命令 / 生命周期
```

## 关键边界

- **adapter/raw.ts** 是唯一接触 raw 的文件；它用 `import(pathToFileURL(...))` 动态加载，
  所以 sidecar bundle 只有约 58KB，更新 raw 不需要重打 adapter。
- 安装后的 sidecar 用 Node 跑 `sidecar.mjs`，再把 `raw/src/*.ts` 动态 import 进来：
  - Node 22.7–25.x：`node --experimental-transform-types sidecar.mjs`，由 Node 自带转换；
  - Node 26+：该 flag 被移除（`process.features.typescript` 也没有 `transform` 取值了），改传
    `--enable-source-maps --import file://.../engine/amaro/register-transform.mjs`。
  上游用了 parameter properties，擦除模式跑不了，必须真转换。
- 走哪条由 `bridge.py` 的能力探针决定：`node --experimental-transform-types -p process.features.typescript`
  返回 `transform` 才算原生可用。版本号只做下限（>=22.7），不做能力判断。
- **adapter/contract.ts** 检查公开面；**adapter/compat/private.ts** 只在模拟里碰私有 tick。
- **raw/src** 的 `cortico/*` 只有 `import type`；Node 的 transform-types 会擦除，无需 shim。
- 事件统一为 `{seq,type,key,text,trigger,ts,photo?}`，写 `events.jsonl`，Python 按 seq 轮询。
- 照片：上游 `pushEvent` 带 `blobs` → host 落 `media/<hash>.<ext>` → 返回 `{blobs:[{handle}]}`；
  Python 从 `/media/<file>` 取图。
- 配置：Python 写 `engine-config.json`（`{engine:...,wrapper:{offline}}`），sidecar 每请求检查 mtime
  并合并到 raw 的活配置对象。
- 生图代理：`selfie.ts` 在 sidecar 进程内包一层 `fetch`，只拦截 `POST .../images/generations`：
  - **模型降级**：`image_model` 是列表，Python 写成 `imageModels`，代理按顺序换 `model` 重发，
    全部失败才把错误交回上游；尺寸/字段不兼容的 400 不换模型，留给上游自己的兼容阶梯。
  - **自拍**：把空镜提示词换成自拍模板，用 `selfie_reference` 走 `/images/edits` 或带
    `image_url` 的 generations，再把结果包成上游认识的 `{data:[...]}`。
  - 自拍关闭且没配模型列表时完全不介入；关闭自拍、只配模型列表时只做降级。

## 生命周期

```
AstrBot initialize
  → 写 engine-config.json
  → spawn node --no-warnings [--experimental-transform-types | --enable-source-maps --import <amaro>] engine/sidecar.mjs serve ...
  → 读 stdout listening port
  → /api/health
  → /api/tools 动态注册 FunctionTool
  → 启动 EventPump
on_llm_request → /api/prompt 追加 system_prompt
事件 → EventPump → context.send_message(umo, chain)
terminate → 停泵/注销工具/终止 sidecar（Windows 按进程树）
```

## 更新生命周期

```
/journey_update [version]
  → node engine/update.mjs --target <plugin>/raw --version ... --json
  → registry 元数据 + tarball + sha512 校验 + tar 解压 → staging
  → 停事件泵/停 sidecar/注销工具
  → raw → .raw.bak-<old>；staging → raw
  → 启动 sidecar + 健康检查 + 重新注册工具 + 恢复事件泵
  → 成功删备份；失败 raw 回滚并恢复旧 sidecar
```

更新器只替换上游源码；adapter/Python 仍随插件版本发布。公开面变化由 `contract.ts` 在启动时检查，
失败会回滚。

## 控制范围

`access_scope=target` 时，`access.py` 用 `event_target` 的 UMO 做精确匹配：

- 命令：每个 `/journey*` 开头检查，非目标直接 `return`（不回复）；
- 工具：handler 再检查一次；同时 `on_llm_request` 把 `journey_*` 从非目标
  `req.func_tool` 里移除，避免模型看到；
- 提示词：非目标不注入；
- 主动消息：不再用 `last_umo` 兜底，只发 `event_target`。

`target` 但 `event_target` 为空时全部拒绝；管理员命令也一样。

## 重置旅行

```
/journey_reset confirm
  → 停事件泵/停 sidecar/注销工具
  → 删除 engine/（位置、事件、照片、日记、缓存）
  → 按旅行文件模式清空 memory_dir 的日记/travel-memory*.json/_bak
  → 重置 last_seq/event_log_id（保留 last_umo）
  → new SidecarBridge(...)（丢掉旧 EventLog/MediaStore 缓存）
  → 启动、重注册工具、恢复事件泵
```

配置、`engine-config.json`、自拍参考图不动；重置始终仅管理员，且必须带 `confirm`。

## 为什么不是纯 Python

上游约 30 个 TS 文件、124 城数据、作息/路线/日照算法。重写要重新验一遍全部旅行逻辑；
Node sidecar 只多一个进程，换来上游更新可直接复用。纯 Python 移植可在未来按同一 HTTP 契约替换。
