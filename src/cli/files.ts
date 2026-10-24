import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { UsageError } from '../engine/errors';
import { shownPath } from '../engine/path';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isNotFound = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const guardedRead = <T>(cwd: string, path: string, read: () => T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Cannot read ${shownPath(cwd, path)}: ${reasonOf(error)}`);
  }
};

export const readText = (cwd: string, path: string): string => guardedRead(cwd, path, () => readFileSync(path, 'utf8'));

const writeFailure = (cwd: string, path: string, error: unknown): UsageError => {
  const directory = dirname(path);
  const reason =
    isNotFound(error) && !existsSync(directory)
      ? `the directory ${shownPath(cwd, directory)} does not exist. Create it first.`
      : reasonOf(error);
  return new UsageError(`Cannot write ${shownPath(cwd, path)}: ${reason}`);
};

export const writeText = (cwd: string, path: string, text: string): void => {
  try {
    writeFileSync(path, text);
  } catch (error) {
    throw writeFailure(cwd, path, error);
  }
};
