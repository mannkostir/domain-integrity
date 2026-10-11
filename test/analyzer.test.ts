import { describe, expect, it } from 'vitest';
import { AnalysisInput, Analyzer, analyse } from '../src/analyzer';
import { DEFAULT_DECLARATION } from '../src/engine/declaration';

const INPUT: AnalysisInput = { declaration: DEFAULT_DECLARATION, files: [], root: '/' };

const BOOM = new Error('boom');

const fail = (): never => {
  throw BOOM;
};

const healthy: Analyzer<string, never> = {
  id: 'fake',
  rules: [{ id: 'fake-rule', description: 'a fake rule' }],
  extract: () => 'model',
  problems: (model) => [`problem in ${model}`],
  suggest: () => [],
  check: () => [],
  diagram: (model) => ({ kind: 'diagram', text: `diagram of ${model}` }),
  summarize: (model, root) => `summary of ${model} at ${root}`,
  isEmpty: () => true,
};

const FAILURE = { kind: 'failed', analyzer: 'fake', error: BOOM };

describe('analyse', () => {
  it('keeps the results of a healthy analyzer', () => {
    const result = analyse(healthy, INPUT);

    expect({ problems: result.problems, findings: result.findings, isEmpty: result.isEmpty, failures: result.failures }).toEqual({
      problems: ['problem in model'],
      findings: [],
      isEmpty: true,
      failures: [],
    });
  });

  it('returns the diagram of a healthy analyzer', () => {
    expect(analyse(healthy, INPUT).diagram(undefined)).toEqual({ kind: 'diagram', text: 'diagram of model' });
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

  it('treats a failed analyzer as not empty', () => {
    expect(analyse({ ...healthy, isEmpty: fail }, INPUT).isEmpty).toBe(false);
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
