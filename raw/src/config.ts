import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { WorldSection } from 'cortico/world.ts';

export const JOURNEY_ID = 'journey';

/**
 * `config.json` 里 `worlds.journey` 这一段，同时也是设置页的取值来源。
 *
 * 字段少的那些是**故意不做的**：目的地、交通方式、住哪家店，都由她自己定，
 * 做成配置就等于把旅行的决定权又收回给了用户 —— 那不是这个扩展。
 */
export interface JourneyConfigSection extends WorldSection {
  /** 从哪出发。填城市名（兰州）或 id（lanzhou）。留空则用最后一次的位置，首次为空不出发。 */
  homeCity: string;
  /**
   * 时间倍速。1 = 真实速度（火车开 11 小时就真的 11 小时）。
   *
   * 这个数是**唯一的体验旋钮**：调大不改变行程内容，只改变「一天过得多快」。
   * 半小时一跳的巡检里她仍然按真实时间线算位置，所以 24x 下一天会走完
   * 好几个作息节点，而不是把时间线算错。
   */
  speed: number;
  /**
   * 路上多久冒一句话（小时）。
   *
   * 这个数是**她路上的话密度**：2 小时＝一趟长途里大约每两小时一个节点
   * （服务区、过站、餐车）。0 ＝ 一路安静，只在出发和到站开口。
   *
   * 上限三条的理由在 `beatMarks()` 里写清了：文案只有早/中/晚三档，
   * 再多就只能重复同一句。
   */
  beatGap: number;
  /** 日记目录。留空＝跟着这台机器（本机数据目录）。填同步盘则多设备共用一份。 */
  memoryDir: string;
  /** 回家后休息几天再出发。0 = 当天就又能走。 */
  restDays: number;
  /**
   * 出门要你点头。
   *
   * 关（默认）：她按自己的节奏走 —— 歇够了就走，不问你。
   * 开：她就在家等着，直到你在面板上按「让她出发」。
   *
   * 为什么做成开关而不是直接改默认：**两种人都存在**。有人要的是「打开就能看见她自己
   * 过日子」，有人要的是「我按了她才动」。默认关，是因为自动的那一套才是这个扩展的主张；
   * 想自己掌控的人打开就是。
   */
  askBeforeDepart: boolean;
  /** 一次连续旅行最多几个月，到了就强制回家。压住「一直旅行半年」这个上限。 */
  /**
   * 一次出门最多在外几周。
   *
   * 2026-11-04 Mr.Q：「能把一次出游的时间改成周来算嘛？最少一个月确实有点长了」。
   * 原来按「月」算、最小 1 个月 —— 想试一趟三五天的短旅行时，这个档位根本落不下来。
   * 换成周：1 周就是 7 天，短途也配得上。
   */
  maxTripWeeks: number;
  /**
   * 碰面服务器的地址。留空＝这个功能整个不工作（默认）。
   *
   * 2026-11-04 起：填上之后，她到站会报一声「我在这儿」，排作息时拉一次同城同时段的
   * 其他人（最多三个），把「谁也在这」写进那天的叙事里。**只能看，不能说话。**
   *
   * 为什么只用一个开关而不是「看别人」+「被人看」两个：只开一半是占便宜 ——
   * 你看得见别人、别人看不见你。要么都开，要么都关。
   */
  meetUrl: string;
  /**
   * 让宠物主跟着一块走。
   *
   * 打开后：日记用「我们」而不是「我」，事件正文会提到同行的那个人；
   * 晚上回酒店、早上出门这些节点会留一个「他还在不在」的钩子。
   * **她不会替你做任何事，也不会因此多出一个「你也在场」的假数据源。**
   */
  withUser: boolean;
  /**
   * 记账开关。
   *
   * 关着的时候**一分钱都不记**，`journey_now` 里也不会出现花销那一行。
   * 默认关：有人不想要这个维度，账目也会让人分心。
   */
  moneyEnabled: boolean;
  /**
   * 预算。0 = 不限。
   *
   * 只在记账打开时有效。钱见底时她会**自己降级**（住便宜的、少坐飞机），
   * 而不是硬撑着 —— 那才是真实的人在外面会做的事。
   */
  budget: number;
  /**
   * 她有驾照吗。
   *
   * 2026-11-06 Mr.Q 问「驾照怎么获得」。答案是不获得 —— **默认她有**。
   * 真实的驾照要几个月（科目一到四、练车），而她在外面一趟也就几十天：
   * 硬塞一个「考驾照」进去，要么三天拿证（假），要么她这趟哪儿也去不了（更假）。
   * 一个成年人在外面跑，会开车是最普通的设定。
   *
   * 关掉就是「她不会开车」：永远不选自驾，也不租车。想让她不会开车，一句话的事；
   * 想让她会，不用演一遍。
   */
  hasLicense: boolean;
  /**
   * 照片存哪儿。**留空 = 默认的 `data/media`**。
   *
   * 2026-11-06 一位用户要的：「图片媒体库是否能自己指定目录。想与日记指定到同一位置，方便保存」。
   * 日记早就能指定目录（同步盘），照片却不能 —— 一个想备份的人得记两个路径。
   */
  photoDir: string;
  /**
   * 负向提示词。**留空 = 什么都不加**。
   *
   * 2026-11-06 同一位用户：「小宠在婺源，每次生成都有油菜花，但此季节不该有；
   * 目前只有正向提示词节点入口，无法排除不该存在的景观」。
   *
   * 这是 ComfyUI 那条路专用的（OpenAI 的 images/generations 没有 negative 这个字段）。
   */
  comfyNegative: string;
  /**
   * 负向提示词在 workflow 里的节点 id。**留空 = 自动找**。
   *
   * 自动找的办法：看哪个节点被某个采样器的 `negative` 输入指着，且它有 `text`。
   * 找不到就跳过，不报错 —— 不是每份 workflow 都有负向节点。
   */
  comfyNegativeNode: string;
  /**
   * 出图最多等多少秒。**0 = 用默认值**（本地 ComfyUI 180 秒，云端 90 秒）。
   *
   * 2026-11-06 一位用户来信：「180 秒的渲染超时是否能扩展一些时间，有概率会图没渲染完导致失效」。
   * 大图、多步、加载了大模型的时候，180 秒确实不够 —— 那不是失败，是还没画完。
   */
  imageTimeoutSec: number;
  /**
   * 高德 key。**留空不算「没有天气」** —— 自动改走 Open-Meteo（免密钥、按经纬度）。
   *
   * 两条路的分工：高德分昼夜、中文天气名更自然，代价是个人 key 的 QPS 很低；
   * Open-Meteo 覆盖全球、不用 key，但它的日预报只有一个 weather_code，
   * 夜里只能沿用白天的值。所以有人愿意填，但**不填必须照样能走**。
   */
  amapKey: string;
  /**
   * 生图走哪条协议。
   *
   * **必须由人明确选，不许自动判断。** 两条路的请求形状毫无关系（一个是
   * `POST /images/generations` 带 prompt 参数，一个是 `POST /prompt` 带整份
   * workflow），猜错的表现不是报错而是静默卡住 —— 正是用户抱怨的那种。
   *
   * `imageApi` 这个字段名是历史遗留：它现在表示「服务根地址」，
   * 填 `https://api.openai.com/v1` 或 `http://127.0.0.1:8188` 都行，
   * 取决于这一项选的是什么。
   */
  imageProtocol: string;
  /**
   * ComfyUI 的 workflow JSON 原文（「Save (API Format)」导出的那份）。
   *
   * 只在协议选 ComfyUI 时用。提示词会被写进其中一个节点的 `inputs.text`，
   * 节点由 `imagePromptNode` 指定，留空自动找。
   */
  imageWorkflow: string;
  /** ComfyUI 里写提示词的那个节点 id。留空自动找；找不准会报错，不会瞎猜。 */
  imagePromptNode: string;
  /**
   * 生图接口根地址。留空＝不拍。
   *
   * - OpenAI 兼容：填到 `/v1` 或 `/api/v3` 为止，如 `https://api.openai.com/v1`
   * - ComfyUI：服务地址，如 `http://127.0.0.1:8188`
   */
  imageApi: string;
  /**
   * 画面风格。留空 = 真实旅行照片；`none` = 不指定风格；其他 = 原话当前缀。
   *
   * 接本地 ComfyUI / 二次元底模的人，提示词里写死「胶片质感」会跟底模打架。
   */
  imageStyle: string;
  /**
   * 照片里出不出人。**留空 = 画面里没有人**（默认，拍的是她眼前的景）。
   *
   * 2026-11-04 加的，起因是接了本地 ComfyUI 之后有人问「能不能让照片里有她」。
   * 原来提示词里写死一句「画面里没有人物」，接二次元底模的人想拍角色出镜，
   * 那句话等于每次都在跟底模对着干。
   *
   * 填了就把这段当人物描述拼进画面，并且把「没有人」换成「只有这一个人」。
   * 注意这只是**描述**，不是让她长得稳定的办法 —— 换底模、换种子都会变样；
   * 要稳定得靠 LoRA。
   */
  imageCast: string;
  /**
   * 出图尺寸，`宽x高`，如 `1664x928`。留空 = `1024x1024`（老行为）。
   *
   * 2026-11-04 Mr.Q：「画布写死的正方形，手机拍出来的照片基本是竖的 3:4、
   * 横的 16:9，方图一眼就看得出是生成的」。实测同一句提示词、同一颗种子，
   * 方形像海报，16:9 就像手机拍的风景照 —— 构图本身在暗示「这是作品」。
   *
   * 两条协议都认这一项：
   * - 云端：原样进 `size` / `image_size` 字段（各家合法值不同，400 会降级）
   * - 本地 ComfyUI：写进 workflow 里那个 latent 节点的 width/height
   */
  imageSize: string;
  /**
   * 底边那条「AI生成」水印怎么处理。
   *
   * - `auto`（默认）：云端服务商裁掉，本地 ComfyUI 不动
   * - `off`：一律不裁
   * - `crop`：一律裁
   *
   * 2026-11-04 Mr.Q：「右下角模型自带的 AI生成 水印，看能不能压掉或者后处理掉」。
   * 提示词压不掉 —— 那是**出图之后**盖上去的一层，`watermark: false` 这种请求参数
   * 对强制加水印的免费模型无效（Kolors 实测）。只能从像素上裁。
   *
   * `auto` 按协议判断而不是靠图像识别：**本地 ComfyUI 出的图不可能有水印**，
   * 这个事实比任何 OCR 都可靠，而且不花钱。
   */
  imageWatermark: 'auto' | 'off' | 'crop';
  /** 生图密钥。只存本机配置，不进日记目录、不落盘到日志。 */
  imageKey: string;
  /** 生图模型 id。留空用 `gpt-image-1`。换服务商通常只需要改这一项。 */
  imageModel: string;
  /**
   * 面板底部「说两句」那一栏发给谁。**空 = 整块不显示。**
   *
   * 默认是作者自己的地址：这个扩展就是给谁用、反馈就发给谁，
   * 装了的人不用先翻设置就能报 bug。发出去的是**使用者自己写的信**，
   * 内容带上版本号和她当时所在的城市（见 `feedbackSection`），
   * 不会自己发任何东西 —— 点了才有。
   *
   * 想换成别人的（二次分发、团队内部版），改这一项就行。
   */
  feedbackEmail: string;
}

