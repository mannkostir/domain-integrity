import { describe, expect, it } from 'vitest';
import { AnalysisInput, Analyzer, analyse, reportedUnder } from '../src/analyzer';
import { DEFAULT_DECLARATION } from '../src/engine/declaration';
import { ConfigError } from '../src/engine/errors';
import { LifecycleFinding, Problem } from '../src/finding';

const INPUT: AnalysisInput = { declaration: DEFAULT_DECLARATION, files: [], projectRoot: '/', repositoryRoot: '/' };

const MISSING_FIELD: Problem = {
  code: 'state-field-missing',
  analyzer: 'lifecycle',
  message: 'Order has no field "state"',
  details: { aggregate: 'Order', field: 'state' },
};

const BOOM = new Error('boom');

const fail = (): never => {
  throw BOOM;
};

const healthy: Analyzer<string, never> = {
  id: 'fake',
  rules: [{ id: 'terminal-state-leak', severity: 'error', description: 'a fake rule', explanation: 'E', remedy: 'R' }],
  extract: () => 'model',
  problems: (model) => [{ ...MISSING_FIELD, message: `problem in ${model}` }],
  suggest: () => [],
  check: () => [],
  diagram: (model) => ({ kind: 'diagram', text: `diagram of ${model}`, names: [model] }),
  summarize: (model, root) => `summary of ${model} at ${root}`,
  scope: () => 'nothing-found',
};

const FAILURE = { kind: 'failed', analyzer: 'fake', error: BOOM };

describe('analyse', () => {
  it('rejects a rule whose id the analyzer never reports', () => {
    const lifecycleOnly: Analyzer<string, never, LifecycleFinding> = {
      ...healthy,
      // @ts-expect-error
      rules: [{ id: 'dead-handler', severity: 'error', description: 'an event-flow rule', explanation: 'E', remedy: 'R' }],
      check: () => [],
    };

    expect(lifecycleOnly.rules).toHaveLength(1);
  });

  it('lets a typed user-facing error through', () => {
    const misconfigured: Analyzer<string, never> = {
      ...healthy,
      extract: () => {
        throw new ConfigError('bad config');
      },
    };

    expect(() => analyse(misconfigured, INPUT)).toThrow(ConfigError);
  });

  it('keeps the results of a healthy analyzer', () => {
    const result = analyse(healthy, INPUT);

    expect({ problems: result.problems, findings: result.findings, scope: result.scope, failures: result.failures }).toEqual({
      problems: [{ ...MISSING_FIELD, message: 'problem in model' }],
      findings: [],
      scope: 'nothing-found',
      failures: [],
    });
  });

  it('returns the diagram of a healthy analyzer', () => {
    expect(analyse(healthy, INPUT).diagram(undefined)).toEqual({ kind: 'diagram', text: 'diagram of model', names: ['model'] });
  });

  it('returns the summary of a healthy analyzer', () => {
    expect(analyse(healthy, INPUT).summary('/root')).toEqual({ kind: 'summary', text: 'summary of model at /root' });
  });

  it('reports a failure when extraction throws', () => {
    expect(analyse({ ...healthy, extract: fail }, INPUT).failures).toEqual([FAILURE]);
  });

  it('reports a failure when a check throws', () => {
    expect(analyse({ ...healthy, check: fail }, INPUT).failures).toEqual([FAILURE]);
  });

  it('keeps the rules but drops problems and findings of a failed analyzer', () => {
    const result = analyse({ ...healthy, check: fail }, INPUT);

    expect({ rules: result.rules, problems: result.problems, findings: result.findings }).toEqual({
      rules: healthy.rules,
      problems: [],
      findings: [],
    });
  });

  it('treats a failed analyzer as checkable', () => {
    expect(analyse({ ...healthy, check: fail }, INPUT).scope).toBe('checkable');
  });

  it('reports a failure when computing the scope throws', () => {
    expect(analyse({ ...healthy, scope: fail }, INPUT).failures).toEqual([FAILURE]);
  });

  it('returns the failure as the diagram of a failed analyzer', () => {
    expect(analyse({ ...healthy, problems: fail }, INPUT).diagram(undefined)).toEqual(FAILURE);
  });

  it('returns the failure as the summary of a failed analyzer', () => {
    expect(analyse({ ...healthy, problems: fail }, INPUT).summary('/')).toEqual(FAILURE);
  });

  it('reports a failure when drawing the diagram throws', () => {
    expect(analyse({ ...healthy, diagram: fail }, INPUT).diagram('Ticket')).toEqual(FAILURE);
  });

  it('reports a failure when summarising throws', () => {
    expect(analyse({ ...healthy, summarize: fail }, INPUT).summary('/')).toEqual(FAILURE);
  });
});

describe('reportedUnder', () => {
  it('takes the rule id and severity of a finding from its rule', () => {
    expect(reportedUnder({ id: 'fake-rule', severity: 'warning', description: 'a fake rule', explanation: 'E', remedy: 'R' })).toEqual({ ruleId: 'fake-rule', severity: 'warning' });
  });
});
