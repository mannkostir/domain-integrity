import { ClassDeclaration, CompilerOptions, Node } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isPlainArrayPush, isPlainEventArray, isPushOnlyMethod, plainEventArrays } from '../../../src/analyzers/shared/array-store';
import { classFamily } from '../../../src/analyzers/lifecycle/this-leak';
import { inMemoryProject } from '../../helpers/in-memory';

const plain = (
  source: string,
  field = 'events',
  extraFiles: Readonly<Record<string, string>> = {},
  compilerOptions: CompilerOptions = {},
): boolean => {
  const project = inMemoryProject({ '/types/library.d.ts': 'export declare class LibraryRoot { protected events: object[]; }', ...extraFiles, '/src/root.ts': source }, compilerOptions);
  const root = project.getSourceFileOrThrow('/src/root.ts').getClassOrThrow('Root');
  const files = project.getSourceFiles();
  return isPlainEventArray(root.getPropertyOrThrow(field), classFamily(root, files), files);
};

describe('plain event array', () => {
  it('accepts a private field initialised with an empty array and only pushed to', () => {
    expect(plain(`export class Root { private events: object[] = []; add(e: object): void { this.events.push(e); } }`)).toBe(true);
  });

  it('accepts a private-name field', () => {
    expect(plain(`export class Root { #events: object[] = []; add(e: object): void { this.#events.push(e); } }`, '#events')).toBe(true);
  });

  it('accepts a field without initializer reset to an empty array', () => {
    expect(plain(`export class Root { private events: object[]; constructor() { this.events = []; } clear(): void { this.events = [] as object[]; } }`)).toBe(true);
  });

  it('accepts truncation through length', () => {
    expect(plain(`export class Root { private events: object[] = []; clear(): void { this.events.length = 0; } }`)).toBe(true);
  });

  it('accepts a field exposed through a getter', () => {
    expect(plain(`export class Root { private events: object[] = []; get all(): object[] { return this.events; } }`)).toBe(true);
  });

  it('rejects a protected field', () => {
    expect(plain(`export class Root { protected events: object[] = []; }`)).toBe(false);
  });

  it('rejects a public field', () => {
    expect(plain(`export class Root { events: object[] = []; }`)).toBe(false);
  });

  it('rejects a static field', () => {
    expect(plain(`export class Root { private static events: object[] = []; }`)).toBe(false);
  });

  it('rejects a non-empty initializer', () => {
    expect(plain(`export class Root { private events: object[] = [{}]; }`)).toBe(false);
  });

  it('rejects an initializer that is not an array literal', () => {
    expect(plain(`export class Root { private events: object[] = new Array<object>(); }`)).toBe(false);
  });

  it('rejects reassignment from another value', () => {
    expect(plain(`export class Root { private events: object[] = []; replace(next: object[]): void { this.events = next; } }`)).toBe(false);
  });

  it('rejects reassignment from a filter', () => {
    expect(plain(`export class Root { private events: object[] = []; drop(e: object): void { this.events = this.events.filter((x) => x !== e); } }`)).toBe(false);
  });

  it('rejects a compound assignment', () => {
    expect(plain(`export class Root { private events: object[] = []; grow(): void { this.events ??= []; } }`)).toBe(false);
  });

  it('rejects a destructuring assignment target', () => {
    expect(plain(`export class Root { private events: object[] = []; swap(next: object[][]): void { [this.events] = next; } }`)).toBe(false);
  });

  it('rejects delete', () => {
    expect(plain(`export class Root { private events?: object[] = []; drop(): void { delete this.events; } }`)).toBe(false);
  });

  it('rejects a string-keyed write', () => {
    expect(plain(`export class Root { private events: object[] = []; replace(next: object[]): void { this['events'] = next; } }`)).toBe(false);
  });

  it('rejects a write on another instance', () => {
    expect(plain(`export class Root { private events: object[] = []; adopt(other: Root, next: object[]): void { other.events = next; } }`)).toBe(false);
  });

  it('rejects Object.assign onto this in the class', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(props: object) { Object.assign(this, props); } }`)).toBe(false);
  });

  it('rejects Object.assign onto this in a project subclass', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }
export class Child extends Root { constructor(props: object) { super(); Object.assign(this, props); } }`),
    ).toBe(false);
  });

  it('rejects a decorated field', () => {
    expect(
      plain(`const tag = (_: undefined, __: ClassFieldDecoratorContext): void => undefined;
export class Root { @tag private events: object[] = []; }`),
    ).toBe(false);
  });

  it('rejects a field of a decorated class', () => {
    expect(
      plain(`const d = <T>(target: T, _: ClassDecoratorContext): void => undefined;
@d
export class Root { private events: object[] = []; add(e: object): void { this.events.push(e); } }`),
    ).toBe(false);
  });

  it('rejects an accessor field', () => {
    expect(plain(`export class Root { private accessor events: object[] = []; }`)).toBe(false);
  });

  it('rejects a declared field', () => {
    expect(plain(`export class Root { private declare events: object[]; }`, 'events', {}, { useDefineForClassFields: true })).toBe(false);
  });
});

