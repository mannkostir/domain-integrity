import { describe, expect, it } from 'vitest';
import { groupedBy } from '../../../src/analyzers/shared/grouping';

const lettersOf = (word: string): readonly string[] => [...new Set(word)];

describe('groupedBy', () => {
  it('groups each item under every key it has, keeping item order', () => {
    const groups = groupedBy(['ab', 'b', 'ba'], lettersOf);

    expect([...groups]).toEqual([
      ['a', ['ab', 'ba']],
      ['b', ['ab', 'b', 'ba']],
    ]);
  });

  it('leaves out items without keys', () => {
    const groups = groupedBy(['', 'a'], lettersOf);

    expect([...groups]).toEqual([['a', ['a']]]);
  });
});
