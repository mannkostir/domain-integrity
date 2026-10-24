import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shownPath, toPosixRelative } from '../../src/engine/path';

describe('toPosixRelative', () => {
  it('uses forward slashes for windows paths', () => {
    expect(toPosixRelative('C:\\app', 'C:\\app\\src\\order.ts', win32)).toBe('src/order.ts');
  });
});

describe('shownPath', () => {
  it('shows a path below the cwd relative to it', () => {
    expect(shownPath('/repo', '/repo/src/tsconfig.json')).toBe('src/tsconfig.json');
  });

  it('shows a path outside the cwd with parent segments', () => {
    expect(shownPath('/repo/app', '/repo/tsconfig.json')).toBe('../tsconfig.json');
  });

  it('shows the cwd itself as a dot', () => {
    expect(shownPath('/repo', '/repo')).toBe('.');
  });
});
