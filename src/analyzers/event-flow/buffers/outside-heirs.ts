import { ClassDeclaration, ClassExpression, Node, SourceFile, SyntaxKind, Type, ts } from 'ts-morph';

export type ProjectClass = ClassDeclaration | ClassExpression;

export const projectClassesIn = (files: readonly SourceFile[]): readonly ProjectClass[] =>
  files.flatMap((file) => [
    ...file.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...file.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ]);

const isHolderType = (type: Type, holders: ReadonlySet<Node>): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some((declaration) => holders.has(declaration));

const baseTypesOf = (type: Type): readonly Type[] => {
  const target = type.getTargetType() ?? type;
  return target.isClassOrInterface() ? target.getBaseTypes() : [];
};

const reachesHolder = (type: Type, holders: ReadonlySet<Node>, seen: ReadonlySet<ts.Type>): boolean => {
  if (seen.has(type.compilerType)) return false;
  const next: ReadonlySet<ts.Type> = new Set([...seen, type.compilerType]);
  return (
    isHolderType(type, holders) ||
    [...type.getIntersectionTypes(), ...type.getUnionTypes(), ...baseTypesOf(type)].some((inner) => reachesHolder(inner, holders, next))
  );
};

const isOutsideHeir = (cls: ProjectClass, holders: ReadonlySet<Node>): boolean => {
  const instance = cls.getSymbol()?.getDeclaredType();
  return !holders.has(cls) && instance !== undefined && baseTypesOf(instance).some((base) => reachesHolder(base, holders, new Set()));
};

export const hasHeirOutside = (holders: readonly ClassDeclaration[], classes: readonly ProjectClass[]): boolean => {
  const known: ReadonlySet<Node> = new Set(holders);
  return classes.some((cls) => isOutsideHeir(cls, known));
};
