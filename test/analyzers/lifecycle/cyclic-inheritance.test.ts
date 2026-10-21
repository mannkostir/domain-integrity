import { describe, expect, it } from 'vitest';
import { analyse } from '../../../src/analyzer';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { inheritanceChain } from '../../../src/analyzers/lifecycle/field-ref';
import { hasCyclicInheritance } from '../../../src/analyzers/shared/cyclic-heritage';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';
import { lifecycleFindings, methodOf } from '../../helpers/model';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/loop.ts': `
import { AggregateRoot } from './aggregate-root';
export enum LoopStatus { open = 'OPEN', closed = 'CLOSED' }
export class Upper extends Lower {}
export class Lower extends Upper {
  protected props: { status: LoopStatus; title: string } = { status: LoopStatus.open, title: '' };
  rename(title: string): void { this.props.title = title; }
  close(): void { this.props.status = LoopStatus.closed; }
}
export class Plain extends AggregateRoot<{ status: LoopStatus }> {}
`,
});

const loopFile = project.getSourceFileOrThrow('/src/loop.ts');
const lower = loopFile.getClassOrThrow('Lower');

const LIFECYCLE_BODY = `
  protected props: { status: 'OPEN' | 'CLOSED'; title: string } = { status: 'OPEN', title: '' };
  rename(title: string): void { this.props.title = title; }
  close(): void { this.props.status = 'CLOSED'; }`;

const leakingMethods = (files: Readonly<Record<string, string>>, path: string, name: string): readonly (string | undefined)[] => {
  const shapeProject = inMemoryProject({ '/src/aggregate-root.ts': AGGREGATE_ROOT, ...files });
  const target = shapeProject.getSourceFileOrThrow(path).getClassOrThrow(name);
  const result = analyse(lifecycleAnalyzer, {
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: shapeProject.getSourceFiles(),
    projectRoot: '/', repositoryRoot: '/',
  });
  return [...lifecycleFindings(result.findings).map((finding) => methodOf(finding)), ...result.problems.map((problem) => problem.message)];
};

describe('cyclic inheritance through qualified or aliased heritage', () => {
  it('reports nothing when the loop runs through namespace imports', () => {
    const found = leakingMethods(
      {
        '/src/a.ts': "import * as b from './b';\nexport class Upper extends b.Lower {}",
        '/src/b.ts': `import * as a from './a';\nexport class Lower extends a.Upper {${LIFECYCLE_BODY}\n}`,
      },
      '/src/b.ts',
      'Lower',
    );

    expect(found).toEqual([]);
  });

  it('reports nothing when the loop runs through a variable alias', () => {
    const found = leakingMethods(
      { '/src/loop.ts': `const L = Low;\nclass Up extends L {}\nexport class Low extends Up {${LIFECYCLE_BODY}\n}` },
      '/src/loop.ts',
      'Low',
    );

    expect(found).toEqual([]);
  });

  it('still reports for a hierarchy reached through a namespace import', () => {
    const found = leakingMethods(
      {
        '/src/base.ts': 'export abstract class Base {}',
        '/src/leaf.ts': `import * as m from './base';\nexport class Leaf extends m.Base {${LIFECYCLE_BODY}\n}`,
      },
      '/src/leaf.ts',
      'Leaf',
    );

    expect(found).toEqual(['rename', 'close']);
  });

  it('still reports for a hierarchy reached through a variable alias', () => {
    const found = leakingMethods(
      { '/src/leaf.ts': `abstract class Ok {}\nconst K = Ok;\nexport class Leaf extends K {${LIFECYCLE_BODY}\n}` },
      '/src/leaf.ts',
      'Leaf',
    );

    expect(found).toEqual(['rename', 'close']);
  });
});

describe('cyclic inheritance', () => {
  it('ends the inheritance chain of a class whose heritage loops', () => {
    const chain = inheritanceChain(lower);

    expect(chain.map((cls) => cls.getName())).toEqual(['Lower']);
  });

  it('does not mark a linear hierarchy as cyclic', () => {
    const plain = loopFile.getClassOrThrow('Plain');

    const cyclic = hasCyclicInheritance(plain);

    expect(cyclic).toBe(false);
  });

  it('reports no finding and no problem for a declared aggregate whose heritage loops', () => {
    const result = analyse(lifecycleAnalyzer, {
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: lower, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
      },
      files: project.getSourceFiles(),
      projectRoot: '/', repositoryRoot: '/',
    });

    expect({ findings: result.findings, problems: result.problems }).toEqual({ findings: [], problems: [] });
  });
});
