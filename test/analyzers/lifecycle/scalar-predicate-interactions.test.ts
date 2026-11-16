import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const setup = () => {
  const project = inMemoryProject({ '/order.ts': `
    enum Stage { Open = 'open', Closed = 'closed' }
    abstract class RecordBase<T> {
      protected readonly props: T;
      constructor(props: T) { this.props = props; }
    }
    class Status extends RecordBase<{ value: Stage }> {
      constructor(value: Stage) { super({ value }); }
      get value(): Stage { return this.props.value; }
      static create(value: Stage) { return new Status(value); }
      isClosed() { return this.props.value === Stage.Closed; }
    }
    export class Order {
      status: Status = Status.create(Stage.Open);
      closed: boolean = false;
      label = '';
      isClosed() { return this.closed; }
      wrapperOnly() { if (this.status.isClosed()) return; this.label = 'x'; }
      scalarOnly() { if (this.isClosed()) return; this.label = 'x'; }
      combined() { if (this.isClosed() || this.status.isClosed()) return; this.label = 'x'; }
      unguarded() { this.label = 'x'; }
    }
  ` });
  const cls = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = extractLifecycles({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: ['closed', 'status'].map(name => ({ name, terminal: [name === 'closed' ? 'true' : 'closed'], transitions: undefined, allowAfterTerminal: [] })), allowAfterTerminal: [] }] },
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
  });
  return { project, model, aggregate: model.aggregates.find(aggregate => aggregate.name === 'Order')! };
};

describe('scalar and wrapper predicates in the same aggregate', () => {
  it('uses diagnostic-free source', () => {
    const { project } = setup();

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each([
    ['wrapperOnly', 'closed', ['false', 'true']],
    ['wrapperOnly', 'status', ['open']],
    ['scalarOnly', 'closed', ['false']],
    ['scalarOnly', 'status', ['closed', 'open']],
    ['combined', 'closed', ['false']],
    ['combined', 'status', ['open']],
    ['unguarded', 'closed', ['false', 'true']],
    ['unguarded', 'status', ['closed', 'open']],
  ] as const)('retains %s source sets for %s', (method, field, expected) => {
    const { aggregate } = setup();
    const actual = aggregate.methods.find(candidate => candidate.name === method)!.fields.get(field)!.sources;

    expect(describeSources(actual)).toEqual(expected);
  });
});
