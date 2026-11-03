/**
 * 当前这套立绘**真的**认哪些动作。
 *
 * ## 为什么要现读
 *
 * 2026-11-01 实测：她在气泡里写了「【开心, 拍拍】」，宿主回一行
 * 「当前形象的词表里没有这些标记,已略过: 拍拍」—— 只有表情变了，人没动，而且不报错。
 *
 * 根因是提示词里那张动作表是**手写的英文 id**（`walk`、`sit`、`look`），
 * 而她说中文。中文名其实也能匹配（词表里 `walk` 的 `names.zh` 是「走走/散步」），
 * 但提示词没给中文名，她只能自己造。
 *
 * 抄一份静态清单能治这一次，治不了下一次：换立绘、宿主升级、词表增删，
 * 清单立刻过期，而**过期的表现还是「人不动」，不报错**。
 * 所以这里直接读宿主包里那套立绘的 `figure.json`。
 *
 * ## 找不到怎么办
 *
 * 一定要能降级，而且**降级要看得见**：
 * 找不到就走内置的一份常见词（`FALLBACK`），同时把 `source` 标成 `fallback`，
 * 让设置页和日志能说出「这回用的是兜底清单」。
 * 静默用旧清单，等于把这个坑重新埋回去。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PetVocab {
  /** 立绘 id，如 `whale`。 */
  readonly figure: string;
  /** 可用动作的中文名（首选名 + 别名），去重。 */
  readonly actions: readonly string[];
  /** 可用表情的中文名。 */
  readonly expressions: readonly string[];
  /** `live` = 从 figure.json 读到的；`fallback` = 用了内置清单。 */
  readonly source: 'live' | 'fallback';
  /** 给日志用的一句话：读到了什么、或者为什么没读到。 */
  readonly note: string;
}

/**
 * 兜底清单：宿主自带那套（whale / coo）的交集。
 *
 * 不是给「正常情况」用的 —— 正常情况一定要读到真词表。这份只在
 * 宿主目录找不到、或 figure.json 坏了的时候顶一下，让提示词不至于空着。
 */
const FALLBACK_ACTIONS = [
  '走走', '跑', '坐下', '睡觉', '张望', '转身', '点头', '摇头', '小跳', '跳',
  '发抖', '晕', '退半步', '扑腾', '闭眼听', '站着',
];
const FALLBACK_EXPRESSIONS = [
  '平静', '开心', '喜欢', '害羞', '惊讶', '生气', '难过', '犯困', '思考',
  '得意', '嘟嘴', '担心', '认真', '慌张', '害怕', '期待', '疑惑',
];

/**
 * 宿主根目录：从数据目录往上找带 `resources/app` 的那一层。
 *
 * 为什么不用 `process.execPath`：Core 可能是 node 直接起的，也可能是 electron，
 * 两种的 execPath 指向完全不同的地方。而数据目录是**宿主管的**，
 * 它的形状（`<根>/data/home/<人>/data`）比进程路径稳定，且我们本来就拿得到。
 */
