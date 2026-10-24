import path from 'node:path';

export const toPosixRelative = (root: string, file: string, pathApi: typeof path = path): string =>
  pathApi.relative(root, file).split(pathApi.sep).join('/');

export const shownPath = (cwd: string, path: string): string => toPosixRelative(cwd, path) || '.';

export const toNativePath = (file: string, pathApi: typeof path = path): string => pathApi.normalize(file);

export const toTypeScriptPath = (file: string, pathApi: typeof path = path): string => file.split(pathApi.sep).join('/');
