import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const ticketSource = (closedAtModifier: string, extraMembers: string, moduleCode = '', baseClass = 'AggregateRoot') => `
import { AggregateRoot } from './aggregate-root';
export enum Status { Open = 'OPEN', Closed = 'CLOSED' }
${moduleCode}
export class Ticket extends ${baseClass} {
  private status: Status = Status.Open;
  ${closedAtModifier}
  private title = '';
  close(now: Date): void {
    if (this.status === Status.Closed) throw new Error('closed');
    this.closedAt = now;
    this.status = Status.Closed;
  }
  rename(title: string): void {
    if (this.status === Status.Closed) throw new Error('closed');
    this.title = title;
  }
  ${extraMembers}
}
`;

const suggestedTerminals = (files: Readonly<Record<string, string>>): ReadonlyMap<string, readonly string[]> => {
  const project = inMemoryProject({ '/src/aggregate-root.ts': AGGREGATE_ROOT, ...files });
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [] },
    files: project.getSourceFiles(),
    root: '/',
  });
  const ticket = lifecycleAnalyzer.suggest(model).find((suggestion) => suggestion.className === 'Ticket');
  return new Map(ticket?.fields.map(({ field, terminal }) => [field.name, terminal.map((value) => value.token)]));
};

const PUBLIC_CLOSED_AT = 'public closedAt: Date | null = null;';

const BASE_WITH_SETTER = `
import { AggregateRoot } from './aggregate-root';
export class Closable extends AggregateRoot {
  protected closedAt: Date | null = null;
  set closing(d: Date) { this.closedAt = d; }
}
`;

describe('terminal suggestion for a timestamp settled by the status lifecycle', () => {
  it('is dropped when the status settles every write to the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(
        'private closedAt: Date | null = null;',
        `get isClosed(): boolean { return this.status === Status.Closed; }
  touch(): void { if (this.isClosed) throw new Error('closed'); this.title = this.title.trim(); }`,
      ),
    });

    expect(terminals).toEqual(new Map([['status', ['CLOSED']], ['closedAt', []]]));
  });

  it('is kept when a setter writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PUBLIC_CLOSED_AT, 'set closing(d: Date) { this.closedAt = d; }'),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a method copies unknown properties onto the aggregate', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PUBLIC_CLOSED_AT, 'stamp(p: { closedAt: Date }): void { Object.assign(this, p); }'),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when code outside the class writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(
        PUBLIC_CLOSED_AT,
        '',
        'export const svc = (t: Ticket) => { t.closedAt = new Date(); };',
      ),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a method passes the aggregate to a function that writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(
        PUBLIC_CLOSED_AT,
        'stamp(): void { mutate(this); }',
        'const mutate = (t: Ticket) => { t.closedAt = new Date(); };',
      ),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a setter on a project base class writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/closable.ts': BASE_WITH_SETTER,
      '/src/ticket.ts': ticketSource('', '', "import { Closable } from './closable';", 'Closable'),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });
});
