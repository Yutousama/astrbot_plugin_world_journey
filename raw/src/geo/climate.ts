/**
 * 气候档案：她去一个地方**对她而言**是什么感觉。
 *
 * ## 为什么要有这一层
 *
 * 城市表里有经纬度，能算出距离、时区、日出——但**算不出「她受不受得了」**。
 * 兰州的鱼到了南宁，问题不是「今天几度」，是「衣服贴在身上一整天没干过，
 * 跟家里那种干完全是两回事」。这件事必须有人显式写下来。
 *
 * 而且这不是写在提示词里的形容词，是**事实**：它要同时影响
 * ① 她挑地方时的倾向（不习惯的地方去得少一些，但不是不去）
 * ② 到达时收到的体感（这样她说的话才有依据）
 *
 * ## 关键：以「家」为基准，不硬编码兰州
 *
 * 用户可以把出发地改成任何城市。所以这里只定义**档案**和**两地的反差**，
 * 「她是哪儿的鱼」由 `homeCity` 现算 —— 家永远是舒适基准 1.0。
 */
import type { City } from './cities.ts';

/**
 * 气候档。
 *
 * 分这么细是因为**体感差别真的很大**：干冷和湿冷在温度上可能一样，
 * 对一条西北来的鱼完全是两件事。
 */
export type Climate =
  /** 干温：西北。兰州、银川、西宁、敦煌、乌鲁木齐 —— 干、温差大、海拔中高。她的家。 */
  | 'dry-mild'
  /** 干冷：内蒙、东北西部。干，但冷得硬。 */
  | 'dry-cold'
  /** 高原：拉萨、香格里拉、九寨沟。空气薄，走两步就要停。 */
  | 'plateau'
  /** 严寒：漠河、哈尔滨。不是冷不冷的问题，是能不能在外面站着。 */
  | 'cold'
  /** 温带：华北、山东、中原。四季分明，不极端。 */
  | 'temperate'
  /** 湿温：江南、川渝、两湖、贵州。潮，冬天阴冷。 */
  | 'humid-mild'
  /** 湿热：华南、福建、港澳。热而且是湿的热。 */
  | 'humid-hot'
  /** 热带：海南、东南亚、云南南端。全年一个温度。 */
  | 'tropical';

/**
 * 省份 → 气候档。
 *
 * 用省份推而不是逐城市标，是因为**同一个省的气候通常是一个档**，
 * 而逐城市标 100 个既费事又容易标错。下面再用 tags 做修正
 * （青海的格尔木是干区，不是高原；云南的西双版纳是热带，不是湿温）。
 */
const REGION_CLIMATE: Record<string, Climate> = {
  甘肃: 'dry-mild', 宁夏: 'dry-mild', 新疆: 'dry-mild', 陕西: 'temperate',
  青海: 'plateau', 西藏: 'plateau',
  内蒙古: 'dry-cold', 吉林: 'cold', 黑龙江: 'cold',
  辽宁: 'temperate', 北京: 'temperate', 天津: 'temperate', 河北: 'temperate',
  山西: 'temperate', 山东: 'temperate', 河南: 'temperate',
  上海: 'humid-mild', 江苏: 'humid-mild', 浙江: 'humid-mild', 安徽: 'humid-mild',
  湖北: 'humid-mild', 湖南: 'humid-mild', 江西: 'humid-mild',
  四川: 'humid-mild', 重庆: 'humid-mild', 贵州: 'humid-mild',
  福建: 'humid-hot', 广东: 'humid-hot', 广西: 'humid-hot',
  云南: 'humid-mild',
  海南: 'tropical',
  中国香港: 'humid-hot', 中国澳门: 'humid-hot', 中国台湾: 'humid-hot',
  日本: 'humid-mild', 韩国: 'temperate',
  泰国: 'tropical', 新加坡: 'tropical', 越南: 'tropical',
  法国: 'temperate', 英国: 'temperate', 意大利: 'temperate',
  俄罗斯: 'cold', 美国: 'temperate', 澳大利亚: 'temperate',
  新西兰: 'temperate', 阿联酋: 'dry-mild', 土耳其: 'temperate',
};

/**
 * ISO 国家码 → 气候档。
 *
 * **国外城市的 `region` 是两位国家码，不是中文名** —— `F()` 构造时直接把
 * `country` 塞进了 `region`（`F('tokyo', '东京', 'JP', ...)`）。
 * 2026-10-31 抽查体感时发现曼谷、东京全被判成「温带」，
 * 因为 `REGION_CLIMATE['泰国']` 永远匹配不到 `'TH'`。
 */
