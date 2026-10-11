import { describe, expect, it } from 'vitest';
import { Type, TypeNode, ts } from 'ts-morph';
import { Comparable } from '../../../src/analyzers/event-flow/comparable-types';
import { anyReached, reachableTypes } from '../../../src/analyzers/event-flow/reachable-types';
import { ReceivabilityMemo } from '../../../src/analyzers/event-flow/receivability-memo';
import { inMemoryProject } from '../../helpers/in-memory';

const SOURCE = `
export type Kinded = { kind: 'tagged' };
export type Plain = { orderId: string };
export class Shipped { constructor(readonly orderId: string) {} }
export const kinded = (event: Kinded) => event;
export const plain = (event: Plain) => event;
`;

type Fixture = {
  readonly checker: ts.TypeChecker;
  readonly kinded: TypeNode;
  readonly plain: TypeNode;
  readonly shipped: Type;
};

const fixture = (): Fixture => {
  const file = inMemoryProject({ '/src/a.ts': SOURCE }).getSourceFileOrThrow('/src/a.ts');
  const annotation = (name: string): TypeNode => file.getVariableDeclarationOrThrow(name).getFirstDescendantByKindOrThrow(ts.SyntaxKind.Parameter).getTypeNodeOrThrow();
  return {
    checker: file.getProject().getTypeChecker().compilerObject,
    kinded: annotation('kinded'),
    plain: annotation('plain'),
    shipped: file.getClassOrThrow('Shipped').getType(),
  };
};

const boundOf = (location: TypeNode) => ({ type: location.getType(), location });

const countingComparable = (calls: { count: number }, verdict: boolean): Comparable => () => {
  calls.count += 1;
  return verdict;
};

describe('anyReached', () => {
  it('holds for overflowing reachable types whatever the predicate', () => {
    expect(anyReached({ kind: 'overflow' }, () => false)).toBe(true);
  });

  it('holds when a reached type satisfies the predicate', () => {
    const { plain } = fixture();

    expect(anyReached(reachableTypes(plain.getType(), plain), (type) => type.isString())).toBe(true);
  });

  it('fails when no reached type satisfies the predicate', () => {
    const { plain } = fixture();

    expect(anyReached(reachableTypes(plain.getType(), plain), (type) => type.isNumber())).toBe(false);
  });
});

describe('ReceivabilityMemo', () => {
  it('marks a bound that reaches a literal type as literal', () => {
    const { kinded } = fixture();

    expect(new ReceivabilityMemo().reachOf(boundOf(kinded)).literal).toBe(true);
  });

  it('marks a bound that reaches no literal type as not literal', () => {
    const { plain } = fixture();

    expect(new ReceivabilityMemo().reachOf(boundOf(plain)).literal).toBe(false);
  });

  it('gives the same reach for a bound asked twice', () => {
    const { plain } = fixture();
    const memo = new ReceivabilityMemo();

    const first = memo.reachOf(boundOf(plain));

    expect(memo.reachOf(boundOf(plain))).toBe(first);
  });

  it('answers the comparability of a reached type with an event once', () => {
    const { checker, plain, shipped } = fixture();
    const memo = new ReceivabilityMemo();
    const calls = { count: 0 };
    const comparable = countingComparable(calls, true);

    memo.isComparable(comparable, checker, plain.getType(), shipped);
    memo.isComparable(comparable, checker, plain.getType(), shipped);

    expect(calls.count).toBe(1);
  });

  it('returns the verdict of the comparable', () => {
    const { checker, plain, shipped } = fixture();

    expect(new ReceivabilityMemo().isComparable(countingComparable({ count: 0 }, false), checker, plain.getType(), shipped)).toBe(false);
  });

  it('keeps the verdicts of different comparables apart', () => {
    const { checker, plain, shipped } = fixture();
    const memo = new ReceivabilityMemo();

    memo.isComparable(countingComparable({ count: 0 }, true), checker, plain.getType(), shipped);

    expect(memo.isComparable(countingComparable({ count: 0 }, false), checker, plain.getType(), shipped)).toBe(false);
  });
});
