import { InvoiceSent, OrderPlaced, PaymentCaptured, PaymentFailed, Shipped } from './events';

export const placeOrder = () => new OrderPlaced();
export const capture = () => new PaymentCaptured();
export const fail = () => new PaymentFailed();
export const ship = () => new Shipped();
export const invoice = () => new InvoiceSent();