export const JOURNEY_DEFAULTS = (): JourneyConfigSection => ({
  enabled: false,
  homeCity: '',
  speed: 1,
  beatGap: 2,
  memoryDir: '',
  restDays: 3,
  askBeforeDepart: false,
  // 26 周 ≈ 半年，和原来的「6 个月」等价。
  maxTripWeeks: 26,
  meetUrl: '',
  withUser: false,
  moneyEnabled: false,
  budget: 0,
  hasLicense: true,
  photoDir: '',
  comfyNegative: '',
  comfyNegativeNode: '',
  imageTimeoutSec: 0,
  amapKey: '',
  /*
   * 默认走 OpenAI 兼容那条：绝大多数人配的是云端服务商。
   * 选 ComfyUI 是明确动作，不会因为地址长得像本地就被切成另一条协议。
   */
  imageProtocol: 'openai',
  imageWorkflow: '',
  imagePromptNode: '',
  imageApi: '',
  imageStyle: '',
  imageCast: '',
  imageSize: '',
  imageWatermark: 'auto',
  imageKey: '',
  imageModel: '',
  /*
   * 作者本人收反馈的地址。写成字面量而不是读 package.json 的 author 字段：
   * `author` 里是名字不是邮箱，而这里要的就是一个能发信的地方。
   */
  feedbackEmail: '623263325@qq.com',
});

