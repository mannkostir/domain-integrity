import { describe, expect, it } from 'vitest';
import { moduleMayExpose } from '../../../src/analyzers/lifecycle/runtime-dependencies';
import { inMemoryProject } from '../../helpers/in-memory';

const graphs = [
  { name: 'direct export', files: { '/entry.ts': "export { Selected } from './target';" }, expected: true },
  { name: 'renamed export', files: { '/entry.ts': "export { Selected as Renamed } from './target';" }, expected: true },
  { name: 'multihop star', files: { '/entry.ts': "export * from './middle';", '/middle.ts': "export * from './target';" }, expected: true },
  { name: 'nested namespace', files: { '/entry.ts': "export * as inner from './middle';", '/middle.ts': "export * from './target';" }, expected: true },
  { name: 'reachable dependency beside a cycle', files: { '/entry.ts': "export * as loop from './middle'; export { Selected } from './target';", '/middle.ts': "export * as loop from './entry';" }, expected: true },
  { name: 'unrelated cycle', files: { '/entry.ts': "export * as loop from './middle'; export const harmless = 1;", '/middle.ts': "export * as loop from './entry';" }, expected: false },
  { name: 'work exhaustion', files: { '/entry.ts': Array.from({ length: 300 }, (_, index) => `export const value${index} = ${index};`).join('\n') }, expected: true },
] as const;

const sample = (files: Readonly<Record<string, string>>) => {
  const project = inMemoryProject({ '/target.ts': 'export class Selected {}', ...files });
  const selected = project.getSourceFileOrThrow('/target.ts').getClassOrThrow('Selected');
  return { project, actual: moduleMayExpose(project.getSourceFileOrThrow('/entry.ts').getSymbol(), [selected]) };
};

describe('resolved module dependency reachability', () => {
  it.each(graphs)('uses diagnostic-free source for $name', ({ files }) => {
    const { project } = sample(files);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(graphs)('accounts for $name', ({ files, expected }) => {
    const { actual } = sample(files);

    expect(actual).toBe(expected);
  });
});
