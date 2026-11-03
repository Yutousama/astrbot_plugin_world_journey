/**
 * 回环 HTTP sidecar —— AstrBot 插件的唯一进程边界。
 *
 * 只绑 127.0.0.1，所有请求要求 `Authorization: Bearer <token>`；token 由 Python
 * 插件生成并通过环境变量传入，不落盘、不进日志。心跳超时自动退出，避免 AstrBot
 * 崩溃后留下孤儿 Node 进程。
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RawBridge } from './bridge.ts';

export interface ServerOptions {
  readonly bridge: RawBridge;
  readonly token: string;
  readonly requireHeartbeat?: boolean;
  readonly announce?: boolean;
  readonly onStale?: () => void;
  /** 心跳看门狗注入的 touch；有它才真正续命。 */
  readonly touchHeartbeat?: () => void;
}

export interface ServerHandle {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

const BODY_LIMIT = 64 * 1024;
const HEARTBEAT_TIMEOUT_MS = 90_000;

export function createServer(opts: ServerOptions): Server {
  return createHttpServer((req, res) => {
    void handle(req, res, opts).catch((e: unknown) => {
      json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    });
  });
}

export async function startServer(
  opts: ServerOptions & { readonly port?: number; readonly host?: string },
): Promise<ServerHandle> {
  const server = createServer(opts);
  const port = opts.port ?? 0;
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error): void => {
      server.off('error', onError);
      reject(e);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const actual = (server.address() as AddressInfo).port;
  if (opts.announce ?? true) {
    console.log(JSON.stringify({ event: 'listening', port: actual }));
  }
  return {
    server,
    port: actual,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
    }),
  };
}

/** 心跳看门狗：放在 server 外面，测试可以关掉。 */
export function startHeartbeatWatchdog(
  opts: ServerOptions,
  onStale: () => void = () => process.exit(0),
): { touch(): void; stop(): void } {
  let last = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - last > HEARTBEAT_TIMEOUT_MS) {
      opts.bridge.log.warn('Python 插件心跳超时，sidecar 退出，避免留下孤儿进程。');
      clearInterval(timer);
      onStale();
    }
  }, 15_000);
  return {
    touch: () => { last = Date.now(); },
    stop: () => clearInterval(timer),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: ServerOptions): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  if (!authorized(req, opts.token)) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  // 每次请求顺便检查配置 mtime；热重载不额外开定时器。
  opts.bridge.reloadConfig();

  if (method === 'GET' && path === '/api/health') {
    json(res, 200, { ...opts.bridge.health(), uptimeSec: Math.round(process.uptime()) });
    return;
  }

  if (method === 'GET' && path === '/api/status') {
    const snapshot = await opts.bridge.snapshot();
    json(res, 200, {
      ...snapshot,
      now: opts.bridge.now(),
      promptWarnings: opts.bridge.prompt().warnings,
      upstreamVersion: opts.bridge.upstreamVersion,
      bridgeVersion: opts.bridge.bridgeVersion,
      eventLogId: opts.bridge.eventLogId,
      lastSeq: opts.bridge.lastSeq,
    });
    return;
  }

  if (method === 'GET' && path === '/api/now') {
    text(res, 200, opts.bridge.now());
    return;
  }

  if (method === 'GET' && path === '/api/events') {
    const after = Number(url.searchParams.get('after') ?? 0);
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 200)));
    const cursor = Number.isFinite(after) ? after : 0;
    json(res, 200, {
      events: opts.bridge.events.after(cursor, limit),
      lastSeq: opts.bridge.lastSeq,
      eventLogId: opts.bridge.eventLogId,
    });
    return;
  }

  if (method === 'GET' && path === '/api/tools') {
    json(res, 200, {
      tools: opts.bridge.tools().map(({ handler: _handler, ...rest }) => rest),
    });
    return;
  }

  if (method === 'GET' && path === '/api/prompt') {
    const prompt = opts.bridge.prompt();
    if (prompt.missing.length) {
      text(res, 500, `提示词缺少变量：${prompt.missing.join('、')}`);
      return;
    }
    text(res, 200, prompt.text, 'text/markdown; charset=utf-8');
    return;
  }

  if (method === 'POST' && path.startsWith('/api/tools/')) {
    const name = decodeURIComponent(path.slice('/api/tools/'.length));
    if (!name) {
      json(res, 400, { ok: false, error: '缺少工具名' });
      return;
    }
    const body = await readJsonBody(req);
    const result = await opts.bridge.callTool(name, body);
    json(res, result.isError ? 400 : 200, result);
    return;
  }

  if (method === 'POST' && path === '/api/depart') {
    const result = await opts.bridge.depart();
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  if (method === 'POST' && path === '/api/sync') {
    const result = await opts.bridge.sync();
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  if (method === 'POST' && path === '/api/photo') {
    const result = await opts.bridge.photo();
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  /*
   * 主动汇报配图：和 `/api/photo` 不同，它不走上游的 photo 事件，只借自拍配置生成
   * 一张图交给 Python 随汇报发出去。失败时返回 `image: null` —— 调用方只发文字，
   * 不因为配图失败而丢整条汇报。
   */
  if (method === 'POST' && path === '/api/report-image') {
    const raw = await readJsonBody(req);
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const scene = typeof body.text === 'string' ? body.text : '';
    const bytes = await opts.bridge.reportImage(scene);
    json(res, 200, {
      ok: Boolean(bytes),
      image: bytes ? Buffer.from(bytes).toString('base64') : null,
    });
    return;
  }

  if (method === 'POST' && path === '/api/heartbeat') {
    opts.touchHeartbeat?.();
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path.startsWith('/media/')) {
    const name = decodeURIComponent(path.slice('/media/'.length));
    const bytes = opts.bridge.media.read(name);
    if (!bytes) {
      json(res, 404, { ok: false, error: '没有这张图' });
      return;
    }
    res.writeHead(200, {
      'content-type': opts.bridge.media.mimeOf(name),
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(bytes);
    return;
  }

  json(res, 404, { ok: false, error: `没有这个接口：${method} ${path}` });
}

function authorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${token}`;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function text(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT) throw new Error('请求体太大');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}
