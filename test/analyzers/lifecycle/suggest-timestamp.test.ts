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
    projectRoot: '/', repositoryRoot: '/',
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

const COVERED_CLOSE = `close(): void {
    this.status = Status.Closed;
    this.closedAt = new Date();
  }`;

const coveredTicket = (extraMembers: string) => ({ '/src/ticket.ts': closingTicket(COVERED_CLOSE, extraMembers) });

const PROPS_TICKET = `
import { AggregateRoot } from './aggregate-root';
export enum Status { Open = 'OPEN', Closed = 'CLOSED' }
export class Ticket extends AggregateRoot<{ status: Status; closedAt: Date | null }> {
  close(): void {
    if (this.props.status === Status.Closed) throw new Error('closed');
    this.props.status = Status.Closed;
    this.props.closedAt = new Date();
  }
}
`;

describe('terminal suggestion for a timestamp written where the status cannot be followed', () => {
  it('is kept when an arrow-function property writes the timestamp', () => {
    const terminals = suggestedTerminals(coveredTicket('force = (): void => { this.closedAt = new Date(); };'));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a closure built in the constructor writes the timestamp', () => {
    const terminals = suggestedTerminals(
      coveredTicket(`private forcer: () => void;
  constructor() {
    super({});
    this.forcer = () => { this.closedAt = new Date(); };
  }
  force(): void { this.forcer(); }`),
    );

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a static member writes the timestamp', () => {
    const terminals = suggestedTerminals(coveredTicket('static force(t: Ticket): void { t.closedAt = new Date(); }'));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a method writes the timestamp of another instance', () => {
    const terminals = suggestedTerminals(coveredTicket('stampOther(o: Ticket): void { o.closedAt = new Date(); }'));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a method writes through a computed key', () => {
    const terminals = suggestedTerminals(coveredTicket("other(k: 'closedAt'): void { this[k] = new Date(); }"));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when an await separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`async close(): Promise<void> {
    this.closedAt = new Date();
    await Promise.resolve();
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a yield separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`*close(): Generator<number> {
    this.closedAt = new Date();
    yield 1;
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a throw separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(now: Date): void {
    this.closedAt = now;
    if (now.getTime() === 0) throw new Error('x');
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a break inside a loop separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(dates: readonly Date[]): void {
    for (const date of dates) {
      this.closedAt = date;
      if (date.getTime() === 0) break;
      this.status = Status.Closed;
    }
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a continue inside a loop separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(dates: readonly Date[]): void {
    for (const date of dates) {
      this.closedAt = date;
      if (date.getTime() === 0) continue;
      this.status = Status.Closed;
    }
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a getter writes the timestamp', () => {
    const terminals = suggestedTerminals(
      coveredTicket('get stamped(): boolean { this.closedAt = new Date(); return true; }'),
    );

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the status is written before a nested callback that writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(): void {
    ${STATUS_GUARD}
    this.status = Status.Closed;
    [1].forEach(() => { this.closedAt = new Date(); });
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when the status and the timestamp are written through the props holder', () => {
    const terminals = suggestedTerminals({ '/src/ticket.ts': PROPS_TICKET });

    expect(terminals).toEqual(new Map([['status', ['CLOSED']], ['closedAt', []]]));
  });

  it('is dropped when the constructor assigns the timestamp from a parameter', () => {
    const terminals = suggestedTerminals(
      coveredTicket(`constructor(closedAt: Date | null) {
    super({});
    this.closedAt = closedAt;
  }`),
    );

    expect(terminals.get('closedAt')).toEqual([]);
  });
});

describe('terminal suggestion for a timestamp written by forms other than an assignment expression', () => {
  it('is kept when a subclass writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource('protected closedAt: Date | null = null;', ''),
      '/src/urgent-ticket.ts': `
import { Ticket } from './ticket';
export class UrgentTicket extends Ticket {
  stamp(): void { this.closedAt = new Date(); }
}
`,
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a for-of loop assigns the timestamp', () => {
    const terminals = suggestedTerminals(coveredTicket('restamp(dates: Date[]): void { for (this.closedAt of dates) { } }'));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a for-in loop assigns the timestamp', () => {
    const terminals = suggestedTerminals(coveredTicket('restamp(keys: object): void { for (this.closedAt in keys) { } }'));

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the timestamp is deleted', () => {
    const terminals = suggestedTerminals(
      coveredTicket('clear(): void { delete (this as { closedAt?: Date | null }).closedAt; }'),
    );

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a for-await loop separates the timestamp from a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`async close(ticks: AsyncIterable<number>): Promise<void> {
    ${STATUS_GUARD}
    this.closedAt = new Date();
    for await (const tick of ticks) { this.title = String(tick); }
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });
});

const MUTATE = 'declare function mutate(ticket: object): void;';
const PRIVATE_CLOSED_AT = 'private closedAt: Date | null = null;';

describe('terminal suggestion for a timestamp on an aggregate that lets this escape outside its methods', () => {
  it('is kept when an arrow-function property passes this to a function', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, 'later = (): void => { mutate(this); };', MUTATE),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a property initializer passes this to a function', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, 'registered = mutate(this);', MUTATE),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the constructor passes this to a function', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, 'constructor() { super({}); mutate(this); }', MUTATE),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when the constructor only copies its argument into this', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, 'constructor(props: object) { super({}); Object.assign(this, props); }'),
    });

    expect(terminals.get('closedAt')).toEqual([]);
  });
});

describe('terminal suggestion for a timestamp whose later status write follows code that may throw', () => {
  it('is kept when a method call separates the writes', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(
        `close(): void {
    ${STATUS_GUARD}
    this.closedAt = new Date();
    this.validate();
    this.status = Status.Closed;
  }`,
        "private validate(): void { if (this.title === '') throw new Error('untitled'); }",
      ),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a new expression separates the writes', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(): void {
    ${STATUS_GUARD}
    this.closedAt = new Date();
    this.title = new String('closed').toString();
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a tagged template separates the writes', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(): void {
    ${STATUS_GUARD}
    this.closedAt = new Date();
    this.title = String.raw\`closed\`;
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when the timestamp value itself is constructed before a later status write', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': closingTicket(`close(): void {
    ${STATUS_GUARD}
    this.closedAt = new Date();
    this.status = Status.Closed;
  }`),
    });

    expect(terminals.get('closedAt')).toEqual([]);
  });
});

const rootWith = (members: string) => `
export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  constructor(props: P) {
    this.props = props;
  }
  ${members}
}
`;

describe('terminal suggestion for a timestamp on an aggregate whose own base class is named as an aggregate base', () => {
  it('is kept when a base helper copies a patch into this', () => {
    const terminals = suggestedTerminals({
      '/src/aggregate-root.ts': rootWith('protected update(patch: object): void { Object.assign(this, patch); }'),
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, 'stamp(): void { this.update({ closedAt: new Date() }); }'),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a base property initializer passes this to a function', () => {
    const terminals = suggestedTerminals({
      '/src/aggregate-root.ts': `declare function register(root: object): void;\n${rootWith('private registered = register(this);')}`,
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, ''),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when the base only stores its props', () => {
    const terminals = suggestedTerminals({
      '/src/aggregate-root.ts': rootWith(''),
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, ''),
    });

    expect(terminals.get('closedAt')).toEqual([]);
  });
});

describe('terminal suggestion for a timestamp on an aggregate whose base class uses this without letting it escape', () => {
  it('is dropped when a base method only compares this with another instance', () => {
    const terminals = suggestedTerminals({
      '/src/aggregate-root.ts': rootWith('equals(other: object): boolean { return this === other; }'),
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, ''),
    });

    expect(terminals.get('closedAt')).toEqual([]);
  });

  it('is kept when the base constructor passes this to a function', () => {
    const terminals = suggestedTerminals({
      '/src/aggregate-root.ts': `declare function register(root: object): void;
export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  constructor(props: P) {
    this.props = props;
    register(this);
  }
}
`,
      '/src/ticket.ts': ticketSource(PRIVATE_CLOSED_AT, ''),
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });
});

const PROTECTED_CLOSED_AT = 'protected closedAt: Date | null = null;';

describe('terminal suggestion for a timestamp on an aggregate extended by a class expression', () => {
  it('is kept when the class expression writes the timestamp', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PROTECTED_CLOSED_AT, ''),
      '/src/reopenable.ts': `
import { Ticket } from './ticket';
export const Reopenable = class extends Ticket { reopen(): void { this.closedAt = null; } };
`,
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when the class expression lets this escape', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PROTECTED_CLOSED_AT, ''),
      '/src/leaky.ts': `
import { Ticket } from './ticket';
declare function hook(ticket: object): void;
export const Leaky = class extends Ticket { constructor() { super({}); hook(this); } };
`,
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is kept when a class expression whose base cannot be resolved names the aggregate', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PROTECTED_CLOSED_AT, ''),
      '/src/mixin.ts': `
declare const tickets: { Ticket: new () => object };
export const Reopenable = class extends tickets.Ticket { reopen(): void { this.closedAt = null; } };
`,
    });

    expect(terminals.get('closedAt')).toEqual(['set']);
  });

  it('is dropped when a class expression extends an unrelated class', () => {
    const terminals = suggestedTerminals({
      '/src/ticket.ts': ticketSource(PROTECTED_CLOSED_AT, ''),
      '/src/other.ts': `
class Other { closedAt: Date | null = null; }
export const Reopenable = class extends Other { reopen(): void { this.closedAt = null; } };
`,
    });

    expect(terminals.get('closedAt')).toEqual([]);
  });
});
