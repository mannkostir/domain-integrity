import { ClassDeclaration, InterfaceDeclaration, Node } from 'ts-morph';

type HeritageDeclaration = ClassDeclaration | InterfaceDeclaration;

const isHeritageDeclaration = (node: Node): node is HeritageDeclaration =>
  Node.isClassDeclaration(node) || Node.isInterfaceDeclaration(node);

const implementedDeclarations = (declaration: ClassDeclaration): readonly HeritageDeclaration[] =>
  declaration
    .getImplements()
    .flatMap((clause) => (clause.getType().getSymbol()?.getDeclarations() ?? []).filter(isHeritageDeclaration));

const directHeritage = (declaration: HeritageDeclaration): readonly HeritageDeclaration[] => {
  if (Node.isInterfaceDeclaration(declaration)) return declaration.getBaseDeclarations().filter(isHeritageDeclaration);
  const base = declaration.getBaseClass();
  return [...(base === undefined ? [] : [base]), ...implementedDeclarations(declaration)];
};

const collect = (
  pending: readonly HeritageDeclaration[],
  seen: ReadonlySet<HeritageDeclaration>,
): ReadonlySet<HeritageDeclaration> => {
  const [head, ...rest] = pending;
  if (head === undefined) return seen;
  if (seen.has(head)) return collect(rest, seen);
  return collect([...rest, ...directHeritage(head)], new Set([...seen, head]));
};

export const familyHeritage = (family: readonly ClassDeclaration[]): ReadonlySet<Node> => collect(family, new Set());
