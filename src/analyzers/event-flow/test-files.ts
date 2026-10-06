import { SourceFile } from 'ts-morph';
import { toPosixRelative } from '../../engine/path';

const TEST_NAME = /\.(spec|test)\.[cm]?[jt]sx?$/;
const TEST_SEGMENTS: ReadonlySet<string> = new Set(['__tests__', 'test', 'tests']);

export const isTestFile = (file: SourceFile, root: string): boolean => {
  const relative = toPosixRelative(root, file.getFilePath());
  return TEST_NAME.test(relative) || relative.split('/').slice(0, -1).some((segment) => TEST_SEGMENTS.has(segment));
};