const COUNTRY_CLIMATE: Record<string, Climate> = {
  CN: 'temperate',      // 兜底；国内靠下面更细的省份表
  JP: 'humid-mild', KR: 'temperate',
  TH: 'tropical', SG: 'tropical', VN: 'tropical',
  FR: 'temperate', GB: 'temperate', IT: 'temperate', TR: 'temperate',
  RU: 'cold',
  US: 'temperate', AU: 'temperate', NZ: 'temperate',
  AE: 'dry-mild',
  /*
   * 2026-11-01 加的三城带出来的：巴西不在表里，里约一路兜底成「温带」。
   * 里约是湿热（夏天三十几度、湿度常年七成以上），判成温带的话，
   * 从兰州过去的第一句体感就会说错。
   */
  BR: 'humid-hot',
  /*
   * 2026-11-01 第二批：阿根廷、加拿大、墨西哥。
   * 加拿大给 temperate 而不是 cold —— 温哥华冬天零上，多伦多和蒙特利尔靠「雪」这个 tag
   * 单独判冷；一刀切给 cold 会把温哥华写成零下二十度。
   * 墨西哥给 tropical 兜底（坎昆、梅里达），墨西哥城和瓜纳华托靠「高原」tag 抬走。
   */
  AR: 'temperate', CA: 'temperate', MX: 'tropical',
};

/**
 * tags 里的气候修正。**优先级高于省份**。
 *
 * 省份只能给一个大概，真正决定体感的是地形：格尔木在青海但是戈壁，
 * 西双版纳在云南但是热带，九寨沟在四川但是高原（海拔 2000+）。
 *
 * ## 顺序是按「体感主导度」排的，不是随便写的
 *
 * **干湿排在海拔前面**，因为对一个从兰州（1500 米）出发的人来说，
 * 「干不干」几乎立刻能感觉到，而「高原反应」是她本来就习惯的事 —— 除非海拔差得远。
 * 格尔木同时有 `戈壁` 和 `高原`，判成干温比判成高原更贴近她真实的感受
 * （「干，跟家里一个味道」而不是「走两步就得停」）。
 *
 * 冷和热排在更前面，因为它们是最极端的：三亚的「热」压过一切，
 * 漠河的「冷」压过一切。
 */
const TAG_CLIMATE: readonly { tag: string; climate: Climate }[] = [
  // 极端温度优先
  { tag: '极北', climate: 'cold' },
  /*
   * `雪` 这个 tag 一直没有规则，于是札幌被判成「湿温」—— 它冬天零下十度是常态。
   * 加上之后受影响的只有札幌：长春、漠河、莫斯科本来就靠别的规则判成了 cold。
   */
  { tag: '雪', climate: 'cold' },
  // 巴塔哥尼亚那两座（乌斯怀亚、埃尔卡拉法特）：靠「冰川」和「极南」判冷，南半球夏天也冷
  { tag: '冰川', climate: 'cold' },
  { tag: '极南', climate: 'cold' },
  { tag: '极夜', climate: 'cold' },
  { tag: '冰雕', climate: 'cold' },
  { tag: '热带', climate: 'tropical' },
  { tag: '雨林', climate: 'tropical' },
  { tag: '椰', climate: 'tropical' },
  { tag: '湿热', climate: 'humid-hot' },
  { tag: '骑楼', climate: 'humid-hot' },
  // 干湿其次
  { tag: '戈壁', climate: 'dry-mild' },
  { tag: '沙漠', climate: 'dry-mild' },
  { tag: '西北', climate: 'dry-mild' },
  { tag: '河西走廊', climate: 'dry-mild' },
  { tag: '黄土', climate: 'dry-mild' },
  // 海拔最后 —— 兰州人本来就住在 1500 米
  { tag: '高原', climate: 'plateau' },
  { tag: '进藏', climate: 'plateau' },
  { tag: '雪山', climate: 'plateau' },
];

/** 判一个城市的气候档。tags 优先，其次省份，最后给个温带兜底。 */
export function climateOf(city: City): Climate {
  for (const rule of TAG_CLIMATE) {
    if (city.tags.includes(rule.tag)) return rule.climate;
  }
  // region 是国内省份的中文名，国外是 ISO 国家码，两张表都查。
  return REGION_CLIMATE[city.region] ?? COUNTRY_CLIMATE[city.country] ?? 'temperate';
}

