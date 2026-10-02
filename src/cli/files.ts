import { readFileSync, writeFileSync } from 'node:fs';
import { UsageError } from '../engine/errors';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const guardedRead = <T>(path: string, read: () => T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Cannot read ${path}: ${reasonOf(error)}`);
  }
};

export const readText = (path: string): string => guardedRead(path, () => readFileSync(path, 'utf8'));

export const writeText = (path: string, text: string): void => {
  try {
    writeFileSync(path, text);
  } catch (error) {
    throw new UsageError(`Cannot write ${path}: ${reasonOf(error)}`);
  }
};
