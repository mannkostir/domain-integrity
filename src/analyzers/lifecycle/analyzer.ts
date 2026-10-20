import { Analyzer, CheckScope } from '../../analyzer';
import { LifecycleFinding } from '../../finding';
import { LIFECYCLE_RULES, runChecks } from './checks';
import { lifecycleDiagrams } from './diagram';
import { extractLifecycles } from './extract';
import { LifecycleModel } from './model';
import { LifecycleSuggestion, suggestLifecycles } from './suggest';
import { lifecycleSummary } from './summary';

const lifecycleScope = (model: LifecycleModel): CheckScope => {
  if (model.aggregates.length === 0) return 'nothing-found';
  return model.aggregates.some((aggregate) => aggregate.declared) ? 'checkable' : 'nothing-declared';
};

export const lifecycleAnalyzer: Analyzer<LifecycleModel, LifecycleSuggestion, LifecycleFinding> = {
  id: 'lifecycle',
  rules: LIFECYCLE_RULES,
  extract: extractLifecycles,
  problems: (model) => model.problems,
  suggest: suggestLifecycles,
  check: runChecks,
  diagram: lifecycleDiagrams,
  summarize: lifecycleSummary,
  scope: lifecycleScope,
};
