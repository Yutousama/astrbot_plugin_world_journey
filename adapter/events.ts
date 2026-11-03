/**
 * 事件日志 —— 上游 `pushEvent` 的本地落点。
 *
 * 上游事件带的是 `senderKey`；这里统一成 `{seq,type,key,text,trigger,ts,photo?}`，
 * 写 `events.jsonl` 供 Python 插件轮询。`eventLogId` 用来识别「事件日志被删/重建」，
 * 避免插件拿着旧 seq 永久忽略新事件。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PhotoRef } from './media.ts';

export type TriggerMode = 'flush' | 'debounce';

export interface EventPhoto extends PhotoRef {
  readonly title?: string;
}

export interface EventRecord {
  readonly seq: number;
  readonly type: string;
  readonly key: string;
  readonly text: string;
  readonly trigger: TriggerMode;
  readonly ts: string;
  readonly photo?: EventPhoto;
}

interface MetaFile {
  readonly eventLogId: string;
}

const MEMORY_LIMIT = 1000;

export class EventLog {
  readonly file: string;
  readonly metaFile: string;
  readonly eventLogId: string;
  private items: EventRecord[] = [];
  private nextSeq = 1;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'events.jsonl');
    this.metaFile = join(dataDir, 'events.meta.json');
    this.eventLogId = this.loadOrCreateId();
    this.loadTail();
  }

  get lastSeq(): number {
    return this.nextSeq - 1;
  }

  append(event: Omit<EventRecord, 'seq'>): EventRecord {
    const stored: EventRecord = { ...event, seq: this.nextSeq++ };
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(stored)}\n`, 'utf8');
    } catch {
      // 写盘失败不该影响旅行；内存里仍有这条。
    }
    this.items.push(stored);
    if (this.items.length > MEMORY_LIMIT) this.items = this.items.slice(-MEMORY_LIMIT);
    return stored;
  }

  /** `after=0` 时给最近一批；否则给游标之后。 */
  after(seq: number, limit = 200): EventRecord[] {
    if (seq <= 0) return this.items.slice(-Math.max(0, limit));
    return this.items.filter((e) => e.seq > seq).slice(0, limit);
  }

  recent(n = 50): EventRecord[] {
    return this.items.slice(-Math.max(0, n));
  }

  private loadOrCreateId(): string {
    try {
      if (existsSync(this.metaFile)) {
        const raw = JSON.parse(readFileSync(this.metaFile, 'utf8')) as Partial<MetaFile>;
        if (typeof raw.eventLogId === 'string' && raw.eventLogId) return raw.eventLogId;
      }
    } catch {
      // 坏 meta 当作没有，重建一个。
    }
    const id = randomUUID();
    try {
      mkdirSync(join(this.metaFile, '..'), { recursive: true });
      writeFileSync(this.metaFile, JSON.stringify({ eventLogId: id }, null, 2), 'utf8');
    } catch {
      // 写不进去也能跑，只是重启后 id 会变。
    }
    return id;
  }

  private loadTail(): void {
    if (!existsSync(this.file)) return;
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n').filter((line) => line.trim()).slice(-MEMORY_LIMIT);
    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as Partial<EventRecord>;
        if (typeof raw.seq !== 'number' || typeof raw.type !== 'string' || typeof raw.text !== 'string') continue;
        this.items.push(raw as EventRecord);
      } catch {
        // 半截行（强杀）跳过。
      }
    }
    this.nextSeq = this.items.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  }
}
