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
  }),
  describe: JOURNEY_DESCRIBE,
};
