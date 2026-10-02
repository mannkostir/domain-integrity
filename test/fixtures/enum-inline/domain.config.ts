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
            confirm: [OrderStatus.pending],
            place: [OrderStatus.paid],
            cancel: [OrderStatus.pending, OrderStatus.confirmed],
          },
        },
      },
    }),
  ],
});
