/**
 * 生图代理（**接口形状** + 自拍套壳 + 全局提示词模板 + 模型名降级）。
 *
 * 上游 `photo.ts` 只认**一个**模型 id、只会按 OpenAI 那套字段发请求，而且它属于只读
 * 基线，套壳不能改。所以这里在 AstrBot 侧套一层 fetch 代理，拦上游的
 * `POST /images/generations`：
 *
 *   上游请求 /images/generations
 *      → 按 `image_shape` 把请求改成这家服务商认的形状（见 `resolveImageShape`）
 *      → 配置了多个模型名时，按顺序逐个重发：前一个报错就换下一个
 *      → 自拍开启时，先把空镜提示词换成自拍提示词，再走参考图接口
 *      → 只开「空镜套模板」时，换提示词但不带参考图，仍走 /images/generations
 *      → 把结果包成上游认识的 {data:[{b64_json|url}]}
 *
 * 「接口形状」这件事必须在代理里做，不能指望上游的 400 重试阶梯：阶梯只会**删字段**，
 * 而 Grok（xAI）要的是**换个字段**（`size` → `aspect_ratio` + `resolution`，
 * 参考图从顶层字符串换成 `image:{url}` 对象）。形状不对时它的表现最难查 ——
 * 有的服务商收下整个请求、把不认识的 `image_url` 丢掉，于是 HTTP 200、出图正常，
 * 只是和参考图毫无关系。
 *
 * 「提示词模板」现在是**全局**的：不管自拍开不开，最终发给接口的这句话都由
 * `promptTemplate` + `{style}`（= 用户的「画面风格」）决定。以前模板只在自拍路径
 * 生效，于是同一个「动漫画风」配置，相册里是二次元、主动汇报里是真人照片。
 *
 * 只有**所有**模型都失败，才把失败回给上游（上游再照常写日志/报错）。
 * 自拍关闭、模板也没开、也没配模型列表时完全不介入。
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
  /**
   * 面板上的「接口形状」（`image_shape`）。`auto` / 空 / 认不出的值交给 `resolveImageShape`
   * 按旧字段和接口地址推断。
   */
  readonly shape?: string;
  /**
   * 旧字段 `selfie_mode`（`edit` / `generation` / `native`）。只作为 `shape` 没填时的
   * 兼容来源，新代码不要再按它分支。
   */
  readonly mode?: 'edit' | 'generation' | 'native' | string;
  /**
   * 旧字段 `selfie_edit_json`：`edit` 模式直接发 JSON（带 data URL），跳过 multipart。
   *
   * 有些中转站/上游只认 `application/json`，multipart 直接 415/502；等价于 `shape=relay`。
   */
  readonly editJson?: boolean;
  readonly nativeUrl?: string;
  readonly size: string;
  readonly imageField: string;
  /**
   * Grok 的 `quality`（`low` / `medium`）。留空不发，让服务商按默认 `auto` 走
   * （编辑请求的 auto 已经是 `medium`）。不进面板，只从 `extra_config` 的
   * `imageQuality` 读。
   */
  readonly quality?: string;
  /**
   * 一次生图最多等多久（毫秒）。来自 `image_timeout_sec`；留空用 120 秒。
   * 2k 的编辑请求比生成慢得多，写死 120 秒会把还在画的请求掐掉。
   */
  readonly timeoutMs?: number;
  readonly subject: string;
  readonly promptTemplate: string;
  /**
   * 用户的「画面风格」（`image_style`）。填了就是模板里的 `{style}`；
   * 模板没写 `{style}` 时补一行「画风：X」。留空或 `none` = 不指定。
   */
  readonly style?: string;
  /**
   * 兼容开关：不发送 `response_format`。
   *
   * 有的中转站/上游不认这个字段，带上就 400；关掉后改用服务商默认返回格式。
   */
  readonly noResponseFormat?: boolean;
  /**
   * 兼容开关：不发送 `size`。
   *
   * 有的上游只认自己的默认尺寸，带 `size` 会报 `Argument not supported: size`。
   */
  readonly noSize?: boolean;
}

/** 生图接口的「请求形状兼容」开关；空镜重放与自拍共用同一组语义。 */
export interface ImageCompatOptions {
  readonly noResponseFormat?: boolean;
  readonly noSize?: boolean;
}

/**
 * 接口形状（= 服务商预设）。面板上的 `auto` 只是「让它去认」，解析结果里不会出现。
 *
 * - `grok`：xAI Grok。`/images/edits` **只收 `application/json`**，参考图必须是
 *   嵌套对象 `image:{url}`（多图换 `images:[{url},…]`，≤5 张），没有 `size`/`watermark`
 *   这两个字段，尺寸改由 `aspect_ratio` + `resolution` 表达。
 * - `openai`：OpenAI 原生 `/images/edits`，multipart。
 * - `relay`：只认 JSON 的中转站，参考图放顶层 `image_url` 的 data URL。
 * - `generation`：把参考图当字段塞进 `/images/generations`。
 * - `wan`：阿里百炼原生 `multimodal-generation`（`input.messages` 带 data URL）。
 */
export type ImageShape = 'grok' | 'openai' | 'relay' | 'generation' | 'wan';

/** 这个形状是谁定的 —— 日志要能说清「这是你选的，还是我们替你认的、凭什么认的」。 */
export type ShapeSource = 'panel' | 'legacy' | 'model' | 'host' | 'default';

/** 解析形状要看的输入：面板值优先，其次旧三件套，再按模型名认，最后按接口地址认。 */
export interface ShapeInput {
  readonly shape?: string;
  readonly api?: string;
  /**
   * 这一次要用的模型 id（给列表就取第一个）。`auto` 时**先看模型名**：中转站一个域名后面挂着
   * 几十家模型，按地址猜等于瞎猜，而模型名直接说明「这家后端是谁」。
   * 降级链每换一个模型都会重新认一次。
   */
  readonly model?: string | readonly string[];
  /** 候选模型列表；只在没传 `model` 时取第一个（给启动日志和配错提示用）。 */
  readonly models?: readonly string[];
  /** 旧 `selfie_mode`。 */
  readonly mode?: string;
  /** 旧 `selfie_edit_json`。 */
  readonly editJson?: boolean;
  /** 旧 `selfie_image_field`。 */
  readonly imageField?: string;
}

