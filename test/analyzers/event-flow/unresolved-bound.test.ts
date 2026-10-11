import { describe, expect, it } from 'vitest';
import { unhandledEvent } from '../../../src/analyzers/event-flow/checks/unhandled-event';
import { extractEventFlows } from '../../../src/analyzers/event-flow/extract';
import { readDeclaration } from '../../../src/engine/read-config';
import { inMemoryProject } from '../../helpers/in-memory';

const SHIPPED_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { constructor(readonly orderId: string) { super(); } }
`;

const CARRIER_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { constructor(readonly orderId: string, readonly carrier: string) { super(); } }
`;

const ABSTRACT_EVENTS = `
export abstract class OrderEvent { abstract readonly orderId: string; }
export class Shipped implements OrderEvent { constructor(readonly orderId: string) {} }
`;

const INFRA = `
export const OnEvent = (..._topics: unknown[]) => (..._args: unknown[]): void => undefined;
export class Emitter { emit(_topic: string, _payload: unknown): void {} }
export const DomainEvents = { register: (_handler: unknown, _key: unknown): void => undefined };
`;

const SERVICE = `
import { Emitter } from './infra';
import { Shipped } from './events';
export class OrderService {
  constructor(private readonly emitter: Emitter) {}
  ship(id: string): void { this.emitter.emit('order.shipped', new Shipped(id, 'ups')); }
}
`;

const CONFIG = `
import { defineDomain } from 'domain-integrity';
import { Shipped } from './src/events';
export default defineDomain({ events: { inProcess: [Shipped] } });
`;

const HANDLER_IMPORTS = "import { OnEvent, DomainEvents } from './infra';\nimport { DomainEvent, Shipped } from './events';\n";

const findingsFor = (handlerFile: string, handler: string, events: string = SHIPPED_EVENTS, extraFiles: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({
    ...extraFiles,
    '/app/src/events.ts': events,
    '/app/src/infra.ts': INFRA,
    '/app/src/service.ts': SERVICE,
    [`/app/src/${handlerFile}`]: `${HANDLER_IMPORTS}${handler}`,
    '/app/domain.config.ts': CONFIG,
  });
  const config = project.getSourceFileOrThrow('/app/domain.config.ts');
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/'));
  return unhandledEvent(extractEventFlows({ declaration: readDeclaration(config), files, root: '/app' })).map((finding) => finding.event);
};

const ENVELOPE_EVENTS = `
export class Envelope<T> { constructor(readonly body: T, readonly occurredAt: Date) {} }
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends Envelope<{ id: string }> {}
`;

const MARKED_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { private readonly marker = 1; constructor(readonly orderId: string) { super(); } }
`;

const PRIVATE_NAME_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { #marker = 1; constructor(readonly orderId: string) { super(); } }
`;

const DECLARED_CONTRACTS = 'export declare class Shipped { private readonly marker; readonly orderId: string; readonly occurredAt: Date; }\n';

const INCOMPATIBLE_CREATED = 'export class OrderCreated extends DomainEvent { constructor(readonly orderId: string, readonly total: number) { super(); } }\n';

