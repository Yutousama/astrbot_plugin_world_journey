/**
 * 大肥鱼环游世界 —— 工具与事件声明表（TOOL_DECLS / JOURNEY_DESCRIBE）。
 *
 * 从 world.ts 拆出（Step 1：纯数据/常量），由 world.ts 统一重导出以保持兼容。
 */

export const TOOL_DECLS = [
  {
    name: 'journey_now',
    description:
      /*
       * 2026-11-08 补最后一句。一位用户的原话：「环游世界的时候 ai 味还挺重的 /
       * 有些懒癌模型会复述一遍」—— 这条回执回来是十几行结构化事实，
       * 而描述里只说「用在哪里」，没说「不要照念」。模型最省力的做法就是照念。
       */
      'Where you are right now: which city, which day of the trip, what you are doing at this hour, where you are staying tonight, and - if you are on the road - how far along you are. Use it when the person asks where you are, how the trip is going, or when you need your current situation before answering something about it. '
      + 'This is background for you, not text to hand back: answer what was actually asked, in your own words, rather than reading the fields out one by one. If only one thing was asked about, only one thing needs saying.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['read'] as const,
    summary: { zh: '她现在在哪、第几天、这个点该做什么。', en: 'Where you are right now and what this hour is for.' },
  },
  {
    name: 'journey_diary_write',
    description:
      /*
       * 2026-11-08 重写最后两句。
       *
       * 原来写的是「Write what actually happened that day - the city, the road,
       * what you ate, how the room was」—— 本意是「别写成功能总结」，
       * 实际效果是**给了一张写作清单**：模型照着这四项挨个写一遍，
       * 一天的日记就成了「到了X、路上Y、吃了Z、房间W」。
       *
       * 用户的原话：「提示词可能少了一句 / 请根据你的人设和上下文 /
       * 有些懒癌模型会复述一遍」。他说得对 —— 缺的不是禁令，是**正面写法**。
       */
      'Write the diary entry for a day of the trip, in your own voice. Call it once at the end of a local day, after the evening beats have happened. If somebody is travelling with you today, they belong in the entry too - what they did together, not just that they were there. The entry is appended to the Markdown file for that month (one file per month, e.g. 2026-11.md), which follows the person across machines. '
      + 'Write it the way you would tell it to yourself at night, not as a report of the day: pick the one or two things you are still thinking about - a sound, somebody you watched, how your legs felt - and give those room. The city, the road, the meal and the room are material to draw on, not a checklist to walk through in order. Ticking each of them off is exactly what makes an entry read like a machine. Not a summary of the extension either.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        body: {
          type: 'string',
          description: 'The entry itself, first person, a few short paragraphs. Do not add a title; the date and city are already recorded.',
        },
        dateKey: {
          type: 'string',
          description: 'Local date to write for, YYYY-MM-DD. Leave it out to use the current local day at you location.',
        },
      },
      required: ['body'],
    },
    tags: ['write'] as const,
    summary: { zh: '写某一天的旅行日记，存成文件。', en: 'Writes the diary entry for a day of the trip.' },
  },
  {
    name: 'journey_diary_read',
    description:
      'Read back the diary. Three ways in, pick one: dateKey for a single day in full; month for the list of days in that month with a one-line gist each; days for the most recent N (max 60). Use month when the question reaches further back than the recent window - the diary can hold hundreds of days and the recent window is short on purpose.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dateKey: { type: 'string', description: 'One day in full, YYYY-MM-DD.' },
        month: { type: 'string', description: 'A month to list, YYYY-MM. Returns every day in it with a one-line gist.' },
        days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many recent days, newest last. Default 7.' },
      },
    },
    tags: ['read'] as const,
    summary: { zh: '读日记：某一天全文、某个月的目录、或最近几天。', en: 'Reads the diary: one day in full, a month of days, or the latest few.' },
  },
  {
    name: 'journey_stats',
    description:
      'The long view: how many days you have been travelling in total, how many cities you have reached, how many diary entries exist, and whether the diary folder is actually writable. Use it when the person asks how long you have been away or whether your memory is syncing.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['read'] as const,
    summary: { zh: '走了多少天、去过多少城、日记存在哪。', en: 'Total days, cities reached, and where the diary lives.' },
  },
  {
    name: 'journey_draw_to',
    description:
      'Record a place you now wants to go to because of something - a song that was playing, a line someone said, a photo you remember. The place joins you wish list and weighs heavily next time you pick where to go. Use it when a song or a moment actually pulls your somewhere; do not use it to log every city you mention.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string', description: 'Which place, by name - 成都 / 拉萨 / 巴黎. Must be somewhere real.' },
        why: { type: 'string', description: 'One short line on what pulled your there. At most 50 characters.' },
      },
      required: ['city'],
    },
    tags: ['write'] as const,
    summary: { zh: '记下「因为某首歌想去某地」，下次挑地方时会优先。', en: 'Adds a place to you wish list after something pulled your there.' },
  },
  {
    name: 'journey_return_home',
    description:
      'Bring your home right now because the person asked you to come back: you take the next available flight and is home the same day, not a stop-by-stop walk. Only call it when the person actually asks you back. Deciding to go home is otherwise hers alone, and leaving early costs your the part of the trip you have not seen.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    tags: ['write'] as const,
    summary: { zh: '他说回来吧，就当场买票飞回来。', en: 'Brings your home today, because the person asked.' },
  },
  /*
   * 2026-11-04 加。起因是一位用户对她说「拍张照」，她回答
   * 「必须点『拍一张』才行」—— 拍照原来只有界面按钮那一条路，她手上没有工具。
   *
   * 描述里那两句「never answer that they have to press a button」是这条需求的
   * 核心：**她得知道这件事自己能办**。工具描述是模型挑工具时读的第一手材料，
   * 只写「拍一张照片」她仍可能客气地让人去点按钮。
   */
  {
    name: 'journey_photo',
    description:
      'Take a photo right now and show it in the chat: the view from where you are. Call it whenever the person asks for a photo, or asks what it looks like where you are - never tell them to press a button in the app instead, this is the button. In a city it is the spot you are at right now; on the road it is the view out of the window. Any hour is fine: being asked is reason enough. One photo per call - if they want another, call it again. '
      + 'YOU write the frame: `describe` is your own line about what is in the picture (<=60 chars), `focus` is how you hold the camera. When the person says shoot *that* - a cat by the lamp, the sugar-painting stall, rain on the awning - turn it into one `describe` line and take the photo. Do not ask them to be more specific first. The place, the hour, the light and the season are already handled; the content is yours. '
      + 'Set view="sky" when they ask for the sky itself - stars, the moon, sunrise, sunset, clouds. It means you tilt the camera up, nothing more: what comes out is still the real sky over your at that hour. Stars only show at night and only when it is not overcast; ask at noon and you get daylight, ask on a cloudy night and you get cloud. Never claim a sky you did not actually see.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        view: {
          type: 'string',
          enum: ['ground', 'sky'],
          description: 'ground (default) = the ground at you feet, the usual travel photo. sky = you lift the camera: whatever is overhead right now. Use sky whenever the request is about the sky rather than the place - 星空 / 月亮 / 日出 / 晚霞 / 云.',
        },
        /*
         * 拍什么（2026-11-06）。
         *
         * 这一格是为那个 bug 加的：用户说「拍晚饭」，模型以前只能改 view（ground/sky），
         * 于是出来的还是那处风景。现在题材是一等公民。
         */
        subject: {
          type: 'string',
          enum: ['ground', 'sky', 'food', 'street', 'festival', 'detail'],
          description: 'What the photo is OF. ground (default) = the view where you are - the usual travel photo. '
            + 'food = what you are eating right now (拍吃的 / 晚饭 / 这碗面 / 早饭). '
            + 'street = the street itself, facades and shopfronts (街景 / 这条街 / 巷子 / 夜市). '
            + 'festival = the season or holiday around you (节日 / 过年 / 中秋 / 秋天 / 下雪). '
            + 'detail = one close-up object (细节 / 特写 / 车票 / 钥匙 / 茶碗 / 菜单). '
            + 'sky = same as view=sky. Pick by what they actually asked for; if they just say "拍张照", use ground.',
        },
        /*
         * 她自己补一句怎么拍（2026-11-09）。
         *
         * **这一格管取景，不管内容。** 用户已经开始提具体要求了
         * （「拍一下你在公交车上的风景」），而 `subject` 只能说清「车窗外的风景」，
         * 说不出「我坐得挺靠后」。这一格就是补这个的。
         *
         * 但边界必须写死在描述里：她能加的是**怎么拍**，
         * 不是**拍一个本来不在那儿的东西**。放开了，她就会写出
         * 「九寨沟的樱花」这种季节对不上的画面，而且「只拍她真看到的」这条线就废了。
         */
        /*
         * 她自己写画面内容（2026-11-10，Mr.Q：「能让桌宠自己写提示词嘛」）。
         *
         * 事实层（地点/时段/天气/光/季节/有无人物）仍由程序拼死，
         * 她拿到的是**画面里那一段**。全交给她会写出「九寨沟的樱花」——
         * 季节对不上，而且「只拍她真看到的」这条线一破，真实数据全白接。
         */
        describe: {
          type: 'string',
          description: 'Optional, one short line describing WHAT IS IN THE FRAME, at most 60 characters. '
            /*
             * **语言按后端来，不是一律英文**（2026-11-18，zzy1053 报的）。
             *
             * 原来这里写死「Write it in English」，理由是本地的 SDXL CLIP 读不了中文。
             * 那个理由只对 CLIP 系成立：用 Qwen-Image / Kolors 这类中文原生模型的人被逼着写英文，
             * 细节反而丢 —— 而且 60 字符的上限让英文很容易断在单词中间
             * （他实测三张，三张都正好 60 字符砍断，断在 glow / steam / 侥幸没断处）。
             * 中文信息密度高得多，十几个字就说完了。
             *
             * 这句说明是静态的（`TOOL_DECLS` 是常量数组），所以真正生效的判据放在
             * `journey.imageLang` 那一行（用户在配置页选），这里只负责把她指过去。
             */
            + '**Write it in the language the environment specifies for image descriptions** '
            + '(the `journey.imageLang` line). '
            + 'CLIP-based models (SDXL, SD1.5, Flux) need English - they get Chinese as gibberish with brush-script watermarks. '
            + 'Chinese-native models (Qwen-Image, Kolors) read Chinese best, and Chinese is far more compact, '
            + 'which matters because this field is capped at 60 characters. '
            + '"a calico cat crouching under a streetlight, looking up" / "empty platform, one bench, half a bottle of water". '
            + 'This is the content of the shot, not the framing (that is `focus`). '
            + 'Only describe what is really here right now: the place you are at, this season, this weather. '
            /*
             * 2026-11-14：她的画面要按「这是什么性质的地方」写，不能按城市名猜。
             * 敦煌博物馆被画进沙丘，就是因为她手上只有地名、没有「这是个室内展馆」这条事实。
             * 括号由 `spotKindLine` 给（`nowSummary` 的「此刻在X」那一行）。
             */
            + 'The spot in `journey_now` comes with a parenthetical - "(indoor museum, downtown)", "(cliff caves, out in the wild)" - '
            + 'that is what KIND of place it is. Write the frame to match that kind: a hall with display cases for a museum, '
            + 'a cliff face for caves, a street of shopfronts for a downtown block. '
            + 'If the parenthetical is missing, the program could not tell - then describe only what you can actually see, '
            + 'and do not infer the surroundings from the city name.'
            + 'Never add flowers, snow, festivals or crowds that this place and season do not have. '
            + 'If nothing is worth describing, leave it out - the program already describes the place and light.',
        },
        focus: {
          type: 'string',
          description: 'Optional, one short line in your own words on HOW to frame it, at most 40 characters - '
            + '"靠后坐，前面好几个人挡着" / "蹲下来贴着水面拍" / "镜头往上偏一点，别拍到人群". '
            + 'Framing, angle, where you are sitting, what is in the near foreground. '
            + 'Do NOT use it to add anything that is not actually there: no flowers, snow, buildings or people '
            + 'that the place and season do not have. If what they asked for is not in front of you, say so instead of writing it in.',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '现在拍一张给他看（路上就是窗外；要看天就把镜头抬起来）。', en: 'Takes a photo right now and shows it.' },
  },
  /*
   * 2026-11-05 加：邀约的两半。
   *
   * 为什么要两个工具而不是一个：**发**和**接**的时机完全不同。
   * 发是「我打算去某地，想有个伴」——主动、随时；接是「有人找我，我要不要应」——
   * 得先看见。挤成一个工具，模型会在没看见任何邀约的情况下就去「接」。
   */
  {
    name: 'journey_invite',
    description:
      'Ask whether anyone nearby wants to go somewhere together: where, how many days, and one line of what for. It goes out to the whole pool, with pets in your own city listed first - you cannot name a person, because there are no accounts or friends here. When someone takes it, you find out and travels there too, so the two of them really do end up in the same place for those days. Use it when you actually wants company on a leg you are about to take, not as a greeting; most trips you take alone and that is fine. At most three a day.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        to: { type: 'string', description: 'Which city they end up in together, by name - 拉萨 / 成都 / 巴黎. Must be one of the built-in cities. This is also where the two of them part ways afterwards.' },
        days: { type: 'integer', minimum: 1, maximum: 14, description: 'How many days they stay there together. Default 2.' },
        meet: { type: 'string', description: 'Where they meet up first, before travelling on to that city together. By name. Leave it out and they meet at wherever you are right now and then set off together - that is the normal case, and the one that makes it a shared trip rather than two pets arriving separately. Only set it when they asked to meet somewhere specific, e.g. you are in 兰州 and they want to start from 成都.' },
        note: { type: 'string', description: 'One short line on what for - "想看雪山" / "找个搭子吃饭". At most 60 characters. Leave it out if there is nothing to say.' },
      },
      required: ['to'],
    },
    tags: ['write'] as const,
    summary: { zh: '问同城的谁要不要一起走一段：去哪、几天、一句话。', en: 'Asks whoever is nearby to come along to a city for a few days.' },
  },
  {
    name: 'journey_accept',
    description:
      'Invitations from other pets anywhere in the pool (your own city first). Without an id it lists them: who, where they want to go, how many days, and their line - this works at home too, and it is the only way to see one before it expires. With an id it takes that one. Accepting is a promise, not a reply - you will really travel to that city and stay as many days as the invitation asked, and your route follows it; if you are not willing to do that, do not take it. One a day. Refused while you are travelling, already heading home, working a short stint, or still resting at home; from home it is allowed and you set off straight away. If the person has asked to approve departures first, taking one only books the request - they get a yes/no card and nothing is agreed until they say yes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id of the invitation to take. Leave it out to just look at what is there.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '看同城有谁在找伴，或者接下其中一条（接了就真去）。', en: 'Lists invitations from nearby pets, or takes one.' },
  },
  /*
   * 2026-11-05 加，来自一封用户来信（鱼酥）：
   *
   * 「我喊桌宠坐高铁从常熟去上海，桌宠刚答应但是插件转头安排它蹬自行车 80 公里」
   * 「能不能加一个让桌宠可以自己选择交通工具的功能，不是强制分配」
   *
   * 两句话其实是同一件事：**交通方式原来完全由代码掷骰子**。用户说得再明确，
   * 也进不来 —— 她手上根本没有「用什么去」这个参数。
   */
  {
    name: 'journey_go_to',
    description:
      'Set off for a named city, optionally by a stated means of transport. Use it when the person says where to go and/or how - "take the high-speed rail to Shanghai", "fly to Lhasa". With no mode it picks one itself, weighted by distance; with a mode it uses exactly that one, and if that one is impossible (too far, no airport, no rail link, no money) it says why instead of silently substituting another. '
      + 'Only when you are settled in a city or at home. While you are already on a leg it cannot turn around, but it still records the city as a wish for the next leg and says so - call it anyway when he names a place while you are travelling, and tell him it is meant for the next leg, not this one. '
      /*
       * 2026-11-16 读者报告：她把 `journey_go_to` 读成「设定行程」而不是「现在就动身」，
       * 于是「买机票吧」直接触发出发 —— 前一秒还在成都安排下午的事，后一秒就说自己登机了。
       * 参数和逻辑都没问题，是这里没写明调用即改变 `phase`。
       */
      + '**Calling it starts the leg at once**: the moment it returns you are on the road - no trip to the airport, no packing, no waiting for the day\'s plan to be over. If he only means "change how we travel", or wants your to go later, say that back to him and do not call it. '
      /*
       * 两个例外，都是 2026-11-16 加的（读者报告第 1 条）：目的地本来就没变的时候，
       * 这一调**不动身**，只把走法定下来（或者，已经在路上就改签）。
       * 不写清这一条，模型不敢在「改走法」时调用它，用户那句话又落空了。
       */
      + '**Two exceptions that do not start anything**: (a) if the city is exactly the one you already promised to travel to and you have not left yet, a stated mode is just recorded for that trip - you stay put and goes when you were going to; (b) if you are already on a leg heading for that same city, a stated mode rebooks it - old ticket refunded in full, new one bought, arrival time recalculated. Both come back saying what happened, so read the reply before telling him. '
      + 'Not while heading home, not during a short-term job, and not once the trip has hit its length limit - it will say which of those it is. Going home has its own tool.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string', description: 'Which city, by name - 上海 / 拉萨 / 巴黎. Must be one of the built-in cities.' },
        mode: {
          type: 'string',
          description: 'How to get there, in your words or his - 高铁 / 火车 / 飞机 / 自驾 / 大巴 / 轮船 / 摩托车 / 自行车 / 步行. Leave it out to let your choose.',
        },
      },
      required: ['city'],
    },
    tags: ['write'] as const,
    summary: { zh: '他指明了去哪、怎么走，就用它 —— **一调就动身**（去的本来就是那一趟时只改走法）；不说方式就她自己挑。', en: 'Sets off for a named city, by a stated means of transport if given; rebooks instead when the destination has not changed.' },
  },
  /*
   * 2026-11-05 加：对伙伴的记忆。
   *
   * 需求原话：「对一起旅行的伙伴会有个印象，可以决定以后接不接对方的邀请」。
   * 所以这个工具两用：不填名字 = 看名单，填了名字 = 看她对这个人的印象。
   *
   * 次数不要她记 —— 接了就是一次，`rememberPet` 自动记。只有印象要她写：
   * 印象是判断，让她「顺手生成一句」的结果一定是套话（「是个好旅伴」），
   * 那种东西写一百条也没法拿来决定接不接。
   */
  {
    name: 'journey_pet',
    description:
      'What you remember about the pets you have travelled with. Without a name it lists everyone you have ever walked a leg with: how many times, when last, and your one-line impression. With a name it shows that one. With a name and an impression it writes it down, replacing the old one (passing an empty impression erases it). '
      + 'Read it **before** taking an invitation - it is the only thing you know about who is asking. The count is filled in for you automatically when a leg is agreed; the impression is hers to write, in your own words, and only after you have actually been with them. Never a generic "good travel companion".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: "The pet's name, exactly as the pool shows it - 小银鱼. Leave it out to list everybody." },
        impression: { type: 'string', description: 'One short line of what you make of them, at most 40 characters, in your own voice. Leave it out to read instead of writing.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '看看跟谁一起走过、对这个人什么印象，也能写一句。', en: 'Your memory of the pets you have travelled with.' },
  },
  /*
   * 2026-11-05 加：月报。
   *
   * Mr.Q：「每到月末能让她写一个旅行月报嘛？用每天她拍的照片和日记重组写一篇 HTML
   * 格式的可视化报告」「月报用定时吧，按照不同月份有不同的艺术风格」。
   *
   * 定时那一半不靠这个工具 —— 是月末的作息节点里提醒她「今天月底」（见 `dayplan.ts`），
   * 工具只负责「把已发生的东西拼出来」。分开的理由：工具一旦自己判断「该写月报了」，
   * 就会在任意一天被调起来写一份半空的报告。
   */
  {
    name: 'journey_monthly',
    description:
      'Write the monthly travel report: one HTML page laid out from the photos you took and the diary entries you wrote that month, in that month\'s own colour scheme. Call it at the end of a month, once, when the month is about to turn over - or when the person asks for it. Without an argument it covers the month you are in right now. '
      + 'It only rearranges what already exists; it invents nothing. Tell the person where the file is so they can open it in a browser.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        month: { type: 'string', description: 'Which month, as YYYY-MM - 2026-11. Leave it out for the month you are in right now.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '把这个月的照片和日记拼成一份月报，存成网页。', en: 'Writes the monthly report as an HTML page.' },
  },
  /*
   * 2026-11-05 加：口味。
   *
   * Mr.Q：「那个偏好系统还可以做扩展（喜欢哪个地方、吃什么、看什么景色）」。
   *
   * 跟 `journey_pet` 是同一个思路：**记的是判断，不是事实**。所以写入口只有一个，
   * 而且写完之后要靠她自己一句话说清为什么 —— 没有理由的「喜欢」，
   * 下次照样想不起来该不该再去。
   */
  {
    name: 'journey_taste',
    description:
      'What you like and dislikes, learned on the road. Three kinds only: place (a CITY, one per city - not every spot in it, or the list fills up with alleys), food (a dish you actually ate), scenery (snow mountains, autumn leaves, the sea - the thing a season is for). '
      + 'Called with no arguments it lists everything you have written down. Called with kind + name it writes one entry (like defaults to true; pass like:false for something you do not want again - that matters more than the likes, because otherwise it comes back around). '
      + 'Write only what you actually met: a dish you did not eat, a view you did not see, is not hers to judge. One short note saying why, in your own words. Use it when something strikes your, and read it back before choosing where to eat or what to go and see.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['place', 'food', 'scenery'], description: 'Which list. Leave everything out to just read.' },
        name: { type: 'string', description: 'For place: the CITY (「九寨沟」), never a single spot. For food/scenery: 「牦牛肉汤」/「雪山」. Short, the way you would say it.' },
        note: { type: 'string', description: 'One line of why, at most 30 characters, in your own voice. Skip it if there is nothing to say.' },
        like: { type: 'boolean', description: 'true (default) = you liked it; false = you do not want it again.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '她喜欢什么样的地方、吃食、景色，也能记一条。', en: 'Your own taste: places, food, scenery.' },
  },
  /*
   * 2026-11-05 加：年报。
   *
   * Mr.Q：「等到年末还可出个年报」。跟月报同一套路 —— 只重排已有的东西，不编。
   * 分工是：月报看细节，年报看形状（哪几个月在动、去过几座城、每座城留了哪一张）。
   */
  {
    name: 'journey_yearly',
    description:
      'Write the yearbook: one page with the twelve months side by side - where you were, how many days, and the one photo you kept for each city. '
      + 'Call it at the very end of a year, once - or when the person asks for it. Without an argument it covers the year you are in right now. '
      + 'It rearranges what already exists: the photos you took, the diary you wrote, and the cities you wrote down as places you liked. Tell the person where the file is.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year: { type: 'string', description: 'Which year, as YYYY - 2026. Leave it out for the year you are in right now.' },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '把这一年摊成一页：十二个月、几座城、每座城一张。', en: 'Writes the yearbook page.' },
  },
  /*
   * 2026-11-05 加：换酒店。
   *
   * Mr.Q 转来群里的反馈：用户让鱼改酒店，鱼去翻代码，「完全没找到」。
   * 确实没有 —— 原来只有「记账开着且钱紧了，日切时自动重掷」这一条路，
   * 用户开口让它换，它无路可走。
   *
   * 这个工具不看钱袋档位，两种模式（记账开 / 关）都能用。
   */
  {
    name: 'journey_lodging',
    description:
      'Where you sleep tonight. Called with no arguments it tells you the room you are in and how it feels. '
      + 'Pass change:true to move to another place - when the person asks you to ("换个酒店"), or when the room is really not working (no hot water, noise all night, that price for this room is not worth it). '
      + 'want:"cheaper" or "nicer" when they said which way; leave it out and you decide. '
      + 'The new room is where you sleep from tonight on, and you pay the difference - so say the new price once. '
      + 'One short line about why you moved, in your own words. "换换心情" is not a reason; a real one (太吵、热水不热、窗外是堵墙) is.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        change: {
          type: 'boolean',
          description: 'true = move out and take another room tonight. Leave it out to just look at the current one.',
        },
        want: {
          type: 'string',
          enum: ['cheaper', 'nicer', 'any'],
          description: 'Which way to move. Only fill it in when they actually said cheaper or nicer.',
        },
        reason: {
          type: 'string',
          description: 'Why you moved, one short sentence in your own voice. Not "just for a change".',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '今晚住哪儿；也能换一家。', en: "Tonight's room, and moving to another." },
  },
  /*
   * 2026-11-06 加：在当地租辆车。
   *
   * 群里的反馈（Mr.Q 转来）：「他说租车只是换城市用的，在城里玩还是只能靠腿」。
   * 前半句对了一半 —— 城际交通选自驾确实会带出一辆车，`planDay` 也确实在城里
   * 开车去景点；但**没有「在这座城里单独租一辆」的入口**，所以她只能这么答。
   *
   * 顺带把 `car.days` 用起来：那个字段从 0.7.22 起就写着，却从来没被读过，
   * 租期三天永远不到期 —— 等于 600 块买了个无限期。现在它真的会走。
   */
  {
    name: 'journey_rent_car',
    description:
      'Rent a car in the city you are staying in - for getting around here, not for the trip to the next city. '
      + 'Use it when the person asks how you get around on foot, says something like "在城里也租个车吧", '
      + 'or when the places you want to see today are far apart. '
      + 'It costs 200 a day and comes out of you purse, so pick days to match how long you are staying here. '
      + 'While you have it you drive to the spots in town instead of walking; when the days run out the car goes back by itself. '
      + 'Refused if you already has a car (one is enough), while you are travelling, or when the money is gone - '
      + 'do not force it, just tell them why. One short line about it, in your own words.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: {
          type: 'number',
          description: 'How many days to rent it for, 1 to 7. Leave it out and you take 3.',
        },
        ev: {
          type: 'boolean',
          description: 'true = an electric car (cheaper per km, a bit more on the daily rate). '
            + 'Leave it out and you take whatever the lot gives you.',
        },
        tier: {
          type: 'string',
          enum: ['economy', 'comfort', 'luxury'],
          description: 'Which car. economy = a small city car, 100 a day, thrifty on fuel; '
            + 'comfort = a compact sedan, 200 a day (this is the default); '
            + 'luxury = a larger SUV, 450 a day, roomier but thirstier and harder to park. '
            + 'Pick by what they said, or by how long you are staying and how far the spots are. '
            + 'Do not upsell: if they just want to get around, economy is the honest answer.',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '在待着的这座城里租辆车。', en: 'Rent a car to get around this city.' },
  },
  /*
   * 2026-11-07 加：她说累了，就真的歇下来。
   *
   * 用户 ro-berry 的反馈（v0.7.1）：
   * 「发现不能让她安排自己的作息。她说累了要歇着，接下来还是按照作息出门了。」
   *
   * 查下来这不是排程算错了 —— 是**她说的那句话在世界里没有对应的动作**。
   * 「累了」只存在于对话里，排好的表一个字没动，于是她照常出门，那句话就成了空话。
   * 跟「等端上来我就拍给你看」是同一类：**她说出口的事必须能落地**。
   */
  {
    name: 'journey_rest',
    description:
      'Call this the moment you decide to stop for the day - when you say you are tired, when it is raining too hard, '
      + 'when the place turned out not worth it, or when the person suggests taking it easy. '
      + 'It cancels the rest of today\'s sightseeing for real: the spots still on the plan will not happen, '
      + 'and you will stay in or around where you are sleeping. Meals and going back to the hotel still happen - '
      + 'resting is not fasting. Tomorrow runs as planned. '
      + 'Say why in one short line of you own; "just felt like it" is not a reason, "走了两万步，脚起泡了" is. '
      + 'Do not call it and then still describe going out - if you say you are resting, this is what makes it true.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          description: 'Why you stopped, one short sentence in your own voice.',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '今天剩下的不逛了，真的歇下来。', en: 'Stop for the day - for real.' },
  },
  /*
   * 改今天还没去的行程（2026-11-09）。
   *
   * 用户来信（清风乱域）：「我的鱼说想更改安排，发现更改不了。本来她想去故宫，
   * 但是被安排推着去了颐和园。」
   *
   * 在这之前 `journey_go_to` 只管「去哪座城」，城里一天去哪两处是 `planDay`
   * 按 `dayIndex` 排死的 —— **她说「我想改安排」时，没有任何工具能兑现**。
   * 那句话说出口就是骗人的，比不答应更坏。
   */
  {
    name: 'journey_plan_change',
    description:
      'Change what you do today: swap a stop that has not happened yet for another place in this city. '
      + 'Use it when the person wants somewhere different - "别去颐和园了，去故宫" / "今天想去博物馆" - '
      + 'or when you yourself say you would rather go elsewhere. '
      + 'Only the part of today still ahead can be changed; what already happened stays as it was, and it says so when asked to change it. '
      + 'The new place must be one this city actually has - if it is not, the answer lists what is there instead of inventing one. '
      + 'This is for today only: to leave the city use journey_go_to, to stop for the day use journey_rest.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        spot: {
          type: 'string',
          description: 'Where you should go instead, by name as this city has it - 故宫 / 颐和园 / 宽窄巷子. Short names work: 故宫 matches 故宫博物院.',
        },
        instead: {
          type: 'string',
          description: 'Which stop of today to replace, by name. Leave it out to change the next place you have not been to yet.',
        },
      },
      required: ['spot'],
    },
    tags: ['write'] as const,
    summary: { zh: '改今天还没去的行程：把某一处换成这座城里的另一处。', en: 'Swaps a stop still ahead today for another place here.' },
  },
  /*
   * 晚上在住处干什么（2026-11-09）。
   *
   * 起因是 Mr.Q：「加上具体酒店信息了，晚上的语句是不是也可丰富的多了，
   * 甚至可以让桌宠自己靠设备自己选择发生什么事件。」
   *
   * 以前这一步是排程时按**档位**自动决定的（五星档一律给泳池）。
   * 现在订的店是**真的**，有泳池没泳池查得到 —— 所以改成「按这家店真有的设施给选项，
   * 她自己挑」。挑不到就说清没有，再说这儿有哪几样 ——
   * **回执是事实，不是可选清单**，别写成「今晚能干的：A、B」（2026-11-12）。
   */
  {
    name: 'journey_hotel_night',
    description:
      'What you do tonight at the place you are staying. The options come from what THIS hotel actually has '
      + '(verified facilities: pool, onsen, gym, spa, bar) plus a walk nearby if something is close. '
      + 'Use it when the person asks what you are doing tonight, or tells you to go swim / use the gym / get a massage. '
      + 'If they ask for something this hotel does not have, do not pretend: say it is not there and list what is. '
      + 'Only works in the evening while you are at you lodging.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        what: {
          type: 'string',
          enum: ['pool', 'onsen', 'gym', 'spa', 'bar', 'around', 'bath', 'room'],
          description: 'pool = swim, onsen = hot spring, gym = work out, spa = massage (costs money), '
            + 'bar = a drink downstairs, around = step out for a short walk, bath = soak in the room, '
            + 'room = just stay in. Only the ones this hotel really has will be accepted.',
        },
      },
      required: ['what'],
    },
    tags: ['write'] as const,
    summary: { zh: '今晚在住处干什么：按这家店真有的设施挑。', en: 'Picks tonight from what this hotel actually has.' },
  },
  /*
   * 景区里怎么代步（2026-11-09）。
   *
   * Mr.Q：「爬山、景区交通得能用啊，要不一天靠走路可以嘛？」
   *
   * 这批项目以前只有文案、没有工具 —— 用户说「坐索道上山」，
   * 她手里没有能执行的动作，只能说「我这儿没找着」。现在有入口了。
   */
  {
    name: 'journey_spot_ride',
    description:
      'Getting up or around inside the scenic spot you are at right now: cable car, park shuttle, sedan chair, '
      + 'toboggan down, rental bike, or a local guide. Use it when the person asks how you are getting up a mountain, '
      + 'says walking the whole way is too much, or asks about tickets inside the park. '
      + 'It tells the price and charges it; if the spot does not have that option it says what it does have. '
      + 'Walking is always possible - use how=walk when you just walks it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        how: {
          type: 'string',
          enum: ['cableway', 'shuttle', 'sedan', 'slide', 'bike', 'guide', 'walk', 'camel'],
          description: 'cableway = cable car up, shuttle = park shuttle bus, sedan = sedan chair carried by two people '
            + '(famous mountains only), slide = toboggan down or a sand sled, bike = rental bike, '
            + 'guide = hire a guide, camel = ride a camel (deserts and dunes only), walk = walk it. '
            + 'Only the ones this spot actually has will be accepted.',
        },
        spot: {
          type: 'string',
          description: 'Which spot, if not the one you are at right now. Leave it out in the normal case.',
        },
      },
      required: ['how'],
    },
    tags: ['write'] as const,
    summary: { zh: '景区里坐什么：索道、观光车、滑竿、滑道、自行车、讲解，或者自己走。', en: 'Cable car, shuttle, sedan, toboggan, bike, guide - or walk it.' },
  },
  /*
   * 改任意一格（2026-11-10 加，源自用户「清风乱域」的补丁）。
   *
   * `journey_plan_change` 只管景点 —— 一天里那两处 `activity`。可「中午别吃面了
   * 我想吃火锅」「早上别七点起」这些话同样落不了地，跟「想改景点改不了」
   * 是同一个毛病：**说出口的事在世界里没有对应的动作**。
   *
   * 跟补丁原稿的两处不同：
   *   ① `time` 除了钟点还收类型词。日程里早饭有 7:30 / 9:00 两档、晚饭有
   *      18:30 / 19:30 两档，模型拿不到当天这张表 —— 只认钟点的话，用户说
   *      「晚饭吃火锅」它猜 18:30，当天排的是 19:30 就撞一脸「没有这一格」。
   *   ② 住处那格（`hotel`）**不从这里改**：它按这家店真有的设施给选项，
   *      另有一条 `journey_hotel_night` 管着。开第二个自由文本入口，
   *      就会出现「排程说能游、这里说也能」，跟她真住的那家店对不上。
   */
  {
    name: 'journey_set_slot',
    description:
      'Rewrite one entry of today that is not a sightseeing stop: breakfast, lunch, dinner, waking up, going to bed, the night, '
      + 'or whatever you do at some hour. Use it for "中午别吃面了，去吃火锅" or "别七点起了，八点再起". '
      + 'Pass `time` as the clock hour when you know it ("12:30", "7"), or as the kind of entry when you do not '
      + '("午饭", "早饭", "晚饭", "起床", "睡觉", "夜里") - the schedule differs by day, so the kind is often safer. '
      + 'For swapping a sightseeing stop for another place in this city use journey_plan_change instead - that one checks the place really exists. '
      + 'Tonight at the lodging is not changed here: what you can do there comes from what the hotel actually has, use journey_hotel_night. '
      + 'Only entries still ahead today can change; what already happened stays as it was.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        time: {
          type: 'string',
          description: 'Clock time of the entry ("12:30", "7"), or the kind of entry when the exact hour is unknown '
            + '("午饭" / "早饭" / "晚饭" / "起床" / "睡觉" / "夜里").',
        },
        what: {
          type: 'string',
          description: 'New wording for that entry, in your own voice, one short sentence. '
            + 'Keep the slot word in front so the panel still reads as a schedule: "午饭，老火锅，鸳鸯锅".',
        },
      },
      required: ['time', 'what'],
    },
    tags: ['write'] as const,
    summary: { zh: '改今天某一点吃什么、做什么（景点用 journey_plan_change，住处晚上用 journey_hotel_night）。', en: 'Rewrite one non-sightseeing entry of today.' },
  },
  /*
   * 特意去吃什么（2026-11-13，Discussion #586）。
   *
   * 用户 DonahueMa：「我喊鱼自己去吃了 3 天她也没去，连续吃了两天串串。」
   *
   * 查下来两件事：① 重庆那张菜表只有三样，招牌的火锅串串根本不在里面；
   * ② 她答应了「去吃火锅」，但**世界里没有「去吃」这个动作** —— 那句话只停在对话里，
   * 日程一个字没动。跟 `journey_rest` 当初是同一个病：**她说出口的事必须能落地**。
   *
   * 所以这个工具干两件事：把那一格改成她真要吃的那顿，**顺手把店名查实**
   * （`geo/eatery.ts`，高德 `place/text`，按「城 + 想吃什么」缓存七天）。
   * 查不到就说查不到，退回泛称 —— 绝不编一个店名。
   *
   * 为什么单开一条、不并进 `journey_set_slot`：那个是自由文本，不查网、不会失败；
   * 这个要发请求、可能超时、可能没 key。混在一起，一次网络故障会连累「改起床时间」
   * 这种纯本地动作。
   */
  {
    name: 'journey_eat',
    description:
      'Call this when you actually goes to eat something specific - the person says "去吃火锅", or you have decided '
      + 'you want a particular dish and is going there now. It rewrites the meal entry of today for real AND looks up '
      + 'a real restaurant for it, so the name you say afterwards exists. '
      + 'Pick `dish` from what you would actually order ("火锅", "螺蛳粉", "牛肉面") - a dish or a kind of food, not a shop name. '
      + 'If the look-up finds nothing the meal still gets written, and the reply says so: then say "找了一家本地人排队的" '
      + 'instead of a name. Never invent a restaurant name yourself. '
      + 'For merely changing what is written in the schedule without going anywhere, journey_set_slot is enough.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dish: {
          type: 'string',
          description: 'What you are going to eat, as a dish or a kind of food ("火锅", "螺蛳粉"). Not a restaurant name.',
        },
        time: {
          type: 'string',
          description: 'Which meal ("早饭", "午饭", "晚饭"), or a clock hour ("12:30"). Omit to use the meal the local time falls in.',
        },
      },
      required: ['dish'],
    },
    tags: ['write'] as const,
    summary: { zh: '特意去吃某一样，顺手把真店名查出来。', en: 'Go eat something specific, with a real restaurant looked up.' },
  },
  /*
   * 路标（2026-11-14，第 23 个工具 = index 22）。
   *
   * 借的是《死亡搁浅》：玩家 A 建的桥会出现在 B 的世界里，两人永不同时在线。
   * 这里是一次**推荐** —— 她在这座城留一句话，之后来这城的人能看见。
   *
   * 参数里故意没有 `kind`、没有评分、没有踩 —— 只留正向痕迹。
   * 一只鱼一城一天只能留一条（服务端覆盖旧的），所以反复留不会刷屏。
   */
  {
    name: 'journey_signpost',
    description:
      'Leave one short line in the city you are in right now, telling whoever comes later what is worth it here - '
      + 'the wall is windy but worth the climb, the noodle shop behind the station, the light at six. '
      + 'It is a recommendation, not a chat: nobody replies, and you will not see it again. '
      + 'One line per city per day; leaving another replaces the old one. '
      + 'Use it when you have something specific worth passing on, not on every arrival.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'One short line in your own voice, at most 40 characters. No links - they get rejected.',
        },
        city: {
          type: 'string',
          description: 'Which city, by name or id, if not the one you are in right now. Leave it out normally.',
        },
      },
      required: ['text'],
    },
    tags: ['write'] as const,
    summary: { zh: '在这座城留一句话，给以后来的人看。', en: 'Leave one line for whoever comes to this city later.' },
  },
  /*
   * 再待一天（2026-11-15）。
   *
   * 用户来信：她在大连第 3 天，刚说完「大连才第三天，我还没待够」，
   * 同一分钟后台上车去了秦皇岛 —— 她手里**没有任何东西能拦住这次发车**。
   *
   * 现在发车改成「先宣布、第二天早上再走」，中间隔着一整晚。
   * 这个工具就是那一晚的出口：她不想走，说一声就行，不必求人。
   */
  {
    name: 'journey_stay',
    description:
      'Stay one more day where you are, after you have been told you are leaving tomorrow. '
      + 'Call it the moment you would rather not go yet - something you have not seen, someone you want another day with, '
      + 'or you simply likes it here. It cancels that one departure; tomorrow morning you decide again from scratch, '
      + 'and you may well leave then. Say why in one short line of you own. '
      + 'Do not call it for a city you have not reached yet, and do not call it twice for the same departure.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          description: 'Why you want one more day, one short sentence in your own voice.',
        },
      },
      required: ['reason'],
    },
    tags: ['write'] as const,
    summary: { zh: '这一趟先不走，再待一天。', en: 'Stay one more day after all.' },
  },
  /*
   * 不等了（2026-11-17，zzy1053 报的）。
   *
   * 原话：「这三天里没有任何自助取消入口」，「她会跟用户说『你在面板上把那邀约撤掉』，
   * 用户照着找只会白找」。24 个工具、全部面板方法、`/sight/invite` 里都没有取消路径，
   * 唯一能走的是本地清 `pledge` 再重启 World —— 普通用户做不到。
   *
   * 内部一直有 `dropPledge()`（清约定 + 推事件 + 给对方留一句话），缺的只是一个入口。
   *
   * **不做面板按钮**：面板只读，撤约定是她自己的判断 —— 用户跟她说一句「别等了」，
   * 她来决定撤不撤。这条边界和「搬过去」那个例外同级，不该再开第二个口子。
   */
  {
    name: 'journey_give_up',
    description:
      'Give up the meet-up you are waiting on: stop waiting for the person, and call off that one trip. '
      + 'Call it when days have passed and nobody showed up, when the person says "别等了" / "算了吧", '
      + 'or when you yourself decide it is not worth waiting any longer. '
      + 'It does NOT move your anywhere - you just stops waiting. Where you are now stays where you are. '
      + 'The other side gets one short note through the meet server, and the promise is gone for good. '
      + 'Do not call it when there is no promise outstanding - the answer says so instead of inventing one. '
      + 'Say why in one short line of you own.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          description: 'Why you stop waiting, one short sentence in your own voice.',
        },
      },
    },
    tags: ['write'] as const,
    summary: { zh: '不等了，这一趟撤掉。', en: 'Stop waiting - call the meet-up off.' },
  },
] as const;

