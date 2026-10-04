import { describe, expect, it } from 'vitest';
import { outsideAssignments } from '../../../src/analyzers/lifecycle/outside';
import { describeAssigned, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/invitation.ts': `
import { AggregateRoot } from './aggregate-root';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected';
export class Invitation extends AggregateRoot<{ note: string }> {
  status: InvitationStatus = 'pending';
  accept(): void { this.status = 'accepted'; }
}
`,
  '/src/with-status.ts': `
import { Invitation, InvitationStatus } from './invitation';
export class WithStatus {
  constructor(private readonly status: InvitationStatus) {}
  mutate(target: Invitation): void { target.status = this.status; }
}
`,
  '/src/service.ts': `
import { Invitation } from './invitation';
export const acceptLater = (invitation: Invitation | undefined): void => { if (invitation) invitation.status = 'accepted'; };
export const unrelated = (other: { status: string }): void => { other.status = 'x'; };
`,
});

const invitation = project.getSourceFileOrThrow('/src/invitation.ts').getClassOrThrow('Invitation');

describe('outsideAssignments', () => {
  it('finds typed assignments to the field outside the aggregate class', () => {
    const found = outsideAssignments(project.getSourceFiles(), invitation, resolvedField(invitation, 'status'));

    expect(found.map((assignment) => ({ ...assignment, value: describeAssigned(assignment.value) }))).toEqual([
      { field: 'status', file: '/src/service.ts', line: 3, scope: 'acceptLater', value: { tokens: ['accepted'], unresolved: false, mayWrite: false }, throughOwnSetter: false },
      { field: 'status', file: '/src/with-status.ts', line: 5, scope: 'WithStatus.mutate', value: { tokens: [], unresolved: true, mayWrite: false }, throughOwnSetter: false },
    ]);
  });
});

const wrappedProject = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/invitation.ts': `
import { AggregateRoot } from './aggregate-root';
export class Invitation extends AggregateRoot<{ note: string }> {
  status: 'pending' | 'accepted' = 'pending';
}
`,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export class Ticket extends AggregateRoot<{ status: 'open' | 'closed' }> {}
`,
  '/src/casts.ts': `
import { Invitation } from './invitation';
export const cast = (value: unknown): void => { (value as Invitation).status = 'accepted'; };
export const bang = (invitation: Invitation | undefined): void => { invitation!.status = 'accepted'; };
`,
  '/src/assigns.ts': `
import { Invitation } from './invitation';
import { Ticket } from './ticket';
export const direct = (invitation: Invitation): void => { Object.assign(invitation, { status: 'accepted' }); };
export const viaProps = (ticket: Ticket): void => { Object.assign((ticket as any).props, { status: 'closed' }); };
export const indexed = (invitation: Invitation, patch: Record<string, string>): void => { Object.assign(invitation, patch); };
export const unionSource = (invitation: Invitation, patch: { status: string } | { other: number }): void => { Object.assign(invitation, patch); };
export const missingField = (invitation: Invitation): void => { Object.assign(invitation, { note: 'x' }); };
`,
});

const wrappedInvitation = wrappedProject.getSourceFileOrThrow('/src/invitation.ts').getClassOrThrow('Invitation');
const ticket = wrappedProject.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');

describe('outsideAssignments through wrappers and Object.assign', () => {
  const statusAssignments = outsideAssignments(
    wrappedProject.getSourceFiles(),
    wrappedInvitation,
    resolvedField(wrappedInvitation, 'status'),
  );

  it('sees through casts and non-null assertions on the receiver', () => {
    expect(statusAssignments.filter((assignment) => assignment.file === '/src/casts.ts').map((a) => a.scope)).toEqual([
      'cast',
      'bang',
    ]);
  });

  it('records Object.assign onto the aggregate when a source carries the field', () => {
    expect(statusAssignments.filter((assignment) => assignment.file === '/src/assigns.ts').map((a) => a.scope)).toEqual([
      'direct',
      'indexed',
      'unionSource',
    ]);
  });

  it('records Object.assign values as unresolved', () => {
    const direct = statusAssignments.find((assignment) => assignment.scope === 'direct');

    expect(describeAssigned(direct!.value)).toEqual({ tokens: [], unresolved: true, mayWrite: false });
  });

  it('records Object.assign onto the props of the aggregate', () => {
    const found = outsideAssignments(wrappedProject.getSourceFiles(), ticket, resolvedField(ticket, 'status'));

    expect(found.map((assignment) => assignment.scope)).toEqual(['viaProps']);
  });

  it('ignores Object.assign whose sources lack the field', () => {
    expect(statusAssignments.map((assignment) => assignment.scope)).not.toContain('missingField');
  });
});

