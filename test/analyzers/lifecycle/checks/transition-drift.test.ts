import { describe, expect, it } from 'vitest';
import { transitionDrift } from '../../../../src/analyzers/lifecycle/checks/transition-drift';
import { aggregate, assigned, declared, known, mayWriteValue, method, unknownSources } from '../../../helpers/model';

const withTransitions = (transitions: Record<string, string[]>) =>
  new Map([['status', declared(['CANCELLED'], transitions)]]);
const QUALIFIED = 'src/a/order.ts:Order';

describe('transitionDrift', () => {
  it('flags sources the declaration does not allow as an error', () => {
    const methods = [method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING'] }) }))).toEqual([
      expect.objectContaining({
        checkId: 'transition-drift',
        severity: 'error',
        method: 'cancel',
        subject: 'extra',
        message: "cancel() can run from 'confirmed', which the declaration does not allow.",
        fix: "Add a guard that excludes 'confirmed', or add it to transitions.cancel.",
      }),
    ]);
  });

  it('flags declared sources the code no longer allows as a warning', () => {
    const methods = [method('cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } })];

    expect(
      transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING', 'CONFIRMED'] }) })),
    ).toEqual([
      expect.objectContaining({
        severity: 'warning',
        subject: 'missing',
        message: "cancel() cannot run from 'confirmed', although the declaration allows it.",
        fix: "Remove 'confirmed' from transitions.cancel, or relax the guard.",
      }),
    ]);
  });

  it('flags a method that sets the field without a declared transition', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({}) }))).toEqual([
      expect.objectContaining({
        severity: 'error',
        method: 'confirm',
        subject: 'undeclared',
        message: 'confirm() sets status but has no entry in transitions.',
        fix: 'Add transitions.confirm to the declaration.',
      }),
    ]);
  });

  it('does not ask a method that only may write through an escape to declare a transition', () => {
    const methods = [method('rename', true, { status: { sources: unknownSources, sets: mayWriteValue } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({}) }))).toEqual([]);
  });

  it('flags a public method that sets the field without a declared transition', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }, 'public')];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({}) }))).toEqual([
      expect.objectContaining({ method: 'confirm', subject: 'undeclared' }),
    ]);
  });

  it('ignores a private method that sets the field', () => {
    const methods = [method('onConfirmed', true, { status: { sources: known('PENDING', 'CONFIRMED', 'CANCELLED'), sets: assigned('CONFIRMED') } }, 'private')];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({ onConfirmed: ['PENDING'] }) }))).toEqual([]);
  });

  it('ignores a protected method that sets the field', () => {
    const methods = [method('onConfirmed', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }, 'protected')];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({}) }))).toEqual([]);
  });

  it('does nothing when no transitions are declared', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(transitionDrift(aggregate({ methods }))).toEqual([]);
  });

  it('stays silent for a declared method whose guard could not be analysed', () => {
    const methods = [method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING'] }) }))).toEqual([]);
  });

  it('identifies findings by the aggregate id', () => {
    expect(
      transitionDrift(
        aggregate({
          id: QUALIFIED,
          methods: [method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } })],
          declarations: withTransitions({ cancel: ['PENDING'] }),
        }),
      ).map((finding) => finding.aggregateId),
    ).toEqual([QUALIFIED]);
  });
});
