import { AggregateRoot } from '@acme/orders';

export class Order extends AggregateRoot<{ id: string }> {}