describe('unhandledEvent with unresolved registrations', () => {
  it('stays silent for a structurally identical consumer-owned class', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderShippedEvent { constructor(readonly orderId: string, readonly occurredAt: Date) {} }\nexport class Listener { @OnEvent('order.shipped') onShipped(event: OrderShippedEvent) {} }",
      ),
    ).toEqual([]);
  });

  it('stays silent for a parameter typed with an empty class', () => {
    expect(findingsFor('listener.ts', "export class IntegrationEvent {}\nexport class Listener { @OnEvent('**') record(event: IntegrationEvent) {} }")).toEqual([]);
  });

  it('stays silent for a sibling event of the same shape', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderCreated extends DomainEvent { constructor(readonly orderId: string) { super(); } }\nexport class Listener { @OnEvent(['order.created', 'order.shipped']) sync(event: OrderCreated) {} }",
      ),
    ).toEqual([]);
  });

  it('stays silent for a parameter typed with a subclass of the event', () => {
    expect(
      findingsFor('listener.ts', "export class ShippedWithCarrier extends Shipped { readonly carrier?: string; }\nexport class Listener { @OnEvent('order.shipped') on(event: ShippedWithCarrier) {} }"),
    ).toEqual([]);
  });

  it('stays silent for a this parameter beside an empty sibling', () => {
    expect(
      findingsFor('listener.ts', "export class OrderCreated extends DomainEvent {}\nexport class Listener { @OnEvent('order.shipped') on(this: Listener, event: OrderCreated) {} }"),
    ).toEqual([]);
  });

  it('stays silent for an overloaded handler of a comparable type', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderCreated extends DomainEvent {}\nexport class Listener {\n  on(event: OrderCreated): void;\n  @OnEvent('order.shipped') on(event: OrderCreated): void {}\n}",
      ),
    ).toEqual([]);
  });

  it('stays silent for an optional parameter of a comparable type', () => {
    expect(findingsFor('listener.ts', "export class OrderCreated extends DomainEvent {}\nexport class Listener { @OnEvent('order.shipped') on(event?: OrderCreated) {} }")).toEqual([]);
  });

  it('stays silent for a parameter typed with an abstract class the event implements', () => {
    expect(
      findingsFor('listener.ts', "import { OrderEvent } from './events';\nexport class Listener { @OnEvent('order.*') record(event: OrderEvent) {} }", ABSTRACT_EVENTS),
    ).toEqual([]);
  });

  it('stays silent when one overload is comparable and another is not', () => {
    expect(
      findingsFor(
        'listener.ts',
        `${INCOMPATIBLE_CREATED}export class OrderShippedEvent { constructor(readonly orderId: string, readonly carrier: string, readonly occurredAt: Date) {} }\nexport class Listener {\n  on(event: OrderCreated): void;\n  on(event: OrderShippedEvent): void;\n  @OnEvent('order.created') on(event: OrderCreated | OrderShippedEvent): void {}\n}`,
        CARRIER_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent when one overload is untyped', () => {
    expect(
      findingsFor(
        'listener.ts',
        `${INCOMPATIBLE_CREATED}export class Listener {\n  on(event: OrderCreated): void;\n  on(event: any): void;\n  @OnEvent('order.created') on(event: OrderCreated): void {}\n}`,
        CARRIER_EVENTS,
      ),
    ).toEqual([]);
  });

  it('reports an event whose type is incomparable with the handler parameter', () => {
    expect(findingsFor('listener.ts', `${INCOMPATIBLE_CREATED}export class Listener { @OnEvent('order.created') onCreated(event: OrderCreated) {} }`, CARRIER_EVENTS)).toEqual([
      'Shipped',
    ]);
  });

  it('reports an event when the only unresolved handler is in a test file', () => {
    expect(findingsFor('listener.spec.ts', "export class Listener { @OnEvent('order.created') onCreated(event) {} }", CARRIER_EVENTS)).toEqual(['Shipped']);
  });

  it('reports an event whose type is incomparable with a registered callback parameter', () => {
    expect(findingsFor('listener.ts', `${INCOMPATIBLE_CREATED}DomainEvents.register((event: OrderCreated) => undefined, 'order.created');`, CARRIER_EVENTS)).toEqual(['Shipped']);
  });

  it('stays silent for a registered callback typed with a structurally identical class', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderShippedEvent { constructor(readonly orderId: string, readonly occurredAt: Date) {} }\nDomainEvents.register((event: OrderShippedEvent) => undefined, 'order.created');",
      ),
    ).toEqual([]);
  });

  it('stays silent for a generic base handler typed with a readonly type parameter', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export abstract class Base<E extends DomainEvent> { @OnEvent('order.*') on(event: Readonly<E>): void {} }\nexport class ShippedListener extends Base<Shipped> {}",
      ),
    ).toEqual([]);
  });

  it('stays silent for a generic base handler typed with an envelope of a type parameter', () => {
    expect(
      findingsFor(
        'listener.ts',
        "import { Envelope } from './events';\nexport abstract class Base<T> { @OnEvent('order.shipped') on(event: Envelope<T>): void {} }\nexport class ShippedListener extends Base<{ id: string }> {}",
        ENVELOPE_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a generic base handler typed with an intersection over a type parameter', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export abstract class Base<T> { @OnEvent('order.shipped') on(event: Partial<T> & { orderId: string }): void {} }\nexport class ShippedListener extends Base<Shipped> {}",
        CARRIER_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a same-shape class with a private member', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderShipped { private readonly marker = 1; constructor(readonly orderId: string, readonly occurredAt: Date) {} }\nexport class Listener { @OnEvent('order.shipped') on(event: OrderShipped) {} }",
        MARKED_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a same-shape class with a private member declared in a declaration file', () => {
    expect(
      findingsFor(
        'listener.ts',
        "import { Shipped as ContractShipped } from './contracts';\nexport class Listener { @OnEvent('order.shipped') on(event: ContractShipped) {} }",
        MARKED_EVENTS,
        { '/app/src/contracts.d.ts': DECLARED_CONTRACTS },
      ),
    ).toEqual([]);
  });

  it('stays silent for a same-shape class with a private name', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderShipped { #marker = 1; constructor(readonly orderId: string, readonly occurredAt: Date) {} }\nexport class Listener { @OnEvent('order.shipped') on(event: OrderShipped) {} }",
        PRIVATE_NAME_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a registered callback whose parameter type is only inferred', () => {
    expect(
      findingsFor(
        'listener.ts',
        "interface Named { name: string }\ndeclare const Bus: { register: (h: (e: Named) => void, key: string) => void };\nBus.register((event) => undefined, 'order.shipped');",
      ),
    ).toEqual([]);
  });

  it('stays silent for an untyped destructured parameter', () => {
    expect(findingsFor('listener.ts', "export class Listener { @OnEvent('order.shipped') on({ id }) {} }")).toEqual([]);
  });

  it('stays silent for a parameter typed only by its default value', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class Other { constructor(readonly code: number) {} }\nexport class Listener { @OnEvent('order.shipped') on(event = new Other(1)) {} }",
      ),
    ).toEqual([]);
  });
});
