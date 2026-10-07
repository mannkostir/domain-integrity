import { describe, expect, it } from 'vitest';
import { isUndrained } from '../../../../src/analyzers/event-flow/buffers/drains';
import { plainEventArrays } from '../../../../src/analyzers/shared/array-store';
import { inMemoryProject } from '../../../helpers/in-memory';

const ROOT = (body: string) => `export class Root { private events: object[] = []; protected addEvent(e: object): void { this.events.push(e); } ${body} }`;

const undrained = (root: string, extra: Readonly<Record<string, string>> = {}): boolean => {
  const project = inMemoryProject({ '/app/src/root.ts': root, ...extra });
  const cls = project.getSourceFileOrThrow('/app/src/root.ts').getClassOrThrow('Root');
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/') && !file.getFilePath().endsWith('.spec.ts'));
  const family = [cls];
  return isUndrained(
    { buffer: cls.getPropertyOrThrow('events'), pushers: [cls.getMethodOrThrow('addEvent')], family, arrays: plainEventArrays(family, files) },
    files,
  );
};

describe('isUndrained', () => {
  it('accepts a buffer that is only pushed and reset', () => {
    expect(undrained(ROOT('clear(): void { this.events = []; }'))).toBe(true);
  });

  it('accepts a trivial getter whose name appears nowhere else', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'))).toBe(true);
  });

  it('accepts a trivial getter read only in a test file', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/root.spec.ts': "import { Root } from './root';\nexport const read = (r: Root) => r.domainEvents;" })).toBe(true);
  });

  it('rejects a trivial getter read in production', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/dispatch.ts': "import { Root } from './root';\nexport const read = (r: Root) => r.domainEvents;" })).toBe(false);
  });

  it('rejects a getter that copies the buffer', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return [...this.events]; }'))).toBe(false);
  });

  it('rejects a getter with two statements', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { const e = this.events; return e; }'))).toBe(false);
  });

  it('rejects a buffer handed to a publisher', () => {
    expect(undrained(ROOT('flush(bus: { publishAll(e: object[]): void }): void { bus.publishAll(this.events); }'))).toBe(false);
  });

  it('rejects truncation through length and slicing', () => {
    expect([undrained(ROOT('clear(): void { this.events.length = 0; }')), undrained(ROOT('copy(): object[] { return this.events.slice(); }'))]).toEqual([false, false]);
  });

  it('rejects the buffer or getter name mentioned as a string in production', () => {
    expect([
      undrained(ROOT(''), { '/app/src/reflect.ts': "export const key = 'events';" }),
      undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/reflect.ts': 'export const key = `domainEvents`;' }),
    ]).toEqual([false, false]);
  });

  it('rejects a bracket read of the getter in production', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/dispatch.ts': "import { Root } from './root';\nexport const read = (r: Root) => r['domainEvents'];" })).toBe(false);
  });

  it('ignores an unrelated class and a local variable with the same name', () => {
    expect(undrained(ROOT(''), { '/app/src/other.ts': 'export class Other { private events: object[] = []; pull(): object[] { const events = this.events; this.events = []; return events; } }' })).toBe(true);
  });

  it('ignores a parameter and an object-literal property with the same name', () => {
    expect(undrained(ROOT(''), { '/app/src/other.ts': 'export const wrap = (events: object[]) => ({ events, count: events.length });' })).toBe(true);
  });

  it('rejects a read through an interface-typed receiver', () => {
    expect(undrained(ROOT(''), { '/app/src/other.ts': 'export interface HasEvents { events: object[] }\nexport const read = (x: HasEvents) => x.events;' })).toBe(false);
  });

  it('rejects a destructuring read', () => {
    expect(undrained(ROOT(''), { '/app/src/other.ts': "import { Root } from './root';\nexport const read = (r: Root) => { const { events } = r as unknown as { events: object[] }; return events; };" })).toBe(false);
  });
});
