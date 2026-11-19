/**
 * 碰面：她到了哪儿，看看还有谁在。
 *
 * 2026-11-04 Mr.Q：想让她「看见昨天有只叫 XX 的也来过这儿」，或者
 * 「几只宠物一块逛一个地方、一起吃饭、一起住旅馆」（最多四个）。
 * 前提是**不能留言、不能加好友、不能私聊** —— 只看得见，摸不着。
 *
 * ## 为什么不用实时
 *
 * 「一起吃饭」说的是**同一段时间在同一座城**，不是两个人视频连线。
 * 所以只要一张「谁在哪」的表：到站上报一条，排作息时查一次。
 * 没有 WebSocket、没有长连接、没有撮合逻辑 —— 谁和谁碰上，纯粹是查询结果。
 *
 * 这也是它和鲸语茶室的根本差别：那边要把两副牌真的发到两个人手上（SSE + 常驻服 + PG），
 * 这边只需要知道昨天那张桌子上还坐着谁。**成本和复杂度差一个量级。**
 *
 * ## 一条不能破的线
 *
 * 拉回来的东西只有「宠物名 + 在干嘛」，没有任何可以回复的通道。
 * 所以这个模块里**永远不会有 post / reply / friend 这类方法**。
 * 想做社交，那得另起一个东西，不能从这儿慢慢长出去。
 */

/** 碰面用的时段。四档够粗，不会「错开六小时也算一起吃饭」。 */
export type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

