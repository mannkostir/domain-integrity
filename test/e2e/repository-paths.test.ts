import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
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
});
