import { Order } from '@acme/orders';

export class CancelOrder {
  execute(order: Order): void {
    order.status = 'cancelled';
  }
}
