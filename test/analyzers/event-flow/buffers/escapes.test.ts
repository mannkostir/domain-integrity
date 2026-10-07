import { describe, expect, it } from 'vitest';
import { mayHoldFamily } from '../../../../src/analyzers/event-flow/buffers/family-type';
import { hasEscapeRoute } from '../../../../src/analyzers/event-flow/buffers/escapes';
import { inMemoryProject } from '../../../helpers/in-memory';

const ROOT = 'export class Root { private events: object[] = []; }';

const escapes = (usage: string): boolean => {
  const project = inMemoryProject({
    '/lib/bus.d.ts': 'export declare function publish(value: unknown): void;\nexport declare class Repo { save(value: object): void; }',
    '/app/src/root.ts': ROOT,
    '/app/src/use.ts': `import { Root } from './root';\nimport { publish, Repo } from '../../lib/bus';\n${usage}`,
  });
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

  it('finds no escape when a class spreads its own private array', () => {
    expect(escapes('export class Other { private items: object[] = []; copy() { return [...this.items]; } }')).toBe(false);
  });

  it.each([
    ['Object.values', 'export const f = (r: Root) => Object.values(r);'],
    ['Object.assign', 'export const f = (r: Root) => Object.assign({}, r);'],
    ['JSON.stringify', 'export const f = (r: Root) => JSON.stringify(r);'],
    ['structuredClone', 'export const f = (r: Root) => structuredClone(r);'],
    ['Reflect.get', "export const f = (r: Root) => Reflect.get(r, 'events');"],
    ['object spread', 'export const f = (r: Root) => ({ ...r });'],
    ['for in', 'export const f = (r: Root) => { for (const k in r) publish(k); };'],
    ['computed read', 'export const f = (r: Root, k: string) => (r as unknown as Record<string, unknown>)[k];'],
    ['library argument', 'export const f = (r: Root) => publish(r);'],
    ['library method argument', 'export const f = (r: Root, repo: Repo) => repo.save(r);'],
    ['library argument inside an array', 'export const f = (r: Root) => publish([r]);'],
    ['unresolved callee', 'declare const anyFn: any;\nexport const f = (r: Root) => anyFn(r);'],
    ['any-typed value', 'declare const r: any;\nexport const f = () => Object.keys(r);'],
  ])('finds an escape through %s', (_, usage) => {
    expect(escapes(usage)).toBe(true);
  });
});