/**
 * 两地气候的「合不合胃口」，0～1。同一个档 = 1。
 *
 * ## 为什么最低给 0.45，不给 0
 *
 * 半年在外面，本来就是要见识不一样的地方。把湿热压到零，她会在西北转半年 ——
 * 那不是「习惯」，那是没出过门。**不习惯的表现应该是「去了以后难受、说得出来」，
 * 不是「永远不去」。** 所以这里是**倾向**，不是门槛。
 *
 * 数值是手调的，参照：
 * - 干温 → 高原：0.75。都是干，但海拔一下拔上去，身体要先适应
 * - 干温 → 湿温：0.60。潮，潮得陌生
 * - 干温 → 湿热：0.45。完全另一套体感
 * - 干温 → 严寒：0.50。她习惯干冷，但东北那种冷是另一个量级
 */
const AFFINITY: Record<Climate, Record<Climate, number>> = {
  'dry-mild': {
    'dry-mild': 1.00, 'dry-cold': 0.85, plateau: 0.75, cold: 0.50,
    temperate: 0.90, 'humid-mild': 0.60, 'humid-hot': 0.45, tropical: 0.42,
  },
  'dry-cold': {
    'dry-mild': 0.85, 'dry-cold': 1.00, plateau: 0.70, cold: 0.80,
    temperate: 0.85, 'humid-mild': 0.55, 'humid-hot': 0.42, tropical: 0.38,
  },
  plateau: {
    'dry-mild': 0.75, 'dry-cold': 0.70, plateau: 1.00, cold: 0.55,
    temperate: 0.80, 'humid-mild': 0.55, 'humid-hot': 0.42, tropical: 0.40,
  },
  cold: {
    'dry-mild': 0.50, 'dry-cold': 0.80, plateau: 0.55, cold: 1.00,
    temperate: 0.75, 'humid-mild': 0.60, 'humid-hot': 0.50, tropical: 0.45,
  },
  temperate: {
    'dry-mild': 0.90, 'dry-cold': 0.85, plateau: 0.80, cold: 0.75,
    temperate: 1.00, 'humid-mild': 0.85, 'humid-hot': 0.65, tropical: 0.60,
  },
  'humid-mild': {
    'dry-mild': 0.60, 'dry-cold': 0.55, plateau: 0.55, cold: 0.60,
    temperate: 0.85, 'humid-mild': 1.00, 'humid-hot': 0.80, tropical: 0.72,
  },
  'humid-hot': {
    'dry-mild': 0.45, 'dry-cold': 0.42, plateau: 0.42, cold: 0.50,
    temperate: 0.65, 'humid-mild': 0.80, 'humid-hot': 1.00, tropical: 0.90,
  },
  tropical: {
    'dry-mild': 0.42, 'dry-cold': 0.38, plateau: 0.40, cold: 0.45,
    temperate: 0.60, 'humid-mild': 0.72, 'humid-hot': 0.90, tropical: 1.00,
  },
};

/** 两个气候档之间的适配度。对称。 */
export function affinity(a: Climate, b: Climate): number {
  return AFFINITY[a]?.[b] ?? 0.6;
}

/**
 * 地形那一句。**只取家那边没有的东西**。
 *
 * 兰州有黄河、有山、有戈壁，所以「四周是坡」「土是黄的」对兰州人来说不算新鲜 ——
 * 那些交给气候层去说（干、温差）。这里只留**她真的会觉得不一样的**：
 * 海、草原、比自己家高的地方。
 *
 * 2026-10-31 删掉旧的 `arrivalSense` 时把这一层一起丢了，结果兰州到烟台只会说
 * 「不冷不热，没什么特别」—— 而海风才是那趟旅程的第一反应。
 */
function terrainLine(to: City): string {
  const t = to.tags;
  const has = (x: string): boolean => t.includes(x);
  if (has('海') || has('海岛') || has('小岛') || has('港口') || has('海港')) {
    return '空气里有咸味，风比内陆大得多。';
  }
  if (has('草原')) return '视野一下展开，天比刚才大。';
  // 高原不在这里说 —— `climateLine` 的 plateau 分支已经讲了海拔，
  // 两边都说会拼出「走两步就得停…比家里高出不少，走两步就得停」。
  return '';
}

/** 气候那一段。「没什么特别」的那种是给下面判重用的。 */
const BLAND = '不冷不热，也没什么特别的，就是那种什么地方都有的天气。';

