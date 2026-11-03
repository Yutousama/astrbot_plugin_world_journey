/**
 * 圣地巡礼 —— 哪些真地方在哪些作品里出现过。
 *
 * ## 为什么单独一个文件，而不是塞进 `cities.ts` 的 tags
 *
 * `tags` 是「这座城什么路数」（山、海、古城），给挑目的地用；
 * 巡礼是**一处具体地方的另一个身份**（清水寺，同时是某部剧场版的片尾舞台）。
 * 两者的生命周期完全不同：城市表一年动不了几次，巡礼清单可以一批一批往里加。
 * 塞在一起，加一条巡礼就得动城市的构造参数。
 *
 * ## 铁律：宁可空着，不许编
 *
 * 这个扩展在提示词里写死了一条「不许编不存在的地方」。巡礼是**加倍**适用 ——
 * 说错一处，用户是拿着手机站在那儿对照的人，一眼就看出来。
 * 所以这里只收两类：
 *   1. 官方或公开资料里明确说过以该地为舞台的（动画的「舞台探访」是业界惯例）；
 *   2. 有实拍记录的影视作品。
 *
 * **没把握的一律留空。** 札幌、里约这次就是空的 —— 雪祭和基督山都够出名，
 * 但「哪部作品确实在这儿取景」我没有能站住的答案，那就一个字都不写。
 * 空着不影响任何东西，最多是她在札幌不提这一嘴。
 *
 * ## 一个地点可以挂多部作品
 *
 * 鸭川同时是《四叠半》和《玉子市场》的舞台，这两条都是真的，
 * 而且说的不是同一段河岸 —— 所以 `works` 是数组，不是单个。
 */

export interface PilgrimWork {
  /** 作品名。中文名优先，用户认这个。 */
  readonly title: string;
  /**
   * 一句话说清「这个场景在作品里是干什么的」。
   *
   * **不要写成「著名取景地」这种空话** —— 她照这个说话，
   * 说了等于没说，还会暴露是查表查出来的。
   */
  readonly scene: string;
}

export interface Pilgrim {
  /** 城市 id，和 `CITIES` 里的 id 一致。 */
  readonly cityId: string;
  /**
   * 地点名，**必须和该城 `spots` 里的名字一字不差**。
   *
   * 对不上就永远不会触发 —— `test/journey.test.mjs` 里有一条守着这件事，
   * 改了景点名忘了改这儿，测试会红。
   */
  readonly spot: string;
  readonly works: readonly PilgrimWork[];
}

export const PILGRIMS: readonly Pilgrim[] = [
  /* ---------------- 京都 ---------------- */
  {
    cityId: 'kyoto',
    spot: '清水寺',
    works: [{
      title: '名侦探柯南 迷宫的十字路',
      scene: '片尾那场就在清水寺的舞台上，整部剧场版的舞台都是京都',
    }],
  },
  {
    cityId: 'kyoto',
    spot: '伏见稻荷大社',
    works: [{
      title: '稻荷恋之歌',
      scene: '整部动画的舞台就是伏见，千本鸟居在片头反复出现',
    }],
  },
  {
    cityId: 'kyoto',
    spot: '鸭川',
    works: [
      {
        title: '四叠半神话大系',
        scene: '鸭川三角洲是「我」和明石碰头的地方，全剧来来回回都在这段河岸上',
      },
      {
        title: '玉子市场',
        scene: '鸭川边上的出町桝形商店街，就是动画里那条商店街的原型',
      },
    ],
  },

  /* ---------------- 东京 ---------------- */
  {
    cityId: 'tokyo',
    spot: '涩谷',
    works: [{
      title: '咒术回战',
      scene: '涩谷事变整场就打在这一带，动画里那几个路口和站口都能对上',
    }],
  },

  /* ---------------- 罗马 ---------------- */
  {
    cityId: 'rome',
    spot: '许愿池',
    works: [{
      title: '罗马假日',
      scene: '安妮公主在附近那家理发店剪的头发，出来就路过这儿',
    }],
  },
  {
    cityId: 'rome',
    spot: '西班牙台阶',
    works: [{
      title: '罗马假日',
      scene: '公主坐在台阶上吃冰淇淋那一场',
    }],
  },
  {
    cityId: 'rome',
    spot: '斗兽场',
    works: [{
      title: '罗马假日',
      scene: '两个人骑着车经过的最后几个外景之一',
    }],
  },

  /* ---------------- 巴黎 ---------------- */
  {
    cityId: 'paris',
    spot: '蒙马特',
    works: [{
      title: '天使爱美丽',
      scene: '她打工的那家双风车咖啡馆就在这条街上，片子大半个故事没离开过这一片',
    }],
  },
  {
    cityId: 'paris',
    spot: '卢浮宫',
    works: [{
      title: '达芬奇密码',
      scene: '兰登半夜在馆里跑的那一大段',
    }],
  },

  /* ---------------- 纽约 ---------------- */
  {
    cityId: 'newyork',
    spot: '帝国大厦',
    works: [{
      title: '西雅图不眠夜',
      scene: '片尾两个人在观景台上见的那一面',
    }],
  },
];

const KEY = (cityId: string, spot: string): string => `${cityId}\u0000${spot}`;

const BY_SPOT = new Map(PILGRIMS.map((p) => [KEY(p.cityId, p.spot), p]));

/** 这个城市的这一处，有没有作品挂得上。没有返回 null。 */
export function pilgrimAt(cityId: string, spot: string): Pilgrim | null {
  return BY_SPOT.get(KEY(cityId, spot)) ?? null;
}

/**
 * 这座城市里所有挂得上的巡礼点。
 *
 * 给「这趟会经过哪些作品的取景地」用 —— 到时候按行程挑出真排上的那几条。
 */
export function pilgrimsOf(cityId: string): readonly Pilgrim[] {
  return PILGRIMS.filter((p) => p.cityId === cityId);
}

/**
 * 一句话版本，给提示词用。
 *
 * 写成 `《四叠半神话大系》—— 鸭川三角洲是…` 这个形状，
 * 是为了让她**照着念也像话**，而不是拿到一堆字段自己拼。
 */
export function pilgrimLine(p: Pilgrim): string {
  const parts = p.works.map((w) => `《${w.title}》：${w.scene}`);
  return `${p.spot} —— ${parts.join('；')}`;
}
