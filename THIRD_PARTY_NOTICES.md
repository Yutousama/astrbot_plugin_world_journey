# 第三方声明

## coopani-world-journey（上游引擎）

- 原项目：<https://www.npmjs.com/package/coopani-world-journey>
- 作者：Mr.Q
- 许可：MIT（见 `raw/package.json` 的 `license` 字段）
- 说明：`raw/` 为只读上游源码。本项目的 `adapter/` 与 `plugin/` 只做宿主适配与 AstrBot 接入，
  不修改上游逻辑；安装后的插件把上游源码复制到 `plugin/raw/`，由 sidecar 在运行时动态加载。
  感谢原项目提供的旅行引擎。

## 本项目

- AstrBot 套壳、插件与脚本由 **yutou** 维护，MIT。
- 如果上游后续提供独立 LICENSE 文件，以 `raw/LICENSE` 为准并替换本节说明。
