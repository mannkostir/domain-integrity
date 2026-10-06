import { describe, expect, it } from 'vitest';
import { unhandledEvent } from '../../../../src/analyzers/event-flow/checks/unhandled-event';
import { eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

const declared = (overrides: Parameters<typeof eventClass>[1] = {}, rest: Parameters<typeof flowModel>[0] = {}) =>
  flowModel({ events: new Map([['Failed', eventClass('Failed', { ancestors: ['Base'], ...overrides })]]), registrations: [], inProcess: ['Failed'], ...rest });

describe('unhandledEvent', () => {
  it('reports a declared, constructed event with no handler at its first construction', () => {
    expect(unhandledEvent(declared({ constructions: [{ file: '/app/src/b.ts', line: 2 }, { file: '/app/src/a.ts', line: 9 }] }))).toEqual([
      {
        analyzer: 'event-flow',
        checkId: 'unhandled-event',
        severity: 'error',
        event: 'Failed',
        eventId: 'Failed',
        handler: undefined,
        subject: '',
        file: '/app/src/a.ts',
        line: 9,
        message: 'Failed is declared in-process and constructed, but no handler is registered for it.',
        fix: 'Add a handler, or remove Failed from events.inProcess if it is consumed elsewhere.',
      },
    ]);
  });

  it('stays silent when the event or an ancestor is handled, in a test file too', () => {
    expect([
      unhandledEvent(declared({}, { registrations: [registration({ event: 'Failed' })] })),
      unhandledEvent(declared({}, { registrations: [registration({ event: 'Base' })] })),
      unhandledEvent(declared({}, { registrations: [registration({ event: 'Failed', inTest: true })] })),
    ]).toEqual([[], [], []]);
  });

  it('stays silent when anything could hide a handler or the event is never constructed', () => {
    expect([
      unhandledEvent(declared({}, { unresolved: [{ owner: undefined, file: '/app/src/x.ts', line: 1 }] })),
      unhandledEvent(declared({ constructions: [] })),
      unhandledEvent(declared({ escaped: true })),
      unhandledEvent(declared({ instanceofChecked: true })),
      unhandledEvent(declared({ namedInString: true })),
      unhandledEvent(declared({ typedParameter: true })),
    ]).toEqual([[], [], [], [], [], []]);
  });

  it('stays silent for an opaque event, or a library-based one when a handler is keyed on a library class', () => {
    expect([
      unhandledEvent(declared({ opaque: true })),
      unhandledEvent(declared({ extendsLibrary: true }, { libraryKeyed: [undefined] })),
    ]).toEqual([[], []]);
  });

  it('still judges a library-based event without library-keyed handlers, and a project-based one with them', () => {
    expect([
      unhandledEvent(declared({ extendsLibrary: true })).length,
      unhandledEvent(declared({}, { libraryKeyed: ['PaidHandler'] })).length,
    ]).toEqual([1, 1]);
  });

  it('ignores events that are not declared in-process', () => {
    expect(unhandledEvent(declared({}, { inProcess: [] }))).toEqual([]);
  });
});
