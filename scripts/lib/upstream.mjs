/**
 * 上游只读工具：列出文件、逐文件 hash、全量 hash。
 * 只读 raw/，从不写入。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) out.push(path);
    }
  };
  walk(root);
  return out;
}

export function fileHashes(root) {
  const files = {};
  for (const path of listFiles(root)) {
    const key = relative(root, path).split(sep).join('/');
    files[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return files;
}

export function hashOfFiles(files) {
  const h = createHash('sha256');
  for (const key of Object.keys(files).sort()) {
    h.update(key);
    h.update('\0');
    h.update(files[key]);
    h.update('\0');
  }
  return h.digest('hex');
}

export function hashTree(root) {
  return hashOfFiles(fileHashes(root));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}