export interface ResolvedShape {
  readonly shape: ImageShape;
  /**
   * `relay` / `generation` 路径上参考图放的顶层字段名（`grok` 不用它，`openai` 用 multipart）。
   * 旧字段没填非默认值时保持 `image_url`。
   */
  readonly imageField: string;
  readonly source: ShapeSource;
  /** 不是面板选的、也不是旧字段折出来的（= 我们替用户认的）。 */
  readonly guessed: boolean;
}

const SHAPES: readonly ImageShape[] = ['grok', 'openai', 'relay', 'generation', 'wan'];

/**
 * 模型名 → 形状。只收「形状能由模型名断定」的族，剩下的交给接口地址或默认。
 *
 * - `grok` / `imagine`：xAI 的编辑接口只有 JSON + `image:{url}` 一种吃法。
 *   **实测过中转站也照收**（`ai.yutou233.cn` 上 `grok-imagine-image` 用这个形状 200 出图），
 *   所以这条不看域名。
 * - `dall-e` / `gpt-image` / `chatgpt-image`：OpenAI 原生 edits 就是 multipart。
 * - **`wan*` 故意不在这里**：万相的模型名既可能配百炼原生端点（要 `wan` 形状），
 *   也可能配中转站的 OpenAI 兼容端点（要 `openai`/`relay`）。这种歧义只能由地址决定，
 *   所以 `wan` 只走 host 那条判断。
 */
const MODEL_SHAPES: ReadonlyArray<readonly [RegExp, ImageShape]> = [
  [/grok|imagine/i, 'grok'],
  [/^(dall-?e|gpt-image|chatgpt-image)/i, 'openai'],
];

/** 模型名能说明的形状；认不出返回空串。`auto` 的解析和「配错了要提醒」都用它，
 * 判据只写在这一处。 */
export function modelShapeHint(model: string): ImageShape | '' {
  const name = (model ?? '').trim();
  if (!name) return '';
  for (const [pattern, shape] of MODEL_SHAPES) {
    if (pattern.test(name)) return shape;
  }
  return '';
}

/** 面板/引擎里模型既可能是单个字符串，也可能是降级列表；取第一个来看形状。 */
function firstModel(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return '';
}

/**
 * 把「面板值 + 旧字段 + 模型名 + 接口地址」折成一个形状。
 *
 * 优先级：**显式 `image_shape` > 旧 `selfie_mode`/`selfie_edit_json` > 模型名 > 接口地址 > 默认**。
 * 显式值排第一，是因为用户明确选了就要照办；旧字段排第二，是为了升级后一个字都没改过配置的人
 * 行为逐字不变（原来开着 `selfie_edit_json` 的仍然走 `relay`，不会突然改发 multipart）。
 * 模型名排第三：认错了顶多是多一次失败请求，而 `grok-imagine-image` 认成 `openai` 的代价
 * 正好是「参考图被丢掉但照样出图」，所以宁可先按模型名点名。
 */
export function resolveImageShape(input: ShapeInput): ResolvedShape {
  const imageField = (input.imageField ?? '').trim() || 'image_url';
  const found = (shape: ImageShape, source: ShapeSource): ResolvedShape => ({
    shape,
    imageField,
    source,
    guessed: source !== 'panel' && source !== 'legacy',
  });
  const explicit = (input.shape ?? '').trim().toLowerCase();
  if (explicit && explicit !== 'auto' && (SHAPES as readonly string[]).includes(explicit)) {
    return found(explicit as ImageShape, 'panel');
  }
  const legacy = (input.mode ?? '').trim().toLowerCase();
  if (legacy === 'native') return found('wan', 'legacy');
  if (legacy === 'generation') return found('generation', 'legacy');
  if (legacy === 'edit') return found(input.editJson === true ? 'relay' : 'openai', 'legacy');
  const model = firstModel(input.model) || firstModel(input.models);
  const hint = modelShapeHint(model);
  if (hint) return found(hint, 'model');
  const host = hostOf(input.api ?? '');
  if (/(^|\.)x\.ai$/i.test(host)) return found('grok', 'host');
  if (/dashscope|aliyuncs|bailian/i.test(host)) return found('wan', 'host');
  return found('openai', 'default');
}

/** 日志用的一行话：形状 + 是谁定的。认出来的必须说清凭什么，否则排查时是猜谜。 */
export function describeShape(shape: ResolvedShape, model?: string): string {
  switch (shape.source) {
    case 'panel': return `${shape.shape}（面板选的）`;
    case 'legacy': return `${shape.shape}（由旧的自拍字段折出来）`;
    case 'model': return `${shape.shape}（按模型名${model ? ` ${model}` : ''}认出）`;
    case 'host': return `${shape.shape}（按接口地址认出）`;
    default: return `${shape.shape}（默认）`;
  }
}

/** 面板值是不是「让它去认」（空、auto、以及认不出的值都按 auto 处理）。 */
export function shapeIsAuto(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  return !raw || raw === 'auto' || !(SHAPES as readonly string[]).includes(raw);
}

