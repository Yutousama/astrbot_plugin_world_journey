/*
 * 「她此刻」和「照片」两个页签。
 *
 * 原生 ES module，不打包：宿主按 URL import 这个文件，浏览器直接跑。
 * 契约只有一条 —— default 导出 { panels: { <panelId>: { mount(ctx) } } }。
 *
 * 不引任何框架：这里要画的东西不到三百行，为它引一个运行时，
 * 换来的是迟早要处理的一次版本冲突。
 */

const TEXT = {
  zh: {
    eyebrow: '她此刻',
    statusHome: '在家',
    statusRest: '在家歇着',
    statusTraveling: '在路上',
    statusStaying: '在目的地',
    statusUnknown: '状态不明',
    next: '接下来',
    weather: '天气',
    feel: '体感',
    lodging: '今晚',
    sunrise: '日出',
    nextNone: '今天的点都过完了，该睡了。',
    legLeft: '还有',
    legEta: '到站当地',
    legKm: '公里',
    tripDays: '第 {n} 天',
    visited: '去过 {n} 个地方',
    spent: '花销 {n}',
    budgetLeft: '预算还剩 {n}',
    diary: '日记 {n} 天',
    working: '打工',
    workLeft: '还差 {n} 天',
    workLastDay: '今天收工',
    diaryBroken: '日记目录写不进去',
    diarySynced: '日记与旅行记忆存在这儿（两台电脑填同一个）',
    speed: '{n}× 速度',
    clockSame: '和你的时间一致',
    clockAheadM: '比你快 {m} 分钟',
    clockAheadH: '比你快 {h} 小时',
    clockAheadDay: '比你快 {d} 天',
    clockAheadD: '比你快 {d} 天 {h} 小时',
    clockBehindM: '比你慢 {m} 分钟',
    clockBehindH: '比你慢 {h} 小时',
    clockBehindDay: '比你慢 {d} 天',
    clockBehindD: '比你慢 {d} 天 {h} 小时',
    sync: '同步',
    syncing: '同步中…',
    syncTitle: '把她的日子拉回到你此刻。倍速不变，过一阵还会再拉开。',
    returnHome: '叫她回来',
    resetSpeed: '恢复正常',
    resetSpeedTitle: '把倍速调回 1×，顺便把她的日子拉回你此刻。',
    returning: '正在回来',
    returnTitle: '让她结束这一趟往回走。一站一站走回来，路上照写日记，不是瞬间到家。',
    weatherOut: '她的日期超出预报窗口',
    homeAt: '家 · {n}',
    homeFrom: '从 {n} 出发',
    tripFrom: '这一趟从',
    musicOn: '在放',
    wishList: '想去',
    /*
     * 联机那一行（2026-11-05）。没有服务器时整行不出现；
     * 有服务器、但同城没人时**也要显示**「暂时没别人」——
     * 不然用户填完地址什么变化都没有，会以为没生效。
     */
    nearby: '同城',
    pool: '池子',
    poolN: '今天一共 {n} 只',
    meetTitle: '碰面：和别人的鱼一起走一段',
    meetLead: '填一个公共地址，她到站会看一眼这一带还有谁；想找人一起走，跟她说一声就行。',
    meetHint: '下面这个是我这边一直开着的，填进设置里的「碰面地址」就能用：',
    meetCopy: '复制地址',
    nearbyNone: '这段时间没别人',
    nearbyN: '{n} 个也在这一带',
    invites: '找伴',
    invitesN: '{n} 个在找伴',
    pledge: '约好',
    pledgeHere: '{who} · 还剩 {n} 天',
    pledgeAway: '{who} · 说好去 {city}',
    homeTitle: '她在家',
    askToggle: '出门等我点头',
    departBtn: '让她出发',
    departSelf: '什么时候走，她自己定。',
    departWait: '她在家等着 —— 按一下就上路。',
    // 休息期里按钮照样能按 —— 按一下就是「不等了，现在就走吧」。
    departRest: '她还在歇（原说到 {n}）。按了就现在走。',
    departBusy: '这会儿动不了（没找到能去的地方）。',
    departErr: '没走成',
    askTitle: '她在等你点头',
    askGo: '好',
    askNo: '不好',
    askHint: '她不会自己去。答「好」才算数。',
    guideTitle: '第一次来，先把这三件事说清',
    guide1Title: '她在另一个时区过日子',
    guide1Body: '上面那个钟是**她那边的**时间。她按当地时间吃饭、睡觉、出门 —— 你这边几点跟她没关系。',
    guide2Title: '下一站她自己挑',
    guide2Body: '给她一两天，她会自己决定去哪、坐什么去、待几天。你不用安排，也不用催。',
    guide3Title: '你能做的三件事',
    guide3Body: '问她在哪（她会去查）、让她去某个地方、翻她写过的日记。剩下的交给时间。',
    guideDismiss: '知道了',
    guideReplay: '再看一次引导',
    albumTitle: '她拍的',
    albumEmpty: '还没有照片。配好生图接口之后，她出去逛会顺手拍一张。',
    albumHint: '一天一张，拍的是风景，不是她自己。',
    diaryTitle: '日记',
    diaryHint: '她每天写的那几段。左边选一天，右边读。',
    diaryEmpty: '还没有日记。她出门之后每天会写一段。',
    diaryFail: '读不出日记。看下面那个目录是不是还在。',
    photoDir: '原图在这',
    copyPath: '复制路径',
    copied: '已复制',
    shoot: '现在补一张',
    shooting: '在拍了…',
    photoSlow: '还没出来。十几秒后刷新一下看看 —— 没拍成的话，原因会写在下面。',
    shootSkip: '没拍成：',
    err: '读不出来。Core 可能刚重启，过一会儿再刷新。',
    /* ---- 反馈 ---- */
    fbLead: '有 bug，或者想让她去一个地方？',
    fbBug: '报个 bug',
    fbPlace: '想加个地点',
    fbCopy: '复制地址',
    fbOpen: '打开网页邮箱',
    fbCopied: '地址已复制',
    fbWhy: '按钮会把整封信复制下来 —— 收件人、主题、正文都在，粘到邮件里发出去就行。',
    fbWhere: '想加的地点写成「城市 + 地方名 + 一句为什么」就够了。',
  },
  en: {
    eyebrow: 'Right now',
    statusHome: 'Home',
    statusRest: 'Resting at home',
    statusTraveling: 'On the road',
    statusStaying: 'At the destination',
    statusUnknown: 'Unknown',
    next: 'Next',
    weather: 'Weather',
    feel: 'Feels',
    lodging: 'Tonight',
    sunrise: 'Sunrise',
    nextNone: 'Nothing left today. She is asleep.',
    legLeft: 'left',
    legEta: 'arrival local',
    legKm: 'km',
    tripDays: 'Day {n}',
    visited: '{n} places visited',
    spent: 'spent {n}',
    budgetLeft: '{n} of budget left',
    diary: '{n} diary days',
    working: 'Working',
    workLeft: '{n}d to go',
    workLastDay: 'last day',
    diaryBroken: 'Diary folder is not writable',
    diarySynced: 'Diary and travel memory live here (same path on both machines)',
    speed: '{n}× speed',
    clockSame: 'in step with you',
    clockAheadM: '{m}m ahead of you',
    clockAheadH: '{h}h ahead of you',
    clockAheadDay: '{d}d ahead of you',
    clockAheadD: '{d}d {h}h ahead of you',
    clockBehindM: '{m}m behind you',
    clockBehindH: '{h}h behind you',
    clockBehindDay: '{d}d behind you',
    clockBehindD: '{d}d {h}h behind you',
    sync: 'Sync',
    syncing: 'Syncing…',
    syncTitle: 'Pull her day back to right now. The speed stays the same, so it will drift again.',
    weatherOut: 'her date is past the forecast window',
    homeAt: 'home {n}',
    homeFrom: 'from {n}',
    tripFrom: 'this trip from',
    musicOn: 'Playing',
    wishList: 'Want to go',
    nearby: 'Around',
    pool: 'Pool',
    poolN: '{n} pets today',
    meetTitle: 'Meet up: travel a stretch with someone else\'s pet',
    meetLead: 'Add a public server and she will see who is around when she arrives; to travel together, just tell her.',
    meetHint: 'This one is always on — paste it into the "meet server" setting:',
    meetCopy: 'Copy address',
    nearbyNone: 'nobody else right now',
    nearbyN: '{n} others nearby',
    invites: 'Company',
    invitesN: '{n} looking for company',
    pledge: 'Agreed',
    pledgeHere: '{who} · {n}d left',
    pledgeAway: '{who} · off to {city}',
    homeTitle: 'She is home',
    askToggle: 'Wait for my go',
    departBtn: 'Send her off',
    departSelf: 'She decides when to leave.',
    departWait: 'She is waiting — one press and she goes.',
    departRest: 'She is still resting (until {n}). Press to send her now.',
    departBusy: 'She cannot head out right now.',
    departErr: 'Did not leave',
    askTitle: 'She is waiting on you',
    askGo: 'Go',
    askNo: 'Not now',
    askHint: 'She will not go on her own. Only a yes counts.',
    guideTitle: 'First time here — three things worth knowing',
    guide1Title: 'She lives in another time zone',
    guide1Body: 'That clock is **her** time. She eats, sleeps and goes out on local time — your hour means nothing to her.',
    guide2Title: 'She picks the next stop',
    guide2Body: 'Give her a day or two. She decides where to go and how to get there. You do not need to plan anything.',
    guide3Title: 'Three things you can do',
    guide3Body: 'Ask where she is, send her somewhere, or read her diary. The rest is just time.',
    guideDismiss: 'Got it',
    guideReplay: 'Show the guide again',
    albumTitle: 'Her photos',
    albumEmpty: 'No photos yet. Once an image endpoint is configured she will take one on her way out.',
    albumHint: 'One a day, of the scenery — never of herself.',
    diaryTitle: 'Diary',
    diaryHint: 'What she wrote, day by day. Pick a day on the left.',
    diaryEmpty: 'No entries yet — she starts writing once she is out there.',
    diaryFail: 'Could not read the diary. Check the folder below.',
    photoDir: 'Full-size files in',
    copyPath: 'Copy path',
    copied: 'Copied',
    shoot: 'Take one now',
    shooting: 'Shooting…',
    photoSlow: 'Not back yet. Refresh in a few seconds; if it failed, the reason shows below.',
    shootSkip: 'Did not shoot: ',
    err: 'Could not read. Core may have just restarted — try again in a moment.',
    /* ---- feedback ---- */
    fbLead: 'A bug, or a place you want her to go?',
    fbBug: 'Report a bug',
    fbPlace: 'Suggest a place',
    fbCopy: 'Copy address',
    fbOpen: 'Open webmail',
    fbCopied: 'Address copied',
    fbWhy: 'The button copies a whole letter - recipient, subject, body - ready to paste into any mail app.',
    fbWhere: 'A place just needs city + name + one line on why.',
  },
};

