/**
 * 两个第三方密钥：高德地图、生图服务商。
 *
 * ## 为什么不能留在 `config.json`
 *
 * `config.json` 是**给人看、给人改、给人备份**的文件：设置页要读整段、
 * 换机器要拷过去、出问题要贴出来问。密钥放在里面，等于每一次备份、
 * 每一次截图、每一个「帮我看看配置」都把 key 一起送出去。
 *
 * 宿主的 `ctx.storeSecret()` 是另一条路：写进部署目录的 `.env`，
 * 落盘用 0600（只有本人可读）+ 原子替换，不进任何配置接口。
 * 读回来用 `ctx.secret()` —— 这个**每次现读文件**，重启也在，
 * 不会因为只在 `process.env` 里留过一份就丢。
 *
 * ## 老用户怎么搬
 *
 * 已经在 `config.json` 里填过的，不动手也得能用。所以第一次跑到这里时
 * 自动搬：读到配置里有值 → 写进 `.env` → **确认写进去了** → 再把配置清空。
 *
 * 那个「确认」不是多余的：宿主试挂载（dry-mount）时给的 `storeSecret` 是空实现，
 * 写了等于没写。不确认就清配置，等于把用户的 key 抹掉 —— 比不搬糟得多。
 */
/**
 * 宿主给的那两个口子。都是可选的：**测试里没有宿主**，
 * 不传的时候读取只剩配置项、写入直接放弃。
 */
export interface KeyPorts {
  read?(name: string): string;
  write?(name: string, value: string): void;
}

export interface KeyLog {
  info(msg: string): void;
  warn(msg: string): void;
}

/** `.env` 是整个部署共用的一份，名字必须自己带前缀，不能和别的扩展撞。 */
export const AMAP_KEY_NAME = 'JOURNEY_AMAP_KEY';
export const IMAGE_KEY_NAME = 'JOURNEY_IMAGE_KEY';

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * 读一个密钥：`.env` 优先，配置项兜底。
 *
 * 兜底这一步不能省 —— 用户刚在设置页填完、还没重启的这段时间里，
 * 密钥文件可能还没轮到写，而配置项已经是新值了。
 */
export function readKey(ports: KeyPorts | undefined, name: string, fromConfig: string): string {
  const stored = trimmed(ports?.read?.(name));
  return stored || trimmed(fromConfig);
}

/**
 * 把配置里的旧值搬进密钥文件。返回**配置项现在该是什么**。
 *
 * 返回值是空串 = 搬走了，调用方应该把它写回配置；返回值等于入参 = 没动。
 * 三种情况会「没动」，每一种都不该清配置：
 *
 * - 配置里本来就是空的（没什么可搬）
 * - 密钥文件里已经是同一个值（说明上次搬过、只是没清干净，这次清）
 * - 写失败、或写完读不出来（试挂载的空实现、值里有空白、宿主拒绝）
 */
export function adoptKey(ports: KeyPorts | undefined, name: string, fromConfig: string, log?: KeyLog): string {
  const value = trimmed(fromConfig);
  if (!value) return fromConfig;

  const stored = trimmed(ports?.read?.(name));
  if (stored === value) return '';

  if (!ports?.write) return fromConfig;

  try {
    ports.write(name, value);
  } catch (e) {
    log?.warn(`密钥没能搬进 .env（${e instanceof Error ? e.message : String(e)}），先继续用配置里那份。`);
    return fromConfig;
  }

  /*
   * 回读确认。写成功不等于存下来了 —— 宿主在试挂载时给的是空实现，
   * 它不抛错，只是什么都不做。
   */
  if (trimmed(ports?.read?.(name)) !== value) {
    log?.warn('密钥写进 .env 后读不回来（可能是试挂载），配置里那份先留着。');
    return fromConfig;
  }

  log?.info(`已把 ${name} 收进 .env，配置里那份不再保留。`);
  return '';
}