function hostOf(api: string): string {
  try {
    return new URL(api).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Grok 认的比例枚举（`aspect_ratio`）。顺序无所谓，吸附按数值差算。 */
const ASPECTS: ReadonlyArray<readonly [string, number]> = [
  ['1:1', 1], ['3:4', 0.75], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9],
  ['2:3', 2 / 3], ['3:2', 1.5], ['9:19.5', 9 / 19.5], ['19.5:9', 19.5 / 9],
  ['9:20', 0.45], ['20:9', 20 / 9], ['1:2', 0.5], ['2:1', 2], ['21:9', 21 / 9], ['5:2', 2.5],
];

/** 一个尺寸字符串在 Grok 上翻出来的参数；两个都可能缺（留空就都不发，交给服务商默认）。 */
export interface GrokSize {
  readonly aspectRatio?: string;
  readonly resolution?: string;
}

/**
 * 把面板里的「尺寸」翻成 Grok 的 `aspect_ratio` + `resolution`。
 *
 * 一个字段承载三种写法，是为了不再为 Grok 单开两个配置项：
 * - `1664x928`（各家通用写法）→ 比例吸附到最近的枚举 + 长边推分辨率（≥1792 → `2k`、≥1152 → `1.5k`，更小的值就是默认 `1k`，不发）；
 * - `3:4` → 只发比例；`2k` → 只发分辨率；
 * - 空或认不出 → 什么都不发（比例跟随参考图，分辨率按默认 `1k`）。
 *
 * 调用方决定用不用 `aspectRatio`：单参考图编辑不能发（官方纪律），`/images/generations` 可以发。
 */
export function grokSizeOf(size: string): GrokSize {
  const value = (size ?? '').trim().toLowerCase().replace('\u00d7', 'x');
  if (!value) return {};
  const kilo = /^(\d+(?:\.\d+)?)k$/.exec(value);
  if (kilo) {
    const side = Number(kilo[1]);
    return { resolution: side >= 2 ? '2k' : side >= 1.5 ? '1.5k' : '1k' };
  }
  const parts = /^(\d+(?:\.\d+)?)[x:]([a-z0-9.]+)$/.exec(value);
  if (!parts) return {};
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  if (!(a > 0 && b > 0)) return {};
  const aspectRatio = nearestAspect(a / b);
  if (value.includes(':')) return { aspectRatio };
  const long = Math.max(a, b);
  const resolution = long >= 1792 ? '2k' : long >= 1152 ? '1.5k' : undefined;
  return resolution ? { aspectRatio, resolution } : { aspectRatio };
}

function nearestAspect(ratio: number): string {
  let best = ASPECTS[0]![0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const [name, value] of ASPECTS) {
    const diff = Math.abs(value - ratio);
    if (diff < bestDiff) { bestDiff = diff; best = name; }
  }
  return best;
}

/** 只有 `宽x高` 这种写法能当 `size` 发给别家；`3:4` / `2k` 是 Grok 专属。 */
export function isWxH(size: string): boolean {
  return /^\d{2,5}[x\u00d7]\d{2,5}$/i.test((size ?? '').trim());
}

/**
 * 一次生图请求最多等多久。`image_timeout_sec` 留空（0）时按 120 秒。
 *
 * 出图比查询慢一个数量级，超时被掐掉的代价是「她明明在画，我们挂了」。
 */
export function selfieTimeoutMs(seconds: number | undefined): number {
  const sec = Number(seconds);
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 120_000;
}

/**
 * 空镜（没开自拍）的模板选项。
 *
 * 单独一套而不是复用自拍模板：自拍模板里有 `{subject}` 和「画面里只有她一个人」，
 * 套到空镜上就把风景照画出了人 —— 而上游的空镜纪律恰恰是「画面里没有人物」。
 */
export interface SceneTemplateOptions {
  readonly enabled: boolean;
  readonly promptTemplate: string;
  readonly style?: string;
  readonly subject?: string;
}

export interface SelfieLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** 代理要做的三件事；`selfie` 为空 = 只做模板改写和模型降级。 */
export interface PhotoProxyOptions {
  /** 生图模型名列表，按顺序降级。空 = 不重发（除非要改写空镜提示词）。 */
  readonly models: readonly string[];
  /** 自拍套壳；`null` = 关闭。 */
  readonly selfie: SelfieOptions | null;
  /** 空镜模板改写；`enabled` 为假 = 空镜提示词一个字都不动。 */
  readonly scene?: SceneTemplateOptions | null;
  /**
   * 接口形状（`image_shape`）。作用于「空镜 / 原样重发」这条路径；自拍路径按
   * `SelfieOptions` 自己的 `shape` + `api` 解析（自拍的接口地址可能是另一家服务商）。
   */
  readonly shape?: ShapeInput | null;
  /** Grok 的 `quality`，作用于空镜重发；自拍读 `SelfieOptions.quality`。 */
  readonly quality?: string;
  /**
   * 请求形状兼容开关：作用于「空镜 / 原样重放」这条路径的请求体
   * （自拍路径读 `SelfieOptions` 里的同名字段）。
   */
  readonly compat?: ImageCompatOptions;
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

/**
 * 内置默认模板（自拍）。
 *
 * 这里**不写死**照片质感：质感由「画面风格」（`{style}`）决定。老版本写的是
 * 「真实手机自拍质感，自然光，轻微手持感」，等于套壳替用户决定了画风 ——
 * 用户填了「动漫画风」也只会在 `背景：` 里冒出来半句，出图照样是真人照片。
 */
const DEFAULT_PROMPT = [
  '一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。',
  '画风：{style}',
  '时间：{time}（{clock}）。',
  '背景：{scene}',
  '参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服；按上面的画风绘制，不要自行改成真人照片。',
  '画面里只有{subject}一个人，没有文字、水印、边框。',
].join('\n');

/**
 * 内置默认模板（空镜，没开自拍时用）。
 *
 * 「画面里没有人物」是上游空镜的硬纪律，模板接管后必须自己守住 ——
 * 少了这一句，模型很爱往风景里塞一个陌生人。
 */
const DEFAULT_SCENE_PROMPT = [
  '画风：{style}',
  '{scene}',
  '时间：{time}（{clock}）。',
  '画面里没有人物，没有文字，没有水印，没有边框。',
].join('\n');

/**
 * 内置默认模板（Grok / xAI）。只在形状是 `grok` 且用户没填任何模板时用。
 *
 * 为什么不复用上面那份：xAI 的 Image Prompting Guide
 * （https://docs.x.ai/developers/model-capabilities/images/prompting-guide）明确说编辑请求要
 * **先说要改什么，再一句话锁定主体/机位/道具**；开头就写「keep everything」几乎不动，
 * 而把一整份新场景描述粘进 edit 会「重排场景」（人脸漂移、道具变双、一个物体变成相似物）。
 * 通用模板里那一长串「不要换脸、不要变成陌生人、没有文字水印边框」在它身上是负资产 ——
 * 官方原话是长 avoid 列表很容易被忽略，还把 prompt 花在模型本来不会画的东西上。
 * 所以这份只留一条负面，其余全部改成正面描述。
 */
const DEFAULT_GROK_PROMPT = [
  '把{subject}放进这个场景：{scene}。改成手机前置镜头的近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。',
  '保持参考图中{subject}的五官、脸型、发型、肤色、年龄和气质完全一致，是同一个人；只重画背景和姿态，不要沿用参考图里的衣服与场景。',
  '画风：{style}',
  '时间：{time}（当地 {clock}），光线按这个时段来。',
  '画面里只有{subject}一个人。',
].join('\n');

/** 渲染提示词时要用到的最小配置（自拍和空镜共用一套规则）。 */
export interface PromptRenderOptions {
  readonly subject: string;
  readonly promptTemplate: string;
  readonly style?: string;
}

/** 模板里的「画风标签行」：整行只剩「画风：」这种空值残骸时删掉它。 */
const EMPTY_STYLE_LINE = /^[^：:\n]*：\s*$/;

/** `image_style` 里的 `none` 表示「一个字都别提风格」。 */
export function normalizeStyle(style?: string): string {
  const raw = (style ?? '').trim();
  return raw.toLowerCase() === 'none' ? '' : raw;
}

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

/**
 * 把上游的场景描述渲染成最终发给接口的提示词 —— 自拍和空镜共用这一套规则。
 *
 * 规则按顺序：
 * 1. 剥掉只属于「写实空镜」的措辞（默认前缀、没有人物、路过的人、胶片质感），
 *    以及**用户自己填的画风前缀** —— 画风要靠 `{style}` 当一级约束，
 *    留在 `背景：` 里只是半句修饰，模型会按模板主体的「照片质感」走。
 * 2. 逐行渲染 `{style}`：风格留空时，整行只剩「画风：」这种残骸的直接删掉。
 * 3. 老模板没写 `{style}` / `{time}` / `{clock}` 时自动补到末尾，升级即生效，
 *    不用用户去改配置里那段文本。
 */
export function renderImagePrompt(
  original: string,
  opts: PromptRenderOptions,
  clock?: string,
): string {
  const style = normalizeStyle(opts.style);
  const lead = style ? `${style}：` : '';
  const scene = original
    .replace(/^一张真实旅行照片：/, '')
    .replace(NO_PEOPLE, '')
    .replace(PASSERBY, '')
    .replace(FILM, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(new RegExp(`^${escapePattern(lead)}`), '');
  const subject = opts.subject.trim() || '她本人';
  const template = opts.promptTemplate.trim() || DEFAULT_PROMPT;
  const time = describeTime(clock);
  const hasStyle = template.includes('{style}');
  // 先按行处理 {style}：风格为空时不能让「画风：」这种空标签行留在提示词里。
  const styled = template
    .split('\n')
    .map((line) => (line.includes('{style}') ? line.replaceAll('{style}', style) : line))
    .filter((line) => !(style === '' && EMPTY_STYLE_LINE.test(line.trim())))
    .join('\n');
  let prompt = styled
    .replaceAll('{scene}', scene)
    .replaceAll('{subject}', subject)
    .replaceAll('{time}', time.label)
    .replaceAll('{clock}', time.clock);
  // 老模板没有这两个占位符：把时间补在末尾，保证升级后立刻生效。
  if (!template.includes('{time}') && !template.includes('{clock}')) {
    prompt += `\n时间：${time.label}（${time.clock}）。`;
  }
  // 老模板也没写 {style}：画风补在末尾，否则「画面风格」对这条路径依然是空的。
  if (style && !hasStyle) {
    prompt += `\n画风：${style}`;
  }
  return prompt.trim();
}

/** 兼容旧名字：外部测试和调用方一直在用 `buildSelfiePrompt`。 */
export const buildSelfiePrompt = renderImagePrompt;

/** 空镜（没开自拍）时的默认模板。 */
export const DEFAULT_SCENE_TEMPLATE = DEFAULT_SCENE_PROMPT;
/** 出镜自拍时的默认模板；测试和跨语言一致性检查要用它。 */
export const DEFAULT_SELFIE_TEMPLATE = DEFAULT_PROMPT;
/**
 * 形状为 `grok` 时的默认模板（编辑型提示词）。
 *
 * 和 `plugin/.../defaults.py` 的 `DEFAULT_GROK_PROMPT` 逐字一致，由测试守住。
 */
export const DEFAULT_GROK_TEMPLATE = DEFAULT_GROK_PROMPT;

/**
 * 旧版的内置默认模板。
 *
 * 它早就不生效了，但可能还躺在用户的 `selfie_prompt` / `image_prompt_template` 字段里
 * （插件的 `_normalize_image_prompt` 认的就是这份文本）。要判断「这串字到底是不是用户自己写的」，
 * 必须把它也算进去，否则升级过两轮的老用户会被当成「自定义过模板」，形状专属的默认永远轮不到。
 * 与 `plugin/.../defaults.py` 的 `LEGACY_SELFIE_PROMPT` 保持一致。
 */
export const LEGACY_SELFIE_TEMPLATE = [
  '一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。',
  '时间：{time}（{clock}）。',
  '背景：{scene}',
  '参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服。',
  '真实手机自拍质感，自然光，轻微手持感；画面里只有{subject}一个人，没有文字、水印、边框。',
].join('\n');

/**
 * 「这串模板文本是我们自己写进配置字段的默认值」吗？空串也算。
 *
 * 为什么必须认出来：`_conf_schema.json` 的默认值和插件迁移都会把通用模板**落进**
 * `image_prompt_template`，字段于是几乎永远非空。按「非空就是用户写的」来判断，
 * Grok 那份编辑型默认模板一次都不会生效 —— 它照样吃那串长负面清单，效果差异却没人能解释。
 * 认成内置默认不等于改用户配置：字段里的原文一个字都不动，只是换用哪份默认。
 */
export function isBuiltInTemplate(value: string): boolean {
  const text = (value ?? '').trim();
  if (!text) return true;
  return [DEFAULT_PROMPT, DEFAULT_GROK_PROMPT, LEGACY_SELFIE_TEMPLATE].some(
    (template) => template.trim() === text,
  );
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 安装生图代理。
 *
 * 普通空镜：套了「生图提示词模板」就先改写提示词，再把 `model` 换成列表中的下一个重发，
 *   成功就原样返回；
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
  /*
   * 空镜模板：开关打开且真填了模板才改写提示词。关掉就回到老行为 ——
   * 上游 `photoPrompt()` 发什么就发什么，一个字的模板都不套。
   */
  const scene = opts.scene && opts.scene.enabled === true && opts.scene.promptTemplate.trim()
    ? opts.scene
    : null;
  const compat = opts.compat ?? {};
  const compatActive = compat.noResponseFormat === true || compat.noSize === true;
  /*
   * 空镜这条路的形状。自拍可能指向另一家服务商（`selfie_api` 单独指云端），
   * 所以自拍那份用自己的 `api` 再解析一次，两者不共用。
   */
  /*
   * 形状按**每次尝试用的模型**解析（面板留 `auto` 时）。
   *
   * 为什么不按接口地址：中转站一个域名后面挂着 xAI、OpenAI、通义、豆包几十种模型，
   * 地址什么也说明不了；模型名直接说得出这次该用哪种写法。顺带的好处是
   * 「`grok-imagine-image` 主 + `gpt-image-*` 兜底」这种混合降级链也能各用各的形状。
   * 面板里显式选了某个形状就全局照办，不再看模型名。
   *
   * 自拍与空镜分开解析：`selfie_api` 常常单独指向另一家服务商，两者的接口地址不是一个。
   */
  const sceneInput: ShapeInput = opts.shape ?? {};
  const shapeFor = (input: ShapeInput, model: string): ResolvedShape =>
    resolveImageShape(shapeIsAuto(input.shape) ? { ...input, model } : input);
  const sceneShapes = models.length
    ? models.map((model) => shapeFor(sceneInput, model))
    : [shapeFor(sceneInput, '')];
  const selfieShapes = selfie
    ? (modelListOf(selfie.model).length ? modelListOf(selfie.model) : [''])
      .map((model) => shapeFor(selfie, model))
    : [];
  // 候选里可能出现 grok 就多读几张参考图（多图形状才用得上），到每次尝试再按形状截断。
  const referenceCap = selfie
    ? Math.max(
      shapeIsAuto(selfie.shape) ? MAX_GROK_REFERENCES : 1,
      ...selfieShapes.map((s) => referenceLimit(s.shape)),
    )
    : 1;
  /*
   * 只有 `grok` 需要动空镜的请求体（`size`/`watermark` → `aspect_ratio`/`resolution`）；
   * 其余形状下空镜就是上游本来发的那个形状，别白拦一趟。
   */
  const shapeActive = sceneShapes.some((s) => s.shape === 'grok');
  // 自拍、空镜套模板、配了「第二个模型」、开了兼容开关或要改形状时才需要拦请求。
  if (!selfie && !scene && models.length < 2 && !compatActive && !shapeActive) return { uninstall: () => {}, fetch: fetchImpl };
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
    /*
     * 只套空镜模板、没配降级列表时也得发得出去：沿用上游原本选定的模型，
     * 只把提示词换成模板渲染的结果。
     */
    const fallbackModel = stringOf(body.model).trim() || 'gpt-image-1';
    const candidates = selfie
      ? (selfieModels.length ? selfieModels : [fallbackModel])
      : (models.length ? models : [fallbackModel]);

    let references: ReferenceImage[] = [];
    let clock: string | undefined;
    if (selfie || scene) {
      if (selfie) {
        try {
          references = await loadSelfieReferences(selfie, referenceCap, original);
        } catch (e) {
          const message = errText(e);
          log.warn(`自拍生图失败：${message}`);
          return jsonResponse({ error: { message } }, 502);
        }
      }
      try {
        clock = (await opts.clock?.()) ?? undefined;
      } catch {
        // 取不到当地时间只影响描述词，用本机时间兜底即可，不让生图失败。
        clock = undefined;
      }
    }

    const scenePrompt = scene
      ? renderImagePrompt(prompt, {
        subject: scene.subject ?? '',
        promptTemplate: scene.promptTemplate,
        style: scene.style,
      }, clock)
      : prompt;
    if (scene && !selfie) logPrompt(log, 'scene', scenePrompt);

    const failures: string[] = [];
    for (const model of candidates) {
      try {
        if (selfie) {
          // 每换一个模型都重新认一次形状，参考图也按那个形状截断。
          const attempt = shapeFor(selfie, model);
          const result = await generateSelfieWithModel(
            selfie, attempt, model, body, prompt, original, log,
            references.slice(0, referenceLimit(attempt.shape)), clock,
          );
          return jsonResponse({ data: [result] });
        }
        const outgoing: Record<string, unknown> = scene ? { ...body, prompt: scenePrompt } : { ...body };
        if (shapeFor(sceneInput, model).shape === 'grok') applyGrokShape(outgoing, (opts.quality ?? '').trim());
        applyCompat(outgoing, compat);
        const res = await replayWithModel(
          original, url, init ?? {}, outgoing, model,
        );
        if (res.ok) return res;
        const detail = await peekError(res);
        if (shouldKeepResponse(res.status, detail)) return res;
        failures.push(`${model}：HTTP ${res.status}${detail ? `：${detail}` : ''}`);
        /*
         * 每一次失败都要单独落一行。以前只在**全部**失败时汇总一条，于是日志里
         * 看得到「第一个模型试过了」却看不到它为什么没过 —— 降级链越长越难倒回现场。
         */
        log.warn(`生图模型 ${model} 失败：HTTP ${res.status}${detail ? `：${detail}` : ''}`);
      } catch (e) {
        const why = errText(e);
        failures.push(`${model}：${why}`);
        if (selfie) log.warn(`自拍模型 ${model} 失败：${why}`);
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
  const models = modelListOf(opts.model);
  const candidates = models.length ? models : ['gpt-image-1'];
  // 形状按候选模型逐个认（面板留 auto 时）；参考图先按最宽的那个形状读，再逐次截断。
  const shapeForModel = (model: string): ResolvedShape =>
    resolveImageShape(shapeIsAuto(opts.shape) ? { ...opts, model } : opts);
  const references = await loadSelfieReferences(
    opts,
    Math.max(...candidates.map((m) => referenceLimit(shapeForModel(m).shape))),
    fetchImpl,
  );
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const failures: string[] = [];
  let result: SelfieImage | null = null;
  for (const model of candidates) {
    try {
      const attempt = shapeForModel(model);
      result = await generateSelfieWithModel(
        opts, attempt, model, {}, prompt, fetchImpl, log,
        references.slice(0, referenceLimit(attempt.shape)), clock,
      );
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
  return await imageBytesOf(result, fetchImpl, timeoutMs);
}

/**
 * 把接口回来的图落成字节：`b64_json` 直接用，`url` 下载（外链是临时的，要快）。
 *
 * 自拍与「不带参考图的汇报配图」共用这一段 —— 两条路径只是请求形状不同。
 */
async function imageBytesOf(
  result: SelfieImage,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (result.b64_json) {
    const bytes = new Uint8Array(Buffer.from(result.b64_json, 'base64'));
    const mime = sniffImage(bytes);
    if (!mime) throw new Error('生图返回的 b64 解出来不是图片');
    return { bytes, mime };
  }
  if (result.url) {
    const res = await fetchImpl(result.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`下载生成图 HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = sniffImage(bytes) ?? res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png';
    return { bytes, mime };
  }
  throw new Error('生图接口没有返回图片');
}

/** 不带参考图出图（汇报配图在「自拍关着」时走这条）需要的配置。 */
export interface SceneImageOptions {
  readonly api: string;
  readonly key: string;
  /** 生图模型名列表，按顺序降级。 */
  readonly model: string | readonly string[];
  /** 形状解析输入（`image_shape` + 地址 + 旧字段）。 */
  readonly shape?: ShapeInput;
  readonly compat?: ImageCompatOptions;
  readonly quality?: string;
  /** `image_size`：`WxH` 直接发；`3:4`/`2k` 只有 grok 形状认。 */
  readonly size?: string;
  readonly timeoutMs?: number;
  /** 空镜模板；关着「空镜套模板」就原样发上游那段场景描述。 */
  readonly scene?: SceneTemplateOptions | null;
}

/**
 * 不带参考图出一张空镜，返回字节。
 *
 * 为什么需要它：主动汇报配图以前**绑在自拍链路上**（`selfie_enabled` 关着就不配图），
 * 于是「不想每句话都塞一张她的自拍、但想配一张她眼前的景」这种很自然的用法做不到。
 * 配图从此不必自拍：开着自拍走 `generateSelfieBytes`，关着走这里 —— 同一套场景描述、
 * 同一个空镜模板（守住「画面里没有人物」）、同一套形状改写。
 */
export async function generateSceneImageBytes(
  originalPrompt: string,
  opts: SceneImageOptions,
  fetchImpl: typeof fetch = globalThis.fetch,
  log: SelfieLogger = { info: () => {}, warn: () => {} },
  clock?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const api = opts.api.trim().replace(/\/+$/, '');
  if (!api) throw new Error('生图接口没填（image_api）');
  const models = modelListOf(opts.model);
  const candidates = models.length ? models : ['gpt-image-1'];
  const shapeInput: ShapeInput = opts.shape ?? { api };
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const scene = opts.scene && opts.scene.enabled === true && opts.scene.promptTemplate.trim()
    ? opts.scene
    : null;
  const prompt = scene
    ? renderImagePrompt(originalPrompt, {
      subject: scene.subject ?? '',
      promptTemplate: scene.promptTemplate,
      style: scene.style,
    }, clock)
    : originalPrompt;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.key.trim()) headers.authorization = `Bearer ${opts.key.trim()}`;
  const failures: string[] = [];
  let image: SelfieImage | null = null;
  for (const model of candidates) {
    const shape = resolveImageShape(shapeIsAuto(shapeInput.shape) ? { ...shapeInput, model } : shapeInput);
    const payload: Record<string, unknown> = { model, prompt, n: 1 };
    const size = (opts.size ?? '').trim();
    if (shape.shape === 'grok') {
      // Grok 没有 size / watermark 这两个字段，尺寸换 aspect_ratio + resolution。
      // 空镜没有输入图，所以比例照发（不像单图编辑那样必须跟随参考图）。
      attachGrokSize(payload, size, false, (opts.quality ?? '').trim());
    } else if (size) {
      if (isWxH(size)) {
        if (opts.compat?.noSize !== true) payload.size = size;
      } else {
        log.warn(`尺寸「${size}」是比例/分辨率写法，只有 grok 形状认；这次不带 size。`);
      }
    }
    if (opts.compat?.noResponseFormat !== true) payload.response_format = 'b64_json';
    // 提示词在**发出去之前**落一行：出图不对时第一个要看的就是它（跟自拍路径一致）。
    logPrompt(log, `scene-report-${shape.shape}`, prompt);
    try {
      const res = await postJson(`${api}/images/generations`, headers, payload, fetchImpl, timeoutMs);
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        throw new Error(`生图接口 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
      }
      image = parseImagePayload(await readJson(res, log));
      break;
    } catch (e) {
      const why = errText(e);
      failures.push(`${model}：${why}`);
      log.warn(`生图模型 ${model} 失败：${why}`);
    }
  }
  if (!image) {
    throw new Error(candidates.length > 1
      ? `所有生图模型都失败了（${failures.join('；')}）`
      : failures[0] ?? '生图失败');
  }
  return await imageBytesOf(image, fetchImpl, timeoutMs);
}
/** Grok 的 `images` 最多收 5 张参考图（官方 Multi-Image Editing 文档）。 */
const MAX_GROK_REFERENCES = 5;

function dataUrlOf(ref: ReferenceImage): string {
  return `data:${ref.mime};base64,${Buffer.from(ref.bytes).toString('base64')}`;
}

/** 只有 Grok 吃多张参考图；别的形状认第一张就够，多读几张只是白读一遍文件。 */
function referenceLimit(shape: ImageShape): number {
  return shape === 'grok' ? MAX_GROK_REFERENCES : 1;
}

/**
 * 把面板里的「尺寸」翻成 Grok 认的参数挂到请求体上。
 *
 * `singleEdit` = 「单张参考图的编辑请求」：官方文档明确说这种情况比例总是从输入图推，
 * **不要**设 `aspect_ratio`；只有多参考图时才需要指定（否则跟随第一张）。
 * 不带参考图的 `/images/generations` 按 `singleEdit=false` 走，比例照发。
 */
function attachGrokSize(
  payload: Record<string, unknown>,
  size: string,
  singleEdit: boolean,
  quality: string,
): void {
  const { aspectRatio, resolution } = grokSizeOf(size);
  if (aspectRatio && !singleEdit) payload.aspect_ratio = aspectRatio;
  if (resolution) payload.resolution = resolution;
  if (quality) payload.quality = quality;
}

/**
 * 空镜（不带参考图的 generations）换成 Grok 形状。
 *
 * Grok 的请求体里**没有** `size`，也没有 `watermark`（那是上游为会烧「AI生成」的服务商
 * 准备的一档）。上游的 400 阶梯只会**删**字段，学不会「换成 `aspect_ratio` + `resolution`」
 * 这件事，所以在这里一次改对，省掉两轮注定失败的请求。
 */
function applyGrokShape(payload: Record<string, unknown>, quality: string): void {
  const size = stringOf(payload.size) || stringOf(payload.image_size);
  delete payload.size;
  delete payload.image_size;
  delete payload.watermark;
  attachGrokSize(payload, size, false, quality);
}

/**
 * 连不上云端接口时的提示。
 *
 * Node 的 `fetch`（undici）**不看** `HTTP(S)_PROXY`，要 `NODE_USE_ENV_PROXY=1`（Node 24+）
 * 才走代理。这个坑不写出来，看到 `fetch failed` 的人只会去怀疑密钥和模型名。
 */
function proxyHint(api: string): string {
  const host = hostOf(api);
  if (!host || /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(host)) return '';
  if (process.env.NODE_USE_ENV_PROXY) return '';
  return '；如果根本没连上（不是接口回的错），注意 Node 的 fetch 默认不走系统代理：'
    + '给 AstrBot 进程设 HTTPS_PROXY=http://127.0.0.1:端口 并加 NODE_USE_ENV_PROXY=1（Node 24+）';
}

/** 发 JSON；网络级错误补一句代理提示（形状类错误服务端会自己回 4xx，不用我们猜）。 */
async function postJsonWithHint(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  api: string,
): Promise<Response> {
  try {
    return await postJson(url, headers, payload, fetchImpl, timeoutMs);
  } catch (e) {
    const hint = proxyHint(api);
    throw hint ? new Error(`${errText(e)}${hint}`) : e;
  }
}

/** 用一个模型生成一张自拍。失败会抛错，由调用方决定要不要换下一个模型。 */
async function generateSelfieWithModel(
  opts: SelfieOptions,
  shape: ResolvedShape,
  model: string,
  upstreamBody: Record<string, unknown>,
  originalPrompt: string,
  fetchImpl: typeof fetch,
  log: SelfieLogger,
  references: ReferenceImage[],
  clock?: string,
): Promise<SelfieImage> {
  const api = opts.api.trim().replace(/\/+$/, '');
  if (!api) throw new Error('自拍生图接口没填（selfie_api / image_api）');
  if (!references.length) throw new Error('没有参考图：请在插件配置里上传 selfie_reference');
  const reference = references[0]!;
  const prompt = renderImagePrompt(originalPrompt, opts, clock);
  logPrompt(log, `selfie-${shape.shape}`, prompt);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let size = opts.size.trim() || stringOf(upstreamBody.size) || '1024x1024';
  if (shape.shape !== 'grok' && !isWxH(size)) {
    log.warn(`尺寸「${size}」是比例/分辨率写法，只有 grok 形状认；这次不带 size，用服务商默认尺寸。`);
    size = '';
  }
  const headers: Record<string, string> = {};
  if (opts.key.trim()) headers.authorization = `Bearer ${opts.key.trim()}`;

  if (shape.shape === 'wan') {
    return await generateNative(opts, api, model, size, prompt, reference, headers, fetchImpl, log, timeoutMs);
  }

  /*
   * Grok（xAI）：`/images/edits` 只收 `application/json`，参考图必须是**对象**
   * （单图 `image:{url}`，多图 `images:[{url},…]`，两者互斥）。顶层放 `image_url` 字符串
   * 是 OpenAI 那一套，Grok 不认 —— 最坏的情况是它收下请求、把不认识的字段丢掉，
   * 照样 200 出一张和参考图毫无关系的图，比直接报错难查得多。
   *
   * `type:"image_url"` 是官方 curl 示例里带的字段，照抄（`url` 才是 schema 里的字段）。
   */
  if (shape.shape === 'grok') {
    const images = references.map((ref) => ({ url: dataUrlOf(ref), type: 'image_url' }));
    const payload: Record<string, unknown> = { model, prompt, n: 1 };
    if (images.length === 1) payload.image = images[0];
    else payload.images = images;
    attachGrokSize(payload, size, images.length === 1, (opts.quality ?? '').trim());
    if (opts.noResponseFormat !== true) payload.response_format = 'b64_json';
    const res = await postJsonWithHint(`${api}/images/edits`, headers, payload, fetchImpl, timeoutMs, api);
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`自拍接口 HTTP ${res.status}${detail ? `：${detail}` : ''}${proxyHint(api)}`);
    }
    log.info(`自拍接口响应：HTTP ${res.status}（grok），content-length=${res.headers.get('content-length') ?? '?'}`);
    const image = parseImagePayload(await readJson(res, log));
    logSelfieImage(image, log);
    return image;
  }

  if (shape.shape === 'generation') {
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      [shape.imageField]: shape.imageField === 'image'
        ? Buffer.from(reference.bytes).toString('base64')
        : dataUrlOf(reference),
    };
    applyCompat(payload, opts);
    const res = await postJson(`${api}/images/generations`, headers, payload, fetchImpl, timeoutMs);
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`自拍接口 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
    }
    log.info(`自拍接口响应：HTTP ${res.status}（generation），content-length=${res.headers.get('content-length') ?? '?'}`);
    const image = parseImagePayload(await readJson(res, log));
    logSelfieImage(image, log);
    return image;
  }

  /*
   * 剩下两种形状都是打编辑接口：
   *   - `openai`：multipart（OpenAI 原生 /images/edits 只认这个），失败再按错误内容兜底一次 JSON；
   *   - `relay`：直接 JSON + data URL（不少中转站/上游只认 application/json，multipart 直接 415/502），
   *     省掉那一轮注定失败的 multipart。`relay` 就是旧的 `selfie_edit_json=开`。
   */
  const editField = shape.imageField;
  const editImage = editField === 'image'
    ? Buffer.from(reference.bytes).toString('base64')
    : dataUrlOf(reference);
  const editJsonBody = (): Record<string, unknown> => {
    const jsonBody: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      [editField]: editImage,
    };
    if (size && opts.noSize !== true) jsonBody.size = size;
    if (opts.noResponseFormat !== true) jsonBody.response_format = 'b64_json';
    return jsonBody;
  };
  const postEditJson = (): Promise<Response> =>
    postJson(`${api}/images/edits`, headers, editJsonBody(), fetchImpl, timeoutMs);

  let res: Response;
  if (shape.shape === 'relay') {
    res = await postEditJson();
  } else {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', prompt);
    form.set('n', '1');
    if (size && opts.noSize !== true) form.set('size', size);
    if (opts.noResponseFormat !== true) form.set('response_format', 'b64_json');
    form.set('image', new Blob([reference.bytes], { type: reference.mime }), reference.name);
    res = await fetchImpl(`${api}/images/edits`, { method: 'POST', headers, body: form });
    /*
     * 415：对方明确不收 multipart。
     * 5xx：中转站把上游的「形状不对」包成了 502/500，正文里往往看不出原因，也值得换一次 JSON。
     * 400/422：只有正文点名 multipart / content-type / image 时才换，避免把真正的参数错误重试一遍。
     */
    const retryable = res.status === 415
      || res.status >= 500
      || res.status === 400
      || res.status === 422;
    if (retryable) {
      const peek = await res.clone().text().catch(() => '');
      if (res.status >= 500 || res.status === 415
        || /multipart|content-type|application\/json|image|图片/i.test(peek)) {
        res = await postEditJson();
      }
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

/**
 * 读参考图。
 *
 * 只有 `grok` 会读到多张（上限 5，见 `referenceLimit`）：它的 `images` 数组能把几张
 * 不同角度/表情的正脸一起喂进去，这是「每次都是同一个人」最省事的办法。
 * 其余形状照旧只吃第一张，行为不变。
 */
async function loadSelfieReferences(
  opts: SelfieOptions,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<ReferenceImage[]> {
  const refs = opts.references.filter(Boolean).slice(0, Math.max(1, limit));
  if (!refs.length) throw new Error('没有参考图：请在插件配置里上传 selfie_reference');
  const out: ReferenceImage[] = [];
  for (const ref of refs) out.push(await loadReference(ref, fetchImpl));
  return out;
}

/**
 * 按兼容开关删掉请求体里的字段。
 *
 * 只动 `response_format` / `size` 两个：前者有的上游不认、后者有的上游只收自己的默认尺寸。
 * 其余字段（model/prompt/n/参考图）原样保留。
 */
function applyCompat(payload: Record<string, unknown>, opts: ImageCompatOptions): void {
  if (opts.noResponseFormat === true) delete payload.response_format;
  if (opts.noSize === true) delete payload.size;
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
  timeoutMs = 120_000,
): Promise<{ b64_json?: string; url?: string }> {
  // 阿里百炼原生万相端点。selfie_api 可以是 compatible-mode 地址，取 origin 后拼原生路径。
  const nativeUrl = (opts.nativeUrl ?? '').trim()
    || `${new URL(api).origin}/api/v1/services/aigc/multimodal-generation/generation`;
  const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString('base64')}`;
  const parameters: Record<string, unknown> = {
    n: 1,
    watermark: false,
    thinking_mode: false,
  };
  if (size && opts.noSize !== true) parameters.size = nativeSize(size);
  const payload = {
    model,
    input: {
      messages: [{
        role: 'user',
        content: [{ image: dataUrl }, { text: prompt }],
      }],
    },
    parameters,
  };
  const res = await postJson(nativeUrl, headers, payload, fetchImpl, timeoutMs);
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
  timeoutMs = 120_000,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
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

/**
 * 把真正发给接口的提示词写进日志。
 *
 * 只记这一条就能回答「为什么图是真人画风」这类问题 —— 以前日志里只有
 * `自拍接口响应：HTTP 200`，画风不对时全靠读代码猜。折成一行、截到 400 字，
 * 免得把 sidecar.log 刷成提示词转储。
 */
function logPrompt(log: SelfieLogger, kind: string, prompt: string): void {
  log.info(`生图提示词（${kind}）：${prompt.replace(/\s+/g, ' ').slice(0, 400)}`);
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
