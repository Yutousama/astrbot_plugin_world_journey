/**
 * 照片 —— 她路上拍的那一张。
 *
 * ## 为什么只拍风景，不拍她
 *
 * 同类扩展（旅行大肥鱼）走的是「角色参考图 + 双候选 + 宿主看图审核」那条路，
 * 为了让明信片里那只鱼每一次都是同一只。那条路很重：要参考图、要审核、要计费确认，
 * 而且**只要模型抖一次，图里的她就不是她了**。
 *
 * 这里反过来：**照片里没有她**。她拍的是窗外、是傍晚的城墙、是雨后的巷子 ——
 * 第一人称的空镜。于是一致性问题当场消失：没有角色，就没有角色不一致。
 * 剩下的全是风景，而风景是模型最擅长的东西。
 *
 * 这也更像真实旅行：人在外面拍得最多的，恰恰是没有自己的那些照片。
 *
 * ## 三条纪律
 *
 * 1. **能不算就不算，能少花钱就少花。** 一天最多一张，同城同日不重复。
 * 2. **失败静默。** 接口错了、超时了、额度没了 —— 旅行一步都不能停，
 *    也不该往用户脸上糊一条报错。只写日志。
 * 3. **图进宿主的媒体库，不进日记目录。** 日记在同步盘上，图片会把盘撑爆；
 *    而且 UI 只认 `log:` 句柄，塞进目录谁也看不见。
 */

/** 拍一张照片需要的上下文。全是**已经算好的事实**，这个模块不自己编。 */
export interface PhotoScene {
  /** 城市名，如「天水」。 */
  readonly city: string;
  /** 具体地点，如「麦积山石窟」。可以没有 —— 那就只拍城市。 */
  readonly spot?: string;
  /** 当地几点（0-23 的小时）。决定光。 */
  readonly hour: number;
  /** 天气，如「小雨」。可以直接为空。 */
  readonly weather?: string;
  /** 这一带的体感，如「干，风大」。用来决定照片的调子。 */
  readonly feel?: string;
  /**
   * 画面风格。留空 = 真实旅行照片（默认）；`none` = 完全不指定风格；
   * 其他 = 用这段原文当前缀。
   *
   * 2026-11-01 群友接的是本地 ComfyUI，底模是二次元 —— 提示词里写死
   * 「真实旅行照片、胶片质感」，等于让提示词跟底模对着干。
   */
  readonly style?: string;
}

