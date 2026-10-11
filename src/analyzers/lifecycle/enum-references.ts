import { EnumDeclaration, Identifier, Node, SyntaxKind } from 'ts-morph';
import { groupedBy } from '../shared/grouping';
import { SourceIndex } from '../shared/source-index';

type ReferencesByEnum = ReadonlyMap<EnumDeclaration, readonly Identifier[]>;

const isModuleBinding = (identifier: Identifier): boolean => {
  const parent = identifier.getParent();
  return (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceImport(parent) ||
    Node.isEnumDeclaration(parent)
  );
};

const referencedEnums = (identifier: Identifier): readonly EnumDeclaration[] => {
  const symbol = identifier.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return [...new Set(target?.getDeclarations() ?? [])].filter(Node.isEnumDeclaration);
};

const referencesByEnum = (identifiers: readonly Identifier[]): ReferencesByEnum =>
  groupedBy(
    identifiers.filter((identifier) => !isModuleBinding(identifier)),
    referencedEnums,
  );

export class EnumReferences {
  private byEnum: ReferencesByEnum | undefined;

  constructor(private readonly sources: SourceIndex) {}

  to(enumDeclaration: EnumDeclaration): readonly Identifier[] {
    this.byEnum ??= referencesByEnum(this.sources.ofKind(SyntaxKind.Identifier));
    return this.byEnum.get(enumDeclaration) ?? [];
  }
}
