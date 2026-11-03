/**
 * 虚拟时钟模拟器 —— 直接驱动 raw 的 `JourneyWorld`。
 *
 * 生产 sidecar 让 raw 自己按真实时间巡检；模拟器把时钟做成变量，并停掉 raw 的
 * 定时器，用 `compat/private.ts` 的私有 tick 手动推进。**私有依赖只在模拟里**。
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawBridge } from './bridge.ts';
import type { EventRecord } from './events.ts';
import { pauseTimers, tick } from './compat/private.ts';

export interface SimOptions {
  readonly dataDir: string;
  readonly days: number;
  readonly speed?: number;
  readonly seed?: number;
  readonly stepMinutes?: number;
  readonly from?: Date;
  readonly homeCity?: string;
  readonly offline?: boolean;
  readonly reset?: boolean;
  readonly echo?: boolean;
  readonly configPath?: string;
  readonly promptPath?: string;
}

export interface SimReport {
  readonly days: number;
  readonly speed: number;
  readonly seed: number;
  readonly stepMinutes: number;
  readonly from: string;
  readonly until: string;
  readonly ticks: number;
  readonly events: number;
  readonly eventsByType: Record<string, number>;
  readonly duplicateKeys: string[];
  readonly citiesVisited: number;
  readonly final: {
    readonly phase: string;
    readonly place: string;
    readonly dateKey: string;
    readonly clock: string;
    readonly visited: number;
    readonly diaryDays: number;
    readonly photos: number;
  };
  readonly upstreamVersion: string;
  readonly elapsedMs: number;
}

const RESET_FILES = ['state.json', 'photos.json', 'events.jsonl', 'events.meta.json', 'sim-report.json', 'ui.json'];

export async function runSimulation(opts: SimOptions): Promise<SimReport> {
  if (!Number.isFinite(opts.days) || opts.days <= 0) throw new Error('--days 必须是正数');
  const stepMinutes = Math.max(1, opts.stepMinutes ?? 10);
  const speed = Math.min(240, Math.max(0.1, opts.speed ?? 1));
  const seed = Math.trunc(opts.seed ?? 1);
  const from = opts.from ?? new Date();
  const offline = opts.offline ?? true;

  if (opts.reset) {
    for (const name of RESET_FILES) rmSync(join(opts.dataDir, name), { force: true });
  }

  const collected: EventRecord[] = [];
  let now = new Date(from.getTime());
  const originalRandom = Math.random;
  const originalFetch = globalThis.fetch;
  Math.random = seededRandom(seed);
  if (offline) {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
  }

  const bridge = new RawBridge({
    dataDir: opts.dataDir,
    ...(opts.configPath ? { configPath: opts.configPath } : {}),
    ...(opts.promptPath ? { promptPath: opts.promptPath } : {}),
    initialOverrides: { speed, ...(opts.homeCity ? { homeCity: opts.homeCity } : {}) },
    now: () => now,
    nowPlaying: () => null,
    echo: opts.echo ?? false,
    onEvent: (e) => collected.push(e),
  });

  const started = Date.now();
  try {
    await bridge.start();
    pauseTimers(bridge.rawWorld);

    const ticks = Math.max(1, Math.ceil((opts.days * 24 * 60) / stepMinutes));
    const realStepMs = (stepMinutes * 60_000) / speed;
    for (let i = 0; i < ticks; i++) {
      now = new Date(now.getTime() + realStepMs);
      await tick(bridge.rawWorld);
    }

    const snap = await bridge.snapshot();
    const eventsByType: Record<string, number> = {};
    const keyCount = new Map<string, number>();
    for (const e of collected) {
      eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1;
      keyCount.set(e.key, (keyCount.get(e.key) ?? 0) + 1);
    }
    const duplicateKeys = [...keyCount.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const report: SimReport = {
      days: opts.days,
      speed,
      seed,
      stepMinutes,
      from: from.toISOString(),
      until: now.toISOString(),
      ticks,
      events: collected.length,
      eventsByType,
      duplicateKeys,
      citiesVisited: snap.trip.visited,
      final: {
        phase: snap.mode,
        place: snap.place.name,
        dateKey: snap.dateKey,
        clock: snap.clock,
        visited: snap.trip.visited,
        diaryDays: snap.diary.days,
        photos: snap.photos.length,
      },
      upstreamVersion: bridge.upstreamVersion,
      elapsedMs: Date.now() - started,
    };
    try {
      writeFileSync(join(opts.dataDir, 'sim-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch {
      // 报告写不进去不影响结论。
    }
    await bridge.stop();
    return report;
  } finally {
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
    // 失败路径也尽量收掉 raw 的定时器。
    try {
      pauseTimers(bridge.rawWorld);
    } catch {
      // ignore
    }
  }
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
