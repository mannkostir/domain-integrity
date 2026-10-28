import { describe, expect, it } from 'vitest';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { MethodModel, StateField } from '../../../src/analyzers/lifecycle/model';
import {
  STATUS,
  aggregate,
  assigned,
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

const confirm = method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } });

describe('seeded transitions in suggestions', () => {
  it('seeds one entry per public writer with its source values in field order', () => {
    const cancel = method('cancel', true, { status: { sources: known('CONFIRMED', 'PENDING'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([confirm, cancel])).toEqual({
      kind: 'seeded',
      entries: [
        { method: 'confirm', from: [STATUS.values[0]] },
        { method: 'cancel', from: [STATUS.values[0], STATUS.values[1]] },
      ],
    });
  });

  it('seeds an empty from list for a writer whose guard excludes every value', () => {
    const reset = method('reset', true, { status: { sources: known(), sets: assigned('PENDING') } });

    expect(transitionsOf([reset])).toEqual({ kind: 'seeded', entries: [{ method: 'reset', from: [] }] });
  });

  it('withholds the field and lists every writer whose sources are unknown', () => {
    const cancel = method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } });
    const reopen = method('reopen', true, { status: { sources: unknownSources, sets: unresolvedValue } });

    expect(transitionsOf([cancel, confirm, reopen])).toEqual({ kind: 'withheld', unknownMethods: ['cancel', 'reopen'] });
  });

  it('withholds the field when a writer can run from a value outside the field', () => {
    const cancel = method('cancel', true, { status: { sources: known('PENDING', 'ARCHIVED'), sets: assigned('CANCELLED') } });

    expect(transitionsOf([confirm, cancel])).toEqual({ kind: 'withheld', unknownMethods: ['cancel'] });
  });

  it('ignores a writer that is not public', () => {
    const hidden = method('forceCancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } }, 'private');

    expect(transitionsOf([confirm, hidden])).toEqual({ kind: 'seeded', entries: [{ method: 'confirm', from: [STATUS.values[0]] }] });
  });

  it('ignores a public method that reads the field without writing it', () => {
    const describeStatus = method('describe', false, { status: { sources: unknownSources, sets: assigned() } });
    const rename = method('rename', true, { status: { sources: unknownSources, sets: mayWriteValue } });

    expect(transitionsOf([describeStatus, confirm, rename])).toEqual({
      kind: 'seeded',
      entries: [{ method: 'confirm', from: [STATUS.values[0]] }],
    });
  });

  it('suggests no transitions for a field no public method writes', () => {
    expect(transitionsOf([])).toEqual({ kind: 'none' });
  });

  it('seeds transitions for a nullable field', () => {
    const closedAt = stateField('closedAt', 'nullable', ['set', 'unset']);
    const close = method('close', true, { closedAt: { sources: known('unset'), sets: assigned('set') } });

    expect(transitionsOf([close], closedAt)).toEqual({ kind: 'seeded', entries: [{ method: 'close', from: [closedAt.values[1]] }] });
  });
});
