import type { WorldDefinition } from 'cortico/world.ts';
import { JOURNEY_DEFAULTS, JOURNEY_ID, type JourneyConfigSection } from './config.ts';
import { JOURNEY_DESCRIBE, JourneyWorld } from './world.ts';

export const JOURNEY: WorldDefinition<JourneyConfigSection> = {
  id: JOURNEY_ID,
  label: '大肥鱼环游世界',
  defaults: () => structuredClone(JOURNEY_DEFAULTS()),
  // cfg 是**活引用**，不要展开成 {...ctx.cfg} —— 展开了热改就不生效了。
  create: (ctx) => new JourneyWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    botName: ctx.botName,
    // 密钥走宿主那两个口子（写 botDir/.env，0600），不留在 config.json 里。
    keys: {
      read: (name) => ctx.secret(name),
      write: (name, value) => ctx.storeSecret(name, value),
    },
    // 搬完之后要把配置里那份清掉，否则重启一次 key 又回到 config.json。
    persist: (patch) => ctx.persist(patch),
  }),
  describe: JOURNEY_DESCRIBE,
};
