import { describe, expect, it } from 'vitest';
import { analyse } from '../../../src/analyzer';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { inheritanceChain } from '../../../src/analyzers/lifecycle/field-ref';
import { hasCyclicInheritance } from '../../../src/analyzers/shared/cyclic-heritage';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

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
      root: '/',
    });

    expect({ findings: result.findings, problems: result.problems }).toEqual({ findings: [], problems: [] });
  });
});
