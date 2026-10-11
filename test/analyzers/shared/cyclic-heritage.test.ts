import { describe, expect, it } from 'vitest';
import { hasCyclicInheritance } from '../../../src/analyzers/shared/cyclic-heritage';
import { inMemoryProject } from '../../helpers/in-memory';

const cyclic = (files: Readonly<Record<string, string>>, path: string, name: string): boolean =>
  hasCyclicInheritance(inMemoryProject(files).getSourceFileOrThrow(path).getClassOrThrow(name));

describe('hasCyclicInheritance', () => {
  it('detects a loop through plain identifiers', () => {
    const result = cyclic({ '/src/loop.ts': 'export class Upper extends Lower {}\nexport class Lower extends Upper {}' }, '/src/loop.ts', 'Lower');

    expect(result).toBe(true);
  });

  it('detects a loop through namespace imports', () => {
    const result = cyclic(
      {
        '/src/a.ts': "import * as b from './b';\nexport class Upper extends b.Lower {}",
        '/src/b.ts': "import * as a from './a';\nexport class Lower extends a.Upper {}",
      },
      '/src/b.ts',
      'Lower',
    );

    expect(result).toBe(true);
  });

  it('detects a loop through a variable alias', () => {
    const result = cyclic({ '/src/loop.ts': 'const L = Low;\nclass Up extends L {}\nexport class Low extends Up {}' }, '/src/loop.ts', 'Low');

    expect(result).toBe(true);
  });

  it('does not mark a hierarchy reached through a namespace import as cyclic', () => {
    const result = cyclic(
      { '/src/base.ts': 'export class Base {}', '/src/leaf.ts': "import * as m from './base';\nexport class Leaf extends m.Base {}" },
      '/src/leaf.ts',
      'Leaf',
    );

    expect(result).toBe(false);
  });

  it('does not mark a hierarchy reached through a variable alias as cyclic', () => {
    const result = cyclic({ '/src/leaf.ts': 'class Ok {}\nconst K = Ok;\nexport class Leaf extends K {}' }, '/src/leaf.ts', 'Leaf');

    expect(result).toBe(false);
  });

  it('stops at variable aliases that refer to each other', () => {
    const result = cyclic({ '/src/leaf.ts': 'const A = B;\nconst B = A;\nexport class Leaf extends A {}' }, '/src/leaf.ts', 'Leaf');

    expect(result).toBe(false);
  });
});
