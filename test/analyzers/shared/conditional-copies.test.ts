import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { ConditionalCopies } from '../../../src/analyzers/shared/conditional-copies';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const fixturePath = (path: string): string => resolve(path).replace(/\\/g, '/');
const fixtureProject = (files: Readonly<Record<string, string>>) =>
  inMemoryProject(Object.fromEntries(Object.entries(files).map(([path, text]) => [fixturePath(path), text])));

const metadata = { name: 'class-transformer', version: '0.5.1', main: './cjs/index.js', typings: './types/index.d.ts' };
const declaration = 'export declare function instanceToPlain(value: unknown, options?: unknown): Record<string, unknown>; export declare class ClassTransformer { transform(value: object): object; }';
const serializer = 'export function serialize(value: object) { return instanceToPlain(value); }';

const fixture = (extra = '', files: Readonly<Record<string, string>> = {}, operation = serializer) => {
  const project = fixtureProject({
    '/globals.d.ts': 'declare function require(name: string): unknown;',
    '/src/input.ts': 'import { instanceToPlain } from "class-transformer"; ' + operation + extra,
    '/node_modules/class-transformer/package.json': JSON.stringify(metadata),
    '/node_modules/class-transformer/types/index.d.ts': declaration,
    ...files,
  });
  const source = project.getSourceFileOrThrow(fixturePath('/src/input.ts'));
  const call = source.getFunctionOrThrow('serialize').getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;
  const copies = new ConditionalCopies(new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile() && !file.isInNodeModules())));
  return { project, call, copies };
};

describe('conditional copy authority', () => {
  it.each([
    ['primitive shadowed require', 'function require(name: string) { return name; } require("class-transformer");'],
    ['object shadowed require', 'function require(name: string) { return { label: name }; } require("class-transformer");'],
    ['union shadowed require', 'function require(name: string): string | { label: string } { return name; } require("class-transformer");'],
    ['object computed require', 'const table = { require: (name: string) => ({ label: name }) }; table["require"]("class-transformer");'],
    ['object destructured require', 'const table = { require: (name: string) => ({ label: name }) }; const { require } = table; require("class-transformer");'],
    ['computed destructured require', 'const table = { require: (name: string) => ({ label: name }) }; const { ["require"]: load } = table; load("class-transformer");'],
    ['unrelated module load', 'require("logger");'],
    ['unrelated relative load', 'require("./logger");'],
    ['unrelated absolute load', `require(${JSON.stringify(fixturePath('/node_modules/class-transformer-other'))});`],
  ])('retains authority beside %s', (_, extra) => {
    const { project, call, copies } = fixture(extra);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('conditional-copy');
  });

  it.each([
    ['package root load', 'require("class-transformer");'],
    ['package subpath load', 'require("class-transformer/cjs");'],
    ['relative package load', 'require("../node_modules/class-transformer");'],
    ['absolute package root load', `require(${JSON.stringify(fixturePath('/node_modules/class-transformer'))});`],
    ['absolute package child load', `require(${JSON.stringify(fixturePath('/node_modules/class-transformer/cjs/index.js'))});`],
    ['module loader load', 'require("node:module");'],
    ['legacy module loader load', 'require("module");'],
    ['escaped loader', 'const load = require; load("logger");'],
  ])('withholds authority beside %s', (_, load) => {
    const { project, call, copies } = fixture(load);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('withholds authority when a runtime re-export exposes package internals', () => {
    const { project, call, copies } = fixture('export * from "class-transformer/cjs/internals";', {
      '/node_modules/class-transformer/cjs/internals.d.ts': 'export declare const transform: typeof import("../types/index").ClassTransformer;',
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('withholds authority when the root declaration re-exports a foreign implementation signature', () => {
    const { project, call, copies } = fixture('', {
      '/node_modules/class-transformer/types/index.d.ts': 'export { instanceToPlain } from "./implementation";',
      '/node_modules/class-transformer/types/implementation.d.ts': declaration,
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it.each([
    ['union of local objects', 'type Input = { event: string } | { count: number };'],
    ['intersection of local objects', 'type Input = { event: string } & { count: number };'],
  ])('accepts a %s without expanding input authority', (_, input) => {
    const { project, call, copies } = fixture('', {}, input + serializer.replace('value: object', 'value: Input'));
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('conditional-copy');
  });

  it.each([
    ['older version', { ...metadata, version: '0.4.0' }],
    ['unsupported version', { ...metadata, version: '0.5.2' }],
    ['alternate runtime', { ...metadata, main: './esm/index.js' }],
  ])('does not grant authority to an %s', (_, manifest) => {
    const { project, call, copies } = fixture('', {
      '/node_modules/class-transformer/package.json': JSON.stringify(manifest),
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('keeps an unused unresolved import from granting or blocking authority', () => {
    const { call, copies } = fixture('import { unused } from "missing";');

    const result = copies.authorityOf(call);

    expect(result).toBe('conditional-copy');
  });

  it('keeps an unresolved outward import distinct from a proven copy', () => {
    const { call, copies } = fixture('import { factory } from "bridge"; declare function consume(value: unknown): void; consume(factory);', {
      '/node_modules/bridge/index.d.ts': 'export declare function factory(): Missing;',
    });

    const result = [copies.isConditionalRoot(call), copies.authorityOf(call)];

    expect(result).toEqual([false, 'unresolved-delegate']);
  });

  it('withholds authority for a callable constant with the operation name', () => {
    const { project, call, copies } = fixture('', {
      '/node_modules/class-transformer/types/index.d.ts': 'export declare const instanceToPlain: (value: unknown) => Record<string, unknown>;',
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('keeps separate exact-operation calls consistent within one source snapshot', () => {
    const { project, call, copies } = fixture('export function serializeAgain(value: object) { return instanceToPlain(value); }');
    expect(project.getPreEmitDiagnostics()).toEqual([]);
    const second = project.getSourceFileOrThrow(fixturePath('/src/input.ts')).getFunctionOrThrow('serializeAgain').getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;

    const result = [copies.authorityOf(call), copies.authorityOf(second)];

    expect(result).toEqual(['conditional-copy', 'conditional-copy']);
  });

  it('withholds authority for an unresolved runtime re-export of package internals', () => {
    const { call, copies } = fixture('export * from "class-transformer/missing";');

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('withholds authority beside an unresolved internal import', () => {
    const { call, copies } = fixture('import { ClassTransformer } from "class-transformer/missing";');

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });

  it('withholds authority beside a nested installation with unproved package identity', () => {
    const { project, call, copies } = fixture('', {
      '/packages/other/input.ts': 'import { ClassTransformer } from "class-transformer"; ClassTransformer;',
      '/packages/other/node_modules/class-transformer/package.json': JSON.stringify({ name: 'class-transformer', types: './index.d.ts' }),
      '/packages/other/node_modules/class-transformer/index.d.ts': declaration,
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = copies.authorityOf(call);

    expect(result).toBe('other');
  });
});
