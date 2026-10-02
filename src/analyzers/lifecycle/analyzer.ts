import { Analyzer } from '../../analyzer';
import { LIFECYCLE_RULES, runChecks } from './checks';
import { lifecycleDiagrams } from './diagram';
import { extractLifecycles } from './extract';
import { LifecycleModel } from './model';
import { LifecycleSuggestion, suggestLifecycles } from './suggest';
import { lifecycleSummary } from './summary';

export const lifecycleAnalyzer: Analyzer<LifecycleModel, LifecycleSuggestion> = {
  id: 'lifecycle',
  rules: LIFECYCLE_RULES,
  extract: extractLifecycles,
  problems: (model) => model.problems,
  suggest: suggestLifecycles,
  check: runChecks,
  diagram: lifecycleDiagrams,
  summarize: lifecycleSummary,
  isEmpty: (model) => model.aggregates.length === 0,
};
