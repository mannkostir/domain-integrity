import { AggregateRoot } from './aggregate-root.js';
import { ShipmentStatus } from './shipment-status.js';

type ShipmentProps = { status: ShipmentStatus; address: string };

export class Shipment extends AggregateRoot<ShipmentProps> {
  static create(address: string): Shipment {
    return new Shipment({ status: ShipmentStatus.pending, address });
  }

  deliver(): void {
    if (this.props.status === ShipmentStatus.delivered) throw new Error('Shipment is already delivered');
    this.props.status = ShipmentStatus.delivered;
  }

  redirect(address: string): void {
    this.props.address = address;
  }
}
