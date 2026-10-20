import { describe, expect, it } from 'vitest';
import { CheckScope } from '../../src/analyzer';
import { runScope } from '../../src/cli/session';

describe('runScope', () => {
  it.each<[readonly CheckScope[], CheckScope]>([
    [['nothing-found', 'checkable'], 'checkable'],
    [['nothing-declared', 'checkable'], 'checkable'],
    [['nothing-declared', 'nothing-found'], 'nothing-declared'],
    [['nothing-found', 'nothing-found'], 'nothing-found'],
  ])('classifies %j as %s', (scopes, expected) => {
    expect(runScope(scopes)).toBe(expected);
  });
});
