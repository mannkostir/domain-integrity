import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { ConfigError, ProjectError } from '../../src/engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject, loadedSourceFiles } from '../../src/engine/project';
import { writeTree } from '../helpers/disk';
import { inMemoryProject } from '../helpers/in-memory';

const fileNames = (project: Project, root: string): string[] =>
  project.getSourceFiles().map((file) => relative(root, file.getFilePath())).sort();

const projectWithRootConfig = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-')));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'domain.config.ts'), 'export default {};\n');
  return dir;
};

describe('loadProject', () => {
  it('fails with a ProjectError when the tsconfig does not exist', () => {
    expect(() => loadProject('/definitely/missing/tsconfig.json', '/definitely/missing/domain.config.ts')).toThrow(ProjectError);
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

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts')), dir)).toEqual(['apps/api/src/main.ts', 'libs/orders/src/order.ts']);
  });

  it('leaves out referenced files of a kind the entry compiler options do not support', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './app' }] }),
      'app/tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true }, include: ['src'] }),
      'app/src/order.ts': 'export class Order {}\n',
      'app/src/legacy.js': "export class Legacy { status = 'open'; }\n",
    });

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts')), dir)).toEqual(['app/src/order.ts']);
  });

  it('fails with a ProjectError naming the referrer of a missing reference', () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './gone' }] }) });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'))).toThrow(
      new ProjectError(`tsconfig not found: ${join(dir, 'gone/tsconfig.json')} (referenced from ${join(dir, 'tsconfig.json')})`),
    );
  });

  it('says a tsconfig without references includes no source files', () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ files: [] }) });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'))).toThrow(
      new ProjectError(
        `Loaded 0 source files.\n${join(dir, 'tsconfig.json')} includes no source files.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.`,
      ),
    );
  });

  it('says a tsconfig and its references include no source files', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './a' }] }),
      'a/tsconfig.json': JSON.stringify({ files: [] }),
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'))).toThrow(
      new ProjectError(`Loaded 0 source files.\n${join(dir, 'tsconfig.json')} and the tsconfigs it references include no source files.`),
    );
  });

  it('says a tsconfig without references includes no source files other than the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'))).toThrow(
      new ProjectError(
        `Loaded 0 source files.\n${join(dir, 'tsconfig.json')} includes no source files other than ${join(dir, 'domain.config.ts')}.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.`,
      ),
    );
  });

  it('says a tsconfig and its references include no source files other than the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './a' }] }),
      'a/tsconfig.json': JSON.stringify({ files: ['../domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'))).toThrow(
      new ProjectError(
        `Loaded 0 source files.\n${join(dir, 'tsconfig.json')} and the tsconfigs it references include no source files other than ${join(dir, 'domain.config.ts')}.`,
      ),
    );
  });

  it('recognises the config through a path that is not normalised', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }),
      'domain.config.ts': 'export default {};\n',
    });

    expect(() => loadProject(join(dir, 'tsconfig.json'), `${dir}/./src/../domain.config.ts`)).toThrow(
      new ProjectError(
        `Loaded 0 source files.\n${join(dir, 'tsconfig.json')} includes no source files other than ${join(dir, 'domain.config.ts')}.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.`,
      ),
    );
  });

  it('loads a project that includes a source besides the config', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ include: ['domain.config.ts', 'src'] }),
      'domain.config.ts': 'export default {};\n',
      'src/a.ts': 'export const a = 1;\n',
    });

    expect(fileNames(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts')), dir)).toEqual(['domain.config.ts', 'src/a.ts']);
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
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'));

    expect(configSourceFile(project, join(dir, 'domain.config.ts')).getFilePath()).toBe(join(dir, 'domain.config.ts'));
  });

  it('fails with a ConfigError that suggests init when the config does not exist', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'));

    expect(() => configSourceFile(project, join(dir, 'missing.config.ts'))).toThrow(/domain-integrity init/);
  });

  it('uses ConfigError for a missing config', () => {
    const project = inMemoryProject({});

    expect(() => configSourceFile(project, '/domain.config.ts')).toThrow(ConfigError);
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
