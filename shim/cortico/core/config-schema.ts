/** `cortico/core/config-schema.ts` 的类型垫片；上游 `config.ts` 只把它当返回类型。 */
export type ConfigGroup = {
  readonly id: string;
  readonly owner?: string;
  readonly schema: Record<string, unknown>;
};
