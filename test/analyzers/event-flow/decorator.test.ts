import { describe, expect, it } from 'vitest';
import { decoratorRecogniser } from '../../../src/analyzers/event-flow/registrations/decorator';
import { recognise } from './recognise';

const EVENTS = `
export class Paid {}
export class Failed {}
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
      'unresolved@4',
      'unresolved@5',
    ]);
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
    expect(run('export class Listener { @OnEvent({ async: true }) onPaid(event: Paid) {} }')).toEqual(['unresolved@4']);
  });
});
