/**
 * 自拍生图套壳。
 *
 * 上游 `photo.ts` 明确只拍空镜：提示词里写「画面里没有人物」，请求走
 * `/images/generations` 的纯文生图。这里在 AstrBot 侧套一层 fetch 代理：
 *
 *   上游请求 /images/generations
 *      → 换掉提示词（自拍 + 参考图身份约束）
 *      → 用参考图走 /images/edits（或配置成带 image_url 的 generations）
 *      → 把结果包成上游认识的 {data:[{b64_json|url}]}
 *
 * 不改 raw；关闭 selfie_enabled 时完全不介入。
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export interface SelfieOptions {
  readonly enabled: boolean;
  readonly references: readonly string[];
  readonly api: string;
  readonly key: string;
  readonly model: string;
  readonly mode: 'edit' | 'generation' | 'native';
  readonly nativeUrl?: string;
  readonly size: string;
  readonly imageField: string;
  readonly subject: string;
  readonly promptTemplate: string;
}

export interface SelfieLogger {
  info(message: string): void;
  warn(message: string): void;
}

const DEFAULT_PROMPT = [
  '一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。',
  '背景：{scene}',
  '参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服。',
  '真实手机自拍质感，自然光，轻微手持感；画面里只有{subject}一个人，没有文字、水印、边框。',
].join('\n');

const NO_PEOPLE = /画面里没有人物[^。]*。/g;
const PASSERBY = /视角像路过的人[^。]*。/g;
const FILM = /胶片质感[^。]*。/g;

export function buildSelfiePrompt(original: string, opts: Pick<SelfieOptions, 'subject' | 'promptTemplate'>): string {
  const scene = original
    .replace(/^一张真实旅行照片：/, '')
    .replace(NO_PEOPLE, '')
    .replace(PASSERBY, '')
    .replace(FILM, '')
    .replace(/\s+/g, ' ')
    .trim();
  const subject = opts.subject.trim() || '她本人';
  const template = opts.promptTemplate.trim() || DEFAULT_PROMPT;
  return template
    .replaceAll('{scene}', scene)
    .replaceAll('{subject}', subject)
    .trim();
}

export function installSelfieProxy(
  opts: SelfieOptions,
  log: SelfieLogger,
  fetchImpl: typeof fetch = globalThis.fetch,
): () => void {
  if (!opts.enabled) return () => {};
  if (opts.references.length === 0) {
    log.warn('自拍已开启，但没有参考图；照片会失败而不是退回空镜。请在插件配置里上传 selfie_reference。');
  }
  const original = fetchImpl;
  const wrapper = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    if (!isGenerationRequest(url, init)) return original(input, init);
    const body = parseJsonBody(init?.body);
    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    if (!prompt) return original(input, init);
    try {
      const result = await generateSelfie(opts, body ?? {}, prompt, original, log);
      return jsonResponse({ data: [result] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn(`自拍生图失败：${message}`);
      return jsonResponse({ error: { message } }, 502);
    }
  };
  globalThis.fetch = wrapper as typeof fetch;
  return () => {
    if (globalThis.fetch === wrapper) globalThis.fetch = original;
  };
}

/** 给主动汇报生成一张自拍，返回字节；不经过上游 photo 事件。 */
export async function generateSelfieBytes(
  prompt: string,
  opts: SelfieOptions,
  fetchImpl: typeof fetch = globalThis.fetch,
  log: SelfieLogger = { info: () => {}, warn: () => {} },
): Promise<{ bytes: Uint8Array; mime: string }> {
  const result = await generateSelfie(opts, {}, prompt, fetchImpl, log);
  if (result.b64_json) {
    const bytes = new Uint8Array(Buffer.from(result.b64_json, 'base64'));
    const mime = sniffImage(bytes);
    if (!mime) throw new Error('自拍 b64 解出来不是图片');
    return { bytes, mime };
  }
  if (result.url) {
    const res = await fetchImpl(result.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`下载自拍图 HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = sniffImage(bytes) ?? res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png';
    return { bytes, mime };
  }
  throw new Error('自拍接口没有返回图片');
}

async function generateSelfie(
  opts: SelfieOptions,
  upstreamBody: Record<string, unknown>,
  originalPrompt: string,
  fetchImpl: typeof fetch,
  log: SelfieLogger,
): Promise<{ b64_json?: string; url?: string }> {
  const api = opts.api.trim().replace(/\/+$/, '');
  if (!api) throw new Error('自拍生图接口没填（selfie_api / image_api）');
  const references = opts.references.filter(Boolean);
  if (!references.length) throw new Error('没有参考图：请在插件配置里上传 selfie_reference');
  const first = await loadReference(references[0]!, fetchImpl);
  const prompt = buildSelfiePrompt(originalPrompt, opts);
  const size = opts.size.trim() || stringOf(upstreamBody.size) || '1024x1024';
  const model = opts.model.trim() || stringOf(upstreamBody.model) || 'gpt-image-1';
  const headers: Record<string, string> = {};
  if (opts.key.trim()) headers.authorization = `Bearer ${opts.key.trim()}`;

  if (opts.mode === 'native') {
    return await generateNative(opts, api, model, size, prompt, first, headers, fetchImpl, log);
  }

  if (opts.mode === 'generation') {
    const dataUrl = `data:${first.mime};base64,${Buffer.from(first.bytes).toString('base64')}`;
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
      [opts.imageField.trim() || 'image_url']: opts.imageField.trim() === 'image'
        ? Buffer.from(first.bytes).toString('base64')
        : dataUrl,
    };
    const res = await postJson(`${api}/images/generations`, headers, payload, fetchImpl);
    log.info(`自拍接口响应：HTTP ${res.status}（generation），content-length=${res.headers.get('content-length') ?? '?'}`);
    const image = parseImagePayload(await readJson(res, log));
    logSelfieImage(image, log);
    return image;
  }

  const form = new FormData();
  form.set('model', model);
  form.set('prompt', prompt);
  form.set('n', '1');
  form.set('size', size);
  form.set('response_format', 'b64_json');
  form.set('image', new Blob([first.bytes], { type: first.mime }), first.name);
  let res = await fetchImpl(`${api}/images/edits`, { method: 'POST', headers, body: form });
  if (res.status === 400 || res.status === 415) {
    const peek = (await res.clone().text()).slice(0, 500);
    // 有些中转站不收 multipart，只认 JSON 的 data URL；再试一次。
    if (/multipart|content-type|image|图片/i.test(peek)) {
      const dataUrl = `data:${first.mime};base64,${Buffer.from(first.bytes).toString('base64')}`;
      res = await postJson(`${api}/images/edits`, headers, {
        model,
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
        image: dataUrl,
      }, fetchImpl);
    }
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`自拍接口 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }
  log.info(`自拍接口响应：HTTP ${res.status}（edit），content-length=${res.headers.get('content-length') ?? '?'}`);
  const image = parseImagePayload(await readJson(res, log));
  logSelfieImage(image, log);
  return image;
}

async function generateNative(
  opts: SelfieOptions,
  api: string,
  model: string,
  size: string,
  prompt: string,
  reference: { bytes: Uint8Array; mime: string; name: string },
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  log: SelfieLogger,
): Promise<{ b64_json?: string; url?: string }> {
  // 阿里百炼原生万相端点。selfie_api 可以是 compatible-mode 地址，取 origin 后拼原生路径。
  const nativeUrl = (opts.nativeUrl ?? '').trim()
    || `${new URL(api).origin}/api/v1/services/aigc/multimodal-generation/generation`;
  const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString('base64')}`;
  const payload = {
    model,
    input: {
      messages: [{
        role: 'user',
        content: [{ image: dataUrl }, { text: prompt }],
      }],
    },
    parameters: {
      size: nativeSize(size),
      n: 1,
      watermark: false,
      thinking_mode: false,
    },
  };
  const res = await postJson(nativeUrl, headers, payload, fetchImpl);
  log.info(`自拍接口响应：HTTP ${res.status}（native），content-length=${res.headers.get('content-length') ?? '?'}`);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`自拍接口 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }
  const parsed = await readJson(res, log);
  const image = extractNativeImage(parsed);
  logSelfieImage(image, log);
  return image;
}

