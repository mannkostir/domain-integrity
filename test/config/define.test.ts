import { describe, expect, it } from 'vitest';
import { defineDomain, lifecycle } from '../../src/index';

enum TicketStatus {
  open = 'OPEN',
  closed = 'CLOSED',
}

class Ticket {
  private constructor(private status: TicketStatus) {}

  static open(): Ticket {
    return new Ticket(TicketStatus.open);
  }

  close(): void {
    this.status = TicketStatus.closed;
  }
}

describe('config helpers', () => {
  it('return the configuration they are given', () => {
    const declaration = lifecycle(Ticket, {
      states: { status: { terminal: [TicketStatus.closed], transitions: { close: [TicketStatus.open] } } },
    });

    expect(defineDomain({ lifecycles: [declaration] })).toEqual({ lifecycles: [declaration] });
  });

  it('accept a single terminal value', () => {
    const declaration = lifecycle(Ticket, { states: { closedAt: { terminal: 'set' } } });

    expect(declaration.kind).toBe('lifecycle');
  });

  it('reject transitions for methods the class does not have', () => {
    const declaration = lifecycle(Ticket, {
      // @ts-expect-error
      states: { status: { terminal: [TicketStatus.closed], transitions: { reopen: [TicketStatus.closed] } } },
    });

    expect(declaration.kind).toBe('lifecycle');
  });

  it('reject allowAfterTerminal entries that are not methods', () => {
    const declaration = lifecycle(Ticket, {
      states: { status: { terminal: [TicketStatus.closed] } },
      // @ts-expect-error
      allowAfterTerminal: ['archive'],
    });

    expect(declaration.kind).toBe('lifecycle');
  });
});
