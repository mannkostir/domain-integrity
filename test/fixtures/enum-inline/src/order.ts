import { AggregateRoot } from './aggregate-root';
import { OrderStatus } from './order-status';

type OrderProps = { status: OrderStatus; lines: string[]; note: string };

export class Order extends AggregateRoot<OrderProps> {
  static create(): Order {
    return new Order({ status: OrderStatus.pending, lines: [], note: '' });
  }

  private get isPending(): boolean {
    return this.props.status === OrderStatus.pending;
  }

  addLine(line: string): void {
    if (!this.isPending) throw new Error('Order is not pending');
    this.props.lines.push(line);
  }

  confirm(): void {
    if (!this.isPending) throw new Error('Order is not pending');
    this.props.status = OrderStatus.confirmed;
    this.addEvent({ type: 'OrderConfirmed' });
  }

  place(): void {
    if (this.props.status !== OrderStatus.confirmed) throw new Error('Order is not confirmed');
    this.props.status = OrderStatus.placed;
  }

  cancel(): void {
    if (this.props.status === OrderStatus.cancelled) throw new Error('Order is already cancelled');
    this.props.status = OrderStatus.cancelled;
  }

  annotate(note: string): void {
    this.props.note = note;
  }
}
