import { Order } from './order';

export class OrderMapper {
  reopen(order: Order): void {
    order.status = 'open';
  }
}
