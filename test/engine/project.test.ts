import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, ProjectError } from '../../src/engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../../src/engine/project';
import { inMemoryProject } from '../helpers/in-memory';

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
    expect(() => loadProject('/definitely/missing/tsconfig.json')).toThrow(ProjectError);
  });
});

describe('configSourceFile', () => {
  it('loads a config that lives outside the tsconfig include globs', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'));

    expect(configSourceFile(project, join(dir, 'domain.config.ts')).getFilePath()).toBe(join(dir, 'domain.config.ts'));
  });

  it('fails with a ConfigError that suggests init when the config does not exist', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'));

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
