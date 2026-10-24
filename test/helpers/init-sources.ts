import { AGGREGATE_ROOT } from './in-memory';

export const PAYMENT = `
import { AggregateRoot } from './aggregate-root';
export class Payment extends AggregateRoot<{ state: 'open' | 'paid' }> {
  static open(): Payment { return new Payment({ state: 'open' }); }
  pay(): void { if (this.props.state === 'paid') return; this.props.state = 'paid'; }
}
`;

export const INVITATION = `
import { AggregateRoot } from './aggregate-root';
export class Invitation extends AggregateRoot<{ state: 'pending' | 'accepted' | 'rejected' }> {
  static send(): Invitation { return new Invitation({ state: 'pending' }); }
  accept(): void { if (this.props.state !== 'pending') return; this.props.state = 'accepted'; }
  reject(): void { if (this.props.state !== 'pending') return; this.props.state = 'rejected'; }
}
`;

export const SWITCH = `
import { AggregateRoot } from './aggregate-root';
export class Switch extends AggregateRoot<{ state: 'on' | 'off' }> {
  static off(): Switch { return new Switch({ state: 'off' }); }
  turnOn(): void { if (this.props.state === 'on') return; this.props.state = 'on'; }
  turnOff(): void { if (this.props.state === 'off') return; this.props.state = 'off'; }
}
`;

export const orderWithEnumIn = (status: string) => `
import { AggregateRoot } from '../aggregate-root';
export enum OrderStatus { open = 'OPEN', ${status} = '${status.toUpperCase()}' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  static open(): Order { return new Order({ status: OrderStatus.open }); }
  finish(): void { if (this.props.status === OrderStatus.${status}) return; this.props.status = OrderStatus.${status}; }
}
`;

export const baseClassSource = (name: string): string => AGGREGATE_ROOT.replace('class AggregateRoot<', `class ${name}<`);

export const invoiceExtending = (base: string, file: string) => `
import { ${base} } from './${file}';
export class Invoice extends ${base}<{ state: 'draft' | 'void'; note: string }> {
  static draft(note: string): Invoice { return new Invoice({ state: 'draft', note }); }
  annotate(note: string): void { this.props.note = note; }
  cancel(): void { if (this.props.state === 'void') return; this.props.state = 'void'; }
}
`;

export const MODEL_SOURCES = {
  'src/model.ts': baseClassSource('Model'),
  'src/invoice.ts': invoiceExtending('Model', 'model'),
};

export const FOUR_SPACE_CONFIG = `import { defineDomain } from 'domain-integrity';

export default defineDomain({
    lifecycles: [],
});
`;
