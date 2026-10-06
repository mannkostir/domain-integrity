import { describe, expect, it } from 'vitest';
import { subscribedToRecogniser } from '../../../src/analyzers/event-flow/registrations/subscribed-to';
import { recognise } from './recognise';

const run = (body: string) =>
  recognise(subscribedToRecogniser, {
    '/src/events.ts': 'export class Paid {}\nexport class Failed {}',
    '/src/use.ts': `import { Paid, Failed } from './events';\nimport { LibraryEvent } from '../types/lib';\ndeclare const others: unknown[];\n${body}`,
  });

describe('subscribedToRecogniser', () => {
  it('reads every class in a returned array literal', () => {
    expect(run('export class OnPaid { subscribedTo() { return [Paid, Failed]; } on(event: Paid) {} }')).toEqual([
      'Paid -> OnPaid.- (?), Failed -> OnPaid.- (?)',
    ]);
  });

  it('marks any other body unresolved', () => {
    expect(run('export class A { subscribedTo() { return others; } }\nexport class B { subscribedTo() { const list = [Paid]; return list; } }')).toEqual([
      'unresolved@4',
      'unresolved@5',
    ]);
  });

  it('registers nothing for library classes in the array but notes them', () => {
    expect(run('export class OnLibrary { subscribedTo() { return [LibraryEvent]; } }')).toEqual(['library']);
  });
});
