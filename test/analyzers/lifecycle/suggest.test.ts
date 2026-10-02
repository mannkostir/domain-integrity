import { describe, expect, it } from 'vitest';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { STATUS, aggregate, assigned, known, mayWriteValue, method, stateField, unknownSources } from '../../helpers/model';

const terminalLabels = (model: Parameters<typeof suggestLifecycles>[0]) =>
  suggestLifecycles(model).flatMap((suggestion) =>
    suggestion.fields.map((field) => [field.field.name, field.terminal.map((value) => value.token)]),
  );

describe('suggestLifecycles', () => {
  it('suggests reached states without outgoing transitions as terminal', () => {
    const methods = [
      method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
      method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } }),
    ];

    expect(terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), methods })], problems: [] })).toEqual([
      ['status', ['CANCELLED']],
    ]);
  });

  it('treats a state that is only re-entered from itself as terminal', () => {
    const deleted = stateField('deleted', 'boolean', ['true', 'false']);
    const methods = [method('delete', true, { deleted: { sources: known('true', 'false'), sets: assigned('true') } })];

    expect(
      terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [deleted], methods })], problems: [] }),
    ).toEqual([['deleted', ['true']]]);
  });

  it('suggests no terminal state when a setter guard could not be analysed', () => {
    const methods = [method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } })];

    expect(terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), methods })], problems: [] })).toEqual([
      ['status', []],
    ]);
  });

  it('keeps the terminal suggestion when another method only may write through an escape', () => {
    const methods = [
      method('cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } }),
      method('rename', true, { status: { sources: unknownSources, sets: mayWriteValue } }),
    ];

    expect(terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), methods })], problems: [] })).toEqual([
      ['status', ['CANCELLED']],
    ]);
  });

  it('skips aggregates that are already declared', () => {
    expect(suggestLifecycles({ aggregates: [aggregate({ fields: [STATUS] })], problems: [] })).toEqual([]);
  });
});
