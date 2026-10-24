import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { ConfigError, ProjectError } from '../../src/engine/errors';
import { toNativePath, toPosixRelative } from '../../src/engine/path';
import { analysedSourceFiles, configSourceFile, loadProject, loadedSourceFiles } from '../../src/engine/project';
import { writeTree } from '../helpers/disk';
import { inMemoryProject } from '../helpers/in-memory';

const fileNames = (project: Project, root: string): string[] =>
  project.getSourceFiles().map((file) => toPosixRelative(root, file.getFilePath())).sort();

const projectWithRootConfig = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-')));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'domain.config.ts'), 'export default {};\n');
  return dir;
};

describe('loadProject', () => {
  it('names a missing tsconfig relative to the cwd and how to point at the right one', () => {
    expect(() => loadProject('/definitely/missing/tsconfig.json', '/definitely/missing/domain.config.ts', '/definitely')).toThrow(
      new ProjectError(
        'tsconfig not found: missing/tsconfig.json. Run domain-integrity from the project root, or pass -p with the path to your tsconfig.json or the directory that contains it.',
      ),
    );
  });

  it('names a tsconfig it cannot load relative to the cwd', () => {
    const dir = writeTree({ 'tsconfig.json': '{ "files": [' });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(new ProjectError("Cannot load tsconfig.json: ']' expected."));
  });

  it('loads the files of every referenced tsconfig', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './apps/api' }] }),
      'apps/api/tsconfig.json': JSON.stringify({ include: ['src'], references: [{ path: '../../libs/orders' }] }),
      'apps/api/src/main.ts': 'export const main = 1;\n',
      'libs/orders/tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.lib.json' }] }),
      'libs/orders/tsconfig.lib.json': JSON.stringify({ include: ['src'] }),
      'libs/orders/src/order.ts': 'export class Order {}\n',
    });

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir), dir)).toEqual(['apps/api/src/main.ts', 'libs/orders/src/order.ts']);
  });

  it('leaves out referenced files of a kind the entry compiler options do not support', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './app' }] }),
      'app/tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true }, include: ['src'] }),
      'app/src/order.ts': 'export class Order {}\n',
      'app/src/legacy.js': "export class Legacy { status = 'open'; }\n",
    });

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir), dir)).toEqual(['app/src/order.ts']);
  });

  it('fails with a ProjectError naming the referrer of a missing reference', () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './gone' }] }) });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(
      new ProjectError('tsconfig not found: gone/tsconfig.json (referenced from tsconfig.json). Correct the path in the "references" of tsconfig.json.'),
    );
  });

  it('says a tsconfig without references includes no source files', () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ files: [] }) });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(
      new ProjectError(
        'Loaded 0 source files.\ntsconfig.json includes no source files.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.',
      ),
    );
  });

  it('says a tsconfig and its references include no source files', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './a' }] }),
      'a/tsconfig.json': JSON.stringify({ files: [] }),
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(
      new ProjectError('Loaded 0 source files.\ntsconfig.json and the tsconfigs it references include no source files.'),
    );
  });

  it('says a tsconfig without references includes no source files other than the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(
      new ProjectError(
        'Loaded 0 source files.\ntsconfig.json includes no source files other than domain.config.ts.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.',
      ),
    );
  });

  it('says a tsconfig and its references include no source files other than the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './a' }] }),
      'a/tsconfig.json': JSON.stringify({ files: ['../domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir)).toThrow(
      new ProjectError(
        'Loaded 0 source files.\ntsconfig.json and the tsconfigs it references include no source files other than domain.config.ts.',
      ),
    );
  });

  it('recognises the config through a path that is not normalised', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), `${dir}/./src/../domain.config.ts`, dir)).toThrow(
      new ProjectError(
        'Loaded 0 source files.\ntsconfig.json includes no source files other than domain.config.ts.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.',
      ),
    );
  });

  it('names the tsconfig and the config of an empty program relative to the cwd', () => {
    const dir = writeTree({
      'app/tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }),
      'app/domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'app/tsconfig.json'), join(dir, 'app/domain.config.ts'), dir)).toThrow(
      new ProjectError(
        'Loaded 0 source files.\napp/tsconfig.json includes no source files other than app/domain.config.ts.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.',
      ),
    );
  });

  it('loads a project that includes a source besides the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts', 'src'] }),
      'domain.config.ts': 'export default {};\n',
      'src/a.ts': 'export const a = 1;\n',
    });

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir), dir)).toEqual(['domain.config.ts', 'src/a.ts']);
  });
});

describe('loadedSourceFiles', () => {
  it('counts one source file in the singular', () => {
    expect(loadedSourceFiles(1)).toBe('Loaded 1 source file.');
  });

  it('counts other numbers of source files in the plural', () => {
    expect(loadedSourceFiles(0)).toBe('Loaded 0 source files.');
  });
});

describe('configSourceFile', () => {
  it('loads a config that lives outside the tsconfig include globs', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir);

    expect(toNativePath(configSourceFile(project, join(dir, 'domain.config.ts'), dir).getFilePath())).toBe(join(dir, 'domain.config.ts'));
  });

  it('names a missing config relative to the cwd and suggests init or -c', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir);

    expect(() => configSourceFile(project, join(dir, 'config/missing.config.ts'), dir)).toThrow(
      new ConfigError('config/missing.config.ts not found. Run "domain-integrity init" to create it, or pass -c with the path to your config file.'),
    );
  });

  it('uses ConfigError for a missing config', () => {
    const project = inMemoryProject({});

    expect(() => configSourceFile(project, '/domain.config.ts', '/')).toThrow(ConfigError);
  });
});

describe('analysedSourceFiles', () => {
  const paths = (files: readonly { getFilePath(): string }[]): string[] => files.map((file) => file.getFilePath());

  it('keeps project files outside the tsconfig folder', () => {
    const project = inMemoryProject({
      '/repo/apps/api/src/a.ts': 'export const a = 1;',
      '/repo/libs/orders/src/b.ts': 'export const b = 2;',
    });

    expect(paths(analysedSourceFiles(project))).toEqual(
      expect.arrayContaining(['/repo/apps/api/src/a.ts', '/repo/libs/orders/src/b.ts']),
    );
  });

  it('leaves out the config file', () => {
    const project = inMemoryProject({
      '/repo/apps/api/src/a.ts': 'export const a = 1;',
      '/repo/apps/api/domain.config.ts': 'export default {};',
    });
    const config = project.getSourceFileOrThrow('/repo/apps/api/domain.config.ts');

    expect(paths(analysedSourceFiles(project, config))).not.toContain('/repo/apps/api/domain.config.ts');
  });

  it('leaves out declaration files', () => {
    const project = inMemoryProject({ '/repo/src/types.d.ts': 'export declare const t: number;' });

    expect(paths(analysedSourceFiles(project))).not.toContain('/repo/src/types.d.ts');
  });

  it('leaves out node_modules', () => {
    const project = inMemoryProject({ '/repo/node_modules/lib/index.ts': 'export const l = 1;' });

    expect(paths(analysedSourceFiles(project))).not.toContain('/repo/node_modules/lib/index.ts');
  });
});
