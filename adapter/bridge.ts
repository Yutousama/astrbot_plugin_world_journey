/**
 * raw 桥接门面 —— 外层唯一允许调用 raw 公开方法的地方。
 *
 * raw 是**运行时动态加载**的：安装后的插件把上游源码放在 `plugin/raw/`，
 * 更新后只要重启 sidecar，不需要重新打包 adapter。因此这里不再静态 import
 * JourneyWorld，而是在 `start()` 里 `loadRaw()`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  loadRaw, rawRoot,
  type JourneyConfigSection, type JourneyWorldType, type RawModule,
  type UiPhoto, type UiSnapshot,
} from './raw.ts';
import { ConfigWatcher, applyEngineConfig, loadEngineConfig, type LoadedEngineConfig } from './config.ts';
import {
  assertPromptVars, assertRawWorldShape, assertToolNames, assertWebUiShape,
  readUpstreamInfo, type RawToolDecl, type RawWebUi,
} from './contract.ts';
import { EventLog, type EventRecord } from './events.ts';
import { RawHost, SILENT_LOGGER, withHostFallback, type Logger } from './host.ts';
import { LocalMediaStore } from './media.ts';
import { buildPrompt, sanitizePlatformText } from './prompt.ts';
import {
  DEFAULT_SCENE_TEMPLATE, generateSelfieBytes, installPhotoProxy,
  type SceneTemplateOptions, type SelfieOptions,
} from './selfie.ts';
import { buildScenePrompt } from './photo-prompt.ts';

export interface ToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

export interface BridgeResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly reason?: string;
  readonly snapshot?: UiSnapshot;
  readonly photo?: UiPhoto | null;
}

export interface RawBridgeOptions {
  readonly dataDir: string;
  readonly rawDir?: string;
  readonly configPath?: string;
  readonly promptPath?: string;
  /** 启动时覆盖 raw 默认值（模拟器/测试用）。 */
  readonly initialOverrides?: Partial<JourneyConfigSection>;
  readonly now?: () => Date;
  readonly nowPlaying?: () => { title: string; artist: string; at: number } | null;
  readonly echo?: boolean;
  readonly verbose?: boolean;
  readonly log?: Logger;
  readonly host?: RawHost;
  readonly onEvent?: (event: EventRecord) => void;
}

declare const __BRIDGE_VERSION__: string;
/** 构建时由 esbuild 注入（scripts/build-engine.mjs 读根 package.json）；tsx/测试里回退。 */
const BRIDGE_VERSION = typeof __BRIDGE_VERSION__ === 'string' ? __BRIDGE_VERSION__ : 'dev';

function readLocalNowPlaying(dataDir: string): { title: string; artist: string; at: number } | null {
  try {
    const path = join(dataDir, 'nowplaying.json');
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as { title?: unknown; artist?: unknown };
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) return null;
    return {
      title,
      artist: typeof raw.artist === 'string' ? raw.artist.trim() : '',
      at: Date.now(),
    };
  } catch {
    return null;
  }
}

export class RawBridge {
  readonly dataDir: string;
  readonly rawDir: string;
  readonly configPath: string;
  readonly promptPath: string | undefined;
  readonly host: RawHost;
  readonly events: EventLog;
  readonly media: LocalMediaStore;
  readonly log: Logger;
  private readonly opts: RawBridgeOptions;
  private raw: RawModule | null = null;
  private world: JourneyWorldType | null = null;
  private cfg: JourneyConfigSection | null = null;
  private rawDefaults: JourneyConfigSection | null = null;
  private watcher: ConfigWatcher | null = null;
  private uninstallSelfie: (() => void) | null = null;
  /** 装代理之前的 fetch；主动汇报自己发请求时用它，避免被自己的代理再拦一次。 */
  private proxyFetch: typeof fetch = globalThis.fetch;

  constructor(opts: RawBridgeOptions) {
    this.opts = opts;
    this.dataDir = opts.dataDir;
    this.rawDir = opts.rawDir ?? rawRoot();
    this.configPath = opts.configPath ?? join(opts.dataDir, 'engine-config.json');
    this.promptPath = opts.promptPath;
    this.events = new EventLog(opts.dataDir);
    this.media = new LocalMediaStore(opts.dataDir);
    this.host = opts.host ?? new RawHost({
      dataDir: opts.dataDir,
      events: this.events,
      media: this.media,
      echo: opts.echo ?? false,
      verbose: opts.verbose ?? false,
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    });
    this.log = opts.log ?? this.host.log;
  }

