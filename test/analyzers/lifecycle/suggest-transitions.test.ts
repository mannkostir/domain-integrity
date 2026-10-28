import { assert, describe, expect, it } from 'vitest';
import { TransitionSeed, suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { transitionDrift } from '../../../src/analyzers/lifecycle/checks/transition-drift';
import { MethodModel, StateField } from '../../../src/analyzers/lifecycle/model';
import {
  STATUS,
  aggregate,
  assigned,
  declared,
  known,
  mayWriteValue,
  method,
  stateField,
  unknownSources,
  unresolvedValue,
} from '../../helpers/model';

const transitionsOf = (methods: readonly MethodModel[], field: StateField = STATUS) =>
  suggestLifecycles({
    aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [field], methods: [...methods] })],
    problems: [],
    reportTestFileMutations: false,
  })[0]?.fields[0]?.transitions;

const declaredTransitions = (entries: readonly TransitionSeed[]): Record<string, string[]> =>
  Object.fromEntries(entries.map((entry) => [entry.method, entry.from.map((value) => value.token)]));

const [PENDING, CONFIRMED] = STATUS.values;

const confirm = method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } });

describe('seeded transitions in suggestions', () => {
  it('seeds one entry per public writer in model order', () => {
    const cancel = method('cancel', true, { status: { sources: known('CONFIRMED'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([cancel, confirm])).toEqual({
      kind: 'seeded',
      entries: [
        { method: 'cancel', from: [CONFIRMED] },
        { method: 'confirm', from: [PENDING] },
      ],
    });
  });

  it('lists the from values in field value order', () => {
    const cancel = method('cancel', true, { status: { sources: known('CONFIRMED', 'PENDING'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([cancel])).toEqual({ kind: 'seeded', entries: [{ method: 'cancel', from: [PENDING, CONFIRMED] }] });
  });

  it('seeds an empty from list for a writer whose guard excludes every value', () => {
    const reset = method('reset', true, { status: { sources: known(), sets: assigned('PENDING') } });

    expect(transitionsOf([reset])).toEqual({ kind: 'seeded', entries: [{ method: 'reset', from: [] }] });
  });

  it('withholds the field and lists every writer whose sources are unknown', () => {
    const cancel = method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } });
    const reopen = method('reopen', true, { status: { sources: unknownSources, sets: unresolvedValue } });

    expect(transitionsOf([cancel, confirm, reopen])).toEqual({
      kind: 'withheld',
      methods: [
        { method: 'cancel', reason: 'unknown-sources' },
        { method: 'reopen', reason: 'unknown-sources' },
      ],
    });
  });

  it('withholds the field when a public writer has a quoted name', () => {
    const quoted = method("'force-cancel'", true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([confirm, quoted])).toEqual({
      kind: 'withheld',
      methods: [{ method: "'force-cancel'", reason: 'unwritable-name' }],
    });
  });

  it('withholds the field when a public writer has a computed name', () => {
    const computed = method('[CANCEL]', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([computed])).toEqual({ kind: 'withheld', methods: [{ method: '[CANCEL]', reason: 'unwritable-name' }] });
  });

  it('withholds the field when a public writer has a private name', () => {
    const hashed = method('#cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([hashed])).toEqual({ kind: 'withheld', methods: [{ method: '#cancel', reason: 'unwritable-name' }] });
  });

  it('reports an unwritable name ahead of unknown sources', () => {
    const numeric = method('1', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } });

    expect(transitionsOf([numeric])).toEqual({ kind: 'withheld', methods: [{ method: '1', reason: 'unwritable-name' }] });
  });

  it('ignores a writer that is not public', () => {
    const hidden = method('forceCancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } }, 'private');

    expect(transitionsOf([confirm, hidden])).toEqual({ kind: 'seeded', entries: [{ method: 'confirm', from: [PENDING] }] });
  });

  it('ignores a public method that reads the field without writing it', () => {
    const describeStatus = method('describe', false, { status: { sources: unknownSources, sets: assigned() } });

    expect(transitionsOf([describeStatus, confirm])).toEqual({ kind: 'seeded', entries: [{ method: 'confirm', from: [PENDING] }] });
  });

  it('ignores a public method that only may write the field through an escape', () => {
    const rename = method('rename', true, { status: { sources: unknownSources, sets: mayWriteValue } });

    expect(transitionsOf([confirm, rename])).toEqual({ kind: 'seeded', entries: [{ method: 'confirm', from: [PENDING] }] });
  });

  it('suggests no transitions for a field no public method writes', () => {
    expect(transitionsOf([])).toEqual({ kind: 'none' });
  });

  it('seeds transitions for a nullable field', () => {
    const closedAt = stateField('closedAt', 'nullable', ['set', 'unset']);
    const close = method('close', true, { closedAt: { sources: known('unset'), sets: assigned('set') } });

    expect(transitionsOf([close], closedAt)).toEqual({ kind: 'seeded', entries: [{ method: 'close', from: [closedAt.values[1]] }] });
  });

  it('seeds transitions that report no drift on the code they came from', () => {
    const methods = [
      confirm,
      method('cancel', true, { status: { sources: known('CONFIRMED', 'PENDING'), sets: assigned('CANCELLED') } }),
      method('reset', true, { status: { sources: known(), sets: assigned('PENDING') } }),
      method('describe', false, { status: { sources: unknownSources, sets: assigned() } }),
    ];
    const transitions = transitionsOf(methods);
    assert(transitions?.kind === 'seeded');
    const seededOrder = aggregate({
      methods,
      declarations: new Map([['status', declared([], declaredTransitions(transitions.entries))]]),
    });

    const findings = transitionDrift(seededOrder);

    expect(findings).toEqual([]);
  });
});
