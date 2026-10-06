import { EventsHandler } from './decorators';
import { InvoiceSent, OrderPlaced, PaymentCaptured, RefundIssued } from './events';

@EventsHandler(RefundIssued)
export class RefundHandler {
  handle(event: RefundIssued) {
    return event;
  }
}

@EventsHandler(OrderPlaced)
export class OrderPlacedHandler {
  handle(event: PaymentCaptured) {
    return event;
  }
}

@EventsHandler(InvoiceSent)
export class InvoiceHandler {
  handle(event: InvoiceSent) {
    return event;
  }
}
