/**
 * 生图后端：把「云端 / 本地」这一件事收成一个开关。
 *
 * ## 为什么要这一层（2026-11-14，Mr.Q 的原话）
 *
 * > 「最好一个选项点进去 UI 是云端，一个选项点进去 UI 切本地。」
 *
 * 原来要接一个云端服务商，得自己找接口地址、自己查模型 ID、自己猜尺寸 ——
 * 三样里任何一样填错，表现都是「拍不出来」，而不是「填错了」。
 * 豆包更麻烦：它的图片模型有**最低像素**，填小了直接被 400。
 *
 * 所以把「不得不填的那三项」预先写好，用户只需要选一个后端、贴一把密钥。
 *
 * ## 这一层**不做**什么
 *
 * 不接管用户已经手填的值。规则只有一条：**用户填了就以用户为准**，
 * 没填才用预设补。这样既能一键上手，也不挡住要微调的人。
 */

/** 后端：云端走 OpenAI 兼容的 `/images/generations`，本地走 ComfyUI。 */
export type ImageProtocol = 'openai' | 'comfyui';

/** 云端服务商预设。`custom` = 自己填地址和模型。 */
export type ImagePreset = 'doubao' | 'openai' | 'custom';

export interface ImageBackend {
  readonly protocol: ImageProtocol;
  readonly api: string;
  readonly model: string;
  readonly size: string;
  /**
   * 一句话说明「这次实际连的是哪儿」。
   *
   * 给日志和面板用：配置错了的时候，用户看到的第一句话应该是
   * 「你连的是 X」，而不是自己回头翻六个字段猜。
   */
  readonly note: string;
  /** 尺寸被抬到合规值时的说明；没动就是空串。 */
  readonly sizeNote: string;
}

interface Preset {
  readonly label: string;
  readonly api: string;
  readonly model: string;
  /** 没填尺寸时用它。已经按合规挑过，不是随手写的数。 */
  readonly size: string;
  /**
   * 这个模型能接受的最小像素数。0 = 没有这个限制。
   *
   * **豆包那条是真坑**：方舟的 seedream 5.0 / 4.5 最低 3,686,400 像素
   * （2560×1440），而我们默认发的是 1664×928（154 万）—— 差一半还多，必定 400。
   * 这个数字来自第三方整理页（ofox、腾讯云镜像、BytePlus 概览），
   * 官方「填写说明」是动态渲染，抓不到表格。所以这里按合规值兜底：
   * 万一官方门槛更低，抬上去也只是一张更大的图，不会失败。
   */
  readonly minPixels: number;
}

const PRESETS: Readonly<Record<Exclude<ImagePreset, 'custom'>, Preset>> = {
  doubao: {
    label: '豆包 Seedream（火山方舟）',
    api: 'https://ark.cn-beijing.volces.com/api/v3',
    /*
     * `doubao-seedream-5-0-260128` 是 5.0 标准（与 5.0 lite 同一个模型的两个名字）。
     * 想要更高分辨率或图层拆分再换 `-5-0-pro-260628`。
     */
    model: 'doubao-seedream-5-0-260128',
    size: '2048x2048',
    minPixels: 3_686_400,
  },
  openai: {
    label: 'OpenAI',
    api: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
    size: '1024x1024',
    minPixels: 0,
  },
};

/** 给配置面板和日志用：预设的中文名。 */
export function presetLabel(preset: string | undefined): string {
  if (preset === 'doubao' || preset === 'openai') return PRESETS[preset].label;
  return '自定义';
}

/**
 * 给设置面板用：这个预设会填什么；`custom` 或认不出返回 null。
 *
 * 预设的价值不在「少填几个字」，在**知道最终会连到哪儿**。所以面板要把
 * 地址、模型、尺寸三个都拿到，当 placeholder 显示出来 —— 用户不填也能看见
 * 「点了保存以后实际会用 https://ark… 和 doubao-seedream…」。
 */
export function presetDefaults(preset: string): {
  api: string;
  model: string;
  size: string;
  minPixels: number;
} | null {
  const raw = (preset ?? '').trim();
  if (raw !== 'doubao' && raw !== 'openai') return null;
  const p = PRESETS[raw];
  return { api: p.api, model: p.model, size: p.size, minPixels: p.minPixels };
}

