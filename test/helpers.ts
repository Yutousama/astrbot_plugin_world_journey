import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawBridge } from '../adapter/bridge.ts';

export function tempDir(prefix = 'journey-astrbot-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 2026-05-01 08:00 兰州（Asia/Shanghai），在 raw 的自动出门窗口内。 */
export const T0 = new Date('2026-05-01T00:00:00.000Z');

export function makeBridge(dataDir: string): RawBridge {
  return new RawBridge({
    dataDir,
    now: () => new Date(T0.getTime()),
    nowPlaying: () => null,
    echo: false,
  });
}
