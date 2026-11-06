/**
 * ComfyUI —— 本地生图那条路。
 *
 * ## 为什么不把 ComfyUI 塞进 OpenAI 那个函数
 *
 * 两者的请求形状毫无关系：
 *
 * ```
 * OpenAI:   POST {base}/images/generations   body = {model, prompt, size, n}
 *           → 一次返回 {data:[{b64_json|url}]}
 *
 * ComfyUI:  POST {base}/prompt                body = {prompt: <整份 workflow JSON>}
 *           → {prompt_id}（图还早）
 *           → 轮询 GET {base}/history/{id}   直到出现 outputs
 *           → GET {base}/view?filename=…     才开始传图片字节
 * ```
 *
 * 提示词在 ComfyUI 里**不是请求参数**，它是 workflow 里某个节点的 `inputs.text`；
 * 尺寸同理（`EmptyLatentImage` 的 width/height）。所以「贴自定义工作流」不是偷懒的
 * 设计，是唯一能同时支持 LoRA、ControlNet、二次元底模、双采样器这些玩法的做法 ——
 * 任何硬编码的参数集都覆盖不到。
 *
 * ## 三条纪律
 *
 * 1. **协议必须由人明确选。** 自动猜协议最坏：猜错就是静默卡住，或者更糟 ——
 *    把提示词写进负面提示，出来一张畸形图还不报错。
 * 2. **找不准提示词节点就报错，不许瞎猜。** 报错他改一次就好；猜错他要排查半天。
 * 3. **尺寸不动。** workflow 里的尺寸是用户调过的：SD1.5 用 512、SDXL 用 1024，
 *    硬塞一个 1024x1024 进 SD1.5 的工作流，出来是双头。这个模块只改文字。
 */

import { existsSync, readFileSync } from 'node:fs';
import { sniffImage, type PhotoBytes } from './photo.ts';

export interface ComfyRequest {
  /** ComfyUI 的根地址，如 `http://127.0.0.1:8188`。 */
  readonly api: string;
  /** workflow 的 JSON 原文（ComfyUI 里「Save (API Format)」导出的那份）。 */
  readonly workflow: string;
  /** 提示词节点 id。留空 = 自动找（找不准会报错，不会硬塞）。 */
  readonly promptNode?: string;
  readonly prompt: string;
  /**
   * 负向提示词（2026-11-06 加的）。
   *
   * 一位用户来信：「小宠在婺源，每次生成都有油菜花，但此季节不该有；
   * 目前只有正向提示词节点入口，无法排除不该存在的景观」。
   *
   * 留空 = 什么都不写，workflow 里原来那串负向保持不变。
   */
  readonly negative?: string;
  /** 负向节点 id。留空 = 自动找（见 `findNegativeNode`）。 */
  readonly negativeNode?: string;
  /**
   * 出图尺寸 `宽x高`，如 `1664x928`。留空 = workflow 里原来写死的尺寸。
   *
   * 2026-11-04 加的。原来是「一个字都不动 workflow」—— 那是为了不破坏别人调好的
   * LoRA/步数/采样器。但尺寸是另一回事：方形和 16:9 出来的东西**像不像照片**
   * 差别极大，而它恰好是 workflow 里唯一该让用户改、改了也不影响画质的参数。
   */
  readonly size?: string;
  /** 反代加了鉴权才要。本地 ComfyUI 一般是空的。 */
  readonly key?: string;
  readonly timeoutMs?: number;
}

/**
 * 等一张图出来的上限。
 *
 * 给得比云端宽一倍：本地首次拍要加载几 GB 的模型，几十秒是常态；
 * 而且这里等的是**真正画完**，不同于云端「请求已受理」。
 * 再长就不该等了 —— 用户会以为卡死。
 */
const COMFY_TIMEOUT_MS = 180_000;
/** 轮询间隔。ComfyUI 自己的执行粒度就是几百毫秒，再密只是空转。 */
const POLL_MS = 700;

/**
 * 把用户填的地址收拾成可用的根地址。
 *
 * 三种填法都会发生（2026-11-04 记过同族坑）：
 * 用户从浏览器地址栏复制 `http://127.0.0.1:8188/`、从文档复制完整
 * `http://127.0.0.1:8188/prompt`、或者干脆手打忘了协议头。
 * 后一种不做自动补 —— 猜错了会连到一个不相干的地方，比明确报错糟。
 */
