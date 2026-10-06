import { describe, expect, it } from 'vitest';
import { registerCallRecogniser } from '../../../src/analyzers/event-flow/registrations/register-call';
import { recognise } from './recognise';

const run = (body: string) =>
  recognise(registerCallRecogniser, {
    '/src/events.ts': 'export class Paid {}\nexport class Failed {}\nexport class Logger {}\nexport class AppConfig {}\nexport class Db { constructor(config: AppConfig) {} }',
    '/src/use.ts': `import { Paid, Failed, Logger, AppConfig, Db } from './events';\nimport { LibraryEvent } from '../types/lib';\ndeclare const DomainEvents: { register: (...args: unknown[]) => void }; declare const container: { register: (...args: unknown[]) => void }; declare const SomeModule: { register: (...args: unknown[]) => void }; declare const callback: (event: Paid) => void; declare const topic: string; declare const x: Logger;\n${body}`,
  });

describe('registerCallRecogniser', () => {
  it('reads a bound method callback keyed by name', () => {
    expect(run('export class AfterPaid { constructor() { DomainEvents.register(this.onPaid.bind(this), Paid.name); } onPaid(event: Failed) {} }')).toEqual([
      'Paid -> AfterPaid.onPaid (Failed)',
    ]);
  });

  it('reads an unbound method reference', () => {
    expect(run('export class AfterPaid { constructor() { DomainEvents.register(this.onPaid, Paid); } onPaid(event: Paid) {} }')).toEqual([
      'Paid -> AfterPaid.onPaid (Paid)',
    ]);
  });

  it('reads an inline arrow callback outside a class', () => {
    expect(run('DomainEvents.register((event: Paid) => undefined, Paid.name);')).toEqual(['Paid -> -.- (Paid)']);
  });

  it('reads a function expression callback', () => {
    expect(run('DomainEvents.register(function (event: Paid) { return event; }, Paid.name);')).toEqual(['Paid -> -.- (Paid)']);
  });

  it('marks a callback registration with a key that is not a class unresolved', () => {
    expect(
      run("export class AfterPaid { constructor() { DomainEvents.register(this.onPaid.bind(this), 'paid.topic'); } onPaid(event: Paid) {} }\nDomainEvents.register((event: Paid) => undefined, topic);"),
    ).toEqual(['unresolved@4', 'unresolved@5']);
  });

  it('reads no site from a call without a callback first and a key second', () => {
    expect(
      run(
        [
          'container.register(Logger, { useValue: x });',
          'container.register(Db, (config: AppConfig) => new Db(config));',
          "container.register('token', {});",
          'SomeModule.register({ a: 1 });',
          'DomainEvents.register(Paid.name);',
          'DomainEvents.register(Paid, Failed);',
          'DomainEvents.register(callback, Paid.name);',
          'DomainEvents.register((event: Paid) => undefined, Paid.name, Failed);',
          'export class AfterPaid { constructor(other: object) { DomainEvents.register(this.onPaid.bind(other), Paid.name); } onPaid(event: Paid) {} }',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('ignores a library event key', () => {
    expect(run('DomainEvents.register((event: LibraryEvent) => undefined, LibraryEvent.name);')).toEqual([]);
  });
});