export function slotOf(hour: number): Slot {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/** 拉回来的一个邻居。只有这两样，没有 id、没有联系方式。 */
export interface Neighbor {
  readonly pet: string;
  readonly doing: string;
}

export interface MeetOptions {
  /** 服务器根地址。留空 = 这个功能整个不工作。 */
  readonly url: string;
  /** 她的匿名标识。本地随机生成一次，不跟账号、不跟硬件绑。 */
  readonly uid: string;
  /** 宠物名。**唯一会被别人看见的字段。** */
  readonly pet: string;
}

/** 一次碰面最多几个人 —— 含她自己。 */
export const MEET_MAX = 4;
/** 网络请求上限。拉不到就当没碰见，不能拖住作息表。 */
const TIMEOUT_MS = 5000;

const clean = (s: string) => String(s ?? '').trim();

/**
 * 用户填的那一栏，整理成能用的**根地址**（不带 `/sight`）。
 *
 * ## 为什么要单独一步（2026-11-13）
 *
 * 读者报「名片一直填不了」「约鱼发不出去，说没连上碰面服务器」，
 * 而线上服务实测完全正常：GET/POST `/sight/profile` 全是 200。
 * 追下去发现是**填法**的问题 —— 少一个 `https://`，`fetch` 就抛 `Invalid URL`，
 * 被 `catch` 压成「没连上碰面服务器」。用户和模型都只能推「地址没填对」，
 * 真实那一层永远传不出来。
 *
 * 所以这里做三件事：把肉眼看不见的东西清掉、把缺的协议补上、把多余的路径剪掉。
 * **能修的直接修，修不了的说清楚哪里不对** —— 不要静默改写成一个它自己猜的地址。
 *
 * ## 认哪些写法
 *
 * - 漏协议：`cooppetsjourney.top` → `https://cooppetsjourney.top`
 * - 带尾斜杠、多斜杠
 * - 从浏览器地址栏复制带上的 `?query` `#hash`
 * - 误填到具体接口：`…/sight/status` → 剪回 `…/sight`
 * - 复制带来的零宽空格、BOM、全角空格、首尾引号/尖括号
 *
 * `http://` 原样保留（自建服务常用），不强行升 https —— 那是他的选择。
 */
export interface MeetUrlFix {
  /** 整理后的根地址。`error` 非空时为空串。 */
  readonly base: string;
  /** 动过什么，一句人话。原样可用时为空。 */
  readonly fixed: string;
  /** 不能用时的原因。空串 = 没问题（含「没填」）。 */
  readonly error: string;
}

export function normalizeMeetUrl(raw: unknown): MeetUrlFix {
  const original = String(raw ?? '');
  let s = original
    // 零宽字符与 BOM：从网页/聊天框复制时最常见，肉眼完全看不出来
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .trim()
    // 首尾的引号、书名号、尖括号 —— 从邮件或文档里复制会带上
    .replace(/^[<"'“”‘’「」『』]+/, '')
    .replace(/[>"'“”‘’「」『』]+$/, '')
    .trim();
  if (!s) return { base: '', fixed: '', error: '' };

  const fixes: string[] = [];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = `https://${s}`;
    fixes.push('补了 https://');
  }

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { base: '', fixed: '', error: `这串读不成网址（${s.slice(0, 60)}）` };
  }
  if (!/^https?:$/.test(u.protocol)) {
    return { base: '', fixed: '', error: `只认 http 和 https，这串是 ${u.protocol.replace(':', '')}` };
  }
  if (!u.hostname) return { base: '', fixed: '', error: '地址里没有域名' };

  if (u.search || u.hash) {
    u.search = '';
    u.hash = '';
    fixes.push('去掉了地址里的 ? 和 #');
  }

  /*
   * 路径只留到 `/sight` 为止。
   *
   * 会有人把文档里那句 `…/sight/status` 直接抄进来（那是**状态接口**，不是根）。
   * 留着它，`endpointOf` 会再补一个 `/sight`，变成 `…/sight/status/sight` —— 404，
   * 而 404 的文案是「这台服务器上还没有邀约功能」，比真实原因还误导。
   */
  let path = u.pathname.replace(/\/+$/, '');
  const hit = /^(.*?)\/sight(\/.*)?$/.exec(path);
  if (hit) {
    path = hit[1];
    if (hit[2]) fixes.push('剪掉了 /sight 后面那段');
  }
  if (path === '/') path = '';

  return {
    base: `${u.protocol}//${u.host}${path}`,
    fixed: fixes.join('，'),
    error: '',
  };
}

/**
 * 拼出真正的接口地址。
 *
 * 用户会怎么填？大概率是**从控制台直接复制完整地址**（带 `/sight`）——
 * 那是他眼前唯一的一串东西。所以两种都要认：
 *   `https://xxx.app.tcloudbase.com`        → 补成 .../sight
 *   `https://xxx.app.tcloudbase.com/sight`  → 原样用，不重复拼
 *
 * 2026-11-04 差点栽在这儿：代码本来无条件拼 `/sight`，
 * 填完整地址就会变成 `/sight/sight`，404。
 */
const endpointOf = (url: string): string => {
  const fix = normalizeMeetUrl(url);
  const base = fix.error ? clean(url).replace(/\/+$/, '') : fix.base;
  return base.endsWith('/sight') ? base : `${base}/sight`;
};

/**
 * 一个网络异常，说成人话。
 *
 * ## 为什么要有它（2026-11-13）
 *
 * 原来所有 `catch` 都只回一句「没连上碰面服务器」。可这一句底下压着**六种完全
 * 不同的失败**：地址没写协议、域名打错、服务没起、本机断网、证书过期、超时。
 * 六种的修法毫不相干，而用户只能看到同一句话 —— 他唯一能得出的结论是
 * 「这个功能坏了」，我们连去查哪一层都不知道。
 *
 * **只报能确认的事实**：DNS 查不到就说查不到，不替他推「你是不是打错了」。
 * 原始 `code` 附在末尾，用户复制给我们就够定位。
 */
export function explainNet(e: unknown): string {
  const err = e as
    | { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } }
    | null
    | undefined;
  const name = String(err?.name ?? '');
  const code = String(err?.code ?? err?.cause?.code ?? '');
  const msg = String(err?.cause?.message ?? err?.message ?? '');

  if (name === 'TimeoutError' || name === 'AbortError') {
    return `请求 ${TIMEOUT_MS / 1000} 秒没回话`;
  }
  /*
   * 这两个都属 DNS 层，但修法不同：一个是名字真的不存在（地址拼错了），
   * 一个是这会儿查不了（本机 DNS/网络抽了，过会儿就好）。
   * 合成一句会让用户去改一个根本没写错的地址。
   */
  if (code === 'ENOTFOUND') return '域名解析不了（DNS 查不到这个名字）';
  if (code === 'EAI_AGAIN') return 'DNS 这会儿查不了（临时失败，过一会儿再试）';
  if (code === 'ECONNREFUSED') {
    return `域名通，但这个端口没人应答（服务没起或端口不对）`;
  }
  if (code === 'ECONNRESET') return '连接被对面掐断了';
  if (code === 'ETIMEDOUT') return '网络层超时（本机断网或被挡）';
  if (code === 'EPROTO') return '协议握手失败';
  if (/CERT|TLS|SSL/i.test(code) || /certificate/i.test(msg)) {
    return '证书没通过（多半已过期，或证书上的域名和这个对不上）';
  }
  if (/Failed to parse URL|Invalid URL/i.test(msg)) {
    return '这串读不成网址（前面是不是漏了 https://）';
  }
  const tail = [code, name].filter(Boolean).join('/') || '未知';
  return msg ? `网络没通（${tail}：${msg.slice(0, 60)}）` : `网络没通（${tail}）`;
}

/** 失败时的统一说法：**先说是哪一层，再给原始码**。 */
const netFail = (e: unknown): string => `没连上碰面服务器 —— ${explainNet(e)}`;

/**
 * 上报「我在这儿」。
 *
 * 同一 uid、同城、同日、同时段只留一条（服务端 upsert），所以她一天里
 * 在城里换几个地方，最后留下的是最后一次 —— 那正是「这会儿她在哪」。
 *
 * **失败返回 false，不抛。** 服务器挂了不该影响她旅行。
 */
export async function reportPresence(
  opt: MeetOptions,
  cityId: string,
  dateKey: string,
  slot: Slot,
  doing: string,
): Promise<boolean> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid) || !clean(opt.pet)) return false;
  try {
    const res = await fetch(`${endpointOf(url)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: clean(opt.uid),
        pet: clean(opt.pet).slice(0, 24),
        city: cityId,
        date: dateKey,
        slot,
        doing: clean(doing).slice(0, 40),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 查同城、同日、同时段还有谁。
 *
 * 最多回 `MEET_MAX - 1` 个（三个）—— 加上她自己正好四个。
 * 拉不到就是空列表，调用方不需要区分「没人」和「没连上」：
 * 对她说的话是同一句（不说什么）。
 *
 * 顺带带回 `pool`：**这个池子今天一共多少只**（不分城市）。面板拿它显示
 * 「今天一共 37 只」—— 一个人用的时候，「同城没人」和「这条线坏了」在界面上
 * 长得一模一样，一个总数就能分开。旧服务端不回这个字段，按 0 处理。
 */
export interface NeighborBoard {
  readonly list: readonly Neighbor[];
  readonly pool: number;
  /**
   * **今天这座城来过多少只**（2026-11-14）。
   *
   * 跟 `pool` 不是一回事：`pool` 是全池子跨城的总数，一个人待在小城时会显示几十，
   * 让她误以为周围有一堆人。这个只算当前城。
   *
   * 旧服务端不回这个字段，按 0 处理 —— 0 的含义是「不知道」，不是「没人」，
   * 所以别拿它说「这城一个人都没有」。
   */
  readonly here: number;
  /**
   * **这次到底查成了没有**（2026-11-17，zzy1053 报的）。
   *
   * 原来「断连」和「查到了、确实没人」返回的东西一模一样（都是空 `list`），
   * 于是他 11-16 那天全天连不上，早上那次判定被当成「人没露面」——
   * 他自己拿着日志都分不出来，普通用户更没戏。
   *
   * `false` 的含义是「不知道」，不是「没人」。**任何时候都不该把它读成「没人」。**
   */
  readonly ok: boolean;
}

export async function findNeighbors(
  opt: MeetOptions,
  cityId: string,
  slot: Slot,
  /**
   * 要几个邻居。默认 `MEET_MAX - 1`（三个）。
   *
   * ⚠ **服务端不读这个参数**（2026-11-17 核过 `cloud/sight-cf/src/worker.js`）：
   * 那边是 `ORDER BY at DESC LIMIT ${MAX}`，`MAX = 3` 写死，query 里的 `limit` 被忽略。
   * 所以这个值**只管本地再截一道**，传大了服务端也不会多给。
   *
   * **判定场景漏人的真原因不是条数，是时段**：服务端按 `slot` 硬过滤，
   * 而 `matesHere()` 原来只查 `night` —— 对方在别的时段上报就永远看不到。
   * 那边现在四个时段全查再合并，见 `matesHere` 的注释。
   */
  limit = MEET_MAX - 1,
): Promise<NeighborBoard> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { list: [], pool: 0, here: 0, ok: false };
  /*
   * **不再传 `date`（2026-11-10）。**
   *
   * 那原来是「同日」的筛选条件，而 `date` 是**她自己那套日历**，各人独立跑 ——
   * 线上同一刻并存 2026-11-10 / 2026-11-12 / 2027-03-07，两条鱼撞上同一天几乎不可能。
   * 服务端已改成按真实写入时刻划一个窗口（`RECENT_NEIGHBOR_MS`），
   * 这里多传一个它已经不看的参数，只会让下一个读代码的人以为它还在起作用。
   */
  const q = new URLSearchParams({
    city: cityId,
    slot,
    exclude: clean(opt.uid),
    limit: String(limit),
  });
  try {
    const res = await fetch(`${endpointOf(url)}?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { list: [], pool: 0, here: 0, ok: false };
    const body = (await res.json()) as { list?: unknown; pool?: unknown; here?: unknown };
    if (!Array.isArray(body.list)) return { list: [], pool: 0, here: 0, ok: false };
    const pool = typeof body.pool === 'number' && body.pool > 0 ? Math.floor(body.pool) : 0;
    const here = typeof body.here === 'number' && body.here > 0 ? Math.floor(body.here) : 0;
    /*
     * 只认两个字段。服务器多返什么都丢掉 —— 别人的 id、时间戳、余额
     * 一律不该出现在她的世界里，也不该出现在日志里。
     */
    return {
      list: body.list
        .filter((x): x is Neighbor => !!x && typeof x === 'object'
          && typeof (x as Neighbor).pet === 'string'
          && typeof (x as Neighbor).doing === 'string')
        .map((x) => ({ pet: x.pet.slice(0, 24), doing: x.doing.slice(0, 40) }))
        .filter((x) => x.pet && x.pet !== clean(opt.pet))
        .slice(0, limit),
      pool,
      here,
      ok: true,
    };
  } catch {
    return { list: [], pool: 0, here: 0, ok: false };
  }
}

