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
    rideTitle: '正在打车',
    rideCharterTitle: '正在包车',
    rideFare: '车费',
    ridePickup: '约 {n} 分钟后到',
    rideDropoff: '还有 {n}',
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
    wishNone: '还没记下',
    verSelf: 'v{v}',
    verNew: '新版 {n} · 去 npm 更新',
    verHint: '本机 {v}，市场上是 {n}。在市场里更新这个扩展就好。',
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
    albumIntro: '这些是她在路上拍的。每张下面留着生成它用的那段提示词 —— 不满意就展开改，改完点那个按钮重拍这一张。重拍出来的是新图，旧的那份还留在磁盘上（月报可能正引用着它）。',
    albumPrompt: '提示词',
    albumPromptEmpty: '这张拍得早，没留下提示词。',
    albumRegen: '按这段重拍',
    albumRegenBusy: '在拍…',
    albumRegenHint: '用上面这段提示词重新生成，替换这一张',
    albumRegenNoPrompt: '没有提示词，换不了 —— 拿掉它，让她下次再拍一张',
    albumDrop: '从相册里拿掉（原图不删）',
    albumDropped: '拿掉了',
    /* 二次确认（2026-11-12，Mr.Q：「我害怕误点到图片删除」）。 */
    albumDropArm: '确定删？',
    albumDropArmHint: '再点一次就从相册里拿掉（原图不删）；不点会自己退回去',
    photoKeep: '右上角的 × 只把照片从相册里拿掉，不删原图 —— 同一张可能已经被月报引用了，删字节会把那边一起弄坏。要彻底删，去上面这个目录。',
    diaryTitle: '日记',
    matesTitle: '路上遇见的人',
    matesHint: '她记得的每一只鱼。走过几趟、上次哪天、她心里怎么看你 —— 这些是她自己记的，换台设备也还在。',
    matesTimes: '走过',
    matesTimesUnit: '次',
    matesLast: '上次',
    matesWarmth: '熟络度',
    matesEmpty: '还没跟谁一起走过。同城碰上、约着走一段，都会记在这儿。',
    matesNoImpression: '她还没写。',
    partiesTitle: '一起走过的那几趟',
    partiesEmpty: '还没有。约着走完一段，这里就会出现。',
    partiesNotReady: '碰面服务器没配，这几趟的卡取不到。',
    profileUrlBad: '「碰面服务器」那一栏读不成网址：{}。去设置里改一下，那一栏改好就直接生效，不用重启。',
    profileUrlFixed: '地址已自动整理：{}。',
    cardTheirs: '她留的',
    cardMine: '你留的',
    cardNote: '一句话',
    cardNoteHint: '想让她知道的事，一句就够',
    cardContact: '你的号',
    cardContactHint: '微信号、QQ 都行；不填也能留那句话',
    cardLeave: '留一张',
    cardLeaveBusy: '在留…',
    cardSaved: '留好了。',
    card30: '卡留 30 天，之后自动清掉。',
    profileTitle: '你的名片',
    profileHint: '一段自我介绍。只有跟你一起走过的鱼看得见 —— 陌生人拿不到。可以写花语乡、星邮、客厅的 id，别写链接（链接会被丢掉）。',
    profileEmpty: '还没写。留空再点「存下来」就是撤回。',
    profileSave: '存下来',
    profileSaveBusy: '在存…',
    profileSaved: '存好了。',
    profileOthers: '一起走过的人写的',
    profileOthersEmpty: '还没有人写。',
    profile30: '名片留 30 天，不续就自己收回去。',
    diaryHint: '她每天写的那几段。左边选一天，右边读。',
    diaryEmpty: '还没有日记。她出门之后每天会写一段。',
    diaryFail: '读不出日记。看下面那个目录是不是还在。',
    photoDir: '原图在这',
    copyPath: '复制路径',
    copied: '已复制',
    dirExtra: '另外再存一份到',
    dirEdit: '改路径',
    dirSave: '保存',
    dirCancel: '取消',
    dirPlaceholder: '留空＝不另存，只放在上面那个目录',
    dirTip: '只对之后拍的照片生效，已经存下的不会自己搬过去。清空就是不再另存。',
    shoot: '现在补一张',
    shooting: '在拍了…',
    photoSlow: '还没出来。十几秒后刷新一下看看 —— 没拍成的话，原因会写在下面。',
    shootSkip: '没拍成：',
    err: '读不出来。Core 可能刚重启，过一会儿再刷新。',
    needRestart: '扩展已经更新了，但后台还在跑旧版本 —— 完全退出 Coopani 再打开就好了。',
    albumRegenFresh: '按现在的规则重拍',
    albumRegenFreshHint: '框里留空 = 按现在的规则重新生成一张；写点什么就用你写的这段。',
    albumPromptNote: '框里是这张当初用的提示词。想按现在的规则重新生成，把它清空再点。',
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
    rideTitle: 'On a ride',
    rideCharterTitle: 'On a charter',
    rideFare: 'fare',
    ridePickup: 'pickup in {n} min',
    rideDropoff: '{n} min to go',
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
    wishNone: 'none yet',
    verSelf: 'v{v}',
    verNew: 'v{n} available · update on npm',
    verHint: 'You are on {v}; the market has {n}. Update the extension there.',
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
    albumIntro: 'These are the photos she took along the way. Each one keeps the prompt that produced it - edit it and hit "Reshoot with this" to replace that photo. The reshoot is a new image; the old file stays on disk, since a monthly report may still be using it.',
    albumPrompt: 'Prompt',
    albumPromptEmpty: 'Taken before prompts were kept.',
    albumRegen: 'Reshoot with this',
    albumRegenBusy: 'Shooting...',
    albumRegenHint: 'Regenerate with the prompt above and replace this photo',
    albumRegenNoPrompt: 'No prompt to reuse - remove it and let her take a fresh one',
    albumDrop: 'Remove from the album (the file stays)',
    albumDropped: 'Removed',
    albumDropArm: 'Sure?',
    albumDropArmHint: 'Click again to remove it from the album (the file stays); it reverts on its own',
    photoKeep: 'The × only takes a photo out of the album; the file stays. The same image may already be used in a monthly report, and deleting the bytes would break that page. To delete it for good, open the folder above.',
    diaryTitle: 'Diary',
    matesTitle: 'Travelled with',
    matesHint: 'Every fish she remembers. How many trips, when last, and what she made of them - all hers, and it survives a change of machine.',
    matesTimes: 'Walked',
    matesTimesUnit: 'time(s)',
    matesLast: 'Last',
    matesWarmth: 'Warmth',
    matesEmpty: 'She has not walked with anyone yet. Meeting someone in a city or agreeing to travel together lands here.',
    matesNoImpression: 'She has not written one yet.',
    partiesTitle: 'Trips together',
    partiesEmpty: 'None yet. Finish a trip with someone and it shows up here.',
    partiesNotReady: 'No sight server configured, so the cards from these trips cannot be fetched.',
    profileUrlBad: 'The sight server field is not a usable address: {}. Fix it in settings; it applies right away, no restart needed.',
    profileUrlFixed: 'Address was tidied up: {}.',
    cardTheirs: 'Left by them',
    cardMine: 'Left by you',
    cardNote: 'A line',
    cardNoteHint: 'What you want them to know - one line is enough',
    cardContact: 'Your contact',
    cardContactHint: 'WeChat, QQ, anything; leave it blank and the line still goes',
    cardLeave: 'Leave a card',
    cardLeaveBusy: 'Leaving...',
    cardSaved: 'Saved.',
    card30: 'Cards last 30 days, then they are cleared.',
    profileTitle: 'Your card',
    profileHint: 'A short introduction. Only fish you have actually travelled with can see it - strangers cannot. WeChat, QQ, or ids from other extensions are all fine; links get dropped.',
    profileEmpty: 'Nothing yet. Save it empty to withdraw.',
    profileSave: 'Save',
    profileSaveBusy: 'Saving...',
    profileSaved: 'Saved.',
    profileOthers: 'Written by people you walked with',
    profileOthersEmpty: 'Nobody yet.',
    profile30: 'Profiles last 30 days, then they expire on their own.',
    diaryHint: 'What she wrote, day by day. Pick a day on the left.',
    diaryEmpty: 'No entries yet — she starts writing once she is out there.',
    diaryFail: 'Could not read the diary. Check the folder below.',
    photoDir: 'Full-size files in',
    copyPath: 'Copy path',
    copied: 'Copied',
    dirExtra: 'Also keep a copy in',
    dirEdit: 'Change',
    dirSave: 'Save',
    dirCancel: 'Cancel',
    dirPlaceholder: 'Empty = no second copy, only the folder above',
    dirTip: 'Applies to photos taken from now on; existing files are not moved. Clear it to stop copying.',
    shoot: 'Take one now',
    shooting: 'Shooting…',
    photoSlow: 'Not back yet. Refresh in a few seconds; if it failed, the reason shows below.',
    shootSkip: 'Did not shoot: ',
    err: 'Could not read. Core may have just restarted — try again in a moment.',
    needRestart: 'The extension updated, but the background is still running the old build - quit Coopani completely and reopen it.',
    albumRegenFresh: 'Regenerate with current rules',
    albumRegenFreshHint: 'Leave the box empty to regenerate with the current rules; type anything to use your own wording.',
    albumPromptNote: 'This is the prompt this photo was made with. Clear the box and press the button to regenerate with the current rules.',
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