function text(lang) {
  return TEXT[String(lang || 'zh').startsWith('zh') ? 'zh' : 'en'];
}

/** `{n}` 占位。 */
function fmt(s, n) {
  return String(s).replace('{n}', String(n));
}

/**
 * 复制到剪贴板。
 *
 * 面板跑在宿主的 webview 里，`navigator.clipboard` 不一定有权限 ——
 * 所以留一条 `execCommand` 的旧路。两条都失败就当没复制，不抛错：
 * 复制不上不该让整个相册白屏。
 */
function copyText(s) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s);
    }
  } catch { /* 落到下面 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch { /* 复制不了就算了 */ }
  return Promise.resolve();
}

/** 多占位（`{d}`、`{h}`、`{m}`）。`fmt` 只认一个，这里另开一个，别把那个改坏。 */
function fill(s, map) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k]) : m));
}

/**
 * 「比你快 3 天 4 小时」。
 *
 * 三段分开写（分钟 / 小时 / 天+小时），是因为「比你快 0 小时」
 * 和「比你快 2 天 0 小时」这两种话一出来，用户会以为界面算错了。
 */
function driftText(T, ms) {
  const abs = Math.abs(Number(ms) || 0);
  if (abs < 60_000) return T.clockSame;
  const ahead = ms > 0;
  const mins = Math.round(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  if (mins < 60) return fill(ahead ? T.clockAheadM : T.clockBehindM, { m: mins });
  if (d === 0) return fill(ahead ? T.clockAheadH : T.clockBehindH, { h: hours });
  if (h === 0) return fill(ahead ? T.clockAheadDay : T.clockBehindDay, { d });
  return fill(ahead ? T.clockAheadD : T.clockBehindD, { d, h });
}

function el(tag, cls, txt) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = String(txt);
  return node;
}

