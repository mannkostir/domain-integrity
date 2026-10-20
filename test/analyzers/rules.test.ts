import { describe, expect, it } from 'vitest';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks/rules';
import { LIFECYCLE_RULES } from '../../src/analyzers/lifecycle/checks/rules';

const ALL_RULES = [...LIFECYCLE_RULES, ...EVENT_FLOW_RULES];

describe('rule list', () => {
  it('gives every rule a distinct id across analyzers', () => {
    const ids = ALL_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports transition-missing as a warning', () => {
    const rule = ALL_RULES.find((candidate) => candidate.id === 'transition-missing');

    expect(rule?.severity).toBe('warning');
  });

  it('reports every other rule as an error', () => {
    const others = ALL_RULES.filter((rule) => rule.id !== 'transition-missing');

    expect(new Set(others.map((rule) => rule.severity))).toEqual(new Set(['error']));
  });
});