  async start(): Promise<void> {
    const raw = await loadRaw(this.rawDir);
    const defaults = raw.JOURNEY_DEFAULTS();
    const loaded = loadEngineConfig(this.dataDir, this.configPath, defaults);
    if (this.opts.initialOverrides) Object.assign(loaded.cfg, this.opts.initialOverrides);
    this.raw = raw;
    this.rawDefaults = defaults;
    this.cfg = loaded.cfg;
    this.watcher = new ConfigWatcher(this.configPath, defaults);
    for (const note of loaded.notes) this.log.warn(note);

    this.world = new raw.JourneyWorld({
      cfg: loaded.cfg,
      dataDir: this.dataDir,
      botName: 'astrbot',
      ...(this.opts.now ? { now: this.opts.now } : {}),
      nowPlaying: this.opts.nowPlaying ?? (() => readLocalNowPlaying(this.dataDir)),
    });
    assertRawWorldShape(this.world);
    await this.world.start(withHostFallback(this.host));
    const ui = this.world.webUi() as unknown as RawWebUi;
    assertWebUiShape(ui);
    assertToolNames(this.world.tools());
    assertPromptVars(this.world.envPromptVars());
    this.installSelfie();
  }

  async stop(): Promise<void> {
    this.uninstallSelfie?.();
    this.uninstallSelfie = null;
    this.proxyFetch = globalThis.fetch;
    const world = this.world;
    this.world = null;
    this.raw = null;
    this.cfg = null;
    this.rawDefaults = null;
    this.watcher = null;
    if (world) await world.stop();
  }

  get started(): boolean {
    return this.world !== null;
  }

  /** 模拟器/诊断用。 */
  get rawWorld(): JourneyWorldType {
    if (!this.world) throw new Error('raw 还没启动');
    return this.world;
  }

  get config(): JourneyConfigSection {
    if (!this.cfg) throw new Error('raw 还没启动，配置不可用');
    return this.cfg;
  }

  get upstreamVersion(): string {
    return readUpstreamInfo(this.rawDir).version;
  }

  get bridgeVersion(): string {
    return BRIDGE_VERSION;
  }

  get lastSeq(): number {
    return this.events.lastSeq;
  }

  get eventLogId(): string {
    return this.events.eventLogId;
  }

  /** 文件 mtime 变了就合并进活配置；返回是否变了。 */
  reloadConfig(): boolean {
    if (!this.watcher || !this.cfg || !this.rawDefaults) return false;
    const loaded = this.watcher.read();
    if (!loaded) return false;
    applyEngineConfig(this.cfg, loaded.cfg, this.rawDefaults);
    this.installSelfie();
    for (const note of loaded.notes) this.log.info(note);
    this.log.info('引擎配置已热重载。');
    return true;
  }

  async snapshot(): Promise<UiSnapshot> {
    const ui = this.ui;
    assertWebUiShape(ui);
    return await ui.invoke('now', 'snapshot', []) as UiSnapshot;
  }

  now(): string {
    const vars = this.w().envPromptVars();
    return sanitizePlatformText(String(vars['journey.now'] ?? ''));
  }

  promptVars(): Record<string, string> {
    return this.w().envPromptVars();
  }

  prompt(): { text: string; missing: string[]; path: string; warnings: string[] } {
    return buildPrompt(this.promptVars(), this.promptPath ?? join(this.rawDir, 'ENV_PROMPT.md'));
  }

  tools(): RawToolDecl[] {
    return this.w().tools();
  }