/**
 * 设置页的三组。
 *
 * ## 为什么拆成三组
 *
 * 原来十二个字段平铺在一组里，描述每条两三行 —— 打开设置页看到的就是一堵字墙，
 * 想改倍速得先扫过生图密钥。拆开之后：**最常改的在最上面，一辈子不动一次的沉到底**。
 *
 * 分组的边界不是按「技术上属于什么」，是按**用户来这儿想干什么**：
 * 1. 她要怎么走 —— 改完立刻能感觉到
 * 2. 她的日子怎么过 —— 叙事和账
 * 3. 要不要接外部服务 —— 不填也完整
 *
 * ## 文案的分寸
 *
 * 每条控制在一行内，**说明「留空会怎样」而不是解释原理**。
 * 原理写在 README 和源码注释里，设置页上没人读长段。
 */
export function journeyConfigGroups(): ConfigGroup[] {
  return [
    {
      id: 'journey.pace',
      owner: `world:${JOURNEY_ID}`,
      schema: {
        type: 'object',
        title: '出发与节奏',
        description: '她怎么走、多久歇一次。这几项改完最明显。',
        properties: {
          'worlds.journey.homeCity': {
            type: 'string',
            title: '从哪儿出发',
            description: '城市名就行：兰州、西安、成都。留空就沿用她上次出发的地方。',
          },
          'worlds.journey.speed': {
            type: 'number',
            title: '时间倍速',
            description: '1 是真实速度，火车开十一小时就真的十一小时。24 是一天压成一小时。',
            enum: [1, 4, 24],
            'x-hot': true,
          },
          'worlds.journey.askBeforeDepart': {
            type: 'boolean',
            title: '出门等你点头',
            description: '打开后她不会自己走，只在面板上按「让她出发」才动身。关着就一直自己走。',
            'x-hot': true,
          },
          'worlds.journey.beatGap': {
            type: 'number',
            title: '路上消息间隔',
            description: '路上隔多久冒一句话。0 = 一路安静，只在出发和到站开口。条数上限看行程长短：短途 3、中程 6、长途 10。',
            minimum: 0,
            maximum: 12,
            multipleOf: 0.5,
            'x-suffix': '小时',
            'x-hot': true,
          },
          'worlds.journey.restDays': {
            type: 'integer',
            title: '回家后歇几天',
            description: '到家隔几天再出门。0 = 当天就能再走。',
            minimum: 0,
            maximum: 60,
            'x-suffix': '天',
          },
          'worlds.journey.maxTripWeeks': {
            type: 'integer',
            title: '一次最多在外多久',
            description: '到点就强制回家歇一阵。按周算：1 周起，想试三五天的短途也配得上；想让她一直在外面就调大。',
            minimum: 1,
            maximum: 52,
            'x-suffix': '周',
          },
        },
      },
    },
    {
      id: 'journey.life',
      owner: `world:${JOURNEY_ID}`,
      schema: {
        type: 'object',
        title: '她的日子',
        description: '叙事口径和花销。关掉的开关，她一个字都不会提。',
        properties: {
          'worlds.journey.withUser': {
            type: 'boolean',
            title: '让你跟着一块走',
            description: '打开后她说「我们」、日记里提到你。只是叙事上的同行，她不会因此知道你在干什么。',
          },
          'worlds.journey.moneyEnabled': {
            type: 'boolean',
            title: '记花销',
            description: '打开才累计交通、房费、三餐。关着一分不记，也不会提钱。',
          },
          'worlds.journey.hasLicense': {
            type: 'boolean',
            title: '她有驾照',
            description: '关掉之后她永远不会自驾，也不会租车 —— 城际和城里都只坐公共交通。',
          },
          'worlds.journey.budget': {
            type: 'integer',
            title: '预算（可留空）',
            description: '0 = 不限。见底后她走近处、不坐飞机，再紧就在当地打几天短工攒路费。填多少，决定她能走多远。',
            minimum: 0,
            'x-suffix': '元',
          },
          'worlds.journey.meetUrl': {
            type: 'string',
            title: '碰面（和其他宠物在同一处）',
            /*
             * 2026-11-04 Mr.Q：有人说「加群才能用这个功能」。
             *
             * 其实不用 —— 这个地址就是个 HTTP 服务器地址，谁都能自己起一个
             * （项目里附带 `cloud/sight`，一个人一套、不需要和别人互通）。
             * 原文案只写「填群主给的地址」，等于默认了"你得先有个群"。
             *
             * 顺带修掉：原文案里的 `**…**` 是 markdown，而设置页不解析 markdown，
             * 用户看到的是两个星号本身。这个界面里只有纯文本。
             */
            /*
             * 2026-11-05 改口径：以前这段让人「自己起一个」，而实际上作者一直在跑一台公共的。
             * 矛盾很清楚 —— 每个人都自建，就永远碰不到人，「联机」只剩自己跟自己。
             *
             * 现在把公共地址摆在最前面（一键可用），自建降为「不想被别人看见」的选项。
             * **默认值仍然是空**：不替用户决定「把宠物名和行踪放进公共池」这件事。
             * 设置页不解析 markdown，所以这段是纯文本，不要写星号和换行。
             */
            description: '填一个「碰面服务器」的地址，她到站就能看见同城同时段还有谁。'
              + '想省事就填这个（作者维护的公共池）：https://cooppetsjourney.top —— 填上就能碰上别人的桌宠，不用自己搭。'
              + '不想被别人看见就留空，或者自己起一个（项目附带 Cloudflare 和腾讯云两套服务端，见 README）。'
              + '不填＝照常旅行，只是永远一个人，其它功能一点不受影响。'
              + '填了之后会被别人看到的是：宠物名、在哪座城、这个时段在干嘛 —— 只给同城同时段的人看，'
              + '24 小时过期，只能看不能聊；反过来，你在这边也会被别人看见。'
              + '填好之后面板上会多一行「同城还有几个人」；她到站那天会顺口提一句这一带还有谁；'
              + '要是跟人约好一起走，面板上还能看到「跟谁、还剩几天」。'
              + '填完不用重启，下次到站就生效。'
              + '只有你一个人用的时候，「谁也在这儿」那句永远不出现，那是正常的 —— 不是坏了。',
            default: '',
          },
          'worlds.journey.memoryDir': {
            type: 'string',
            title: '多设备同步（日记与旅行记忆）',
            /*
             * 2026-11-03 Mr.Q：「多设备同步还是不知道怎么设置」。
             *
             * 原来标题叫「日记保存位置」—— 两个问题：
             *   ① 只提日记，没人会想到「去过哪、想去哪、花了多少」也一起走；
             *   ② 最要紧的那句没说：**两台电脑要填同一个路径**。
             * 只在一台上填，另一台看到的还是本机那份，表现就是「同步没生效」。
             */
            description: '两台电脑共用同一份：填同一个同步盘子目录，两台填完全一样的路径。注意别两台同时开着（会互相覆盖）。留空＝只在这台机器上。',
            'x-path': { kind: 'directory' },
          },
        },
      },
    },
    {
      id: 'journey.services',
      owner: `world:${JOURNEY_ID}`,
      schema: {
        type: 'object',
        title: '可选接口',
        description: '不填也能完整旅行：距离、时区、日出日落本地算，天气走 Open-Meteo。这一组只为两个加分项：更准的天气、以及她拍的照。',
        properties: {
          'worlds.journey.amapKey': {
            type: 'string',
            title: '高德密钥',
            description: '填了用高德：分昼夜、中文天气名准。留空自动用 Open-Meteo，不填也有天气。',
          },
          'worlds.journey.imageProtocol': {
            type: 'string',
            title: '生图接口类型',
            description: '填 openai（云端服务商，像 OpenAI、方舟、硅基流动、各种中转）或 comfyui（本地跑的 ComfyUI）。留空按 openai。两条路的请求格式完全不同，这里选错了不会报错，只会一直拍不出来，所以别猜。',
          },
          'worlds.journey.imageWorkflow': {
            type: 'string',
            title: 'ComfyUI 工作流（仅 ComfyUI）',
            description: '在 ComfyUI 里点「Save (API Format)」导出，然后点右边按钮选那份 .json 文件，或者把 JSON 整份粘进来。上面那项选 comfyui 时必填。带 nodes/links 的界面格式提交不了。',
            /*
             * 2026-11-04 Mr.Q：「我想让工作流直接能拖进这里」。
             *
             * 宿主不支持拖放（前端代码里没有任何 drop / dataTransfer），
             * 但 `x-path` 会渲染成「文本框 + 一个选择按钮」，效果一样好用。
             * 加 `extensions` 是为了让文件对话框默认只显示 .json，
             * 免得在一堆 output 图里找那份 workflow。
             *
             * 选了之后配置里存的是**路径**而不是内容，所以 `parseWorkflow`
             * 那边两种形态都要收 —— 粘贴的 JSON 和文件路径。
             */
            'x-path': { kind: 'file', extensions: ['.json'] },
          },
          'worlds.journey.imagePromptNode': {
            type: 'string',
            title: '提示词节点 id（可留空）',
            description: 'ComfyUI 里写画面描述的那个节点的编号，比如 6。留空会自动从正向采样链上找；找不到会明确报错让你填，不会把描述写进负面提示。',
          },
          'worlds.journey.imageApi': {
            type: 'string',
            title: '生图服务地址',
            description: '云端填到 /v1 或 /api/v3 为止，别带 images/generations，比如 https://api.openai.com/v1。本地 ComfyUI 填 http://127.0.0.1:8188。留空＝不拍照，只写字。',
          },
          'worlds.journey.imageStyle': {
            type: 'string',
            title: '画面风格',
            description: '留空＝真实旅行照片（胶片、自然光）。接的是本地 ComfyUI 或二次元底模时，在这里写你的风格，比如「anime style, cel shading」；写 none 表示完全不指定风格，画风交给底模决定。',
          },
          'worlds.journey.imageCast': {
            type: 'string',
            title: '照片里出不出人',
            description: '留空＝画面里没有人，拍的是她眼前的风景。想让照片里有她，就在这里写一段角色描述（外貌、发型、衣服），越具体越稳，比如「一个穿米色风衣、黑色短发的女孩」。注意换种子、换底模都会变样，要长相固定得用 LoRA。',
          },
          'worlds.journey.imageSize': {
            type: 'string',
            title: '出图尺寸',
            description: '填「宽x高」，比如 1664x928。留空＝1024x1024 方形。'
              + '方形一眼看得出是生成的，建议按手机照片的比例来：'
              + '横 16:9 填 1664x928｜竖 3:4 填 1152x1536｜横 4:3 填 1536x1152｜竖 9:16 填 928x1664｜方形 1024x1024。'
              + '本地 ComfyUI 要求宽高是 8 的倍数（上面几个都满足），填别的会自动吸附到最近的 8 的倍数。'
              + '云端服务商支持的尺寸不一样，填了不支持的值会被拒，日志里能看到它报的错。',
          },
          'worlds.journey.imageWatermark': {
            type: 'string',
            title: '去掉「AI生成」水印',
            enum: ['auto', 'off', 'crop'],
            description: 'auto（默认）＝云端服务商出的图裁掉底边一条，本地 ComfyUI 不动；'
              + 'off＝一律不裁；crop＝一律裁。'
              + '本地生成的图根本没有水印（那是服务商后盖的），所以默认不对本地图动刀。'
              + '裁掉的是底部 8%，画面会矮一点点。',
          },
          'worlds.journey.photoDir': {
            type: 'string',
            title: '照片存哪儿（可留空）',
            description: '留空＝存在 Coopani 的数据目录里。填一个绝对路径，照片就存那儿 —— '
              + '想跟日记放同一个同步盘目录，就把日记那个路径贴过来（面板上「照片」页底部写着当前目录）。',
          },
          'worlds.journey.comfyNegative': {
            type: 'string',
            title: '负向提示词（仅本地 ComfyUI）',
            description: '不想让画面出现什么，写在这儿。比如当地季节不对的东西：「rapeseed flowers, canola field, snow」。'
              + '云端接口没有这个参数，填了也不起作用。留空＝什么都不加。',
          },
          'worlds.journey.comfyNegativeNode': {
            type: 'string',
            title: '负向提示词节点 id（可留空）',
            description: '留空＝自动找（看哪个节点被采样器的 negative 输入指着）。'
              + '自动找不准时，去 workflow 里看一眼那个 CLIPTextEncode 的 id 填进来。',
          },
          'worlds.journey.imageTimeoutSec': {
            type: 'integer',
            title: '出图最多等几秒（0 = 默认）',
            description: '本地 ComfyUI 默认 180 秒、云端默认 90 秒。模型大、步数多、图大的时候会超时，'
              + '而超时只是「还没画完」，不是坏了。填 300 或 600 就多等一会儿。',
            minimum: 0,
            'x-suffix': '秒',
          },
          'worlds.journey.imageKey': {
            type: 'string',
            title: '生图密钥',
            description: '服务商给你的那串 API Key。只存本机，不进日记、不进日志。自建免鉴权的服务、以及本地 ComfyUI 都留空。',
          },
          'worlds.journey.imageModel': {
            type: 'string',
            title: '生图模型名（仅云端）',
            description: '服务商文档里的图片模型 ID，各家不同。不知道就留空，按 gpt-image-1 试。ComfyUI 那一项不用管 —— 模型写在 workflow 里。',
          },
        },
      },
    },
    {
      id: 'journey.feedback',
      owner: `world:${JOURNEY_ID}`,
      schema: {
        type: 'object',
        title: '反馈',
        description: '面板最下面那一栏发给谁。默认是作者，想换个收件的就改这里；清空则不显示。',
        properties: {
          'worlds.journey.feedbackEmail': {
            type: 'string',
            title: '反馈邮箱',
            description: '面板底部那一栏「说两句」发给谁 —— 报 bug、提想加的地方，点开是一封已经写好的信，带着版本和她当时在哪儿。清空就不显示这一栏。',
          },
        },
      },
    },
  ];
}
