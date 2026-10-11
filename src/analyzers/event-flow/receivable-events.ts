import { ClassDeclaration, ts } from 'ts-morph';
import { Comparable, hasLiteralType, strictlyComparable, widelyComparable } from './comparable-types';
import { BoundType } from './registrations/handler-bound';
import { hasNominalMember } from './registrations/nominal-members';
import { someReachable } from './reachable-types';
import { hasUnknownType } from './registrations/unknown-types';

type EventFacts = { readonly event: ClassDeclaration; readonly open: boolean; readonly literal: boolean };

export type ReceiversOf = (types: readonly BoundType[], checker: ts.TypeChecker) => readonly ClassDeclaration[];

const isGeneric = (event: ClassDeclaration): boolean => event.getTypeParameters().length > 0;

const isOpen = (event: ClassDeclaration): boolean => isGeneric(event) || hasNominalMember(event.getType(), event) || hasUnknownType(event.getType(), event);

const factsOf = (event: ClassDeclaration): EventFacts => ({ event, open: isOpen(event), literal: hasLiteralType(event.getType(), event) });

const comparableFor = (facts: EventFacts, { type, location }: BoundType): Comparable =>
  facts.literal || hasLiteralType(type, location) ? widelyComparable : strictlyComparable;

const receives =
  (checker: ts.TypeChecker, facts: EventFacts) =>
  (bound: BoundType): boolean => {
    const comparable = comparableFor(facts, bound);
    return someReachable(bound.type, bound.location, (reached) => comparable(checker, reached, facts.event.getType()));
  };

export const receivableEvents = (events: readonly ClassDeclaration[]): ReceiversOf => {
  const facts = events.map(factsOf);
  return (types, checker) => facts.filter((fact) => fact.open || types.some(receives(checker, fact))).map((fact) => fact.event);
};
