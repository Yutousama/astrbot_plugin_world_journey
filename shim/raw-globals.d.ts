/**
 * 上游 0.5.16 的 `world.ts` 在 `affordMode` 里用了 `TravelMode` 但没 import。
 * 它靠 tsx/esbuild 运行时直接跑，类型检查才会暴露。这里补一个全局别名，
 * 不去修改 raw。
 */
type TravelMode = import('../raw/src/geo/modes.ts').TravelMode;
