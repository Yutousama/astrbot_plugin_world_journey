/**
 * 生图代理（自拍套壳 + 模型名降级）。
 *
 * 上游 `photo.ts` 只认**一个**模型 id，而且它属于只读基线，套壳不能改。
 * 所以这里在 AstrBot 侧套一层 fetch 代理，拦上游的 `POST /images/generations`：
 *
 *   上游请求 /images/generations
 *      → 配置了多个模型名时，按顺序逐个重发：前一个报错就换下一个
 *      → 自拍开启时，先把空镜提示词换成自拍提示词，再走参考图接口
 *      → 把结果包成上游认识的 {data:[{b64_json|url}]}
 *
 * 只有**所有**模型都失败，才把失败回给上游（上游再照常写日志/报错）。
 * 关闭自拍、也没配模型列表时完全不介入。
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export interface SelfieOptions {
  readonly enabled: boolean;
  readonly references: readonly string[];
  readonly api: string;
  readonly key: string;
  /**
   * 模型 id。可以是**按优先顺序排的列表**：前一个报错就换下一个，全都失败才抛错。
   * 自拍模型留空时，桥接层会把「生图模型名」的整个列表传进来。
   */
  readonly model: string | readonly string[];
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

/** 代理要做的两件事；`selfie` 为空 = 只做模型降级。 */
export interface PhotoProxyOptions {
  /** 生图模型名列表，按顺序降级。空 = 不介入普通空镜请求。 */
  readonly models: readonly string[];
  /** 自拍套壳；`null` = 关闭。 */
  readonly selfie: SelfieOptions | null;
  /**
   * 她所在城市的当地时间 `HH:MM`。每次生图前取一次；
   * 拿不到（或没传）时用本机时间兜底。
   */
  readonly clock?: () => Promise<string | null>;
}

export interface PhotoProxy {
  readonly uninstall: () => void;
  /** 装代理之前的 fetch —— 主动汇报自己发请求时用它，免得被自己的代理再拦一次。 */
  readonly fetch: typeof fetch;
}

interface SelfieImage {
  b64_json?: string;
  url?: string;
}

interface ReferenceImage {
  bytes: Uint8Array;
  mime: string;
  name: string;
}

const DEFAULT_PROMPT = [
  '一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。',
  '时间：{time}（{clock}）。',
  '背景：{scene}',
  '参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服。',
  '真实手机自拍质感，自然光，轻微手持感；画面里只有{subject}一个人，没有文字、水印、边框。',
].join('\n');

const NO_PEOPLE = /画面里没有人物[^。]*。/g;
const PASSERBY = /视角像路过的人[^。]*。/g;
const FILM = /胶片质感[^。]*。/g;

/**
 * 时段描述表：`[起始分钟, 描述词]`，从 00:00 一直铺到 23:59。
 *
 * 分得比「早/中/晚」细，是因为自拍的光线全靠这一段文字：
 * 05:00 和 06:40 都是「早上」，但一个是天刚亮、一个是太阳已经起来。
 * 边界取整分钟，描述词保持一个词，方便模型直接当成画面条件。
 */
