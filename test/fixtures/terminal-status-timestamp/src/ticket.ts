import { AggregateRoot } from './aggregate-root';

export enum TicketStatus {
  Draft = 'DRAFT',
  Open = 'OPEN',
  Closed = 'CLOSED',
}

export class Ticket extends AggregateRoot {
  private status: TicketStatus = TicketStatus.Draft;
  private closedAt: Date | null = null;
  private title = '';

  get isClosed(): boolean {
    return this.status === TicketStatus.Closed;
  }

  open(): void {
    if (this.status !== TicketStatus.Draft) throw new Error('Not a draft');
    this.status = TicketStatus.Open;
  }

  close(): void {
    if (this.status === TicketStatus.Closed) return;
    this.status = TicketStatus.Closed;
    this.closedAt = new Date();
  }

  touch(title: string): void {
    if (this.isClosed) throw new Error('Closed');
    this.title = title;
  }

  rename(title: string): void {
    this.title = title;
  }
}
