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

const BODY_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { constructor(readonly body: string, readonly carrier: string) { super(); } }
`;

const META_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Meta { private readonly x = 1; readonly at = 1; }
export class Shipped { constructor(readonly orderId: string, readonly meta: Meta) {} }
`;

const GENERIC_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped<T = unknown> { constructor(readonly body: T, readonly c?: string) {} }
`;

const LITERAL_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped { readonly type = 'shipped'; constructor(readonly orderId: string) {} }
`;

const ENUM_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export enum Kind { Shipped = 'shipped', Created = 'created' }
export class Shipped { readonly kind = Kind.Shipped; constructor(readonly orderId: string) {} }
`;

const PROTECTED_BASE_EVENTS = `
export class DomainEvent { protected readonly occurredAt = new Date(); }
export class Shipped extends DomainEvent { constructor(readonly orderId: string) { super(); } }
`;

const PRIVATE_PARAMETER_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped { constructor(private readonly orderId: string) {} }
`;

const UNRESOLVED_PROPERTY_EVENTS = `
export class DomainEvent { readonly occurredAt = new Date(); }
export class Shipped { constructor(readonly orderId: string, readonly meta: NotDeclared) {} }
`;

const SHIPPED_MESSAGE = 'export interface ShippedMessage { topic: string; payload: Shipped }\n';

