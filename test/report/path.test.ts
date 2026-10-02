import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPosixRelative } from '../../src/report/path';

describe('toPosixRelative', () => {
  it('uses forward slashes for windows paths', () => {
    expect(toPosixRelative('C:\\app', 'C:\\app\\src\\order.ts', win32)).toBe('src/order.ts');
  });
});
