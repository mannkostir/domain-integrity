import { describe, expect, it } from 'vitest';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
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

const closedAt = stateField('closedAt', 'nullable', ['set', 'unset']);
const lockedAt = stateField('lockedAt', 'nullable', ['set', 'unset']);
const confirm = method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } });
const cancel = method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } });
const setClosedAt = { sources: known('unset'), sets: assigned('set') };

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

  it('suggests no terminal value for a timestamp set only alongside a terminal status', () => {
    const cancel = method('cancel', true, {
      status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') },
      closedAt: setClosedAt,
    });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [confirm, cancel] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['closedAt', []],
    ]);
  });

  it('keeps the terminal value of a timestamp set without touching the status', () => {
    const lock = method('lock', true, { lockedAt: { sources: known('unset'), sets: assigned('set') } });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, lockedAt], methods: [confirm, cancel, lock] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['lockedAt', ['set']],
    ]);
  });

  it('keeps the terminal value of a timestamp when the status it is set with has no terminal value', () => {
    const cancel = method('cancel', true, {
      status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') },
      closedAt: setClosedAt,
    });
    const reopen = method('reopen', true, { status: { sources: known('CANCELLED'), sets: assigned('PENDING') } });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [confirm, cancel, reopen] })],
        problems: [],
      }),
    ).toEqual([
      ['status', []],
      ['closedAt', ['set']],
    ]);
  });

  it('keeps the terminal value of a timestamp set alongside a non-terminal status', () => {
    const confirmAndClose = method('confirm', true, {
      status: { sources: known('PENDING'), sets: assigned('CONFIRMED') },
      closedAt: setClosedAt,
    });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [confirmAndClose, cancel] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['closedAt', ['set']],
    ]);
  });

  it('keeps the terminal value of a timestamp set alongside a status that may also be non-terminal', () => {
    const settle = method('settle', true, {
      status: { sources: known('PENDING'), sets: assigned('CONFIRMED', 'CANCELLED') },
      closedAt: setClosedAt,
    });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [settle, cancel] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['closedAt', ['set']],
    ]);
  });

  it('keeps the terminal value of a timestamp set alongside an unresolved status write', () => {
    const close = method('close', true, { status: { sources: known('PENDING'), sets: unresolvedValue }, closedAt: setClosedAt });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [cancel, close] })],
        problems: [],
      }),
    ).toEqual([
      ['status', []],
      ['closedAt', ['set']],
    ]);
  });

  it('keeps the terminal value of a timestamp set alongside a status write that may escape its known values', () => {
    const close = method('close', true, {
      status: { sources: known('PENDING'), sets: { tokens: new Set(['CANCELLED']), unresolved: false, mayWrite: true } },
      closedAt: setClosedAt,
    });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [cancel, close] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['closedAt', ['set']],
    ]);
  });

  it('suggests no terminal value for a timestamp set only alongside a terminal literal-union status', () => {
    const stage = stateField('stage', 'union', ['OPEN', 'CLOSED']);
    const close = method('close', true, { stage: { sources: known('OPEN'), sets: assigned('CLOSED') }, closedAt: setClosedAt });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [stage, closedAt], methods: [close] })],
        problems: [],
      }),
    ).toEqual([
      ['stage', ['CLOSED']],
      ['closedAt', []],
    ]);
  });

  it('keeps the terminal value of a timestamp also set by a method that leaves the status alone', () => {
    const cancel = method('cancel', true, {
      status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') },
      closedAt: setClosedAt,
    });
    const archive = method('archive', true, { closedAt: setClosedAt });

    expect(
      terminalLabels({
        aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [STATUS, closedAt], methods: [confirm, cancel, archive] })],
        problems: [],
      }),
    ).toEqual([
      ['status', ['CANCELLED']],
      ['closedAt', ['set']],
    ]);
  });

  it('skips aggregates that are already declared', () => {
    expect(suggestLifecycles({ aggregates: [aggregate({ fields: [STATUS] })], problems: [] })).toEqual([]);
  });
});
