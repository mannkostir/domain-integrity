import { describe, expect, it } from 'vitest';
import { extractEventFlows } from '../../../../src/analyzers/event-flow/extract';
import { UndispatchedBuffer } from '../../../../src/analyzers/event-flow/model';
import { readDeclaration } from '../../../../src/engine/read-config';
import { inMemoryProject } from '../../../helpers/in-memory';

const BASE = `export abstract class AggregateRoot {
  private _domainEvents: object[] = [];
  get domainEvents(): object[] { return this._domainEvents; }
  protected addDomainEvent(event: object): void { this._domainEvents.push(event); }
  clearEvents(): void { this._domainEvents = []; }
}`;
const BOOKING = `import { AggregateRoot } from './aggregate-root';
export class Booked {}
export class Booking extends AggregateRoot {
  static create(): Booking { const booking = new Booking(); booking.addDomainEvent(new Booked()); return booking; }
}`;
const PAYMENT = `import { AggregateRoot } from './aggregate-root';
export class Paid {}
export class Payment extends AggregateRoot { pay(): void { this.addDomainEvent(new Paid()); } }`;

const BUS = 'const handlers: ((event: object) => void)[] = [];\nexport const publish = (event: object): void => { handlers.forEach((handle) => handle(event)); };';
const DISPATCH = 'export declare function dispatchEventsOf(entity: object): void;';

const DEFAULT_CONFIG = 'defineDomain({})';

const ANALYSED = '/app/src/';

const buffersOf = (
  sources: Readonly<Record<string, string>>,
  config: string = DEFAULT_CONFIG,
  analysed: string = ANALYSED,
): readonly UndispatchedBuffer[] => {
  const project = inMemoryProject({
    ...sources,
    '/app/domain.config.ts': config.startsWith('import') ? config : `import { defineDomain } from 'domain-integrity';\nexport default ${config};`,
  });
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith(analysed));
  const configFile = project.getSourceFileOrThrow('/app/domain.config.ts');
  return extractEventFlows({ declaration: readDeclaration(configFile), files, root: '/app', configFile }).buffers;
};

const booking = (extra: Readonly<Record<string, string>> = {}, base: string = BASE): Readonly<Record<string, string>> => ({
  '/app/src/aggregate-root.ts': base,
  '/app/src/booking.ts': BOOKING,
  '/app/src/payment.ts': PAYMENT,
  ...extra,
});

const BOOKING_BUFFER: UndispatchedBuffer = {
  ownerId: 'AggregateRoot',
  owner: 'AggregateRoot',
  buffer: '_domainEvents',
  method: 'addDomainEvent',
  raisers: ['Booking', 'Payment'],
  file: '/app/src/aggregate-root.ts',
  line: 2,
};

const rootSource = (name: string): string =>
  `export abstract class ${name} { private events: object[] = []; protected addEvent(e: object): void { this.events.push(e); } }`;

const raiserSource = (name: string, root: string, file: string): string =>
  `import { ${root} } from './${file}';\nexport class ${name} extends ${root} { act(): void { this.addEvent({}); } }`;

const DOMAIN = '/app/src/domain/';

const domainBooking = (extra: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
  '/app/src/domain/aggregate-root.ts': BASE,
  '/app/src/domain/booking.ts': BOOKING,
  ...extra,
});

