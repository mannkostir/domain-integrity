import { describe, expect, it } from 'vitest';
import { StateField } from '../../src/analyzers/lifecycle/model';
import { FieldSuggestion, LifecycleSuggestion, WithheldMethod } from '../../src/analyzers/lifecycle/suggest';
import { withheldTransitionsNotes } from '../../src/cli/withheld-transitions';

const STATUS: StateField = {
  name: 'status',
  kind: 'union',
  values: [],
  enumReference: undefined,
  unsetForms: [],
  setMayBeFalsy: false,
};

const withheldStatus = (methods: readonly WithheldMethod[]): FieldSuggestion => ({
  field: STATUS,
  terminal: [],
  transitions: { kind: 'withheld', methods },
});

const order = (fields: readonly FieldSuggestion[]): LifecycleSuggestion => ({ className: 'Order', file: '/src/order.ts', fields });

describe('withheldTransitionsNotes', () => {
  it('says init cannot tell the sources of a method it cannot follow', () => {
    const notes = withheldTransitionsNotes([order([withheldStatus([{ method: 'close', reason: 'unknown-sources' }])])]);

    expect(notes).toEqual(['No transitions seeded for Order.status: init cannot tell which states close() runs from.']);
  });

  it('says a method cannot be named in transitions', () => {
    const notes = withheldTransitionsNotes([order([withheldStatus([{ method: 'close-now', reason: 'unwritable-name' }])])]);

    expect(notes).toEqual(['No transitions seeded for Order.status: close-now() cannot be named in transitions.']);
  });

  it('joins the reasons of several methods in order', () => {
    const notes = withheldTransitionsNotes([
      order([
        withheldStatus([
          { method: 'close', reason: 'unknown-sources' },
          { method: 'reopen-now', reason: 'unwritable-name' },
        ]),
      ]),
    ]);

    expect(notes).toEqual([
      'No transitions seeded for Order.status: init cannot tell which states close() runs from; reopen-now() cannot be named in transitions.',
    ]);
  });

  it('names two methods withheld for the same reason in one clause', () => {
    const notes = withheldTransitionsNotes([
      order([
        withheldStatus([
          { method: 'close', reason: 'unknown-sources' },
          { method: 'reopen', reason: 'unknown-sources' },
        ]),
      ]),
    ]);

    expect(notes).toEqual(['No transitions seeded for Order.status: init cannot tell which states close() and reopen() run from.']);
  });

  it('lists three or more methods withheld for the same reason with commas', () => {
    const notes = withheldTransitionsNotes([
      order([
        withheldStatus([
          { method: 'open', reason: 'unwritable-name' },
          { method: 'close', reason: 'unwritable-name' },
          { method: 'reopen', reason: 'unwritable-name' },
        ]),
      ]),
    ]);

    expect(notes).toEqual(['No transitions seeded for Order.status: open(), close() and reopen() cannot be named in transitions.']);
  });

  it('orders the clauses by the first method of each reason', () => {
    const notes = withheldTransitionsNotes([
      order([
        withheldStatus([
          { method: 'open-now', reason: 'unwritable-name' },
          { method: 'close', reason: 'unknown-sources' },
          { method: 'reopen-now', reason: 'unwritable-name' },
        ]),
      ]),
    ]);

    expect(notes).toEqual([
      'No transitions seeded for Order.status: open-now() and reopen-now() cannot be named in transitions; init cannot tell which states close() runs from.',
    ]);
  });

  it('says nothing about fields whose transitions were seeded or have no writers', () => {
    const notes = withheldTransitionsNotes([
      order([
        { field: STATUS, terminal: [], transitions: { kind: 'seeded', entries: [] } },
        { field: STATUS, terminal: [], transitions: { kind: 'none' } },
      ]),
    ]);

    expect(notes).toEqual([]);
  });
});
