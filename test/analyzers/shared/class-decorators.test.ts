import { describe, expect, it } from 'vitest';
import { hasUnknownClassDecorator } from '../../../src/analyzers/shared/class-decorators';
import { inMemoryProject } from '../../helpers/in-memory';

const TYPEORM = [
  'export declare function Entity(name?: string): ClassDecorator;',
  'export declare function Index(name?: string): ClassDecorator;',
  'export declare function Repository(): ClassDecorator;',
  'export declare function Column(): PropertyDecorator;',
].join('\n');
const MIKRO = 'export declare function Entity(): ClassDecorator;\nexport declare function Embeddable(): ClassDecorator;';
const LIBRARIES = { '/node_modules/typeorm/index.d.ts': TYPEORM, '/node_modules/@mikro-orm/core/index.d.ts': MIKRO };

const unknownIn = (
  source: string,
  inertDecorators: readonly string[] = [],
  extra: Readonly<Record<string, string>> = {},
): boolean => {
  const project = inMemoryProject({ ...LIBRARIES, ...extra, '/src/root.ts': source }, { experimentalDecorators: true });
  return hasUnknownClassDecorator(project.getSourceFileOrThrow('/src/root.ts').getClassOrThrow('Root'), inertDecorators);
};

describe('hasUnknownClassDecorator', () => {
  it('accepts an undecorated class', () => {
    expect(unknownIn('export class Root {}')).toBe(false);
  });

  it('accepts a typeorm Entity', () => {
    expect(unknownIn("import { Entity } from 'typeorm';\n@Entity() export class Root {}")).toBe(false);
  });

  it('accepts a decorator written without a call', () => {
    expect(unknownIn("import { Entity } from 'typeorm';\n@Entity export class Root {}")).toBe(false);
  });

  it('accepts several typeorm decorators', () => {
    expect(unknownIn("import { Entity, Index } from 'typeorm';\n@Entity() @Index('x') export class Root {}")).toBe(false);
  });

  it('accepts an aliased import', () => {
    expect(unknownIn("import { Entity as Table } from 'typeorm';\n@Table() export class Root {}")).toBe(false);
  });

  it('accepts a namespace import', () => {
    expect(unknownIn("import * as orm from 'typeorm';\n@orm.Entity() export class Root {}")).toBe(false);
  });

  it('accepts mikro-orm Entity', () => {
    expect(unknownIn("import { Entity } from '@mikro-orm/core';\n@Entity() export class Root {}")).toBe(false);
  });

  it('accepts mikro-orm Embeddable', () => {
    expect(unknownIn("import { Embeddable } from '@mikro-orm/core';\n@Embeddable() export class Root {}")).toBe(false);
  });

  it('follows a re-export', () => {
    const extra = { '/src/orm.ts': "export { Entity } from 'typeorm';" };
    expect(unknownIn("import { Entity } from './orm';\n@Entity() export class Root {}", [], extra)).toBe(false);
  });

  it('rejects a typeorm name outside the inert list', () => {
    expect(unknownIn("import { Repository } from 'typeorm';\n@Repository() export class Root {}")).toBe(true);
  });

  it('rejects a project-local decorator named like an inert one', () => {
    const source = 'const Entity = () => (target: unknown) => target;\n@Entity() export class Root {}';
    expect(unknownIn(source)).toBe(true);
  });

  it('rejects an unresolved import', () => {
    expect(unknownIn("import { Entity } from 'typeorm-missing';\n@Entity() export class Root {}")).toBe(true);
  });

  it('rejects a project-local decorator beside an inert one', () => {
    const source =
      "import { Entity } from 'typeorm';\nconst Audited = () => (target: unknown) => target;\n@Entity() @Audited() export class Root {}";
    expect(unknownIn(source)).toBe(true);
  });

  it('accepts a project-local decorator listed as inert', () => {
    const source = 'const Audited = () => (target: unknown) => target;\n@Audited() export class Root {}';
    expect(unknownIn(source, ['Audited'])).toBe(false);
  });

  it('accepts a namespace-qualified decorator listed as inert', () => {
    const extra = { '/src/meta.ts': 'export const Audited = () => (target: unknown) => target;' };
    expect(unknownIn("import * as meta from './meta';\n@meta.Audited() export class Root {}", ['Audited'], extra)).toBe(false);
  });

  it('rejects a project-local decorator missing from the inert list', () => {
    const source = 'const Audited = () => (target: unknown) => target;\n@Audited() export class Root {}';
    expect(unknownIn(source, ['Other'])).toBe(true);
  });

  it('rejects an expression decorator', () => {
    const source = 'declare const decorators: ClassDecorator[];\n@(decorators[0]) export class Root {}';
    expect(unknownIn(source, ['decorators'])).toBe(true);
  });
});
