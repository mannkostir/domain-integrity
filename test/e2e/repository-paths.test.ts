import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { SarifLog } from '../helpers/sarif-log';
import { TICKET_PROJECT, captureIo, writeNestedProject, writeProject } from '../helpers/disk';

type WireReport = { readonly findings: readonly { readonly location: { readonly file: string } }[] };

const filesReported = async (cwd: string, args: readonly string[]): Promise<readonly string[]> => {
  const { io, stdout } = captureIo(cwd);
  await run(['check', '--format', 'json', ...args], io);
  return (JSON.parse(stdout()) as WireReport).findings.map((finding) => finding.location.file);
};

const nestedInRepository = (gitEntry: 'directory' | 'file'): string => {
  const { top, project } = writeNestedProject(TICKET_PROJECT);
  if (gitEntry === 'directory') mkdirSync(join(top, '.git'));
  else writeFileSync(join(top, '.git'), 'gitdir: /elsewhere\n');
  return project;
};

describe('paths reported relative to the repository root', () => {
  it('reports paths relative to the tsconfig directory outside any repository', async () => {
    const files = await filesReported(writeProject(TICKET_PROJECT), []);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.startsWith('src/'))).toBe(true);
  });

  it('reports paths relative to a .git directory above the tsconfig', async () => {
    const files = await filesReported(nestedInRepository('directory'), []);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.startsWith('pkg/src/'))).toBe(true);
  });

  it('treats a .git file as the repository root', async () => {
    const files = await filesReported(nestedInRepository('file'), []);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.startsWith('pkg/src/'))).toBe(true);
  });

  it('points SARIF results of a per-package tsconfig at files under the repository root', async () => {
    const { top, project } = writeNestedProject(TICKET_PROJECT);
    mkdirSync(join(top, '.git'));
    const { io, stdout } = captureIo(top);

    await run(['check', '--format', 'sarif', '-p', relative(top, join(project, 'tsconfig.json')), '-c', relative(top, join(project, 'domain.config.ts'))], io);

    const uris = (JSON.parse(stdout()) as SarifLog).runs[0]?.results.map((result) => result.locations[0]?.physicalLocation.artifactLocation.uri ?? '') ?? [];
    expect(uris.length > 0 && uris.every((uri) => uri.startsWith('pkg/') && existsSync(join(top, uri)))).toBe(true);
  });

  it('keeps paths relative to the repository root when run from the package directory', async () => {
    const { top, project } = writeNestedProject(TICKET_PROJECT);
    mkdirSync(join(top, '.git'));

    const files = await filesReported(project, ['-p', 'tsconfig.json']);

    expect(files.length > 0 && files.every((file) => file.startsWith('pkg/'))).toBe(true);
  });
});
