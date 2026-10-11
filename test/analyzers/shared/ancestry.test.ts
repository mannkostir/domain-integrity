import { describe, expect, it } from 'vitest';
import { ancestry } from '../../../src/analyzers/shared/ancestry';

const parentIn =
  (parents: Readonly<Record<string, string>>) =>
  (node: string): string | undefined =>
    parents[node];

describe('ancestry', () => {
  it('follows parents until a node has none', () => {
    const parentOf = parentIn({ child: 'middle', middle: 'root' });

    const result = ancestry('child', parentOf);

    expect(result).toEqual({ chain: ['child', 'middle', 'root'], cyclic: false });
  });

  it('holds only the start when it has no parent', () => {
    const parentOf = parentIn({});

    const result = ancestry('alone', parentOf);

    expect(result).toEqual({ chain: ['alone'], cyclic: false });
  });

  it('marks a node that is its own parent as cyclic', () => {
    const parentOf = parentIn({ loop: 'loop' });

    const result = ancestry('loop', parentOf);

    expect(result).toEqual({ chain: ['loop'], cyclic: true });
  });

  it('marks two nodes that are each other’s parent as cyclic', () => {
    const parentOf = parentIn({ first: 'second', second: 'first' });

    const result = ancestry('first', parentOf);

    expect(result).toEqual({ chain: ['first', 'second'], cyclic: true });
  });

  it('marks a chain that enters a cycle further up as cyclic', () => {
    const parentOf = parentIn({ leaf: 'upper', upper: 'top', top: 'upper' });

    const result = ancestry('leaf', parentOf);

    expect(result).toEqual({ chain: ['leaf', 'upper', 'top'], cyclic: true });
  });

  it('compares nodes by identity', () => {
    const top = { name: 'top' };
    const leaf = { name: 'leaf' };
    const parents = new Map([[leaf, top]]);

    const result = ancestry(leaf, (node) => parents.get(node));

    expect(result).toEqual({ chain: [leaf, top], cyclic: false });
  });
});
