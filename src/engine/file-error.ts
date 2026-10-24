import { shownPath } from './path';

const REASON_BY_CODE: ReadonlyMap<string, string> = new Map([
  ['EISDIR', 'it is a directory'],
  ['EACCES', 'permission denied'],
  ['EPERM', 'permission denied'],
  ['ENOTDIR', 'a part of the path is not a directory'],
  ['ENOENT', 'it does not exist'],
]);

export const errorCodeOf = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const reasonForCode = (code: string | undefined): string | undefined => (code === undefined ? undefined : REASON_BY_CODE.get(code));

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const fileErrorReason = (cwd: string, path: string, error: unknown): string =>
  reasonForCode(errorCodeOf(error)) ?? messageOf(error).replaceAll(path, shownPath(cwd, path));