/** 行内 `**重点**` → 加粗。只认这一种标记，不做 markdown。 */
function rich(node, s) {
  const parts = String(s).split(/\*\*(.+?)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) node.append(el('strong', null, part));
    else node.append(document.createTextNode(part));
  });
  return node;
}

/**
 * 面板底部的反馈栏。
 *
 * ## 为什么不是 mailto
 *
 * 第一版是两条 `mailto:` 链接。**点下去什么都不会发生** —— 宿主的
 * `setWindowOpenHandler` 只对 `http(s):` 调 `shell.openExternal`，其余一律 `deny`
 * （`resources/app/app/main.cjs`）。炉石那个扩展早踩过这个坑，注释里写着
 * 「mailto 点下去是静默无事发生，比没有按钮更糟」，我没先去看。
 *
 * 所以现在：**点按钮 = 把整封信复制到剪贴板**，再配一个打开网页邮箱的按钮（那才是 https）。
 * 收件人、主题、正文一次全给，粘过去就行。
 *
 * 另外两条没变：
 * 1. 没配邮箱就整块不显示 —— 一个点了没反应的按钮比没有更糟。
 * 2. 地址必须明文露出来。宿主连 mailto 都不放行，用户手里总得有能复制的字符串。
 */
function feedbackSection(T, s, ctx) {
  const mail = String(s.feedbackEmail || '').trim();
  if (!mail) return null;

  /** 一封信：收件人 + 主题 + 正文，粘到邮件里三段都在。 */
  const compose = (kind) => {
    const isPlace = kind === 'place';
    const subject = `[大肥鱼环游世界 v${s.version}] ${isPlace ? T.fbPlace : T.fbBug}`;
    const body = [
      isPlace ? '想加的地点（城市 + 地方名 + 为什么）：' : '出了什么问题：',
      '',
      '',
      '——',
      `版本 ${s.version}｜她当时在 ${s.place.name}｜${s.dateKey}`,
    ].join('\n');
    return `收件人：${mail}\n主题：${subject}\n\n${body}`;
  };

  const box = el('section', 'jr-fb');
  box.append(el('p', 'jr-fb-lead', T.fbLead));

  const row = el('div', 'jr-fb-row');
  for (const [kind, label] of [['bug', T.fbBug], ['place', T.fbPlace]]) {
    const btn = el('button', 'jr-btn jr-fb-btn', label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      copyText(compose(kind)).then(() => {
        btn.textContent = T.fbCopied;
        setTimeout(() => { btn.textContent = label; }, 2000);
      });
    }, { signal: ctx.signal });
    row.append(btn);
  }
  box.append(row);

  box.append(el('p', 'jr-fb-why', T.fbWhy));

  const addr = el('div', 'jr-fb-addr');
  addr.append(el('span', 'jr-fb-mail', mail));
  const copy = el('button', 'jr-linkbtn', T.fbCopy);
  copy.type = 'button';
  copy.addEventListener('click', () => {
    copyText(mail).then(() => {
      copy.textContent = T.fbCopied;
      setTimeout(() => { copy.textContent = T.fbCopy; }, 2000);
    });
  }, { signal: ctx.signal });
  addr.append(copy);
  /*
   * 网页邮箱走 https，宿主会交给系统浏览器打开 —— 这是唯一能真的点出去的一类链接。
   * 只放 QQ 邮箱：收件地址本来就是 QQ 的，跳别家还得再登录一次。
   */
  const open = el('a', 'jr-linkbtn', T.fbOpen);
  open.href = 'https://mail.qq.com/';
  open.target = '_blank';
  open.rel = 'noreferrer';
  addr.append(open);
  box.append(addr);
  return box;
}

const STATUS_KEY = {
  home: 'statusHome',
  resting: 'statusRest',
  traveling: 'statusTraveling',
  staying: 'statusStaying',
};

