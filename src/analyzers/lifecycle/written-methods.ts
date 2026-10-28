import { ClassDeclaration, Node, Type } from 'ts-morph';
import { MemberAccess, NameUses } from '../shared/name-uses';
import { inheritanceChain } from './field-ref';

export type WrittenMethods = { readonly isWritten: (name: string) => boolean };

type Aggregate = { readonly instance: Type; readonly family: ReadonlySet<Node> };

const MAX_CONSTRAINT_DEPTH = 5;

const hasIndexSignature = (type: Type): boolean =>
  type.getStringIndexType() !== undefined || type.getNumberIndexType() !== undefined;

const classChainOf = (declaration: Node): readonly Node[] => {
  if (Node.isClassDeclaration(declaration)) return inheritanceChain(declaration);
  const base = Node.isClassExpression(declaration) ? declaration.getBaseClass() : undefined;
  return base === undefined ? [] : inheritanceChain(base);
};

const isFamilyOrSubclass = (type: Type, aggregate: Aggregate): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some((declaration) =>
    classChainOf(declaration).some((candidate) => aggregate.family.has(candidate)),
  );

const mayHoldAggregate = (type: Type, aggregate: Aggregate, depth = 0): boolean => {
  if (type.isAny() || type.isUnknown() || depth > MAX_CONSTRAINT_DEPTH) return true;
  if (type.isTypeParameter()) {
    const bound = type.getConstraint() ?? type.getApparentType();
    return bound === type || mayHoldAggregate(bound, aggregate, depth + 1);
  }
  if (type.isUnion()) return type.getUnionTypes().some((member) => mayHoldAggregate(member, aggregate, depth + 1));
  if (type.isIntersection()) return type.getIntersectionTypes().some((member) => mayHoldAggregate(member, aggregate, depth + 1));
  return hasIndexSignature(type) || isFamilyOrSubclass(type, aggregate) || aggregate.instance.isAssignableTo(type);
};

const writesOnAggregate =
  (aggregate: Aggregate) =>
  (access: MemberAccess): boolean =>
    mayHoldAggregate(access.getExpression().getType(), aggregate);

export const writtenMethods = (cls: ClassDeclaration, family: readonly ClassDeclaration[], uses: NameUses): WrittenMethods => {
  const aggregate: Aggregate = { instance: cls.getType(), family: new Set<Node>(family) };
  const known = new Map<string, boolean>();
  return {
    isWritten: (name) => {
      const cached = known.get(name);
      if (cached !== undefined) return cached;
      const written = uses.writtenAccessesNamed(name).some(writesOnAggregate(aggregate));
      known.set(name, written);
      return written;
    },
  };
};
