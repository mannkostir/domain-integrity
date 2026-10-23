import { BinaryExpression, Node } from 'ts-morph';
import { isEventBufferAccess, isEventBufferReset } from './event-buffer';
import { fieldNameOf } from './field-ref';
import { outermostWrapper, unwrap } from '../shared/wrappers';

export type Bookkeeping = {
  readonly auditFields: ReadonlySet<string>;
  readonly eventBuffers: ReadonlySet<Node>;
};

export const NO_BOOKKEEPING: Bookkeeping = { auditFields: new Set(), eventBuffers: new Set() };

export const isAuditWrite = (target: Node, bookkeeping: Bookkeeping): boolean => {
  const name = fieldNameOf(unwrap(target));
  return name !== undefined && bookkeeping.auditFields.has(name);
};

const isBufferReset = (access: Node, bookkeeping: Bookkeeping): boolean =>
  isEventBufferAccess(access, bookkeeping.eventBuffers) && isEventBufferReset(outermostWrapper(access));

const lengthReceiver = (target: Node): Node =>
  Node.isPropertyAccessExpression(target) && target.getName() === 'length' ? unwrap(target.getExpression()) : target;

export const isBookkeepingAssignment = (assignment: BinaryExpression, bookkeeping: Bookkeeping): boolean => {
  const target = unwrap(assignment.getLeft());
  return isAuditWrite(target, bookkeeping) || isBufferReset(lengthReceiver(target), bookkeeping);
};

export const isBookkeepingCollectionCall = (receiver: Node, bookkeeping: Bookkeeping): boolean =>
  isBufferReset(unwrap(receiver), bookkeeping);
