import { describe, expect, it } from 'vitest';
import { defineDomain, lifecycle, saga } from '../../src/index';

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

  it('reject field allowAfterTerminal entries that are not methods', () => {
    const declaration = lifecycle(Ticket, {
      // @ts-expect-error
      states: { status: { terminal: [TicketStatus.closed], allowAfterTerminal: ['archive'] } },
    });

    expect(declaration.kind).toBe('lifecycle');
  });
});

class PaymentCaptured {
  private constructor(readonly amount: number) {}

  static of(amount: number): PaymentCaptured {
    return new PaymentCaptured(amount);
  }
}

class PaymentFailed {}

class OrderSaga {}

describe('event config helpers', () => {
  it('saga() returns its declaration', () => {
    const declaration = saga(OrderSaga, { outcomes: [[PaymentCaptured, PaymentFailed]] });

    expect(defineDomain({ events: { inProcess: [PaymentCaptured], sagas: [declaration] } })).toEqual({
      events: { inProcess: [PaymentCaptured], sagas: [declaration] },
    });
  });

  it('saga() rejects an outcome that is not a pair', () => {
    // @ts-expect-error
    const declaration = saga(OrderSaga, { outcomes: [[PaymentCaptured]] });

    expect(declaration.kind).toBe('saga');
  });

  it('saga() rejects an outcome element that is not a class', () => {
    // @ts-expect-error
    const declaration = saga(OrderSaga, { outcomes: [['PaymentCaptured', PaymentFailed]] });

    expect(declaration.kind).toBe('saga');
  });
});
