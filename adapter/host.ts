/**
 * 本地宿主 —— 把上游 `WorldHost` 落成本地文件。
 *
 * 上游只调用 `host.log` 和 `host.pushEvent(event, { trigger })`；`pushEvent` 返回的
 * `{ blobs: [{ handle }] }` 会被上游 `maybePhoto` 当成照片句柄。这里用
 * `LocalMediaStore` 写 `<dataDir>/media/`，句柄就是文件名。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog, type EventPhoto, type EventRecord, type TriggerMode } from './events.ts';
import { LocalMediaStore } from './media.ts';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface LogOptions {
  readonly echo?: boolean;
  readonly verbose?: boolean;
}

/** 控制台 + `<dataDir>/logs/sidecar.log`。不打印密钥。 */
export function createLogger(dataDir: string, opts: LogOptions = {}): Logger {
  const echo = opts.echo ?? true;
  const verbose = opts.verbose ?? false;
  const file = join(dataDir, 'logs', 'sidecar.log');
  let ready = false;

  const write = (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string): void => {
    const line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (echo) {
      if (level === 'ERROR') console.error(line);
      else if (level === 'WARN') console.warn(line);
      else console.log(line);
    }
    try {
      if (!ready) {
        mkdirSync(join(dataDir, 'logs'), { recursive: true });
        ready = true;
      }
      appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      // 日志写不进去不影响旅行。
    }
  };

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    debug: (msg) => {
      if (verbose) write('DEBUG', msg);
    },
  };
}

interface RawBlob {
  readonly bytes?: Uint8Array;
  readonly mime?: string;
  readonly name?: string;
  readonly fallbackText?: string;
}

interface RawEvent {
  readonly type?: unknown;
  readonly senderKey?: unknown;
  readonly text?: unknown;
  readonly ts?: unknown;
  readonly blobs?: RawBlob[];
}

export interface RawHostOptions {
  readonly dataDir: string;
  readonly events: EventLog;
  readonly media: LocalMediaStore;
  readonly echo?: boolean;
  readonly verbose?: boolean;
  readonly onEvent?: (event: EventRecord) => void;
}

export class RawHost {
  readonly log: Logger;
  readonly events: EventLog;
  readonly media: LocalMediaStore;
  private readonly onEvent: ((event: EventRecord) => void) | null;

  constructor(opts: RawHostOptions) {
    this.events = opts.events;
    this.media = opts.media;
    this.onEvent = opts.onEvent ?? null;
    this.log = createLogger(opts.dataDir, { echo: opts.echo ?? true, verbose: opts.verbose ?? false });
  }

  async pushEvent(
    event: RawEvent,
    opts?: { readonly trigger?: TriggerMode },
  ): Promise<{ readonly blobs?: { readonly handle: string }[] }> {
    const blobs = Array.isArray(event.blobs) ? event.blobs : [];
    const refs: EventPhoto[] = [];
    for (const blob of blobs) {
      if (!blob?.bytes) continue;
      const ref = this.media.save({
        bytes: blob.bytes,
        mime: typeof blob.mime === 'string' && blob.mime ? blob.mime : 'image/png',
        name: typeof blob.name === 'string' && blob.name ? blob.name : 'photo.png',
      });
      refs.push(ref);
    }
    const type = typeof event.type === 'string' && event.type ? event.type : 'journey.unknown';
    const key = typeof event.senderKey === 'string' && event.senderKey
      ? event.senderKey
      : `${type}-${Date.now().toString(36)}`;
    const stored = this.events.append({
      type,
      key,
      text: typeof event.text === 'string' ? event.text : '',
      trigger: opts?.trigger === 'debounce' ? 'debounce' : 'flush',
      ts: typeof event.ts === 'string' ? event.ts : new Date().toISOString(),
      ...(refs[0] ? { photo: refs[0] } : {}),
    });
    this.onEvent?.(stored);
    return refs.length ? { blobs: refs.map((r) => ({ handle: r.handle })) } : {};
  }
}

/**
 * 给上游 host 加一层兜底：上游若新增 `host.xxx` 调用，返回 no-op 并告警，
 * 而不是直接 TypeError。已知的 log/pushEvent 正常走。
 */
export function withHostFallback(host: RawHost): RawHost {
  return new Proxy(host, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return undefined;
      target.log.warn(`上游调用了未实现的 host.${String(prop)}，已用 no-op 兜底；可能需要更新 adapter/host.ts。`);
      return () => undefined;
    },
  });
}
