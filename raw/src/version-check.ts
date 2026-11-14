/**
 * 「她是哪一版」和「现在最新是哪一版」。
 *
 * ## 为什么要有这个（2026-11-08 Mr.Q）
 *
 * 「能往 UI 加个版本号和最新版本号提示嘛？我看好多人版本都落后的。」
 *
 * 这个扩展靠用户自己去市场里更新，而**面板上原来一个版本号都没有** ——
 * 报障的时候第一句话永远是「我这是不是最新版」，两边都要猜。
 *
 * ## 三条硬规矩
 *
 * 1. **查最新版这件事不能拖慢任何东西。** 面板要的是「立刻能画出来」，
 *    所以 `state()` 只读缓存，网络那一半在 `refresh()` 里异步跑，超时 8 秒就放弃。
 * 2. **查不到就说不知道，不许猜。** 断网、被墙、npm 挂了，`latest` 就是空串，
 *    面板只显示自己的版本，不显示「已是最新」—— **「不知道」和「是最新」不是一回事**。
 * 3. **别天天打 npm。** 三小时一次；启动时另有一次（`startupRefresh`）。
 *    结果落在 `dataDir` 里，重启不重查 —— 但**启动那次会强查**，见那个方法的说明。
 *    这类「顺手查一下」的请求最容易变成每次启动一个连接，npm 那边会记账。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 面板要的那几个数。 */
export interface VersionState {
  /** 她自己的版本。 */
  readonly current: string;
  /** npm 上的最新版；不知道就是空串。 */
  readonly latest: string;
  /** 上一次查成功的时间（ISO）；从来没成功过就是空串。 */
  readonly checkedAt: string;
  /** 明确知道有新版才为 true —— 不知道的时候是 false。 */
  readonly outdated: boolean;
}

/** 三小时。同一天里反复开面板，不该反复打 npm。 */
const TTL_MS = 3 * 3_600_000;

/**
 * 启动时那次检查的冷却：十五分钟内查过就不重查。
 *
 * 只挡「连着重启三次」，不挡正常的开机。见 `startupRefresh`。
 */
const STARTUP_COOLDOWN_MS = 15 * 60_000;

/** 查一次最多等这么久。面板不该为用户的一次网络抖动卡住。 */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * 比版本号。只认 `x.y.z`，预发布后缀先剥掉。
 *
 * 不用 semver 包：这里只要「谁新」，而多一个依赖就多一条升级路径。
 * 返回 -1 / 0 / 1。
 */
export function compareVersion(a: string, b: string): number {
  const pick = (v: string): number[] => String(v || '0')
    .replace(/^v/i, '')
    .split('-')[0]!
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const x = pick(a);
  const y = pick(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export class VersionCheck {
  private readonly file: string;
  private readonly current: string;
  private readonly pkg: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly ttlMs: number;
  private latest = '';
  private checkedAt = '';
  /** 上一次真正去问的时间（内存），用来防连点。 */
  private lastAttempt = 0;
  private running: Promise<VersionState> | null = null;

  constructor(opts: {
    dataDir: string;
    /** 她自己的版本，由调用方从 package.json 读好传进来。 */
    current: string;
    /** npm 包名。 */
    pkg?: string;
    /** 测试时换成一个假的。 */
    fetchImpl?: typeof fetch;
    ttlMs?: number;
  }) {
    this.current = String(opts.current || 'unknown');
    this.pkg = opts.pkg ?? 'coopani-world-journey';
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.file = join(opts.dataDir, 'version-check.json');
    this.load();
  }

  /** 现在的状态。**不联网**，随时可调。 */
  state(): VersionState {
    return {
      current: this.current,
      latest: this.latest,
      checkedAt: this.checkedAt,
      /* 只有「确实知道有新版」才算过时；查不到时一律 false。 */
      outdated: !!this.latest && compareVersion(this.latest, this.current) > 0,
    };
  }

  /**
   * **启动时那一次。它和定时那次不是一回事。**
   *
   * 定时是「顺手再问一遍」；启动是「确认现在这一版到底是不是最新」。
   * 而「已是最新」这个判断**会过期** —— 用户下午查的时候 latest 就等于他的版本，
   * 晚上新版本发了，六小时 TTL 会让他一直看到旧结论。
   *
   * 2026-11-08 Mr.Q 就撞上了这个：他 1.0.2，市场已经 1.0.3，面板一声不响。
   * 他的原话是「现在是 1.0.2 市场升到 1.0.3 了也没提醒啊」。
   *
   * 所以启动时只要距上次检查超过十五分钟就**强制查一次**。
   * 十五分钟只挡「连着重启三次」—— 那样打三次 npm 没意义。
   */
  startupRefresh(): Promise<VersionState> {
    const age = Date.now() - this.lastAttempt;
    return this.refresh(age > STARTUP_COOLDOWN_MS);
  }

  /**
   * 去问一次 npm。**永远不抛。**
   *
   * `force` 为 false 时按 TTL 跳过；正在跑的时候复用同一个 promise，
   * 免得面板连开几次连开几个请求。
   */
  async refresh(force = false): Promise<VersionState> {
    const fresh = Date.now() - this.lastAttempt < this.ttlMs;
    if (!force && this.checkedAt && fresh) return this.state();
    if (this.running) return this.running;
    this.running = this.doFetch().finally(() => { this.running = null; });
    return this.running;
  }

  private async doFetch(): Promise<VersionState> {
    this.lastAttempt = Date.now();
    if (!this.fetchImpl || this.current === 'unknown') return this.state();
    /*
     * `dist-tags` 只有几十个字节，比 `/<pkg>/latest` 那整份 manifest 轻得多 ——
     * 这个请求是「顺手查一下」，不该拉几十 KB 回来。
     */
    const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(this.pkg)}/dist-tags`;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const res = await this.fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) return this.state();
      const body = (await res.json()) as { latest?: unknown };
      const latest = typeof body.latest === 'string' ? body.latest.trim() : '';
      if (!latest) return this.state();
      this.latest = latest;
      this.checkedAt = new Date().toISOString();
      this.save();
    } catch {
      /* 断网、超时、被墙、npm 挂了 —— 都当「这次没查到」，保留上次的结果。 */
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.state();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { latest?: unknown; checkedAt?: unknown };
      this.latest = typeof raw.latest === 'string' ? raw.latest : '';
      this.checkedAt = typeof raw.checkedAt === 'string' ? raw.checkedAt : '';
      /* 缓存里的时间也要参与 TTL 判断，否则每次重启都会重查一遍。 */
      const at = Date.parse(this.checkedAt);
      this.lastAttempt = Number.isFinite(at) ? at : 0;
    } catch {
      /* 没有缓存是正常的（第一次跑）。 */
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, `${JSON.stringify({ latest: this.latest, checkedAt: this.checkedAt }, null, 2)}\n`, 'utf8');
    } catch {
      /* 写不进去不影响这次显示，下次再查一遍就是。 */
    }
  }
}
