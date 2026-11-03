# 第三方声明

## coopani-world-journey（上游引擎）

- 原项目：<https://www.npmjs.com/package/coopani-world-journey>
- 作者：Mr.Q
- 许可：MIT（见 `raw/package.json` 的 `license` 字段）
- 说明：`raw/` 为只读上游源码。本项目的 AstrBot 接入层只做宿主适配与插件封装，
  不修改上游逻辑；发布包把上游源码放在 `raw/`，由 sidecar 在运行时动态加载。
  感谢原项目提供的旅行引擎。

## amaro（TypeScript 转换器，随插件发布）

- 项目：<https://github.com/nodejs/amaro>
- 许可：MIT（`engine/amaro/LICENSE-amaro.md`）
- 说明：Node 26 起移除了 `--experimental-transform-types`，插件改用 amaro 在
  `import` 上游 `.ts` 时现场转换。它是 Node.js 官方仓库的 TS 解析/转换包装，
  内核为 SWC 编译成的 WebAssembly，纯 JS+WASM，没有原生二进制。
- amaro 的 `dist/` 里同时打包了 SWC 的 WebAssembly 产物，遵循 Apache-2.0
  （见 `engine/amaro/LICENSE`，Copyright 2024 SWC contributors）。

## 本项目

- AstrBot 套壳、插件与脚本由 **yutou** 维护，MIT。
- 如果上游后续提供独立 LICENSE 文件，以 `raw/LICENSE` 为准并替换本节说明。