export interface PhotoRequest {
  /** OpenAI 兼容的根地址，如 `https://api.openai.com/v1`。 */
  readonly api: string;
  readonly key: string;
  /** 模型 id。留空用 `gpt-image-1`。 */
  readonly model?: string;
  readonly size?: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

/** 生成结果。字节直接交给宿主，由它算哈希、落 `data/media/`。 */
export interface PhotoBytes {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** 默认模型。多数兼容接口都认 `gpt-image-1` 这一套请求体。 */
export const PHOTO_MODEL = 'gpt-image-1';
/** 默认尺寸。方图最省，也最像手机随手拍。 */
export const PHOTO_SIZE = '1024x1024';
/** 一张图等多久。生图慢是常态，但超过一分半就当作没拍成。 */
const PHOTO_TIMEOUT_MS = 90_000;

/**
 * 把事实拼成一句给模型的话。
 *
 * **不用「一只鱼站在……」这种句式。** 空镜的关键是：说清在哪、什么光、什么天气、
 * 什么质感，然后明确要求「没有人物、没有文字」。不写「没有人物」的话，
 * 模型很爱往画面里塞一个人 —— 那不是她，是一个陌生人站在她的照片里。
 *
 * 这一段是纯函数，测试直接喂数字验，不用起网络。
 */
export function photoPrompt(scene: PhotoScene): string {
  const where = scene.spot ? `${scene.city}的${scene.spot}` : scene.city;
  const light =
    scene.hour < 6 ? '天还没亮的蓝调时刻'
    : scene.hour < 9 ? '清晨的低角度阳光'
    : scene.hour < 12 ? '上午的明亮日光'
    : scene.hour < 15 ? '正午偏硬的光'
    : scene.hour < 18 ? '下午的斜光'
    : scene.hour < 20 ? '黄昏的金色光线'
    : '入夜后的灯光';

  /*
   * 风格分三档：
   * - 留空 → 原来的写实旅行照片（老行为，一个字没变）
   * - `none` → 一个字都不提风格，只描述场景，把画风完全交给底模
   * - 其他 → 用户给的原话当前缀
   *
   * 「没有人物/没有文字」这四不要**对任何风格都成立**，所以不在分支里。
   */
  const raw = (scene.style ?? '').trim();
  const bare = raw.toLowerCase() === 'none';
  const custom = raw !== '' && !bare;
  const lead = bare ? '' : custom ? `${raw}：` : '一张真实旅行照片：';

  const parts = [
    lead,
    `${where}，${light}。`,
    scene.weather ? `天气${scene.weather}。` : '',
    scene.feel ? `${scene.feel}，画面能看出这一点。` : '',
    // 这两句是「写实照片」的画法，指定了风格就不该再强加给底模。
    custom || bare ? '' : '视角像路过的人随手举起手机拍的，略微不完美，有生活感。',
    custom || bare ? '' : '胶片质感，自然光，景深自然。',
    '画面里没有人物，没有文字，没有水印，没有边框。',
  ];
  return parts.filter(Boolean).join('');
}

/**
 * 从作息节点的一句话里抠出地点。
 *
 * 节点写的是「下午，莫高窟」「清晨，老城那几条街」—— 前半截是时段，后半截才是地方。
 * 抠不出来就返回空串，让调用方只写城市名：**宁可能说的少，不要编一个地点**。
 */
export function spotFromBeat(what: string): string {
  const m = /[，,]\s*(.+)$/.exec(what.trim());
  const spot = (m?.[1] ?? '').trim();
  // 「城里随便走走」这种不是地点，别塞进提示词让模型去画一座「随便走走」。
  if (!spot || /随便走走|走一段|坐着看水|视野开的那一段|沿着水边/.test(spot)) return '';
  return spot.replace(/。$/, '');
}

/**
 * 这张照片叫什么。给相册用，一句话，不加书名号。
 *
 * 时间要参与命名：同一座城市不同时候拍出来是两张不同的照片，
 * 都叫「天水」的话相册里会有一排同名。
 */
export function photoTitle(city: string, spot: string, hour: number): string {
  const part =
    hour < 9 ? '清晨'
    : hour < 12 ? '上午'
    : hour < 15 ? '午后'
    : hour < 18 ? '下午'
    : '黄昏';
  return spot ? `${part}的${spot}` : `${part}的${city}`;
}

/**
 * 调一次生图。
 *
 * 支持两种返回：`b64_json`（OpenAI 与多数兼容接口）和 `url`（一部分服务，含火山方舟）。
 * 两种都要，因为「兼容」这两个字在现实里只兼容到一半。
 *
 * ## 失败要吵，成功要静
 *
 * 这个函数**抛错**，不返回 null。区别很大：返回 null 只能让上层记一句「没拍成」，
 * 而用户真正需要知道的是「HTTP 401：密钥无效」还是「HTTP 400：size 不支持」。
 * 上层 `maybePhoto` 会 catch 住并且只写日志 —— 旅行一步都不停，但日志里得有原因，
 * 否则用户配错了永远不知道为什么相册是空的。
 *
 * ## size 的重试
 *
 * 字段名和取值在不同服务上都不一样，实测三种：
 *
 * - OpenAI / 火山方舟：`size`（`1024x1024` / `2K`）
 * - 硅基流动、阿里百炼那种 DashScope 血统的：**`image_size`**，传 `size` 直接 400
 * - 有的干脆只认自己模型的默认尺寸，多传一个就报错
 *
 * 所以分两步退：先按 OpenAI 的写法发；400 且错误里点名 `image_size` 就换字段名重发
 * （尺寸不变）；还是不行才整个去掉，让服务商用默认值。
 * 判据是**错误文本**，不是状态码 —— 三种情况的 400 长得一模一样。
 */
export async function shootPhoto(req: PhotoRequest): Promise<PhotoBytes> {
  const base = req.api.trim().replace(/\/+$/, '');
  if (!base) throw new Error('生图接口没填');

  const url = `${base}/images/generations`;
  const body: Record<string, unknown> = {
    model: req.model?.trim() || PHOTO_MODEL,
    prompt: req.prompt,
    n: 1,
    // 有的服务只认 response_format，有的根本不认这个字段（认不认都不会报错）。
    response_format: 'b64_json',
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.key.trim()) headers.authorization = `Bearer ${req.key.trim()}`;
  const timeout = req.timeoutMs ?? PHOTO_TIMEOUT_MS;

  const send = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

  const wantSize = req.size?.trim() || PHOTO_SIZE;

  /*
   * 尺寸怎么写、要不要 `response_format`，各家不同。用三个开关描述「这一版请求长什么样」，
   * 每次 400 只改一个 —— 改哪一个是**看错误文本**决定的，不是按顺序瞎试。
   */
  let sizeField: 'size' | 'image_size' | null = 'size';
  let withFormat = true;
  /*
   * 默认请求「不要水印」。
   *
   * 2026-11-01 实测：硅基流动的免费模型（Kolors）默认在右下角烧一个「AI 生成」，
   * 提示词里写「没有水印」没用 —— 那是平台加的，不是模型画的。
   * 这一句是参数，不是描述。不认识这个字段的服务会 400，那就按阶梯去掉。
   */
  let withWatermark = true;
  const build = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...body };
    if (!withFormat) delete payload.response_format;
    if (withWatermark) payload.watermark = false;
    if (sizeField) payload[sizeField] = wantSize;
    return payload;
  };

