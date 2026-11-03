/**
 * adapter CLI。
 *
 * 生产入口只有 `serve`（Python 插件 spawn）；`status/prompt/sim` 是开发/回归用。
 * 不提供 HTML 面板：AstrBot 是界面。
 */
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { RawBridge } from './bridge.ts';
import { readUpstreamInfo } from './contract.ts';
import { runSimulation } from './sim.ts';
import { startHeartbeatWatchdog, startServer } from './server.ts';

const VERSION = '1.0.0';

const OPTIONS = {
  data: { type: 'string' as const },
  config: { type: 'string' as const },
  prompt: { type: 'string' as const },
  port: { type: 'string' as const },
  token: { type: 'string' as const },
  offline: { type: 'boolean' as const },
  verbose: { type: 'boolean' as const },
  'require-heartbeat': { type: 'boolean' as const },
  days: { type: 'string' as const },
  speed: { type: 'string' as const },
  seed: { type: 'string' as const },
  step: { type: 'string' as const },
  from: { type: 'string' as const },
  home: { type: 'string' as const },
  reset: { type: 'boolean' as const },
  out: { type: 'string' as const },
  help: { type: 'boolean' as const },
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS, strict: true });
  const cmd = positionals[0] ?? 'help';
  if (cmd === 'help' || values.help) {
    printHelp();
    return;
  }
  const dataDir = resolve(values.data ?? (cmd === 'sim' ? './data/sim' : './data'));
  const common = {
    dataDir,
    ...(values.config ? { configPath: resolve(values.config) } : {}),
    ...(values.prompt ? { promptPath: resolve(values.prompt) } : {}),
  };

  switch (cmd) {
    case 'serve':
      await cmdServe(common, values);
      return;
    case 'status':
      await cmdStatus(common, values);
      return;
    case 'prompt':
      await cmdPrompt(common, values);
      return;
    case 'sim':
      await cmdSim(dataDir, values);
      return;
    case 'check':
      cmdCheck();
      return;
    default:
      console.error(`不认识这个命令：${cmd}`);
      printHelp();
      process.exitCode = 2;
  }
}

async function cmdServe(
  common: { dataDir: string; configPath?: string; promptPath?: string },
  values: Record<string, unknown>,
): Promise<void> {
  const token = typeof values.token === 'string' && values.token
    ? values.token
    : process.env.JOURNEY_SIDECAR_TOKEN?.trim();
  if (!token) throw new Error('serve 需要 --token 或 JOURNEY_SIDECAR_TOKEN');
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({
    ...common,
    echo: false,
    verbose: values.verbose === true,
  });
  await bridge.start();

  let watchdog: { touch(): void; stop(): void } | null = null;
  if (values['require-heartbeat'] === true) {
    watchdog = startHeartbeatWatchdog({ bridge, token, requireHeartbeat: true });
  }
  const port = values.port !== undefined ? numberOrThrow(values.port, '--port') : 0;
  const server = await startServer({
    bridge,
    token,
    requireHeartbeat: values['require-heartbeat'] === true,
    port,
    announce: true,
    ...(watchdog ? { touchHeartbeat: watchdog.touch } : {}),
  });
  bridge.log.info(`sidecar 已启动，管道 ${server.port}，上游 ${bridge.upstreamVersion}。`);

  await waitForSignal();
  watchdog?.stop();
  await server.close();
  await bridge.stop();
  restoreNetwork?.();
}

async function cmdStatus(
  common: { dataDir: string; configPath?: string; promptPath?: string },
  values: Record<string, unknown>,
): Promise<void> {
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({ ...common, echo: false, verbose: values.verbose === true });
  try {
    await bridge.start();
    const snapshot = await bridge.snapshot();
    console.log(bridge.now());
    console.log('');
    console.log(JSON.stringify({
      ...snapshot,
      upstreamVersion: bridge.upstreamVersion,
      bridgeVersion: VERSION,
    }, null, 2));
  } finally {
    await bridge.stop();
    restoreNetwork?.();
  }
}

