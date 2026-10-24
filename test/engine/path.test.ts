import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toNativePath, toPosixRelative, toTypeScriptPath } from '../../src/engine/path';

describe('toPosixRelative', () => {
  it('uses forward slashes for windows paths', () => {
    expect(toPosixRelative('C:\\app', 'C:\\app\\src\\order.ts', win32)).toBe('src/order.ts');
  });
});

describe('toNativePath', () => {
  it('uses backslashes for a forward-slashed windows path', () => {
    expect(toNativePath('C:/app/domain.config.ts', win32)).toBe('C:\\app\\domain.config.ts');
  });

  it('keeps a posix path as it is', () => {
    expect(toNativePath('/app/domain.config.ts', posix)).toBe('/app/domain.config.ts');
  });
});

describe('toTypeScriptPath', () => {
  it('uses forward slashes for a windows path', () => {
    expect(toTypeScriptPath('C:\\app\\tsconfig.json', win32)).toBe('C:/app/tsconfig.json');
  });

  it('keeps a backslash that is part of a posix file name', () => {
    expect(toTypeScriptPath('/app/odd\\name/tsconfig.json', posix)).toBe('/app/odd\\name/tsconfig.json');
  });
});
