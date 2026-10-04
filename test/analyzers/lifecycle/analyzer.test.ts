import { describe, expect, it } from 'vitest';
import { analyse } from '../../../src/analyzer';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }
export class Ticket extends AggregateRoot<{ status: TicketStatus; title: string }> {
  static open(title: string): Ticket { return new Ticket({ status: TicketStatus.open, title }); }
  rename(title: string): void { this.props.title = title; }
  close(): void { if (this.props.status === TicketStatus.closed) return; this.props.status = TicketStatus.closed; }
}
`,
});

const ticket = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');

describe('lifecycleAnalyzer', () => {
  it('runs all checks and reports the leak for an unguarded mutating method', () => {
    const result = analyse(lifecycleAnalyzer, {
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: ticket, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined }], allowAfterTerminal: [] }],
      },
      files: project.getSourceFiles(),
    });

    expect(result.findings.map((finding) => `${finding.checkId} ${finding.method}`)).toEqual(['terminal-state-leak rename']);
  });

  it('reports the leak for an unguarded method that emits the state it just assigned', () => {
    const orderProject = inMemoryProject({
      '/src/aggregate-root.ts': AGGREGATE_ROOT,
      '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', paid = 'PAID' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  static place(): Order { return new Order({ status: OrderStatus.pending }); }
  pay(): void { this.props.status = OrderStatus.paid; this.addEvent({ status: this.props.status }); }
}
`,
    });
    const order = orderProject.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

    const result = analyse(lifecycleAnalyzer, {
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: order, fields: [{ name: 'status', terminal: ['PAID'], transitions: undefined }], allowAfterTerminal: [] }],
      },
      files: orderProject.getSourceFiles(),
    });

    expect(result.findings.map((finding) => `${finding.checkId} ${finding.method}`)).toEqual(['terminal-state-leak pay']);
  });

  it('describes its four rules', () => {
    expect(lifecycleAnalyzer.rules.map((rule) => rule.id)).toEqual([
      'terminal-state-leak',
      'unreachable-state',
      'outside-mutation',
      'transition-drift',
    ]);
  });
});
