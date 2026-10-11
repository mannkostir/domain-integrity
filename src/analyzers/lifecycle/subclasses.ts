import { ClassDeclaration, SyntaxKind } from 'ts-morph';
import { groupedBy } from '../shared/grouping';
import { SourceIndex } from '../shared/source-index';
import { inheritanceChain } from './field-ref';

type SubclassesByAncestor = ReadonlyMap<ClassDeclaration, readonly ClassDeclaration[]>;

const ancestorsOf = (cls: ClassDeclaration): readonly ClassDeclaration[] =>
  [...new Set(inheritanceChain(cls))].filter((ancestor) => ancestor !== cls);

const subclassesByAncestor = (classes: readonly ClassDeclaration[]): SubclassesByAncestor => groupedBy(classes, ancestorsOf);

export class Subclasses {
  private byAncestor: SubclassesByAncestor | undefined;

  constructor(private readonly sources: SourceIndex) {}

  of(cls: ClassDeclaration): readonly ClassDeclaration[] {
    this.byAncestor ??= subclassesByAncestor(this.sources.ofKind(SyntaxKind.ClassDeclaration));
    return this.byAncestor.get(cls) ?? [];
  }
}
