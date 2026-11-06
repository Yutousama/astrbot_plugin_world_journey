/**
 * 裁掉图片底部一条 —— 用来去掉服务商盖的「AI生成」水印。
 *
 * ## 为什么自己写，不引依赖
 *
 * 这个扩展是**零依赖**的（`package.json` 的 `dependencies` 是空的），宿主直接加载 TS，
 * 不跑 `npm install`。引 `sharp` 就得编译原生模块，引 `pngjs` 就得打包
 * `node_modules` —— 为了裁掉六十行像素，不值得把整个发布流程搞复杂。
 *
 * ## 为什么是裁，不是"擦"
 *
 * 水印是服务商**出图之后盖上去的**，`watermark: false` 这种请求参数对它无效
 * （2026-11-04 实测：Kolors 免费模型强制带水印，参数被忽略）。
 * 既然它是最后画上去的一层，只能从像素上处理。
 * 擦除需要知道底下是什么（inpainting，要模型）；裁掉则不需要任何推测。
 *
 * ## 只认最常见的那种 PNG
 *
 * 8 位、非隔行、灰度/RGB/RGBA。服务商返回的基本都是这几种（实测硅基流动全是 RGBA）。
 * 遇到不认识的（16 位、调色板、Adam7 隔行、根本不是 PNG）**原样返回，不抛错** ——
 * 裁不掉水印是小事，让照片拍不出来是大事。
 */
import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function readChunks(png: Uint8Array): Chunk[] | null {
  for (let i = 0; i < 8; i += 1) if (png[i] !== PNG_SIG[i]) return null;
  const out: Chunk[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    if (p + 12 + len > png.length) return null;
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    out.push({ type, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(12 + data.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) buf[4 + i] = type.charCodeAt(i);
  buf.set(data, 8);
  view.setUint32(8 + data.length, crc32(buf.subarray(4, 8 + data.length)));
  return buf;
}

/** 颜色类型 → 每像素通道数（只处理 8 位深度下的几种）。 */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * 反滤波。PNG 每一行前面都有一个 filter 字节，行内数据是**差分**过的；
 * 想拿到指定的一行，必须从第一行顺着解下来 —— 这也是为什么"只取最后 900 行"
 * 并不能省掉解码整个图。
 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array | null {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      const v = raw[src + x];
      let pred: number;
      switch (ft) {
        case 0: pred = 0; break;
        case 1: pred = a; break;
        case 2: pred = b; break;
        case 3: pred = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return null;
      }
      out[dst + x] = (v + pred) & 0xff;
    }
  }
  return out;
}

/**
 * 裁掉底部 `ratio`（0–1）的一条。失败原样返回。
 *
 * 只保留 IHDR / 其它非像素 chunk / IDAT / IEND。保留 `sRGB`、`iCCP` 这些是必要的 ——
 * 丢掉色彩配置会让颜色整体偏掉，而用户只会觉得"这次生成的图颜色不对"。
 */
export function cropBottom(png: Uint8Array, ratio: number): Uint8Array {
  try {
    if (!(ratio > 0 && ratio < 0.5)) return png;
    const chunks = readChunks(png);
    if (!chunks) return png;

    const ihdr = chunks.find((c) => c.type === 'IHDR');
    if (!ihdr || ihdr.data.length < 13) return png;
    const iv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
    const width = iv.getUint32(0);
    const height = iv.getUint32(4);
    const bitDepth = ihdr.data[8];
    const colorType = ihdr.data[9];
    const interlace = ihdr.data[12];

    // 这几种之外一律不碰：错解一张图的代价比水印大得多。
    if (bitDepth !== 8 || interlace !== 0) return png;
    const ch = CHANNELS[colorType];
    if (!ch) return png;

    const idat = chunks.filter((c) => c.type === 'IDAT');
    if (!idat.length) return png;
    const total = idat.reduce((s, c) => s + c.data.length, 0);
    const packed = new Uint8Array(total);
    let off = 0;
    for (const c of idat) { packed.set(c.data, off); off += c.data.length; }

    const raw = new Uint8Array(inflateSync(Buffer.from(packed)));
    const pixels = unfilter(raw, width, height, ch);
    if (!pixels) return png;

    const keep = Math.max(1, Math.floor(height * (1 - ratio)));
    if (keep >= height) return png;

    /*
     * 重新编码用 Sub 滤波（filter 1）：每行减去左边一个像素。
     *
     * 一开始用的是 filter 0（不过滤），实现最简单 —— 代价是文件从 1.83MB
     * 涨到 2.32MB（+27%）。照片是横向延展的连续画面，相邻像素高度相关，
     * Sub 正好把这种相关性压掉。换来的是二十来行差分计算，划算。
     */
    const stride = width * ch;
    const body = new Uint8Array(keep * (stride + 1));
    for (let y = 0; y < keep; y += 1) {
      const row = y * (stride + 1);
      const src = y * stride;
      body[row] = 1;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= ch ? pixels[src + x - ch] : 0;
        body[row + 1 + x] = (pixels[src + x] - left) & 0xff;
      }
    }

    const newIhdr = new Uint8Array(13);
    const nv = new DataView(newIhdr.buffer);
    nv.setUint32(0, width);
    nv.setUint32(4, keep);
    newIhdr.set(ihdr.data.subarray(8, 13), 8);

    const parts: Uint8Array[] = [
      Uint8Array.from(PNG_SIG),
      makeChunk('IHDR', newIhdr),
    ];
    // 先放非像素、非头尾的 chunk（sRGB / gAMA / iCCP / pHYs…），位置不影响解码。
    for (const c of chunks) {
      if (c.type === 'IHDR' || c.type === 'IDAT' || c.type === 'IEND') continue;
      parts.push(makeChunk(c.type, c.data));
    }
    parts.push(makeChunk('IDAT', new Uint8Array(deflateSync(Buffer.from(body), { level: 9 }))));
    parts.push(makeChunk('IEND', new Uint8Array(0)));

    const size = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(size);
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  } catch {
    // 解压失败、结构怪异、内存不够 —— 一律当"这图我处理不了"，用原图。
    return png;
  }
}

/**
 * 水印占底边多少。
 *
 * 0.08 是量出来的，不是拍的：1024 见方的图里，「AI生成」四个字实际占
 * y = 956–988（亮度从 ~80 跳到 ~150 的那一段），从底部算 70px、占 6.8%。
 * 第一版取 0.06 差了一口气，图上留着水印的上沿 —— 所以留到 0.08。
 *
 * 为什么不用"检测有没有水印"：检测要 OCR，OCR 要模型或几百行模板匹配；
 * 而**本地 ComfyUI 出的图根本不可能有水印** —— 这个事实比任何检测都可靠。
 * 交给上层按协议判断就行（见 `world.ts` 的 `shouldCropWatermark`）。
 */
export const WATERMARK_CROP_RATIO = 0.08;
