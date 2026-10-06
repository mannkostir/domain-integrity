import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { readText, writeText } from './files';
import { Io, Paths } from './io';
import { replaceSection } from './section';
import { openSession } from './session';

export const contextCommand = (paths: Paths, write: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const summary = results.map((result) => result.summary(paths.root)).filter((text) => text.length > 0).join('\n');
  if (write === undefined) {
    io.out(summary);
    return 0;
  }
  const target = resolve(io.cwd, write);
  const existing = existsSync(target) ? readText(target) : undefined;
  writeText(target, replaceSection(existing, summary));
  io.out(`Updated ${relative(io.cwd, target)}.\n`);
  return 0;
};
