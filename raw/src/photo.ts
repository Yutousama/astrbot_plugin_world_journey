import { vistaOf } from './geo/cities.ts';

/**
 * 照片 —— 她路上拍的那一张。
 *
 * ## 为什么只拍风景，不拍她
 *
 * 同类扩展（旅行大肥鱼）走的是「角色参考图 + 双候选 + 宿主看图审核」那条路，
 * 为了让明信片里那只鱼每一次都是同一只。那条路很重：要参考图、要审核、要计费确认，
 * 而且**只要模型抖一次，图里的她就不是她了**。
 *
 * 这里反过来：**照片里没有她**。她拍的是窗外、是傍晚的城墙、是雨后的巷子 ——
 * 第一人称的空镜。于是一致性问题当场消失：没有角色，就没有角色不一致。
 * 剩下的全是风景，而风景是模型最擅长的东西。
 *
 * 这也更像真实旅行：人在外面拍得最多的，恰恰是没有自己的那些照片。
 *
 * ## 三条纪律
 *
 * 1. **能不算就不算，能少花钱就少花。** 一天最多一张，同城同日不重复。
 * 2. **失败静默。** 接口错了、超时了、额度没了 —— 旅行一步都不能停，
 *    也不该往用户脸上糊一条报错。只写日志。
 * 3. **图进宿主的媒体库，不进日记目录。** 日记在同步盘上，图片会把盘撑爆；
 *    而且 UI 只认 `log:` 句柄，塞进目录谁也看不见。
 */

/** 拍一张照片需要的上下文。全是**已经算好的事实**，这个模块不自己编。 */
/**
 * 一张照片拍的是什么。
 *
 * 2026-11-06 一位用户报的 bug：「拍照固定在同一个场景，无论我提出什么拍摄要求
 * （比如拍晚饭），都只会生成同一处风景画面」。因为他只有「地面 / 天空」两档 ——
 * 说「拍晚饭」，扩展照样按「城市 + 景点」拼提示词，出来当然还是那处风景。
 *
 * 现在多四档，都按**当地此刻的事实**给素材，不随机编：
 *   food     吃什么（`pickFood` 给出真实的当地菜名）
 *   street   街景（按城市档次：一线老街 / 县城 / 古镇）
 *   festival 节日与季节（按日期算，不是猜）
 *   detail   小物特写（车票、茶碗、旅馆钥匙……）
 */
export type PhotoSubject = 'ground' | 'sky' | 'food' | 'street' | 'festival' | 'detail';

export interface PhotoScene {
  /** 城市名，如「天水」。 */
  readonly city: string;
  /**
   * 城市 id，如 `tianshui`。用来查视觉锚点（`VISTA`）。
   *
   * 不按名字查是有意的：名字会重（「香格里拉」既是云南的市也是稻城那边的镇），
   * 而 id 是唯一的。查不到就按"只有地名"处理，绝不退化成编一个。
   */
  readonly cityId?: string;
  /** 具体地点，如「麦积山石窟」。可以没有 —— 那就只拍城市。 */
  readonly spot?: string;
  /** 拍什么。不传 = `ground`（老行为，一个字不变）。 */
  readonly subject?: PhotoSubject;
  /** 城市价格指数（1 = 一般）。街景按它分「一线老街 / 县城 / 古镇」三档。 */
  readonly cityIdx?: number;
  /** 当地月份（1-12）。节日与季节按它算。 */
  readonly month?: number;
  /** 当地几号。 */
  readonly day?: number;
  /**
   * 拍美食时具体是哪一道。
   *
   * 由调用方用 `pickFood` 挑好传进来 —— 那里已经按城市和时段选过，
   * 是**当地此刻会吃的东西**，不是随机名词。不传就退回笼统的「当地的饭」。
   */
  readonly dish?: string;
  /** 当地几点（0-23 的小时）。决定光。 */
  readonly hour: number;
  /** 天气，如「小雨」。可以直接为空。 */
  readonly weather?: string;
  /** 这一带的体感，如「干，风大」。用来决定照片的调子。 */
  readonly feel?: string;
  /**
   * 画面风格。留空 = 真实旅行照片（默认）；`none` = 完全不指定风格；
   * 其他 = 用这段原文当前缀。
   *
   * 2026-11-01 群友接的是本地 ComfyUI，底模是二次元 —— 提示词里写死
   * 「真实旅行照片、胶片质感」，等于让提示词跟底模对着干。
   */
  readonly style?: string;
  /**
   * 画面里出不出人。留空 = 没有人（默认）；填了就把这段当人物描述拼进去。
   *
   * 原来这里写死一句「画面里没有人物」，接二次元底模的人想拍角色出镜，
   * 那句话就是每次都在跟底模对着干。现在拆成两支，由配置项 `imageCast` 决定。
   */
  readonly cast?: string;
  /**
   * 镜头朝哪：`ground`（默认，脚下的景）还是 `sky`（抬头看天）。
   *
   * 2026-11-05 加。起因是 Mr.Q 要一张星空，她在九寨沟晚上八点 —— 拍出来只有脚边的
   * 钙化池，一颗星都没有，回来难过了一整晚（「那个画面只有我自己看」）。
   *
   * 但这不是「许愿就能画」：抬头拍天**仍然是她当地、那一刻真实的天空**。
   * 有没有星，看几点、看天气，不看他要什么。所以这个开关决定的是**取景方向**，
   * 不是画面内容 —— 天阴着拍多少次也还是云。
   */
  readonly view?: 'ground' | 'sky';
  /**
   * 这一张是**在路上**拍的，不是在城里逛。
   *
   * 2026-11-03 一位读者来信：「生成的图片一直都是几个出发的城市中的图片，
   * 不会显示火车、乡间的照片」。查下来确实如此：拍照只挂在「出去逛」那个节点上，
   * 路上一个节点都不拍，所以画面永远是城里的景点。
   */
  readonly onRoad?: boolean;
  /** 路上坐的是什么（火车 / 长途汽车 / 自驾）。只有在路上时才有意义。 */
  readonly mode?: string;
}