const TIME_OF_DAY: ReadonlyArray<readonly [number, string]> = [
  [0, '午夜'],
  [90, '凌晨'],
  [210, '黎明前'],
  [270, '拂晓'],
  [300, '黎明'],
  [315, '破晓'],
  [360, '晨光初现'],
  [405, '清晨'],
  [450, '早晨'],
  [510, '上午'],
  [600, '上午将尽'],
  [660, '临近正午'],
  [690, '正午'],
  [780, '午后'],
  [840, '下午'],
  [930, '下午将尽'],
  [990, '傍晚'],
  [1050, '黄昏'],
  [1095, '暮色'],
  [1140, '入夜'],
  [1200, '夜晚'],
  [1320, '深夜'],
  [1410, '午夜前'],
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 解析 `HH:MM` / `H:MM` / `HH:MM:SS`；不合法返回 null。 */
function parseClock(value?: string): { minutes: number; text: string } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((value ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { minutes: hour * 60 + minute, text: `${pad2(hour)}:${pad2(minute)}` };
}

function systemClock(): { minutes: number; text: string } {
  const now = new Date();
  return {
    minutes: now.getHours() * 60 + now.getMinutes(),
    text: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  };
}

function labelFor(minutes: number): string {
  let label = TIME_OF_DAY[0]![1];
  for (const [start, text] of TIME_OF_DAY) {
    if (minutes >= start) label = text;
    else break;
  }
  return label;
}

/**
 * 把当地时间换算成「时段描述词 + HH:MM」。
 *
 * 传空或格式不对时用本机时间兜底 —— 兜底只影响描述，不会让生图失败。
 * 秒参与不了分段（raw 的世界时钟是分钟精度），所以描述按整分钟取。
 */
export function describeTime(clock?: string): { label: string; clock: string } {
  const parsed = parseClock(clock) ?? systemClock();
  return { label: labelFor(parsed.minutes), clock: parsed.text };
}

export function buildSelfiePrompt(
  original: string,
  opts: Pick<SelfieOptions, 'subject' | 'promptTemplate'>,
  clock?: string,
): string {
  const scene = original
    .replace(/^一张真实旅行照片：/, '')
    .replace(NO_PEOPLE, '')
    .replace(PASSERBY, '')
    .replace(FILM, '')
    .replace(/\s+/g, ' ')
    .trim();
  const subject = opts.subject.trim() || '她本人';
  const template = opts.promptTemplate.trim() || DEFAULT_PROMPT;
  const time = describeTime(clock);
  let prompt = template
    .replaceAll('{scene}', scene)
    .replaceAll('{subject}', subject)
    .replaceAll('{time}', time.label)
    .replaceAll('{clock}', time.clock);
  // 老模板没有这两个占位符：把时间补在末尾，保证升级后立刻生效。
  if (!template.includes('{time}') && !template.includes('{clock}')) {
    prompt += `\n时间：${time.label}（${time.clock}）。`;
  }
  return prompt.trim();
}

/**
 * 安装生图代理。
 *
 * 普通空镜：把上游请求体里的 `model` 换成列表中的下一个重发，成功就原样返回；
 * 自拍：每个候选模型都走一遍参考图接口，成功就包成上游认识的结构。
 *
 * 什么时候**不**降级：
 * - 401/403：密钥/权限问题，换模型不会好，保留原响应；
 * - 400 且错误点名 size / image_size / response_format / watermark：这是请求形状
 *   不兼容，上游有自己的换字段重试阶梯，抢在它前面换模型会把阶梯弄丢。
 */
export function installPhotoProxy(
  opts: PhotoProxyOptions,
  log: SelfieLogger,
  fetchImpl: typeof fetch = globalThis.fetch,
): PhotoProxy {
  const models = modelListOf(opts.models);
  const selfie = opts.selfie?.enabled === true ? opts.selfie : null;
  // 只有自拍，或真正配了「第二个模型」时才需要拦请求；单个模型上游自己就发对了。
  if (!selfie && models.length < 2) return { uninstall: () => {}, fetch: fetchImpl };
  if (selfie && selfie.references.length === 0) {
    log.warn('自拍已开启，但没有参考图；照片会失败而不是退回空镜。请在插件配置里上传 selfie_reference。');
  }
  const original = fetchImpl;
  const wrapper = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    if (!isGenerationRequest(url, init)) return original(input, init);
    const body = parseJsonBody(init?.body);
    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
    if (!body || !prompt) return original(input, init);

    // 自拍模型留空时，用上游请求里的 model（= 生图模型名的第一个）兜底。
    const selfieModels = selfie ? modelListOf(selfie.model) : [];
    const candidates = selfie
      ? (selfieModels.length ? selfieModels : [stringOf(body.model).trim() || 'gpt-image-1'])
      : models;
    if (candidates.length === 0) return original(input, init);

    let reference: ReferenceImage | null = null;
    let clock: string | undefined;
    if (selfie) {
      try {
        reference = await loadSelfieReference(selfie, original);
      } catch (e) {
        const message = errText(e);
        log.warn(`自拍生图失败：${message}`);
        return jsonResponse({ error: { message } }, 502);
      }
      try {
        clock = (await opts.clock?.()) ?? undefined;
      } catch {
        // 取不到当地时间只影响描述词，用本机时间兜底即可，不让生图失败。
        clock = undefined;
      }
    }

    const failures: string[] = [];
    for (const model of candidates) {
      try {
        if (selfie) {
          const result = await generateSelfieWithModel(selfie, model, body, prompt, original, log, reference!, clock);
          return jsonResponse({ data: [result] });
        }
        const res = await replayWithModel(original, url, init ?? {}, body, model);
        if (res.ok) return res;
        const detail = await peekError(res);
        if (shouldKeepResponse(res.status, detail)) return res;
        failures.push(`${model}：HTTP ${res.status}${detail ? `：${detail}` : ''}`);
      } catch (e) {
        const why = errText(e);
        failures.push(`${model}：${why}`);
        // 连不上/超时不是模型的问题，换下一个也是同一个结果；交回上游按原样报错。
        if (!selfie) throw e;
      }
    }
    const message = candidates.length > 1
      ? `所有生图模型都失败了（${failures.join('；')}）`
      : failures[0] ?? '生图失败';
    log.warn(`生图失败：${message}`);
    return jsonResponse({ error: { message } }, 502);
  };
  globalThis.fetch = wrapper as typeof fetch;
  return {
    fetch: original,
    uninstall: () => {
      if (globalThis.fetch === wrapper) globalThis.fetch = original;
    },
  };
}

/** 兼容旧入口：只装自拍套壳，不做普通空镜的模型降级。 */
export function installSelfieProxy(
  opts: SelfieOptions,
  log: SelfieLogger,
  fetchImpl: typeof fetch = globalThis.fetch,
): () => void {
  return installPhotoProxy({ models: [], selfie: opts }, log, fetchImpl).uninstall;
}

/** 给主动汇报生成一张自拍，返回字节；不经过上游 photo 事件。 */
export async function generateSelfieBytes(
  prompt: string,
  opts: SelfieOptions,
  fetchImpl: typeof fetch = globalThis.fetch,
  log: SelfieLogger = { info: () => {}, warn: () => {} },
  clock?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const reference = await loadSelfieReference(opts, fetchImpl);
  const models = modelListOf(opts.model);
  const candidates = models.length ? models : ['gpt-image-1'];
  const failures: string[] = [];
  let result: SelfieImage | null = null;
  for (const model of candidates) {
    try {
      result = await generateSelfieWithModel(opts, model, {}, prompt, fetchImpl, log, reference, clock);
      break;
    } catch (e) {
      const why = errText(e);
      failures.push(candidates.length > 1 ? `${model}：${why}` : why);
      log.warn(`自拍模型 ${model} 失败：${why}`);
    }
  }
  if (!result) {
    throw new Error(candidates.length > 1
      ? `自拍所有模型都失败了（${failures.join('；')}）`
      : failures[0] ?? '自拍失败');
  }
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

/** 用一个模型生成一张自拍。失败会抛错，由调用方决定要不要换下一个模型。 */
async function generateSelfieWithModel(
  opts: SelfieOptions,
  model: string,
  upstreamBody: Record<string, unknown>,
  originalPrompt: string,
  fetchImpl: typeof fetch,
  log: SelfieLogger,
  reference: ReferenceImage,
  clock?: string,
): Promise<SelfieImage> {
  const api = opts.api.trim().replace(/\/+$/, '');
  if (!api) throw new Error('自拍生图接口没填（selfie_api / image_api）');
  const prompt = buildSelfiePrompt(originalPrompt, opts, clock);
  const size = opts.size.trim() || stringOf(upstreamBody.size) || '1024x1024';
  const headers: Record<string, string> = {};
  if (opts.key.trim()) headers.authorization = `Bearer ${opts.key.trim()}`;

  if (opts.mode === 'native') {
    return await generateNative(opts, api, model, size, prompt, reference, headers, fetchImpl, log);
  }

  if (opts.mode === 'generation') {
    const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString('base64')}`;
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
      [opts.imageField.trim() || 'image_url']: opts.imageField.trim() === 'image'
        ? Buffer.from(reference.bytes).toString('base64')
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
  form.set('image', new Blob([reference.bytes], { type: reference.mime }), reference.name);
  let res = await fetchImpl(`${api}/images/edits`, { method: 'POST', headers, body: form });
  if (res.status === 400 || res.status === 415) {
    const peek = (await res.clone().text()).slice(0, 500);
    // 有些中转站不收 multipart，只认 JSON 的 data URL；再试一次。
    if (/multipart|content-type|image|图片/i.test(peek)) {
      const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString('base64')}`;
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

async function loadSelfieReference(opts: SelfieOptions, fetchImpl: typeof fetch): Promise<ReferenceImage> {
  const references = opts.references.filter(Boolean);
  if (!references.length) throw new Error('没有参考图：请在插件配置里上传 selfie_reference');
  return loadReference(references[0]!, fetchImpl);
}

/**
 * 把原请求体里的 model 换成候选模型重发。
 *
 * 只重发 JSON 请求体（上游 `photo.ts` 就是这么发的）；multipart 之类的原样放过。
 */
function replayWithModel(
  original: typeof fetch,
  url: string,
  init: RequestInit,
  body: Record<string, unknown>,
  model: string,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return original(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, model }),
    signal: init.signal ?? undefined,
  });
}

/** 请求形状问题（尺寸/字段名）留给上游自己的兼容阶梯，不算「模型不可用」。 */
function shouldKeepResponse(status: number, detail: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 400 && /image_size|response_format|watermark|水印|尺寸|分辨率|\bsize\b/i.test(detail)) {
    return true;
  }
  return false;
}

async function peekError(res: Response): Promise<string> {
  try {
    const text = (await res.clone().text()).slice(0, 500);
    try {
      const o = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
      const msg = typeof o.error === 'object' && o.error ? o.error.message : o.message ?? o.error;
      if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 200);
    } catch {
      // 不是 JSON，按纯文本处理。
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 把模型配置归一成数组：兼容单个字符串，去空白、去空项、去重、保持顺序。 */
function modelListOf(value: string | readonly string[] | null | undefined): string[] {
  const raw = typeof value === 'string'
    ? value.split(/[\n,，;；]+/)
    : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
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
