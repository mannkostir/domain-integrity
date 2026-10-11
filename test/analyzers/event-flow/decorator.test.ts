import { describe, expect, it } from 'vitest';
import { decoratorRecogniser } from '../../../src/analyzers/event-flow/registrations/decorator';
import { recognise } from './recognise';

const EVENTS = `
export class Paid { readonly paidAt = 1; }
export class Failed { readonly reason = ''; }
export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;
export const OnEvent = (...args: unknown[]) => (target: unknown, key: string) => target;
export const HandleEvent = (event: unknown) => (target: unknown) => target;
`;

const run = (handlers: string, handlerDecorators?: readonly string[]) =>
  recognise(decoratorRecogniser, {
    '/src/events.ts': EVENTS,
    '/src/handlers.ts': `import { Paid, Failed, EventsHandler, OnEvent, HandleEvent } from './events';\nimport { LibraryEvent } from '../types/lib';\ndeclare const someKey: unknown; declare const deco: ((target: unknown) => unknown)[]; declare const curry: () => () => (target: unknown) => unknown; declare const ns: { EventsHandler: typeof EventsHandler };\n${handlers}`,
  }, handlerDecorators ? { handlerDecorators } : {});

describe('decoratorRecogniser', () => {
  it('reads a class decorator with its handle payload', () => {
    expect(run('@EventsHandler(Paid) export class PaidHandler { handle(event: Paid) {} }')).toEqual(['Paid -> PaidHandler.handle (Paid)']);
  });

  it('reads every argument of a multi-event class decorator', () => {
    expect(run('@EventsHandler(Paid, Failed) export class Both { handle(event: Paid | Failed) {} }')).toEqual([
      'Paid -> Both.handle (Paid|Failed), Failed -> Both.handle (Paid|Failed)',
    ]);
  });

  it('reads a method decorator keyed by name', () => {
    expect(run('export class Listener { @OnEvent(Paid.name) onPaid(event: Failed) {} }')).toEqual(['Paid -> Listener.onPaid (Failed)']);
  });

  it('marks a site with any unresolvable argument as unresolved and keeps none of its keys', () => {
    expect(run("@EventsHandler(Paid, someKey) export class Mixed { handle(event: Paid) {} }\nexport class Topic { @OnEvent('order.*') on() {} }")).toEqual([
      'unresolved@4 (Paid)',
      'unresolved@5',
    ]);
  });

  it('carries the handler payload of an unresolved site', () => {
    expect(
      run("export class Listener { @OnEvent('order.created') onCreated(event: Paid) {} @OnEvent('order.failed') onFailed(event: Paid | Failed) {} @OnEvent('order.any') onAny(event) {} }"),
    ).toEqual(['unresolved@4 (Paid)', 'unresolved@4 (Paid | Failed)', 'unresolved@4']);
  });

  it('bounds an unresolved site by every overload and the implementation', () => {
    expect(run("export class Listener {\n  on(e: Paid): void;\n  on(e: Failed): void;\n  @OnEvent('x') on(e: Paid | Failed): void {}\n}")).toEqual([
      'unresolved@7 (Paid, Failed, Paid | Failed)',
    ]);
  });

  it('reads an optional parameter of an unresolved site as its type', () => {
    expect(run("export class Listener { @OnEvent('x') on(e?: Paid) {} }")).toEqual(['unresolved@4 (Paid)']);
  });

  it('leaves an unresolved site unbounded for a parameter that constrains nothing', () => {
    expect(
      run(
        "export class Empty {}\nexport class Listener { @OnEvent('x') a(e: {}) {} @OnEvent('x') b(e: object) {} @OnEvent('x') c<T>(e: T) {} @OnEvent('x') d(e: unknown) {} @OnEvent('x') f(e: Paid | Empty) {} @OnEvent('x') g(e: { a?: number }) {} @OnEvent('x') h(...e: Paid[]) {} @OnEvent('x') i(e: Missing) {} }",
      ),
    ).toEqual(['unresolved@5', 'unresolved@5', 'unresolved@5', 'unresolved@5', 'unresolved@5', 'unresolved@5', 'unresolved@5', 'unresolved@5']);
  });

  it('leaves an unresolved site unbounded when any overload constrains nothing', () => {
    expect(run("export class Listener {\n  on(e: Paid): void;\n  on(e: unknown): void;\n  @OnEvent('x') on(e: unknown): void {}\n}")).toEqual(['unresolved@7']);
  });

  it('ignores a this parameter when reading the payload of an unresolved site', () => {
    expect(run("export class Listener { @OnEvent('x') on(this: Listener, e: Paid) {} }")).toEqual(['unresolved@4 (Paid)']);
  });

  it('leaves the payload of an unresolved site with several parameters unreadable', () => {
    expect(run("export class Listener { @OnEvent('x') on(meta: Failed, e: Paid) {} }")).toEqual(['unresolved@4']);
  });

  it('ignores a this parameter when reading the payload of a resolved site', () => {
    expect(run('export class Listener { @OnEvent(Paid) on(this: Listener, e: Failed) {} }')).toEqual(['Paid -> Listener.on (Failed)']);
  });

  it('registers nothing for a library event key but notes it', () => {
    expect(
      run('@EventsHandler(LibraryEvent) export class External { handle(event: LibraryEvent) {} }\n@EventsHandler(Paid, LibraryEvent) export class Mixed { handle(event: Paid) {} }'),
    ).toEqual(['library', 'Paid -> Mixed.handle (Paid), library']);
  });

  it('ignores decorators that are not configured and reads configured ones', () => {
    expect({
      defaults: run('@HandleEvent(Paid) export class Custom { handle(event: Paid) {} }'),
      configured: run('@HandleEvent(Paid) export class Custom { handle(event: Paid) {} }', ['HandleEvent']),
    }).toEqual({ defaults: [], configured: ['Paid -> Custom.handle (Paid)'] });
  });

  it('cannot read the payload of a class without exactly one handle method', () => {
    expect(run('@EventsHandler(Paid) export class NoHandle { run(event: Paid) {} }')).toEqual(['Paid -> NoHandle.- (?)']);
  });

  it('reads no site from a decorator whose name cannot be read, without crashing', () => {
    expect(run('@(deco[0]!) export class Indexed { handle(event: Paid) {} }\n@curry()() export class Curried { handle(event: Paid) {} }')).toEqual([]);
  });

  it('reads a decorator reached through a namespace', () => {
    expect(run('@ns.EventsHandler(Paid) export class Namespaced { handle(event: Paid) {} }')).toEqual(['Paid -> Namespaced.handle (Paid)']);
  });

  it('skips object-literal options when reading keys', () => {
    expect(run('export class Listener { @OnEvent(Paid.name, { async: true }) onPaid(event: Paid) {} }')).toEqual(['Paid -> Listener.onPaid (Paid)']);
  });

  it('marks a decorator with only object-literal arguments unresolved', () => {
    expect(run('export class Listener { @OnEvent({ async: true }) onPaid(event: Paid) {} }')).toEqual(['unresolved@4 (Paid)']);
  });
});
