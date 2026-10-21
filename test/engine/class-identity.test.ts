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
  it('qualifies a class whose name is unique', () => {
    const [order] = classes().slice(2);

    expect(classIdentities([order!], '/app').get(order!)?.id).toBe('src/order.ts:Order');
  });

  it('qualifies each of two classes that share a name', () => {
    const identities = classIdentities(classes(), '/app');

    expect([...identities.values()].map((identity) => identity.id)).toEqual([
      'src/a/ticket.ts:Ticket',
      'src/b/ticket.ts:Ticket',
      'src/order.ts:Order',
    ]);
  });

  it('uses the qualified name as the id and keeps the plain name', () => {
    const identities = classIdentities(classes(), '/app');

    expect([...identities.values()].map(({ id, name, qualifiedName }) => [id === qualifiedName, name])).toEqual([
      [true, 'Ticket'],
      [true, 'Ticket'],
      [true, 'Order'],
    ]);
  });
});