/**
 * 一座城市的气候**本身**是什么样。不跟谁比。
 *
 * 和 `climateLine` 的分工：那个回答「跟家比怎么样」（句子里全是「跟家里…」），
 * 这个回答「这儿本来是什么样」。「家」和「就在家里」这两种场景**只能**用它 ——
 * 拿 `climateLine` 去描述家本身，会得到「广州：潮热，跟家里那种干完全不一样」
 * 这种鬼话（广州人家里的干是哪儿来的）。
 *
 * 2026-10-31 由 Mr.Q 一句「我的鱼是兰州的没错，别人的不是啊」牵出来的：
 * 提示词里写死「你是兰州的鱼」，而代码一直是以家为基准算的。
 */
export function climateOfCity(c: City): string {
  switch (climateOf(c)) {
    case 'dry-mild': return '干爽，风是干净的，嘴唇不黏，晾出去的衣服两小时就干。';
    case 'dry-cold': return '干冷，风硬，冬天长，但那种冷不往骨头里钻。';
    case 'plateau': return '地势高，空气薄，日头毒，早晚温差大。';
    case 'cold': return '冷得实在，冬天出门得下决心。';
    case 'temperate': return '四季分明但不折腾人，一年里难熬的日子不多。';
    case 'humid-mild': return '潮，被子和晾在外面的衣服总是半干不干。';
    case 'humid-hot': return '又热又潮，出门五分钟衣服就贴在背上。';
    case 'tropical': return '热是贴着皮肤的，夜里也不退，空气里一直有水汽味。';
    default: return '';
  }
}

/**
 * 到达时的体感。**以「家」为参照**，不写中性地理描述。
 *
 * 判据：一个从兰州出发的人，落到南宁和落到银川，身体的第一反应完全不同。
 * 只说「一出站衣服就贴在背上」是气象播报；说「这儿的潮跟家里那种干不是一个东西，
 * 衣服黏在身上，一天都没干过」才是她的感受。
 *
 * 返回空串表示没什么可说的（同档气候，不用每次都提）。
 */
export function bodyFeeling(to: City, home: City): string {
  // **她就在家里**：这时候「跟家里比」是废话，「跟家里那种干不一样」更是胡说。
  // 走到这个分支说明调用方想问「家本身什么样」—— 那就答本地气候，不做比较。
  if (to.id === home.id) return climateOfCity(to);

  const climate = climateLine(to, home);
  const terrain = terrainLine(to);
  // 地形是更直接的第一反应。气候那句如果只是「没什么特别」，就让位给地形 ——
  // 两个都说会把这一行撑成一段，而她只需要说一句。
  if (terrain && (!climate || climate === BLAND)) return terrain;
  if (terrain) return `${terrain}${climate}`;
  return climate;
}

/** 气候那一段。和地形分开，是为了让 `bodyFeeling` 能挑着拼。 */
function climateLine(to: City, home: City): string {
  const a = climateOf(home);
  const b = climateOf(to);
  const same = a === b;

  switch (b) {
    case 'dry-mild':
      return same
        ? '干，跟家里一个味道，一下就习惯了。'
        : '一下车就觉得干得舒服：风是干的，嘴唇不黏，跟家里一个路数。';
    case 'dry-cold':
      return '干冷。风吹在脸上是硬的，但不是那种往骨头里钻的冷。';
    case 'plateau':
      // 家里本来就在 1500 米上下，所以这里的关键不是「缺氧」而是「比家还高」。
      return a === 'plateau'
        ? '海拔跟家里差不多，走起来不费劲。'
        : '比家里高出不少，走两步就得停一下，脑袋有点空。';
    case 'cold':
      return '冷得不像话。吸一口气鼻腔里就疼，站五分钟手指头就不听话了。';
    case 'temperate':
      return same ? '' : BLAND;
    case 'humid-mild':
      return '潮。被子摸上去是凉的，晾在外面的衣服一天也干不透。';
    case 'humid-hot':
      return same
        // 原来这条写的是「跟家里那种干完全不一样」—— 那是**从干地方来的人**才成立的句子，
        // 却被放进了「气候档相同」的分支里。广州人去深圳会听到这句，然后「家里的干」是哪来的。
        ? '潮热，跟家里一个味道，一出门衣服照样往背上贴。'
        : '一出门衣服就贴在身上，汗出不来。这儿的潮跟家里的干是两回事，一整天都黏着。';
    case 'tropical':
      return '热是贴着皮肤的那种热，晚上也不退。空气里一直有水汽的味道。';
    default:
      return '';
  }
}