describe('undispatchedBuffers', () => {
  it('reports one buffer with every raiser for the booking shape', () => {
    expect(buffersOf(booking())).toEqual([BOOKING_BUFFER]);
  });

  it('stays silent when a project file outside the analysed files reads the getter', () => {
    const dispatch = "import { Booking } from '../src/booking';\nexport const dispatch = (booking: Booking) => booking.domainEvents;";

    expect(buffersOf(booking({ '/app/scripts/dispatch.ts': dispatch }))).toEqual([]);
  });

  it('still reports the buffer when only a test file reads the getter', () => {
    const spec = "import { Booking } from './booking';\nexport const read = () => Booking.create().domainEvents;";

    expect(buffersOf(booking({ '/app/src/booking.spec.ts': spec }))).toEqual([BOOKING_BUFFER]);
  });

  it('stays silent when the event method is called only from a test file', () => {
    const payment = "import { AggregateRoot } from './aggregate-root';\nexport class Payment extends AggregateRoot {}";
    const spec = "import { Payment } from './payment';\nexport class RaisingPayment extends Payment { raise(): void { this.addDomainEvent({}); } }";

    expect(buffersOf({ '/app/src/aggregate-root.ts': BASE, '/app/src/payment.ts': payment, '/app/src/payment.spec.ts': spec })).toEqual([]);
  });

  it('stays silent when the event method does more than push', () => {
    const base = BASE.replace('this._domainEvents.push(event); }', 'this._domainEvents.push(event); console.log(event); }');

    expect(buffersOf(booking({}, base))).toEqual([]);
  });

  it('stays silent for a protected buffer', () => {
    expect(buffersOf(booking({}, BASE.replace('private _domainEvents', 'protected _domainEvents')))).toEqual([]);
  });

  it('stays silent when the base class extends a library class', () => {
    const base = `import { LibraryBase } from '../../lib/base';\n${BASE.replace('class AggregateRoot {', 'class AggregateRoot extends LibraryBase {')}`;

    expect(buffersOf(booking({ '/lib/base.d.ts': 'export declare class LibraryBase {}' }, base))).toEqual([]);
  });

  it('stays silent when the base class extends a mixin call', () => {
    const mixin = 'export const Mixin = (base: new () => object) => class extends base {};';
    const base = `import { Mixin } from './mixin';\n${BASE.replace('class AggregateRoot {', 'class AggregateRoot extends Mixin(Object) {')}`;

    expect(buffersOf(booking({ '/app/src/mixin.ts': mixin }, base))).toEqual([]);
  });

  it('stays silent when a subclass is decorated', () => {
    const entity = 'export const Entity = () => (target: unknown) => target;';
    const payment = `import { Entity } from './entity';\n${PAYMENT.replace('export class Payment', '@Entity() export class Payment')}`;

    expect(buffersOf(booking({ '/app/src/entity.ts': entity, '/app/src/payment.ts': payment }))).toEqual([]);
  });

  it('stays silent when no event methods are configured', () => {
    expect(buffersOf(booking(), 'defineDomain({ eventMethods: [] })')).toEqual([]);
  });

  it('reports independent roots separately with their own raisers', () => {
    const sources = {
      '/app/src/root-a.ts': rootSource('RootA'),
      '/app/src/a.ts': raiserSource('A', 'RootA', 'root-a'),
      '/app/src/root-b.ts': rootSource('RootB'),
      '/app/src/b.ts': raiserSource('B', 'RootB', 'root-b'),
    };

    expect(buffersOf(sources)).toEqual([
      { ownerId: 'RootA', owner: 'RootA', buffer: 'events', method: 'addEvent', raisers: ['A'], file: '/app/src/root-a.ts', line: 1 },
      { ownerId: 'RootB', owner: 'RootB', buffer: 'events', method: 'addEvent', raisers: ['B'], file: '/app/src/root-b.ts', line: 1 },
    ]);
  });

  it('stays silent when the event method is declared only in a library', () => {
    const library = 'export declare abstract class AggregateRoot {\n  private _domainEvents;\n  protected addDomainEvent(event: object): void;\n}';
    const sources = {
      '/lib/base.d.ts': library,
      '/app/src/booking.ts': BOOKING.replace("from './aggregate-root'", "from '../../lib/base'"),
    };

    expect(buffersOf(sources)).toEqual([]);
  });

  it('stays silent when production code reads the aggregate reflectively', () => {
    const inspect = "import { Booking } from './booking';\nexport const inspect = (booking: Booking) => Object.values(booking);";

    expect(buffersOf(booking({ '/app/src/inspect.ts': inspect }))).toEqual([]);
  });

  it('stays silent when a subclass outside the analysed files is decorated', () => {
    const entity = [
      "import { Booking } from '../domain/booking';",
      'const Entity = () => (target: unknown) => target;',
      '@Entity() export class BookingEntity extends Booking {}',
    ].join('\n');

    expect(buffersOf(domainBooking({ '/app/src/infra/booking-entity.ts': entity }), DEFAULT_CONFIG, DOMAIN)).toEqual([]);
  });

  it('stays silent when a subclass outside the analysed files reaches a library function', () => {
    const entity = [
      "import { Booking } from '../domain/booking';",
      "import { save } from '../../../lib/orm';",
      'export class BookingEntity extends Booking {}',
      'export const persist = (entity: BookingEntity) => save(entity);',
    ].join('\n');
    const orm = 'export declare function save(value: { id?: string }): void;';

    expect(buffersOf(domainBooking({ '/lib/orm.d.ts': orm, '/app/src/infra/booking-entity.ts': entity }), DEFAULT_CONFIG, DOMAIN)).toEqual([]);
  });

  it('stays silent when a subclass outside the analysed files reads itself reflectively', () => {
    const entity = [
      "import { Booking } from '../domain/booking';",
      'export class BookingEntity extends Booking { dump(): unknown[] { return Object.values(this); } }',
    ].join('\n');

    expect(buffersOf(domainBooking({ '/app/src/infra/booking-entity.ts': entity }), DEFAULT_CONFIG, DOMAIN)).toEqual([]);
  });

  it('stays silent when the event method also pushes onto a buffer that production reads', () => {
    const root = [
      'export abstract class Root {',
      '  private a: object[] = [];',
      '  private b: object[] = [];',
      '  protected addEvent(e: object): void { this.a.push(e); this.b.push(e); }',
      '  flush(bus: { publishAll(events: object[]): void }): void { bus.publishAll(this.b); }',
      '}',
    ].join('\n');

    expect(buffersOf({ '/app/src/root.ts': root, '/app/src/a.ts': raiserSource('A', 'Root', 'root') })).toEqual([]);
  });

  it('stays silent when a subclass overrides the event method to push and publish', () => {
    const overriding = [
      "import { AggregateRoot } from './aggregate-root';",
      "import { publish } from './bus';",
      'export class Booked {}',
      'export class Booking extends AggregateRoot {',
      '  static create(): Booking { const booking = new Booking(); booking.addDomainEvent(new Booked()); return booking; }',
      '  protected override addDomainEvent(event: object): void { super.addDomainEvent(event); publish(event); }',
      '}',
    ].join('\n');

    expect(buffersOf(booking({ '/app/src/bus.ts': BUS, '/app/src/booking.ts': overriding }))).toEqual([]);
  });

  it('stays silent when a subclass overrides the event method to publish instead of push', () => {
    const base = BASE.replace('clearEvents()', 'protected raise(event: object): void { this.addDomainEvent(event); }\n  clearEvents()');
    const overriding = [
      "import { AggregateRoot } from './aggregate-root';",
      "import { publish } from './bus';",
      'export class Booked {}',
      'export class Booking extends AggregateRoot {',
      '  ship(): void { this.raise(new Booked()); }',
      '  protected override addDomainEvent(event: object): void { publish(event); }',
      '}',
    ].join('\n');

    expect(buffersOf({ '/app/src/aggregate-root.ts': base, '/app/src/bus.ts': BUS, '/app/src/booking.ts': overriding })).toEqual([]);
  });

  it('stays silent when a mixin-derived subclass reaches a library function', () => {
    const mixin = [
      'export type Ctor<T = object> = abstract new (...args: any[]) => T;',
      'export function Timestamped<B extends Ctor>(base: B) {',
      '  abstract class Stamped extends base { createdAt = new Date(); }',
      '  return Stamped;',
      '}',
    ].join('\n');
    const mixed = [
      "import { AggregateRoot } from './aggregate-root';",
      "import { Timestamped } from './mixin';",
      'export class Booked {}',
      'export class Booking extends Timestamped(AggregateRoot) { book(): void { this.addDomainEvent(new Booked()); } }',
    ].join('\n');
    const service = "import { dispatchEventsOf } from '../../lib/dispatch';\nimport { Booking } from './booking';\nexport const place = (booking: Booking): void => { booking.book(); dispatchEventsOf(booking); };";

    expect(
      buffersOf(booking({ '/lib/dispatch.d.ts': DISPATCH, '/app/src/mixin.ts': mixin, '/app/src/booking.ts': mixed, '/app/src/service.ts': service })),
    ).toEqual([]);
  });

  it('stays silent when a grandchild subclass reaches a library function', () => {
    const grandchild = "import { Booking } from './booking';\nexport class SpecialBooking extends Booking {}";
    const service = "import { dispatchEventsOf } from '../../lib/dispatch';\nimport { SpecialBooking } from './special-booking';\nexport const place = (booking: SpecialBooking): void => dispatchEventsOf(booking);";

    expect(
      buffersOf(booking({ '/lib/dispatch.d.ts': DISPATCH, '/app/src/special-booking.ts': grandchild, '/app/src/service.ts': service })),
    ).toEqual([]);
  });

  it('still reports the buffer when the config hands a family class to a library-declared defineDomain', () => {
    const published = [
      "export type LifecycleDeclaration = { readonly kind: 'lifecycle'; readonly target: object; readonly spec: object };",
      'export declare const lifecycle: <T extends object>(target: { readonly prototype: T }, spec: { readonly states: Readonly<Record<string, { readonly terminal: readonly string[] }>> }) => LifecycleDeclaration;',
      'export declare const defineDomain: (config: { readonly lifecycles?: readonly LifecycleDeclaration[] }) => object;',
    ].join('\n');
    const config = [
      "import { defineDomain, lifecycle } from '../lib/published';",
      "import { Booking } from './src/booking';",
      'export default defineDomain({ lifecycles: [lifecycle(Booking, { states: { status: { terminal: [] } } })] });',
    ].join('\n');

    expect(buffersOf(booking({ '/lib/published.d.ts': published }), config)).toEqual([BOOKING_BUFFER]);
  });
});
