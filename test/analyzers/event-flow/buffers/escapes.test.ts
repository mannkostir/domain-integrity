import { describe, expect, it } from 'vitest';
import { CompilerOptions } from 'ts-morph';
import { mayHoldFamily } from '../../../../src/analyzers/event-flow/buffers/family-type';
import { hasEscapeRoute } from '../../../../src/analyzers/event-flow/buffers/escapes';
import { inMemoryProject } from '../../../helpers/in-memory';

const ROOT = 'export class Root { private events: object[] = []; readonly id: string = "r"; }';

const IMPLEMENTING_ROOT =
  'export interface Aggregate { pull(): object[] }\nexport class Root implements Aggregate { private events: object[] = []; pull(): object[] { return []; } }';

const SAVEABLE_ROOT =
  'export interface Identified { id?: string }\nexport interface Saveable extends Identified {}\nexport class Root implements Saveable { private events: object[] = []; }';

const COPYING_ROOT = 'export class Root { private events: object[] = []; copy(): object[] { return [...this.events]; } }';

const BUS = [
  'export declare function publish(value: unknown): void;',
  'export declare function sendDto(value: { id: string }): void;',
  'export declare function opts(value: { timeout?: number }): void;',
  'export declare function run(job: () => unknown): void;',
  'export declare function tag(strings: TemplateStringsArray, ...values: unknown[]): string;',
  'export declare class Repo { save(value: object): void; }',
  'export declare class Repo2 { save(value: { readonly kind?: string }): void; }',
].join('\n');

const NODE_CONSOLE = 'declare var console: Console;\ninterface Console { log(...data: unknown[]): void; }';

type Setup = {
  readonly root?: string;
  readonly extraFiles?: Readonly<Record<string, string>>;
  readonly compilerOptions?: CompilerOptions;
};

const escapes = (usage: string, setup: Setup = {}): boolean => {
  const project = inMemoryProject(
    {
      '/lib/bus.d.ts': BUS,
      '/app/src/root.ts': setup.root ?? ROOT,
      '/app/src/use.ts': `import { Root } from './root';\nimport { publish, sendDto, opts, run, tag, Repo, Repo2 } from '../../lib/bus';\n${usage}`,
      ...setup.extraFiles,
    },
    setup.compilerOptions,
  );
  const cls = project.getSourceFileOrThrow('/app/src/root.ts').getClassOrThrow('Root');
  const production = project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/'));
  return hasEscapeRoute(production, mayHoldFamily([cls]));
};

