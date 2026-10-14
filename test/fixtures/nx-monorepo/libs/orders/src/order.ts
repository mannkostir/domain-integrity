import { AggregateRoot } from './aggregate-root';

export type OrderStatus = 'open' | 'cancelled';

export class Order extends AggregateRoot<{ id: string }> {
  status: OrderStatus = 'open';

  static open(id: string): Order {
    return new Order({ id });
  }
}