  let res: Response;
  try {
    res = await send(build());
    /*
     * 最多再试两次。不追组合爆炸：真要两种字段一起被挑，让它报错进日志，
     * 比连发五六次把人家的限速打满强 —— 这个功能一天最多一张，不值得为它烧配额。
     */
    for (let i = 0; i < 3 && res.status === 400; i++) {
      const peek = (await res.clone().text()).slice(0, 400);
      const before = `${sizeField}|${withFormat}|${withWatermark}`;
      if (/image_size/i.test(peek) && sizeField !== 'image_size') {
        // 硅基流动、阿里百炼那一支：只认 image_size，传 size 直接拒
        sizeField = 'image_size';
      } else if (/response_format/i.test(peek) && withFormat) {
        // 不认识这个字段的服务：去掉它，回头看 data[0].url 也能取图
        withFormat = false;
      } else if (/watermark|水印/i.test(peek) && withWatermark) {
        // 不认识这个字段的服务：去掉，把那一点点水印忍了
        withWatermark = false;
      } else if (/size|尺寸|分辨率/i.test(peek) && sizeField !== null) {
        // 尺寸值本身它不收：什么尺寸都不带，让它用自己的默认值
        sizeField = null;
      }
      if (`${sizeField}|${withFormat}|${withWatermark}` === before) break;   // 认不出该改什么，别乱试
      res = await send(build());
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    throw new Error(name === 'TimeoutError' ? '超时了' : `连不上服务（${name}）`);
  }

  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`服务返回 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }

  /*
   * **不用 res.json()。** 它把 JSON.parse 的真实原因吞掉，只剩一句「不是 JSON」——
   * 2026-11-01 收到一条反馈：中转站那边图生成成功，这边只报「返回的不是 JSON」，
   * 用户和我们都没法判断是格式坏了、被截断了、还是返回了别的东西。
   * 改成先拿原文，失败时把大小、原始错误、头尾片段一起带出去。
   */
  const raw = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    const repaired = repairJsonText(raw);
    if (repaired === null) throw new Error(badJsonDetail(raw, e));
    payload = repaired;
  }

  const first = firstImage(payload);
  if (!first) throw new Error('返回里没有图');

  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    const bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
    /*
     * 用文件头认格式，**别硬写 image/png**。
     *
     * 两个理由：中转站给的也可能是 JPEG，写死 PNG 扩展名就错了；
     * 更要紧的是 —— 有些中转站在日志/响应里把 b64 换成占位符
     * （「[base64 image data omitted]」这种），解出来根本不是图。
     * 那种情况下必须当场说清，否则会存成一张打不开的「照片」。
     */
    const mime = sniffImage(bytes);
    if (!mime) {
      const head = Buffer.from(bytes.slice(0, 16)).toString('hex');
      throw new Error(`b64 解出来不是图片（前 16 字节 ${head || '空'}）—— 中转站可能返回了占位符或截断的数据`);
    }
    return { bytes, mime };
  }
  if (typeof first.url === 'string' && /^https?:\/\//.test(first.url)) {
    try {
      const dl = await fetch(first.url, { signal: AbortSignal.timeout(timeout) });
      if (!dl.ok) throw new Error(`下载图片 HTTP ${dl.status}`);
      const buf = new Uint8Array(await dl.arrayBuffer());
      if (!buf.length) throw new Error('图片是空的');
      const header = dl.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      /*
       * **不能只信 content-type。** 对象存储（阿里 OSS、各家 CDN）很常见地把图片标成
       * `application/octet-stream` 或者压根不给。宿主按 mime 决定落盘扩展名，
       * 认不出就存成 `.bin` —— 用户双击打不开，相册也显示不出来
       * （2026-11-01 真实发生：一张 1.7MB 的 PNG 存成了 4aeaca….bin）。
       *
       * 所以：给的是 image/* 就用它；否则**看文件头**，再不行才按 PNG。
       */
      const mime = header.startsWith('image/') && !header.includes('octet-stream')
        ? header
        : sniffImage(buf) ?? 'image/png';
      return { bytes: buf, mime };
    } catch (e) {
      throw new Error(`拿到了图片地址但下载失败（${e instanceof Error ? e.message : '未知'}）`);
    }
  }
  throw new Error('返回格式不对：既没有 b64_json 也没有 url');
}

/**
 * 中转站常见的一种坏法：base64 里带着**裸换行**（没转义成 \n）。
 * 那不是合法 JSON，但把字符串内部的换行吃掉就能解析。
 *
 * 只在 JSON.parse 失败后才试，而且只动 base64 那一段 ——
 * 别处的换行删了会改变内容（提示词里的换行是有意义的）。
 */
function repairJsonText(raw: string): unknown | null {
  /*
   * 盯住 b64_json 那个值，把它内部的空白全删掉。
   * base64 不含空白字符，所以这个动作是安全的；而按长度猜断行位置不可靠
   * （最后一段可能只有十几个字符，写死阈值就漏）。
   */
  /*
   * **用 lookahead 卡后面的分隔符，别把它吃进匹配里。**
   * 写成 `"\s*[,}]` 的话 m[0] 会带上那个 `}`，替换之后 JSON 少一个括号，
   * 修完还是不合法 —— 第一版就是这么错的。
   */
  const m = raw.match(/"b64_json"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/);
  if (!m) return null;
  const cleaned = m[1].replace(/\s+/g, '');
  if (cleaned === m[1]) return null;
  // 用函数形式替换：值里可能有 `$`，字符串形式替换会被当成特殊记号。
  const rebuilt = raw.replace(m[0], () => `"b64_json":"${cleaned}"`);
  try {
    return JSON.parse(rebuilt);
  } catch {
    return null;
  }
}

/** 把长 base64 串折成占位，别把几 MB 的图塞进日志和界面。 */
function maskBase64(text: string): string {
  return text.replace(/[A-Za-z0-9+/=]{80,}/g, (m) => `<base64 ${m.length} 字符>`);
}

/** 解析失败时能让人判断到底怎么了：多大、原始错误、头尾长什么样。 */
function badJsonDetail(raw: string, err: unknown): string {
  const why = err instanceof Error ? err.message : String(err);
  const head = maskBase64(raw.slice(0, 160));
  const tail = maskBase64(raw.slice(-40));
  const look = raw.length > 200 ? `开头 ${head} … 结尾 ${tail}` : head;
  return `返回的不是 JSON（${raw.length} 字符）：${why}。${look}`;
}

/**
 * 从返回体里捞出第一张图。
 *
 * **不能只认 `data`。** 2026-11-01 同一天里两种形状都见着了：
 * OpenAI 与多数兼容层是 `{ data: [{ url }] }`，硅基流动现在回的是
 * `{ images: [{ url }] }` —— 只认 `data` 的话，图明明生成好了，
 * 这边却报「返回里没有图」，钱照扣。
 */
export function firstImage(payload: unknown): { b64_json?: unknown; url?: unknown } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  // 顶层直接给一个地址的服务也见过
  if (typeof o.url === 'string') return { url: o.url };
  for (const key of ['data', 'images', 'output', 'outputs', 'result']) {
    const list = o[key];
    if (!Array.isArray(list) || !list.length) continue;
    const first = list[0];
    if (typeof first === 'string') return /^https?:\/\//.test(first) ? { url: first } : undefined;
    if (first && typeof first === 'object') return first as { b64_json?: unknown; url?: unknown };
  }
  return undefined;
}

/**
 * 按文件头认图片格式。认不出返回 null。
 *
 * 只认这四种：这个功能产出的就是这四种，别的一律当 PNG 处理 —— 反正后面要交给宿主，
 * 猜错扩展名比认不出来更糟。
 */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}

/**
 * 从错误响应里捞一句人能看懂的。
 *
 * 各家的错误结构不一样：OpenAI 是 `{error:{message}}`，方舟是 `{error:{message}}` 或
 * `{message}`，还有的只回一行纯文本。**捞不到就不啰嗦**，别把整段 JSON 塞进日志。
 */
async function readError(res: Response): Promise<string> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 800);
  } catch {
    return '';
  }
  try {
    const o = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const msg = typeof o.error === 'object' && o.error ? o.error.message : o.message ?? o.error;
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 200);
  } catch { /* 不是 JSON，按纯文本处理 */ }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}
