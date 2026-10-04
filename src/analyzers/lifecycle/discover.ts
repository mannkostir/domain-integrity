import { ClassDeclaration, ExpressionWithTypeArguments, InterfaceDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';

type BaseNames = ReadonlySet<string>;

export const aggregateName = (cls: ClassDeclaration): string => cls.getName() ?? '<anonymous>';

const lastNameSegment = (clause: ExpressionWithTypeArguments): string =>
  clause.getExpression().getText().split('.').pop() ?? '';

const clauseNamesEntry = (clause: ExpressionWithTypeArguments, names: BaseNames): boolean =>
  names.has(lastNameSegment(clause));

const resolvedInterfaces = (clause: ExpressionWithTypeArguments): readonly InterfaceDeclaration[] =>
  clause.getType().getSymbol()?.getDeclarations().filter(Node.isInterfaceDeclaration) ?? [];

const interfaceExtendsNamed = (
  iface: InterfaceDeclaration,
  names: BaseNames,
  seen: ReadonlySet<InterfaceDeclaration>,
): boolean => {
  const visited = new Set([...seen, iface]);
  return !seen.has(iface) && iface.getExtends().some((clause) => heritageClauseMatches(clause, names, visited));
};

const heritageClauseMatches = (
  clause: ExpressionWithTypeArguments,
  names: BaseNames,
  seen: ReadonlySet<InterfaceDeclaration>,
): boolean =>
  clauseNamesEntry(clause, names) || resolvedInterfaces(clause).some((iface) => interfaceExtendsNamed(iface, names, seen));

const extendsClauseMatches = (cls: ClassDeclaration, names: BaseNames): boolean => {
  const heritage = cls.getExtends();
  return heritage !== undefined && clauseNamesEntry(heritage, names);
};

const implementsClauseMatches = (cls: ClassDeclaration, names: BaseNames): boolean =>
  cls.getImplements().some((clause) => heritageClauseMatches(clause, names, new Set()));

const classMatches = (cls: ClassDeclaration, names: BaseNames, seen: ReadonlySet<ClassDeclaration>): boolean => {
  if (seen.has(cls)) return false;
  if (extendsClauseMatches(cls, names) || implementsClauseMatches(cls, names)) return true;
  const base = cls.getBaseClass();
  return base !== undefined && classMatches(base, names, new Set([...seen, cls]));
};

export const discoverAggregates = (
  files: readonly SourceFile[],
  baseClasses: readonly string[],
  declared: readonly ClassDeclaration[],
): ClassDeclaration[] => {
  const names = new Set(baseClasses);
  const discovered = files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((cls) => !cls.isAbstract() && classMatches(cls, names, new Set()));
  return [...new Set([...declared, ...discovered])];
};
