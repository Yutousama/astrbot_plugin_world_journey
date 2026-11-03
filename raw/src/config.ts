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
  maxTripMonths: number;
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
   * 高德 key。**留空不算「没有天气」** —— 自动改走 Open-Meteo（免密钥、按经纬度）。
   *
   * 两条路的分工：高德分昼夜、中文天气名更自然，代价是个人 key 的 QPS 很低；
   * Open-Meteo 覆盖全球、不用 key，但它的日预报只有一个 weather_code，
   * 夜里只能沿用白天的值。所以有人愿意填，但**不填必须照样能走**。
   */
  amapKey: string;
  /** 生图接口（OpenAI 兼容的 `/images/generations` 根地址，如 `https://api.openai.com/v1`）。留空＝不拍。 */
  imageApi: string;
  /**
   * 画面风格。留空 = 真实旅行照片；`none` = 不指定风格；其他 = 原话当前缀。
   *
   * 接本地 ComfyUI / 二次元底模的人，提示词里写死「胶片质感」会跟底模打架。
   */
  imageStyle: string;
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
  maxTripMonths: 6,
  withUser: false,
  moneyEnabled: false,
  budget: 0,
  amapKey: '',
  imageApi: '',
  imageStyle: '',
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
          'worlds.journey.maxTripMonths': {
            type: 'integer',
            title: '一次最多在外多久',
            description: '到点就强制回家歇一阵。想让她一直在外面就调大。',
            minimum: 1,
            maximum: 24,
            'x-suffix': '个月',
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
          'worlds.journey.budget': {
            type: 'integer',
            title: '预算（可留空）',
            description: '0 = 不限。见底后她走近处、不坐飞机，再紧就在当地打几天短工攒路费。填多少，决定她能走多远。',
            minimum: 0,
            'x-suffix': '元',
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
          'worlds.journey.imageApi': {
            type: 'string',
            title: '生图服务地址',
            description: '服务商的 API 地址，填到 /v1 或 /api/v3 为止，别带 images/generations。留空＝不拍照，只写字。',
          },
          'worlds.journey.imageStyle': {
            type: 'string',
            title: '画面风格',
            description: '留空＝真实旅行照片（胶片、自然光）。接的是本地 ComfyUI 或二次元底模时，在这里写你的风格，比如「anime style, cel shading」；写 none 表示完全不指定风格，画风交给底模决定。',
          },
          'worlds.journey.imageKey': {
            type: 'string',
            title: '生图密钥',
            description: '服务商给你的那串 API Key。只存本机，不进日记、不进日志。自建免鉴权的服务可留空。',
          },
          'worlds.journey.imageModel': {
            type: 'string',
            title: '生图模型名',
            description: '服务商文档里的图片模型 ID，各家不同。不知道就留空，按 gpt-image-1 试。',
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