describe('hasEscapeRoute', () => {
  it('finds no escape for plain project use and default-lib storage', () => {
    expect(escapes('export const keep = (r: Root, all: Root[]) => { all.push(r); return Promise.resolve(r); };')).toBe(false);
  });

  it('finds no escape when a library call receives only a primitive', () => {
    expect(escapes("export const f = () => publish('text');")).toBe(false);
  });

  it('finds no escape when the aggregate spreads its own private buffer', () => {
    expect(escapes('export {};', { root: COPYING_ROOT })).toBe(false);
  });

  it('finds an escape when another class spreads a private array that may hold the aggregate', () => {
    expect(escapes('export class Other { private items: object[] = []; copy() { return [...this.items]; } }')).toBe(true);
  });

  it('finds an escape when a private field holding the aggregate is spread into an object', () => {
    expect(
      escapes('export class Snap { private order: Root; constructor(o: Root) { this.order = o; } copy() { return { ...this.order }; } }'),
    ).toBe(true);
  });

  it('finds no escape when results.push and Promise.resolve receive the aggregate', () => {
    expect(escapes('export const f = (r: Root, results: Root[]) => { results.push(r); return Promise.resolve(r); };')).toBe(false);
  });

  it('finds no escape when the class constructor reaches a library function', () => {
    expect(escapes('export const f = () => publish(Root);')).toBe(false);
  });

  it('finds no escape when an unrelated class passes itself to a library function', () => {
    expect(escapes('export class Service { start(): void { publish(this); } }')).toBe(false);
  });

  it('finds an escape when the aggregate passes itself to a library function', () => {
    expect(escapes('export {};', { root: 'import { publish } from "../../lib/bus";\nexport class Root { private events: object[] = []; save(): void { publish(this); } }' })).toBe(true);
  });

  it('finds no escape when a weak option bag reaches a library function', () => {
    expect(escapes('export const f = (o: { timeout?: number }) => opts(o);')).toBe(false);
  });

  it('finds no escape when a mapped DTO reaches a library function', () => {
    expect(escapes('export const f = (r: Root) => { const dto = { id: r.id }; sendDto(dto); };')).toBe(false);
  });

  it('finds no escape when console logs the aggregate', () => {
    expect(escapes('export const f = (r: Root) => console.log(r);')).toBe(false);
  });

  it('finds no escape when a library-declared console logs the aggregate', () => {
    expect(
      escapes('export const f = (r: Root) => console.log(r);', {
        extraFiles: { '/node_modules/@types/node/index.d.ts': NODE_CONSOLE },
        compilerOptions: { lib: ['lib.es2022.d.ts'] },
      }),
    ).toBe(false);
  });

  it('finds an escape when the aggregate reaches a library method with a structural parameter', () => {
    expect(
      escapes('interface Saveable { id?: string }\nexport const f = (r: Root, repo: { save(x: Saveable): void }) => { repo.save(r); new Repo2().save(r); };'),
    ).toBe(true);
  });

  it('finds an escape when the aggregate is cast to an unrelated interface', () => {
    expect(escapes('interface Saveable { id?: string }\nexport const f = (r: Root) => { const s = r as Saveable; new Repo2().save(s); };')).toBe(true);
  });

  it('finds an escape when the aggregate is laundered through unknown', () => {
    expect(escapes('interface Foo { name: string }\nexport const f = (r: Root) => { const x = r as unknown as Foo; return x; };')).toBe(true);
  });

  it('finds an escape when a value typed as an implemented interface reaches a library function', () => {
    expect(
      escapes("import type { Aggregate } from './root';\nexport const f = (r: Root) => { const held: Aggregate = r; publish(held); };", {
        root: IMPLEMENTING_ROOT,
      }),
    ).toBe(true);
  });

  it('finds an escape when a value typed as a transitively implemented interface reaches a library function', () => {
    expect(
      escapes("import type { Identified } from './root';\nexport const f = (r: Root) => { const s: Identified = r; publish(s); };", {
        root: SAVEABLE_ROOT,
      }),
    ).toBe(true);
  });

  it.each([
    ['Object.values', 'export const f = (r: Root) => Object.values(r);'],
    ['Object.assign', 'export const f = (r: Root) => Object.assign({}, r);'],
    ['JSON.stringify', 'export const f = (r: Root) => JSON.stringify(r);'],
    ['structuredClone', 'export const f = (r: Root) => structuredClone(r);'],
    ['Reflect.get', "export const f = (r: Root) => Reflect.get(r, 'events');"],
    ['destructured Object.assign', 'const { assign } = Object;\nexport const f = (r: Root) => assign({}, r);'],
    ['aliased Reflect', "const R = Reflect;\nexport const f = (r: Root) => R.get(r, 'x');"],
    ['aliased JSON.stringify', 'const s = JSON.stringify;\nexport const f = (r: Root) => s(r);'],
    ['globalThis.Object.keys', 'export const f = (r: Root) => globalThis.Object.keys(r);'],
    ['object spread', 'export const f = (r: Root) => ({ ...r });'],
    ['for in', 'export const f = (r: Root) => { for (const k in r) publish(k); };'],
    ['computed read', 'export const f = (r: Root, k: string) => (r as unknown as Record<string, unknown>)[k];'],
    ['library argument', 'export const f = (r: Root) => publish(r);'],
    ['library method argument', 'export const f = (r: Root, repo: Repo) => repo.save(r);'],
    ['library argument inside an array', 'export const f = (r: Root) => publish([r]);'],
    ['library callback returning the aggregate', 'export const f = (r: Root) => run(() => r);'],
    ['library async callback returning the aggregate', 'export const f = (r: Root) => run(async () => r);'],
    ['library tagged template', 'export const f = (r: Root) => tag`${r}`;'],
    ['library function call', 'export const f = (r: Root) => publish.call(null, r);'],
    ['library function apply', 'export const f = (r: Root) => publish.apply(null, [r]);'],
    ['library function bind', 'export const f = (r: Root) => publish.bind(null, r);'],
    ['unresolved callee', 'declare const anyFn: any;\nexport const f = (r: Root) => anyFn(r);'],
    ['any-typed value', 'declare const r: any;\nexport const f = () => Object.keys(r);'],
  ])('finds an escape through %s', (_, usage) => {
    expect(escapes(usage)).toBe(true);
  });
});
