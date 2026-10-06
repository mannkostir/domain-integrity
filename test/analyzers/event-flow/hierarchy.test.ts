import { describe, expect, it } from 'vitest';
import { hierarchyOf } from '../../../src/analyzers/event-flow/hierarchy';
import { inMemoryProject } from '../../helpers/in-memory';

const of = (name: string) => {
  const project = inMemoryProject({
    '/types/lib.d.ts': 'export declare class LibrarySaga {}',
    '/src/classes.ts': "import { LibrarySaga } from '../types/lib';\ndeclare const Unknown: new () => object;\ndeclare const Mixin: <T>(base: T) => T;\nexport class Base {}\nexport class Middle extends Base {}\nexport class Leaf extends Middle {}\nexport class OnLibrary extends LibrarySaga {}\nexport class OnUnknown extends Unknown {}\nexport class Mixed extends Mixin(Base) {}\nexport class AboveMixed extends Mixed {}",
  });
  const hierarchy = hierarchyOf(project.getSourceFileOrThrow('/src/classes.ts').getClassOrThrow(name), (cls) => !cls.getSourceFile().isDeclarationFile());
  return { ancestors: hierarchy.ancestors.map((cls) => cls.getName()), extendsForeign: hierarchy.extendsForeign, opaque: hierarchy.opaque };
};

describe('hierarchyOf', () => {
  it('lists project ancestors nearest first and flags a foreign or unresolved base', () => {
    expect([of('Leaf'), of('Base'), of('OnLibrary'), of('OnUnknown')]).toEqual([
      { ancestors: ['Middle', 'Base'], extendsForeign: false, opaque: false },
      { ancestors: [], extendsForeign: false, opaque: false },
      { ancestors: [], extendsForeign: true, opaque: false },
      { ancestors: [], extendsForeign: true, opaque: false },
    ]);
  });

  it('treats a base built by a call as foreign and opaque, for every class above it too', () => {
    expect([of('Mixed'), of('AboveMixed')]).toEqual([
      { ancestors: [], extendsForeign: true, opaque: true },
      { ancestors: ['Mixed'], extendsForeign: true, opaque: true },
    ]);
  });
});
