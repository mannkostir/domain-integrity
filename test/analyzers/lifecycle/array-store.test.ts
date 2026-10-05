import { CompilerOptions } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isPlainEventArray } from '../../../src/analyzers/lifecycle/array-store';
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
  return isPlainEventArray(root.getPropertyOrThrow(field), classFamily(root, project.getSourceFiles()));
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
    expect(isPlainEventArray(library.getPropertyOrThrow('events'), [library])).toBe(false);
  });
});
