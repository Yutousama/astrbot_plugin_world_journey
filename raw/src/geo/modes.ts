/**
 * 十种交通方式 —— 用时模型。
 *
 * ## 设计要点：不写「短途不该坐飞机」这种规则
 *
 * 只给每种方式三个数：巡航速度、固定开销、距离上限。然后让算术自己长出直觉：
 *
 *   兰州 → 西安（约 500 km）
 *     火车  500/120 + 0.8 ≈ 5.0 h
 *     飞机  500/750 + 3.2 ≈ 3.9 h   ← 只快一小时，而折腾程度完全不同
 *     自驾  500/75  + 0.3 ≈ 7.0 h
 *     摩托  500/55  + 0.3 ≈ 9.4 h
 *     步行  超出上限，不可选
 *
 *   兰州 → 巴黎（约 7900 km）
 *     飞机  7900/750 + 3.2 ≈ 13.7 h
 *     其余全部超出上限
 *
 * 短途飞机只快一点点、长途步行根本不存在 —— 这两个结论都是算出来的，
 * 不是写死的。写死规则会在换一对城市时立刻露馅。
 *
 * ## 固定开销不是凑数
 *
 * 它承载的是「这种方式折腾不折腾」：飞机 3.2 小时压的是值机、安检、候机、落地出站；
 * 火车 0.8 小时是进站候车；轮船 2.5 小时是登船、离港、等潮。少了这一项，
 * 短途飞机就会变成永远最快，与现实正相反。
 */

export type ModeId =
  | 'walk' | 'bike' | 'scooter' | 'motorcycle' | 'car'
  | 'bus' | 'train' | 'ship' | 'plane';

export interface TravelMode {
  readonly id: ModeId;
  readonly name: string;
  /** 平均速度 km/h，已经含中途停顿，不要再用「最高时速」。 */
  readonly kmh: number;
  /** 出发前后必须耗掉的固定时间（小时）：候车、安检、登船、取还车。 */
  readonly overhead: number;
  /** 超过这个距离就不该用这种方式。0 = 无上限。 */
  readonly maxKm: number;
  /** 起终点需要的枢纽。`null` = 随处可用。 */
  readonly needs: 'air' | 'rail' | 'port' | null;
  /** 一个人的大致花费档，用来让她在日记里不吹牛。1=几乎不花钱 5=肉疼。 */
  readonly cost: 1 | 2 | 3 | 4 | 5;
  /**
   * 这种方式的体感，**给模型的判断依据，不是台词**。
   * 写成句子她会照念，所以只写特征。
   */
  readonly feel: string;
}

export const MODES: readonly TravelMode[] = [
  {
    id: 'walk', name: '步行', kmh: 4.5, overhead: 0, maxKm: 40, needs: null, cost: 1,
    feel: '最慢，但只有走路才会经过那些没有站的地方；一天走不了多远，适合几公里之内的挪动。',
  },
  {
    id: 'bike', name: '自行车', kmh: 15, overhead: 0.2, maxKm: 150, needs: null, cost: 1,
    feel: '比走路快三倍，风在脸上；上坡会累，下雨会很难受。',
  },
  {
    id: 'scooter', name: '电瓶车', kmh: 22, overhead: 0.2, maxKm: 60, needs: null, cost: 2,
    feel: '城里最快的小东西，但续航是硬限制，跑不远；没电了只能推。',
  },
  {
    id: 'motorcycle', name: '摩托车', kmh: 55, overhead: 0.3, maxKm: 700, needs: null, cost: 3,
    feel: '风噪大、不能分心，跑长途很累但自由，加油就能一直走。',
  },
  {
    id: 'car', name: '自驾', kmh: 75, overhead: 0.3, maxKm: 2500, needs: null, cost: 4,
    feel: '自己掌握节奏，可以随时停下看风景，但长时间开车会困。',
  },
  {
    id: 'bus', name: '长途汽车', kmh: 50, overhead: 0.7, maxKm: 1500, needs: null, cost: 2,
    feel: '站点多、停得勤，坐上就是一整段；车厢里的味道和声音比火车杂。',
  },
  {
    id: 'train', name: '火车', kmh: 120, overhead: 0.8, maxKm: 4000, needs: 'rail', cost: 3,
    feel: '中长途的主力。窗外整片地往后退，能走动、能看人；夜里过站会醒。',
  },
  {
    id: 'ship', name: '轮船', kmh: 28, overhead: 2.5, maxKm: 0, needs: 'port', cost: 4,
    feel: '最慢，但只有它给你水面。江上是两岸，海上是空的；船上的时间过得和岸上不一样。',
  },
  {
    id: 'plane', name: '飞机', kmh: 750, overhead: 3.2, maxKm: 0, needs: 'air', cost: 5,
    feel: '长途唯一的选择，但两头都要折腾三小时；短途用它反而不划算。',
  },
];

const BY_ID = new Map(MODES.map((m) => [m.id, m]));

export function modeById(id: string): TravelMode | null {
  return BY_ID.get(id.trim().toLowerCase() as ModeId) ?? null;
}

/** 这种交通方式这段距离要多久（小时）。**不含**两端去车站的路。 */
export function hoursFor(mode: TravelMode, km: number): number {
  return mode.overhead + km / mode.kmh;
}

/** 这种交通方式能不能用于这段距离。不含枢纽检查 —— 那个要靠城市表，见 picker。 */
export function reachable(mode: TravelMode, km: number): boolean {
  return mode.maxKm === 0 || km <= mode.maxKm;
}