export interface PhotoRequest {
  /** OpenAI 兼容的根地址，如 `https://api.openai.com/v1`。 */
  readonly api: string;
  readonly key: string;
  /** 模型 id。留空用 `gpt-image-1`。 */
  readonly model?: string;
  readonly size?: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

/** 生成结果。字节直接交给宿主，由它算哈希、落 `data/media/`。 */
export interface PhotoBytes {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** 默认模型。多数兼容接口都认 `gpt-image-1` 这一套请求体。 */
export const PHOTO_MODEL = 'gpt-image-1';
/** 默认尺寸。方图最省，也最像手机随手拍。 */
export const PHOTO_SIZE = '1024x1024';
/** 一张图等多久。生图慢是常态，但超过一分半就当作没拍成。 */
const PHOTO_TIMEOUT_MS = 90_000;

/**
 * 把事实拼成一句给模型的话。
 *
 * **不用「一只鱼站在……」这种句式。** 空镜的关键是：说清在哪、什么光、什么天气、
 * 什么质感，然后明确要求「没有人物、没有文字」。不写「没有人物」的话，
 * 模型很爱往画面里塞一个人 —— 那不是她，是一个陌生人站在她的照片里。
 *
 * 这一段是纯函数，测试直接喂数字验，不用起网络。
 */
/**
 * 四条通用尾巴。
 *
 * 不管拍什么都要有的：**没有人物、没有可读文字**。这两条是硬约束 ——
 * 不写「没有人物」，模型很爱往画面里塞一个陌生人；不写「没有文字」，
 * 中文招牌生成出来必然是乱码。
 */
const NO_PEOPLE = '画面里没有人（或者只有远处的背影、虚化的人群，脸看不清）';
const NO_TEXT = '所有招牌、菜单、车票上的字都模糊成色块，不要出现可读的文字，不要水印';

/**
 * 拍吃的。
 *
 * 素材是按真实的地方小吃查来的（2026-11-06）：碗是什么样、汤什么颜色、
 * 上面浮着什么、桌上还有什么。**写材质，不写形容词** —— 「好吃」画不出来，
 * 「汤清到能看见碗底、红油不搅开」画得出来。
 */
function foodPrompt(scene: PhotoScene): string {
  const dish = (scene.dish ?? '').trim();
  const what = dish ? `${scene.city}的${dish}` : `${scene.city}街边的一碗当地饭`;
  /* 按菜名的字面猜它属于哪一类，给一套对应的器物和桌面 —— 猜错也不至于难看。 */
  const kind =
    /面|粉|米线|馄饨|抄手|饺|包|馍|饼/.test(what) ? 'noodle'
    : /火锅|锅|烤|串|烧/.test(what) ? 'hotpot'
    : /茶|点|糕|粑|月饼/.test(what) ? 'tea'
    : 'plate';
  const table =
    kind === 'noodle'
      ? '白瓷大碗，汤色清亮能看见碗底，表面一层红油泼辣子没搅开，浮着几片白萝卜、一撮翠绿香菜；桌面是贴皮木纹，旁边一碟小菜、一个玻璃醋瓶、不锈钢圆凳'
      : kind === 'hotpot'
        ? '黑铁锅或者不锈钢锅，汤在翻滚冒大泡，表面一层橙红厚油，边角挂着焦褐的辣椒壳和花椒粒；木桌上摆着香油蒜泥碟、长竹筷、竹笊篱、几瓶饮料'
        : kind === 'tea'
          ? '竹蒸笼叠成三层塔，笼盖掀开冒白汽；白瓷小碟上是半透明的点心，旁边一壶茶（茶汤深红）、小茶杯；白桌布上有一张被茶水洇湿的点心卡'
          : '厚釉粗陶盘，边缘有一处磕碰；菜上挂着油光，撒着葱花和辣椒段；桌面上有水渍、几张揉皱的餐巾纸、一双一次性竹筷';
  const light =
    scene.hour < 10 ? '清晨的侧光从窗子斜进来'
    : scene.hour < 15 ? '正午偏硬的光，碗沿有一道亮边'
    : scene.hour < 19 ? '下午的斜光，桌面有一块暖色光斑'
    : '夜里的暖黄灯光，油光特别亮，桌面反光';
  const steam = scene.hour >= 17 || scene.hour < 10 ? '，热气在光里升起来' : '';
  return `一张食物特写照片：${what}。${table}。${light}${steam}。`
    + `低机位贴近桌面，浅景深，焦点在碗沿那圈油光上。${NO_PEOPLE}。${NO_TEXT}。`;
}

/**
 * 拍街。
 *
 * 按城市档次给三套要素（一线老街 / 县城 / 古镇）。**街景最容易画成空街**，
 * 所以要具体到「卷帘门半开、电动车靠墙充电、电线从二楼垂下来」这种程度。
 */
function streetPrompt(scene: PhotoScene): string {
  const tier = (scene.cityIdx ?? 1) >= 1.1 ? 'metro' : (scene.cityIdx ?? 1) >= 0.9 ? 'town' : 'county';
  const look =
    tier === 'metro'
      ? '三四层的老楼，墙上挂着锈迹往下流的空调外机、PVC 落水管；横向灯箱和竖向挑出的招牌挤在一起，'
        + '有的灯管坏了一截只剩半边亮；共享单车斜排成一条，外卖电动车靠墙充电（电线从二楼窗户垂下来），'
        + '半开的卷帘门，门口塑料凳上放着一个快递盒；地砖被踩得发灰，缝里嵌着黑泥，几处积水映着招牌'
      : tier === 'town'
        ? '白墙黛瓦，墙脚有一米高的深色水渍和绿苔；木格窗棂被手摸得发亮，窗下挂着竹篮；'
          + '不发光木牌和布幌子从檐下斜挑出来，颜色是褪了的靛蓝和暗红；'
          + '一串红灯笼从巷口挂到巷尾，廊棚下有长条木凳，河边石阶上系着一条乌篷船；青石板被磨得发亮、反光'
        : '三四层的自建房贴白瓷砖，瓷砖发黄、雨痕成竖向条纹；二楼阳台封了铝合金窗，窗外竹竿晾着衣服；'
          + '红底黄字的喷绘布招牌挤成一排，高度不齐，字被晒得发白；'
          + '电动车横七竖八停着，水果摊撑开彩色遮阳伞、塑料筐里码着橘子，矮桌和红色塑料凳摆到马路上；'
          + '电线在头顶织成一片网，从一根水泥杆拉到另一根';
  const light =
    scene.hour < 7 ? '天刚亮，街面是灰蓝色的，只有早点铺的灯亮着'
    : scene.hour < 17 ? '顶光穿过行道树，街面一片斑驳'
    : scene.hour < 20 ? '傍晚钠灯刚亮，橙黄的光在地上摊成一块一块'
    : '夜里钠灯和冷白 LED 混色，湿地面把灯光拉成竖条';
  return `一张街道照片：${scene.city}的街。${look}。${light}。`
    + `站在街边平视，35mm 视角，收进两侧的立面。${NO_PEOPLE}。${NO_TEXT}。`;
}

/**
 * 拍节日与季节。
 *
 * **按日期算，不猜**：节日看月日，季节看月份。写的是「看到什么就知道是什么节」，
 * 不是习俗解释。
 */
function festivalPrompt(scene: PhotoScene): string {
  const m = scene.month ?? 1;
  const d = scene.day ?? 1;
  const key =
    (m === 1 || m === 2) && (m === 2 ? d <= 20 : d >= 20) ? 'spring'
    : m === 4 && d <= 10 ? 'qingming'
    : m === 6 && d >= 1 && d <= 15 ? 'duanwu'
    : m === 9 && d >= 10 && d <= 25 ? 'midautumn'
    : m === 12 || m === 1 ? 'winter'
    : m >= 3 && m <= 5 ? 'springSeason'
    : m >= 6 && m <= 8 ? 'summer'
    : 'autumn';
  const look: Record<string, string> = {
    spring: '成串的圆红灯笼和方形宫灯从巷口挂进去，门框两侧是红纸竖条（字迹模糊成黑色墨块），'
      + '窗户上贴着红色剪纸；地上铺着一层红纸屑和鞭炮炸过的焦痕，阳台上挂着腊肉香肠',
    qingming: '细雨，灰白的雾把远处吃掉一半；柳枝新绿、垂得很低；青团是青绿色半透明糯米团，'
      + '垫在深绿箬叶上、表面刷了油发亮；湿透的青石板反着光',
    duanwu: '深绿带竖纹的箬叶堆在盆里，四角锥形的粽子用白棉线捆着；门上挂着艾草和菖蒲；'
      + '五彩绳搭在桌角；河面上一条龙舟，彩绘的龙头红金配色',
    midautumn: '月亮大得不成比例、偏低、带橙黄色；方桌上摆着打开的铁盒月饼（一格一格）、几个柚子和柚子皮做的灯、一串青提、一壶茶',
    winter: '雪压在瓦片上形成一层白边，红灯笼在雪里；屋檐下挂着冰棱，窗玻璃上是羽状的冰花；'
      + '早点铺门口冒白汽，路边雪被踩成灰黑色',
    springSeason: '油菜花的整片明黄，樱花是淡粉近白、成团地开着；柳芽嫩黄绿；阳台上晒的被子鼓起来；雨后的空气是灰绿的',
    summer: '傍晚的天空从橘红渐变到紫，电线横过画面；竹席上摆着一碗绿豆汤，碗壁挂着水珠；阳台上晾着一排滴水的短袖',
    autumn: '银杏叶铺满一地（亮黄、扇形），柿子挂在光秃的枝上、带一层白霜；竹匾里晒着红辣椒和黄玉米；清晨有雾',
  };
  return `一张照片：${scene.city}，${look[key] ?? look.autumn}。`
    + `${scene.hour < 7 || scene.hour > 19 ? '光很低，画面偏暗但颜色浓' : '自然光，颜色比平时饱和一点'}。`
    + `平视或微微仰拍。${NO_PEOPLE}。${NO_TEXT}。`;
}

/**
 * 拍小东西。
 *
 * 一件东西占满画面。这类照片最容易出效果，因为它不依赖「城市长什么样」。
 */
const DETAILS: readonly string[] = [
  '一张纸质车票，边角磨毛、有折痕，上面是密密麻麻的黑色印刷色块，压在塑料桌布上',
  '一把黄铜钥匙挂在一块木牌上，牌上有手写的黑墨数字，钥匙齿磨得发亮，木牌边缘有磕碰的缺口',
  '一只盖碗，白瓷带青花，碗盖斜搁在碗沿上，茶汤琥珀色透光，碗底沉着几片舒展的茶叶，木桌上有一圈旧茶渍',
  '晒着的被子搭在竹竿上鼓成一座小山，花布被面，阳光从背面透过来能看见棉絮的绒感，竹竿上打着绳结',
  '一个红色塑料凳，凳面有网格纹、边缘磨白，一条腿短一点微微歪，摆在水泥地上，旁边是掉漆的铁桌腿',
  '一只白底蓝边的搪瓷杯，杯口磕掉一块瓷、露出黑色铁胎，杯身印着褪色的红色色块，里面是半杯浓茶',
  '一碟塑封的路边摊菜单，边角卷起、沾着油点和辣椒油印，用夹子夹在铁架上，字模糊成红黑条块',
  '透过车窗看外面：玻璃外侧水珠成串、内侧有雾气，雨滴把灯光拉成竖条并虚化成色块',
  '一把细香插在铜炉的灰里，香头是暗红的一点，青烟细细地升起又散开，炉身有铜绿',
  '透明塑料袋鼓着，里面是橙子，袋口打了个死结，袋壁挂满水汽，提手被拉长',
];

function detailPrompt(scene: PhotoScene): string {
  /* 用城市 + 日期定一个稳定的序号：同一天不会一会儿这样一会儿那样。 */
  const seed = [...`${scene.city}${scene.month ?? 1}${scene.day ?? 1}`]
    .reduce((n, ch) => (n ^ ch.charCodeAt(0)) * 16777619 >>> 0, 2166136261) >>> 0;
  const item = DETAILS[seed % DETAILS.length]!;
  const light =
    scene.hour < 9 ? '清晨的柔光从侧面来'
    : scene.hour < 17 ? '窗边透进来的自然光'
    : '一盏暖黄的灯从上方照下来，桌面有反光';
  return `一张特写照片：${item}。${light}。`
    + `45 度俯拍或贴近拍，浅景深，焦点落在最亮的那一小块上。${NO_PEOPLE}。${NO_TEXT}。`;
}

export function photoPrompt(scene: PhotoScene): string {
  /*
   * 先按题材分流（2026-11-06）。
   *
   * 这是那个 bug 的正面修法：原来不管用户说什么，都走「城市 + 景点」那一条，
   * 于是「拍晚饭」出来还是那处风景。现在题材写在 scene 里，各走各的模板。
   *
   * `subject` 没传时，按老的 `view` 推 —— 老调用方一个字段都不用改。
   */
  const subject = scene.subject ?? (scene.view === 'sky' ? 'sky' : 'ground');
  if (subject === 'food') return foodPrompt(scene);
  if (subject === 'street') return streetPrompt(scene);
  if (subject === 'festival') return festivalPrompt(scene);
  if (subject === 'detail') return detailPrompt(scene);

  /*
   * 视觉锚点：把「这地方长什么样」补进提示词。
   *
   * 2026-11-04 之前这里只有地名（「九寨沟的甘海子」）。模型不认识「甘海子」，
   * 出来的是泛泛的暖金色高原湖。加上锚点之后就认得出是九寨沟了 ——
   * 同一句提示词、同一颗种子，唯一的差别就是这一串字。
   *
   * 路上的照片不加：那时候拍的是窗外掠过的田野村庄，套上"城市长什么样"
   * 反而会让它硬画一座城。
   */
  /*
   * 抬头拍天：老调用方用 `view='sky'`，新调用方用 `subject='sky'` —— 两条都要认。
   * 只认 view 的话，`subject: 'sky'` 会被当成 ground，出来的还是脚下那片地。
   */
  const sky = scene.view === 'sky' || scene.subject === 'sky';
  const vista = sky || scene.onRoad ? '' : vistaOf(scene.cityId);
  const named = scene.spot ? `${scene.city}的${scene.spot}` : scene.city;
  const where = sky
    // 抬头拍天：取景方向变了，地点还在 —— 地面只留一道剪影，别让它抢戏。
    ? `${scene.city}上空，镜头抬起来对着天`
    : scene.onRoad
      /*
       * 路上的画面要说清「往外看」，不说模型就画一座城。
       * 带上交通方式是因为火车窗、汽车窗、机翼底下完全不是一回事。
       */
      ? `在${scene.mode ?? '车'}上往外看的风景，${scene.city}一带的田野、村庄和路`
      : vista ? `${named}，${vista}` : named;
  const light =
    scene.hour < 6 ? '天还没亮的蓝调时刻'
    : scene.hour < 9 ? '清晨的低角度阳光'
    : scene.hour < 12 ? '上午的明亮日光'
    : scene.hour < 15 ? '正午偏硬的光'
    : scene.hour < 18 ? '下午的斜光'
    : scene.hour < 20 ? '黄昏的金色光线'
    : '入夜后的灯光';

  /*
   * 风格分三档：
   * - 留空 → 原来的写实旅行照片（老行为，一个字没变）
   * - `none` → 一个字都不提风格，只描述场景，把画风完全交给底模
   * - 其他 → 用户给的原话当前缀
   *
   * 「没有人物/没有文字」这四不要**对任何风格都成立**，所以不在分支里。
   */
  const raw = (scene.style ?? '').trim();
  const bare = raw.toLowerCase() === 'none';
  const custom = raw !== '' && !bare;

  /*
   * 人物：留空就一个人都不画。
   *
   * 单独成句、不塞进 `where` 里 —— 塞进去会变成「一个穿风衣的女孩，九寨沟的五花海」，
   * 模型容易把人和景当成两个并列主体画成两张拼一起。分开说，人就是站在这个景里。
   */
  const cast = (scene.cast ?? '').trim();

  /*
   * 「写实照片」那一套词（真实旅行照片 / 胶片质感 / 路人视角）只在
   * **没人、也没指定风格**的时候加。
   *
   * 2026-11-04 实测的坑：设了二次元角色之后，出图还是写实风 —— 因为
   * 「一张真实旅行照片：」+「胶片质感，自然光」把 `anime style` 压过去了。
   * 风格是跟着人物走的，人物说了算，不该再被这几句拽回来。
   */
  const realism = !cast && !custom && !bare;
  const lead = bare ? '' : custom ? `${raw}：` : realism ? '一张真实旅行照片：' : '';

  /*
   * 抬头那张得先交代天上是什么。不交代的话，模型拿「城市名 + 夜色」会自己编一片星海，
   * 天阴着也照样画满天星——那就成了许愿，不是她抬头看见的东西。
   */
  const skyInfo = sky ? skyOf(scene.hour, scene.weather ?? '') : null;

  const parts = [
    lead,
    `${where}，${light}。`,
    cast ? `画面里有一个人：${cast}。` : '',
    scene.weather ? `天气${scene.weather}。` : '',
    skyInfo ? `头顶：${skyInfo.told}。` : '',
    skyInfo ? '这一张以天空为主，地面只在最底下一道山脊剪影。' : '',
    scene.feel ? `${scene.feel}，画面能看出这一点。` : '',
    /*
     * 原来这里写的是「像路过的人随手举起手机拍的」。
     * 那句话是想要「不完美、有生活感」，但模型把「路过的人」当成了画面内容 ——
     * 设了「画面里只有一个人」之后，它照样画了两个背影。人不能进这句。
     */
    realism ? '视角自然随意，略微不完美，有生活感。' : '',
    realism ? '胶片质感，自然光，景深自然。' : '',
    // 有人和没人，这两句不能并存 —— 同一段提示词里既说有人又说没人，出图会飘。
    cast ? '画面里只有这一个人，不要出现其他人。' : '画面里没有人物。',
    '没有文字，没有水印，没有边框。',
  ];
  return parts.filter(Boolean).join('');
}

/** 抬头那一眼能看见什么。`told` 进提示词，`stars` 进回执。 */
export interface SkyView {
  readonly told: string;
  /** 这一眼有没有星。她要星空时，回执拿它说实话。 */
  readonly stars: boolean;
}

/**
 * 抬头那一眼。**只看小时和天气，不看他要什么。**
 *
 * 这是「拍天空」和「许愿画图」的分界线：他要星空，天阴着就还是云；
 * 他要月亮，正午就是蓝天。给的是她真的看得见的那片天 ——
 * 否则她「拍到了星空」这件事本身就是假的，一查天气就露。
 */
export function skyOf(hour: number, weather: string): SkyView {
  const h = ((hour % 24) + 24) % 24;
  /*
   * 云分两档，别一刀切。
   *
   * 「阴」是整片盖住，一颗都不透；「多云」在真实夜里是能看见亮星的 ——
   * 尤其九寨沟这种光污染低的地方。把多云也判成没星，等于让一个明明能看见星的地方
   * 说「看不见」，那也是另一种不真，而且是最伤人的那种：当着满天云缝说没星。
   */
  const w = weather ?? '';
  const heavy = /阴|雨|雪|雾|雷|霾|沙|尘/.test(w);
  const partly = !heavy && /云/.test(w);

  if (h >= 20 || h < 4) {
    if (heavy) return { told: '夜里，云层压得很低，一颗星都不透', stars: false };
    if (partly) return { told: '夜里，云占了大半，云缝里漏出几颗亮的', stars: true };
    return { told: '夜里，满天星，银河斜过天顶，暗处都看得清', stars: true };
  }
  if (h < 5) {
    if (heavy) return { told: '天将亮，云是灰的', stars: false };
    if (partly) return { told: '天将亮的蓝调时刻，云边上还挂着几颗星', stars: true };
    return { told: '天将亮的蓝调时刻，星一颗颗往下沉', stars: true };
  }
  if (h < 7) {
    return { told: h < 6 ? '日出前的暖色天光，地平线在发白' : '日出的低角度光线', stars: false };
  }
  if (h < 17) {
    if (heavy) return { told: '阴天，云层很厚，看不见太阳的边', stars: false };
    if (partly) return { told: '多云，太阳在云后面时隐时现', stars: false };
    return { told: '晴，蓝天和几朵散云', stars: false };
  }
  if (h < 19) {
    if (heavy) return { told: '傍晚，云被压成一片深灰', stars: false };
    if (partly) return { told: '傍晚，云被夕阳染出紫边', stars: false };
    return { told: '晚霞，天边橙红压着一层蓝', stars: false };
  }
  if (heavy) return { told: '暮色，云把最后一点光挡了', stars: false };
  if (partly) return { told: '暮色，云缝里已经能看到第一颗星', stars: true };
  return { told: '暮色刚起，第一批星出来了', stars: true };
}

/**
 * 从作息节点的一句话里抠出地点。
 *
 * 节点写的是「下午，莫高窟」「清晨，老城那几条街」—— 前半截是时段，后半截才是地方。
 * 抠不出来就返回空串，让调用方只写城市名：**宁可能说的少，不要编一个地点**。
 */
export function spotFromBeat(what: string): string {
  const m = /[，,]\s*(.+)$/.exec(what.trim());
  const spot = (m?.[1] ?? '').trim();
  // 「城里随便走走」这种不是地点，别塞进提示词让模型去画一座「随便走走」。
  if (!spot || /随便走走|走一段|坐着看水|视野开的那一段|沿着水边/.test(spot)) return '';
  return spot.replace(/。$/, '');
}

/**
 * 这张照片叫什么。给相册用，一句话，不加书名号。
 *
 * 时间要参与命名：同一座城市不同时候拍出来是两张不同的照片，
 * 都叫「天水」的话相册里会有一排同名。
 */
export function photoTitle(
  city: string, spot: string, hour: number, view: 'ground' | 'sky' = 'ground',
): string {
  /*
   * 抬头那张的标题不写「星空」写「夜空」。
   *
   * 标题是纯函数，拿不到天气；天阴着还标「星空」就是替她撒谎。
   * 「夜空」在晴和阴两种天里都成立 —— 宁可含糊，不写假话。
   */
  if (view === 'sky') {
    const h = ((hour % 24) + 24) % 24;
    const part =
      h >= 20 || h < 4 ? '夜空'
      : h < 7 ? '天光'
      : h < 17 ? '天空'
      : h < 19 ? '晚霞'
      : '暮色';
    return `${spot || city}的${part}`;
  }
  const part =
    hour < 9 ? '清晨'
    : hour < 12 ? '上午'
    : hour < 15 ? '午后'
    : hour < 18 ? '下午'
    : '黄昏';
  return spot ? `${part}的${spot}` : `${part}的${city}`;
}

/**
 * 调一次生图。
 *
 * 支持两种返回：`b64_json`（OpenAI 与多数兼容接口）和 `url`（一部分服务，含火山方舟）。
 * 两种都要，因为「兼容」这两个字在现实里只兼容到一半。
 *
 * ## 失败要吵，成功要静
 *
 * 这个函数**抛错**，不返回 null。区别很大：返回 null 只能让上层记一句「没拍成」，
 * 而用户真正需要知道的是「HTTP 401：密钥无效」还是「HTTP 400：size 不支持」。
 * 上层 `maybePhoto` 会 catch 住并且只写日志 —— 旅行一步都不停，但日志里得有原因，
 * 否则用户配错了永远不知道为什么相册是空的。
 *
 * ## size 的重试
 *
 * 字段名和取值在不同服务上都不一样，实测三种：
 *
 * - OpenAI / 火山方舟：`size`（`1024x1024` / `2K`）
 * - 硅基流动、阿里百炼那种 DashScope 血统的：**`image_size`**，传 `size` 直接 400
 * - 有的干脆只认自己模型的默认尺寸，多传一个就报错
 *
 * 所以分两步退：先按 OpenAI 的写法发；400 且错误里点名 `image_size` 就换字段名重发
 * （尺寸不变）；还是不行才整个去掉，让服务商用默认值。
 * 判据是**错误文本**，不是状态码 —— 三种情况的 400 长得一模一样。
 */
/**
 * 从「must be one of: …」这种报错里挖出候选尺寸，挑一个和目标**宽高比最接近**的。
 *
 * ## 为什么要有这一步
 *
 * 各家的尺寸枚举完全不同，而且都会报错：
 *
 * - Qwen-Image / Z-Image：认 `1664x928` 这种任意值
 * - **MOSS-Image**：只认 8 个固定档 —— `1024x1024(1:1) 832x1216(2:3) 1216x832(3:2)
 *   896x1152(3:4) 1152x896(4:3) 768x1344(9:16) 1344x768(16:9) 1568x672(21:9)`，
 *   而且**必填**
 *
 * 2026-11-04 用户换成 MOSS 就直接 400，而错误文案里其实已经把 8 个候选全列出来了。
 * 让用户为每个模型查一遍规格是不现实的 —— 那就自己读、自己挑。
 *
 * 挑的判据是**宽高比的距离**，不是"取最长边最接近的"：16:9 的 `1664x928` 要挑到
 * `1344x768`（16:9），而不是像素数更接近的 `1568x672`（21:9）——
 * 后者会让画面横向拉长，构图整个变了。
 */
export function nearestSize(errText: string, want: string): string | null {
  const tail = /must be one of[：:]\s*([\s\S]+)/i.exec(errText)?.[1] ?? '';
  const cands = [...tail.matchAll(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/gi)].map((m) => `${m[1]}x${m[2]}`);
  if (!cands.length) return null;

  const w = /(\d{2,5})\s*[x×*]\s*(\d{2,5})/i.exec(want ?? '');
  if (!w) return cands[0];
  const target = Number(w[1]) / Number(w[2]);
  if (!Number.isFinite(target) || target <= 0) return cands[0];

  let best = cands[0];
  let bestDiff = Infinity;
  for (const c of cands) {
    const [cw, ch] = c.split('x').map(Number);
    const diff = Math.abs(cw / ch - target);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best;
}

/**
 * 模型名填错时，问服务端「你这儿有哪些模型」，给他指到该填哪一个。
 *
 * 拿不到列表就返回 null —— 照常报原来的错，不因为「提示失败」把流程带歪。
 */
async function modelNameHint(base: string, key: string, want: string): Promise<string | null> {
  /*
   * 带 `type=image` 问，只列图片模型 —— 不然硅基流动会返回近百个文本模型
   * （DeepSeek、GLM 之类），对"我该填哪个画图模型"这个问题毫无帮助。
   * 不认这个参数的服务退回去问全部，总比没有强。
   */
  const askList = async (query: string): Promise<string[]> => {
    const res = await fetch(`${base}/models${query}`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
    return (body?.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  };
  try {
    let ids: string[] = [];
    try { ids = await askList('?type=image'); } catch { /* 下面还有一次机会 */ }
    if (!ids.length) ids = await askList('');
    if (!ids.length) return null;

    // 拿他填的那一截（去掉可能带的厂商前缀）去模糊匹配
    const tail = want.trim().toLowerCase().split('/').pop() ?? '';
    const guess = tail ? ids.filter((id) => id.toLowerCase().includes(tail)) : [];

    const lines = [
      `模型名对不上：「${want.trim() || '(空)'}」服务端没有这个模型。`,
      '这类服务的模型 ID 要带厂商前缀，写成「厂商/模型名」，比如 Tongyi-MAI/Z-Image-Turbo。',
    ];
    if (guess.length) lines.push(`你要的应该是：${guess.join(' 或 ')}`);
    const shown = ids.slice(0, 12).join('、');
    lines.push(`服务端现在有的：${shown}${ids.length > 12 ? ` 等 ${ids.length} 个` : ''}`);
    return lines.join('\n');
  } catch {
    return null;
  }
}

export async function shootPhoto(req: PhotoRequest): Promise<PhotoBytes> {  const base = req.api.trim().replace(/\/+$/, '');
  if (!base) throw new Error('生图接口没填');

  const url = `${base}/images/generations`;
  const body: Record<string, unknown> = {
    model: req.model?.trim() || PHOTO_MODEL,
    prompt: req.prompt,
    n: 1,
    // 有的服务只认 response_format，有的根本不认这个字段（认不认都不会报错）。
    response_format: 'b64_json',
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.key.trim()) headers.authorization = `Bearer ${req.key.trim()}`;
  const timeout = req.timeoutMs ?? PHOTO_TIMEOUT_MS;

  const send = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

  const wantSize = req.size?.trim() || PHOTO_SIZE;
  /*
   * 实际发出去的尺寸。可能被下面的重试改掉 —— 有些模型只认固定枚举
   * （见 `nearestSize` 的注释），换成一个同样比例、它认的值。
   */
  let sizeValue = wantSize;

  /*
   * 尺寸怎么写、要不要 `response_format`，各家不同。用三个开关描述「这一版请求长什么样」，
   * 每次 400 只改一个 —— 改哪一个是**看错误文本**决定的，不是按顺序瞎试。
   */
  let sizeField: 'size' | 'image_size' | null = 'size';
  let withFormat = true;
  /*
   * 默认请求「不要水印」。
   *
   * 2026-11-01 实测：硅基流动的免费模型（Kolors）默认在右下角烧一个「AI 生成」，
   * 提示词里写「没有水印」没用 —— 那是平台加的，不是模型画的。
   * 这一句是参数，不是描述。不认识这个字段的服务会 400，那就按阶梯去掉。
   */
  let withWatermark = true;
  const build = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...body };
    if (!withFormat) delete payload.response_format;
    if (withWatermark) payload.watermark = false;
    if (sizeField) payload[sizeField] = sizeValue;
    return payload;
  };

  let res: Response;
  try {
    res = await send(build());
    /*
     * 最多再试两次。不追组合爆炸：真要两种字段一起被挑，让它报错进日志，
     * 比连发五六次把人家的限速打满强 —— 这个功能一天最多一张，不值得为它烧配额。
     */
    for (let i = 0; i < 3 && res.status === 400; i++) {
      const peek = (await res.clone().text()).slice(0, 400);
      const before = `${sizeField}|${withFormat}|${withWatermark}|${sizeValue}`;
      if (/image_size/i.test(peek) && sizeField !== 'image_size') {
        // 硅基流动、阿里百炼那一支：只认 image_size，传 size 直接拒
        sizeField = 'image_size';
      } else if (sizeField && /must be one of/i.test(peek)) {
        /*
         * 字段名对了、**值**不在它认的枚举里。2026-11-04 MOSS-Image 就是这样：
         *
         *   image_size must be one of: 1024x1024 (1:1), 832x1216 (2:3), 1216x832 (3:2),
         *   896x1152 (3:4), 1152x896 (4:3), 768x1344 (9:16), 1344x768 (16:9), 1568x672 (21:9)
         *
         * 而配置里填的是 1664x928（Qwen-Image 的规格）。每个模型的枚举都不一样，
         * 让用户挨个记是不现实的 —— **错误信息里已经把候选列出来了**，直接挑一个。
         */
        const alt = nearestSize(peek, sizeValue);
        if (alt) sizeValue = alt;
        else sizeField = null;   // 连候选都解析不出来，只能退回默认尺寸
      } else if (/response_format/i.test(peek) && withFormat) {
        // 不认识这个字段的服务：去掉它，回头看 data[0].url 也能取图
        withFormat = false;
      } else if (/watermark|水印/i.test(peek) && withWatermark) {
        // 不认识这个字段的服务：去掉，把那一点点水印忍了
        withWatermark = false;
      } else if (/size|尺寸|分辨率/i.test(peek) && sizeField !== null) {
        // 尺寸值本身它不收：什么尺寸都不带，让它用自己的默认值
        sizeField = null;
      }
      if (`${sizeField}|${withFormat}|${withWatermark}|${sizeValue}` === before) break;   // 认不出该改什么，别乱试
      res = await send(build());
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    throw new Error(name === 'TimeoutError' ? '超时了' : `连不上服务（${name}）`);
  }

  if (!res.ok) {
    const detail = await readError(res);
    /*
     * 模型名不存在 —— 单独说清。
     *
     * 2026-11-04 Mr.Q 填了 `Z-Image`，日志里连着三条
     * `HTTP 400：Model does not exist`。真正的原因是**少了厂商前缀**：
     * 硅基流动的模型 ID 是 `厂商/模型名`（`Tongyi-MAI/Z-Image-Turbo`），
     * 只写 `Z-Image` 它当然找不到。
     *
     * 这种错光看报错是猜不出来的 —— 用户会以为自己填的名字服务端不支持，
     * 然后一个个试。既然是模型名的问题，就把**能用的名字列出来**，
     * 再按他填的那截做一次模糊匹配，直接指到该填哪一个。
     */
    if (/model.*(not exist|not found|does not)/i.test(detail)) {
      const hint = await modelNameHint(base, req.key, req.model ?? '');
      if (hint) throw new Error(hint);
    }
    throw new Error(`服务返回 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }

  /*
   * **不用 res.json()。** 它把 JSON.parse 的真实原因吞掉，只剩一句「不是 JSON」——
   * 2026-11-01 收到一条反馈：中转站那边图生成成功，这边只报「返回的不是 JSON」，
   * 用户和我们都没法判断是格式坏了、被截断了、还是返回了别的东西。
   * 改成先拿原文，失败时把大小、原始错误、头尾片段一起带出去。
   */
  const raw = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    const repaired = repairJsonText(raw);
    if (repaired === null) throw new Error(badJsonDetail(raw, e));
    payload = repaired;
  }

  const first = firstImage(payload);
  if (!first) throw new Error('返回里没有图');

  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    const bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
    /*
     * 用文件头认格式，**别硬写 image/png**。
     *
     * 两个理由：中转站给的也可能是 JPEG，写死 PNG 扩展名就错了；
     * 更要紧的是 —— 有些中转站在日志/响应里把 b64 换成占位符
     * （「[base64 image data omitted]」这种），解出来根本不是图。
     * 那种情况下必须当场说清，否则会存成一张打不开的「照片」。
     */
    const mime = sniffImage(bytes);
    if (!mime) {
      const head = Buffer.from(bytes.slice(0, 16)).toString('hex');
      throw new Error(`b64 解出来不是图片（前 16 字节 ${head || '空'}）—— 中转站可能返回了占位符或截断的数据`);
    }
    return { bytes, mime };
  }
  if (typeof first.url === 'string' && /^https?:\/\//.test(first.url)) {
    try {
      const dl = await fetch(first.url, { signal: AbortSignal.timeout(timeout) });
      if (!dl.ok) throw new Error(`下载图片 HTTP ${dl.status}`);
      const buf = new Uint8Array(await dl.arrayBuffer());
      if (!buf.length) throw new Error('图片是空的');
      const header = dl.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      /*
       * **不能只信 content-type。** 对象存储（阿里 OSS、各家 CDN）很常见地把图片标成
       * `application/octet-stream` 或者压根不给。宿主按 mime 决定落盘扩展名，
       * 认不出就存成 `.bin` —— 用户双击打不开，相册也显示不出来
       * （2026-11-01 真实发生：一张 1.7MB 的 PNG 存成了 4aeaca….bin）。
       *
       * 所以：给的是 image/* 就用它；否则**看文件头**，再不行才按 PNG。
       */
      const mime = header.startsWith('image/') && !header.includes('octet-stream')
        ? header
        : sniffImage(buf) ?? 'image/png';
      return { bytes: buf, mime };
    } catch (e) {
      throw new Error(`拿到了图片地址但下载失败（${e instanceof Error ? e.message : '未知'}）`);
    }
  }
  throw new Error('返回格式不对：既没有 b64_json 也没有 url');
}

/**
 * 中转站常见的一种坏法：base64 里带着**裸换行**（没转义成 \n）。
 * 那不是合法 JSON，但把字符串内部的换行吃掉就能解析。
 *
 * 只在 JSON.parse 失败后才试，而且只动 base64 那一段 ——
 * 别处的换行删了会改变内容（提示词里的换行是有意义的）。
 */
function repairJsonText(raw: string): unknown | null {
  /*
   * 盯住 b64_json 那个值，把它内部的空白全删掉。
   * base64 不含空白字符，所以这个动作是安全的；而按长度猜断行位置不可靠
   * （最后一段可能只有十几个字符，写死阈值就漏）。
   */
  /*
   * **用 lookahead 卡后面的分隔符，别把它吃进匹配里。**
   * 写成 `"\s*[,}]` 的话 m[0] 会带上那个 `}`，替换之后 JSON 少一个括号，
   * 修完还是不合法 —— 第一版就是这么错的。
   */
  const m = raw.match(/"b64_json"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/);
  if (!m) return null;
  const cleaned = m[1].replace(/\s+/g, '');
  if (cleaned === m[1]) return null;
  // 用函数形式替换：值里可能有 `$`，字符串形式替换会被当成特殊记号。
  const rebuilt = raw.replace(m[0], () => `"b64_json":"${cleaned}"`);
  try {
    return JSON.parse(rebuilt);
  } catch {
    return null;
  }
}

/** 把长 base64 串折成占位，别把几 MB 的图塞进日志和界面。 */
function maskBase64(text: string): string {
  return text.replace(/[A-Za-z0-9+/=]{80,}/g, (m) => `<base64 ${m.length} 字符>`);
}

/** 解析失败时能让人判断到底怎么了：多大、原始错误、头尾长什么样。 */
function badJsonDetail(raw: string, err: unknown): string {
  const why = err instanceof Error ? err.message : String(err);
  const head = maskBase64(raw.slice(0, 160));
  const tail = maskBase64(raw.slice(-40));
  const look = raw.length > 200 ? `开头 ${head} … 结尾 ${tail}` : head;
  return `返回的不是 JSON（${raw.length} 字符）：${why}。${look}`;
}

/**
 * 从返回体里捞出第一张图。
 *
 * **不能只认 `data`。** 2026-11-01 同一天里两种形状都见着了：
 * OpenAI 与多数兼容层是 `{ data: [{ url }] }`，硅基流动现在回的是
 * `{ images: [{ url }] }` —— 只认 `data` 的话，图明明生成好了，
 * 这边却报「返回里没有图」，钱照扣。
 */
export function firstImage(payload: unknown): { b64_json?: unknown; url?: unknown } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  // 顶层直接给一个地址的服务也见过
  if (typeof o.url === 'string') return { url: o.url };
  for (const key of ['data', 'images', 'output', 'outputs', 'result']) {
    const list = o[key];
    if (!Array.isArray(list) || !list.length) continue;
    const first = list[0];
    if (typeof first === 'string') return /^https?:\/\//.test(first) ? { url: first } : undefined;
    if (first && typeof first === 'object') return first as { b64_json?: unknown; url?: unknown };
  }
  return undefined;
}

/**
 * 按文件头认图片格式。认不出返回 null。
 *
 * 只认这四种：这个功能产出的就是这四种，别的一律当 PNG 处理 —— 反正后面要交给宿主，
 * 猜错扩展名比认不出来更糟。
 */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}

/**
 * 从错误响应里捞一句人能看懂的。
 *
 * 各家的错误结构不一样：OpenAI 是 `{error:{message}}`，方舟是 `{error:{message}}` 或
 * `{message}`，还有的只回一行纯文本。**捞不到就不啰嗦**，别把整段 JSON 塞进日志。
 */
async function readError(res: Response): Promise<string> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 800);
  } catch {
    return '';
  }
  try {
    const o = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const msg = typeof o.error === 'object' && o.error ? o.error.message : o.message ?? o.error;
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 200);
  } catch { /* 不是 JSON，按纯文本处理 */ }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}