  async callTool(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools().find((t) => t.name === name);
    if (!tool) return { text: `没有这个工具：${name}`, isError: true };
    try {
      const value = await tool.handler?.(args);
      return normalizeToolResult(value);
    } catch (e) {
      return { text: `工具 ${name} 出错：${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  async depart(): Promise<BridgeResult> {
    try {
      const snapshot = await this.ui.invoke('now', 'depart', []) as UiSnapshot;
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  async sync(): Promise<BridgeResult> {
    try {
      const snapshot = await this.ui.invoke('now', 'syncClock', []) as UiSnapshot;
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 回答「出门等点头」/「接邀约」的卡片（上游面板的两个按钮）。
   *
   * 先读快照里的 `ask`：没有在等批的事时上游会静默吞掉（`answerAsk` 直接 return），
   * 用户在聊天里得不到任何反馈 —— 这里把「她现在没在问你」变成明确的一句话。
   */
  async askAnswer(ok: boolean): Promise<BridgeResult> {
    try {
      const snap = await this.snapshot();
      const pending = snap.ask as { kind?: string; line?: string } | null | undefined;
      if (!pending) return { ok: false, reason: '她现在没有在等你点头（也许没开「出门等点头」，也许她还没问）。' };
      const snapshot = await this.ui.invoke('now', 'answerAsk', [ok]) as UiSnapshot;
      const head = pending.line ? `${pending.line}\n` : '';
      return { ok: true, text: ok ? `${head}他点了头。${this.now()}` : `${head}他答了「不好」。`, snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 叫她回来（上游面板「回来」按钮；`journey_return_home` 工具走的是同一条腿）。 */
  async returnHome(): Promise<BridgeResult> {
    try {
      const snapshot = await this.ui.invoke('now', 'returnHome', []) as UiSnapshot;
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  async photo(): Promise<BridgeResult> {
    try {
      const raw = await this.ui.invoke('album', 'shoot', []) as { ok?: boolean; reason?: string };
      if (raw && raw.ok === false) return { ok: false, reason: raw.reason ?? '没拍成' };
      const snapshot = await this.snapshot();
      const photo = snapshot.photos?.[0] ?? null;
      return { ok: true, text: photo ? `拍了一张：${photo.title}。` : '拍了一张。', photo, snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  health(): {
    ok: true; version: string; upstreamVersion: string; eventLogId: string; lastSeq: number;
  } {
    return {
      ok: true,
      version: BRIDGE_VERSION,
      upstreamVersion: this.upstreamVersion,
      eventLogId: this.events.eventLogId,
      lastSeq: this.events.lastSeq,
    };
  }

  defaultConfig(): JourneyConfigSection {
    if (!this.rawDefaults) throw new Error('raw 还没启动，默认配置不可用');
    return this.rawDefaults;
  }

  currentConfig(): LoadedEngineConfig {
    if (!this.cfg) throw new Error('raw 还没启动');
    return { cfg: this.cfg, offline: false, path: this.configPath, notes: [] };
  }

  get ui(): RawWebUi {
    return this.w().webUi() as unknown as RawWebUi;
  }

  private selfieOptions(): SelfieOptions | null {
    const cfg = this.cfg as unknown as Record<string, unknown> | null;
    if (!cfg || cfg.selfieEnabled !== true) return null;
    // ComfyUI 那条路走 workflow（POST /prompt），自拍套壳拦不到这种形状，也注入不了参考图。
    // 除非用户单独配了 selfieApi（云端生图服务），否则直接关掉 —— 别再拿 Comfy 地址
    // 打 `${api}/images/generations`：那是一次注定 404 的出网请求加一条没人看的 warn。
    if (this.comfySelfieBlocked(cfg)) return null;
    const rawRefs = Array.isArray(cfg.selfieReference)
      ? cfg.selfieReference
      : typeof cfg.selfieReference === 'string'
        ? [cfg.selfieReference]
        : [];
    const references = rawRefs
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((ref) => this.resolveReference(ref.trim()));
    const modeRaw = stringOf(cfg.selfieMode).toLowerCase();
    const selfieModel = stringOf(cfg.selfieModel).trim();
    return {
      enabled: true,
      references,
      api: stringOf(cfg.selfieApi) || stringOf(cfg.imageApi),
      key: stringOf(cfg.selfieKey) || stringOf(cfg.imageKey),
      // 自拍模型没单独填时，用「生图模型名」的整个列表按顺序降级。
      model: selfieModel ? [selfieModel] : this.imageModels(),
      mode: modeRaw === 'generation' || modeRaw === 'native' ? modeRaw : 'edit',
      nativeUrl: stringOf(cfg.selfieNativeUrl),
      size: stringOf(cfg.selfieSize),
      imageField: stringOf(cfg.selfieImageField) || 'image_url',
      subject: stringOf(cfg.selfieSubject) || '她本人',
      promptTemplate: this.selfieTemplate(cfg),
      // 画风从这条路径起也生效：模板里的 {style} 就是它。
      style: this.imageStyle(),
    };
  }

  /**
   * 自拍模板的取值顺序：新字段 `imagePromptTemplate` → 旧字段 `selfiePrompt` → 空串。
   *
   * 空串交给 `selfie.ts` 回落到内置默认模板；老用户只填过 `selfie_prompt` 的，
   * 内容原样生效，不要求他重填一遍。
   */
  private selfieTemplate(cfg: Record<string, unknown>): string {
    const fresh = stringOf(cfg.imagePromptTemplate).trim();
    if (fresh) return fresh;
    return stringOf(cfg.selfiePrompt).trim();
  }

  /** 「出镜自拍」开了、但生图协议是 ComfyUI 且没单独配 selfieApi —— 自拍/汇报配图应整体停用。 */
  private comfySelfieBlocked(cfg: Record<string, unknown>): boolean {
    const proto = stringOf(cfg.imageProtocol).trim().toLowerCase();
    return proto === 'comfyui' && !stringOf(cfg.selfieApi).trim();
  }

  /**
   * 空镜（没开自拍）的模板配置。
   *
   * 单独一套模板而不是复用自拍那套：自拍模板里有「画面里只有她一个人」，
   * 套到风景上就把空镜画成了人像 —— 上游空镜的纪律恰恰是「画面里没有人物」。
   * `image_prompt_for_scene=false` 时返回 null，回到「上游发什么就发什么」的老行为。
   */
  private sceneOptions(): SceneTemplateOptions | null {
    const cfg = this.cfg as unknown as Record<string, unknown> | null;
    if (!cfg || cfg.imagePromptForScene === false) return null;
    return {
      enabled: true,
      promptTemplate: stringOf(cfg.imagePromptSceneTemplate).trim() || DEFAULT_SCENE_TEMPLATE,
      style: this.imageStyle(),
      subject: stringOf(cfg.selfieSubject),
    };
  }

  /** 用户填的「画面风格」（`image_style`）；`none` 与空串在模板渲染时才区分。 */
  private imageStyle(): string {
    const cfg = this.cfg as unknown as Record<string, unknown> | null;
    return cfg ? stringOf(cfg.imageStyle).trim() : '';
  }

  /**
   * 「生图模型名」列表。上游只认一个字符串，所以列表由套壳维护：
   * Python 侧写成 `imageModels`，老的 `imageModel` 字符串也兼容。
   */
  private imageModels(): string[] {
    const cfg = this.cfg as unknown as Record<string, unknown> | null;
    if (!cfg) return [];
    return modelListOf(cfg.imageModels ?? cfg.imageModel);
  }

  private installSelfie(): void {
    this.uninstallSelfie?.();
    this.uninstallSelfie = null;
    const selfie = this.selfieOptions();
    const models = this.imageModels();
    if (!selfie && this.cfg && this.comfySelfieBlocked(this.cfg as unknown as Record<string, unknown>)) {
      this.log.info('生图协议是 ComfyUI：自拍套壳与主动汇报配图不生效（要用的话单独配 selfie_api 指向云端生图服务）。');
    }
    // 开了自拍就不需要再套空镜模板 —— 两条路径互斥，同一时刻只有一套模板生效。
    const scene = selfie ? null : this.sceneOptions();
    if (!selfie && !scene && models.length === 0) return;
    const proxy = installPhotoProxy({ models, selfie, scene, clock: () => this.localClock() }, this.log);
    this.uninstallSelfie = proxy.uninstall;
    this.proxyFetch = proxy.fetch;
    if (selfie) {
      this.log.info(
        `自拍套壳已启用：${selfie.mode} 模式，参考图 ${selfie.references.length} 张${selfie.references.length ? '' : '（缺失，照片会失败）'}`,
      );
    }
    if (models.length > 1) {
      this.log.info(`生图模型降级已启用：${models.join(' → ')}`);
    }
    /*
     * 把「画风从哪来」写在一行里。排查出图风格时，这行比读代码快 ——
     * 画面风格对自拍、空镜、主动汇报配图是不是真的生效，看这一行就知道。
     */
    const cfg = this.cfg as unknown as Record<string, unknown> | null;
    const templateSource = cfg && stringOf(cfg.imagePromptTemplate).trim()
      ? 'image_prompt_template'
      : cfg && stringOf(cfg.selfiePrompt).trim() ? 'selfie_prompt（旧字段）' : '内置默认';
    this.log.info(
      `生图提示词：画风「${this.imageStyle() || '（留空=真实旅行照片）'}」｜模板 ${templateSource}｜空镜套模板 ${scene ? '开' : '关'}`,
    );
  }

  /**
   * 她所在城市的当地时间 `HH:MM`（来自 raw 的 UI 快照）。
   *
   * 自拍模板里的 `{time}` / `{clock}` 用它：不能用本机时间 —— 她可能在
   * 另一个时区，本机中午对她那边可能是深夜。取不到时返回空串，
   * 由 `describeTime()` 退回本机时间，只影响描述词，不影响生图。
   */
  private async localClock(): Promise<string | null> {
    try {
      const snap = await this.snapshot();
      const clock = typeof snap.clock === 'string' ? snap.clock.trim() : '';
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null;
    } catch {
      return null;
    }
  }

  /**
   * 主动汇报附图：和 `/journey_photo`、自动拍照用**同一个场景描述**（上游
   * `photoPrompt()`，含用户的「画面风格」），末尾再附一行她此刻在做什么。
   * 不写上游 photo 事件、不进相册。
   *
   * 以前这里直接拿汇报文本当提示词，`image_style` 一个字都不参与 —— 同一个人设，
   * 相册里是动漫、主动汇报里是真人照片。上游导入失败或快照缺字段时退回旧写法，
   * 汇报照发，绝不因为配图链路挂掉而丢整条消息。
   */
  async reportImage(scene?: string): Promise<Uint8Array | null> {
    const options = this.selfieOptions();
    if (!options) return null;
    // 汇报文本只当「她此刻在做什么」，截一段就够：提示词越长，画风指令越容易被冲淡。
    const reportText = (scene ?? '').trim().slice(0, 120);
    const fallback = reportText ? `${reportText}\n\n此刻：${this.now()}` : this.now();
    let prompt = fallback;
    try {
      const base = await buildScenePrompt(await this.snapshot(), this.imageStyle());
      prompt = reportText ? `${base}\n\n她此刻：${reportText}` : base;
    } catch (e) {
      this.log.warn(`汇报配图退回旧提示词：${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const clock = await this.localClock();
      const image = await generateSelfieBytes(prompt, options, this.proxyFetch, this.log, clock ?? undefined);
      return image.bytes;
    } catch (e) {
      this.log.warn(`汇报配图失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private resolveReference(ref: string): string {
    if (/^(https?:|data:)/i.test(ref) || isAbsolute(ref)) return ref;
    const bases = [dirname(this.rawDir), this.dataDir, process.cwd()];
    for (const base of bases) {
      const candidate = join(base, ref);
      if (existsSync(candidate)) return candidate;
    }
    return join(dirname(this.rawDir), ref);
  }

  private w(): JourneyWorldType {
    if (!this.world) throw new Error('raw 还没启动');
    return this.world;
  }

  static silent(): Logger {
    return SILENT_LOGGER;
  }
}

function normalizeToolResult(value: unknown): ToolResult {
  if (value && typeof value === 'object') {
    const v = value as { text?: unknown; isError?: unknown };
    return {
      text: sanitizePlatformText(String(v.text ?? '')),
      ...(v.isError === true ? { isError: true } : {}),
    };
  }
  return { text: sanitizePlatformText(String(value ?? '')) };
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 把 `imageModel` 归一成数组：兼容老配置的单个字符串，去空白、去空项、去重。
 * 数组本身可能是运行时从 `engine-config.json` 读进来的，类型上只是 `unknown`。
 */
function modelListOf(value: unknown): string[] {
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