async function cmdPrompt(
  common: { dataDir: string; configPath?: string; promptPath?: string },
  values: Record<string, unknown>,
): Promise<void> {
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({ ...common, echo: false, verbose: values.verbose === true });
  try {
    await bridge.start();
    const prompt = bridge.prompt();
    if (prompt.missing.length) {
      console.error(`[prompt] 模板里有未赋值的变量：${prompt.missing.join('、')}`);
      process.exitCode = 1;
    }
    const out = resolve(typeof values.out === 'string' ? values.out : join(common.dataDir, 'prompt.md'));
    writeFileSync(out, prompt.text, 'utf8');
    console.log(`[prompt] 已写入 ${out}`);
    console.log(`[prompt] 模板 ${prompt.path}`);
    for (const w of prompt.warnings) console.error(`[prompt] 警告：${w}`);
  } finally {
    await bridge.stop();
    restoreNetwork?.();
  }
}

async function cmdSim(dataDir: string, values: Record<string, unknown>): Promise<void> {
  const days = values.days !== undefined ? numberOrThrow(values.days, '--days') : 7;
  const speed = values.speed !== undefined ? numberOrThrow(values.speed, '--speed') : 24;
  const seed = values.seed !== undefined ? numberOrThrow(values.seed, '--seed') : 1;
  const stepMinutes = values.step !== undefined ? numberOrThrow(values.step, '--step') : 10;
  const from = values.from !== undefined ? dateOrThrow(values.from, '--from') : undefined;
  const report = await runSimulation({
    dataDir,
    days,
    speed,
    seed,
    stepMinutes,
    ...(from ? { from } : {}),
    ...(values.home !== undefined ? { homeCity: String(values.home) } : {}),
    offline: values.offline !== false,
    reset: values.reset === true,
    echo: false,
    ...(values.config ? { configPath: resolve(String(values.config)) } : {}),
    ...(values.prompt ? { promptPath: resolve(String(values.prompt)) } : {}),
  });
  console.log('');
  console.log(`[sim] ${report.days} 天 @${report.speed}x，seed=${report.seed}，${report.ticks} 次 tick，${report.elapsedMs}ms`);
  console.log(`[sim] 事件 ${report.events} 条：${formatCounts(report.eventsByType)}`);
  console.log(`[sim] 上游 ${report.upstreamVersion}；到过 ${report.citiesVisited} 个地方；最后在 ${report.final.place}（${report.final.phase}）`);
  if (report.duplicateKeys.length) {
    console.log(`[sim] ⚠ 重复事件 key：${report.duplicateKeys.slice(0, 8).join('、')}`);
  }
  console.log(`[sim] 报告：${join(dataDir, 'sim-report.json')}`);
}

function cmdCheck(): void {
  const info = readUpstreamInfo();
  console.log(`[check] 上游版本：${info.version}`);
  console.log(`[check] 构建时间：${info.builtAt ?? '开发态'}`);
  console.log('[check] 详细契约检查请跑 npm test（test/upstream.test.ts）。');
}

function printHelp(): void {
  console.log([
    '大肥鱼环游世界 · AstrBot 套壳',
    '',
    '用法：tsx adapter/cli.ts <命令> [选项]',
    '',
    '命令：',
    '  serve   启动回环 HTTP sidecar（Python 插件用）',
    '  status  打印她此刻与快照 JSON',
    '  prompt  渲染 ENV_PROMPT.md 到文件',
    '  sim     虚拟时钟模拟（默认 7 天、24x、seed 1）',
    '  check   打印上游版本',
    '',
    '通用：--data <dir> --config <file> --prompt <file> --offline --verbose',
    'serve：--port 0 --token <token> --require-heartbeat',
    'sim：--days --speed --seed --step --from --home --reset',
    'prompt：--out <file>',
  ].join('\n'));
}

function numberOrThrow(raw: unknown, name: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} 不是数字：${String(raw)}`);
  return n;
}

function dateOrThrow(raw: unknown, name: string): Date {
  const d = new Date(String(raw));
  if (!Number.isFinite(d.getTime())) throw new Error(`${name} 不是合法时间：${String(raw)}`);
  return d;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k.replace('journey.', '')} ${v}`).join('，') : '（没有）';
}

function disableNetwork(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function waitForSignal(): Promise<void> {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolvePromise();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

void main().catch((e) => {
  console.error(`[fatal] ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
