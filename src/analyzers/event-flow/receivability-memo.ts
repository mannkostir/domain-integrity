import { Type, TypeNode, ts } from 'ts-morph';
import { Comparable, isLiteralType } from './comparable-types';
import { ReachableTypes, anyReached, reachableTypes } from './reachable-types';
import { BoundType } from './registrations/handler-bound';

export type BoundReach = { readonly reachable: ReachableTypes; readonly literal: boolean };

const entryOf = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  const known = map.get(key);
  if (known !== undefined) return known;
  const created = create();
  map.set(key, created);
  return created;
};

const reachOfBound = ({ type, location }: BoundType): BoundReach => {
  const reachable = reachableTypes(type, location);
  return { reachable, literal: anyReached(reachable, isLiteralType) };
};

export class ReceivabilityMemo {
  private readonly reaches = new Map<TypeNode, Map<ts.Type, BoundReach>>();
  private readonly verdicts = new Map<Comparable, Map<ts.Type, Map<ts.Type, boolean>>>();

  reachOf(bound: BoundType): BoundReach {
    const atLocation = entryOf(this.reaches, bound.location, () => new Map<ts.Type, BoundReach>());
    return entryOf(atLocation, bound.type.compilerType, () => reachOfBound(bound));
  }

  isComparable(comparable: Comparable, checker: ts.TypeChecker, reached: Type, event: Type): boolean {
    const byReached = entryOf(this.verdicts, comparable, () => new Map<ts.Type, Map<ts.Type, boolean>>());
    const byEvent = entryOf(byReached, reached.compilerType, () => new Map<ts.Type, boolean>());
    return entryOf(byEvent, event.compilerType, () => comparable(checker, reached, event));
  }
}