export function findHostRoot(dataDir: string): string | null {
  let dir = dataDir;
  for (let i = 0; i < 6; i++) {
    const app = join(dir, 'resources', 'app');
    if (existsSync(app)) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** 当前用的是哪套立绘。读不到就按宿主默认的那套（whale）。 */
function figureIdOf(root: string): string {
  const cfg = join(root, 'data', 'home', 'companion', 'config.json');
  try {
    if (existsSync(cfg)) {
      const raw = JSON.parse(readFileSync(cfg, 'utf8').replace(/^\uFEFF/, '')) as {
        worlds?: { 'desktop-pet'?: { skin?: { figure?: unknown } } };
      };
      const id = raw.worlds?.['desktop-pet']?.skin?.figure;
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
  } catch { /* 读不懂就按默认 */ }
  return 'whale';
}

interface VocabEntry {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly names?: { zh?: unknown };
}

/** figure.json 里 vocab 的中文名，按 kind 分开。 */
export function parseVocab(raw: unknown): { actions: string[]; expressions: string[] } {
  const list = (raw as { vocab?: unknown })?.vocab;
  const actions: string[] = [];
  const expressions: string[] = [];
  if (!Array.isArray(list)) return { actions, expressions };
  for (const item of list as VocabEntry[]) {
    const names = item?.names?.zh;
    if (!Array.isArray(names)) continue;
    /*
     * 只取**首选名**（`names.zh[0]`）。
     *
     * 别名在匹配时有用（宿主认「散步」也认「走走」），但列进提示词就臃肿：
     * whale 这套 30 个动作带别名会写成 67 个，一半是同义词重复，
     * 反而让她以为要从中挑一个更细的。
     */
    const first = String(names[0] ?? '').trim();
    if (!first) continue;
    (item.kind === 'expression' ? expressions : actions).push(first);
  }
  return { actions: [...new Set(actions)], expressions: [...new Set(expressions)] };
}

/**
 * 读当前立绘的词表。
 *
 * 每次前缀重建都会调（用户可能刚换了立绘），所以这里**不做缓存** ——
 * 一个几百 KB 的 JSON，读一次不到一毫秒，比缓存失效的坑便宜。
 */
export function readPetVocab(dataDir: string): PetVocab {
  const root = findHostRoot(dataDir);
  if (!root) {
    return {
      figure: '?', actions: FALLBACK_ACTIONS, expressions: FALLBACK_EXPRESSIONS,
      source: 'fallback', note: '没找到宿主目录（从数据目录往上找不到 resources/app），用的是内置清单',
    };
  }
  const figure = figureIdOf(root);
  const file = join(root, 'resources', 'app', 'node_modules', 'cortico-world-desktop-pet', 'web', figure, 'figure.json');
  try {
    if (!existsSync(file)) {
      return {
        figure, actions: FALLBACK_ACTIONS, expressions: FALLBACK_EXPRESSIONS,
        source: 'fallback', note: `没找到 ${figure} 的 figure.json，用的是内置清单`,
      };
    }
    const parsed = parseVocab(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.actions.length) {
      return {
        figure, actions: FALLBACK_ACTIONS, expressions: FALLBACK_EXPRESSIONS,
        source: 'fallback', note: `${figure} 的词表里没有动作，用的是内置清单`,
      };
    }
    return {
      figure,
      actions: parsed.actions,
      expressions: parsed.expressions.length ? parsed.expressions : FALLBACK_EXPRESSIONS,
      source: 'live',
      note: `从 ${figure}/figure.json 读到 ${parsed.actions.length} 个动作、${parsed.expressions.length} 个表情`,
    };
  } catch (e) {
    return {
      figure, actions: FALLBACK_ACTIONS, expressions: FALLBACK_EXPRESSIONS,
      source: 'fallback',
      note: `读 ${figure}/figure.json 失败（${e instanceof Error ? e.message : String(e)}），用的是内置清单`,
    };
  }
}

/**
 * 场合 → 动作的对应关系。
 *
 * 这一层是**语义**，不是词表：词表只回答「有哪些词」，不回答「什么时候用哪个」。
 * 而且不同立绘的词表不同，所以这里写的是**语义标签**，取词时再跟词表求交 ——
 * 词表里没有这个语义就整条丢掉，不会漏出一个不存在的动作名。
 */
const BY_OCCASION: readonly { readonly when: string; readonly want: readonly string[] }[] = [
  { when: '赶路、走得急', want: ['走走', '跑'] },
  { when: '累了、心里难受', want: ['坐下'] },
  { when: '看远处的风景', want: ['张望'] },
  { when: '被什么震住', want: ['怔住'] },
  { when: '刚到、兴奋', want: ['小跳', '跳'] },
  { when: '冷', want: ['发抖'] },
  { when: '高反、晕车', want: ['晕'] },
  { when: '遇上麻烦', want: ['退半步', '发抖'] },
  { when: '吃到好吃的', want: ['扑腾'] },
  { when: '安静待着', want: ['坐下', '闭眼听'] },
  { when: '客气一下', want: ['点头', '招手'] },
];

/**
 * 拼成提示词里那段文字。
 *
 * 只把**词表里真有**的组合写进去：词表里没有「怔住」，那「被什么震住」这条就不出现。
 * 剩下的动作单独列一行「这些也能用」，免得她以为只会那几种场合。
 */
export function actionsPrompt(v: PetVocab): string {
  const has = new Set(v.actions);
  const lines: string[] = [];
  const used = new Set<string>();
  for (const o of BY_OCCASION) {
    const hit = o.want.filter((w) => has.has(w));
    if (!hit.length) continue;
    hit.forEach((w) => used.add(w));
    lines.push(`${o.when} ${hit.join('、')}`);
  }
  const rest = v.actions.filter((a) => !used.has(a));
  const expr = v.expressions.slice(0, 18);

  const out: string[] = [];
  out.push(`动作名只能从**这套立绘的词表**里挑（当前：${v.figure}）。写表外的名字会被静默丢掉 —— 人站着不动，还不报错。用中文名，别写英文 id。`);
  if (lines.length) out.push(`场合对动作：${lines.join('；')}。`);
  if (rest.length) out.push(`其余可用的：${rest.join('、')}。`);
  if (expr.length) {
    out.push(`表情只用这些：${expr.join('、')}。两个词写在同一括号里：\`【平静, 坐下】\`。只写表情等于没动。`);
  }
  out.push('');
  out.push('**词表里没有的动作也可以写。** 会被忽略，但会被记下来 —— 攒到一定次数，就有人把它做出来。');
  return out.join('\n');
}
