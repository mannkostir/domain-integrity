import { shownPath } from './path';

const REASON_BY_CODE: ReadonlyMap<unknown, string> = new Map([
  ['EISDIR', 'it is a directory'],
  ['EACCES', 'permission denied'],
  ['EPERM', 'permission denied'],
  ['ENOTDIR', 'a part of the path is not a directory'],
  ['ENOENT', 'it does not exist'],
]);

export const errorCodeOf = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const fileErrorReason = (cwd: string, path: string, error: unknown): string =>
  REASON_BY_CODE.get(errorCodeOf(error)) ?? messageOf(error).replaceAll(path, shownPath(cwd, path));