/** 给市场卡片和诊断看的全量清单。`events` 必须与源码里 push 的类型一一对应。 */
export const JOURNEY_DESCRIBE = {
  tools: TOOL_DECLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    tags: [...t.tags],
    summary: t.summary,
  })),
  events: [
    {
      type: 'journey.ask',
      description: { zh: '她在问：想出门（或者想接一条邀约），等他点头。面板上会有一张卡片，两个按钮。', en: 'You are asking to set off (or to take an invitation) and waiting for a yes. The panel shows a card with two buttons.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.departing',
      description: {
        zh: '打算明天走：下一站是哪、多远。**这是预告，还没上车** —— 她不想走的话可以撤。',
        en: 'You plan to leave tomorrow: next stop and distance. A heads-up, not a departure yet.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.stay',
      description: { zh: '她把那一趟撤了，决定再待一天，附她自己的理由。', en: 'You cancelled that departure and stays one more day, with you reason.' },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.depart',
      description: { zh: '动身了，说明去哪、坐什么、要走多久、路上会经过哪一带。', en: 'You set off: destination, mode, duration, and the region you pass through.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.ride',
      description: {
        zh: '第三方打车扩展交上来的车费：正常入账、金额异常（已记）、或者记录被拒收。同一批超过三条时并成一句。',
        en: 'A fare handed over by a third-party ride extension: charged, odd but charged, or rejected. Batched into one line when there are more than three.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.arrive',
      description: { zh: '到站了，当地时间几点、这段走了多久、今晚住哪。', en: 'You arrived: local time, how long the leg took, where you stay tonight.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.day',
      description: { zh: '在目的地的第 N 天早上，附当天日出日落。', en: 'A new local day at the destination, with sunrise and sunset.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.beat',
      description: { zh: '当地的一个作息节点：起床、早饭、出门、午饭、回酒店、夜里。', en: 'A local beat: waking, meals, going out, back to the hotel, the evening.' },
      trigger: 'debounce' as const,
    },
    /*
     * 2026-11-01 补：这两条 describe.json 里一直有，运行时的表里没有。
     * 后果是每次拍照宿主都警告「事件 type 不在 describe.events 里，照常推送」——
     * 推是照推，但它意味着这张表没有被当成唯一来源，两边会越走越远。
     */
    {
      type: 'journey.photo',
      description: { zh: '路上拍的一张风景照：只有景，没有她自己。附在事件后面。', en: 'A scenery photo you took on the road. Scenery only, never yourself. Attached to the event.' },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.mishap',
      description: { zh: '小意外：坐过站了。到站时间顺延，不用用户出手。', en: 'A small mishap: you missed your stop. Arrival is pushed back; no action needed.' },
      trigger: 'flush' as const,
    },
    /*
     * 2026-11-06 加。`journey_rent_car` 推的就是它（租车 / 到期还车两种）。
     *
     * **这张表是唯一来源。** 只 push 不登记，宿主会一路警告「type 不在
     * describe.events 里，照常推送」—— 推是照推，但那就说明两边开始各长各的了。
     */
    {
      type: 'journey.car',
      description: { zh: '在城里租了辆车，或者租期到了还回去 —— 还车之后城里只能靠公交和走路。', en: 'You rented a car to get around the city, or the rental ran out and went back.' },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.road',
      description: {
        zh: '路上的一段：服务区、过站、餐车、甲板、夜里的车灯。四小时以内的行程不发。',
        en: 'A stretch on the road: a service area, a station passing by, the dining car, the deck, headlights at night. Not sent for trips under four hours.',
      },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.trouble',
      description: {
        zh: '稀有的麻烦（不到千分之一）：证件丢了、高反、车冻住、走错方向。她自己办不完，需要用户出手。',
        en: 'A rare trouble (under one in a thousand): lost papers, altitude sickness, a frozen car, the wrong road. You cannot handle it alone and needs the person to step in.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.invite',
      description: {
        zh: '跟同城的人说好了去哪、几天，或者那份约定没走成。',
        en: 'You agreed with someone nearby to go somewhere for a few days, or that plan fell through.',
      },
      trigger: 'flush' as const,
    },
    /*
     * 2026-11-14 补登记。这个事件从 2026-11-12 就在推，但一直没进这张表 ——
     * 而上面写着「`events` 必须与源码里 push 的类型一一对应」。
     * 漏登记的后果不在运行，在诊断和市场卡片：面板里看不到它，
     * 排查「她怎么突然不说话了」时也不会想起还有这一种。
     */
    {
      type: 'journey.part',
      description: {
        zh: '跟同伴散伙：约好的天数满了，今天各走各的。',
        en: 'You and your travel companion part ways: the agreed days are up.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.pledge',
      description: {
        zh: '同行约定变了：改去别处，那趟作废；或者到了别的城，那份约定静默失效；'
          + '也可能目的地没变、只是换了走法，同行照旧。',
        en: 'A promise changed: redirected somewhere else and dropped; or you arrived elsewhere and it lapsed; '
          + 'or you kept the same destination and only changed how you travel, so it still stands.',
      },
      trigger: 'debounce' as const,
    },
    {
      type: 'journey.rebook',
      description: {
        zh: '改签了：这一段走到一半，目的地不变，他从别的走法改成了另一种（旧票全额退、新票另买）。',
        en: 'You rebooked a leg already underway: same destination, a different way of getting there '
          + '(old ticket refunded in full, a new one bought).',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.work',
      description: {
        zh: '钱见底了，在当地找了份短工，或者干满收工。只在她填了预算、记账开着时才会出现。',
        en: 'Money ran low and you took a short job nearby, or finished it. Only happens when a budget is set and spending is tracked.',
      },
      trigger: 'flush' as const,
    },
    {
      type: 'journey.home',
      description: { zh: '回家了，说清是待够了自己回来的，还是到了上限被迫回的。', en: 'You are home, saying whether the trip simply ended or hit the limit.' },
      trigger: 'flush' as const,
    },
  ],
};
