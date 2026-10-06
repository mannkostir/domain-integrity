import { defineDomain, saga } from 'domain-integrity';
import { InvoiceSent, PaymentCaptured, PaymentFailed, Shipped } from './src/events';
import { OrderSaga } from './src/saga';

export default defineDomain({
  events: {
    inProcess: [Shipped, InvoiceSent],
    sagas: [saga(OrderSaga, { outcomes: [[PaymentCaptured, PaymentFailed]] })],
  },
});