describe('library declaration', () => {
  it('rejects a field declared in a library file', () => {
    const project = inMemoryProject({ '/types/library.d.ts': 'export declare class LibraryRoot { private events; }' });
    const library = project.getSourceFileOrThrow('/types/library.d.ts').getClassOrThrow('LibraryRoot');
    expect(isPlainEventArray(library.getPropertyOrThrow('events'), [library], project.getSourceFiles())).toBe(false);
  });
});

describe('plain event array hardening', () => {
  it('rejects an array destructuring default', () => {
    expect(plain(`export class Root { private events: object[] = []; f(n: object[][]): void { [this.events = []] = n; } }`)).toBe(false);
  });

  it('rejects an object destructuring default', () => {
    expect(plain(`export class Root { private events: object[] = []; f(n: { a?: object[] }): void { ({ a: this.events = [] } = n); } }`)).toBe(false);
  });

  it('rejects a write through an angle-bracket assertion', () => {
    expect(plain(`export class Root { private events: object[] = []; f(n: object[]): void { (<object[]>this.events) = n; } }`)).toBe(false);
  });

  it('rejects a computed-key write on this', () => {
    expect(plain(`export class Root { private events: object[] = []; f(n: object[]): void { const k = 'events' as const; this[k] = n; } }`)).toBe(false);
  });

  it('rejects Object.assign reached through globalThis', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(p: object) { globalThis.Object.assign(this, p); } }`)).toBe(false);
  });

  it('rejects Object.assign reached through a string key', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(p: object) { Object['assign'](this, p); } }`)).toBe(false);
  });

  it('rejects Object.assign reached through a template key', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(p: object) { Object[\`assign\`](this, p); } }`)).toBe(false);
  });

  it('rejects Object.assign reached through an as-const key', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(p: object) { Object['assign' as const](this, p); } }`)).toBe(false);
  });

  it('rejects Object.assign reached through a parenthesized key', () => {
    expect(plain(`export class Root { private events: object[] = []; constructor(p: object) { Object[('assign')](this, p); } }`)).toBe(false);
  });

  it('rejects Object.assign reached through a const identifier key', () => {
    expect(
      plain(`const key = 'assign';
export class Root { private events: object[] = []; constructor(p: object) { Object[key](this, p); } }`),
    ).toBe(false);
  });

  it('rejects a destructured assign onto this', () => {
    expect(plain(`const { assign } = Object;
export class Root { private events: object[] = []; constructor(p: object) { assign(this, p); } }`)).toBe(false);
  });
});

describe('bracket writes outside the declaring class', () => {
  it('rejects a string-keyed write in a subclass', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }
export class Child extends Root { constructor(g: object[]) { super(); this['events'] = g; } }`),
    ).toBe(false);
  });

  it('rejects a template-keyed write in a subclass', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }
