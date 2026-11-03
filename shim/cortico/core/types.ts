/**
 * `cortico/core/types.ts` 的类型垫片。
 *
 * 上游 `raw/src` 只在 `world.ts` 里 `import type` 这个模块。运行时这些类型全部被擦除，
 * 所以这里只负责让 tsc 能读懂上游代码。**故意放宽**：上游升级时优先改垫片，
 * 不去改 `raw/`。真正的契约由 `adapter/contract.ts` 在运行时检查。
 */

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export type TriggerMode = 'flush' | 'debounce';

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly summary?: { readonly zh: string; readonly en: string };
  readonly handler: (args: unknown) => unknown;
}

export interface BlobInput {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
  readonly fallbackText?: string;
}

export interface EventEnvelope {
  readonly blobs?: { readonly handle: string }[];
  readonly [key: string]: unknown;
}

export interface WorldLamp {
  readonly label: string;
  readonly state: 'online' | 'offline' | 'error';
  readonly hint: string;
}

export interface WorldWebUiDecl {
  readonly label?: string;
  readonly badges?: unknown[];
  readonly lamps?: WorldLamp[];
  readonly panels?: { readonly id: string; readonly title?: string; readonly description?: string }[];
  readonly invoke?: (panel: string, method: string, args: unknown[]) => Promise<unknown>;
  readonly config?: unknown;
  readonly promptDocs?: unknown[];
  readonly [key: string]: unknown;
}

/** 上游只要求 class 有 id；具体能力由运行时契约检查。 */
export interface World {
  readonly id?: string;
}

export interface WorldHost {
  readonly log: Logger;
  pushEvent(event: unknown, opts?: { trigger?: TriggerMode }): Promise<EventEnvelope | null>;
  readonly [key: string]: unknown;
}
