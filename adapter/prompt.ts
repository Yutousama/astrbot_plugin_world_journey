/**
 * 提示词适配。
 *
 * raw 的 ENV_PROMPT 是为「有立绘的桌面宿主」写的：末尾一整节讲动作词表，`journey.actions`
 * 也是从宿主 figure.json 读的。AstrBot 没有立绘，动作标记只会变成聊天里的乱码。
 * 所以这里在**不改 raw** 的前提下：
 *   1. 剥掉 `### 身体怎么动` 之后的内容；
 *   2. 追加一段聊天平台说明；
 *   3. 清洗 `music_pick` 这类 AstrBot 不存在的工具名。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ACTION_HEADING = '### 身体怎么动';

const CHAT_FOOTER = [
  '',
  '### 聊天平台',
  '',
  '你在聊天平台里，没有立绘、没有动作词表。不要输出【动作】形式的标记，',
  '也不要用括号写动作；只用文字说话。',
  '',
].join('\n');

export interface PromptFile {
  readonly text: string;
  readonly path: string;
  readonly hadActionSection: boolean;
}

/** 找到 `ENV_PROMPT.md`。优先上游 `raw/`；回退到插件根/仓库根。 */
export function findPromptFile(explicit?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const rawEnv = process.env.JOURNEY_RAW_DIR?.trim();
  const candidates = [
    explicit,
    rawEnv ? join(rawEnv, 'ENV_PROMPT.md') : undefined,
    join(here, '..', 'raw', 'ENV_PROMPT.md'),
    join(here, '..', 'ENV_PROMPT.md'),
    join(process.cwd(), 'raw', 'ENV_PROMPT.md'),
    join(process.cwd(), 'plugin', 'astrbot_plugin_world_journey', 'raw', 'ENV_PROMPT.md'),
    join(process.cwd(), 'plugin', 'astrbot_plugin_world_journey', 'ENV_PROMPT.md'),
    join(process.cwd(), 'ENV_PROMPT.md'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(`找不到 ENV_PROMPT.md（试过：${candidates.join('、')}）`);
}

export function readPromptFile(explicit?: string): PromptFile {
  const path = findPromptFile(explicit);
  const text = readFileSync(path, 'utf8');
  return { text, path, hadActionSection: text.includes(ACTION_HEADING) };
}

/** 去掉动作段，追加聊天平台说明。 */
export function stripActionSection(template: string): { text: string; stripped: boolean } {
  const index = template.indexOf(ACTION_HEADING);
  const base = index >= 0 ? template.slice(0, index).replace(/\s+$/, '') : template.replace(/\s+$/, '');
  return {
    text: `${base}\n${CHAT_FOOTER}`,
    stripped: index >= 0,
  };
}

/** 去掉 AstrBot 不存在的工具名；raw 的 nowSummary 里会出现。 */
export function sanitizePlatformText(text: string): string {
  return text
    .replace(/（装了一起听歌可用\s*music_pick）/g, '')
    .replace(/music_pick/g, '')
    .replace(/[ \t]+\n/g, '\n');
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface RenderedPrompt {
  readonly text: string;
  readonly missing: string[];
  readonly path: string;
  readonly warnings: string[];
}

/** 读 raw 模板 → 剥动作段 → 替换变量。 */
export function buildPrompt(
  vars: Readonly<Record<string, string>>,
  promptPath?: string,
): RenderedPrompt {
  const file = readPromptFile(promptPath);
  const stripped = stripActionSection(file.text);
  const warnings: string[] = [];
  if (!stripped.stripped) {
    warnings.push('上游 ENV_PROMPT.md 里没找到「### 身体怎么动」，动作段可能改名了；请检查 adapter/prompt.ts。');
  }
  const missing = new Set<string>();
  const text = stripped.text.replace(VAR_RE, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? '';
    missing.add(name);
    return whole;
  });
  return {
    text: sanitizePlatformText(text),
    missing: [...missing],
    path: file.path,
    warnings,
  };
}