/** 从 `宽x高` 里取像素数；认不出返回 0。 */
function pixelsOf(size: string): number {
  const m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size.trim());
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

/**
 * 把尺寸按比例抬到这个模型的最低像素以上，宽高都吸附到 8 的倍数。
 *
 * 只放大不缩小：用户要的是「至少能出图」，不是「帮我换一个尺寸」。
 * 比例保持原样 —— 换了比例就成另一张构图了。
 */
export function liftToMinPixels(size: string, minPixels: number): { size: string; lifted: boolean } {
  if (!minPixels) return { size, lifted: false };
  const px = pixelsOf(size);
  if (!px || px >= minPixels) return { size, lifted: false };
  const m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size.trim());
  if (!m) return { size, lifted: false };
  const scale = Math.sqrt(minPixels / px);
  const w = Math.ceil((Number(m[1]) * scale) / 8) * 8;
  const h = Math.ceil((Number(m[2]) * scale) / 8) * 8;
  return { size: `${w}x${h}`, lifted: true };
}

/**
 * 配置 → 实际要用的后端。
 *
 * 判定顺序有意如此：**先看 `imageProtocol`**。
 * 它是「后端」本身（云端 / 本地），`imagePreset` 只是云端内部的分支 ——
 * 如果先看预设，一个选了「豆包」但后端写着 comfyui 的配置会自相矛盾地走云端。
 */
export function resolveImageBackend(cfg: {
  readonly imageProtocol?: string;
  readonly imagePreset?: string;
  readonly imageApi?: string;
  readonly imageModel?: string;
  readonly imageSize?: string;
  readonly imageWorkflow?: string;
}, sizeOverride?: string): ImageBackend {
  const raw = (cfg.imageProtocol ?? '').trim();
  const isComfy = /^comfy/i.test(raw);

  if (isComfy) {
    const api = (cfg.imageApi ?? '').trim() || 'http://127.0.0.1:8188';
    const wf = (cfg.imageWorkflow ?? '').trim();
    return {
      protocol: 'comfyui',
      api,
      // ComfyUI 的模型写在 workflow 里，这里留空不是缺项。
      model: '',
      size: (cfg.imageSize ?? '').trim(),
      note: wf
        ? `本地 ComfyUI（${api}，workflow：${wf.split(/[\\/]/).pop() ?? wf}）`
        : `本地 ComfyUI（${api}）—— 还没选 workflow，选一个 .json 才能出图`,
      sizeNote: '',
    };
  }

  const presetName = (cfg.imagePreset ?? '').trim() as ImagePreset;
  const preset = presetName === 'doubao' || presetName === 'openai' ? PRESETS[presetName] : null;

  const api = (cfg.imageApi ?? '').trim() || preset?.api || '';
  const model = (cfg.imageModel ?? '').trim() || preset?.model || '';
  /*
   * `sizeOverride` 给「月报封面」那条路用：海报有自己的固定比例（1024x1536），
   * 不该被「出图尺寸」那一栏改掉，但仍要过最低像素这一关。
   */
  const wantSize = (sizeOverride ?? '').trim() || (cfg.imageSize ?? '').trim() || preset?.size || '';

  const fixed = wantSize && preset ? liftToMinPixels(wantSize, preset.minPixels) : { size: wantSize, lifted: false };

  const who = preset ? preset.label : '自定义云端服务';
  const note = api
    ? `云端 · ${who}（${api}${model ? `，模型 ${model}` : '，模型没填'}）`
    : `云端 · ${who} —— 服务地址没填，拍不了`;

  return {
    protocol: 'openai',
    api,
    model,
    size: fixed.size,
    note,
    sizeNote: fixed.lifted
      ? `尺寸 ${wantSize} 只有 ${pixelsOf(wantSize).toLocaleString('en-US')} 像素，`
        + `低于 ${preset?.label ?? '这个模型'} 的最低 ${(preset?.minPixels ?? 0).toLocaleString('en-US')}，`
        + `已按原比例抬到 ${fixed.size}。想自己定就在「出图尺寸」里填一个够大的。`
      : '',
  };
}
