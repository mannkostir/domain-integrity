import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { replaceSection } from '../../src/cli/section';

const START = '<!-- domain-integrity:start -->';
const END = '<!-- domain-integrity:end -->';

describe('replaceSection', () => {
  it('creates the block when the file does not exist', () => {
    expect(replaceSection(undefined, 'body\n')).toBe(`${START}\nbody\n${END}\n`);
  });

  it('appends the block to a file without markers', () => {
    expect(replaceSection('# Agents\n', 'body')).toBe(`# Agents\n\n${START}\nbody\n${END}\n`);
  });

  it('replaces only the content between existing markers', () => {
    expect(replaceSection(`before\n${START}\nold\n${END}\nafter\n`, 'new')).toBe(`before\n${START}\nnew\n${END}\nafter\n`);
  });

  it('rejects a start marker without an end marker', () => {
    expect(() => replaceSection(`${START}\nold\n`, 'new')).toThrow(UsageError);
  });

  it('ignores an end marker that precedes the start marker', () => {
    expect(() => replaceSection(`${END}\n${START}\nold\n`, 'new')).toThrow(UsageError);
  });
});
