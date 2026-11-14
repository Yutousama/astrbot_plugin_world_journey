/**
 * 私有 API 兼容层 —— **只给模拟器/测试用**。
 *
 * 生产 sidecar 完全靠 raw 自己的 `setInterval` 跑，不依赖这里。上游若改了私有
 * `tick` / 定时器字段，模拟会在这里明确失败；插件本身不受影响。
 */

/*
 * 上游 1.8.0 的定时器清单（`src/world.ts` 字段声明 + `stop()` 里清理的那几个）：
 * `timer` 巡检、`bootTimer` 启动 6 秒后首次巡检、`heartTimer` 位置心跳（20 分钟）、
 * `versionTimer` npm 版本对账（3 小时）、`reportRetryTimer` 上报失败退避重试。
 * `wishTimer`（想去扫描）在 1.6.19 随「动作愿望」功能一起删了；这里保留名字只是为了
 * 拿旧版 raw 跑模拟时也能停下来，多余的键 `pauseTimers` 会自然跳过。
 *
 * 注意：上游 `start()` 里还有一次 `versionCheck.startupRefresh()` 的 npm 请求，它**不在
 * 定时器清单里**、也没有配置开关；模拟不靠这里屏蔽，离线表现见 `adapter/sim.ts` 的
 * `--offline`（失败被上游 catch，只会让启动慢一点，不影响推进）。
 */
const TIMER_KEYS = ['timer', 'bootTimer', 'heartTimer', 'versionTimer', 'reportRetryTimer', 'wishTimer'] as const;

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
