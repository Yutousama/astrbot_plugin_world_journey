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
import { generateSelfieBytes, installSelfieProxy, type SelfieOptions } from './selfie.ts';

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

const BRIDGE_VERSION = '1.0.0';

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
    const rawRefs = Array.isArray(cfg.selfieReference)
      ? cfg.selfieReference
      : typeof cfg.selfieReference === 'string'
        ? [cfg.selfieReference]
        : [];
    const references = rawRefs
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((ref) => this.resolveReference(ref.trim()));
    const modeRaw = stringOf(cfg.selfieMode).toLowerCase();
    return {
      enabled: true,
      references,
      api: stringOf(cfg.selfieApi) || stringOf(cfg.imageApi),
      key: stringOf(cfg.selfieKey) || stringOf(cfg.imageKey),
      model: stringOf(cfg.selfieModel) || stringOf(cfg.imageModel),
      mode: modeRaw === 'generation' || modeRaw === 'native' ? modeRaw : 'edit',
      nativeUrl: stringOf(cfg.selfieNativeUrl),
      size: stringOf(cfg.selfieSize),
      imageField: stringOf(cfg.selfieImageField) || 'image_url',
      subject: stringOf(cfg.selfieSubject) || '她本人',
      promptTemplate: stringOf(cfg.selfiePrompt),
    };
  }

  private installSelfie(): void {
    this.uninstallSelfie?.();
    this.uninstallSelfie = null;
    const options = this.selfieOptions();
    if (!options) return;
    this.uninstallSelfie = installSelfieProxy(options, this.log);
    this.log.info(
      `自拍套壳已启用：${options.mode} 模式，参考图 ${options.references.length} 张${options.references.length ? '' : '（缺失，照片会失败）'}`,
    );
  }

  /** 主动汇报附图：用汇报文本 + 当前状态生成，不写上游 photo 事件。 */
  async reportImage(scene?: string): Promise<Uint8Array | null> {
    const options = this.selfieOptions();
    if (!options) return null;
    const reportText = (scene ?? '').trim();
    const prompt = reportText
      ? `${reportText}\n\n此刻：${this.now()}`
      : this.now();
    try {
      const image = await generateSelfieBytes(prompt, options, globalThis.fetch, this.log);
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
