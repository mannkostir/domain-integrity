import { describe, expect, it } from 'vitest';
import { Subclasses } from '../../../src/analyzers/lifecycle/subclasses';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const subclassesOf = (files: Readonly<Record<string, string>>, path: string, name: string): readonly (string | undefined)[] => {
  const project = inMemoryProject(files);
  const cls = project.getSourceFileOrThrow(path).getClassOrThrow(name);
  const subclasses = new Subclasses(new SourceIndex(Object.keys(files).map((file) => project.getSourceFileOrThrow(file))));
  return subclasses.of(cls).map((subclass) => subclass.getName());
};

describe('Subclasses', () => {
  it('lists direct and indirect subclasses in file and document order', () => {
    expect(
      subclassesOf(
        {
          '/src/a.ts': 'export class Root {}\nexport class Child extends Root {}',
          '/src/b.ts': "import { Child, Root } from './a';\nexport class Grandchild extends Child {}\nexport class Sibling extends Root {}",
        },
        '/src/a.ts',
        'Root',
      ),
    ).toEqual(['Child', 'Grandchild', 'Sibling']);
  });

  it('excludes the class itself and unrelated classes', () => {
    expect(subclassesOf({ '/src/a.ts': 'export class Root {}\nexport class Unrelated {}' }, '/src/a.ts', 'Root')).toEqual([]);
  });

  it('terminates on cyclic inheritance', () => {
    expect(subclassesOf({ '/src/a.ts': 'export class A extends B {}\nexport class B extends A {}' }, '/src/a.ts', 'A')).toEqual([]);
  });
});
