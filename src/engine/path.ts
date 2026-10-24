import path from 'node:path';

export const toPosixRelative = (root: string, file: string, pathApi: typeof path = path): string =>
  pathApi.relative(root, file).split(pathApi.sep).join('/');

export const toNativePath = (file: string, pathApi: typeof path = path): string => pathApi.normalize(file);
