import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './libs/orders/src/order';

export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: ['cancelled'] } } })],
});
