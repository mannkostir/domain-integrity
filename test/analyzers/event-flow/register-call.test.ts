import { describe, expect, it } from 'vitest';
import { registerCallRecogniser } from '../../../src/analyzers/event-flow/registrations/register-call';
import { recognise } from './recognise';

const run = (body: string) =>
  recognise(registerCallRecogniser, {
    '/src/events.ts': 'export class Paid {}\nexport class Failed {}',
    '/src/use.ts': `import { Paid, Failed } from './events';\nimport { LibraryEvent } from '../types/lib';\ndeclare const DomainEvents: { register: (...args: unknown[]) => void };\ndeclare const container: { register: (...args: unknown[]) => void };\n${body}`,
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

  it('keeps the registration but not the payload of an opaque callback', () => {
    expect(run('declare const callback: (event: Paid) => void;\nDomainEvents.register(callback, Paid.name);')).toEqual(['Paid -> -.- (?)']);
  });

  it('treats a callback bound to something other than this as opaque', () => {
    expect(run('export class AfterPaid { constructor(other: object) { DomainEvents.register(this.onPaid.bind(other), Paid.name); } onPaid(event: Paid) {} }')).toEqual([
      'Paid -> AfterPaid.- (?)',
    ]);
  });

  it('reads a function expression callback', () => {
    expect(run('DomainEvents.register(function (event: Paid) { return event; }, Paid.name);')).toEqual(['Paid -> -.- (Paid)']);
  });

  it('marks any other register call unresolved', () => {
    expect(run("container.register('token', {});\nDomainEvents.register(Paid.name);\nDomainEvents.register(Paid, Failed);")).toEqual([
      'unresolved@5',
      'unresolved@6',
      'unresolved@7',
    ]);
  });

  it('ignores a library event key', () => {
    expect(run('DomainEvents.register((event: LibraryEvent) => undefined, LibraryEvent.name);')).toEqual([]);
  });
});
