import { describe, expect, it } from 'vitest';
import { isTestFile } from '../../../src/analyzers/event-flow/test-files';
import { inMemoryProject } from '../../helpers/in-memory';

const PATHS = [
  '/app/src/order.ts',
  '/app/src/order.spec.ts',
  '/app/src/order.test.tsx',
  '/app/src/__tests__/order.ts',
  '/app/test/order.ts',
  '/app/tests/order.ts',
  '/app/src/contest/order.ts',
];

describe('isTestFile', () => {
  it('recognises spec and test names and test directories relative to the root', () => {
    const project = inMemoryProject(Object.fromEntries(PATHS.map((path) => [path, 'export {};'])));

    expect(PATHS.map((path) => isTestFile(project.getSourceFileOrThrow(path), '/app'))).toEqual([false, true, true, true, true, true, false]);
  });
});
