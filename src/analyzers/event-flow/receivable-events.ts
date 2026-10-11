import { ClassDeclaration, Type, ts } from 'ts-morph';
import { Comparable, hasLiteralType, strictlyComparable, widelyComparable } from './comparable-types';
import { BoundType } from './registrations/handler-bound';
import { hasNominalMember } from './registrations/nominal-members';
import { anyReached } from './reachable-types';
import { BoundReach, ReceivabilityMemo } from './receivability-memo';
import { hasUnknownType } from './registrations/unknown-types';

type EventFacts = { readonly event: ClassDeclaration; readonly type: Type; readonly open: boolean; readonly literal: boolean };

export type ReceiversOf = (types: readonly BoundType[], checker: ts.TypeChecker) => readonly ClassDeclaration[];

const isGeneric = (event: ClassDeclaration): boolean => event.getTypeParameters().length > 0;

const isOpen = (event: ClassDeclaration): boolean => isGeneric(event) || hasNominalMember(event.getType(), event) || hasUnknownType(event.getType(), event);

const factsOf = (event: ClassDeclaration): EventFacts => ({
  event,
  type: event.getType(),
  open: isOpen(event),
  literal: hasLiteralType(event.getType(), event),
});

const comparableFor = (facts: EventFacts, reach: BoundReach): Comparable => (facts.literal || reach.literal ? widelyComparable : strictlyComparable);

const receives =
  (checker: ts.TypeChecker, facts: EventFacts, memo: ReceivabilityMemo) =>
  (bound: BoundType): boolean => {
    const reach = memo.reachOf(bound);
    const comparable = comparableFor(facts, reach);
    return anyReached(reach.reachable, (reached) => memo.isComparable(comparable, checker, reached, facts.type));
  };

export const receivableEvents = (events: readonly ClassDeclaration[]): ReceiversOf => {
  const facts = events.map(factsOf);
  const memo = new ReceivabilityMemo();
  return (types, checker) => facts.filter((fact) => fact.open || types.some(receives(checker, fact, memo))).map((fact) => fact.event);
};
