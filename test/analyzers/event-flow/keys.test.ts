import { SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { resolveKey } from '../../../src/analyzers/event-flow/keys';
import { inMemoryProject } from '../../helpers/in-memory';

const argumentsOf = (source: string): readonly string[] => {
  const project = inMemoryProject({
    '/src/events.ts': 'export class Paid {}\nexport interface Shape {}',
    '/types/lib.d.ts': 'export declare class LibraryEvent {}',
    '/src/use.ts': `import { Paid, Shape } from './events';\nimport { LibraryEvent } from '../types/lib';\nimport { Paid as Renamed } from './events';\ndeclare const key: (...keys: unknown[]) => void;\nconst variable = Paid;\n${source}`,
  });
  const call = project.getSourceFileOrThrow('/src/use.ts').getDescendantsOfKind(SyntaxKind.CallExpression).at(-1)!;
  const isProject = (cls: { getSourceFile: () => { isDeclarationFile: () => boolean } }) => !cls.getSourceFile().isDeclarationFile();
  return call.getArguments().map((argument) => {
    const resolution = resolveKey(argument, isProject);
    return resolution.kind === 'project' ? `project:${resolution.cls.getName()}` : resolution.kind;
  });
};

describe('resolveKey', () => {
  it('resolves a class, its name, an import alias, a library class and everything else', () => {
    expect(argumentsOf("key(Paid, Paid.name, Renamed, LibraryEvent, variable, 'Paid', Paid.prototype);")).toEqual([
      'project:Paid',
      'project:Paid',
      'project:Paid',
      'foreign',
      'unresolved',
      'unresolved',
      'unresolved',
    ]);
  });
});