const ISSUE_CREATED = 'export class OrderCreated { constructor(readonly orderId: string, readonly customerId: string) {} }\n';

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

  it('stays silent for a callback typed with a local alias over a function type parameter', () => {
    expect(
      findingsFor('listener.ts', "export function make<T>() { type W = { body: T }; DomainEvents.register((e: W) => undefined, 'order.shipped'); }", CARRIER_EVENTS),
    ).toEqual([]);
  });

  it('stays silent for a callback typed with a local alias over a body-compatible type parameter', () => {
    expect(
      findingsFor('listener.ts', "export function make<T>() { type W = { body: T }; DomainEvents.register((e: W) => undefined, 'order.shipped'); }", BODY_EVENTS),
    ).toEqual([]);
  });

  it('stays silent for a callback typed with a local alias over a class type parameter', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class B<T> { wire() { type W = { orderId: T }; DomainEvents.register((e: W) => undefined, 'order.shipped'); } }",
        CARRIER_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a callback typed with typeof a generic value', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export function f<T>(sample: T) { DomainEvents.register((e: { orderId: typeof sample }) => undefined, 'order.shipped'); }",
        CARRIER_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a literal type whose property has a private member', () => {
    expect(
      findingsFor(
        'listener.ts',
        "class Meta { private readonly x = 1; readonly at = 1; }\nexport class Listener { @OnEvent('order.shipped') on(e: { meta: Meta }) {} }",
        META_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a class whose property has a private member', () => {
    expect(
      findingsFor(
        'listener.ts',
        "class Meta { private readonly x = 1; readonly at = 1; }\nclass OS { orderId!: string; meta!: Meta }\nexport class Listener { @OnEvent('order.shipped') on(e: OS) {} }",
        META_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a generic event class', () => {
    expect(findingsFor('listener.ts', "export class Listener { @OnEvent('order.shipped') on(e: { body: string }) {} }", GENERIC_EVENTS)).toEqual([]);
  });

  it('reports an event whose type is incomparable with a built-in object type annotation', () => {
    expect(findingsFor('listener.ts', "export class Listener { @OnEvent('order.shipped') on(e: Function) {} }", CARRIER_EVENTS)).toEqual(['Shipped']);
  });

  it('stays silent for an envelope interface whose property is the event', () => {
    expect(findingsFor('listener.ts', `${SHIPPED_MESSAGE}export class Listener { @OnEvent('order.shipped') on(message: ShippedMessage) {} }`)).toEqual([]);
  });

  it('stays silent for an array alias of the event', () => {
    expect(findingsFor('listener.ts', "export type ShippedBatch = readonly Shipped[];\nexport class Listener { @OnEvent('order.shipped') on(batch: ShippedBatch) {} }")).toEqual([]);
  });

  it('stays silent for a generic envelope alias over the event', () => {
    expect(
      findingsFor(
        'listener.ts',
        "interface Envelope<P> { topic: string; payload: P }\nexport type ShippedEnvelope = Envelope<Shipped>;\nexport class Listener { @OnEvent('order.shipped') on(message: ShippedEnvelope) {} }",
      ),
    ).toEqual([]);
  });

  it('stays silent for an envelope interface imported from another file', () => {
    expect(
      findingsFor(
        'listener.ts',
        "import { ShippedMessage } from './messages';\nexport class Listener { @OnEvent('order.shipped') on(message: ShippedMessage) {} }",
        SHIPPED_EVENTS,
        { '/app/src/messages.ts': `import { Shipped } from './events';\n${SHIPPED_MESSAGE}` },
      ),
    ).toEqual([]);
  });

  it('stays silent for a parameter type with an unresolved property type', () => {
    expect(findingsFor('listener.ts', "export class Listener { @OnEvent('order.shipped') on(event: { orderId: string; meta: NotDeclared }) {} }")).toEqual([]);
  });

  it('stays silent for a parameter interface extending an unresolved import', () => {
    expect(
      findingsFor(
        'listener.ts',
        "import { LibEvent } from 'missing-lib';\nexport interface ShippedLike extends LibEvent { carrier: string }\nexport class Listener { @OnEvent('order.shipped') on(event: ShippedLike) {} }",
      ),
    ).toEqual([]);
  });

  it('stays silent for a parameter interface whose base extends an unresolved import', () => {
    expect(
      findingsFor(
        'listener.ts',
        "import { LibEvent } from 'missing-lib';\ninterface Base extends LibEvent {}\nexport interface ShippedLike extends Base { carrier: string }\nexport class Listener { @OnEvent('order.shipped') on(event: ShippedLike) {} }",
      ),
    ).toEqual([]);
  });

  it('stays silent for an event with an unresolved property type', () => {
    expect(
      findingsFor('listener.ts', "export interface ShippedDto { id: string; at: string }\nexport class Listener { @OnEvent('order.shipped') on(dto: ShippedDto) {} }", UNRESOLVED_PROPERTY_EVENTS),
    ).toEqual([]);
  });

  it('stays silent for a sibling event that differs only in a string discriminant', () => {
    expect(
      findingsFor(
        'listener.ts',
        "export class OrderCreated { readonly type = 'created'; constructor(readonly orderId: string) {} }\nexport class Listener { @OnEvent(['order.created', 'order.shipped']) on(event: OrderCreated) {} }",
        LITERAL_EVENTS,
      ),
    ).toEqual([]);
  });

  it('stays silent for a parameter type that differs only in an enum member discriminant', () => {
    expect(
      findingsFor('listener.ts', "import { Kind } from './events';\nexport class Listener { @OnEvent('order.shipped') on(event: { kind: Kind.Created; orderId: string }) {} }", ENUM_EVENTS),
    ).toEqual([]);
  });

  it('stays silent for an event with an inherited protected member', () => {
    expect(
      findingsFor('listener.ts', "interface Shape { orderId: string; occurredAt: Date }\nexport class Listener { @OnEvent('order.shipped') on(event: Shape) {} }", PROTECTED_BASE_EVENTS),
    ).toEqual([]);
  });

  it('stays silent for an event with a private parameter property', () => {
    expect(findingsFor('listener.ts', "interface Shape { orderId: string }\nexport class Listener { @OnEvent('order.shipped') on(event: Shape) {} }", PRIVATE_PARAMETER_EVENTS)).toEqual([]);
  });

  it('reports an event incomparable with a consumer-owned class of other fields', () => {
    expect(findingsFor('listener.ts', `${ISSUE_CREATED}export class Listener { @OnEvent('order.created') on(event: OrderCreated) {} }`)).toEqual(['Shipped']);
  });

  it('reports an event incomparable with a callback registered in a constructor', () => {
    expect(
      findingsFor(
        'listener.ts',
        `${ISSUE_CREATED}export class Bus { register(_h: (e: unknown) => void, _k: unknown): void {} }\nexport class Listener { constructor(bus: Bus) { bus.register((e: OrderCreated) => console.log(e.customerId), 'order.created'); } }`,
      ),
    ).toEqual(['Shipped']);
  });

  it('reports an event incomparable with a trusted data transfer interface', () => {
    expect(
      findingsFor('listener.ts', "export interface ShippedDto { id: string; at: string }\nexport class Listener { @OnEvent('order.shipped') on(dto: ShippedDto) {} }"),
    ).toEqual(['Shipped']);
  });

  it('reports an event with a discriminant incomparable with a trusted data transfer interface', () => {
    expect(
      findingsFor('listener.ts', "export interface ShippedDto { type: string; id: string }\nexport class Listener { @OnEvent('order.shipped') on(dto: ShippedDto) {} }", LITERAL_EVENTS),
    ).toEqual(['Shipped']);
  });

  it('reports an event incomparable with a data transfer interface that has a method', () => {
    expect(
      findingsFor('listener.ts', "export interface ShippedDto { type: string; id: string; toJSON(): object }\nexport class Listener { @OnEvent('order.shipped') on(dto: ShippedDto) {} }", LITERAL_EVENTS),
    ).toEqual(['Shipped']);
  });
});
