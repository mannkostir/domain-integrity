import { ClassDeclaration, Project, SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isUndrained } from '../../../../src/analyzers/event-flow/buffers/drains';
import { plainEventArrays } from '../../../../src/analyzers/shared/array-store';
import { inMemoryProject } from '../../../helpers/in-memory';

const ROOT = (body: string) => `export class Root { private events: object[] = []; protected addEvent(e: object): void { this.events.push(e); } ${body} }`;

const productionFiles = (project: Project): readonly SourceFile[] =>
  project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/') && !file.getFilePath().endsWith('.spec.ts'));

const undrainedIn = (project: Project, cls: ClassDeclaration, family: readonly ClassDeclaration[]): boolean => {
  const files = productionFiles(project);
  return isUndrained(
    { buffer: cls.getPropertyOrThrow('events'), pushers: [cls.getMethodOrThrow('addEvent')], family, arrays: plainEventArrays(family, files) },
    files,
  );
};

const undrained = (root: string, extra: Readonly<Record<string, string>> = {}): boolean => {
  const project = inMemoryProject({ '/app/src/root.ts': root, ...extra });
  const cls = project.getSourceFileOrThrow('/app/src/root.ts').getClassOrThrow('Root');
  return undrainedIn(project, cls, [cls]);
};

const undrainedWithSubclass = (root: string, sub: string, extra: Readonly<Record<string, string>> = {}): boolean => {
  const project = inMemoryProject({ '/app/src/root.ts': root, '/app/src/sub.ts': sub, ...extra });
  const cls = project.getSourceFileOrThrow('/app/src/root.ts').getClassOrThrow('Root');
  return undrainedIn(project, cls, [cls, project.getSourceFileOrThrow('/app/src/sub.ts').getClassOrThrow('Sub')]);
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

  it.each([
    ['length truncation', 'clear(): void { this.events.length = 0; }'],
    ['slicing', 'copy(): object[] { return this.events.slice(); }'],
  ])('rejects %s of the buffer', (_shape, body) => {
    expect(undrained(ROOT(body))).toBe(false);
  });

  it('rejects the buffer name mentioned as a string in production', () => {
    expect(undrained(ROOT(''), { '/app/src/reflect.ts': "export const key = 'events';" })).toBe(false);
  });

  it('rejects the getter name mentioned as a template string in production', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/reflect.ts': 'export const key = `domainEvents`;' })).toBe(false);
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

  it('rejects a for-of destructuring read of the getter in production', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), { '/app/src/dispatch.ts': "import { Root } from './root';\nexport const r = (roots: Root[], publish: (e: object[]) => void) => { let domainEvents: object[]; for ({ domainEvents } of roots) publish(domainEvents); };" })).toBe(false);
  });

  it.each([
    ['shorthand', 'export const r = (xs: { events: object[] }[], publish: (e: object[]) => void) => { let events: object[]; for ({ events } of xs) publish(events); };'],
    ['renamed', 'export const r = (xs: { events: object[] }[], publish: (e: object[]) => void) => { let e: object[]; for ({ events: e } of xs) publish(e); };'],
  ])('rejects a %s for-of destructuring read of the buffer name', (_shape, other) => {
    expect(undrained(ROOT(''), { '/app/src/other.ts': other })).toBe(false);
  });

  it('rejects a read of the public getter name through an unrelated class receiver', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), {
      '/app/src/snap.ts': 'export class Snap { domainEvents: object[] = []; }',
      '/app/src/dispatch.ts': "import { Root } from './root';\nimport { Snap } from './snap';\nexport const read = (root: Root) => { const s: Snap = root; return s.domainEvents; };",
    })).toBe(false);
  });

  it('rejects a read of an unrelated class getter with the same name as the trivial getter', () => {
    expect(undrained(ROOT('get domainEvents(): object[] { return this.events; }'), {
      '/app/src/other.ts': 'export class Other { get domainEvents(): object[] { return []; } }',
      '/app/src/dispatch.ts': "import { Other } from './other';\nexport const read = (o: Other) => o.domainEvents;",
    })).toBe(false);
  });

  it('rejects a getter in a family subclass that is read in production', () => {
    expect(undrainedWithSubclass(ROOT(''), "import { Root } from './root';\nexport class Sub extends Root { get domainEvents(): object[] { return this.events; } }", { '/app/src/dispatch.ts': "import { Sub } from './sub';\nexport const read = (s: Sub) => s.domainEvents;" })).toBe(false);
  });

  it('rejects a super read of the buffer in a family subclass', () => {
    expect(undrainedWithSubclass(ROOT(''), "import { Root } from './root';\nexport class Sub extends Root { read(): object[] { return super.events; } }")).toBe(false);
  });

  it('rejects an optional push onto the buffer', () => {
    expect(undrained('export class Root { private events: object[] = []; protected addEvent(e: object): void { this.events?.push(e); } }')).toBe(false);
  });
});
