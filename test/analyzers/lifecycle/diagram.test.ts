import { describe, expect, it } from 'vitest';
import { fieldDiagram, lifecycleDiagrams } from '../../../src/analyzers/lifecycle/diagram';
import { AggregateModel } from '../../../src/analyzers/lifecycle/model';
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

const TICKET_A = aggregate({ id: 'src/a/ticket.ts:Ticket', name: 'Ticket', qualifiedName: 'src/a/ticket.ts:Ticket' });

const TICKET_B = aggregate({ id: 'src/b/ticket.ts:Ticket', name: 'Ticket', qualifiedName: 'src/b/ticket.ts:Ticket' });

const diagramOf = (model: AggregateModel): string =>
  `## ${model.id}.status\n\n\`\`\`mermaid\n${fieldDiagram(model, STATUS)}\n\`\`\``;

describe('lifecycleDiagrams', () => {
  it('wraps each declared field in a titled mermaid block', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER], problems: [] }, undefined)).toEqual({
      kind: 'diagram',
      text: `## Order.status\n\n\`\`\`mermaid\n${fieldDiagram(DECLARED_ORDER, STATUS)}\n\`\`\``,
    });
  });

  it('returns an empty diagram when the named aggregate is not declared', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER], problems: [] }, 'Payment')).toEqual({ kind: 'diagram', text: '' });
  });

  it('skips a field that has no declaration', () => {
    const model = aggregate({ declarations: new Map() });
    expect(lifecycleDiagrams({ aggregates: [model], problems: [] }, undefined)).toEqual({ kind: 'diagram', text: '' });
  });

  it('selects a uniquely named aggregate by its plain name', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER, TICKET_A], problems: [] }, 'Order')).toEqual({
      kind: 'diagram',
      text: diagramOf(DECLARED_ORDER),
    });
  });

  it('selects a uniquely named aggregate by its qualified name', () => {
    expect(lifecycleDiagrams({ aggregates: [DECLARED_ORDER, TICKET_A], problems: [] }, 'src/order.ts:Order')).toEqual({
      kind: 'diagram',
      text: diagramOf(DECLARED_ORDER),
    });
  });

  it('selects one of two same-named aggregates by its qualified name', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A, TICKET_B], problems: [] }, 'src/b/ticket.ts:Ticket')).toEqual({
      kind: 'diagram',
      text: diagramOf(TICKET_B),
    });
  });

  it('selects an aggregate by a qualified name with a leading dot segment', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A, TICKET_B], problems: [] }, './src/b/ticket.ts:Ticket')).toEqual({
      kind: 'diagram',
      text: diagramOf(TICKET_B),
    });
  });

  it('selects an aggregate by a qualified name with backslash separators', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A, TICKET_B], problems: [] }, 'src\\b\\ticket.ts:Ticket')).toEqual({
      kind: 'diagram',
      text: diagramOf(TICKET_B),
    });
  });

  it('reports a plain name shared by two declared aggregates as ambiguous', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A, TICKET_B], problems: [] }, 'Ticket')).toEqual({
      kind: 'ambiguous',
      reference: 'Ticket',
      candidates: ['src/a/ticket.ts:Ticket', 'src/b/ticket.ts:Ticket'],
    });
  });

  it('selects the declared aggregate when a same-named one is undeclared', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A, { ...TICKET_B, declared: false }], problems: [] }, 'Ticket')).toEqual({
      kind: 'diagram',
      text: diagramOf(TICKET_A),
    });
  });

  it('titles each section with the aggregate id', () => {
    expect(lifecycleDiagrams({ aggregates: [TICKET_A], problems: [] }, undefined)).toEqual({
      kind: 'diagram',
      text: `## src/a/ticket.ts:Ticket.status\n\n\`\`\`mermaid\n${fieldDiagram(TICKET_A, STATUS)}\n\`\`\``,
    });
  });
});
