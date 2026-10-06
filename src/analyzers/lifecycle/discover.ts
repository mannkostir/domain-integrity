import { ClassDeclaration, ExpressionWithTypeArguments, InterfaceDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { className } from '../../engine/class-identity';

type BaseNames = ReadonlySet<string>;

export const aggregateName = className;

const lastNameSegment = (clause: ExpressionWithTypeArguments): string =>
  clause.getExpression().getText().split('.').pop() ?? '';

const clauseNamesEntry = (clause: ExpressionWithTypeArguments, names: BaseNames): boolean =>
  names.has(lastNameSegment(clause));

const resolvedInterfaces = (clause: ExpressionWithTypeArguments): readonly InterfaceDeclaration[] =>
  clause.getType().getSymbol()?.getDeclarations().filter(Node.isInterfaceDeclaration) ?? [];

const parentInterfaces = (iface: InterfaceDeclaration): readonly InterfaceDeclaration[] =>
  iface.getExtends().flatMap(resolvedInterfaces);

const reachableInterfaces = (roots: readonly InterfaceDeclaration[]): ReadonlySet<InterfaceDeclaration> => {
  const visited = new Set<InterfaceDeclaration>();
  const pending = [...roots];
  for (let iface = pending.pop(); iface !== undefined; iface = pending.pop()) {
    if (visited.has(iface)) continue;
    visited.add(iface);
    pending.push(...parentInterfaces(iface));
  }
  return visited;
};

const interfaceMatches = (iface: InterfaceDeclaration, names: BaseNames): boolean =>
  names.has(iface.getName()) || iface.getExtends().some((clause) => clauseNamesEntry(clause, names));

const classChain = (cls: ClassDeclaration): readonly ClassDeclaration[] => {
  const chain: ClassDeclaration[] = [];
  for (
    let current: ClassDeclaration | undefined = cls;
    current !== undefined && !chain.includes(current);
    current = current.getBaseClass()
  ) {
    chain.push(current);
  }
  return chain;
};

const extendsClauseMatches = (cls: ClassDeclaration, names: BaseNames): boolean => {
  const heritage = cls.getExtends();
  return heritage !== undefined && clauseNamesEntry(heritage, names);
};

const implementsClausesMatch = (clauses: readonly ExpressionWithTypeArguments[], names: BaseNames): boolean =>
  clauses.some((clause) => clauseNamesEntry(clause, names)) ||
  [...reachableInterfaces(clauses.flatMap(resolvedInterfaces))].some((iface) => interfaceMatches(iface, names));

const classMatches = (cls: ClassDeclaration, names: BaseNames): boolean => {
  const chain = classChain(cls);
  return (
    chain.some((member) => extendsClauseMatches(member, names)) ||
    implementsClausesMatch(
      chain.flatMap((member) => member.getImplements()),
      names,
    )
  );
};

export const discoverAggregates = (
  files: readonly SourceFile[],
  baseClasses: readonly string[],
  declared: readonly ClassDeclaration[],
): ClassDeclaration[] => {
  const names = new Set(baseClasses);
  const discovered = files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((cls) => !cls.isAbstract() && classMatches(cls, names));
  return [...new Set([...declared, ...discovered])];
};
