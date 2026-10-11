import { ClassDeclaration, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../shared/source-index';
import { inheritanceChain } from './field-ref';

type SubclassesByAncestor = ReadonlyMap<ClassDeclaration, readonly ClassDeclaration[]>;

const ancestorsOf = (cls: ClassDeclaration): readonly ClassDeclaration[] =>
  [...new Set(inheritanceChain(cls))].filter((ancestor) => ancestor !== cls);

const subclassesByAncestor = (classes: readonly ClassDeclaration[]): SubclassesByAncestor => {
  const subclasses = new Map<ClassDeclaration, ClassDeclaration[]>();
  classes.forEach((cls) =>
    ancestorsOf(cls).forEach((ancestor) => {
      const known = subclasses.get(ancestor);
      if (known === undefined) subclasses.set(ancestor, [cls]);
      else known.push(cls);
    }),
  );
  return subclasses;
};

export class Subclasses {
  private byAncestor: SubclassesByAncestor | undefined;

  constructor(private readonly sources: SourceIndex) {}

  of(cls: ClassDeclaration): readonly ClassDeclaration[] {
    this.byAncestor ??= subclassesByAncestor(this.sources.ofKind(SyntaxKind.ClassDeclaration));
    return this.byAncestor.get(cls) ?? [];
  }
}
