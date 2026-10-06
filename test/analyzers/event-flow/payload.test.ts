import { describe, expect, it } from 'vitest';
import { readPayload } from '../../../src/analyzers/event-flow/payload';
import { inMemoryProject } from '../../helpers/in-memory';

const payloadsOf = (signature: string): readonly string[] => {
  const project = inMemoryProject({
    '/src/events.ts': 'export class Paid {}\nexport class Failed {}\nexport interface Shape {}',
    '/types/lib.d.ts': 'export declare class LibraryEvent {}',
    '/src/handler.ts': `import { Paid, Failed, Shape } from './events';\nimport { LibraryEvent } from '../types/lib';\nexport class H { ${signature} }`,
  });
  const method = project.getSourceFileOrThrow('/src/handler.ts').getClassOrThrow('H').getMethods()[0]!;
  const payload = readPayload(method.getParameters()[0], (cls) => !cls.getSourceFile().isDeclarationFile());
  return payload.kind === 'classes' ? payload.classes.map((cls) => cls.getName() ?? '') : ['unreadable'];
};

describe('readPayload', () => {
  it('reads a project class', () => {
    expect(payloadsOf('handle(event: Paid) {}')).toEqual(['Paid']);
  });

  it('reads a union of project classes', () => {
    expect(payloadsOf('handle(event: Paid | Failed) {}')).toEqual(['Paid', 'Failed']);
  });

  it('cannot read interfaces, library classes, any, unknown, generics, untyped or missing parameters', () => {
    expect([
      payloadsOf('handle(event: Shape) {}'),
      payloadsOf('handle(event: LibraryEvent) {}'),
      payloadsOf('handle(event: Paid | Shape) {}'),
      payloadsOf('handle(event: any) {}'),
      payloadsOf('handle(event: unknown) {}'),
      payloadsOf('handle<T>(event: T) {}'),
      payloadsOf('handle(event) {}'),
      payloadsOf('handle() {}'),
    ]).toEqual([['unreadable'], ['unreadable'], ['unreadable'], ['unreadable'], ['unreadable'], ['unreadable'], ['unreadable'], ['unreadable']]);
  });
});
