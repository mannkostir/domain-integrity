import { describe, expect, it } from 'vitest';
import { candidateFields } from '../../../src/analyzers/lifecycle/candidates';
import { resolveStateField } from '../../../src/analyzers/lifecycle/state-field';
import { defaultScope } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/samples.ts': `
import { AggregateRoot } from './aggregate-root';
export enum Status { open = 'OPEN', closed = 'CLOSED' }
export enum Priority { low, high }
export class InProps extends AggregateRoot<{ status: Status; closedAt: Date | null; archivedAt?: Date; endedAt?: Date | null; stoppedAt: Date | null | undefined; note: string }> {}
export class OwnFields extends AggregateRoot {
  private deleted = false;
  phase: 'draft' | 'live' = 'draft';
  priority: Priority = Priority.low;
  maybe: boolean | null = null;
}
export class Accessed extends AggregateRoot {
  private _status: Status = Status.open;
  get status(): Status { return this._status; }
  set status(value: Status) { this._status = value; }
  close(): void { this._status = Status.closed; }
}
export class AccessedProps extends AggregateRoot<{ status: Status }> {
  get status(): Status { return this.props.status; }
}
`,
});

const cls = (name: string) => project.getSourceFileOrThrow('/src/samples.ts').getClassOrThrow(name);

describe('resolveStateField', () => {
  it('resolves an enum field stored in props with labels and source text', () => {
    expect(resolveStateField(cls('InProps'), 'status')).toEqual({
      kind: 'resolved',
      field: {
        name: 'status',
        kind: 'enum',
        values: [
          { token: 'OPEN', label: 'open', source: 'Status.open' },
          { token: 'CLOSED', label: 'closed', source: 'Status.closed' },
        ],
        enumReference: { name: 'Status', file: '/src/samples.ts' },
        unsetForms: [],
      },
    });
  });

  it.each([
    ['InProps', 'closedAt'],
    ['InProps', 'archivedAt'],
  ])('resolves %s.%s as a nullable field', (className, field) => {
    expect(resolveStateField(cls(className), field)).toMatchObject({
      kind: 'resolved',
      field: { kind: 'nullable', values: [{ token: 'set' }, { token: 'unset' }] },
    });
  });

  it.each([
    ['closedAt', ['null']],
    ['archivedAt', ['undefined']],
    ['endedAt', ['null', 'undefined']],
    ['stoppedAt', ['null', 'undefined']],
    ['status', []],
  ])('records the unset forms of InProps.%s', (field, unsetForms) => {
    expect(resolveStateField(cls('InProps'), field)).toMatchObject({ kind: 'resolved', field: { unsetForms } });
  });

  it('resolves a private boolean field', () => {
    expect(resolveStateField(cls('OwnFields'), 'deleted')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'boolean', values: [{ token: 'true', source: 'true' }, { token: 'false', source: 'false' }] },
    });
  });

  it('resolves a string literal union with quoted sources', () => {
    expect(resolveStateField(cls('OwnFields'), 'phase')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'union', values: [{ token: 'draft', source: "'draft'" }, { token: 'live', source: "'live'" }] },
    });
  });

  it('resolves a numeric enum with member names as labels', () => {
    expect(resolveStateField(cls('OwnFields'), 'priority')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'enum', values: [{ token: '0', label: 'low' }, { token: '1', label: 'high' }] },
    });
  });

  it.each([
    ['InProps', 'note'],
    ['OwnFields', 'maybe'],
  ])('reports %s.%s as an unsupported type', (className, field) => {
    expect(resolveStateField(cls(className), field)).toMatchObject({ kind: 'problem', message: expect.stringContaining('unsupported type') });
  });

  it('reports a field that does not exist', () => {
    expect(resolveStateField(cls('InProps'), 'missing')).toEqual({ kind: 'problem', message: 'InProps has no field "missing"' });
  });

  it('asks for the backing field when the state field is only an accessor', () => {
    expect(resolveStateField(cls('Accessed'), 'status')).toEqual({
      kind: 'problem',
      message: 'Accessed.status is an accessor; declare its backing field instead',
    });
  });

  it('resolves an accessor whose name is also a data property in props', () => {
    expect(resolveStateField(cls('AccessedProps'), 'status')).toMatchObject({ kind: 'resolved', field: { kind: 'enum' } });
  });
});

describe('candidateFields', () => {
  it('proposes the backing field and never the accessor', () => {
    expect(candidateFields(defaultScope(cls('Accessed')), []).map((field) => field.name)).toEqual(['_status']);
  });
});
