/**
 * 从 npm registry 更新上游源码。
 *
 * 默认包：coopani-world-journey
 * 默认 registry：https://registry.npmjs.org
 * 展示页：https://www.npmjs.com/package/coopani-world-journey
 *
 * 只做「下载 → 校验 → 解压 → 准备 staging」；是否安装由调用方决定：
 *   --install   备份并替换 target（repo 开发用）
 *   不给        只输出 staging 路径（AstrBot 插件先停 sidecar，再自己换目录/回滚）
 *
 * 注意：成功路径不要 process.exit()。Windows 上 undici 的 keep-alive socket 还在关闭时
 * 强制退出会触发 libuv 的 UV_HANDLE_CLOSING 断言；让事件循环自然结束。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_PACKAGE = 'coopani-world-journey';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

interface Dist {
  readonly tarball?: string;
  readonly integrity?: string;
  readonly shasum?: string;
}

interface RegistryMeta {
  readonly version?: string;
  readonly dist?: Dist;
}

class UpdateError extends Error {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      version: { type: 'string', default: 'latest' },
      package: { type: 'string', default: DEFAULT_PACKAGE },
      registry: { type: 'string', default: DEFAULT_REGISTRY },
      install: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      rollback: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const json = values.json;
  const print = (value: unknown): void => {
    console.log(json ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  };

  const targetArg = values.target;
  if (!targetArg) throw new UpdateError('缺少 --target <raw 目录>');
  const target = resolve(targetArg);
  const parent = dirname(target);
  const base = basename(target);
  const pkg = values.package;
  const registry = values.registry.replace(/\/+$/, '');

  if (values.rollback) {
    const backup = resolve(values.rollback);
    if (!existsSync(backup)) throw new UpdateError(`回滚备份不存在：${backup}`);
    rmSync(target, { recursive: true, force: true });
    renameSync(backup, target);
    print({ ok: true, rolledBack: true, target, from: backup });
    return;
  }

  const version = String(values.version);
  const metaUrl = version === 'latest'
    ? `${registry}/${encodeURIComponent(pkg)}/latest`
    : `${registry}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`;

  const meta = await fetchJson<RegistryMeta>(metaUrl);
  const resolvedVersion = typeof meta.version === 'string' ? meta.version : version;
  const dist = meta.dist ?? {};
  if (!dist.tarball) throw new UpdateError(`npm 元数据里没有 tarball：${metaUrl}`);
  const oldVersion = readVersion(join(target, 'package.json'));
  if (!values.force && oldVersion && oldVersion === resolvedVersion) {
    print({ ok: true, upToDate: true, version: resolvedVersion, target, oldVersion });
    return;
  }

  const workRoot = join(parent, `.${base}.update-${resolvedVersion}`);
  const tarballPath = join(workRoot, `${pkg}-${resolvedVersion}.tgz`);
  const extractDir = join(workRoot, 'extract');
  const stageDir = join(workRoot, 'package');
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  const tarball = Buffer.from(await fetchBytes(dist.tarball));
  verifyIntegrity(tarball, dist);
  writeFileSync(tarballPath, tarball);

  const extracted = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], {
    encoding: 'utf8',
  });
  if (extracted.status !== 0) {
    throw new UpdateError(`解压失败（需要系统 tar）：${String(extracted.stderr || extracted.stdout || '').trim().slice(0, 300)}`);
  }
  const packageRoot = join(extractDir, 'package');
  if (!existsSync(packageRoot)) throw new UpdateError('npm 包里没有 package/ 目录');
  cpSync(packageRoot, stageDir, { recursive: true });
  validateStage(stageDir);

  let backup: string | null = null;
  let installed = false;
  if (values.install) {
    backup = join(parent, `.${base}.bak-${oldVersion || 'none'}`);
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(target)) renameSync(target, backup);
    renameSync(stageDir, target);
    installed = true;
    rmSync(workRoot, { recursive: true, force: true });
  } else {
    // staging 模式保留 stageDir；清掉 tarball/extract，避免占空间。
    rmSync(tarballPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }

  print({
    ok: true,
    version: resolvedVersion,
    oldVersion,
    target,
    stage: installed ? undefined : stageDir,
    backup,
    installed,
    tarball: dist.tarball,
    integrity: dist.integrity,
    source: `https://www.npmjs.com/package/${pkg}`,
  });
}

function validateStage(dir: string): void {
  for (const rel of ['src/world.ts', 'src/config.ts', 'ENV_PROMPT.md', 'package.json']) {
    if (!existsSync(join(dir, rel))) throw new UpdateError(`上游包缺少 ${rel}，拒绝安装`);
  }
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string };
  if (!p.version) throw new UpdateError('上游 package.json 没有 version，拒绝安装');
}

function verifyIntegrity(buf: Buffer, dist: Dist): void {
  const integrity = typeof dist.integrity === 'string' ? dist.integrity : '';
  if (integrity.startsWith('sha512-')) {
    const got = createHash('sha512').update(buf).digest('base64');
    if (got !== integrity.slice('sha512-'.length)) throw new UpdateError('npm 包 sha512 校验失败');
    return;
  }
  if (typeof dist.shasum === 'string' && dist.shasum) {
    const got = createHash('sha1').update(buf).digest('hex');
    if (got !== dist.shasum) throw new UpdateError('npm 包 sha1 校验失败');
    return;
  }
  throw new UpdateError('npm 元数据没有 integrity/shasum，拒绝安装');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new UpdateError(`npm registry HTTP ${res.status}：${url}`);
  return await res.json() as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new UpdateError(`下载 npm 包失败 HTTP ${res.status}：${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function readVersion(path: string): string | null {
  try {
    const p = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return typeof p.version === 'string' ? p.version : null;
  } catch {
    return null;
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  const wantJson = process.argv.includes('--json');
  if (wantJson) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`[update] ${message}`);
  process.exitCode = 1;
});
