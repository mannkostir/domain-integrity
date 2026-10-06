import { Saga, Stream, ofType } from './decorators';
import { PaymentCaptured } from './events';

export class OrderSaga {
  @Saga()
  captured = (events$: Stream) => events$.pipe(ofType(PaymentCaptured));
}
