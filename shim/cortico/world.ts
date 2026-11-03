/**
 * `cortico/world.ts` 的类型垫片。上游只用它描述 WorldDefinition 和配置的公共字段。
 * 运行时不存在，不参与打包。
 */

export interface WorldSection {
  enabled?: boolean;
  readonly [key: string]: unknown;
}

/** 上游 `definition.ts` 用它标注默认导出；套壳不 import definition，保留仅为类型完整。 */
export type WorldDefinition<T> = {
  readonly id: string;
  readonly label: string;
  readonly defaults: () => T;
  readonly create: (ctx: {
    readonly cfg: T;
    readonly dataDir: string;
    readonly botName: string;
  }) => unknown;
  readonly describe?: unknown;
};