/* ---------------- 足迹 ---------------- */

export interface Footprint {
  readonly city: string;
  readonly first: string;
  readonly last: string;
  readonly visits: number;
}

/**
 * 记一笔「她到了这座城」（2026-11-14）。
 *
 * **只在真到达时调**（`journey.arrive` 那一下），别挂在心跳上报上 ——
 * 心跳一天 72 次、上百只鱼就是上万行写入，而足迹一天只该变几次。
 * 挂错了地方，省下来的额度会原样烧回去。
 *
 * 失败就返回 false，不重试、不影响行程：这是履历，丢一次不致命，
 * 下次到站还会再记。
 */
export async function reportFootprint(
  opt: MeetOptions | null,
  cityId: string,
): Promise<boolean> {
  /* `meetOptions()` 在没配服务器时返回 null —— 直接读 `opt.url` 会把她到站的整条链路炸掉。 */
  if (!opt) return false;
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return false;
  try {
    const res = await fetch(`${endpointOf(url)}/footprints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: clean(opt.uid), city: cityId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 取回她在云端的足迹。
 *
 * 服务端一次最多给 300 座（上限 500）—— 跑一辈子也去不到那么多。
 * **拉不到返回空数组，调用方不要拿空去覆盖本地那份**：
 * 本地 `everVisited` 才是主，云端只是「换机器还认得她」的备份。
 */
export async function fetchFootprints(opt: MeetOptions | null): Promise<Footprint[]> {
  if (!opt) return [];
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return [];
  try {
    const q = new URLSearchParams({ uid: clean(opt.uid) });
    const res = await fetch(`${endpointOf(url)}/footprints?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { places?: unknown };
    if (!Array.isArray(body.places)) return [];
    return body.places
      .filter((p): p is Footprint => !!p && typeof p === 'object'
        && typeof (p as Footprint).city === 'string')
      .map((p) => ({
        city: p.city,
        first: String(p.first ?? ''),
        last: String(p.last ?? ''),
        visits: Number(p.visits) || 1,
      }));
  } catch {
    return [];
  }
}

/* ---------------- 路标 ---------------- */

export interface Signpost {
  readonly pet: string;
  readonly text: string;
}

/**
 * 在一座城留一句「这里值得来」（2026-11-14）。
 *
 * 借的是《死亡搁浅》的结构：两个玩家永不同时在线，但前人留下的东西让后人受益。
 * **只留正向痕迹** —— 没有踩、没有举报、没有排序。
 *
 * 一只鱼一城一天只能留一条（服务端覆盖旧的），所以反复留不会变成刷屏。
 * 带链接的话会被服务端拒掉（400），那不是失败，是它在防广告。
 */
export async function reportSignpost(
  opt: MeetOptions | null,
  cityId: string,
  text: string,
): Promise<boolean> {
  if (!opt) return false;
  const url = clean(opt.url);
  if (!url || !clean(opt.uid) || !clean(opt.pet)) return false;
  try {
    const res = await fetch(`${endpointOf(url)}/signposts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: clean(opt.uid),
        pet: clean(opt.pet).slice(0, 24),
        city: cityId,
        text: clean(text).slice(0, 40),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 看这座城别人留过什么。
 *
 * 拉不到返回空数组 —— **空不代表「这城不好」，只代表还没人留过**。
 * 调用方别把「空」说成「没人来过」。
 */
export async function fetchSignposts(
  opt: MeetOptions | null,
  cityId: string,
): Promise<Signpost[]> {
  if (!opt) return [];
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return [];
  try {
    const q = new URLSearchParams({ city: cityId, exclude: clean(opt.uid) });
    const res = await fetch(`${endpointOf(url)}/signposts?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { list?: unknown };
    if (!Array.isArray(body.list)) return [];
    return body.list
      .filter((x): x is Signpost => !!x && typeof x === 'object'
        && typeof (x as Signpost).pet === 'string'
        && typeof (x as Signpost).text === 'string')
      .map((x) => ({ pet: x.pet.slice(0, 24), text: x.text.slice(0, 40) }))
      .filter((x) => x.pet && x.text);
  } catch {
    return [];
  }
}

/* ---------------- 邀约 ---------------- */

/**
 * 一条别人发出来的邀约。
 *
 * **没有发起者的 uid。** 服务端刻意不回 —— 跟碰面同一条线：能看见，摸不着。
 * 名字、「想去哪」、「几天」、「一句话」，够她判断了。
 */
export interface Invite {
  readonly id: string;
  readonly pet: string;
  readonly to: string;
  readonly days: number;
  readonly note: string;
  /**
   * 约在哪儿见面（城市 id）。**空串 = 老口径：直接在 `to` 见。**
   *
   * 2026-11-07 加的。Mr.Q：「约好在哪个城市见面，然后一起走，最后从哪个城市一起分开」。
   * 三个阶段只需要一个字段 —— 「分开的城」就是 `to`（一起走的目的地），
   * 所以协议里没有第三个数。老服务端不回这个字段，解析成空串即可。
   */
  readonly meetCity: string;
  /**
   * 发起方那边的世界流速（1 = 和真实时间同步）。**0 = 老客户端没报。**
   *
   * 两边差太多就没法「同一天在同一个地方」—— 接到这种约之前就要拒绝，
   * 并说清原因。否则她会答应一桩永远兑现不了的约定。
   */
  readonly pace: number;
}

/**
 * 两边的时间流速差多少算「凑不到一起」。
 *
 * 2 倍是能忍的上限：1 倍对 2 倍，约好的三天在她那边只是一天半，等着一天还能圆回来。
 * 再多就不行了 —— 24 倍速的人过一个世界日只要一小时，她到了约定城，
 * 人家那边已经过了大半个月，早就按「等不到」走了。
 */
export const PACE_RATIO_MAX = 2;

/**
 * 这个流速差能不能赴约。能 → `null`；不能 → 一句人话。
 *
 * 任一方没报（0）就放行：老客户端和「不知道」不该被当成「不兼容」。
 */
export function paceGap(mine: number, theirs: number): string | null {
  const a = Number(mine) || 0;
  const b = Number(theirs) || 0;
  if (a <= 0 || b <= 0) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi / lo <= PACE_RATIO_MAX) return null;
  /*
   * 文案里不写「倍速」「speed」「时间流速」这种词 —— 那是设置项的名字，
   * 她跟用户说话时该说的是**后果**：赶不上、对不上日子。
   */
  return `对方那边的一天比这边短得多（${lo} 对 ${hi}），约好的日子对不上 —— 这趟凑不到一起`;
}

/** 三件事都会失败，而失败原因必须能被她转述成一句人话。 */
export type InviteFail = { readonly ok: false; readonly reason: string };

/**
 * 一行版：控制字符换空格、连续空白压成一个、去首尾。
 *
 * **这不是洁癖。** 拉回来的名字和那句话会拼进事件正文（`journey.day` 里那一句），
 * 一个换行就能把那条正文劈成两段，读起来像两个人各说了一句；
 * 而 `\\r\\n` 在某些前端里还会让那一行变成空白。
 *
 * 服务端已经清过一道（`clean()` 去掉 `\u0000-\u001f`），但这是**第二道**：
 * 旧版服务端、或者以后谁改松了那边，都不该让一个换行漏到她眼前。
 */
const flat = (s: unknown, max: number): string => String(s ?? '')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const okUidLike = (s: string): boolean => /^[a-f0-9]{20,64}$/i.test(s);

/**
 * 服务端回的「见面城」。
 *
 * **三种来路都要接住**：新服务端给了城市 id；老服务端压根没这个字段（`undefined`）；
 * 以及老数据那一列是空串。三种一律归成空串 = 「就在目的地见」，也就是加了见面城之前的行为。
 *
 * 另外，见面城和目的地相同时也归成空串 —— 「在成都见面然后一起去成都」不是两件事。
 */
const meetOf = (raw: unknown, to: string): string => {
  const m = flat(raw, 40);
  return m && m !== to ? m : '';
};

/** 服务端回的流速。钳到 0–240，0 = 没报。 */
const paceOf = (raw: unknown): number => {
  const n = Math.round(Number(raw) || 0);
  return n > 0 ? Math.min(240, n) : 0;
};

/**
 * 把服务端回的一行揉成 `Invite`。**不合法就回 `null`。**
 *
 * 2026-11-07 之前这段在三个地方各抄了一遍（池子列表、`/status`、`mine=1`），
 * 加一个字段就要改三处 —— 这正是「改了等于没改」最容易发生的样子。
 * 现在只有这一份，三处都调它。
 *
 * **没有合法 id 的条目直接丢掉。** 老实现可能只回了 `ok` 和名字，
 * 留着它，列表里就会出现一行 `id=`，她照着念、照着传，永远接不上，
 * 而她不知道自己错在哪。列表里不该出现「看见了但接不了」的东西。
 */
const toInvite = (x: unknown): Invite | null => {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = String(o.id ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const pet = flat(o.pet, 24);
  const to = flat(o.to, 40);
  if (!pet || !to) return null;
  return {
    id: id.slice(0, 32),
    pet,
    to,
    days: Math.min(30, Math.max(1, Math.round(Number(o.days) || 1))),
    note: flat(o.note, 60),
    meetCity: meetOf(o.meet, to),
    pace: paceOf(o.pace),
  };
};

/** 一次最多看三条 —— 服务端也只会回这么多，这里再挡一道，防止老服务端回整池。 */
const toInvites = (raw: unknown): Invite[] => {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(toInvite).filter((x): x is Invite => x !== null).slice(0, 3);
};

/**
 * 服务端那边先说了什么，就按它说的来。
 *
 * 为什么不用状态码当唯一判据：同一个 400 在发和接两条路上意思完全不同
 * （发是「字段不合规」，接是「自己发的不能自己接」）。服务端已经把语义写在
 * `error` 里了，再自己按码猜一遍就是重复发明，而且会猜错。
 */
const WHY: Record<string, string> = {
  'own invite': '这是她自己发的，接不了',
  taken: '慢了一步，已经被别人接了',
  gone: '这条已经不在服务器上了',
  expired: '这条已经过期了',
  'too many': '今天的额度用完了',
  /*
   * `bad fields` / `bad query` 这两句其实**只有一种来路**：打到了旧版服务端。
   *
   * 2026-11-05 实测过：腾讯云的 HTTP 访问服务会把 `/sight/invite` 也转给那个
   * 只实现了碰面的旧函数，它按「报我在哪」的规则验字段，于是邀约请求被判成
   * 「字段不对」。客户端自己会先验一遍格式，所以正常的请求不可能真的拼错 ——
   * 换句话说，看见这两个词，八成是服务器没升级。
   */
  'bad fields': '服务器不认这条请求 —— 多半是那台还是旧版，只实现了碰面',
  'bad query': '服务器不认这条请求 —— 多半是那台还是旧版，只实现了碰面',
  'bad json': '请求体没拼对，服务器没收',
};

/**
 * 连服务端都够不着时说什么 —— 现在由 `netFail()` / `explainNet()` 生成。
 *
 * 原来这里是一个固定常量「没连上碰面服务器」。2026-11-13 撤掉它：
 * 同一句话盖着六种不同的失败，用户只能推「地址没填对」，我们也查不下去。
 */

/**
 * 一个响应该说成什么。
 *
 * **404 / 405 / 501 单独认。** 这三个不是「这条邀约出问题了」，是**这台服务器
 * 根本没有邀约这个功能** —— 旧版云函数只实现了 GET/POST `/sight`，
 * 填的还是那个地址的人会一路 404。把这两种混成一句「操作失败」，
 * 用户唯一能得出的结论是「这个功能坏了」，而实际只是他那边没升级。
 */
function whyNot(status: number, error: string): string {
  const known = WHY[error];
  if (known) return known;
  if (status === 404 || status === 405 || status === 501) {
    return '这台服务器上还没有邀约功能，装的是旧版服务端';
  }
  if (status === 429) return '今天的额度用完了';
  if (status === 409) return '慢了一步，已经被别人接了';
  if (status === 410) return '这条已经过期了';
  if (status >= 500) return '服务器那边出了点问题，过一会儿再试';
  return `服务器回了 ${status}`;
}

/**
 * 把响应体读成 `{ok, error, raw}`。
 *
 * **只读一次。** 响应体是流，读两遍第二遍就是空的 —— 这里返回 `raw` 一起交出去，
 * 调用方不要再自己 `res.json()` 一遍，否则拿到的是 `{}`，然后「服务器回了空」
 * 这种错会一路显得像服务端的问题。
 *
 * 读不出来（旧服务器对任何路径都回 HTML）就当没连上。
 */
async function readBody(res: Response): Promise<{ ok: boolean; error: string; raw: Record<string, unknown> | null }> {
  try {
    const body = await res.json() as Record<string, unknown> | null;
    const raw = body && typeof body === 'object' ? body : null;
    return {
      ok: raw?.ok === true,
      error: typeof raw?.error === 'string' ? raw.error : '',
      raw,
    };
  } catch {
    return { ok: false, error: '', raw: null };
  }
}

/**
 * 发一条邀约：我在这个城，想有个谁一起去那座城，待几天。
 *
 * **不指名。** 系统里没有好友关系，也没有「发给谁」这个概念 ——
 * 谁这会儿在同一座城、谁看见了，就是谁。这是设计，不是省事：
 * 指名要先把人认出来，那就要有账号、有权限、有审核。
 */
export async function sendInvite(
  opt: MeetOptions,
  args: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
    readonly note: string;
    /**
     * 约在哪儿见面。**不传 = 就在目的地见**（加了见面城之前的老口径）。
     *
     * 2026-11-07 起，参数从五个位置参数改成一个对象 —— 这是被逼的：
     * `subject`、`negative` 两次事故都是「可选参数有合法默认值、漏传不报错、
     * 表现成改了等于没改」。位置参数越多，下一次漏传越是必然。
     */
    readonly meetCity?: string;
    /** 她那边的世界流速。传了别人才知道能不能赴约。 */
    readonly pace?: number;
  },
): Promise<{ ok: true; id: string } | InviteFail> {
  const fromCityId = args.from;
  const toCityId = args.to;
  const days = args.days;
  const note = args.note;
  /* 见面城和目的地相同时等于没约这一级，发空串 —— 服务端的「空 = 就在 to 见」就够用了。 */
  const meetCity = clean(args.meetCity ?? '');
  const meet = meetCity && meetCity !== toCityId ? meetCity : '';
  const pace = Math.min(240, Math.max(1, Math.round(Number(args.pace) || 1)));
  const url = clean(opt.url);
  if (!url || !clean(opt.uid) || !clean(opt.pet)) return { ok: false, reason: '没配碰面服务器' };
  try {
    const res = await fetch(`${endpointOf(url)}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: clean(opt.uid),
        pet: clean(opt.pet).slice(0, 24),
        from: fromCityId,
        to: toCityId,
        days: Math.min(30, Math.max(1, Math.round(days) || 1)),
        // 一句话：压成一行再发。换行在别人那边会变成两段，读着像两个人说的。
        note: flat(note, 60),
        meet,
        pace,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    // 老实现可能只回 ok 不回 id —— 那也算发成了，只是她自己接不了自己这条。
    const id = typeof body.raw?.id === 'string' ? body.raw.id.slice(0, 32) : '';
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: netFail(e) };
  }
}

/**
 * 看看同城有没有人正在找人一起走。
 *
 * `cityId` 是**她现在待的城市**：服务端按「发起人所在城」筛，
 * 所以拉得到的是「这儿的谁想出去」，不是「谁想来找她」。
 */
export async function listInvites(
  opt: MeetOptions,
  cityId: string,
): Promise<{ ok: true; list: Invite[] } | InviteFail> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { ok: false, reason: '没配碰面服务器' };
  const q = new URLSearchParams({ city: cityId, uid: clean(opt.uid) });
  try {
    const res = await fetch(`${endpointOf(url)}/invite?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    const list = body.raw?.list;
    if (!Array.isArray(list)) return { ok: true, list: [] };
    return {
      ok: true,
      list: toInvites(list),
    };
  } catch (e) {
    return { ok: false, reason: netFail(e) };
  }
}

/**
 * 一次拿齐「池子多大」和「谁在找伴」。
 *
 * ## 为什么合成一个请求
 *
 * 2026-11-06 算的账：原来池子 20 分钟一问、邀约 30 分钟一问，**一只鱼一天 120 次请求**。
 * Cloudflare 免费额度 10 万/天 —— 800 只鱼就撞墙。而这两样都是「顺手一问」，
 * 服务端加了 `/sight/status` 一起回，客户端间隔拉到 60 分钟，一天 24 次，同样额度撑 4000 只。
 *
 * ## 为什么不带 mine=1
 *
 * 「谁接了她的话」是一次性认领（服务端收到就勾 `seen=1`），必须单独走 `/invite?mine=1`。
 * 混进这个「随便看一眼」的请求里，就成了「顺手刷新把约定认领了」。
 */
export async function fetchStatus(
  opt: MeetOptions,
  cityId: string,
): Promise<{ ok: true; pool: number; invites: Invite[]; mineTaken: number } | InviteFail> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { ok: false, reason: '没配碰面服务器' };
  const q = new URLSearchParams({ city: cityId, uid: clean(opt.uid) });
  try {
    const res = await fetch(`${endpointOf(url)}/status?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    return {
      ok: true,
      pool: Math.max(0, Math.floor(Number(body.raw?.pool) || 0)),
      invites: toInvites(body.raw?.list),
      /*
       * 我发出去的邀约被接过几次（2026-11-14）。**只给数，不给是谁** ——
       * 「谁接了」一旦能查到就变成社交账本，跟「不回应 = 没看见」冲突。
       * 旧服务端不回这个字段，按 0 处理。
       */
      mineTaken: Math.max(0, Math.floor(Number(body.raw?.mineTaken) || 0)),
    };
  } catch (e) {
    return { ok: false, reason: netFail(e) };
  }
}

/**
 * 接下一条。
 *
 * 成功回的是**行程要用的事**：跟谁、去哪、几天。发起者的 uid 不在里面 ——
 * 服务端也没给。
 *
 * 并发靠服务端的条件更新（`taken_by = ''`）兜着：两个人同时接，只有一个拿得到 200，
 * 另一个是 409。客户端这边不需要加锁，也不该加。
 */
/**
 * 「我发的邀约，有人接了没有。」
 *
 * 2026-11-05 Mr.Q：「发完邀请两条鱼一起去一个地方」。原来只有**接的人**会得到一个约定，
 * 发起者永远不知道有没有人应 —— 于是「一起」不可能发生。这里补的就是发起者那半边：
 * 认领一条结果，他也往那座城走，到了各待同样的天数（谁先到谁等）。
 *
 * 服务端用 `owner_seen` 保证只返回一次，不会每次排表都重复建约定。
 */
export async function myTakenInvites(
  opt: MeetOptions,
): Promise<{ ok: true; list: Invite[] } | InviteFail> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { ok: false, reason: '没配碰面服务器' };
  const q = new URLSearchParams({ uid: clean(opt.uid), mine: '1' });
  try {
    const res = await fetch(`${endpointOf(url)}/invite?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    return { ok: true, list: toInvites(body.raw?.list) };
  } catch (e) {
    return { ok: false, reason: netFail(e) };
  }
}

export async function acceptInvite(
  opt: MeetOptions,
  id: string,
): Promise<{
  readonly ok: true;
  readonly withPet: string;
  readonly to: string;
  readonly days: number;
  readonly note: string;
  /** 约在哪儿见面。空 = 就在 `to` 见（老服务端 / 老数据）。 */
  readonly meetCity: string;
  /** 对方的流速。0 = 没报。 */
  readonly pace: number;
} | InviteFail> {
  const url = clean(opt.url);
  if (!url || !okUidLike(clean(opt.uid))) return { ok: false, reason: '没配碰面服务器' };
  /*
   * 编号从她传进来的那串里**抠出来**，不要求原样。
   *
   * 她会把列表里那行连名带姓地抄过来（「- 小满 想去拉萨… id=abcdef0123456789」），
   * 也可能前后多一个空格或引号。因为格式问题拒掉一条她明明看对了的邀约，
   * 对她来说是「我按你说的做了，你说不对」，这个体验比放宽判定糟得多。
   *
   * 16 位十六进制在一条列表里唯一，抠错的风险可以忽略。
   */
  const got = /[a-f0-9]{16}/i.exec(clean(id).slice(0, 200));
  const inviteId = got ? got[0].toLowerCase() : '';
  if (!inviteId) return { ok: false, reason: '这条邀约的编号不对' };
  try {
    const res = await fetch(`${endpointOf(url)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 带上自己的名字：服务端要把它写进 taken_pet，发起者才知道「谁接了」。
      body: JSON.stringify({ uid: clean(opt.uid), id: inviteId, pet: clean(opt.pet).slice(0, 24) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    const b = body.raw ?? {};
    const pet = flat(b.with, 24);
    const to = typeof b.to === 'string' ? b.to.slice(0, 40) : '';
    if (!pet || !to) return { ok: false, reason: '服务器回的内容缺了「跟谁、去哪」' };
    return {
      ok: true,
      withPet: pet,
      to,
      days: Math.min(30, Math.max(1, Math.round(Number(b.days) || 1))),
      note: flat(b.note, 60),
      meetCity: meetOf(b.meet, to),
      pace: paceOf(b.pace),
    };
  } catch (e) {
    return { ok: false, reason: netFail(e) };
  }
}

/**
 * 把邻居揉成一句话。
 *
 * **纯函数，好测。** 文案的规矩：
 * - 不提「用户」「服务器」「别人也养了」—— 那是把世界观捅破；
 * - 不说「遇见」「认识」—— 她们没有交流，只是**在同一处**；
 * - 三个人的干的事要分开说，不能糊成「一起玩」。
 *
 * 一个都不返回 `null`，调用方据此决定要不要加这一句。
 */
export function neighborLine(list: readonly Neighbor[]): string | null {
  const who = list.filter((n) => clean(n.pet));
  if (!who.length) return null;

  const names = who.map((n) => n.pet);
  const named =
    names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]}和${names[1]}`
    : `${names.slice(0, -1).join('、')}和${names[names.length - 1]}`;

  // 干的事如果有，就分开报；全空就只说人在。
  const doings = who.map((n) => clean(n.doing)).filter(Boolean);
  if (!doings.length) return `${named}也在这一带。`;

  if (who.every((n) => clean(n.doing))) {
    /*
     * 只有一个人时不说「一个」—— 那是给并列用的量词，一个人身上很怪：
     * 「大肥鱼也在这儿，一个在城墙上吹风。」读着像他有三个人。
     *
     * 三个人时每个人都要说到。原来只拼了 `who[0]` 和 `who[1]`，
     * 第三个人的事被静默丢掉 —— 而服务端一次正好回三个，
     * 三个人同时在同城同时段是正常情况，不是边界。
     */
    if (who.length === 1) return `${named}也在这儿，${clean(who[0].doing)}。`;
    const each = who.map((n) => `一个${clean(n.doing)}`).join('，');
    return `${named}也在这儿，${each}。`;
  }
  return `${named}也在这一带。`;
}

/**
 * 把同城的邀约揉成一句话。
 *
 * **纯函数。** 只报事实（谁、想去哪、几天），不写成命令（「快去接」）。
 * 接不接是她的事，这句话只负责让她知道有这么回事 —— 不然她永远不会想起去问。
 *
 * 城市名由调用方翻好再传进来（`meet.ts` 不认城市表，那是 `geo/` 的活）。
 */
export function inviteLine(
  list: readonly { pet: string; toName: string; days: number; note: string }[],
): string | null {
  const who = list.filter((x) => clean(x.pet) && clean(x.toName));
  if (!who.length) return null;
  const one = (x: typeof who[number]): string =>
    `${clean(x.pet)}想去${clean(x.toName)}，在那儿待 ${x.days} 天`
    + (clean(x.note) ? `（原话是「${clean(x.note)}」）` : '');
  if (who.length === 1) return `同城有人发了句话：${one(who[0])}。`;
  return `同城有人发了话：${who.map(one).join('；')}。`;
}

/**
 * 这一带的人里，有哪些是**以前一起走过**的。
 *
 * ## 为什么要单独一条，不塞进 `neighborLine`
 *
 * `neighborLine` 说的是「谁在这儿」。这是「我跟她有过什么」——两件事，
 * 混在一句里会变成「小满也在这儿（一起走过 2 次），在城墙上吹风」，
 * 括号夹在中间，读起来像备注，她转述时也会照着这个括号写。
 *
 * 而且分开之后各管各的：`neighborLine` 一个字不用改，这条是新加的，
 * 谁出问题都不牵连另一半。
 *
 * ## 为什么只报到站那一条事件
 *
 * 这个函数每次重建日程都会被调。要是跟着每天的 `journey.day` 一起发，
 * 同城待五天她就被提醒五遍「跟小满走过 2 次」——第三天开始就成了噪音。
 * 到站那一刻说一次就够：落地、放下包、看见熟面孔。
 *
 * 传空表（还没记忆）返回 null，事件正文一个字不多。
 */
export interface KnownPet {
  readonly times?: number;
  readonly warmth?: number;
  readonly last?: string;
  readonly impression?: string;
}

export function knownNeighborLine(
  list: readonly Neighbor[],
  known: Readonly<Record<string, KnownPet | undefined>>,
): string | null {
  const hits = list
    .map((n) => ({ pet: clean(n.pet), m: known[clean(n.pet)] }))
    .filter((x): x is { pet: string; m: KnownPet } => !!x.pet && !!x.m && (x.m.times ?? 0) >= 1);
  if (!hits.length) return null;

  const one = (pet: string, m: KnownPet): string => {
    const times = Math.max(1, Math.floor(Number(m.times) || 1));
    const last = String(m.last ?? '').trim();
    // 只报月日：年份在「上次」这个语境里没用，还多占两个字。
    const when = /^\d{4}-\d{2}-\d{2}$/.test(last) ? `，最近一次 ${last.slice(5)}` : '';
    /*
     * 印象是她自己写的，这里原样带回去 —— 那是她的判断，不该由代码改写。
     * 但有就不重复说「你对她的印象是」这种啰嗦话，直接给引号。
     */
    const imp = String(m.impression ?? '').trim();
    return `跟${pet}一起走过 ${times} 次${when}${imp ? `，你的印象是「${imp.slice(0, 40)}」` : ''}`;
  };

  return `${hits.slice(0, 3).map((h) => one(h.pet, h.m)).join('；')}。`;
}

/* ---------------- 同行卡（2026-11-11） ---------------- */

/**
 * 一段同行里，别人留给我的一张卡。
 *
 * **没有 uid。** 服务端刻意不回 —— 名字、「她的话」、「他留的号」，够了。
 * 一旦把 uid 放出来，它就能被拿去反查 presence、串起一个人所有的行程。
 * 这条和 `Invite` 不带发起者 uid 是同一条线。
 */
export interface PartyCard {
  readonly pet: string;
  /** 她写的那句话。空串 = 只留了号，没写字。 */
  readonly note: string;
  /** 对方留的号。空串 = 没填，那就只能用名字记着了。 */
  readonly contact: string;
  /** 留卡的时刻（ISO，真实时间）。 */
  readonly at: string;
}

/**
 * 留一张卡。
 *
 * 两个字段都可以空一半：只写话、只留号、两个都有。**两个都空会被服务端拒** ——
 * 那等于在别人那儿挂一张空白，没有意义。
 *
 * 重复提交是覆盖，不是新增：同一段同行里一个人只有一张卡。
 *
 * 失败一律返回 false，不抛 —— 跟碰面、邀约同一条规矩：
 * 网络问题不该让她的旅行停下来，也不该糊到用户脸上。
 */
export async function putCard(
  opt: MeetOptions,
  inviteId: string,
  note: string,
  contact: string,
): Promise<boolean> {
  const url = clean(opt.url);
  const id = clean(inviteId).toLowerCase();
  if (!url || !okUidLike(clean(opt.uid)) || !/^[a-f0-9]{16}$/.test(id)) return false;
  if (!clean(note) && !clean(contact)) return false;
  try {
    const res = await fetch(`${endpointOf(url)}/card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: clean(opt.uid),
        id,
        pet: clean(opt.pet).slice(0, 24),
        note: clean(note).slice(0, 40),
        contact: clean(contact).slice(0, 40),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 取同一段同行里别人留的卡。
 *
 * **失败返回空数组，不返回错误。** 调用方要显示的是「这一趟有没有人留话」，
 * 「没人留」和「没连上」在界面上本来就该长一样 —— 为后者单独做一个报错，
 * 只会在服务器抖动时吓用户一跳。
 */
export interface CardBoard {
  /** 别人留的。空的 `pet` 或全空的卡已经滤掉。 */
  readonly cards: readonly PartyCard[];
  /** 自己留的那张。`null` = 还没留。改的时候要拿它回填。 */
  readonly mine: { readonly note: string; readonly contact: string } | null;
}

/** 取不到时给这个，调用方不用判空。 */
export const EMPTY_BOARD: CardBoard = { cards: [], mine: null };

const cardOf = (raw: unknown): PartyCard | null => {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  const card: PartyCard = {
    pet: clean(x.pet).slice(0, 24),
    note: clean(x.note).slice(0, 40),
    contact: clean(x.contact).slice(0, 40),
    at: clean(x.at).slice(0, 32),
  };
  return card.pet && (card.note || card.contact) ? card : null;
};

export async function fetchCards(opt: MeetOptions, inviteId: string): Promise<CardBoard> {
  const url = clean(opt.url);
  const id = clean(inviteId).toLowerCase();
  if (!url || !okUidLike(clean(opt.uid)) || !/^[a-f0-9]{16}$/.test(id)) return EMPTY_BOARD;
  try {
    const q = new URLSearchParams({ id, uid: clean(opt.uid) });
    const res = await fetch(`${endpointOf(url)}/card?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return EMPTY_BOARD;
    const body = (await res.json()) as { cards?: unknown; mine?: unknown };
    /*
     * 只认四样，多的丢掉 —— 和服务端「不回 uid」是同一个意思的两头：
     * 那边不给，这边也不收。中间真出过什么，都进不了她的世界。
     */
    const cards = Array.isArray(body.cards)
      ? body.cards.map(cardOf).filter((x): x is PartyCard => !!x).slice(0, 8)
      : [];
    const m = body.mine && typeof body.mine === 'object' ? (body.mine as Record<string, unknown>) : null;
    const mine = m
      ? { note: clean(m.note).slice(0, 40), contact: clean(m.contact).slice(0, 40) }
      : null;
    return { cards, mine };
  } catch {
    return EMPTY_BOARD;
  }
}

/* ---------------- 名片（2026-11-11） ---------------- */

/**
 * 一张**别人**的名片。
 *
 * 和 `PartyCard` 的区别：卡是「某一段的临别留言」，名片是「这个人本身」。
 * 所以这里没有 `contact` —— 名片那一段字里可以写花语乡/星邮/客厅的 id，
 * 但它是一段话，不是一个字段。
 */
export interface PeerProfile {
  readonly pet: string;
  /** 那段自我介绍。 */
  readonly text: string;
  readonly at: string;
}

export interface ProfileBoard {
  /** 自己的那张。`null` = 还没写。 */
  readonly mine: { readonly text: string } | null;
  /** 一起走过的人写的。陌生人不会出现在这里 —— 服务端就查不到。 */
  readonly others: readonly PeerProfile[];
}

export const EMPTY_PROFILE_BOARD: ProfileBoard = { mine: null, others: [] };

/**
 * 写名片的结果。
 *
 * **为什么不是布尔**（2026-11-12）：手书无愧来信「名片一直保存不了，总说没连上，
 * 试了一天只成功过一两次」。`putProfile` 原来只回 `res.ok`，超时、DNS、400 `bad fields`、
 * 500 `server error` 四种完全不同的失败被压成同一句「没连上」——
 * 用户替我们查了一天，我们一个字的证据都没拿到。
 *
 * 现在把状态码和服务端那句 `error` 原样带出来。
 */
export interface PutProfileResult {
  readonly ok: boolean;
  /** 失败时说清楚是哪一种。 */
  readonly reason?: string;
}

/**
 * 写自己的名片。传空串就是**撤回**。
 *
 * 撤回这个动作必须有：用户能写就该能收回去，等 30 天过期不是「删除」，
 * 那是「等着它自己烂掉」。
 */
export async function putProfile(opt: MeetOptions, text: string): Promise<PutProfileResult> {
  const url = clean(opt.url);
  if (!url || !okUidLike(clean(opt.uid))) {
    return { ok: false, reason: '碰面地址或 uid 没填全（名片存在服务器上）' };
  }
  try {
    const res = await fetch(`${endpointOf(url)}/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: clean(opt.uid),
        pet: clean(opt.pet).slice(0, 24),
        text: clean(text).slice(0, 120),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    /*
     * 服务端把原因写在 body 的 `error` 里（`bad fields` / `server error`）。
     * 读出来再报，不然 500 和 400 在用户眼里长得一模一样。
     */
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `服务器回了 ${res.status}${body ? `：${body.slice(0, 80)}` : ''}`,
    };
  } catch (e) {
    // 2026-11-13：原来只认 TimeoutError，其余一律「请求发不出去」—— DNS、证书、
    // 地址没写协议全都挤在这一句里，等于什么都没说。统一交给 explainNet。
    return { ok: false, reason: explainNet(e) };
  }
}

/**
 * 取自己的名片 + 一起走过的人的名片。
 *
 * 失败给空板。「没人写过」和「没连上」在界面上本来就该长一样 ——
 * 为后者单独报错，只会在服务器抖动时吓用户一跳。
 */
export async function fetchProfiles(opt: MeetOptions): Promise<ProfileBoard> {
  const url = clean(opt.url);
  if (!url || !okUidLike(clean(opt.uid))) return EMPTY_PROFILE_BOARD;
  try {
    const q = new URLSearchParams({ uid: clean(opt.uid) });
    const res = await fetch(`${endpointOf(url)}/profile?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return EMPTY_PROFILE_BOARD;
    const body = (await res.json()) as { mine?: unknown; others?: unknown };
    const m = body.mine && typeof body.mine === 'object' ? (body.mine as Record<string, unknown>) : null;
    const mine = m ? { text: clean(m.text).slice(0, 120) } : null;
    const others = Array.isArray(body.others)
      ? body.others
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          pet: clean(x.pet).slice(0, 24),
          text: clean(x.text).slice(0, 120),
          at: clean(x.at).slice(0, 32),
        }))
        .filter((x) => x.pet && x.text)
        .slice(0, 20)
      : [];
    return { mine: mine && mine.text ? mine : null, others };
  } catch {
    return EMPTY_PROFILE_BOARD;
  }
}
