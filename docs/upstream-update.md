# 上游更新流程

上游默认源：[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)。
两种更新方式共用同一个更新器逻辑：`adapter/update.ts`（构建成 `engine/update.mjs`）。

## A. 安装后的 AstrBot 插件（推荐日常用）

```text
/journey_update            # 最新
/journey_update 0.5.25     # 指定版本
```

它做这些事：

1. 请求 `https://registry.npmjs.org/coopani-world-journey[/版本]`；
2. 下载 tarball，校验 `dist.integrity`（sha512；没有则 sha1）；
3. 用系统 `tar` 解压到 `<插件目录>/.raw.update-<版本>/package`；
4. 停事件泵、停 sidecar、注销工具；
5. 备份 `raw/` 为 `.raw.bak-<旧版本>`，把 staging 换到 `raw/`；
6. 启动 sidecar，跑公开面契约检查；
7. 成功：重新注册工具、恢复事件泵、删备份；
8. 失败：删新 `raw/`、恢复备份、重启旧 sidecar，然后把错误回给管理员。

配置项：

| 项 | 默认 | 说明 |
|---|---|---|
| `allow_upstream_update` | `true` | 关闭后 `/journey_update` 拒绝执行 |
| `upstream_package` | `coopani-world-journey` | npm 包名 |
| `upstream_registry` | `https://registry.npmjs.org` | registry 根 |
| `upstream_source` | npm 页面 | 只用于展示 |

运行时只替换上游源码；`adapter`/Python 代码仍随插件版本。若上游改了公开 API，契约检查会让新 raw
启动失败并自动回滚，不会把插件留在半坏状态。

## B. 仓库开发

```bash
npm run upstream:update    # 从 npm 更新 raw/，自动备份为 .raw.bak-<旧版本>
npm run upstream:check     # 版本、变更文件、CHANGELOG、契约扫描
npm test
npm run upstream:accept    # 只写 upstream.lock.json
npm run build              # 重建 sidecar/update，并把 raw 复制到插件
npm run deploy -- --target "<AstrBot>/data/plugins" --force
```

> 覆盖已加载的插件前先在 AstrBot 插件页停用，否则 Windows 会锁文件；部署后要**重载插件**
>（只启用不一定重载 Python 模块）。然后发 `/journey`、`/journey_debug` 验证。

`upstream:update` 的备份和 staging 都在仓库根，确认无误后可删 `.raw.bak-*`、`.raw.update-*`。

## 检查输出

`npm run upstream:check` 会打印：

- 新旧版本、全量 hash、变化文件；
- `raw/CHANGELOG.md` 顶部；
- 非 type 的 `cortico` import（有则构建会失败）；
- `world.ts` 公开面是否还在；
- `host.` 新增成员（警告）；
- prompt 的动作段/变量是否还在。

此时因为 `upstream.lock.json` 还是旧版，退出码是 1，这是预期的。

## 契约变了怎么办

只改套壳，不改 raw：

| 变化 | 改哪里 |
|---|---|
| `JourneyWorld` 文件路径/导出名 | `adapter/raw.ts` |
| `start/stop/tools/envPromptVars/webUi` 签名 | `adapter/raw.ts` + `adapter/contract.ts` + `adapter/bridge.ts` |
| `webUi().invoke` 方法名 | `adapter/bridge.ts` |
| host 新增方法 | `adapter/host.ts`（未知成员已有 no-op 兜底） |
| 私有 `tick`/定时器 | `adapter/compat/private.ts`（只影响模拟） |
| prompt 动作段/变量改名 | `adapter/prompt.ts` |
| 新增工具/配置/事件 | 通常不用改；工具/事件动态透传，配置默认值来自 raw |

每次变更在 `CHANGELOG.md` 记一条，写清上游版本和改了哪一处。

## 回滚

- 插件内：更新失败会自动回滚；要手动回滚，停用插件、把 `.raw.bak-*` 改名回 `raw/`、启用。
- 仓库：`raw/` 换回旧版，`upstream.lock.json` 换回旧基线，`npm run build` 即可。

数据格式兼容由上游负责（0.5.16 起旧日文件自动迁进月文件 `_bak/legacy/`）。
