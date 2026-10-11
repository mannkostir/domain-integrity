import { describe, expect, it } from 'vitest';
import { BracketWrites } from '../../../src/analyzers/shared/writes';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const writesOf = (files: Readonly<Record<string, string>>): BracketWrites => {
  const project = inMemoryProject(files);
  return new BracketWrites(new SourceIndex(Object.keys(files).map((path) => project.getSourceFileOrThrow(path))));
};

const textsOf = (nodes: readonly { getText(): string }[]): readonly string[] => nodes.map((node) => node.getText());

describe('BracketWrites', () => {
  it('finds bracket writes of a name across files', () => {
    const writes = writesOf({
      '/src/a.ts': "declare const o: Record<string, number>;\no['events'] = 1;\no['other'] = 2;",
      '/src/b.ts': 'declare const p: Record<string, number>;\ndelete p[`events`];',
    });

    expect(textsOf(writes.of('events'))).toEqual(["o['events']", 'p[`events`]']);
  });

  it('ignores bracket reads of the name', () => {
    const writes = writesOf({ '/src/a.ts': "declare const o: Record<string, number>;\nexport const value = o['events'];" });

    expect(writes.of('events')).toEqual([]);
  });

  it('follows keys whose type is the name', () => {
    const writes = writesOf({
      '/src/a.ts': "declare const o: Record<string, number>;\ndeclare const key: 'events' | 'other';\no[key] = 1;",
    });

    expect(textsOf(writes.of('events'))).toEqual(['o[key]']);
  });

  it('returns the same writes when asked for a name again', () => {
    const writes = writesOf({ '/src/a.ts': "declare const o: Record<string, number>;\no['events'] = 1;" });

    const first = writes.of('events');

    expect(writes.of('events')).toBe(first);
  });
});
