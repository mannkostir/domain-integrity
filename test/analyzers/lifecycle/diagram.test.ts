import { describe, expect, it } from 'vitest';
import { fieldDiagram, lifecycleDiagrams } from '../../../src/analyzers/lifecycle/diagram';
import { aggregate, assigned, declared, DECLARED_ORDER, known, method, stateField, STATUS, unknownSources } from '../../helpers/model';

describe('fieldDiagram', () => {
  it('draws states, transitions, drift, leaks and terminal markers', () => {
    expect(fieldDiagram(DECLARED_ORDER, STATUS)).toBe(
      [
        'stateDiagram-v2',
        '  state "pending" as status_0',
        '  state "confirmed" as status_1',
        '  state "cancelled" as status_2',
        '  [*] --> status_0',
        '  status_0 --> status_1 : confirm',
        '  status_0 --> status_2 : cancel',
        '  status_1 --> status_2 : cancel ⚠ undeclared',
        '  status_2 --> status_2 : cancel ⚠ leak',
        '  status_2 --> [*]',
        '  classDef terminal font-weight:bold',
        '  classDef leak fill:#fde2e2,stroke:#c0392b',
        '  class status_2 leak',
      ].join('\n'),
    );
  });
});

describe('fieldDiagram edge cases', () => {
  it('escapes mermaid control characters in state labels', () => {
    const kind = stateField('kind', 'union', ['a"b#c;d']);
    const model = aggregate({ fields: [kind], declarations: new Map([['kind', declared([])]]), initial: new Map() });
    expect(fieldDiagram(model, kind)).toContain('  state "a#quot;b#35;c#59;d" as kind_0');
  });

  it('notes methods whose guard is not analysed and draws no edge for them', () => {
    const model = aggregate({
      declarations: new Map([['status', declared([])]]),
      methods: [method('confirm', true, { status: { sources: unknownSources, sets: assigned('CONFIRMED') } })],
    });
    expect(fieldDiagram(model, STATUS)).toContain('  note right of status_0 : guard not analysed: confirm');
    expect(fieldDiagram(model, STATUS)).not.toContain('status_0 --> status_1');
  });

  it('draws a self-loop leak for a method that sets nothing from a terminal state', () => {
    const model = aggregate({
      methods: [method('touch', true, { status: { sources: known('CANCELLED'), sets: assigned() } })],
    });
    expect(fieldDiagram(model, STATUS)).toContain('  status_2 --> status_2 : touch ⚠ leak');
  });

  it('does not mark a leak for methods allowed after terminal', () => {
    const model = aggregate({
      allowAfterTerminal: new Set(['touch']),
      methods: [method('touch', true, { status: { sources: known('CANCELLED'), sets: assigned() } })],
    });
    const diagram = fieldDiagram(model, STATUS);
    expect(diagram).not.toContain('⚠ leak');
    expect(diagram).toContain('  class status_2 terminal');
  });

  it('does not mark a leak for methods allowed after terminal on that field', () => {
    const model = aggregate({
      declarations: new Map([['status', declared(['CANCELLED'], undefined, ['touch'])]]),
      methods: [method('touch', true, { status: { sources: known('CANCELLED'), sets: assigned('PENDING') } })],
    });
    expect(fieldDiagram(model, STATUS)).toContain('  status_2 --> status_0 : touch\n');
  });
});

describe('lifecycleDiagrams', () => {
  it('wraps each declared field in a titled mermaid block', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER], problems: [] }, undefined)).toBe(
      `## Order.status\n\n\`\`\`mermaid\n${fieldDiagram(DECLARED_ORDER, STATUS)}\n\`\`\``,
    );
  });

  it('returns an empty string when the named aggregate is not declared', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER], problems: [] }, 'Payment')).toBe('');
  });

  it('skips a field that has no declaration', () => {
    const model = aggregate({ declarations: new Map() });
    expect(lifecycleDiagrams({ aggregates: [model], problems: [] }, undefined)).toBe('');
  });
});