export class Child extends Root { constructor(g: object[]) { super(); this[\`events\`] = g; } }`),
    ).toBe(false);
  });

  it('rejects a string-keyed write on another reference in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `import { Root } from './root';
export const hydrate = (o: Root, g: object[]): void => { o['events'] = g; };`,
      }),
    ).toBe(false);
  });

  it('rejects a write keyed by an as-const literal in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `import { Root } from './root';
export const hydrate = (o: Root, g: object[]): void => { o['events' as const] = g; };`,
      }),
    ).toBe(false);
  });

  it('rejects a write keyed by a const identifier in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `import { Root } from './root';
const key = 'events';
export const hydrate = (o: Root, g: object[]): void => { o[key] = g; };`,
      }),
    ).toBe(false);
  });

  it('rejects a write keyed by a parenthesized literal in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `import { Root } from './root';
export const hydrate = (o: Root, g: object[]): void => { o[('events')] = g; };`,
      }),
    ).toBe(false);
  });

  it('rejects a write keyed by a union that includes the field name in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `import { Root } from './root';
export const hydrate = (o: Root, key: 'other' | 'events', g: object[]): void => { o[key] = g; };`,
      }),
    ).toBe(false);
  });

  it('accepts a write keyed by another literal type in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/hydrate.ts': `const write = (o: Record<string, object[]>, key: 'other', g: object[]): void => { o[key] = g; };
export { write };`,
      }),
    ).toBe(true);
  });

  it('accepts a string-keyed reset to an empty array in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/clear.ts': `import { Root } from './root';
export const clear = (o: Root): void => { o['events'] = []; };`,
      }),
    ).toBe(true);
  });

  it('accepts a string-keyed read in another file', () => {
    expect(
      plain(`export class Root { private events: object[] = []; }`, 'events', {
        '/src/peek.ts': `import { Root } from './root';
export const peek = (o: Root): number => o['events'].length;`,
      }),
    ).toBe(true);
  });
});

const arraysAndClass = (source: string) => {
  const project = inMemoryProject({ '/src/root.ts': source });
  const root = project.getSourceFileOrThrow('/src/root.ts').getClassOrThrow('Root');
  const files = project.getSourceFiles();
  return { root, arrays: plainEventArrays(classFamily(root, files), files) };
};

const firstThisAccess = (root: ClassDeclaration, methodName: string): Node =>
  root
    .getMethodOrThrow(methodName)
    .getFirstDescendantOrThrow((node) => Node.isPropertyAccessExpression(node) && Node.isThisExpression(node.getExpression()));

const isPush = (members: string, fields = 'private events: object[] = [];'): boolean => {
  const { root, arrays } = arraysAndClass(`export class Root { ${fields} ${members} }`);
  return isPlainArrayPush(firstThisAccess(root, 'add'), arrays);
};

const pushOnly = (source: string): boolean => {
  const { root, arrays } = arraysAndClass(source);
  return isPushOnlyMethod(root.getMethodOrThrow('add'), arrays);
};

const pushOnlyBody = (signature: string, body: string, fields = 'private events: object[] = [];'): boolean =>
  pushOnly(`export class Root { ${fields} ${signature} { ${body} } }`);

describe('plain event arrays set', () => {
  it('contains a plain property', () => {
    const { root, arrays } = arraysAndClass(`export class Root { private events: object[] = []; }`);
    expect(arrays.has(root.getPropertyOrThrow('events'))).toBe(true);
  });

  it('omits a non-plain property', () => {
    const { root, arrays } = arraysAndClass(`export class Root { private events: object[] = []; protected other: object[] = []; }`);
    expect(arrays.has(root.getPropertyOrThrow('other'))).toBe(false);
  });
});

describe('plain array push', () => {
  it('accepts a push onto a plain field', () => {
    expect(isPush(`add(e: object): void { this.events.push(e); }`)).toBe(true);
  });

  it('accepts a push through a type assertion', () => {
    expect(isPush(`add(e: object): void { (this.events as object[]).push(e); }`)).toBe(true);
  });

  it('rejects an optional access to the field', () => {
    expect(isPush(`add(e: object): void { this.events?.push(e); }`)).toBe(false);
  });

  it('rejects an optional push call', () => {
    expect(isPush(`add(e: object): void { this.events.push?.(e); }`)).toBe(false);
  });

  it('rejects a read of the field', () => {
    expect(isPush(`add(e: object): void { this.events.some((x) => x === e); }`)).toBe(false);
  });

  it('rejects a push onto a non-plain field', () => {
    expect(isPush(`add(e: object): void { this.other.push(e); }`, 'private events: object[] = []; protected other: object[] = [];')).toBe(false);
  });
});

describe('push-only method', () => {
  it('accepts a single push of the parameter', () => {
    expect(pushOnlyBody('add(e: object): void', 'this.events.push(e);')).toBe(true);
  });

  it('accepts several pushes of parameters onto plain fields', () => {
    expect(
      pushOnlyBody('add(e: object, f: object): void', 'this.events.push(e, f); this.audit.push(e);', 'private events: object[] = []; private audit: object[] = [];'),
    ).toBe(true);
  });

  it('rejects an extra statement', () => {
    expect(pushOnlyBody('add(e: object): void', 'this.events.push(e); console.info(e);')).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(pushOnlyBody('add(e: object): void', '')).toBe(false);
  });

  it('rejects pushing a non-parameter', () => {
    expect(pushOnlyBody('add(e: object): void', 'this.events.push({ e });')).toBe(false);
  });

  it('rejects a spread argument', () => {
    expect(pushOnlyBody('add(...e: object[]): void', 'this.events.push(...e);')).toBe(false);
  });

  it('rejects a default parameter', () => {
    expect(pushOnlyBody('add(e: object = {}): void', 'this.events.push(e);')).toBe(false);
  });

  it('rejects a destructured parameter', () => {
    expect(pushOnlyBody('add({ e }: { e: object }): void', 'this.events.push(e);')).toBe(false);
  });

  it('rejects an async method', () => {
    expect(pushOnlyBody('async add(e: object): Promise<void>', 'this.events.push(e);')).toBe(false);
  });

  it('rejects a static method', () => {
    expect(pushOnlyBody('static add(e: object): void', 'Root.store.push(e);', 'private static store: object[] = [];')).toBe(false);
  });

  it('rejects an overloaded method', () => {
    expect(
      pushOnly(`export class Root { private events: object[] = [];
  add(e: object): void;
  add(e: object, f?: object): void;
  add(e: object): void { this.events.push(e); } }`),
    ).toBe(false);
  });

  it('rejects a push onto a non-plain field', () => {
    expect(
      pushOnly(`export class Root { private events: object[] = [];
  add(e: object): void { this.events.push(e); }
  replace(next: object[]): void { this.events = next; } }`),
    ).toBe(false);
  });

  it('rejects a decorated method', () => {
    expect(
      pushOnly(`const tag = (_: unknown, __: ClassMethodDecoratorContext) => undefined;
export class Root { private events: object[] = []; @tag add(e: object): void { this.events.push(e); } }`),
    ).toBe(false);
  });
});
