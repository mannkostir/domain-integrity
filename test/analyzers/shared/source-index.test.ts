import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const indexOf = (files: Readonly<Record<string, string>>): SourceIndex => {
  const project = inMemoryProject(files);
  return new SourceIndex(Object.keys(files).map((path) => project.getSourceFileOrThrow(path)));
};

const textsOf = (nodes: readonly { getText(): string }[]): readonly string[] => nodes.map((node) => node.getText());

describe('SourceIndex', () => {
  it('lists the nodes of a kind across the files in file and document order', () => {
    const index = indexOf({ '/src/a.ts': 'class A {}\nclass B {}', '/src/b.ts': 'class C {}' });

    const classes = index.ofKind(SyntaxKind.ClassDeclaration);

    expect(classes.map((cls) => cls.getName())).toEqual(['A', 'B', 'C']);
  });

  it('returns the same nodes when asked for a kind again', () => {
    const index = indexOf({ '/src/a.ts': 'const a = 1;' });

    const first = index.ofKind(SyntaxKind.VariableDeclaration);

    expect(index.ofKind(SyntaxKind.VariableDeclaration)).toBe(first);
  });

  it('ignores files it was not built over', () => {
    const project = inMemoryProject({ '/src/a.ts': 'class A {}', '/src/b.ts': 'class B {}' });
    const index = new SourceIndex([project.getSourceFileOrThrow('/src/b.ts')]);

    const classes = index.ofKind(SyntaxKind.ClassDeclaration);

    expect(classes.map((cls) => cls.getName())).toEqual(['B']);
  });

  it('finds string and template literals by their text', () => {
    const index = indexOf({ '/src/a.ts': "const a = 'Paid';\nconst b = `Paid`;\nconst c = 'Failed';\nconst d = `Paid${a}`;" });

    const literals = index.literalsWithText('Paid');

    expect(textsOf(literals)).toEqual(["'Paid'", '`Paid`']);
  });

  it('finds string, numeric and template literals by their value', () => {
    const index = indexOf({ '/src/a.ts': "const a = '1';\nconst b = 1;\nconst c = `1`;\nconst d = 2;" });

    const literals = index.literalsWithValue('1');

    expect(textsOf(literals)).toEqual(["'1'", '1', '`1`']);
  });

  it('finds property accesses by the accessed name', () => {
    const index = indexOf({ '/src/a.ts': 'declare const o: { status: number; other: number };\no.status = o.other;', '/src/b.ts': 'declare const p: { status: number };\np.status;' });

    const accesses = index.propertyAccessesNamed('status');

    expect(textsOf(accesses)).toEqual(['o.status', 'p.status']);
  });

  it('finds nothing for a name that is never used', () => {
    const index = indexOf({ '/src/a.ts': "const a = 'x';" });

    const literals = index.literalsWithText('y');

    expect(literals).toEqual([]);
  });
});