export default {
  panels: {
    now: {
      async mount(ctx) {
        const T = text(ctx.language);
        const app = el('div', 'jr-app');
        ctx.root.append(app);

        const head = el('header', 'jr-head');
        const left = el('div', 'jr-head-left');
        const eyebrow = el('p', 'jr-eyebrow', T.eyebrow);
        const city = el('h1', 'jr-city', '—');
        const sub = el('p', 'jr-sub', '');
        left.append(eyebrow, city, sub);
        const right = el('div', 'jr-head-right');
        const status = el('span', 'jr-pill', '');
        const clock = el('div', 'jr-clock', '--:--');
        // 她那边的钟和你的钟差多少。倍速一开就必然不一样，
        // 只写「24× 速度」等于让用户自己心算 —— 而他要的正是「差多少」。
        const gap = el('p', 'jr-gap', '');
        right.append(status, clock, gap);
        head.append(left, right);

        const homeBox = el('section', 'jr-home');
        /*
         * 「她在等你点头」。
         *
         * 放在最上面 —— 这是**唯一一件需要他动手的事**，压在引导和状态下面的
         * 话，她会在家等一整天而没人看见那张卡片。
         */
        const askBox = el('section', 'jr-ask');
        const homeNote = el('p', 'jr-warn', '');
        const guide = el('section', 'jr-guide');
        const legBox = el('section', 'jr-leg');
        const facts = el('section', 'jr-facts');
        const nextBox = el('section', 'jr-next');
        // 碰面：没配服务器时才出现的引导块。配了就只剩上面那排事实，不再解释功能。
        const meetBox = el('section', 'jr-meet');
        const foot = el('footer', 'jr-foot');
        // 反馈那一栏单独一个插槽：配了邮箱才有内容，没配就是空的，
        // 不留一个点了没反应的按钮在那儿。
        const fbSlot = el('div', 'jr-fb-slot');

        app.append(head, askBox, homeBox, guide, legBox, facts, meetBox, nextBox, foot, fbSlot);

        const render = (s) => {
          app.dataset.mode = s.mode;
          city.textContent = s.place.name;
          // 「兰州 · 家在石家庄」是对的，「兰州 · 从石家庄出发」读起来就是矛盾 ——
          // 前者说的是「她人在哪儿 + 家在哪」，后者听起来像「她从石家庄走过来」。
          sub.textContent = [s.place.region, fmt(T.homeAt, s.home), fmt(T.speed, s.speed)]
            .filter(Boolean).join(' · ');
          clock.textContent = s.clock;

          /*
           * 她那边的时区 +（真的跑偏了才说的）偏离量。
           *
           * 2026-11-02 由 Mr.Q 改：原来这一行只写「比你快 1 天 21 小时」再挂个同步按钮，
           * 他说「这个同步是不是没什么意义」—— 他说的对，但不是同步没用，是**触发门槛太低**：
           * 差一分钟也给按钮，按下去什么都不会变；而「比你快 X」这种话离开了倍速的上下文
           * 读起来就像界面算错了。
           *
           * 现在：**时区常显**（稳定、扫一眼就知道她那边几点），
           * 只有她的日子和真实时间拉开到一天以上、或者天气已经超出预报窗口，才补一句漂移
           * 并给出「同步」。功能没删，只是不再天天杵在那儿。
           */
          const drift = Number(s.clockDriftMs) || 0;
          const wayOff = Math.abs(drift) >= 86_400_000;
          gap.replaceChildren();
          if (s.tzLabel) gap.append(el('span', 'jr-gap-text', s.tzLabel));
          if (wayOff) gap.append(el('span', 'jr-gap-drift', driftText(T, drift)));
          if (!gap.children.length) gap.append(el('span', 'jr-gap-text', driftText(T, drift)));
          if (wayOff || s.weatherOutOfRange) {
            const syncBtn = el('button', 'jr-sync', T.sync);
            syncBtn.type = 'button';
            syncBtn.title = T.syncTitle;
            syncBtn.addEventListener('click', () => {
              syncBtn.disabled = true;
              syncBtn.textContent = T.syncing;
              ctx.invoke('syncClock').then(render).catch(() => {
                syncBtn.disabled = false;
                syncBtn.textContent = T.sync;
              });
            }, { signal: ctx.signal });
            gap.append(syncBtn);
          }
          /*
           * 叫她回来。
           *
           * 面板上不给「去某地」的按钮 —— 那是替她做决定；但「回来」不一样，
           * 这一趟本来就是他放她出去的，他有权收回来。
           * 已经在往回走的时候按钮留着但禁用，比直接消失好：
           * 消失会让人以为点了没生效。
           */
          /*
           * 倍速调快了之后，得有路回来。
           *
           * 2026-11-03 Mr.Q：「如果用户调倍速把宠物的时间调得过快了，得加一个把宠物时间
           * 调整回来的按钮」。设置页能改，但那要先想起来自己改过、再找到那个设置项。
           * 面板上直接给一个，两件事一起做：**倍速回 1×，日子拉回此刻**。
           */
          if (Number(s.speed) > 1) {
            const slowBtn = el('button', 'jr-recall', T.resetSpeed);
            slowBtn.type = 'button';
            slowBtn.title = T.resetSpeedTitle;
            slowBtn.addEventListener('click', () => {
              slowBtn.disabled = true;
              ctx.setConfig('journey.pace', { 'worlds.journey.speed': 1 })
                .then(() => ctx.invoke('syncClock'))
                .then(render)
                .catch(() => { slowBtn.disabled = false; });
            }, { signal: ctx.signal });
            gap.append(slowBtn);
          }
          if (s.mode !== 'home') {
            const backBtn = el('button', 'jr-recall', s.returning ? T.returning : T.returnHome);
            backBtn.type = 'button';
            backBtn.title = T.returnTitle;
            backBtn.disabled = !!s.returning;
            backBtn.addEventListener('click', () => {
              backBtn.disabled = true;
              backBtn.textContent = T.returning;
              ctx.invoke('returnHome').then(render).catch(() => {
                backBtn.disabled = false;
                backBtn.textContent = T.returnHome;
              });
            }, { signal: ctx.signal });
            gap.append(backBtn);
          }
          status.textContent = T[STATUS_KEY[s.mode] || 'statusUnknown'];
          status.dataset.mode = s.mode;

          /* ---- 她在等他点头 ---- */
          askBox.replaceChildren();
          askBox.hidden = !s.ask;
          if (s.ask) {
            // 她自己那句话原样贴 —— 面板不该替她重写一遍，那是另一张嘴。
            askBox.append(el('p', 'jr-ask-eyebrow', T.askTitle));
            askBox.append(el('p', 'jr-ask-line', s.ask.line));
            const row = el('div', 'jr-ask-row');
            const yes = el('button', 'jr-btn jr-btn-primary', T.askGo);
            const no = el('button', 'jr-btn', T.askNo);
            yes.type = 'button';
            no.type = 'button';
            const answer = (ok) => {
              // 两个一起锁：连点两下会在服务端产生「又去又不去」的两次调用。
              yes.disabled = true;
              no.disabled = true;
              ctx.invoke('answerAsk', [ok]).then(render).catch(() => {
                yes.disabled = false;
                no.disabled = false;
              });
            };
            yes.addEventListener('click', () => answer(true), { signal: ctx.signal });
            no.addEventListener('click', () => answer(false), { signal: ctx.signal });
            row.append(yes, no);
            askBox.append(row, el('p', 'jr-ask-hint', T.askHint));
          }

          /* ---- 引导 ---- */
          guide.replaceChildren();
          guide.hidden = !!s.guideSeen;
          if (!s.guideSeen) {
            const title = el('h2', 'jr-guide-title', T.guideTitle);
            const steps = el('div', 'jr-guide-grid');
            [
              [T.guide1Title, T.guide1Body],
              [T.guide2Title, T.guide2Body],
              [T.guide3Title, T.guide3Body],
            ].forEach(([h, b], i) => {
              const card = el('article', 'jr-guide-card');
              card.append(el('span', 'jr-guide-num', String(i + 1)));
              card.append(el('h3', null, h));
              card.append(rich(el('p', null, ''), b));
              steps.append(card);
            });
            const done = el('button', 'jr-btn jr-btn-primary', T.guideDismiss);
            done.type = 'button';
            done.addEventListener('click', () => {
              done.disabled = true;
              ctx.invoke('dismissGuide').then(render).catch(() => { done.disabled = false; });
            }, { signal: ctx.signal });
            guide.append(title, steps, done);
          }

          /* ---- 她在家：开关 + 出发按钮 ---- */
          homeBox.replaceChildren();
          homeNote.textContent = '';
          homeBox.hidden = s.mode !== 'home';
          if (s.mode === 'home') {
            const pending = !!(s.askBeforeDepart);
            homeBox.append(el('h2', 'jr-next-title', T.homeTitle));

            const toggleRow = el('label', 'jr-toggle');
            const box = el('input');
            box.type = 'checkbox';
            box.checked = pending;
            const knob = el('span', 'jr-toggle-knob');
            const labelText = el('span', 'jr-toggle-text', T.askToggle);
            toggleRow.append(box, knob, labelText);
            box.addEventListener('change', () => {
              box.disabled = true;
              // 只写这一个字段：配置面接受部分提交（未提交的字段保持不变）。
              ctx.setConfig('journey.pace', { 'worlds.journey.askBeforeDepart': box.checked })
                .then(load)
                .catch(() => { box.checked = !box.checked; })
                .finally(() => { box.disabled = false; });
            }, { signal: ctx.signal });
            homeBox.append(toggleRow);

            // 开关关着的时候按钮不出现 —— 她自己会走，按了也没有意义。
            if (pending) {
              const go = el('button', 'jr-btn jr-btn-primary', T.departBtn);
              go.type = 'button';
              go.disabled = !s.canDepart;
              go.addEventListener('click', () => {
                go.disabled = true;
                ctx.invoke('depart')
                  .then(render)
                  .catch((e) => { homeNote.textContent = `${T.departErr}${e && e.message ? `：${e.message}` : ''}`; })
                  .finally(() => { go.textContent = T.departBtn; });
              }, { signal: ctx.signal });
              const hint = el('p', 'jr-hint', '');
              hint.textContent = s.restUntil
                ? fmt(T.departRest, s.restUntil)
                : s.canDepart ? T.departWait : T.departBusy;
              const row = el('div', 'jr-home-actions');
              row.append(go, hint);
              homeBox.append(row);
            } else {
              homeBox.append(el('p', 'jr-hint', T.departSelf));
            }
            homeBox.append(homeNote);
          }

          /* ---- 在路上 ---- */
          legBox.replaceChildren();
          legBox.hidden = !s.leg;
          if (s.leg) {
            const top = el('div', 'jr-leg-top');
            top.append(el('span', 'jr-leg-route', `${s.leg.from} → ${s.leg.to}`));
            top.append(el('span', 'jr-leg-mode', s.leg.code || s.leg.mode));
            const bar = el('div', 'jr-bar');
            const fill = el('div', 'jr-bar-fill');
            fill.style.width = `${s.leg.progress}%`;
            bar.append(fill);
            const meta = el('div', 'jr-leg-meta');
            meta.append(el('span', null, `${s.leg.progress}%`));
            meta.append(el('span', null, `${s.leg.km} ${T.legKm} · ${T.legLeft} ${s.leg.left}`));
            meta.append(el('span', null, `${T.legEta} ${s.leg.eta}`));
            legBox.append(top, bar, meta);
          }

          /* ---- 天气 / 今晚住 / 日出 ---- */
          facts.replaceChildren();
          const chips = [];
          // 改过家而人还在外面：这一趟的起点和「家」不是一处，得说清，不然就是两个地名打架。
          if (s.music) chips.push([T.musicOn, `${s.music.title}${s.music.artist ? ` · ${s.music.artist}` : ''}`]);
          // 「想去」是联动真正落下东西的地方：歌名带地名才会出现在这儿。
          if (s.wishes && s.wishes.length) chips.push([T.wishList, s.wishes.join('、')]);
          if (s.homeChanged) chips.push([T.tripFrom, s.tripHome]);
          /*
           * `weatherLine()` 给事件正文用的，前面故意带一个换行当段落分隔。
           * 面板是把它塞进一个小 chip 里，所以**先 trim 再摘「天气：」**——
           * 2026-11-02 排查时发现：原来直接 `replace(/^天气：/)`，
           * 因为开头是 `\n`，这个锚点永远匹配不到，chip 里就多带一个空行。
           */
          if (s.weather) chips.push([T.weather, s.weather.trim().replace(/^天气：/, '')]);
          // 没有天气时要说清是「超窗」还是「没网」—— 后者等一会儿就好，
          // 前者只能把时间拉回来。两件事在界面上长得一样，用户就只能瞎猜。
          else if (s.weatherOutOfRange) chips.push([T.weather, T.weatherOut]);
          /*
           * 钱见底了在当地打工：这一条必须显眼。
           * 不带它的话，面板上只有「她三天没动」—— 那读起来像坏了，不像在攒路费。
           */
          if (s.work) chips.push([T.working, `${s.work.city} · ${s.work.gig} · ${s.work.daysLeft === 0 ? T.workLastDay : fill(T.workLeft, { n: s.work.daysLeft })}`]);
          /*
           * 联机：同城有谁、有没有人在找伴、她跟谁约好了。
           *
           * 没有服务器也没有约定时 `social` 是 null —— 整行不出现，不给没开这功能的人
           * 塞一条「0 个」。配了服务器但同城没人时**照样显示**「这段时间没别人」：
           * 用户填完地址总得看到点变化，否则只会以为没生效。
           */
          if (s.social) {
            const so = s.social;
            /*
             * 先给总数，再给同城。
             *
             * 只有「同城 0 个」的时候，用户分不清是「今天真没人」还是「这条线坏了」；
             * 前面一行写着「池子今天一共 37 只」，答案就清楚了：
             * 池子活着，只是这一带没人。总数是 0 才说明服务器没回话或真的空了。
             */
            if (so.pool > 0) chips.push([T.pool, fill(T.poolN, { n: so.pool })]);
            chips.push([T.nearby, so.nearby > 0 ? fill(T.nearbyN, { n: so.nearby }) : T.nearbyNone]);
            if (so.invites > 0) chips.push([T.invites, fill(T.invitesN, { n: so.invites })]);
            if (so.pledge) {
              const pg = so.pledge;
              chips.push([T.pledge, pg.here
                ? fill(T.pledgeHere, { who: pg.withPet, n: pg.daysLeft, d: pg.days })
                : fill(T.pledgeAway, { who: pg.withPet, city: pg.city })]);
            }
          }
          if (s.lodging) {
            // 有真店名就用真名，把档次放括号里 —— 档次是那晚的重点，别丢。
            const name = s.lodging.name ? `${s.lodging.name}（${s.lodging.kind}）` : s.lodging.kind;
            chips.push([T.lodging, `${name} · ${s.lodging.price}`]);
          }
          if (s.sunrise) chips.push([T.sunrise, s.sunrise]);
          if (s.feeling) chips.push([T.feel, s.feeling.replace(/。$/, '')]);
          for (const [k, v] of chips) {
            const item = el('div', 'jr-fact');
            item.append(el('span', 'jr-fact-k', k));
            item.append(el('span', 'jr-fact-v', v));
            facts.append(item);
          }
          facts.hidden = chips.length === 0;

          /*
           * 碰面：**只在没配服务器时出现。**
           *
           * 2026-11-06 Mr.Q：「好多人都不知道碰面这功能，不看更新日志和介绍」。
           * 之前这里只有一排数字（池子多少只、同城几只），没配服务器的人根本看不到那一排 ——
           * 于是整个功能对他们等于不存在。这块就是那个入口：一句说明 + 一个能直接复制的地址。
           *
           * 配过之后就不显示了：那时她要的是「现在有几只」，不是再读一遍说明书。
           */
          meetBox.replaceChildren();
          if (!s.social) {
            meetBox.append(el('h2', 'jr-next-title', T.meetTitle));
            meetBox.append(el('p', 'jr-meet-lead', T.meetLead));
            meetBox.append(el('p', 'jr-meet-hint', T.meetHint));
            const addr = el('div', 'jr-meet-addr');
            const url = 'https://cooppetsjourney.top';
            addr.append(el('span', 'jr-meet-url', 'cooppetsjourney.top'));
            const copy = el('button', 'jr-linkbtn', T.meetCopy);
            copy.type = 'button';
            copy.addEventListener('click', () => {
              copyText(url).then(() => {
                copy.textContent = T.fbCopied;
                setTimeout(() => { copy.textContent = T.meetCopy; }, 2000);
              });
            }, { signal: ctx.signal });
            addr.append(copy);
            meetBox.append(addr);
          }

          /* ---- 接下来 ---- */
          nextBox.replaceChildren();
          const h = el('h2', 'jr-next-title', T.next);
          nextBox.append(h);
          if (!s.timeline.length) {
            nextBox.append(el('p', 'jr-next-empty', s.mode === 'traveling' ? T.nextNone : T.nextNone));
          } else {
            const list = el('ol', 'jr-tl');
            for (const item of s.timeline) {
              const li = el('li', 'jr-tl-item');
              li.dataset.kind = item.kind;
              if (item.past) li.dataset.past = 'true';
              li.append(el('time', 'jr-tl-at', item.at));
              li.append(el('span', 'jr-tl-what', item.what));
              list.append(li);
            }
            nextBox.append(list);
          }

          /* ---- 脚注 ---- */
          foot.replaceChildren();
          const bits = [];
          if (s.trip.days) bits.push(fmt(T.tripDays, s.trip.days));
          bits.push(fmt(T.visited, s.trip.visited));
          if (s.trip.moneyOn) {
            bits.push(s.trip.budget > 0
              ? fmt(T.budgetLeft, Math.max(0, s.trip.budget - s.trip.spent))
              : fmt(T.spent, s.trip.spent));
          }
          bits.push(fmt(T.diary, s.diary.days));
          foot.append(el('p', null, bits.join(' · ')));
          if (s.diary.problem) foot.append(el('p', 'jr-warn', `${T.diaryBroken}：${s.diary.problem}`));
          /*
           * 指到了同步盘就把路径显出来。
           *
           * 2026-11-03 Mr.Q：「多设备同步还是不知道怎么设置」—— 除了设置项没讲清，
           * 还有一个原因：填完之后界面上**没有任何证据**说明它生效了。
           * 看不到就等于没发生。
           */
          if (s.diary.shared && s.diary.dir) foot.append(el('p', 'jr-note', `${T.diarySynced}：${s.diary.dir}`));
          /*
           * 出发地认不出来：设置里写着「常熟」，实际按兰州算 —— 不说一句，
           * 用户只会觉得「加了没用」。2026-11-03 一位读者就是这么卡住的。
           */
          if (s.homeProblem) foot.append(el('p', 'jr-warn', s.homeProblem));
          const replay = el('button', 'jr-linkbtn', T.guideReplay);
          replay.type = 'button';
          replay.addEventListener('click', () => {
            ctx.invoke('replayGuide').then(render).catch(() => {});
          }, { signal: ctx.signal });
          foot.append(replay);

          /* ---- 反馈 ---- */
          fbSlot.replaceChildren();
          const fb = feedbackSection(T, s, ctx);
          if (fb) fbSlot.append(fb);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch((e) => {
          app.replaceChildren(el('p', 'jr-warn', `${T.err}${e && e.message ? ` (${e.message})` : ''}`));
        });

        await load();
        // 一分钟一次：她的时间在走，面板该跟着走。不轮询的话，停在「在路上」两小时。
        ctx.interval(load, 60_000);
      },
    },

    album: {
      async mount(ctx) {
        const T = text(ctx.language);
        const app = el('div', 'jr-app jr-album');
        const head = el('header', 'jr-head');
        const left = el('div', 'jr-head-left');
        left.append(el('p', 'jr-eyebrow', T.albumTitle));
        left.append(el('h1', 'jr-city', T.albumTitle));
        left.append(el('p', 'jr-sub', T.albumHint));
        const shoot = el('button', 'jr-btn jr-btn-primary', T.shoot);
        shoot.type = 'button';
        const right = el('div', 'jr-head-right');
        right.append(shoot);
        head.append(left, right);
        /*
         * 点「补一张」之后要**等结果**，不能掐一个固定时长。
         *
         * 2026-11-01：原来写死等 12 秒再刷新，而且后台那天已经有一张，
         * 被判重后静默返回 —— 用户按了按钮，界面纹丝不动，只能以为坏了。
         * 现在改成轮询：照片换了、或者有了失败原因，才收工。
         */
        /*
         * 后台现在**等拍完才回话**，而且会带原因和诊断。
         *
         * 2026-11-01 之前这里是「点一下 → 立刻返回已排队 → 死等 24×1.5 秒」，
         * 而 maybePhoto 里四个跳过全是静默的 —— 用户那边看到的就是
         * 「按下去没反应，日志没有，上游也没有请求」，只能猜。
         */
        shoot.addEventListener('click', () => {
          shoot.disabled = true;
          shoot.textContent = T.shooting;
          ctx.invoke('shoot')
            .then((res) => {
              if (res && res.ok === false) {
                note.textContent = `${T.shootSkip}${res.reason || '没说是为什么'}`;
                const d = res.diag;
                /*
                 * 用后端给的那整句 `line`，不再在前端拼字段名。
                 *
                 * 原来这里写死了「接口 X，模型 Y，密钥已填/没填」—— 那是云端那条路的形状。
                 * 2026-11-04 加了 ComfyUI（没有模型名、通常没有密钥），照念会让人
                 * 以为漏填了两项。字段拼装在哪儿，协议知识就泄露到哪儿。
                 */
                const detail = d && (d.line || (d.api ? `接口 ${d.api}，当地 ${d.localHour} 点` : ''));
                if (detail) note.textContent += `｜${detail}`;
                return undefined;
              }
              // 拍成了：给它一拍去落盘，再刷新相册。
              return new Promise((r) => ctx.timeout(r, 900)).then(() => ctx.invoke('list')).then(draw);
            })
            .catch((e) => { note.textContent = `${T.err}${e && e.message ? ` (${e.message})` : ''}`; })
            .finally(() => { shoot.disabled = false; shoot.textContent = T.shoot; });
        }, { signal: ctx.signal });
        const dirBar = el('p', 'jr-dir', '');
        dirBar.hidden = true;
        const grid = el('div', 'jr-photos');
        const note = el('p', 'jr-warn', '');
        /** 相册最上面那张的句柄。补拍之后拿它判断「换了没有」。 */
        let lastTop = '';
        // 目录栏放照片墙下面：它是「照片存哪」的注解，摆最上面会挡住第一屏
        app.append(head, grid, dirBar, note);
        ctx.root.append(app);

        /*
         * 原图在哪。
         *
         * 相册这一栏显示的是宿主的缩略图，真正的字节在媒体库目录里。
         * 宿主没给「在资源管理器里打开」的 API，所以这里只做两件事：
         * 把目录摆出来、点一下复制。用户粘到地址栏就能翻到原图。
         */
        const showDir = (dir) => {
          dirBar.replaceChildren();
          dirBar.hidden = !dir;
          if (!dir) return;
          dirBar.append(el('span', 'jr-dir-k', T.photoDir));
          dirBar.append(el('code', 'jr-dir-v', dir));
          const btn = el('button', 'jr-linkbtn', T.copyPath);
          btn.type = 'button';
          btn.addEventListener('click', () => {
            copyText(dir).then(() => {
              btn.textContent = T.copied;
              ctx.timeout(() => { btn.textContent = T.copyPath; }, 1600);
            }).catch(() => {});
          }, { signal: ctx.signal });
          dirBar.append(btn);
        };

        const draw = (res) => {
          const photos = res.photos || [];
          showDir(res.dir || '');
          grid.replaceChildren();
          lastTop = photos[0] ? photos[0].handle : '';
          // 失败原因写在照片墙下面：相册空着的时候，这句话是唯一的线索。
          note.textContent = res.error || '';
          if (!photos.length) {
            grid.append(el('p', 'jr-next-empty', T.albumEmpty));
            return;
          }
          for (const p of photos) {
            const fig = el('figure', 'jr-photo');
            const img = el('img');
            img.loading = 'lazy';
            img.alt = p.title || p.city;
            img.src = `/api/blob?handle=${encodeURIComponent(p.handle)}`;
            const cap = el('figcaption');
            cap.append(el('b', null, p.title || p.city));
            cap.append(el('span', null, `${p.city} · ${p.dateKey}`));
            // 文件名单独一行 —— 缩略图点不出原图，这个名字是唯一的线索
            if (p.file) {
              const f = el('span', 'jr-file', p.file);
              f.title = p.file;
              cap.append(f);
            }
            fig.append(img, cap);
            grid.append(fig);
          }
        };

        const load = () => ctx.invoke('list').then(draw).catch((e) => {
          note.textContent = `${T.err}${e && e.message ? ` (${e.message})` : ''}`;
        });

        await load();
        ctx.interval(load, 120_000);
      },
    },

    /*
     * 日记页（2026-11-06）。
     *
     * 用户来信要的：「希望插件里面可以直接看每天的日记」。原来日记只在同步盘的 md 里，
     * 要拿记事本去翻 —— 那等于让用户去文件系统里找她。
     *
     * 只读不写：日记是她写的，这个页面的职责是让那些字能被看见。
     */
    diary: {
      async mount(ctx) {
        const T = text(ctx.language);
        const app = el('div', 'jr-app jr-diary');
        const head = el('header', 'jr-head');
        const left = el('div', 'jr-head-left');
        left.append(el('p', 'jr-eyebrow', T.diaryTitle));
        left.append(el('h1', 'jr-city', T.diaryTitle));
        left.append(el('p', 'jr-sub', T.diaryHint));
        head.append(left);
        app.append(head);

        const listBox = el('div', 'jr-dlist');
        const viewBox = el('article', 'jr-dview');
        app.append(listBox, viewBox);
        ctx.root.append(app);

        const show = (d) => {
          viewBox.replaceChildren();
          if (!d) return;
          viewBox.append(el('h2', 'jr-dview-title', d.city || d.dateKey));
          const meta = [d.dateKey, d.weather, d.lodging].filter(Boolean).join(' · ');
          if (meta) viewBox.append(el('p', 'jr-dview-meta', meta));
          // 正文按空行分段 —— 她自己写的换行要保留，但连续的空行不该撑开一大块空白。
          for (const para of String(d.body || '').split(/\n{2,}/)) {
            const t = para.trim();
            if (t) viewBox.append(el('p', 'jr-dview-p', t));
          }
        };

        try {
          const r = await ctx.invoke('list');
          const days = (r && r.days) || [];
          listBox.replaceChildren();
          if (!days.length) {
            listBox.append(el('p', 'jr-empty', T.diaryEmpty));
            if (r && r.dir) listBox.append(el('p', 'jr-dview-meta', r.dir));
            return;
          }
          days.forEach((d, i) => {
            const b = el('button', 'jr-ditem', '');
            b.type = 'button';
            b.append(el('span', 'jr-ditem-date', d.dateKey));
            b.append(el('span', 'jr-ditem-city', d.city || '—'));
            b.addEventListener('click', () => {
              for (const x of listBox.children) if (x.dataset) delete x.dataset.on;
              b.dataset.on = 'true';
              show(d);
            }, { signal: ctx.signal });
            listBox.append(b);
            // 默认打开最新的一天：进来先看到字，而不是一个要点的列表。
            if (i === 0) { b.dataset.on = 'true'; show(d); }
          });
        } catch {
          listBox.append(el('p', 'jr-empty', T.diaryFail));
        }
      },
    },
  },
};
