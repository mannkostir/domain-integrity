import { describe, expect, it } from 'vitest';
import { undispatchedEvents } from '../../../../src/analyzers/event-flow/checks/undispatched-events';
import { flowModel } from '../../../helpers/event-flow-model';

const buffer = {
  ownerId: 'AggregateRoot',
  owner: 'AggregateRoot',
  buffer: '_domainEvents',
  method: 'addDomainEvent',
  raisers: ['Booking', 'Payment'],
  file: '/app/src/aggregate-root.ts',
  line: 3,
};

describe('undispatchedEvents', () => {
  it('reports one finding per undispatched buffer', () => {
    expect(undispatchedEvents(flowModel({ buffers: [buffer] }))).toEqual([
      {
        analyzer: 'event-flow',
        checkId: 'undispatched-events',
        severity: 'error',
        owner: 'AggregateRoot',
        ownerId: 'AggregateRoot',
        buffer: '_domainEvents',
        method: 'addDomainEvent',
        raisers: ['Booking', 'Payment'],
        subject: '',
        file: '/app/src/aggregate-root.ts',
        line: 3,
        message:
          'AggregateRoot._domainEvents collects events from addDomainEvent() raised by Booking, Payment, but no production code reads or drains it, so those events never reach a handler.',
        fix: 'Dispatch the events in _domainEvents after saving the aggregate and clear it, or stop raising them.',
      },
    ]);
  });

  it('reports nothing without undispatched buffers', () => {
    expect(undispatchedEvents(flowModel())).toEqual([]);
  });
});
