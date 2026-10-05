import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { namedClassChain } from '../../../src/analyzers/lifecycle/named-chain';
import { inMemoryProject } from '../../helpers/in-memory';

const LIBRARY = `
export declare class Root { apply(event: object): void; }
export declare class Deeper extends Root {}
`;

const chainNames = (source: string, name: string, extraFiles: Readonly<Record<string, string>> = {}) =>
  namedClassChain(
    inMemoryProject({ '/types/library.d.ts': LIBRARY, ...extraFiles, '/src/model.ts': source })
      .getSourceFileOrThrow('/src/model.ts')
      .getClassOrThrow(name),
  )?.map((cls: ClassDeclaration) => cls.getName());

describe('named class chain', () => {
  it('walks project classes and stops at the first library class', () => {
    const source = `
import { Deeper } from '../types/library';
export class Middle extends Deeper {}
export class Leaf extends Middle {}
`;

    expect(chainNames(source, 'Leaf')).toEqual(['Leaf', 'Middle', 'Deeper']);
  });

  it('ends at a class that extends nothing', () => {
    expect(chainNames('export class Base {}\nexport class Leaf extends Base {}\n', 'Leaf')).toEqual(['Leaf', 'Base']);
  });

  it('is undefined for circular extends', () => {
    expect(chainNames('export class A extends B {}\nexport class B extends A {}\n', 'A')).toBeUndefined();
  });

  it('is undefined for a base produced by a mixin call', () => {
    const source = `
import { Root } from '../types/library';
type Ctor = new (...args: never[]) => object;
export function Mixed<T extends Ctor>(Base: T): T { return class extends Base {}; }
export class Leaf extends Mixed(Root) {}
`;

    expect(chainNames(source, 'Leaf')).toBeUndefined();
  });

  it('resolves a base through an import alias', () => {
    const source = `
import { Base as Renamed } from './base';
export class Leaf extends Renamed {}
`;

    expect(chainNames(source, 'Leaf', { '/src/base.ts': 'export class Base {}\n' })).toEqual(['Leaf', 'Base']);
  });

  it('is undefined for an unresolved base', () => {
    expect(chainNames("import { Missing } from 'not-installed';\nexport class Leaf extends Missing {}\n", 'Leaf')).toBeUndefined();
  });
});
