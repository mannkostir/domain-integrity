import { describe, expect, it } from 'vitest';
import { EnumReferences } from '../../../src/analyzers/lifecycle/enum-references';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const ENUM_SOURCE = "export enum Status { open = 'OPEN', closed = 'CLOSED' }\nexport enum Other { open = 'OPEN' }";

const referencesIn = (usage: Readonly<Record<string, string>>): readonly string[] => {
  const files = { '/src/status.ts': ENUM_SOURCE, ...usage };
  const project = inMemoryProject(files);
  const status = project.getSourceFileOrThrow('/src/status.ts').getEnumOrThrow('Status');
  const references = new EnumReferences(new SourceIndex(Object.keys(files).map((path) => project.getSourceFileOrThrow(path))));
  return references.to(status).map((identifier) => `${identifier.getSourceFile().getBaseName()}:${identifier.getText()}`);
};

const mergedReferenceCounts = (): readonly number[] => {
  const files = {
    '/src/status.ts': "export enum Status { open = 'OPEN' }\nexport enum Status { closed = 'CLOSED' }",
    '/src/a.ts': "import { Status } from './status';\nexport const a = Status.closed;",
  };
  const project = inMemoryProject(files);
  const references = new EnumReferences(new SourceIndex(Object.keys(files).map((path) => project.getSourceFileOrThrow(path))));
  return project
    .getSourceFileOrThrow('/src/status.ts')
    .getEnums()
    .map((declaration) => references.to(declaration).length);
};

describe('EnumReferences', () => {
  it('lists the identifiers that refer to the enum in file and document order', () => {
    expect(
      referencesIn({
        '/src/a.ts': "import { Status } from './status';\nexport const a = Status.open;\nexport const b = Status.closed;",
        '/src/b.ts': "import { Status } from './status';\nexport const c = Status.open;",
      }),
    ).toEqual(['a.ts:Status', 'a.ts:Status', 'b.ts:Status']);
  });

  it('follows an aliased import', () => {
    expect(referencesIn({ '/src/a.ts': "import { Status as S } from './status';\nexport const a = S.open;" })).toEqual(['a.ts:S']);
  });

  it('follows a re-exported alias', () => {
    expect(
      referencesIn({
        '/src/barrel.ts': "export { Status as Lifecycle } from './status';",
        '/src/a.ts': "import { Lifecycle } from './barrel';\nexport const a = Lifecycle.closed;",
      }),
    ).toEqual(['a.ts:Lifecycle']);
  });

  it('follows a namespace import', () => {
    expect(referencesIn({ '/src/a.ts': "import * as states from './status';\nexport const a = states.Status.open;" })).toEqual([
      'a.ts:Status',
    ]);
  });

  it('ignores import and export bindings and the enum name itself', () => {
    expect(referencesIn({ '/src/a.ts': "import { Status } from './status';\nexport { Status };" })).toEqual([]);
  });

  it('ignores references to another enum', () => {
    expect(referencesIn({ '/src/a.ts': "import { Other } from './status';\nexport const a = Other.open;" })).toEqual([]);
  });

  it('finds a reference under every declaration of a merged enum', () => {
    expect(mergedReferenceCounts()).toEqual([1, 1]);
  });
});
