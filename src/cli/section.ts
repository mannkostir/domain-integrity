import { UsageError } from '../engine/errors';

const START = '<!-- domain-integrity:start -->';
const END = '<!-- domain-integrity:end -->';

export const replaceSection = (existing: string | undefined, content: string): string => {
  const block = `${START}\n${content.trimEnd()}\n${END}`;
  if (existing === undefined) return `${block}\n`;
  const start = existing.indexOf(START);
  if (start === -1) return `${existing.trimEnd()}\n\n${block}\n`;
  const end = existing.indexOf(END, start);
  if (end === -1) throw new UsageError('Found the domain-integrity start marker without an end marker; fix the file by hand.');
  return `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
};
