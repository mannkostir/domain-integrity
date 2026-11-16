import { describe, expect, it } from 'vitest';
import { PackageCapabilities } from '../../../src/analyzers/shared/package-capabilities';
import { inMemoryProject } from '../../helpers/in-memory';

const delegateRoot = '/node_modules/delegate';
const delegate = 'export declare class Delegate { transform(value: object): object; }';

const fixture = (surface: string, files: Readonly<Record<string, string>> = {}, namespace = false) => {
  const project = inMemoryProject({
    '/src/input.ts': namespace ? 'import * as surface from "bridge"; surface;' : 'import { surface } from "bridge"; surface;',
    '/node_modules/delegate/index.d.ts': delegate,
    '/node_modules/bridge/index.ts': 'import { Delegate } from "delegate"; ' + surface,
    ...files,
  });
  const imported = project.getSourceFileOrThrow('/src/input.ts').getImportDeclarations()[0]!;
  const binding = namespace ? imported.getNamespaceImportOrThrow() : imported.getNamedImports()[0]!.getNameNode();
  return { project, binding, capabilities: new PackageCapabilities(delegateRoot) };
};

describe('outward package capabilities', () => {
  it.each([
    ['constrained generic output', 'export declare function surface<T extends typeof Delegate>(): T;'],
    ['written tuple union', 'export declare const surface: ([typeof Delegate] | string);'],
    ['inferred constructor property', 'export class surface { constructor(public value = Delegate) {} }'],
    ['constructor property', 'export class surface { constructor(public readonly value: typeof Delegate) {} }'],
    ['class inheritance', 'declare class Base { value: typeof Delegate } export class surface extends Base {}'],
    ['implemented interface', 'interface Contract { value: typeof Delegate } export declare class surface implements Contract { value: typeof Delegate }'],
    ['index result', 'export interface surface { [name: string]: typeof Delegate } export declare const surface: surface;'],
    ['getter result', 'export declare class surface { get value(): typeof Delegate; }'],
    ['shorthand object', 'export const surface = { Delegate };'],
    ['spread object', 'const values = { Delegate }; export const surface = { ...values };'],
    ['object method', 'export const surface = { factory() { return Delegate; } };'],
    ['inferred class property', 'export class surface { value = Delegate; }'],
    ['inferred tuple', 'export const surface = [Delegate] as const;'],
    ['inferred array', 'export const surface = [Delegate];'],
    ['inferred union', 'export const surface = null as unknown as (string | { value: typeof Delegate });'],
    ['inferred intersection', 'export const surface = null as unknown as ({ value: typeof Delegate } & { label: string });'],
    ['inferred generic alias', 'type Box<T> = { value: T }; export const surface = null as unknown as Box<typeof Delegate>;'],
    ['inferred generic class', 'declare class Box<T> { value: T } export const surface = null as unknown as Box<typeof Delegate>;'],
    ['function expression output', 'export const surface = function () { return Delegate; };'],
    ['arrow output', 'export const surface = () => Delegate;'],
    ['inferred call output', 'declare function factory(): typeof Delegate; export const surface = factory();'],
    ['constructor output', 'export declare const surface: new () => { value: typeof Delegate };'],
    ['callback argument output', 'export declare function surface(callback: ((value: typeof Delegate) => void) | ((value: string) => void)): void;'],
    ['namespace runtime member', 'export namespace surface { export const factory = () => Delegate; }'],
  ])('finds the delegated identity through %s', (_, surface) => {
    const { project, binding, capabilities } = fixture(surface);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = capabilities.query(binding, []);

    expect(result.kind).toBe('exposed');
  });

  it.each([
    ['constructor input', 'export class surface { constructor(value: typeof Delegate) {} }'],
    ['setter input', 'export declare class surface { set value(value: typeof Delegate); }'],
    ['function input', 'export declare function surface(value: typeof Delegate): string;'],
    ['unused generic default', 'export declare function surface<T = typeof Delegate>(): string;'],
    ['constructor primitive output', 'export declare const surface: new () => { label: string };'],
    ['recursive unrelated result', 'interface Label { child: Label; value: string } export declare function surface(): Label;'],
    ['inferred primitive union', 'export const surface = null as unknown as (string | number);'],
    ['inferred unrelated intersection', 'export const surface = null as unknown as ({ label: string } & { count: number });'],
    ['literal result', 'export declare const surface: "Delegate";'],
    ['inferred empty object', 'export const surface = {};'],
  ])('keeps %s unrelated to the delegated identity', (_, surface) => {
    const { project, binding, capabilities } = fixture(surface);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = capabilities.query(binding, []);

    expect(result.kind).toBe('unrelated');
  });

  it.each([
    ['runtime star', 'export * from "delegate";', {}, 'exposed'],
    ['runtime named export', 'export { Delegate } from "delegate";', {}, 'exposed'],
    ['type-only star', 'export type * from "delegate";', {}, 'unrelated'],
    ['type-only named export', 'export { type Delegate } from "delegate";', {}, 'unrelated'],
    ['local erased alias', 'export type Surface = typeof Delegate;', {}, 'unrelated'],
    ['chained runtime star', 'export * from "./inner";', { '/node_modules/bridge/inner.ts': 'export { Delegate } from "delegate";' }, 'exposed'],
    ['chained erased star', 'export * from "./inner";', { '/node_modules/bridge/inner.ts': 'export type * from "delegate"; export const label = "label";' }, 'unrelated'],
  ] as const)('distinguishes %s on a namespace surface', (_, source, files, expected) => {
    const { project, binding, capabilities } = fixture(source, files, true);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = capabilities.query(binding, []);

    expect(result.kind).toBe(expected);
  });

  it('keeps an unresolved runtime star incomplete', () => {
    const { binding, capabilities } = fixture('export * from "missing";', {}, true);

    const result = capabilities.query(binding, []);

    expect(result).toMatchObject({ kind: 'incomplete', cause: expect.stringContaining('unresolved ExportDeclaration') });
  });

  it('keeps an unsupported indexed written result incomplete', () => {
    const { project, binding, capabilities } = fixture('export declare const surface: { label: string }["label"];');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = capabilities.query(binding, []);

    expect(result).toMatchObject({ kind: 'incomplete', cause: expect.stringContaining('unresolved IndexedAccessType') });
  });

  it('keeps an unresolved factory call incomplete', () => {
    const { binding, capabilities } = fixture('export const surface = missing();');

    const result = capabilities.query(binding, []);

    expect(result.kind).toBe('incomplete');
  });

  it('keeps a nested capability distinct from a sibling package with a shared name prefix', () => {
    const { project, binding, capabilities } = fixture('export { Delegate as surface } from "delegate-other";', {
      '/node_modules/delegate-other/index.d.ts': delegate,
    });
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = capabilities.query(binding, []);

    expect(result.kind).toBe('unrelated');
  });

  it.each([
    ['an unresolved value', 'export const surface = missing;', 'unresolved Identifier'],
    ['an unresolved shorthand export', 'export const surface = { missing };', 'unresolved ShorthandPropertyAssignment'],
  ])('keeps %s incomplete', (_, source, cause) => {
    const { binding, capabilities } = fixture(source);

    const result = capabilities.query(binding, []);

    expect(result).toMatchObject({ kind: 'incomplete', cause: expect.stringContaining(cause) });
  });

});
