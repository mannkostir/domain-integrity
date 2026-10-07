import { Analyzer, EventFlowFinding } from '../../analyzer';
import { EVENT_FLOW_RULES, runEventFlowChecks } from './checks';
import { sagaProblems } from './checks/saga-missing-failure-path';
import { eventFlowDiagram } from './diagram';
import { extractEventFlows } from './extract';
import { EventFlowModel } from './model';
import { eventFlowSummary } from './summary';

export const eventFlowAnalyzer: Analyzer<EventFlowModel, never, EventFlowFinding> = {
  id: 'event-flow',
  rules: EVENT_FLOW_RULES,
  extract: extractEventFlows,
  problems: (model) => [...model.problems, ...sagaProblems(model)],
  suggest: () => [],
  check: runEventFlowChecks,
  diagram: eventFlowDiagram,
  summarize: eventFlowSummary,
  isEmpty: (model) => model.registrations.length === 0 && model.inProcess.length === 0 && model.sagas.length === 0 && model.buffers.length === 0,
};