function nativeSize(size: string): string {
  const value = size.trim();
  if (!value) return '1K';
  if (value === '1024x1024') return '1K';
  if (value === '2048x2048') return '2K';
  return value;
}

function extractNativeImage(payload: unknown): { b64_json?: string; url?: string } {
  const root = payload as {
    output?: { choices?: Array<{ message?: { content?: Array<Record<string, unknown>> } }> };
  };
  const content = root.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const image = item?.image;
      if (typeof image !== 'string' || !image) continue;
      if (image.startsWith('data:')) return { b64_json: image.slice(image.indexOf(',') + 1) };
      if (/^https?:\/\//i.test(image)) return { url: image };
      return { b64_json: image };
    }
  }
  throw new Error('万相原生接口返回里没有图片');
}

function isGenerationRequest(url: string, init?: RequestInit): boolean {
  if ((init?.method ?? 'GET').toUpperCase() !== 'POST') return false;
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith('/images/generations');
  } catch {
    return url.replace(/\/+$/, '').endsWith('/images/generations');
  }
}

function parseJsonBody(body: RequestInit['body'] | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function loadReference(ref: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  let bytes: Uint8Array;
  let mime = '';
  let name = 'reference';
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetchImpl(ref, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`参考图下载失败 HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    name = lastPathName(ref) || 'reference';
  } else if (ref.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(ref);
    if (!m) throw new Error('参考图 data URL 格式不对');
    mime = m[1]!;
    bytes = new Uint8Array(Buffer.from(m[2]!, 'base64'));
    name = 'reference';
  } else {
    bytes = new Uint8Array(await readFile(ref));
    name = lastPathName(ref) || 'reference';
  }
  if (!bytes.length) throw new Error('参考图是空的');
  mime = sniffImage(bytes) ?? (mime.startsWith('image/') ? mime : 'image/png');
  const ext = extname(name).toLowerCase();
  if (!ext || !/^\.(png|jpe?g|webp|gif)$/.test(ext)) name = `reference.${extFor(mime)}`;
  return { bytes, mime, name };
}

function parseImagePayload(payload: unknown): { b64_json?: string; url?: string } {
  const root = payload as Record<string, unknown> | null;
  const list = root?.data ?? root?.images ?? root?.output ?? root?.result;
  const first = Array.isArray(list) ? list[0] : list;
  if (typeof first === 'string') {
    if (/^https?:\/\//.test(first)) return { url: first };
    return { b64_json: first };
  }
  if (first && typeof first === 'object') {
    const item = first as Record<string, unknown>;
    for (const key of ['b64_json', 'base64', 'image_base64']) {
      if (typeof item[key] === 'string' && item[key]) {
        const value = item[key] as string;
        return { b64_json: value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value };
      }
    }
    for (const key of ['url', 'image_url']) {
      if (typeof item[key] === 'string' && /^https?:\/\//.test(item[key] as string)) return { url: item[key] as string };
    }
  }
  throw new Error('自拍接口返回里没有图片（既没有 b64_json 也没有 url）');
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
}

async function readJson(res: Response, log?: SelfieLogger): Promise<unknown> {
  const text = await res.text();
  log?.info(`自拍响应体：${text.length} 字符`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`自拍接口返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

function logSelfieImage(image: { b64_json?: string; url?: string }, log: SelfieLogger): void {
  if (image.b64_json) {
    log.info(`自拍图：b64_json，${image.b64_json.length} 字符`);
    return;
  }
  if (image.url) {
    let host = '?';
    try {
      host = new URL(image.url).host;
    } catch {
      // 保留 ?，不打印完整 URL（可能带签名/token）。
    }
    log.info(`自拍图：url，host=${host}`);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

function extFor(mime: string): string {
  return mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png';
}

function lastPathName(value: string): string {
  try {
    return new URL(value).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return value.split(/[\\/]/).filter(Boolean).pop() ?? '';
  }
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
