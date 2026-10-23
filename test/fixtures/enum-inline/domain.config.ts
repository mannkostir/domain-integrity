import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
import { OrderStatus } from './src/order-status';

export default defineDomain({
  lifecycles: [
    lifecycle(Order, {
      states: {
        status: {
          terminal: [OrderStatus.cancelled],
          transitions: {
            confirm: { from: [OrderStatus.pending] },
            place: { from: [OrderStatus.paid] },
            cancel: { from: [OrderStatus.pending, OrderStatus.confirmed] },
          },
        },
      },
    }),
  ],
});