export function normalizeComfyBase(raw: string): string {
  const base = raw.trim().replace(/\/+$/, '');
  // 用户把接口路径也贴进来了：程序自己会拼，多一段就变成 /prompt/prompt
  return base.replace(/\/prompt$/i, '');
}

/**
 * 解析 workflow 文本。
 *
 * ComfyUI 有两种导出：界面上「Save」给的是 `{nodes:[…], links:[…]}`（UI 格式），
 * 「Save (API Format)」给的是 `{ "6": {class_type, inputs}, … }`（API 格式）。
 * **只有后者能提交给 /prompt**。拿前者去发会得到一个看不出所以然的 400，
 * 所以这里直接说清楚他该点哪个菜单。
 */
export function parseWorkflow(text: string): Record<string, unknown> {
  let raw = (text ?? '').trim();
  if (!raw) throw new Error('还没粘 ComfyUI 的 workflow');
  /*
   * 两种都收：粘进来的 JSON 原文，或者设置页里用「选择文件」挑的一个 .json 路径。
   *
   * 2026-11-04 Mr.Q 要求「工作流直接能拖进来」—— 宿主那边不支持拖放，
   * 但 schema 的 `x-path` 能给出一个文件选择按钮。选了之后配置里存的是**路径**
   * 而不是内容，所以这里要负责读回来。
   *
   * 判据用「首字符是不是 {」而不是「像不像路径」：JSON 一定以 { 开头，
   * 而 Windows 路径不可能以 { 开头。反过来判断（路径优先）会把
   * 恰好长得像路径的 JSON 当成文件去读。
   */
  if (!/^[\[{]/.test(raw) && !raw.includes('\n') && raw.length < 1024) {
    try {
      if (existsSync(raw)) raw = readFileSync(raw, 'utf8').trim();
      else throw new Error('not found');
    } catch {
      throw new Error(
        `「ComfyUI 工作流」填的是一个路径，但这个文件打不开：${raw}。`
        + '要么在设置页点「选择文件」重新挑一份，要么把 JSON 整份粘进来',
      );
    }
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`workflow 不是合法 JSON（${why}）。请在 ComfyUI 里用「Save (API Format)」导出，再整份粘进来`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('workflow 的顶层应该是一个对象（`{"节点id": {...}}`）');
  }
  const obj = data as Record<string, unknown>;
  // UI 格式的指纹：顶层有 nodes 数组
  if (Array.isArray(obj.nodes)) {
    throw new Error('这是 ComfyUI 的界面格式（带 nodes/links），提交不了。请改用「Save (API Format)」导出');
  }
  const ids = Object.keys(obj);
  if (!ids.length) throw new Error('workflow 是空的');
  const looksApi = ids.some((id) => {
    const n = obj[id];
    return !!n && typeof n === 'object' && typeof (n as { class_type?: unknown }).class_type === 'string';
  });
  if (!looksApi) {
    throw new Error('workflow 里没有 class_type 字段 —— 这不像 ComfyUI 的 API 格式，请用「Save (API Format)」重新导出');
  }
  return obj;
}

interface ComfyNode {
  class_type?: unknown;
  inputs?: Record<string, unknown>;
}

const nodeOf = (wf: Record<string, unknown>, id: string): ComfyNode | null => {
  const n = wf[id];
  return n && typeof n === 'object' ? (n as ComfyNode) : null;
};

const classOf = (n: ComfyNode | null): string =>
  typeof n?.class_type === 'string' ? n.class_type : '';

/** 一个输入值如果是连线，形状是 `[来源节点id, 输出序号]`。 */
function linkOf(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length) return null;
  const id = value[0];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

/** 这个节点的 `inputs.text`（或 SDXL 的 text_g/text_l）里有没有可写的文字。 */
function hasText(n: ComfyNode | null): boolean {
  const i = n?.inputs;
  if (!i) return false;
  return typeof i.text === 'string' || typeof i.text_g === 'string' || typeof i.text_l === 'string';
}

/**
 * 找正向提示词节点。
 *
 * **不能只按 class_type 找。** 默认工作流里 CLIPTextEncode 有两个（正向 6、负向 7），
 * 谁是正向只有连到 KSampler 的哪根线说了算。按「第一个找到的」取，
 * 有一半机会把整段风景描述写进负面提示 —— 出来是一张黑图，而且零报错。
 *
 * 所以顺序是：
 *   1. 从采样器的 `inputs.positive` 顺着 conditioning 链往下挖，挖到写字的节点为止；
 *   2. 挖不出来（自定义节点的连线形状不认识），退一步：全图只有一个写字的节点就用它；
 *   3. 还不行返回 null，让上层报错让用户填节点 id。
 *
 * 宁可报错，不要猜。
 */
export function findPromptNode(wf: Record<string, unknown>): string | null {
  const ids = Object.keys(wf);

  // 1. 顺着采样器的正向前提找
  for (const id of ids) {
    const n = nodeOf(wf, id);
    if (!/^KSampler/i.test(classOf(n))) continue;
    const start = linkOf(n?.inputs?.positive);
    if (!start) continue;
    const found = walk(wf, start, 0);
    if (found) return found;
  }

  // 2. 全图只有一个能写字的地方
  const writers = ids.filter((id) => hasText(nodeOf(wf, id)));
  if (writers.length === 1) return writers[0]!;

  return null;
}

/**
 * 顺着 conditioning 链往下走。深度限 5：正常工作流两三跳就到，
 * 再多说明是别的结构，继续挖只会挖错。
 */
function walk(wf: Record<string, unknown>, id: string, depth: number): string | null {
  if (depth > 5) return null;
  const n = nodeOf(wf, id);
  if (!n) return null;
  if (hasText(n)) return id;
  const inputs = n.inputs;
  if (!inputs) return null;
  for (const value of Object.values(inputs)) {
    const next = linkOf(value);
    if (!next || next === id) continue;
    const found = walk(wf, next, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 把提示词写进 workflow，**返回一份新的**。
 *
 * 不改入参：同一份 workflow 一次配置会用来拍很多张，改坏了下一张就带着上一张的
 * 文字。这类「悄悄累积」的错误最难查。
 */
/**
 * 找出负向提示词的那个节点。
 *
 * 办法只有一个：**看谁被某个节点的 `negative` 输入指着**，且那个节点有 `text`。
 * 这比按 class_type 猜靠谱 —— 负向节点和正向节点是同一个类（CLIPTextEncode），
 * 唯一区别就是「被谁指着」。
 *
 * 找不到返回 null。不是每份 workflow 都有负向（有的把 CFG 调成 1 就删了），
 * 那是合法配置，不该报错。
 */
export function findNegativeNode(wf: Record<string, unknown>): string | null {
  for (const value of Object.values(wf)) {
    if (!value || typeof value !== 'object') continue;
    const inputs = (value as Record<string, unknown>).inputs;
    if (!inputs || typeof inputs !== 'object') continue;
    const neg = (inputs as Record<string, unknown>).negative;
    if (!Array.isArray(neg) || typeof neg[0] !== 'string') continue;
    const src = wf[neg[0]];
    if (!src || typeof src !== 'object') continue;
    const si = (src as Record<string, unknown>).inputs;
    if (!si || typeof si !== 'object') continue;
    const o = si as Record<string, unknown>;
    if (typeof o.text === 'string' || typeof o.text_g === 'string') return neg[0];
  }
  return null;
}

/** 把负向提示词写进指定节点。和 `withPrompt` 一样不改入参。 */
export function withNegative(
  wf: Record<string, unknown>,
  nodeId: string,
  negative: string,
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(wf)) as Record<string, unknown>;
  const n = nodeOf(copy, nodeId);
  if (!n) throw new Error(`workflow 里没有 id 为「${nodeId}」的节点`);
  const inputs = (n.inputs ??= {});
  if (typeof inputs.text_g === 'string') inputs.text_g = negative;
  if (typeof inputs.text_l === 'string') inputs.text_l = negative;
  if (typeof inputs.text === 'string' || !('text_g' in inputs)) inputs.text = negative;
  return copy;
}

export function withPrompt(
  wf: Record<string, unknown>,
  nodeId: string,
  prompt: string,
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(wf)) as Record<string, unknown>;
  const n = nodeOf(copy, nodeId);
  if (!n) throw new Error(`workflow 里没有 id 为「${nodeId}」的节点`);
  const inputs = (n.inputs ??= {});
  // SDXL 那一支文字分长短两份，两份都写 —— 只写一份出来的画面会缺描述。
  if (typeof inputs.text_g === 'string' || typeof inputs.text_l === 'string') {
    if (typeof inputs.text_g === 'string') inputs.text_g = prompt;
    if (typeof inputs.text_l === 'string') inputs.text_l = prompt;
  }
  if (typeof inputs.text === 'string' || !('text_g' in inputs)) inputs.text = prompt;
  return copy;
}

/**
 * `1664x928` → `[1664, 928]`。认不出返回 null。
 *
 * 分隔符三种都认（`x`、`×`、`*`）：用户从别人那儿抄参数时会带上全角乘号。
 */
export function parseSize(size: string | undefined): [number, number] | null {
  const m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec((size ?? '').trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  // 太小的画不出来，太大的会直接吃满显存 —— 两头都拦掉，让上层报错而不是卡死。
  if (w < 256 || h < 256 || w > 4096 || h > 4096) return null;
  return [w, h];
}

/**
 * 把尺寸写进 workflow 里所有「根 latent 节点」。返回改了几个。
 *
 * ## 认哪个节点
 *
 * 判据是「**有 width/height，且一个上游连接都没有**」：
 * - 根 latent 节点（`EmptyLatentImage` / `EmptySD3LatentImage` / `EmptySDXL`…
 *   还有一堆自定义节点）的 inputs 全是字面值，不引用别的节点；
 * - 放大节点（`LatentUpscale`、`ImageScale`）也有 width/height，
 *   但它的 `samples` / `image` 必然指向别的节点。
 *
 * ## 为什么是「所有根 latent」而不是「只改第一个」
 *
 * 2026-11-04 跑真机时发现的：原来注释写「只改主 latent」，实现却是全改 ——
 * 两者不一致。想清楚之后**保留全改**：
 *
 * 用户填「1664x928」的意思是「我出来的图都要这个尺寸」。工作流里如果有两条
 * 并行的出图支路（各有一个自己的 EmptyLatentImage），只改一路会得出两张
 * 尺寸不同的图，而且不报错。相比之下，「多支路各要不同尺寸」在这个扩展里
 * 不存在 —— 它只取返回的第一张图，改一路另一路就白算了。
 *
 * ## 两条都不走
 *
 * - **不按 class_type 白名单认** —— 社区工作流的 latent 节点七八种叫法，白名单永远漏，
 *   漏了的表现是「填了尺寸没生效」；
 * - **不放宽到「凡有宽高就改」** —— 把放大节点一起改成目标尺寸，会破掉工作流原本的倍率，
 *   出来尺寸不对，而且不报错。
 *
 * 返回 0 说明这份 workflow 压根没有可改的根 latent（尺寸可能写死在别处），
 * 上层据此报错，而不是假装成功。
 */
export function withSize(
  wf: Record<string, unknown>,
  width: number,
  height: number,
): number {
  let hit = 0;
  for (const node of Object.values(wf)) {
    const inputs = (node as { inputs?: Record<string, unknown> })?.inputs;
    if (!inputs) continue;
    if (typeof inputs.width !== 'number' || typeof inputs.height !== 'number') continue;
    const linked = Object.values(inputs).some(
      (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string',
    );
    if (linked) continue;
    inputs.width = width;
    inputs.height = height;
    hit += 1;
  }
  return hit;
}

/**
 * 吸附到 8 的倍数。
 *
 * VAE 下采样 8 倍，宽高不是 8 的倍数时显存能过、画面边缘会出条纹或错位 ——
 * 那种坏法不报错，只是「生成的图有点怪」，最难查。所以这里直接对齐，
 * 而不是让用户去读文档。
 */
export const align8 = (n: number): number => Math.max(8, Math.round(n / 8) * 8);

/**
 * 把 workflow 里的种子换成一个新的随机值。返回改了几个。
 *
 * ## 为什么必须换
 *
 * ComfyUI 有执行缓存：**同样的 workflow + 同样的输入 → 直接返回上次的结果，不重跑**。
 * 而 workflow 里的 seed 是个固定值（大多数模板导出就是 42），提示词又只跟
 * 「城市 / 时段 / 天气」有关 —— 于是同一个地方、同一个时段拍第二张时，
 * 缓存必然命中，**一秒就"生成"出来，而且和上一张一模一样**。
 *
 * 2026-11-04 Mr.Q 实测的原话：「点生成一张，1s 生成了 3 张」。
 * 查下来三次的输出文件都是同一个 `ComfyUI_00012_.png`，照片簿三条记录的
 * handle 也完全相同 —— 就是同一张图被返回了三次。
 *
 * 顺带一个副作用：缓存命中的「生成」只要一秒，`maybePhoto` 里那把
 * 「上一张还没拍完」的锁根本来不及挡住连点，于是点几下就是几张。
 * 种子一换，每次都要真跑一百秒，锁自然生效。
 *
 * ## 只动字面量种子
 *
 * `seed` / `noise_seed` 如果是一个数组（形如 `["12", 0]`），说明它接在别的节点上
 * （比如从「随机种子」节点连线过来），那种情况是用户自己安排的随机，不该覆盖。
 */
export function randomizeSeed(wf: Record<string, unknown>, rand: () => number = Math.random): number {
  let hit = 0;
  for (const node of Object.values(wf)) {
    const inputs = (node as { inputs?: Record<string, unknown> })?.inputs;
    if (!inputs) continue;
    for (const field of ['seed', 'noise_seed']) {
      if (typeof inputs[field] !== 'number') continue;
      // uint32 范围：ComfyUI 的 seed 是 64 位，但 32 位够用且各家都认。
      inputs[field] = Math.floor(rand() * 0x100000000);
      hit += 1;
    }
  }
  return hit;
}

/** `/history/{id}` 里有没有这个任务的结果条目。**有条目就说明执行结束了。** */export function historyEntry(history: unknown, promptId: string): unknown | null {
  if (!history || typeof history !== 'object') return null;
  const entry = (history as Record<string, unknown>)[promptId];
  return entry && typeof entry === 'object' ? entry : null;
}

/** `/history/{id}` 里挑出第一张真正落盘的图。 */
export function firstOutputImage(
  history: unknown,
  promptId: string,
): { filename: string; subfolder: string; type: string } | null {
  if (!history || typeof history !== 'object') return null;
  const entry = (history as Record<string, unknown>)[promptId];
  if (!entry || typeof entry !== 'object') return null;
  const outputs = (entry as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== 'object') return null;
  for (const out of Object.values(outputs as Record<string, unknown>)) {
    const images = (out as { images?: unknown })?.images;
    if (!Array.isArray(images)) continue;
    for (const img of images) {
      const o = img as { filename?: unknown; subfolder?: unknown; type?: unknown };
      if (typeof o?.filename !== 'string' || !o.filename) continue;
      return {
        filename: o.filename,
        subfolder: typeof o.subfolder === 'string' ? o.subfolder : '',
        // 预览节点给的是 `temp`，正式保存才是 `output`；照它说的取，别硬写。
        type: typeof o.type === 'string' && o.type ? o.type : 'output',
      };
    }
  }
  return null;
}

/** ComfyUI 执行失败时，`history` 里 `status.messages` 会带一条执行错误。 */
function executionError(history: unknown, promptId: string): string | null {
  if (!history || typeof history !== 'object') return null;
  const entry = (history as Record<string, unknown>)[promptId];
  const status = (entry as { status?: { status_str?: unknown; messages?: unknown } })?.status;
  if (!status || status.status_str !== 'error') return null;
  const msgs = Array.isArray(status.messages) ? status.messages : [];
  for (const m of msgs) {
    if (!Array.isArray(m) || m[0] !== 'execution_error') continue;
    const detail = m[1] as { node_type?: unknown; exception_message?: unknown };
    const node = typeof detail?.node_type === 'string' ? `${detail.node_type}：` : '';
    const why = typeof detail?.exception_message === 'string' ? detail.exception_message.trim() : '';
    if (why) return `${node}${why}`.slice(0, 200);
  }
  return '执行出错，但没给出原因（打开 ComfyUI 的界面能看到哪一步红了）';
}

/** 从 `/prompt` 的 400 里捞一句能照做的话。 */
/**
 * 把「Value not in list」翻译成人话。翻译不了返回 null。
 *
 * ## 为什么值得单独翻
 *
 * 2026-11-04 Mr.Q 把最初的 workflow（Z-Image Turbo）存成 pet.json 放到桌面，
 * 在设置页选了它 —— ComfyUI 回的是「节点 66：Value not in list」。
 * 这句话一个字都没说到点子上：真实原因是**那个模型文件本地没有**。
 * 用户看到这句话只会以为工作流格式坏了，然后去重新导出、去查格式，方向全错。
 *
 * ## 信息从哪来
 *
 * ComfyUI 的 400 响应里其实**已经带了答案**，只是塞在 `node_errors` 里没人看：
 *
 * ```json
 * {"node_errors":{"66":{"class_type":"UNETLoader","errors":[{
 *   "type":"value_not_in_list",
 *   "details":"unet_name: 'z_image_turbo_bf16.safetensors' not in ['Qwen_Image-Q4_K_M.gguf', ...]"
 * }]}}}
 * ```
 *
 * 那个 `not in [...]` 就是本地**实际能用**的文件列表。所以不用再问接口，
 * 直接把它捞出来摆到用户面前：要的是哪个、现在有哪些。
 */
function explainMissingModel(body: string): string | null {
  try {
    const json = JSON.parse(body) as {
      node_errors?: Record<string, { class_type?: string; errors?: { type?: string; details?: string }[] }>;
    };
    const nodes = json?.node_errors ?? {};
    for (const [nodeId, info] of Object.entries(nodes)) {
      for (const err of info?.errors ?? []) {
        if (err?.type !== 'value_not_in_list') continue;
        const details = String(err?.details ?? '');
        // 形如：unet_name: 'xxx.safetensors' not in ['a.safetensors', 'b.safetensors']
        const m = /([\w.]+)\s*:\s*'([^']+)'\s*not in\s*\[([^\]]*)\]/i.exec(details);
        if (!m) continue;
        const [, field, wanted, list] = m;
        const available = [...list.matchAll(/'([^']+)'/g)].map((x) => x[1]);
        const cls = info?.class_type ? `（${info.class_type}）` : '';
        /*
         * 列表为空要单独解释。最常见的情形不是"一个模型都没有"，而是
         * **加载器格式不对**：本地明明有 .gguf，但 workflow 用的是 UNETLoader，
         * 它只认 .safetensors/.ckpt，于是列表为空。用户看到"一个都没有"
         * 会去翻模型目录，找不到问题在哪。
         */
        const availText = available.length
          ? available.join('、')
          : `（${info?.class_type ?? '这个节点'} 下一个都没有 —— 本地要是有 .gguf，得把加载器换成 UnetLoaderGGUF；它只认 safetensors/ckpt）`;
        return `这份 workflow 要的模型文件本地没有。\n`
          + `  节点 ${nodeId}${cls} 的 ${field} 要「${wanted}」\n`
          + `  现在本地能用的：${availText}\n`
          + `改法二选一：把 workflow 里这一项换成上面能用的；`
          + `或者把「${wanted}」放进 ComfyUI 的模型目录（模型在哪个目录看它的启动日志）`;
      }
    }
  } catch { /* 不是 JSON、结构不认识 —— 交回给原来的错误处理 */ }
  return null;
}

function rejectDetail(text: string): string {  const raw = (text ?? '').slice(0, 2000);
  try {
    const o = JSON.parse(raw) as {
      error?: { message?: unknown; details?: unknown } | string;
      node_errors?: Record<string, { errors?: { message?: unknown; details?: unknown }[] }>;
    };
    const parts: string[] = [];
    if (typeof o.error === 'object' && o.error) {
      if (typeof o.error.message === 'string') parts.push(o.error.message);
      else if (typeof o.error.details === 'string') parts.push(o.error.details);
    } else if (typeof o.error === 'string') {
      parts.push(o.error);
    }
    // node_errors 才有真正的信息量：哪个节点、缺什么
    for (const [nodeId, info] of Object.entries(o.node_errors ?? {})) {
      const first = info?.errors?.[0];
      const msg = typeof first?.message === 'string' ? first.message : '';
      const detail = typeof first?.details === 'string' ? first.details : '';
      if (msg || detail) parts.push(`节点 ${nodeId}：${msg || detail}`);
    }
    const joined = parts.filter(Boolean).join('；');
    if (joined) return joined.slice(0, 200);
  } catch { /* 不是 JSON，退回纯文本 */ }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** 连接类错误的说法。这一条最常发生：服务没开、端口不对。 */
function connectError(e: unknown, api: string): Error {
  const name = e instanceof Error ? e.name : 'Error';
  if (name === 'TimeoutError') return new Error('等太久了，ComfyUI 那边没有回应');
  return new Error(`连不上 ComfyUI（${api}）。服务开着吗？地址和端口对吗？`);
}

/**
 * 拍一张 —— ComfyUI 那条路。
 *
 * 失败一律抛错并带原因。上层只写日志、不停旅行，但用户配错了得能翻到为什么。
 */
export async function shootComfy(req: ComfyRequest): Promise<PhotoBytes> {
  const base = normalizeComfyBase(req.api);
  if (!base) throw new Error('生图接口没填');

  const wf = parseWorkflow(req.workflow);

  // 节点：用户指定的优先；他填了就必须存在，不许悄悄换一个。
  let nodeId = (req.promptNode ?? '').trim();
  if (nodeId) {
    const n = nodeOf(wf, nodeId);
    if (!n) throw new Error(`「提示词节点 id」填的是 ${nodeId}，但 workflow 里没有这个节点`);
    if (!hasText(n)) throw new Error(`节点 ${nodeId}（${classOf(n)}）里没有可写的文字输入，换一个节点 id`);
  } else {
    const found = findPromptNode(wf);
    if (!found) {
      throw new Error('认不出这份 workflow 里哪个节点该写提示词。打开 workflow 看一眼那句描述写在哪个节点上，把它的 id 填进「提示词节点 id」');
    }
    nodeId = found;
  }

  let payload = withPrompt(wf, nodeId, req.prompt);
  /*
   * 负向提示词（2026-11-06）。
   *
   * **失败不致命**：找不到节点就跳过，照片照样出 —— 一张构图对了但多开了一片油菜花，
   * 远好过整张拍不出来。所以这里 try 包住，只记日志。
   */
  const neg = String(req.negative ?? '').trim();
  if (neg) {
    try {
      const negNode = String(req.negativeNode ?? '').trim() || findNegativeNode(wf);
      if (negNode) payload = withNegative(payload, negNode, neg);
    } catch {
      // workflow 里没有负向节点，或者那个 id 不存在。跳过。
    }
  }

  /*
   * 尺寸：填了就必须生效，填错了必须报出来。
   *
   * 原来这里是「不动尺寸」，所以填了个值却没反应的话，用户只会觉得「这选项没用」。
   * 现在三种情况分开说：没填（用 workflow 原值）、填了认不出（报错，别静默）、
   * 填了但 workflow 里没有可改的节点（也报错 —— 那说明这份 workflow 的尺寸
   * 是写死在别处或者用了固定分辨率模板，硬改会画错）。
   */
  const rawSize = (req.size ?? '').trim();
  if (rawSize) {
    const parsed = parseSize(rawSize);
    if (!parsed) {
      throw new Error(`「出图尺寸」填的是「${rawSize}」，认不出。要写成 1664x928 这种「宽x高」，宽高都在 256–4096 之间`);
    }
    const [w, h] = parsed;
    const changed = withSize(payload, align8(w), align8(h));
    if (changed === 0) {
      throw new Error('这份 workflow 里找不到能改尺寸的节点（没有带 width/height 的 latent 节点）。把「出图尺寸」留空，或者换一份用标准 EmptyLatentImage 的工作流');
    }
  }

  /*
   * 种子：每次都必须换。
   *
   * 不换的后果不是"图一样"这么轻 —— 是 ComfyUI **命中执行缓存，一秒返回**，
   * 于是「上一张还没拍完」那把锁来不及挡连点，点几下就往照片簿里记几条。
   * 2026-11-04 Mr.Q 一次点出了三张一样的，就是这么来的。
   */
  randomizeSeed(payload);

  const timeout = req.timeoutMs ?? COMFY_TIMEOUT_MS;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.key?.trim()) headers.authorization = `Bearer ${req.key.trim()}`;

  const send = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${base}${path}`, {
      ...init,
      headers: init?.headers ?? headers,
      signal: AbortSignal.timeout(Math.min(timeout, 60_000)),
    });

  // ---- 1. 提交 ----
  let promptId = '';
  /*
   * `ours` 标记「这个错是我们自己写的、需要原样给用户看」。
   *
   * 原来这里是靠正则 `/ComfyUI 拒了|没给 prompt_id/` 认自己的错误 —— 2026-11-04
   * 加了「模型文件本地没有」那条翻译之后，它不匹配这个正则，于是被下面的
   * `catch` 当成网络故障，最终显示成「连不上 ComfyUI」。用户会跑去查服务开没开，
   * 方向全错。文案和判据分开写，迟早不同步，所以改成显式标记。
   */
  let ours = false;
  try {
    const res = await send('/prompt', {
      method: 'POST',
      // client_id 随便给一个：同一个 client 的多次提交在它的队列里能互相区分。
      body: JSON.stringify({ prompt: payload, client_id: `coopani-${Date.now().toString(36)}` }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 「模型文件不存在」单独翻译：ComfyUI 的原话是「Value not in list」，等于没说。
      const missing = explainMissingModel(body);
      ours = true;
      if (missing) throw new Error(missing);
      const detail = rejectDetail(body);
      throw new Error(`ComfyUI 拒了这份 workflow（HTTP ${res.status}）${detail ? `：${detail}` : ''}`);
    }
    const answer = (await res.json().catch(() => null)) as { prompt_id?: unknown; error?: unknown } | null;
    promptId = typeof answer?.prompt_id === 'string' ? answer.prompt_id : '';
    if (!promptId) {
      ours = true;
      throw new Error('ComfyUI 收下了但没给 prompt_id，取不到结果');
    }
  } catch (e) {
    if (ours) throw e;
    throw connectError(e, base);
  }

  // ---- 2. 等它画完 ----
  /*
   * **判「画完了」用「history 里有没有这个 id 的条目」，不是「有没有图」。**
   *
   * 第一版拿 `firstOutputImage()` 当循环条件，于是「执行结束了但没接 Save Image」
   * 这种情况会一直等到超时，然后报「等了 180 秒还没画完」—— 而它早就画完了，
   * 缺的是一个输出节点。用户照着那句话会去查显存和队列。
   *
   * ComfyUI 的语义很干净：还在队列里时 `/history/{id}` 返回 `{}`，
   * 跑完（成功或失败）才有条目。所以条目 = 结束，有没有图另说。
   */
  const deadline = Date.now() + timeout;
  let history: unknown = {};
  for (;;) {
    try {
      const res = await send(`/history/${promptId}`);
      if (res.ok) history = await res.json();
    } catch {
      // 轮询期间偶发断连不算失败，下一轮再说
    }
    if (historyEntry(history, promptId)) break;
    if (Date.now() > deadline) {
      throw new Error(
        `等了 ${Math.round(timeout / 1000)} 秒还没画完。首次运行要加载模型，慢是正常的 —— `
        + `去 ComfyUI 界面看一眼队列，图可能会自己出来，但这次这边已经放弃等了`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const failed = executionError(history, promptId);
  if (failed) throw new Error(`ComfyUI 执行失败：${failed}`);

  // ---- 3. 取图 ----
  const img = firstOutputImage(history, promptId);
  if (!img) throw new Error('画完了但没找到图（workflow 里有没有接「Save Image」节点？）');

  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
  let bytes: Uint8Array;
  try {
    const res = await send(`/view?${q.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const why = e instanceof Error ? e.message : '未知';
    throw new Error(`图生成了但下不回来（${why}）`);
  }
  if (!bytes.length) throw new Error('下回来的图是空的');

  /*
   * 认格式。ComfyUI 的 Save Image 只写 PNG，但 Preview Image / 自定义节点可能给
   * JPEG。宿主按 mime 决定落盘扩展名，写错了他双击打不开。
   */
  const mime = sniffImage(bytes) ?? 'image/png';
  return { bytes, mime };
}
