import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks/rules';
import { LIFECYCLE_RULES } from '../../src/analyzers/lifecycle/checks/rules';

export const ALL_RULES = [...LIFECYCLE_RULES, ...EVENT_FLOW_RULES];
