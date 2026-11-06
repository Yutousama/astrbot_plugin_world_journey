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
  const base = clean(url).replace(/\/+$/, '');
  return base.endsWith('/sight') ? base : `${base}/sight`;
};

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
}

export async function findNeighbors(
  opt: MeetOptions,
  cityId: string,
  dateKey: string,
  slot: Slot,
): Promise<NeighborBoard> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { list: [], pool: 0 };
  const q = new URLSearchParams({
    city: cityId,
    date: dateKey,
    slot,
    exclude: clean(opt.uid),
    limit: String(MEET_MAX - 1),
  });
  try {
    const res = await fetch(`${endpointOf(url)}?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { list: [], pool: 0 };
    const body = (await res.json()) as { list?: unknown; pool?: unknown };
    if (!Array.isArray(body.list)) return { list: [], pool: 0 };
    const pool = typeof body.pool === 'number' && body.pool > 0 ? Math.floor(body.pool) : 0;
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
        .slice(0, MEET_MAX - 1),
      pool,
    };
  } catch {
    return { list: [], pool: 0 };
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

/** 连服务端都够不着时，唯一能说的一句。 */
const UNREACHABLE = '没连上碰面服务器';

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
  fromCityId: string,
  toCityId: string,
  days: number,
  note: string,
): Promise<{ ok: true; id: string } | InviteFail> {
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
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    // 老实现可能只回 ok 不回 id —— 那也算发成了，只是她自己接不了自己这条。
    const id = typeof body.raw?.id === 'string' ? body.raw.id.slice(0, 32) : '';
    return { ok: true, id };
  } catch {
    return { ok: false, reason: UNREACHABLE };
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
      list: list
        .filter((x): x is Invite => !!x && typeof x === 'object'
          && typeof (x as Invite).id === 'string'
          && typeof (x as Invite).pet === 'string'
          && typeof (x as Invite).to === 'string')
        /*
         * **没有 id 的条目直接丢掉。**
         *
         * 老实现可能只回了 `ok` 和名字 —— 留着它，列表里就会出现一行
         * `id=`，她照着念、照着传，永远接不上，而她不知道自己错在哪。
         * 列表里不该出现「看见了但接不了」的东西。
         */
        .filter((x) => /^[a-f0-9]{16}$/i.test(String(x.id).trim()))
        .map((x) => ({
          id: String(x.id).trim().toLowerCase().slice(0, 32),
          pet: flat(x.pet, 24),
          to: flat(x.to, 40),
          days: Math.min(30, Math.max(1, Math.round(Number(x.days) || 1))),
          note: flat(x.note, 60),
        }))
        .filter((x) => x.pet && x.to)
        .slice(0, 3),
    };
  } catch {
    return { ok: false, reason: UNREACHABLE };
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
): Promise<{ ok: true; pool: number; invites: Invite[] } | InviteFail> {
  const url = clean(opt.url);
  if (!url || !clean(opt.uid)) return { ok: false, reason: '没配碰面服务器' };
  const q = new URLSearchParams({ city: cityId, uid: clean(opt.uid) });
  try {
    const res = await fetch(`${endpointOf(url)}/status?${q}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readBody(res);
    if (!res.ok || !body.ok) return { ok: false, reason: whyNot(res.status, body.error) };
    const raw = body.raw?.list;
    const list = Array.isArray(raw) ? raw : [];
    return {
      ok: true,
      pool: Math.max(0, Math.floor(Number(body.raw?.pool) || 0)),
      invites: list
        .filter((x): x is Invite => !!x && typeof x === 'object'
          && typeof (x as Invite).id === 'string'
          && typeof (x as Invite).pet === 'string'
          && typeof (x as Invite).to === 'string')
        // 没有合法 id 的条目直接丢：列表里不该出现「看见了但接不了」的东西。
        .filter((x) => /^[a-f0-9]{16}$/i.test(String(x.id).trim()))
        .map((x) => ({
          id: String(x.id).trim().toLowerCase().slice(0, 32),
          pet: flat(x.pet, 24),
          to: flat(x.to, 40),
          days: Math.min(30, Math.max(1, Math.round(Number(x.days) || 1))),
          note: flat(x.note, 60),
        }))
        .filter((x) => x.pet && x.to)
        .slice(0, 3),
    };
  } catch {
    return { ok: false, reason: UNREACHABLE };
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
    const list = body.raw?.list;
    if (!Array.isArray(list)) return { ok: true, list: [] };
    return {
      ok: true,
      list: list
        .filter((x): x is Invite => !!x && typeof x === 'object'
          && typeof (x as Invite).id === 'string'
          && typeof (x as Invite).pet === 'string'
          && typeof (x as Invite).to === 'string')
        .map((x) => ({
          id: x.id.slice(0, 32),
          pet: x.pet.slice(0, 24),
          to: x.to.slice(0, 40),
          days: Number.isFinite(Number(x.days)) ? Math.min(30, Math.max(1, Math.round(Number(x.days)))) : 1,
          note: typeof x.note === 'string' ? x.note.slice(0, 60) : '',
        })),
    };
  } catch {
    return { ok: false, reason: '没连上碰面服务器' };
  }
}

export async function acceptInvite(
  opt: MeetOptions,
  id: string,
): Promise<{ ok: true; withPet: string; to: string; days: number; note: string } | InviteFail> {
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
    };
  } catch {
    return { ok: false, reason: UNREACHABLE };
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