const setterProject = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export type OrderStatus = 'open' | 'paid' | 'closed';
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  get status(): OrderStatus { return this.props.status; }
  set status(value: OrderStatus) {
    if (this.props.status === 'closed') throw new Error('closed');
    this.props.status = value;
  }
}
`,
  '/src/status-base.ts': `
import { AggregateRoot } from './aggregate-root';
export type ShipmentStatus = 'packed' | 'sent';
export abstract class StatusBase extends AggregateRoot<{ status: ShipmentStatus }> {
  get status(): ShipmentStatus { return this.props.status; }
  set status(value: ShipmentStatus) { this.props.status = value; }
}
`,
  '/src/shipment.ts': `
import { StatusBase } from './status-base';
export class Shipment extends StatusBase {}
`,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export class Ticket extends AggregateRoot<{ status: 'open' | 'closed' }> {
  get status(): 'open' | 'closed' { return this.props.status; }
}
`,
  '/lib/library-base.d.ts': `
export declare abstract class LibraryBase {
  protected props: { status: 'draft' | 'live' };
  get status(): 'draft' | 'live';
  set status(value: 'draft' | 'live');
}
`,
  '/src/page.ts': `
import { LibraryBase } from '../lib/library-base';
export class Page extends LibraryBase {}
`,
  '/src/orders.ts': `
import { Order } from './order';
export const pay = (order: Order): void => { order.status = 'paid'; };
export const reopen = (order: Order): void => { order.status ??= 'open'; };
export const patch = (order: Order): void => { Object.assign(order, { status: 'closed' }); };
export const rawProps = (order: Order): void => { (order as any).props.status = 'closed'; };
export const patchProps = (order: Order): void => { Object.assign((order as any).props, { status: 'closed' }); };
`,
  '/src/shipments.ts': `
import { Shipment } from './shipment';
export const send = (shipment: Shipment): void => { shipment.status = 'sent'; };
export const patch = (shipment: Shipment): void => { Object.assign(shipment, { status: 'sent' }); };
`,
  '/src/tickets.ts': `
import { Ticket } from './ticket';
export const close = (ticket: Ticket): void => { Object.assign(ticket, { status: 'closed' }); };
`,
  '/src/pages.ts': `
import { Page } from './page';
export const publish = (page: Page): void => { page.status = 'live'; };
export const patch = (page: Page): void => { Object.assign(page, { status: 'live' }); };
`,
});

const setterAssignments = (file: string, name: string) => {
  const cls = setterProject.getSourceFileOrThrow(file).getClassOrThrow(name);
  return outsideAssignments(setterProject.getSourceFiles(), cls, resolvedField(cls, 'status')).map((assignment) => ({
    scope: assignment.scope,
    throughOwnSetter: assignment.throughOwnSetter,
  }));
};

describe('outsideAssignments through the aggregate setter', () => {
  it('marks direct, compound and Object.assign writes through the aggregate setter, but not writes onto props', () => {
    expect(setterAssignments('/src/order.ts', 'Order')).toEqual([
      { scope: 'pay', throughOwnSetter: true },
      { scope: 'reopen', throughOwnSetter: true },
      { scope: 'patch', throughOwnSetter: true },
      { scope: 'rawProps', throughOwnSetter: false },
      { scope: 'patchProps', throughOwnSetter: false },
    ]);
  });

  it('marks writes through a setter inherited from a project base class', () => {
    expect(setterAssignments('/src/shipment.ts', 'Shipment')).toEqual([
      { scope: 'send', throughOwnSetter: true },
      { scope: 'patch', throughOwnSetter: true },
    ]);
  });

  it('does not mark writes onto an aggregate without a setter', () => {
    expect(setterAssignments('/src/ticket.ts', 'Ticket')).toEqual([{ scope: 'close', throughOwnSetter: false }]);
  });

  it('does not mark writes through a setter declared in library code', () => {
    expect(setterAssignments('/src/page.ts', 'Page')).toEqual([
      { scope: 'publish', throughOwnSetter: false },
      { scope: 'patch', throughOwnSetter: false },
    ]);
  });
});
