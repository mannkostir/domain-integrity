import { OrderPlaced } from './events';

export class Undispatched {
  private events: object[] = [];

  addEvent(event: object): void {
    this.events.push(event);
  }

  place(): void {
    this.addEvent(new OrderPlaced());
  }
}

export class Dispatched {
  private events: object[] = [];

  addEvent(event: object): void {
    this.events.push(event);
  }

  place(): void {
    this.addEvent(new OrderPlaced());
  }

  pullEvents(): object[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

export const flush = (aggregate: Dispatched): object[] => aggregate.pullEvents();
