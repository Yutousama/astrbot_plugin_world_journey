/**
 * 本地媒体库 —— 上游照片字节的落盘处。
 *
 * 上游 `world.ts` 只认宿主 `pushEvent` 返回的 blob 句柄；这里把字节按内容哈希写进
 * `<dataDir>/media/`，句柄就是文件名。内容寻址顺带去重，和旧版媒体库行为一致。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export interface PhotoInput {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
}

export interface PhotoRef {
  readonly handle: string;
  readonly file: string;
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export class LocalMediaStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'media');
  }

  /** 保存一张图；同内容只存一份。返回媒体文件名。 */
  save(input: PhotoInput): PhotoRef {
    mkdirSync(this.dir, { recursive: true });
    const hash = createHash('sha1').update(input.bytes).digest('hex').slice(0, 16);
    const ext = MIME_EXT[input.mime.toLowerCase()] ?? safeExt(input.name) ?? '.png';
    const file = `${hash}${ext}`;
    const path = join(this.dir, file);
    if (!existsSync(path)) writeFileSync(path, input.bytes);
    return { handle: file, file };
  }

  /** 外部文件名 → 安全路径；只接受 basename，拒绝目录穿越。 */
  pathOf(file: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(file);
    } catch {
      return null;
    }
    const name = basename(decoded);
    if (!name || name !== decoded || !SAFE_NAME.test(name) || name.startsWith('.')) return null;
    const path = join(this.dir, name);
    return existsSync(path) ? path : null;
  }

  read(file: string): Uint8Array | null {
    const path = this.pathOf(file);
    if (!path) return null;
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  mimeOf(file: string): string {
    return EXT_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  }
}

function safeExt(name: string): string | null {
  const ext = extname(name).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : null;
}
