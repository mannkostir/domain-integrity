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

const closingTicket = (closeMember: string, extraMembers = '') => `
import { AggregateRoot } from './aggregate-root';
export enum Status { Open = 'OPEN', Closed = 'CLOSED' }
export class Ticket extends AggregateRoot {
  private status: Status = Status.Open;
  private closedAt: Date | null = null;
  private title = '';
  ${closeMember}
  rename(title: string): void {
    if (this.status === Status.Closed) throw new Error('closed');
    this.title = title;
  }
  ${extraMembers}
}
`;

const STATUS_GUARD = "if (this.status === Status.Closed) throw new Error('closed');";

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

  it('is kept when the status is written only on some paths through the method', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(
        `close(force: boolean): void {
    if (this.closedAt !== null) throw new Error('closed');
    this.closedAt = new Date();
    if (force) this.status = Status.Closed;
  }`,
        `forceClose(): void {
    ${STATUS_GUARD}
    this.status = Status.Closed;
  }`,
      ),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a branch writing the timestamp returns before the status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(now: Date): void {
    ${STATUS_GUARD}
    if (now.getTime() === 0) {
      this.closedAt = now;
      return;
    }
    this.closedAt = now;
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the timestamp is written inside a conditional expression', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(now: Date | null): void {
    ${STATUS_GUARD}
    now ? (this.closedAt = now) : undefined;
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the timestamp is written inside a logical expression', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(now: Date | null): void {
    ${STATUS_GUARD}
    now && (this.closedAt = now);
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when the status is written in an enclosing block before a nested timestamp write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(now: Date | null): void {
    ${STATUS_GUARD}
    this.status = Status.Closed;
    if (now) {
      this.closedAt = now;
    }
  }`),
    });

    expect(terminals).toEqual(new Map([['status', ['CLOSED']], ['closedAt', []]]));
  });
});