/** 版本那一行要两个占位符（自己的、最新的），`fmt` 只认一个。 */
function fmt2(s, v, n) {
  return String(s).replace('{v}', String(v)).replace('{n}', String(n));
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

/**
 * 「设置」页的文案（2026-11-14）。
 *
 * 单独一张表，不并进上面那个 `TEXT`：`TEXT` 是「她此刻」那张页的字典，
 * 六十多个键已经很长了，再塞二十个生图字段进去，找东西会更难。
 * 这一页只有一处用，就近放。
 */
const SET = {
  zh: {
    eyebrow: '生图设置',
    title: '她拍的照片从哪儿出来',
    intro: '选一边，只填那一边要的。另一边的东西不会丢，只是这一页不显示。',
    cloud: '云端服务商',
    local: '本地 ComfyUI',
    cloudHint: '贴一把密钥就能用。豆包已把地址、模型、合规尺寸预设好，填个密钥就完事。',
    localHint: '要先开着 ComfyUI，并选一份「Save (API Format)」导出的 workflow。',
    preset: '服务商',
    presets: { doubao: '豆包 Seedream', openai: 'OpenAI', custom: '自定义' },
    presetHint: '下面三格留空就用这一档自带的值；手填的永远优先。',
    api: '服务地址',
    apiCloud: '填到 /v1 或 /api/v3 为止，别带后面的路径',
    apiLocal: '默认 http://127.0.0.1:8188',
    model: '模型名',
    size: '出图尺寸',
    sizeHint: '「宽x高」。留空＝服务商默认。豆包低于 2560×1440 会被自动放大。',
    key: '密钥',
    keySaved: '已存好',
    keyInEnv: '已存好 · 在 .env 里',
    keyNone: '还没填',
    keyHint: '留空＝不改。填一次就会被收进 .env，下次回到这一页还是空 —— 那是搬走了，不是丢了。',
    workflow: '工作流 JSON',
    pick: '选文件',
    pickFail: '没选成',
    promptNode: '提示词节点 id',
    negative: '负向提示词',
    negativeNode: '负向节点 id',
    optional: '可留空',
    save: '保存',
    saving: '保存中…',
    saved: '已保存，下一张照片就用这个',
    unchanged: '没有改动',
    note: '现在连的是',
    needApi: '缺服务地址，云端出不了图',
    needWorkflow: '缺 workflow，本地出不了图',
    other: '两边共用',
    minimal: '极简提示词',
    minimalHint: '画出来老是同一座建筑时打开：只发「城市 + 景点 + 时间」，不再补城市风貌那一段。',
    style: '画面风格',
    styleHint: '留空＝真实旅行照片（胶片、自然光）。接二次元底模时写「anime style, cel shading」；写 none＝不指定，交给底模。',
    cast: '照片里出不出人',
    castHint: '留空＝画面里没有人，拍的是她眼前的风景。想让她出现，写一段外貌描述，越具体越稳。',
    watermark: '去掉「AI生成」水印',
    watermarkHint: '服务商出图后盖上去的那一条，提示词压不掉。auto＝云端裁底边、本地不动；off＝一律不裁；crop＝一律裁掉底部 8%。',
    watermarks: { auto: '自动', off: '不裁', crop: '都裁' },
    timeout: '出图最多等几秒',
    timeoutHint: '0＝默认（本地 180、云端 90）。超时只是还没画完，不是坏了。',
    photoDir: '照片额外存一份到',
    photoDirHint: '这是备份，不是搬家 —— 主份永远在日记目录的 media/ 下（月报里嵌的是那边）。只对之后拍的照片起作用。',
    pickDir: '选目录',
    more: '生图的全部设置都在这一页了 —— 「配置」页不再有生图条目。照片主份永远跟着日记目录走。',
    loadFail: '读不出当前设置：',
  },
  en: {
    eyebrow: 'Image settings',
    title: 'Where her photos come from',
    intro: 'Pick one side and fill in that side only. Nothing on the other side is lost, it is just hidden here.',
    cloud: 'Cloud provider',
    local: 'Local ComfyUI',
    cloudHint: 'One API key is enough. Doubao already has its URL, model and compliant size preset.',
    localHint: 'ComfyUI must be running, and you need a workflow exported with “Save (API Format)”.',
    preset: 'Provider',
    presets: { doubao: 'Doubao Seedream', openai: 'OpenAI', custom: 'Custom' },
    presetHint: 'Leave the three fields below empty to use this preset; anything you type wins.',
    api: 'Endpoint',
    apiCloud: 'Up to /v1 or /api/v3 — no path after that',
    apiLocal: 'Default http://127.0.0.1:8188',
    model: 'Model',
    size: 'Size',
    sizeHint: '“WxH”. Empty = provider default.',
    key: 'API key',
    keySaved: 'Saved',
    keyInEnv: 'Saved · in .env',
    keyNone: 'Not set',
    keyHint: 'Empty = leave it alone. Once saved it moves into .env and this box goes empty again.',
    workflow: 'Workflow JSON',
    pick: 'Choose file',
    pickFail: 'Nothing chosen',
    promptNode: 'Prompt node id',
    negative: 'Negative prompt',
    negativeNode: 'Negative node id',
    optional: 'optional',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved — the next photo uses this',
    unchanged: 'Nothing changed',
    note: 'Currently hitting',
    needApi: 'No endpoint — cloud cannot shoot',
    needWorkflow: 'No workflow — local cannot shoot',
    other: 'Shared by both',
    minimal: 'Minimal prompt',
    minimalHint: 'Turn on when every photo looks like the same building: sends only city + spot + time.',
    style: 'Style',
    styleHint: 'Empty = real travel photo (film, natural light). For anime base models write “anime style, cel shading”; “none” = leave it to the model.',
    cast: 'Anyone in frame',
    castHint: 'Empty = empty scenery. To include her, describe her appearance — the more specific the steadier.',
    watermark: 'Remove the “AI generated” mark',
    watermarkHint: 'added by the provider after generation; a prompt cannot remove it. auto = crop on cloud only; off = never; crop = always (bottom 8%).',
    watermarks: { auto: 'Auto', off: 'Never', crop: 'Always' },
    timeout: 'Timeout (seconds)',
    timeoutHint: '0 = default (180 local, 90 cloud). A timeout means “not finished yet”, not “broken”.',
    photoDir: 'Also copy photos to',
    photoDirHint: 'This is a backup, not a move — the primary copy always lives in the diary folder’s media/. Applies to new photos only.',
    pickDir: 'Choose folder',
    more: 'Every image setting now lives on this page — the Config page no longer has image entries.',
    loadFail: 'Cannot read current settings: ',
  },
};


/**
 * 把后台的报错翻成人话（2026-11-11）。
 *
 * ## 为什么要有这一层
 *
 * 那天收到两封信：「名片保存不下来」「重拍没反应、右上角的删除也删不掉」。
 * 查下来根因是同一个 —— **扩展更新了，Core 还跑着旧版本**，后台回的是
 *
 *     这一页不认识这个动作：saveProfile
 *
 * 这句话对写代码的人是线索，对用户是噪音：他不知道该干什么，
 * 只能把现象原样报上来。而真正要做的事只有一件 —— 完全退出 Coopani 再打开。
 *
 * 所以这一条单独认出来，直接给出动作，不把它混在「读不出来」里。
 */
function why(T, e) {
  const m = String((e && e.message) || e || '');
  if (/不认识这个动作|unknown action|not a known/i.test(m)) return T.needRestart;
  return `${T.err}${m ? ` (${m})` : ''}`;
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
        /*
         * 版本徽章挂在标题那一行（2026-11-08 第二次改）。
         *
         * 原来它在页脚，Mr.Q 的原话是「放到标题上去，这里太不明显了」——
         * 页脚那行 11px、灰色，混在「日记 3 天 · 花销 1200」中间，等于没有。
         * 而版本号恰恰是他每次报障前要确认的第一个数。
         *
         * 三档：
         * - 有新版 → **实心胶囊**（强调色底 + 白字），一眼能看见；
         * - 就是最新 → 跟在标题后面，灰色小字；
         * - 查不到 → 同样只写自己的版本，不写「已是最新」（没确认就别说）。
         */
        const ver = el('span', 'jr-ver-tag', '');
        eyebrow.append(ver);
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
        /*
         * 别人叫的车。
         *
         * 位置在行程卡**上方**：城际那段是「这一趟怎么走」，市里这段是「此刻在哪」，
         * 后者更急。没叫车时整块不占位（`hidden`），不留一个空框。
         */
        const rideBox = el('section', 'jr-ride');
        const facts = el('section', 'jr-facts');
        const nextBox = el('section', 'jr-next');
        // 碰面：没配服务器时才出现的引导块。配了就只剩上面那排事实，不再解释功能。
        const meetBox = el('section', 'jr-meet');
        const foot = el('footer', 'jr-foot');
        // 反馈那一栏单独一个插槽：配了邮箱才有内容，没配就是空的，
        // 不留一个点了没反应的按钮在那儿。
        const fbSlot = el('div', 'jr-fb-slot');

        app.append(head, askBox, homeBox, rideBox, guide, legBox, facts, meetBox, nextBox, foot, fbSlot);

        const render = (s) => {
          app.dataset.mode = s.mode;
          /*
           * 版本徽章。`dataset.new` 同时是样式开关和可测标记 ——
           * CSS 里 `[data-new="1"]` 换成实心胶囊。
           */
          const hasNew = Boolean(s.versionOutdated && s.latestVersion);
          ver.dataset.new = hasNew ? '1' : '0';
          /*
           * 常驻时前面加个「·」—— eyebrow 本身是「她此刻」，
           * 直接接 `v1.0.2` 会读成「她此刻版本」，加个分隔号才像附注。
           */
          ver.textContent = hasNew
            ? fmt2(T.verNew, s.version, s.latestVersion)
            : `· ${fmt2(T.verSelf, s.version, '')}`;
          /* title 里也有占位符，要一起替换 —— 直接塞 `T.verHint` 出来是「本机 {v}」。 */
          ver.title = hasNew ? fmt2(T.verHint, s.version, s.latestVersion) : '';
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
          /*
           * **同步按钮的门槛从「一天」降到「一分钟」（2026-11-11，Mr.Q）。**
           *
           * 原来只有偏离超过一天、或者天气超出预报窗口才给这个按钮。
           * 而用户最常遇到的是：把倍速调到 24x 跑了一会儿，她的时间飞出去几小时，
           * 再调回 1x 也追不回来 —— **这几小时的偏差在界面上是隐形的**，
           * 按钮不出现，他根本不知道有这个功能。
           *
           * 24x 下每过 3 秒就偏 1 分钟，所以 60 秒这个门槛等于「调过倍速就会露出来」，
           * 正常 1x 跑着不会杵一个没用的按钮在那儿。
           */
          const drift = Number(s.clockDriftMs) || 0;
          const wayOff = Math.abs(drift) >= 86_400_000;
          const anyDrift = Math.abs(drift) >= 60_000;
          gap.replaceChildren();
          if (s.tzLabel) gap.append(el('span', 'jr-gap-text', s.tzLabel));
          if (wayOff) gap.append(el('span', 'jr-gap-drift', driftText(T, drift)));
          if (!gap.children.length) gap.append(el('span', 'jr-gap-text', driftText(T, drift)));
          if (anyDrift || wayOff || s.weatherOutOfRange) {
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

          /* ---- 正在打车 ---- */
          /*
           * 不跑本地倒计时。`secondsToPickup` 是轮询拿到的那一刻的值，
           * 自己再起一个定时器递减，会和下一次轮询对不上 —— 进度条一抖一抖，
           * 而且面板切到后台时 setInterval 会被节流，回来就是错的数。
           */
          rideBox.replaceChildren();
          rideBox.hidden = !s.ride;
          if (s.ride) {
            const r = s.ride;
            const top = el('div', 'jr-leg-top');
            /*
             * 起点终点**可能是空的**：包车订单很多时候只报车型和车费，
             * 不写「从哪到哪」。空着就整行不画 —— 画出来是一条光秃秃的「→」。
             */
            if (r.from || r.to) top.append(el('span', 'jr-leg-route', `${r.from || ''} → ${r.to || ''}`));
            if (r.car || r.plate) top.append(el('span', 'jr-leg-mode', [r.car, r.plate].filter(Boolean).join(' · ')));
            const bar = el('div', 'jr-bar');
            const fill = el('div', 'jr-bar-fill');
            fill.style.width = `${Math.max(0, Math.min(100, r.progress || 0))}%`;
            bar.append(fill);
            const meta = el('div', 'jr-leg-meta');
            const mins = (sec) => Math.max(1, Math.round((sec || 0) / 60));
            /*
             * 包车一跑就是几小时（`secondsToDropoff` 可能一万多秒），
             * 直接印「还有 245 分钟」没人算得过来 —— 过了一小时就换成时+分。
             */
            const left = (sec) => {
              const m = mins(sec);
              if (m < 60) return `${m} 分钟`;
              const h = Math.floor(m / 60);
              const r2 = m % 60;
              return r2 ? `${h} 小时 ${r2} 分` : `${h} 小时`;
            };
            meta.append(el('span', null, r.status === 'in_trip'
              ? fmt(T.rideDropoff, left(r.secondsToDropoff))
              : fmt(T.ridePickup, mins(r.secondsToPickup))));
            meta.append(el('span', null, `${T.rideFare} ${r.fare}`));
            const title = el('div', 'jr-leg-top');
            /*
             * 包车和叫车分开写（2026-11-11，鱼鱼出行来信）。
             *
             * 只有 `service === 'charter'` 才算包车；缺字段、空串、没见过的值
             * 一律当叫车 —— 旧版文件不用迁移。
             */
            title.append(el('span', 'jr-leg-mode',
              // 城市名空着就不带那个「·」—— 末尾挂一个分隔号比不写更难看。
              r.cityName
                ? `${r.service === 'charter' ? T.rideCharterTitle : T.rideTitle} · ${r.cityName}`
                : `${r.service === 'charter' ? T.rideCharterTitle : T.rideTitle}`));
            rideBox.append(title, top, bar, meta);
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
          /*
           * **空的也要显示**（2026-11-08 用户问「想去怎么没了」）。
           * 原来只在非空时 push，于是这套联动一次没触发过的人，永远看不到这一行 ——
           * 和「同城」那一行同一个毛病（填了地址没变化 = 以为没生效）。
           */
          chips.push([T.wishList, (s.wishes && s.wishes.length) ? s.wishes.join('、') : T.wishNone]);
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
          /*
           * 版本号**不在这里**了 —— 2026-11-08 挪到标题那一行（见 `ver`）。
           * 页脚混在「日记 3 天 · 花销 1200」中间，11px 灰字，等于没显示。
           */
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
          app.replaceChildren(el('p', 'jr-warn', `${why(T, e)}`));
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
            .catch((e) => { note.textContent = `${why(T, e)}`; })
            .finally(() => { shoot.disabled = false; shoot.textContent = T.shoot; });
        }, { signal: ctx.signal });
        const dirBar = el('p', 'jr-dir', '');
        dirBar.hidden = true;
        const grid = el('div', 'jr-photos');
        const note = el('p', 'jr-warn', '');
        /** 相册最上面那张的句柄。补拍之后拿它判断「换了没有」。 */
        let lastTop = '';
        // 目录栏放照片墙下面：它是「照片存哪」的注解，摆最上面会挡住第一屏
        /*
         * 一段介绍（2026-11-11）。用户要「加上之后记得加个介绍」——
         * 三个动作（看提示词 / 重拍 / 拿掉）光有按钮不够，得先说清各自会做什么、
         * 什么不会。尤其「重拍不删旧图」和「× 只摘记录」，不说就会被误解成删除。
         */
        const intro = el('p', 'jr-album-intro', T.albumIntro);
        intro.hidden = true;
        app.append(head, intro, grid, dirBar, note);
        ctx.root.append(app);

        /*
         * 原图在哪。
         *
         * 相册这一栏显示的是宿主的缩略图，真正的字节在媒体库目录里。
         * 宿主没给「在资源管理器里打开」的 API，所以这里只做两件事：
         * 把目录摆出来、点一下复制。用户粘到地址栏就能翻到原图。
         */
        const showDir = (dir, extra) => {
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
          /*
           * 「× 不删原图」必须写出来（2026-11-11 Mr.Q：「加，还得说明为什么不删原图」）。
           *
           * 一个看不出后果的删除按钮，用户按下去只有两种反应：要么以为照片没了、
           * 白紧张；要么以为删干净了、回头发现原图还在，觉得这个按钮是假的。
           * 所以：**先说清它做什么，再说清为什么这么做**。
           */
          dirBar.append(el('span', 'jr-dir-note', T.photoKeep));

          /*
           * 改路径（2026-11-09 Mr.Q：「照片路径修改功能还是没见啊」）。
           *
           * 这一项原来只能去设置页「可选接口」那一组里改，面板上只给看和复制 ——
           * 但人是在这个页面上想「照片能不能换个地方」的，让他再翻三层设置是不对的。
           *
           * **说清它到底是什么**：`photoDir` 不是照片主目录，是**再存一份**。
           * 照片主份永远跟着日记同步目录走（改那个在「多设备同步」里）。
           * 标题照实写「另外再存一份到」，比「照片存哪儿」准确 ——
           * 后者让人以为改了这个照片就搬过去了。
           */
          const edit = el('button', 'jr-linkbtn', T.dirEdit);
          edit.type = 'button';
          edit.addEventListener('click', () => {
            dirBar.replaceChildren();
            dirBar.append(el('span', 'jr-dir-k', T.dirExtra));
            const input = el('input', 'jr-dir-input');
            input.type = 'text';
            input.spellcheck = false;
            input.value = extra || '';
            input.placeholder = T.dirPlaceholder;
            const save = el('button', 'jr-linkbtn jr-linkbtn-on', T.dirSave);
            save.type = 'button';
            const cancel = el('button', 'jr-linkbtn', T.dirCancel);
            cancel.type = 'button';
            const tip = el('span', 'jr-dir-tip', T.dirTip);
            save.addEventListener('click', () => {
              save.disabled = true;
              /*
               * 部分提交：只写这一个字段，别的生图设置不动。
               *
               * 原来写的是 `ctx.setConfig('journey.services', { photoDir })` ——
               * 那个组的 schema 里**从来没有 photoDir**，所以这条路一直是 400
               * （「配置组 journey.services 没有声明 worlds.journey.photoDir」），
               * 只是没人点过这一格。生图组删掉之后连组都没了，改走同一条后端通道。
               */
              ctx.invoke('saveImageSettings', [{ photoDir: input.value.trim() }])
                .then(() => showDir(dir, input.value.trim()))
                .catch((e) => {
                  save.disabled = false;
                  tip.textContent = `${why(T, e)}`;
                });
            }, { signal: ctx.signal });
            cancel.addEventListener('click', () => showDir(dir, extra), { signal: ctx.signal });
            dirBar.append(input, save, cancel, tip);
            input.focus();
          }, { signal: ctx.signal });
          dirBar.append(edit);
        };

        const draw = (res) => {
          const photos = res.photos || [];
          showDir(res.dir || '', res.extra || '');
          grid.replaceChildren();
          lastTop = photos[0] ? photos[0].handle : '';
          // 失败原因写在照片墙下面：相册空着的时候，这句话是唯一的线索。
          note.textContent = res.error || '';
          intro.hidden = !photos.length;
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
            /*
             * 拿掉这一张（2026-11-11，用户 TwoTwo：「AI 生成的照片有些不满意，
             * 能否加一个重新生成或者删除」）。
             *
             * 只从相册里摘记录，原图不动 —— 已经生成的月报里嵌的就是那张，
             * 删字节那边会裂。按钮上写了「原图不删」，不让人以为按了就没了。
             */
            const drop = el('button', 'jr-photo-del', '×');
            drop.title = T.albumDrop;
            /*
             * ## 删之前要问一遍（2026-11-12，Mr.Q：「我害怕误点到图片删除」）
             *
             * 那个 `×` 只有 22px，贴在缩略图右上角 —— 滑相册时手指蹭过去就删了，
             * 而且删完立刻 `load()` 重画，连「刚才发生了什么」都看不到。
             *
             * **用二次点击，不用 `confirm()`**：这一页跑在宿主的 webview 里，
             * 原生弹窗要么被拦，要么长得跟整页脱节；更要紧的是它会**盖住那张照片** ——
             * 而你要确认的正是「删的是不是这一张」。
             *
             * 第一次点：按钮变成红色的「确定删？」胶囊，3 秒内再点才真删。
             * 不点就自己退回去（`ctx.timeout`，卸载时自动清理）。
             */
            let armed = false;
            let armTimer = null;
            const disarm = () => {
              armed = false;
              drop.textContent = '×';
              drop.classList.remove('jr-photo-del-armed');
              drop.title = T.albumDrop;
            };
            drop.onclick = async () => {
              if (drop.disabled) return;
              if (!armed) {
                armed = true;
                drop.textContent = T.albumDropArm;
                drop.classList.add('jr-photo-del-armed');
                drop.title = T.albumDropArmHint;
                armTimer = ctx.timeout(disarm, 3000);
                return;
              }
              /*
               * 第二次点：撤掉倒计时、**把 armed 复位**，再往下真删。
               *
               * `disarm()` 这一行是必须的：失败分支会把按钮改成 `!`（见下面 catch），
               * 那时代码里 `armed` 还是 true —— 用户再点一下就**跳过确认直接删**，
               * 等于确认只在成功路径上生效。跟限流那个坑是同一个形状。
               */
              armTimer?.dispose?.();
              armTimer = null;
              disarm();
              drop.disabled = true;
              try {
                /*
                 * **参数必须包成数组（2026-11-11，用户胡毓斐报的 bug）。**
                 *
                 * `ctx.invoke` 的行为实测是这样：**只传两个参数时，第二个值原样透传；
                 * 三个及以上才收集成数组。**
                 *
                 *    ctx.invoke('answerAsk', [ok])            → args = [ok]      ✓
                 *    ctx.invoke('regen', handle, prompt)      → args = [h, p]    ✓
                 *    ctx.invoke('drop', handle)               → args = "log:xx"  ✗
                 *
                 * 字符串打过去，Core 在路由层就顶回来：`args 必须是 JSON 数组`，
                 * **还没走到 handler**，所以后端怎么改都没用。
                 *
                 * 这就是「照片删除一直有问题」的真因 —— 前面几版都在改提示文案
                 * 和错误显示位置，可那次调用压根没到后端。
                 */
                await ctx.invoke('drop', [p.handle]);
                await load();
              } catch (e) {
                /*
                 * **失败原因要写在「这张照片上」，不是墙下面（2026-11-11）。**
                 *
                 * 原来写进 `note` —— 那个元素在照片墙**底部**。相册有十几张时，
                 * 用户滚到中间删一张，报错出现在屏幕外，他看到的就只是
                 * 「点了没反应」。这跟 1.2.4 那句「报错变友好了、按钮还是没用」
                 * 是同一类错：信息在，但在看不见的地方。
                 *
                 * 所以：贴在卡片自己的 figcaption 上，八秒后自己消失；
                 * 按钮上留一个「!」并带上原因，鼠标悬停能看到。
                 */
                drop.disabled = false;
                drop.textContent = '!';
                drop.title = `${why(T, e)}`;
                const tip = el('figcaption', 'jr-warn', `${why(T, e)}`);
                tip.style.cssText = 'color:#b3261e;font-size:12px;line-height:1.4;margin:4px 0 0;';
                fig.append(tip);
                ctx.timeout(() => tip.remove(), 8000);
              }
            };
            /*
             * 提示词摊在照片下面（2026-11-11，用户 TwoTwo：「AI 生成的照片有些不满意，
             * 能否加一个重新生成或者删除」）。
             *
             * 用 <details> 折叠：一天一张、一个月三十张，全摊开相册就成文档了。
             * 折起来只占一行，点开能看能改能重拍。
             * **原来这段提示词只在内存里活一次、拍完就没了** —— 那才是"不满意也没法改"的根。
             */
            const box = el('details', 'jr-prompt');
            box.append(el('summary', 'jr-prompt-sum', T.albumPrompt));
            const ta = el('textarea', 'jr-prompt-txt');
            ta.value = p.prompt || '';
            ta.rows = 4;
            ta.spellcheck = false;
            /*
             * **留空是「按现在的规则重新生成」**（2026-11-11，用户沃兔）。
             *
             * 原来这一格强制非空：重拍只能沿用相册里存的那段旧话。
             * 而提示词生成逻辑改了以后，旧话是不会自己更新的 ——
             * 用户更新了、重启了、点重拍，提示词一个字没变，问题当然还在。
             *
             * 现在两种都给：留空 = 让系统按现在的规则重算；写了 = 就用他写的。
             */
            if (!p.prompt) ta.placeholder = T.albumPromptEmpty;
            const regen = el('button', 'jr-prompt-go', p.prompt ? T.albumRegen : T.albumRegenFresh);
            regen.type = 'button';
            regen.title = T.albumRegenFreshHint;
            ta.oninput = () => {
              regen.textContent = ta.value.trim() ? T.albumRegen : T.albumRegenFresh;
            };
            regen.onclick = async () => {
              const wrote = ta.value.trim();
              regen.disabled = true;
              drop.disabled = true;
              regen.textContent = T.albumRegenBusy;
              try {
                // 重拍是后端真的再出一张图，十几秒。别在这儿先刷新，等它回来。
                /*
                 * ⚠️ **第三个参数会被 JS 直接丢掉。**
                 *
                 * 宿主签名是 `invoke(method, args?: unknown[])` —— 只有两个形参。
                 * 写成 `invoke('regen', handle, prompt)`，浏览器解析时把 prompt 扔掉，
                 * 实际传过去的 args 就是 `"log:xxx"` 这个字符串，
                 * Core 在路由层顶回来：`args 必须是 JSON 数组`。
                 *
                 * 所以「点了重拍没反应」从 1.2.5 起就一直是这样 —— 那几次我改的都是
                 * `photoPrompt` 内部（景点名、锚点、长度），可这条调用**根本没走到后端**。
                 *
                 * 这也是为什么用户说「提示词一个字都没变」那么准：确实没变，
                 * 因为没重新生成过。
                 */
                await ctx.invoke('regen', [p.handle, wrote]);
                await load();
              } catch (e) {
                note.textContent = `${why(T, e)}`;
              } finally {
                regen.disabled = false;
                regen.textContent = T.albumRegen;
                drop.disabled = false;
              }
            };
            /*
             * 这一行是必须的（2026-11-11）。框里预填着当初那段提示词，
             * 而提示词生成逻辑改过之后旧话不会自己更新 —— 用户看见框里有字，
             * 顺手点「重拍」，出来的还是老样子，然后说「还是不行」。
             * 得把「清空才是重算」写在按钮旁边，而不是等他猜。
             */
            box.append(ta, el('p', 'jr-card-tip', T.albumPromptNote), regen);
            fig.append(img, cap, box, drop);
            grid.append(fig);
          }
        };

        const load = () => ctx.invoke('list').then(draw).catch((e) => {
          note.textContent = `${why(T, e)}`;
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

    /*
     * 路上遇见的人（2026-11-11，Discussion #586）。
     *
     * 用户来信：「散了就是真的散了 —— 没有人知道下次在哪个城市还能撞见谁」。
     * 但在这之前还有更基础的一件事没做：**她到底记不记得**，用户根本看不到。
     * 记忆文件里躺着名字、次数、熟络度、她写的印象，界面上一个字都没有。
     *
     * 只读。不放编辑 —— 印象是她的判断，用户在面板上改一句，等于替她记别人的样子。
     * 想让她改口，就跟她说。
     */
    mates: {
      async mount(ctx) {
        const T = text(ctx.language);
        const app = el('div', 'jr-app');
        const head = el('header', 'jr-head');
        const left = el('div', 'jr-head-left');
        left.append(el('p', 'jr-eyebrow', T.matesTitle));
        left.append(el('h1', 'jr-city', T.matesTitle));
        left.append(el('p', 'jr-sub', T.matesHint));
        head.append(left);
        app.append(head);

        const listBox = el('div', 'jr-mates');
        app.append(listBox);
        ctx.root.append(app);

        const draw = (rows) => {
          listBox.replaceChildren();
          if (!rows.length) {
            listBox.append(el('p', 'jr-empty', T.matesEmpty));
            return;
          }
          for (const m of rows) {
            const card = el('article', 'jr-mate');

            const top = el('div', 'jr-mate-top');
            top.append(el('b', 'jr-mate-name', m.name));
            const bits = [`${T.matesTimes} ${m.times} ${T.matesTimesUnit}`];
            // 只报月日：这一页是「上次什么时候」，年份反而碍眼。
            if (m.last) bits.push(`${T.matesLast} ${String(m.last).slice(5)}`);
            top.append(el('span', 'jr-mate-meta', bits.join(' · ')));
            card.append(top);

            /*
             * 熟络度画成一条细条，不写数字。
             *
             * 数字（0-100）在这个页面上只会引出「为什么她才 18 分」这种问题，
             * 而分数是规则算出来的，不是她的态度。条子只表达「更熟/没那么熟」。
             */
            const bar = el('div', 'jr-mate-bar');
            const fill = el('i', 'jr-mate-fill');
            fill.style.width = `${Math.max(0, Math.min(100, Number(m.warmth) || 0))}%`;
            bar.append(fill);
            bar.title = `${T.matesWarmth} ${Math.round(Number(m.warmth) || 0)}`;
            card.append(bar);

            /*
             * 没写印象时说「她还没写」，不说「无印象」——
             * 后者读起来像她已经给这个人下了判断，只是懒得写。
             */
            card.append(m.impression
              ? el('p', 'jr-mate-imp', `「${m.impression}」`)
              : el('p', 'jr-mate-imp jr-mate-imp-empty', T.matesNoImpression));

            listBox.append(card);
          }
        };

        try {
          const r = await ctx.invoke('list');
          draw((r && r.mates) || []);
        } catch (e) {
          listBox.append(el('p', 'jr-empty', T.err));
        }

        /* ---------------- 你的名片 ---------------- */
        /*
         * 全局一张，只有一起走过的人看得见（2026-11-11）。
         *
         * 放在这一页最上面：它是「我是谁」，下面两块是「我记得谁」「我们互相留了什么」——
         * 从自己往外排，读起来才顺。
         */
        const profBox = el('section', 'jr-profile');
        profBox.append(el('h2', 'jr-parties-title', T.profileTitle));
        profBox.append(el('p', 'jr-profile-hint', T.profileHint));
        const profTa = el('textarea', 'jr-card-txt');
        profTa.rows = 3;
        profTa.placeholder = T.profileEmpty;
        const profGo = el('button', 'jr-card-go', T.profileSave);
        profGo.type = 'button';
        const profTip = el('p', 'jr-card-tip', T.profile30);
        profBox.append(profTa, profGo, profTip);
        const profOthers = el('div', 'jr-profiles');
        app.append(profBox, profOthers);

        profGo.onclick = async () => {
          const wrote = profTa.value.trim();
          profGo.disabled = true;
          const was = profGo.textContent;
          profGo.textContent = T.profileSaveBusy;
          try {
            // 空串 = 撤回，服务端会删掉那一行。别在这里拦 —— 撤回是个正经动作。
            /*
             * 同上，参数要包成数组。用户的原始报错：
             * 「『你的名片』那里粘贴的文本，点击存下来，会提示：读不出来。
             *   Core可能刚重启，过一会儿再刷新。（args必须是JSON数组）」
             * —— 括号里那句就是真因。
             */
            await ctx.invoke('saveProfile', [wrote]);
            profTip.textContent = T.profileSaved;
            /*
             * 撤回只清自己那一张，**不动别人的列表**（2026-11-11 自己改的）。
             *
             * 第一版在这里顺手 `profOthers.replaceChildren()` 了 —— 看起来像
             * 「撤回就把这一页清干净」，实际上是：我收回自己的名片，
             * 那些一起走过的人写的字也跟着消失了。他们没撤回，不该被清掉。
             */
            if (!wrote) profTa.value = '';
          } catch (e) {
            profTip.textContent = `${why(T, e)}`;
          } finally {
            profGo.disabled = false;
            profGo.textContent = was;
          }
        };

        const drawProfiles = (rows) => {
          profOthers.replaceChildren();
          if (!rows.length) {
            profOthers.append(el('p', 'jr-empty', T.profileOthersEmpty));
            return;
          }
          profOthers.append(el('h2', 'jr-parties-title', T.profileOthers));
          for (const p of rows) {
            const box = el('div', 'jr-card');
            box.append(el('p', 'jr-card-who', p.pet));
            box.append(el('p', 'jr-card-note', p.text));
            profOthers.append(box);
          }
        };

        try {
          const pr = await ctx.invoke('profile');
          if (pr && pr.mine) profTa.value = pr.mine.text || '';
          /*
           * 2026-11-13：`ready:false` 分两种 —— 没填，和填了但读不成网址。
           * 原来一律说「没配」，填了地址的人会照着这句去「配」，配一百遍也还是那一格字。
           */
          if (pr && !pr.ready) {
            profTip.textContent = pr.urlIssue
              ? T.profileUrlBad.replace('{}', pr.urlIssue)
              : T.partiesNotReady;
          } else if (pr && pr.urlFixed) {
            profTip.textContent = T.profileUrlFixed.replace('{}', pr.urlFixed);
          }
          drawProfiles((pr && pr.others) || []);
        } catch (e) {
          profTip.textContent = T.err;
        }

        /* ---------------- 一起走过的那几趟 ---------------- */
        /*
         * 「她记得谁」和「这一段里我们互相留了什么」是两件事，分开两块。
         *
         * 上面对应 `travel-memory.json`（本机 + 同步盘），这一块对应服务端的卡
         * （按邀约编号取、30 天过期）。混在一起会让人以为「删了记忆卡也没了」，
         * 其实完全是两套东西。
         */
        const partiesTitle = el('h2', 'jr-parties-title', T.partiesTitle);
        const partiesBox = el('div', 'jr-parties');
        app.append(partiesTitle, partiesBox);

        const renderParties = (rows, ready) => {
          partiesBox.replaceChildren();
          if (!ready) {
            partiesBox.append(el('p', 'jr-empty', T.partiesNotReady));
            return;
          }
          if (!rows.length) {
            partiesBox.append(el('p', 'jr-empty', T.partiesEmpty));
            return;
          }
          for (const pt of rows) {
            const card = el('article', 'jr-party');

            const top = el('div', 'jr-party-top');
            top.append(el('b', 'jr-party-city', pt.city || '—'));
            const bits = [`${pt.days} 天`];
            if (pt.pets && pt.pets.length) bits.push(pt.pets.join('、'));
            // 只报月日：这一块讲的是「哪趟」，年份没用。
            if (pt.at) bits.push(String(pt.at).slice(5, 10));
            top.append(el('span', 'jr-party-meta', bits.join(' · ')));
            card.append(top);

            // 别人留的
            for (const c of (pt.others || [])) {
              const box = el('div', 'jr-card');
              box.append(el('p', 'jr-card-who', `${c.pet} · ${T.cardTheirs}`));
              if (c.note) box.append(el('p', 'jr-card-note', `「${c.note}」`));
              if (c.contact) box.append(el('p', 'jr-card-contact', c.contact));
              card.append(box);
            }

            // 自己那张：已经留过就当展示 + 可改；没留过就是纯表单
            const mine = pt.mine && (pt.mine.note || pt.mine.contact) ? pt.mine : null;
            const form = el('div', 'jr-card jr-card-mine');
            if (mine) {
              form.append(el('p', 'jr-card-who', T.cardMine));
              if (mine.note) form.append(el('p', 'jr-card-note', `「${mine.note}」`));
              if (mine.contact) form.append(el('p', 'jr-card-contact', mine.contact));
            }

            const note = el('textarea', 'jr-card-txt');
            note.rows = 2;
            note.placeholder = T.cardNoteHint;
            note.value = mine ? mine.note : '';
            const contact = el('input', 'jr-card-txt');
            contact.type = 'text';
            contact.placeholder = T.cardContactHint;
            contact.value = mine ? mine.contact : '';

            const go = el('button', 'jr-card-go', T.cardLeave);
            go.type = 'button';
            const tip = el('p', 'jr-card-tip', T.card30);

            go.onclick = async () => {
              const n = note.value.trim();
              const c = contact.value.trim();
              if (!n && !c) { note.focus(); return; }
              go.disabled = true;
              const was = go.textContent;
              go.textContent = T.cardLeaveBusy;
              try {
                // 留卡是一次真网络请求（五秒超时）。别在这儿先改 UI，等它回来。
                /* 同上：`invoke(method, args[])`，多出来的参数会被丢掉。 */
                await ctx.invoke('leave', [pt.id, n, c]);
                tip.textContent = T.cardSaved;
              } catch (e) {
                tip.textContent = `${why(T, e)}`;
              } finally {
                go.disabled = false;
                go.textContent = was;
              }
            };

            form.append(note, contact, go, tip);
            card.append(form);
            partiesBox.append(card);
          }
        };

        try {
          const r = await ctx.invoke('parties');
          renderParties((r && r.parties) || [], !!(r && r.ready));
        } catch (e) {
          partiesBox.replaceChildren(el('p', 'jr-empty', T.err));
        }
      },
    },

    /**
     * 「设置」页：生图走云端还是本地（2026-11-14）。
     *
     * ## 为什么要一页自己的 UI
     *
     * 宿主的设置面板按 schema 平铺渲染，`ConfigProperty` 里**没有条件显示** ——
     * 十六个键全摊在一屏，云端和本地的字段混着排，用户只能靠标题里的
     * 「［云端］」「［本地］」去认。这一页要做的就是把它拆成两半：
     * 点哪边，只显示哪边的字段。
     *
     * ## 三个设计决定
     *
     * 1. **改动先落草稿，点保存才提交。** 每敲一个字就写一次配置，会把保存日志刷满；
     *    而且半截的地址（`https://ark.cn-bei`）会在这几十毫秒里成为生效值。
     * 2. **密钥只写不回显。** 输入框永远空着，placeholder 说「已存好 / 还没填」。
     *    这是唯一一种既能改、又不把密钥抄进 DOM 的写法。
     * 3. **服务地址按后端各存一份。** 云端和本地共用 `imageApi` 这一个键，
     *    但值是两回事（`https://ark…/api/v3` 和 `http://127.0.0.1:8188`）。
     *    切成同一个草稿的话，切过去再切回来，地址就被另一边的冲掉了 ——
     *    而用户点这个按钮的期待是「换一套」，不是「清空」。
     */
    settings: {
      async mount(ctx) {
        const S = SET[String(ctx.language || 'zh').startsWith('zh') ? 'zh' : 'en'];
        const T = text(ctx.language);
        const app = el('div', 'jr-app jr-set');
        ctx.root.append(app);

        let data = null;
        const draft = {
          protocol: 'openai',
          preset: 'custom',
          api: { openai: '', comfyui: '' },
          model: '',
          size: '',
          workflow: '',
          promptNode: '',
          negative: '',
          negativeNode: '',
          key: '',
          // 「两边共用」那一区。原来住在设置页的「生图」组里，组删了就搬到这儿。
          minimal: false,
          style: '',
          cast: '',
          watermark: 'auto',
          timeoutSec: 0,
          photoDir: '',
        };

        const seg = el('div', 'jr-set-seg');
        const bodyBox = el('div', 'jr-set-body');
        const otherBox = el('div', 'jr-set-other');
        const noteBox = el('p', 'jr-set-note');
        const status = el('span', 'jr-set-status');
        const saveBtn = el('button', 'jr-btn jr-btn-primary', S.save);
        saveBtn.type = 'button';
        // 先锁上，等第一轮读数回来再开 —— 理由见 `load` 的 catch。
        saveBtn.disabled = true;
        const foot = el('div', 'jr-set-foot');

        app.append(el('p', 'jr-eyebrow', S.eyebrow));
        app.append(el('h1', 'jr-set-h1', S.title));
        app.append(el('p', 'jr-set-intro', S.intro));
        app.append(seg, bodyBox, otherBox, noteBox, foot);
        app.append(el('p', 'jr-set-more', S.more));
        foot.append(saveBtn, status);

        /** 预设表按当前草稿里选的那一档查，查不到就当没有。 */
        const presetNow = () => {
          const all = data && data.presets;
          return (all && all[draft.preset]) || null;
        };

        /** 一行「标签 + 输入框 + 一行小字」。 */
        const field = (label, hint, value, oninput, placeholder) => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', label));
          const input = el('input', 'jr-set-v');
          input.type = 'text';
          input.spellcheck = false;
          input.value = value || '';
          if (placeholder) input.placeholder = placeholder;
          input.addEventListener('input', () => oninput(input.value), { signal: ctx.signal });
          row.append(input);
          if (hint) row.append(el('span', 'jr-set-hint', hint));
          return row;
        };

        const segBtn = (id, label) => {
          const b = el('button', 'jr-set-seg-btn', label);
          b.type = 'button';
          b.addEventListener('click', () => {
            draft.protocol = id;
            drawSeg();
            drawBody();
          }, { signal: ctx.signal });
          return b;
        };
        const cloudBtn = segBtn('openai', S.cloud);
        const localBtn = segBtn('comfyui', S.local);
        seg.append(cloudBtn, localBtn);

        const drawSeg = () => {
          cloudBtn.classList.toggle('on', draft.protocol === 'openai');
          localBtn.classList.toggle('on', draft.protocol === 'comfyui');
        };

        const presetRow = () => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', S.preset));
          const box = el('div', 'jr-set-chips');
          for (const id of ['doubao', 'openai', 'custom']) {
            const chip = el('button', 'jr-set-chip', S.presets[id]);
            chip.type = 'button';
            if (draft.preset === id) chip.classList.add('on');
            chip.addEventListener('click', () => {
              draft.preset = id;
              drawBody();   // placeholder 要跟着预设换
            }, { signal: ctx.signal });
            box.append(chip);
          }
          row.append(box);
          row.append(el('span', 'jr-set-hint', S.presetHint));
          return row;
        };

        const keyRow = () => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', S.key));
          const box = el('div', 'jr-set-keybox');
          const input = el('input', 'jr-set-v');
          input.type = 'password';
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.placeholder = data && data.hasKey
            ? (data.keyInEnv ? S.keyInEnv : S.keySaved)
            : S.keyNone;
          input.addEventListener('input', () => { draft.key = input.value; }, { signal: ctx.signal });
          box.append(input);
          row.append(box);
          row.append(el('span', 'jr-set-hint', S.keyHint));
          return row;
        };

        const workflowRow = () => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', S.workflow));
          const box = el('div', 'jr-set-keybox');
          const input = el('input', 'jr-set-v');
          input.type = 'text';
          input.spellcheck = false;
          input.value = draft.workflow || '';
          input.placeholder = 'pet-qwen.json';
          input.addEventListener('input', () => { draft.workflow = input.value; }, { signal: ctx.signal });
          const pick = el('button', 'jr-btn', S.pick);
          pick.type = 'button';
          pick.addEventListener('click', () => {
            /*
             * 选完直接把路径填回去 —— 面板里存的是**路径**，不是 JSON 内容，
             * 和设置页那一项（`x-path`）保持同一个语义。`photo.ts` 那边两种都认。
             */
            ctx.pickPath({ kind: 'file', extensions: ['.json'] }).then((picked) => {
              if (!picked) return;
              draft.workflow = picked;
              input.value = picked;
            }).catch((e) => {
              status.textContent = `${S.pickFail}（${String((e && e.message) || e)}）`;
            });
          }, { signal: ctx.signal });
          box.append(input, pick);
          row.append(box);
          return row;
        };

        const drawBody = () => {
          bodyBox.replaceChildren();
          if (!data) return;
          const pv = presetNow();
          const cloud = draft.protocol === 'openai';
          bodyBox.append(el('p', 'jr-set-side', cloud ? S.cloudHint : S.localHint));

          if (cloud) {
            bodyBox.append(presetRow());
            bodyBox.append(field(
              S.api, S.apiCloud, draft.api.openai,
              (v) => { draft.api.openai = v; }, (pv && pv.api) || '',
            ));
            bodyBox.append(field(
              S.model, '', draft.model,
              (v) => { draft.model = v; }, (pv && pv.model) || '',
            ));
            bodyBox.append(field(
              S.size, S.sizeHint, draft.size,
              (v) => { draft.size = v; }, (pv && pv.size) || '',
            ));
            bodyBox.append(keyRow());
          } else {
            bodyBox.append(field(
              S.api, S.apiLocal, draft.api.comfyui,
              (v) => { draft.api.comfyui = v; }, 'http://127.0.0.1:8188',
            ));
            bodyBox.append(workflowRow());
            bodyBox.append(field(S.promptNode, S.optional, draft.promptNode, (v) => { draft.promptNode = v; }, '6'));
            bodyBox.append(field(S.negative, S.optional, draft.negative, (v) => { draft.negative = v; }, ''));
            bodyBox.append(field(S.negativeNode, S.optional, draft.negativeNode, (v) => { draft.negativeNode = v; }, ''));
          }
        };

        const drawNote = () => {
          noteBox.replaceChildren();
          if (!data) return;
          noteBox.append(el('b', '', `${S.note} `));
          noteBox.append(el('span', '', data.note || '—'));
          if (data.sizeNote) {
            noteBox.append(el('br'));
            noteBox.append(el('span', 'jr-set-warn', data.sizeNote));
          }
        };

        /** 一行「标签 + 复选框」。 */
        const checkRow = (label, hint, checked, onchange) => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', label));
          const box = el('div', 'jr-set-keybox');
          const input = el('input', 'jr-set-check');
          input.type = 'checkbox';
          input.checked = Boolean(checked);
          input.addEventListener('change', () => onchange(input.checked), { signal: ctx.signal });
          box.append(input);
          row.append(box);
          row.append(el('span', 'jr-set-hint', hint));
          return row;
        };

        /** 一行「标签 + 几个胶囊」。选项少于一屏时比下拉好：一眼全看见。 */
        const chipRow = (label, hint, options, current, onpick) => {
          const row = el('div', 'jr-set-row');
          row.append(el('span', 'jr-set-k', label));
          const box = el('div', 'jr-set-chips');
          for (const opt of options) {
            const chip = el('button', 'jr-set-chip', opt.label);
            chip.type = 'button';
            if (current === opt.id) chip.classList.add('on');
            chip.addEventListener('click', () => onpick(opt.id), { signal: ctx.signal });
            box.append(chip);
          }
          row.append(box);
          row.append(el('span', 'jr-set-hint', hint));
          return row;
        };

        /**
         * 「两边共用」那一区。
         *
         * 这六项原来住在设置页的「生图」组里，组跟着删掉了 —— 不搬进来的话，
         * 「配置」页少一屏的代价不是少一屏，是**这六项从此没有入口**。
         * 它们和协议无关（云端本地都吃），所以不随上面的切换重绘。
         */
        const drawOther = () => {
          otherBox.replaceChildren();
          if (!data) return;
          otherBox.append(el('h2', 'jr-set-h2', S.other));
          otherBox.append(checkRow(S.minimal, S.minimalHint, draft.minimal, (v) => { draft.minimal = v; }));
          otherBox.append(field(S.style, S.styleHint, draft.style, (v) => { draft.style = v; }, ''));
          otherBox.append(field(S.cast, S.castHint, draft.cast, (v) => { draft.cast = v; }, ''));
          otherBox.append(chipRow(
            S.watermark, S.watermarkHint,
            [
              { id: 'auto', label: S.watermarks.auto },
              { id: 'off', label: S.watermarks.off },
              { id: 'crop', label: S.watermarks.crop },
            ],
            draft.watermark,
            (id) => { draft.watermark = id; drawOther(); },
          ));
          otherBox.append(field(
            S.timeout, S.timeoutHint, String(draft.timeoutSec || ''),
            (v) => { draft.timeoutSec = Math.max(0, Math.round(Number(v) || 0)); }, '0',
          ));

          const dirRow = el('div', 'jr-set-row');
          dirRow.append(el('span', 'jr-set-k', S.photoDir));
          const dirBox = el('div', 'jr-set-keybox');
          const dirInput = el('input', 'jr-set-v');
          dirInput.type = 'text';
          dirInput.spellcheck = false;
          dirInput.value = draft.photoDir || '';
          dirInput.addEventListener('input', () => { draft.photoDir = dirInput.value; }, { signal: ctx.signal });
          const pickDir = el('button', 'jr-btn', S.pickDir);
          pickDir.type = 'button';
          pickDir.addEventListener('click', () => {
            ctx.pickPath({ kind: 'directory' }).then((picked) => {
              if (!picked) return;
              draft.photoDir = picked;
              dirInput.value = picked;
            }).catch((e) => {
              status.textContent = `${S.pickFail}（${String((e && e.message) || e)}）`;
            });
          }, { signal: ctx.signal });
          dirBox.append(dirInput, pickDir);
          dirRow.append(dirBox);
          dirRow.append(el('span', 'jr-set-hint', S.photoDirHint));
          otherBox.append(dirRow);
        };

        /** 把一份后端快照铺回草稿和界面。首次读取与保存后的刷新共用同一段。 */
        const applySnapshot = (snap) => {
          data = snap;
          saveBtn.disabled = false;
          draft.protocol = data.protocol === 'comfyui' ? 'comfyui' : 'openai';
          draft.preset = data.preset || 'custom';
          /*
           * 已保存的地址只归「它像的那一边」。
           *
           * `imageApi` 两条路共用一个键，但值是两回事。按内容归类，切过去再切回来
           * 地址还在；不归类的话，切一次就只剩一边有值 —— 而用户点这个按钮的
           * 期待是「换一套」，不是「清空」。
           */
          const looksLocal = /127\.0\.0\.1|localhost|:8188|192\.168\./i.test(data.api || '');
          draft.api = { openai: '', comfyui: '' };
          draft.api[looksLocal ? 'comfyui' : 'openai'] = data.api || '';
          draft.model = data.model || '';
          draft.size = data.size || '';
          draft.workflow = data.workflow || '';
          draft.promptNode = data.promptNode || '';
          draft.negative = data.negative || '';
          draft.negativeNode = data.negativeNode || '';
          draft.minimal = Boolean(data.minimal);
          draft.style = data.style || '';
          draft.cast = data.cast || '';
          draft.watermark = data.watermark || 'auto';
          draft.timeoutSec = Number(data.timeoutSec) || 0;
          draft.photoDir = data.photoDir || '';
          draft.key = '';
          drawSeg();
          drawBody();
          drawOther();
          drawNote();
        };

        const load = async () => {
          try {
            applySnapshot(await ctx.invoke('imageSettings'));
          } catch (e) {
            /*
             * **读不到当前值就不许写。** 这时草稿全是初始值（地址空、模型空），
             * 保存一次等于把用户配好的东西全抹掉 —— 而这恰恰是他最需要
             * 原样保留的时刻（扩展没起来 / Core 还是旧版本）。
             */
            saveBtn.disabled = true;
            bodyBox.replaceChildren(el('p', 'jr-empty', `${S.loadFail}${why(T, e)}`));
          }
        };

        saveBtn.addEventListener('click', () => {
          const cloud = draft.protocol === 'openai';
          const api = (draft.api[draft.protocol] || '').trim();
          /*
           * **只提交当前这一边的键。**
           *
           * 全提交过一次，代价很实在：在本地页点保存，`imageModel` 跟着提交了空串，
           * 把云端填好的模型名清掉了 —— 而那人根本没碰过那一格。
           * 界面不显示的项，就不该被这次保存碰到。
           */
          const values = { imageProtocol: draft.protocol };
          if (cloud) {
            values.imagePreset = draft.preset;
            values.imageApi = api;
            values.imageModel = draft.model.trim();
            values.imageSize = draft.size.trim();
            /*
             * 密钥留空＝不动，这一条必须在 `values` 之外判断 ——
             * 提交空串会把它清掉，而「我没想改密钥」是最常见的一次保存。
             */
            if (draft.key.trim()) values.imageKey = draft.key.trim();
          } else {
            values.imageApi = api;
            values.imageWorkflow = draft.workflow.trim();
            values.imagePromptNode = draft.promptNode.trim();
            values.comfyNegative = draft.negative.trim();
            values.comfyNegativeNode = draft.negativeNode.trim();
          }
          /*
           * 「两边共用」那六项每次都提交 —— 界面上一直显示，改动跟协议无关，
           * 不存在「这一边不该碰那一边」的问题。
           */
          values.imageMinimal = draft.minimal;
          values.imageStyle = draft.style.trim();
          values.imageCast = draft.cast.trim();
          values.imageWatermark = draft.watermark;
          values.imageTimeoutSec = draft.timeoutSec;
          values.photoDir = draft.photoDir.trim();

          saveBtn.disabled = true;
          status.textContent = S.saving;
          /*
           * 写走 `invoke`，不走 `ctx.setConfig`。
           *
           * 生图那一组已经从「配置」页删掉了，而宿主 `/api/config` 是**按组寻址**的
           * —— 组不在，连提交都找不到门。后端用 `persist` 落盘，同样会改 `cfg` 活对象，
           * 所以下一张照片立刻按新设置走；而且它直接回一份最新快照，省一次往返。
           */
          ctx.invoke('saveImageSettings', [values]).then((fresh) => {
            status.textContent = S.saved;
            applySnapshot(fresh);
          }).catch((e) => {
            saveBtn.disabled = false;
            status.textContent = why(T, e);
          });
        }, { signal: ctx.signal });

        await load();
      },
    },
  },
};
