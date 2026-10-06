import { describe, expect, it } from 'vitest';
import { classIdentities } from '../../src/engine/class-identity';
import { inMemoryProject } from '../helpers/in-memory';

const classes = () => {
  const project = inMemoryProject({
    '/app/src/a/ticket.ts': 'export class Ticket {}',
    '/app/src/b/ticket.ts': 'export class Ticket {}',
    '/app/src/order.ts': 'export class Order {}',
  });
  return ['/app/src/a/ticket.ts', '/app/src/b/ticket.ts', '/app/src/order.ts'].map(
    (path) => project.getSourceFileOrThrow(path).getClasses()[0]!,
  );
};

describe('classIdentities', () => {
  it('names a unique class by its name and a shared name by its file', () => {
    const identities = classIdentities(classes(), '/app');

    expect([...identities.values()]).toEqual([
      { id: 'src/a/ticket.ts:Ticket', name: 'Ticket', qualifiedName: 'src/a/ticket.ts:Ticket' },
      { id: 'src/b/ticket.ts:Ticket', name: 'Ticket', qualifiedName: 'src/b/ticket.ts:Ticket' },
      { id: 'Order', name: 'Order', qualifiedName: 'src/order.ts:Order' },
    ]);
  });
});
