import { describe, expect, it } from 'vitest';
import { errorCodeOf, fileErrorReason } from '../../src/engine/file-error';

const systemError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

describe('fileErrorReason', () => {
  it('says a directory is a directory', () => {
    const error = systemError('EISDIR', "EISDIR: illegal operation on a directory, open '/repo/docs'");

    expect(fileErrorReason('/repo', '/repo/docs', error)).toBe('it is a directory');
  });

  it('says access was denied', () => {
    const error = systemError('EACCES', "EACCES: permission denied, open '/repo/AGENTS.md'");

    expect(fileErrorReason('/repo', '/repo/AGENTS.md', error)).toBe('permission denied');
  });

  it('says an operation that was not permitted was denied', () => {
    const error = systemError('EPERM', "EPERM: operation not permitted, open '/repo/AGENTS.md'");

    expect(fileErrorReason('/repo', '/repo/AGENTS.md', error)).toBe('permission denied');
  });

  it('says a part of the path is not a directory', () => {
    const error = systemError('ENOTDIR', "ENOTDIR: not a directory, open '/repo/notes.txt/AGENTS.md'");

    expect(fileErrorReason('/repo', '/repo/notes.txt/AGENTS.md', error)).toBe('a part of the path is not a directory');
  });

  it('says a missing file does not exist', () => {
    const error = systemError('ENOENT', "ENOENT: no such file or directory, open '/repo/AGENTS.md'");

    expect(fileErrorReason('/repo', '/repo/AGENTS.md', error)).toBe('it does not exist');
  });

  it('shows every mention of the path in any other error relative to the cwd', () => {
    const error = systemError('EBUSY', "EBUSY: resource busy or locked, open '/repo/docs/AGENTS.md' while '/repo/docs/AGENTS.md' was locked");

    expect(fileErrorReason('/repo', '/repo/docs/AGENTS.md', error)).toBe("EBUSY: resource busy or locked, open 'docs/AGENTS.md' while 'docs/AGENTS.md' was locked");
  });

  it('shows the path in an error without a code relative to the cwd', () => {
    expect(fileErrorReason('/repo', '/repo/AGENTS.md', new Error('cannot handle /repo/AGENTS.md'))).toBe('cannot handle AGENTS.md');
  });

  it('shows the path in a thrown non-error value relative to the cwd', () => {
    expect(fileErrorReason('/repo', '/repo/AGENTS.md', 'cannot handle /repo/AGENTS.md')).toBe('cannot handle AGENTS.md');
  });
});

describe('errorCodeOf', () => {
  it('reads the code of a system error', () => {
    expect(errorCodeOf(systemError('EISDIR', 'EISDIR'))).toBe('EISDIR');
  });

  it('reads no code from an error whose code is not a string', () => {
    expect(errorCodeOf(Object.assign(new Error('busy'), { code: 16 }))).toBeUndefined();
  });
});
