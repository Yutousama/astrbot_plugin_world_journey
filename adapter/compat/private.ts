/**
 * 私有 API 兼容层 —— **只给模拟器/测试用**。
 *
 * 生产 sidecar 完全靠 raw 自己的 `setInterval` 跑，不依赖这里。上游若改了私有
 * `tick` / 定时器字段，模拟会在这里明确失败；插件本身不受影响。
 */

const TIMER_KEYS = ['timer', 'bootTimer', 'wishTimer'] as const;

/** 停掉 raw 自己注册的定时器，让模拟器手动推进。 */
export function pauseTimers(world: unknown): void {
  const w = world as Record<string, unknown>;
  for (const key of TIMER_KEYS) {
    const handle = w[key];
    if (!handle) continue;
    // Node 的 Timeout 同时能被 clearInterval/clearTimeout 接受；两个都调一遍最稳。
    clearInterval(handle as ReturnType<typeof setInterval>);
    clearTimeout(handle as ReturnType<typeof setTimeout>);
    w[key] = null;
  }
}

/** 手动推进一次巡检。 */
export async function tick(world: unknown): Promise<void> {
  const w = world as Record<string, unknown>;
  if (typeof w.tick !== 'function') {
    throw new Error(
      '上游 JourneyWorld 的私有 tick 不见了。生产 sidecar 不依赖它；'
      + '请更新 adapter/compat/private.ts 后重跑模拟。',
    );
  }
  await (w.tick as () => Promise<void>).call(world);
}
