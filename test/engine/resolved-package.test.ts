import { describe, expect, it, vi } from 'vitest';
import { ResolvedPackages } from '../../src/engine/resolved-package';
import { inMemoryProject } from '../helpers/in-memory';

const metadata = { name: 'class-transformer', version: '0.5.1', main: './cjs/index.js', typings: './types/index.d.ts' };
const declaration = 'export declare function instanceToPlain<T>(value: T): Record<string, unknown>;';

const fixture = (manifest: unknown = metadata, source = "import { instanceToPlain } from 'class-transformer';") => {
  const project = inMemoryProject({
    '/src/input.ts': source,
    '/node_modules/class-transformer/types/index.d.ts': declaration,
  });
  if (manifest !== undefined) project.getFileSystem().writeFileSync('/node_modules/class-transformer/package.json', JSON.stringify(manifest));
  const imported = project.getSourceFileOrThrow('/src/input.ts').getImportDeclarations()[0]!;
  return { project, imported };
};

describe('resolved package facts', () => {
  it('reads the package owning the compiler resolved declaration', () => {
    const { imported } = fixture();

    expect(new ResolvedPackages().entryOf(imported)).toEqual({ ...metadata, root: '/node_modules/class-transformer', entry: '/node_modules/class-transformer/types/index.d.ts' });
  });

  it('keeps the exact installed version as a fact', () => {
    const { imported } = fixture({ ...metadata, version: '0.4.0' });

    expect(new ResolvedPackages().entryOf(imported)?.version).toBe('0.4.0');
  });

  it('resolves a nested installation independently of the older root package', () => {
    const { project } = fixture({ ...metadata, version: '0.4.0' });
    project.createSourceFile('/packages/core/input.ts', "import { instanceToPlain as copy } from 'class-transformer';");
    project.createSourceFile('/packages/core/node_modules/class-transformer/types/index.d.ts', declaration);
    project.getFileSystem().writeFileSync('/packages/core/node_modules/class-transformer/package.json', JSON.stringify(metadata));
    const imported = project.getSourceFileOrThrow('/packages/core/input.ts').getImportDeclarations()[0]!;

    expect(new ResolvedPackages().entryOf(imported)?.root).toBe('/packages/core/node_modules/class-transformer');
    expect(new ResolvedPackages().entryOf(imported)?.version).toBe('0.5.1');
  });

  it('does not use an unrelated ancestor manifest for declaration identity', () => {
    const { project, imported } = fixture(null);
    project.getFileSystem().deleteSync('/node_modules/class-transformer/package.json');
    project.getFileSystem().writeFileSync('/package.json', JSON.stringify(metadata));

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('leaves malformed package JSON unknown', () => {
    const { project, imported } = fixture();
    project.getFileSystem().writeFileSync('/node_modules/class-transformer/package.json', '{');

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it.each([null, [], {}, { ...metadata, name: 'another-package' }, { ...metadata, version: 1 }, { ...metadata, version: '' },
    { ...metadata, main: 1 }, { ...metadata, main: '' }, { ...metadata, typings: 1 },
    { ...metadata, typings: './missing.d.ts' }, { ...metadata, exports: { '.': './types/index.d.ts' } },
    { ...metadata, typesVersions: {} },
  ])('leaves incomplete or unsupported package metadata unknown: %j', (manifest) => {
    const { imported } = fixture(manifest);

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('does not infer identity from an ambient module', () => {
    const project = inMemoryProject({
      '/src/input.ts': "import { instanceToPlain } from 'class-transformer';",
      '/ambient.d.ts': "declare module 'class-transformer' { export function instanceToPlain(value: unknown): object; }",
    });

    expect(new ResolvedPackages().entryOf(project.getSourceFileOrThrow('/src/input.ts').getImportDeclarations()[0]!)).toBeUndefined();
  });

  it('rejects a path mapped declaration even inside a package-shaped directory', () => {
    const { project, imported } = fixture();
    project.compilerOptions.set({ paths: { 'class-transformer': ['/node_modules/class-transformer/types/index.d.ts'] } });

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('rejects wildcard path mappings matching the import', () => {
    const { project, imported } = fixture();
    project.compilerOptions.set({ paths: { '*': ['/node_modules/*/types/index.d.ts'] } });

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('does not identify relative imports as package imports', () => {
    const { imported } = fixture(metadata, "import { instanceToPlain } from '../node_modules/class-transformer/types/index';");

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('accepts the equivalent types field when typings is absent', () => {
    const { imported } = fixture({ ...metadata, typings: undefined, types: './types/index.d.ts' });

    expect(new ResolvedPackages().entryOf(imported)?.typings).toBe('./types/index.d.ts');
  });

  it('leaves conflicting types and typings entries unknown', () => {
    const { imported } = fixture({ ...metadata, types: './other.d.ts' });

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('does not identify a source implementation as a package declaration entry', () => {
    const { project, imported } = fixture({ ...metadata, typings: './index.ts' });
    project.createSourceFile('/node_modules/class-transformer/index.ts', 'export function instanceToPlain(value: object) { return value; }');

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });

  it('leaves unreadable manifests unknown', () => {
    const { project, imported } = fixture();
    const fs = project.getFileSystem();
    const original = fs.readFileSync.bind(fs);
    const reader = vi.spyOn(fs, 'readFileSync').mockImplementation((path, encoding) => {
      if (path.endsWith('/class-transformer/package.json')) throw new Error('unreadable');
      return original(path, encoding);
    });

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
    reader.mockRestore();
  });

  it.each(['fileExistsSync', 'directoryExistsSync'] as const)('leaves unavailable compiler filesystem checks unknown: %s', (method) => {
    const { project, imported } = fixture();
    imported.getModuleSpecifierSourceFile();
    const check = vi.spyOn(project.getFileSystem(), method).mockImplementation(() => { throw new Error('unavailable'); });

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
    check.mockRestore();
  });

  it('identifies a scoped package from its own root manifest', () => {
    const project = inMemoryProject({
      '/src/input.ts': "import { copy } from '@scope/copy';",
      '/node_modules/@scope/copy/types/index.d.ts': 'export declare function copy(value: object): object;',
    });
    project.getFileSystem().writeFileSync('/node_modules/@scope/copy/package.json', JSON.stringify({ ...metadata, name: '@scope/copy' }));
    const imported = project.getSourceFileOrThrow('/src/input.ts').getImportDeclarations()[0]!;

    expect(new ResolvedPackages().entryOf(imported)?.root).toBe('/node_modules/@scope/copy');
  });

  it('keeps cached package facts within their project snapshot', () => {
    const known = fixture();
    const other = fixture({ ...metadata, version: '0.4.0' });
    const packages = new ResolvedPackages();
    const first = packages.entryOf(known.imported);

    expect(packages.entryOf(known.imported)).toBe(first);
    expect(packages.entryOf(other.imported)?.version).toBe('0.4.0');
  });

  it('does not grant package root identity to a subpath import', () => {
    const { imported } = fixture(metadata, "import { instanceToPlain } from 'class-transformer/types/index';");

    expect(new ResolvedPackages().entryOf(imported)).toBeUndefined();
  });
});
