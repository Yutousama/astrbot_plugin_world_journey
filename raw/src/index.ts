/** 包入口：默认导出 WorldDefinition，装载器按 `cortico.kind === 'world'` 认它。 */
import { JOURNEY } from './definition.ts';

export default JOURNEY;
export { JOURNEY };
export { JourneyWorld, JOURNEY_DESCRIBE } from './world.ts';
export { JOURNEY_DEFAULTS, JOURNEY_ID, journeyConfigGroups, type JourneyConfigSection } from './config.ts';
