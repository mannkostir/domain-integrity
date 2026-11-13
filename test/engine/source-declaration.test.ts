import { describe, expect, it } from 'vitest';
import { sourceDeclaration } from '../../src/engine/source-declaration';
import { inMemoryProject } from '../helpers/in-memory';

const mapped = (map: unknown = { version: 3, sources: ['../src/base.ts'] }, source = 'export class Base {}') => {
  const project = inMemoryProject({
    '/src/base.ts': source,
    '/dist/base.d.ts': 'export declare class Base {}\n//# sourceMappingURL=base.d.ts.map',
  });
  project.getFileSystem().writeFileSync('/dist/base.d.ts.map', JSON.stringify(map));
  const declaration = project.getSourceFileOrThrow('/dist/base.d.ts').getClassOrThrow('Base');
  const file = project.getSourceFileOrThrow('/src/base.ts');
  return { project, declaration, file };
};

describe('project source declarations', () => {
  it('preserves an already loaded project class', () => {
    const { file } = mapped();
    const cls = file.getClassOrThrow('Base');

    expect(sourceDeclaration(cls, [file])).toBe(cls);
  });

  it('follows an explicit declaration map to a loaded project class', () => {
    const { declaration, file } = mapped();

    expect(sourceDeclaration(declaration, [file])).toBe(file.getClassOrThrow('Base'));
  });

  it('resolves the source root relative to the map', () => {
    const { declaration, file } = mapped({ version: 3, sources: ['base.ts'], sourceRoot: '../src' });

    expect(sourceDeclaration(declaration, [file])).toBe(file.getClassOrThrow('Base'));
  });

  it('does not load a source omitted from analysis', () => {
    const { declaration } = mapped();

    expect(sourceDeclaration(declaration, [])).toBeUndefined();
  });

  it('does not match an unrelated class by name without a map', () => {
    const { declaration, file } = mapped();
    declaration.getSourceFile().replaceWithText('export declare class Base {}');

    expect(sourceDeclaration(declaration.getSourceFile().getClassOrThrow('Base'), [file])).toBeUndefined();
  });

  it('does not match a different class in the mapped file', () => {
    const { declaration, file } = mapped(undefined, 'export class Other {}');

    expect(sourceDeclaration(declaration, [file])).toBeUndefined();
  });

  it('rejects ambiguous declarations', () => {
    const { declaration, file } = mapped(undefined, 'class Base {} class Base {}');

    expect(sourceDeclaration(declaration, [file])).toBeUndefined();
  });

  it('leaves a missing map unresolved', () => {
    const { project, declaration, file } = mapped();
    project.getFileSystem().deleteSync('/dist/base.d.ts.map');

    expect(sourceDeclaration(declaration, [file])).toBeUndefined();
  });

  it('leaves malformed JSON unresolved', () => {
    const { project, declaration, file } = mapped();
    project.getFileSystem().writeFileSync('/dist/base.d.ts.map', '{');

    expect(sourceDeclaration(declaration, [file])).toBeUndefined();
  });

  it.each([null, [], { version: 2, sources: ['../src/base.ts'] }, { version: 3, sources: [] },
    { version: 3, sources: ['../src/base.ts', '../src/other.ts'] }, { version: 3, sources: [42] },
    { version: 3, sources: ['../src/base.ts'], sourceRoot: 42 },
  ])('leaves unsupported map data unresolved: %j', (map) => {
    const { declaration, file } = mapped(map);

    expect(sourceDeclaration(declaration, [file])).toBeUndefined();
  });

  it('does not infer the source of an excluded implementation', () => {
    const { file } = mapped();

    expect(sourceDeclaration(file.getClassOrThrow('Base'), [])).toBeUndefined();
  });
});
